// ===================================================================
// src/core/http.js — самодельный мини-фреймворк (аналог Express «на минималках»)
// Умеет: маршруты с параметрами (/api/profile/:id), JSON-тело,
// авторизацию по токену из заголовка x-token и раздачу статики из /public.
// ===================================================================

const http = require('http');
const db = require('./db');
const staticCache = require('./staticCache');
const auditLog = require('../services/auditLog');
const logTranslate = require('../services/logTranslate');
const { ApiError } = require('./utils');

// Сопоставление пути запроса с шаблоном маршрута ('/api/profile/:id')
function matchRoute(pattern, pathname) {
  const pp = pattern.split('/').filter(Boolean);
  const sp = pathname.split('/').filter(Boolean);
  if (pp.length !== sp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

// Чтение JSON-тела запроса (с ограничением размера)
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 200 * 1024) { req.destroy(); resolve({}); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// Отправить JSON. Если ответ крупный и клиент поддерживает gzip/brotli —
// сжимаем на лету (экономия ~70% трафика для API).
function sendJson(req, res, status, obj) {
  const raw = JSON.stringify(obj);
  const ae = req && req.headers ? req.headers['accept-encoding'] : '';
  const { body, encoding } = staticCache.compressBody(raw, ae);
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (encoding) {
    headers['Content-Encoding'] = encoding;
    headers['Vary'] = 'Accept-Encoding';
  }
  res.writeHead(status, headers);
  res.end(body);
}

// Раздача статики из кеша в памяти.
//   - /         → index.html (no-cache, всегда проверять)
//   - /admin    → admin.html (no-cache)
//   - /css/style.<hash>.css, /js/app.<hash>.js → отдаются с
//     Cache-Control: public, max-age=31536000, immutable
//     (браузер не пойдёт за ними повторно вообще)
//   - всё остальное — Cache-Control: public, max-age=3600 + ETag
//   - При совпадении ETag (If-None-Match) возвращаем 304 без тела.
//   - Сжатие brotli/gzip — по Accept-Encoding (предварительно прогретое).
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  if (rel === '/admin') rel = '/admin.html';

  // Защита от подсовывания "../" и прочих трюков:
  // в кеше есть только то, что лежит в /public, поэтому достаточно
  // не дать обращений с .. и null-byte
  if (rel.indexOf('\0') >= 0 || /(^|\/)\.\.(\/|$)/.test(rel)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  const hit = staticCache.lookup(rel);
  if (!hit) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Не найдено');
  }
  const { entry, hashed } = hit;

  // Условный запрос: если клиент уже знает этот ETag — 304 без тела.
  // Совершенно бесплатная экономия для повторных заходов.
  const ifNone = req.headers['if-none-match'];
  if (ifNone && ifNone === entry.etag) {
    res.writeHead(304, {
      'ETag': entry.etag,
      'Cache-Control': cacheControlFor(rel, hashed),
    });
    return res.end();
  }

  // Выбор сжатой версии под Accept-Encoding
  const ae = req.headers['accept-encoding'];
  const enc = staticCache.pickEncoding(ae);
  let body = entry.buffer;
  let contentEncoding = null;
  if (enc === 'br' && entry.br) { body = entry.br; contentEncoding = 'br'; }
  else if (enc === 'gzip' && entry.gzip) { body = entry.gzip; contentEncoding = 'gzip'; }

  const headers = {
    'Content-Type': entry.contentType,
    'Content-Length': body.length,
    'ETag': entry.etag,
    'Cache-Control': cacheControlFor(rel, hashed),
    'Vary': 'Accept-Encoding',
  };
  if (contentEncoding) headers['Content-Encoding'] = contentEncoding;

  // HEAD-запросы — только заголовки, без тела (некоторые CDN это любят)
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  res.end(body);
}

// Стратегия кеша:
//   - HTML (всегда!): no-cache — браузер обязан проверить ETag перед использованием.
//     Это значит, что когда мы выкатим новую версию, игроки получат
//     обновление при следующем обращении (без необходимости hard-refresh).
//   - Фингерпринтованные CSS/JS (/x.<hash>.ext): immutable на год.
//     URL гарантированно меняется при изменении файла.
//   - Остальное (картинки, шрифты): max-age=1 час + ETag.
function cacheControlFor(rel, hashed) {
  if (rel.endsWith('.html')) return 'no-cache';
  if (hashed) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600, must-revalidate';
}

function createApp() {
  const routes = [];
  // Функция «освежения» игрока (регенерация, доход) — задаётся снаружи,
  // чтобы http-слой не зависел от игровой логики напрямую.
  let refreshUser = null;

  const app = {
    // Регистрация маршрута. opts: { open: true } — без авторизации,
    // { admin: true } — только для администратора.
    add(method, pattern, handler, opts = {}) {
      routes.push({ method, pattern, handler, opts });
    },
    setUserRefresher(fn) { refreshUser = fn; },

    listen(port, cb) {
      const server = http.createServer(async (req, res) => {
        try {
          const [pathname, qs] = req.url.split('?');
          // Всё, что не /api — статика фронтенда
          if (!pathname.startsWith('/api')) {
            if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
            return serveStatic(req, res, pathname);
          }

          // Ищем подходящий маршрут
          let found = null, params = null;
          for (const r of routes) {
            if (r.method !== req.method) continue;
            const p = matchRoute(r.pattern, pathname);
            if (p) { found = r; params = p; break; }
          }
          if (!found) return sendJson(req, res, 404, { error: 'Маршрут не найден' });

          const reqCtx = {
            method: req.method,
            params,
            query: Object.fromEntries(new URLSearchParams(qs || '')),
            body: req.method === 'POST' ? await readBody(req) : {},
            user: null,
          };

          // Авторизация (если маршрут не открытый)
          if (!found.opts.open) {
            const token = req.headers['x-token'] || '';
            const sessions = db.load('sessions', {});
            const users = db.load('users', {});
            const userId = sessions[token];
            const user = userId && users[userId];
            if (!user) return sendJson(req, res, 401, { error: 'Требуется вход в игру' });
            if (found.opts.admin && !user.isAdmin) return sendJson(req, res, 403, { error: 'Только для администратора' });
            user.lastSeen = Date.now();
            if (refreshUser) refreshUser(user); // регенерация, доход, чистка эффектов
            reqCtx.user = user;
          }

          const result = await found.handler(reqCtx);
          db.saveAll(); // отложенная запись всех изменённых коллекций

          // Журнал действий: фиксируем только POST-запросы авторизованных
          // игроков (это и есть «действия» — покупки, атаки, прокачки...)
          if (reqCtx.user && req.method === 'POST') {
            auditLog.record({
              userId: reqCtx.user.id,
              userName: reqCtx.user.name,
              path: pathname,
              desc: logTranslate.describe(pathname, reqCtx.body, result),
              params,
              body: reqCtx.body,
            });
          }

          // ETag-кеш для GET-маршрутов, помеченных opts.etag:true.
          // Статичные ответы (например, /api/countries) запрашиваются
          // на каждом заходе — давать на них 304 экономит трафик и CPU.
          if (found.opts.etag && req.method === 'GET') {
            const raw = JSON.stringify(result === undefined ? { ok: true } : result);
            const etag = '"' + require('crypto').createHash('sha256').update(raw).digest('hex').slice(0, 16) + '"';
            if (req.headers['if-none-match'] === etag) {
              res.writeHead(304, {
                'ETag': etag,
                'Cache-Control': 'public, max-age=300, must-revalidate',
              });
              return res.end();
            }
            const ae = req.headers['accept-encoding'];
            const { body, encoding } = staticCache.compressBody(raw, ae);
            const headers = {
              'Content-Type': 'application/json; charset=utf-8',
              'ETag': etag,
              'Cache-Control': 'public, max-age=300, must-revalidate',
              'Vary': 'Accept-Encoding',
            };
            if (encoding) headers['Content-Encoding'] = encoding;
            res.writeHead(200, headers);
            return res.end(body);
          }

          sendJson(req, res, 200, result === undefined ? { ok: true } : result);
        } catch (e) {
          if (e instanceof ApiError) return sendJson(req, res, e.status, { error: e.message });
          console.error('Внутренняя ошибка:', e);
          sendJson(req, res, 500, { error: 'Внутренняя ошибка сервера' });
        }
      });
      server.listen(port, '0.0.0.0', cb);
      return server;
    },
  };
  return app;
}

module.exports = { createApp };
