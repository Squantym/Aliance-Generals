// ===================================================================
// src/core/http.js — самодельный мини-фреймворк (аналог Express «на минималках»)
// Умеет: маршруты с параметрами (/api/profile/:id), JSON-тело,
// авторизацию по токену из заголовка x-token и раздачу статики из /public.
// ===================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auditLog = require('../services/auditLog');
const logTranslate = require('../services/logTranslate');
const { ApiError } = require('./utils');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// Типы содержимого для статических файлов
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

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

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Безопасная раздача файла из public (защита от выхода за каталог через ..)
function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  if (rel === '/admin') rel = '/admin.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
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
            if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
            return serveStatic(res, pathname);
          }

          // Ищем подходящий маршрут
          let found = null, params = null;
          for (const r of routes) {
            if (r.method !== req.method) continue;
            const p = matchRoute(r.pattern, pathname);
            if (p) { found = r; params = p; break; }
          }
          if (!found) return sendJson(res, 404, { error: 'Маршрут не найден' });

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
            if (!user) return sendJson(res, 401, { error: 'Требуется вход в игру' });
            if (found.opts.admin && !user.isAdmin) return sendJson(res, 403, { error: 'Только для администратора' });
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

          sendJson(res, 200, result === undefined ? { ok: true } : result);
        } catch (e) {
          if (e instanceof ApiError) return sendJson(res, e.status, { error: e.message });
          console.error('Внутренняя ошибка:', e);
          sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
        }
      });
      server.listen(port, '0.0.0.0', cb);
      return server;
    },
  };
  return app;
}

module.exports = { createApp };
