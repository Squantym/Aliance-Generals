// ===================================================================
// src/core/http.ts — самодельный мини-фреймворк (аналог Express «на минималках»)
// Умеет: маршруты с параметрами (/api/profile/:id), JSON-тело,
// авторизацию по токену из заголовка x-token и раздачу статики из /public.
// ===================================================================

import http = require('http');
import fs = require('fs');
import path = require('path');
import crypto = require('crypto');
import db = require('./db');
import auditLog = require('../services/auditLog');
import logTranslate = require('../services/logTranslate');
import assetHash = require('./assetHash');
import compress = require('./compress');
import u = require('./utils');

const ApiError = u.ApiError;

// Корень проекта: из src/core/ это два уровня вверх, из dist/src/core/
// это три. Надёжнее опираться на process.cwd() (откуда запущен node),
// т.к. сервер всегда стартует из корня проекта (npm start / node ...).
const PROJECT_ROOT = process.cwd();
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

// ── Типы фреймворка ──────────────────────────────────────────────
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RouteOpts {
  open?: boolean;   // без авторизации
  admin?: boolean;  // только администратор
}

// Контекст запроса, который получает обработчик маршрута
interface ReqCtx {
  method: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  user: any | null;   // игрок (тип User уточним при переводе сервисов)
  ip: string;
}

type RouteHandler = (ctx: ReqCtx) => any | Promise<any>;

interface Route {
  method: string;
  pattern: string;
  handler: RouteHandler;
  opts: RouteOpts;
}

type Headers = Record<string, string | number>;

// Типы содержимого для статических файлов
const MIME: Record<string, string> = {
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
// Служебные файлы PWA. Их НЕЛЬЗЯ кешировать надолго:
//  • /sw.js — сам воркер. Закешируется на сутки → игроки залипнут на старой
//    версии клиента, и починить это удалённо будет тяжело.
//  • /sw-config.json — аварийный выключатель воркера, должен долетать сразу.
//  • /manifest.json — правки иконок/названия должны подхватываться.
const PWA_NO_CACHE = ['/sw.js', '/sw-config.json', '/manifest.json'];

function cacheControlFor(ext: string, hasHashParam: boolean, relPath?: string): string {
  if (relPath && PWA_NO_CACHE.includes(relPath)) return 'no-cache';
  if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.gif', '.avif'].includes(ext)) {
    return 'public, max-age=31536000, immutable'; // 1 год
  }
  if (['.css', '.js'].includes(ext)) {
    return hasHashParam
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=86400, must-revalidate';
  }
  if (['.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
    return 'public, max-age=31536000, immutable'; // шрифты — год
  }
  // .html — точка входа SPA. Не кешируем тело, но разрешаем ETag/304.
  return 'no-cache';
}

// Сопоставление пути запроса с шаблоном маршрута ('/api/profile/:id')
function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean);
  const sp = pathname.split('/').filter(Boolean);
  if (pp.length !== sp.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

// Чтение JSON-тела запроса (с ограничением размера)
function readBody(req: http.IncomingMessage): Promise<any> {
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
function sendJson(res: http.ServerResponse, status: number, obj: any, acceptEncoding?: string): void {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  const headers: Headers = {
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
//   1. ETag + 304: если у клиента актуальная версия — 304 (трафик ≈ 0)
//   2. Brotli/gzip: текст сжимается на 70–85%
//   3. In-memory кэш сжатых версий: жмём один раз, отдаём всем
//   4. Immutable cache на год для версионированных файлов
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, urlPath: string, query?: string): void {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  if (rel === '/admin') rel = '/admin.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  const hasHashParam = !!(query && query.includes('v='));
  const acceptEncoding = (req.headers['accept-encoding'] as string) || '';
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
      res.end();
      return;
    }

    const headers: Headers = {
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
      res.end(packed);
      return;
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(body);
    return;
  }

  // ── Прочая статика: ETag по mtime+size, кэш сжатых версий ──────
  const etag = '"' + stat.size.toString(16) + '-' + Math.round(stat.mtimeMs).toString(16) + '"';

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, {
      'ETag': etag,
      'Cache-Control': cacheControlFor(ext, hasHashParam, rel),
    });
    res.end();
    return;
  }

  const enc = compress.pickEncoding(acceptEncoding);
  const wantCompress = enc && compress.shouldCompress(contentType, stat.size);

  let cached = compress.getCached(relKey, wantCompress ? enc : 'raw', stat.mtimeMs);
  if (!cached) {
    const data = fs.readFileSync(filePath);
    if (wantCompress) {
      const packed = compress.compress(data, enc, true);
      compress.setCached(relKey, enc, stat.mtimeMs, packed, etag);
      cached = { buf: packed, etag, mtimeMs: stat.mtimeMs };
    } else {
      compress.setCached(relKey, 'raw', stat.mtimeMs, data, etag);
      cached = { buf: data, etag, mtimeMs: stat.mtimeMs };
    }
  }

  const headers: Headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControlFor(ext, hasHashParam, rel),
    'ETag': etag,
    'Vary': 'Accept-Encoding',
    'Content-Length': cached.buf.length,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  if (wantCompress && enc) headers['Content-Encoding'] = enc;

  res.writeHead(200, headers);
  res.end(cached.buf);
}

