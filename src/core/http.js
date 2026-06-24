// ===================================================================
// src/core/http.js — самодельный мини-фреймворк (аналог Express «на минималках»)
// Умеет: маршруты с параметрами (/api/profile/:id), JSON-тело,
// авторизацию по токену из заголовка x-token и раздачу статики из /public.
// ===================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const db = require('./db');
const auditLog = require('../services/auditLog');
const logTranslate = require('../services/logTranslate');
const assetHash = require('./assetHash');
const compress = require('./compress');
const { ApiError } = require('./utils');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// Типы содержимого для статических файлов
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// Срок кеширования в браузере игрока по типу файла.
// Принцип: чем дольше кеш — тем меньше трафика. Файлы с хэшем в URL
// (?v=хэш) можно кешировать на ГОД как immutable: при изменении файла
// меняется хэш → меняется URL → браузер скачивает новую версию сам.
//   - hasHashParam: запрос пришёл с ?v=... — значит URL версионирован,
//     можно ставить immutable на год (трафик = 0 при повторных заходах)
function cacheControlFor(ext, hasHashParam) {
  // Картинки статичны — год кеша
  if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.gif', '.avif'].includes(ext)) {
    return 'public, max-age=31536000, immutable'; // 1 год
  }
  if (['.css', '.js'].includes(ext)) {
    // Если URL версионирован хэшем — кешируем на год как immutable.
    // Иначе (прямой заход без ?v) — сутки + обязательная ревалидация.
    return hasHashParam
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=86400, must-revalidate';
  }
  if (['.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
    return 'public, max-age=31536000, immutable'; // шрифты — год
  }
  // .html — точка входа SPA. Не кешируем тело, но разрешаем ETag/304:
  // если HTML не менялся, сервер ответит 304 (пустое тело, ~0 трафика).
  return 'no-cache';
}

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

// Отправка JSON. Сжимаем gzip/brotli если клиент поддерживает и тело
// достаточно крупное — экономит трафик на «толстых» ответах (/api/me,
// /api/legion, зал славы и т.п.), которые игроки запрашивают часто.
function sendJson(res, status, obj, acceptEncoding) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Vary': 'Accept-Encoding',
  };

  const enc = compress.pickEncoding(acceptEncoding);
  if (enc && compress.shouldCompress('application/json', raw.length)) {
    const packed = compress.compress(raw, enc, false);
    headers['Content-Encoding'] = enc;
    headers['Content-Length'] = packed.length;
    res.writeHead(status, headers);
    res.end(packed);
    return;
  }

  headers['Content-Length'] = raw.length;
  res.writeHead(status, headers);
  res.end(raw);
}

// Безопасная раздача файла из public с кэшированием и сжатием.
// Механизмы экономии трафика:
//   1. ETag + 304: если у клиента актуальная версия — 304 (трафик ≈ 0)
//   2. Brotli/gzip: текст сжимается на 70–85%
//   3. In-memory кэш сжатых версий: жмём один раз, отдаём всем
//   4. Immutable cache на год для версионированных файлов
function serveStatic(req, res, urlPath, query) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  if (rel === '/admin') rel = '/admin.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Не найдено');
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  const hasHashParam = !!(query && query.includes('v='));
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const relKey = rel;

  // ── HTML: подставляем хэши в ссылки (меняется в рантайме) ───────
  if (ext === '.html') {
    const data = fs.readFileSync(filePath);
    const html = data.toString('utf8').replace(
      /(["'])(\/(?:css|js)\/[^"'?]+\.(?:css|js))\1/g,
      (full, quote, relPath) => `${quote}${assetHash.versioned(relPath)}${quote}`
    );
    const body = Buffer.from(html, 'utf8');
    const etag = '"' + crypto.createHash('md5').update(body).digest('hex').slice(0, 16) + '"';

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
      return res.end();
    }

    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'ETag': etag,
      'Vary': 'Accept-Encoding',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:;",
    };

    const enc = compress.pickEncoding(acceptEncoding);
    if (enc && compress.shouldCompress(contentType, body.length)) {
      const packed = compress.compress(body, enc, true);
      headers['Content-Encoding'] = enc;
      headers['Content-Length'] = packed.length;
      res.writeHead(200, headers);
      return res.end(packed);
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    return res.end(body);
  }

  // ── Прочая статика: ETag по mtime+size, кэш сжатых версий ──────
  const etag = '"' + stat.size.toString(16) + '-' + Math.round(stat.mtimeMs).toString(16) + '"';

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, {
      'ETag': etag,
      'Cache-Control': cacheControlFor(ext, hasHashParam),
    });
    return res.end();
  }

  const enc = compress.pickEncoding(acceptEncoding);
  const wantCompress = enc && compress.shouldCompress(contentType, stat.size);

  let cached = compress.getCached(relKey, wantCompress ? enc : 'raw', stat.mtimeMs);
  if (!cached) {
    const data = fs.readFileSync(filePath);
    if (wantCompress) {
      const packed = compress.compress(data, enc, true);
      compress.setCached(relKey, enc, stat.mtimeMs, packed, etag);
      cached = { buf: packed, etag };
    } else {
      compress.setCached(relKey, 'raw', stat.mtimeMs, data, etag);
      cached = { buf: data, etag };
    }
  }

  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControlFor(ext, hasHashParam),
    'ETag': etag,
    'Vary': 'Accept-Encoding',
    'Content-Length': cached.buf.length,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  if (wantCompress) headers['Content-Encoding'] = enc;

  res.writeHead(200, headers);
  res.end(cached.buf);
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
        const acceptEncoding = req.headers['accept-encoding'] || '';
        try {
          const [pathname, qs] = req.url.split('?');
          // Всё, что не /api — статика фронтенда
          if (!pathname.startsWith('/api')) {
            if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
            return serveStatic(req, res, pathname, qs);
          }

          // Ищем подходящий маршрут
          let found = null, params = null;
          for (const r of routes) {
            if (r.method !== req.method) continue;
            const p = matchRoute(r.pattern, pathname);
            if (p) { found = r; params = p; break; }
          }
          if (!found) return sendJson(res, 404, { error: 'Маршрут не найден' }, acceptEncoding);

          const reqCtx = {
            method: req.method,
            params,
            query: Object.fromEntries(new URLSearchParams(qs || '')),
            body: req.method === 'POST' ? await readBody(req) : {},
            user: null,
            ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown',
          };

          // Авторизация (если маршрут не открытый)
          if (!found.opts.open) {
            const token = req.headers['x-token'] || '';
            const sessions = db.load('sessions', {});
            const users = db.load('users', {});
            const userId = sessions[token];
            const user = userId && users[userId];
            if (!user) return sendJson(res, 401, { error: 'Требуется вход в игру' }, acceptEncoding);
            if (found.opts.admin && !user.isAdmin) return sendJson(res, 403, { error: 'Только для администратора' }, acceptEncoding);
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

          sendJson(res, 200, result === undefined ? { ok: true } : result, acceptEncoding);
        } catch (e) {
          if (e instanceof ApiError) return sendJson(res, e.status, { error: e.message }, acceptEncoding);
          console.error('Внутренняя ошибка:', e);
          sendJson(res, 500, { error: 'Внутренняя ошибка сервера' }, acceptEncoding);
        }
      });
      server.listen(port, '0.0.0.0', cb);
      return server;
    },
  };
  return app;
}

module.exports = { createApp };