function createApp() {
  const routes: Route[] = [];
  // Функция «освежения» игрока (регенерация, доход) — задаётся снаружи,
  // чтобы http-слой не зависел от игровой логики напрямую.
  let refreshUser: ((user: any) => void) | null = null;

  const app = {
    // Регистрация маршрута. opts: { open: true } — без авторизации,
    // { admin: true } — только для администратора.
    add(method: Method, pattern: string, handler: RouteHandler, opts: RouteOpts = {}) {
      routes.push({ method, pattern, handler, opts });
    },
    setUserRefresher(fn: (user: any) => void) { refreshUser = fn; },

    listen(port: number, cb?: () => void) {
      const server = http.createServer(async (req, res) => {
        const acceptEncoding = (req.headers['accept-encoding'] as string) || '';
        try {
          const [pathname, qs] = (req.url || '').split('?');
          // Всё, что не /api — статика фронтенда
          if (!pathname.startsWith('/api')) {
            if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
            return serveStatic(req, res, pathname, qs);
          }

          // Ищем подходящий маршрут
          let found: Route | null = null;
          let params: Record<string, string> | null = null;
          for (const r of routes) {
            if (r.method !== req.method) continue;
            const p = matchRoute(r.pattern, pathname);
            if (p) { found = r; params = p; break; }
          }
          if (!found) return sendJson(res, 404, { error: 'Маршрут не найден' }, acceptEncoding);

          const reqCtx: ReqCtx = {
            method: req.method || 'GET',
            params: params || {},
            query: Object.fromEntries(new URLSearchParams(qs || '')),
            body: req.method === 'POST' ? await readBody(req) : {},
            user: null,
            ip: ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown',
          };

          // Авторизация (если маршрут не открытый)
          if (!found.opts.open) {
            const token = (req.headers['x-token'] as string) || '';
            const sessions = db.load<Record<string, string>>('sessions', {});
            const users = db.load<Record<string, any>>('users', {});
            const userId = sessions[token];
            const user = userId && users[userId];
            if (!user) return sendJson(res, 401, { error: 'Требуется вход в игру' }, acceptEncoding);
            if (user.banned) {
              return sendJson(res, 403, {
                error: 'Ваш аккаунт заблокирован администрацией.' + (user.banReason ? ' Причина: ' + user.banReason : ''),
                banned: true,
              }, acceptEncoding);
            }
            if (found.opts.admin && !user.isAdmin) return sendJson(res, 403, { error: 'Только для администратора' }, acceptEncoding);
            user.lastSeen = Date.now();
            if (refreshUser) refreshUser(user); // регенерация, доход, чистка эффектов
            reqCtx.user = user;
          }

          const result = await found.handler(reqCtx);
          // Сохраняем только текущего игрока точечно. Прочие изменённые
          // коллекции сервисы сохраняют сами через db.save(name); дополнительно
          // раз в 30с срабатывает страховочный saveAll (см. db.startPeriodicFlush).
          // Раньше здесь был db.saveAll() на КАЖДЫЙ запрос — он переписывал все
          // коллекции целиком в Atlas и давал терабайты трафика.
          if (reqCtx.user) db.markUser(reqCtx.user.id);

          // Журнал действий: фиксируем только POST-запросы авторизованных игроков
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
        } catch (e: any) {
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

export = { createApp };
