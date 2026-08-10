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
  ua: string;          // строка браузера — для определения устройства
  hints?: any;         // подсказки браузера: модель, система (Client Hints)
  rawHeaders?: any;    // сырые заголовки — только для диагностики
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

// ── Настоящий адрес посетителя ────────────────────────────────────
// За обратным прокси (nginx) сокет всегда показывает 127.0.0.1 — это
// адрес самого сервера, а не игрока. Поэтому смотрим заголовки, которые
// проставляет прокси, и перебираем их по порядку: у разных настроек и
// у Cloudflare заголовки называются по-разному.
//
// Loopback и приватные адреса из цепочки отбрасываем: если прокси
// добавил себя в X-Forwarded-For, первым может оказаться внутренний
// адрес, а нужен внешний — тот, с которого пришёл человек.
function isUsableIp(ip: string): boolean {
  const v = String(ip || '').trim().replace(/^::ffff:/, '');
  if (!v || v === 'unknown') return false;
  if (v === '127.0.0.1' || v === '::1' || v.startsWith('127.')) return false;
  if (/^10\./.test(v)) return false;
  if (/^192\.168\./.test(v)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return false;
  if (/^169\.254\./.test(v)) return false;
  if (/^f[cd]/i.test(v)) return false;          // приватные IPv6
  return true;
}

function clientIp(req: any): string {
  const h = req.headers || {};
  // Cloudflare и подобные ставят свой заголовок — он самый надёжный
  const direct = [h['cf-connecting-ip'], h['true-client-ip'], h['x-real-ip']];
  for (const v of direct) {
    const ip = String(v || '').trim().replace(/^::ffff:/, '');
    if (isUsableIp(ip)) return ip;
  }
  // X-Forwarded-For — цепочка «клиент, прокси1, прокси2»
  const chain = String(h['x-forwarded-for'] || '').split(',').map((x: string) => x.trim().replace(/^::ffff:/, ''));
  for (const ip of chain) if (isUsableIp(ip)) return ip;

  // Прямое соединение без прокси
  const sock = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  if (sock) return sock;

  // Ничего не нашли: возвращаем первое непустое из цепочки, чтобы
  // хотя бы что-то было видно администратору
  return chain.find(Boolean) || 'unknown';
}

function cacheControlFor(ext: string, hasHashParam: boolean, relPath?: string): string {
  if (relPath && PWA_NO_CACHE.includes(relPath)) return 'no-cache';
  if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.gif', '.avif'].includes(ext)) {
    return 'public, max-age=31536000, immutable'; // 1 год
  }
  if (['.css', '.js'].includes(ext)) {
    // Без метки версии — 'no-cache'. Это НЕ «не кешировать»: копия
    // хранится, но браузер каждый раз спрашивает сервер, изменилась ли
    // она, и на 304 берёт своё. Стоит один короткий запрос.
    //
    // Прежние сутки свежести означали, что после деплоя игроки ещё день
    // видели старый код и не получали новых разделов — при этом ничего
    // не выглядело сломанным, что хуже всего.
    return hasHashParam
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
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
      // Картинки форума приходят в теле запроса (браузер их предварительно
      // уменьшает), поэтому для них лимит выше обычного
      const cap = /\/api\/forum\/(topic|upload)/.test(String(req.url || '')) ? 900 * 1024 : 200 * 1024;
      if (data.length > cap) { req.destroy(); resolve({}); }
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
  // Браузер кодирует не-ASCII символы в пути (кириллица, пробелы):
  // «/img/bosses/Латипко.webp» приходит как «/img/bosses/%D0%9B%D0%B0...».
  // Без декодирования файл не находится (404). Декодируем ДО сборки пути;
  // защита от выхода за public/ ниже (normalize + startsWith) остаётся.
  try { rel = decodeURIComponent(rel); } catch (e) { /* битая %-последовательность — оставляем как есть */ }
  if (rel.indexOf('\0') !== -1) { res.writeHead(400); res.end('Bad request'); return; }
  // ═══ АДМИН-ПАНЕЛЬ ═════════════════════════════════════════════════
  // Раньше панель лежала на предсказуемом /admin и отдавалась КОМУ УГОДНО:
  // API она без прав не открывала, но раскрывала структуру админских
  // запросов и служила приглашением для перебора. Теперь:
  //   • /admin и /admin.html закрыты ВСЕГДА — отвечают 404, как
  //     несуществующая страница, чтобы не подтверждать наличие панели;
  //   • панель доступна по секретному пути из ADMIN_PATH;
  //   • если ADMIN_PATH не задан — работает привычный /admin.
  // Адрес панели: свой из ADMIN_PATH либо стандартный /admin, если он не
  // задан. Секретный путь остаётся более безопасным вариантом (он убирает
  // панель из поля зрения автоматических сканеров), но требовать его
  // настройки нельзя — иначе владелец теряет доступ после переустановки.
  // Путь нормализуем: принимаем и «shtab-x7», и «/shtab-x7», и со слэшем
  // в конце — иначе одна забытая косая черта оставляла бы без доступа.
  let ADMIN_PATH = String(process.env.ADMIN_PATH || '').trim();
  if (ADMIN_PATH && !ADMIN_PATH.startsWith('/')) ADMIN_PATH = '/' + ADMIN_PATH;
  if (ADMIN_PATH.length > 1 && ADMIN_PATH.endsWith('/')) ADMIN_PATH = ADMIN_PATH.slice(0, -1);
  // Защита от самоблокировки: пути, которые заняты игрой, игнорируем —
  // иначе панель перекрыла бы саму игру или её файлы.
  if (['/', '/api', '/index.html', '/js', '/css', '/img'].includes(ADMIN_PATH)) {
    console.warn(`⚠️  ADMIN_PATH=${ADMIN_PATH} занят игрой — маскировка отключена, панель на /admin`);
    ADMIN_PATH = '';
  }
  const isAdminFile = rel === '/admin' || rel === '/admin/' || rel === '/admin.html';
  if (ADMIN_PATH && (rel === ADMIN_PATH || rel === ADMIN_PATH + '/')) {
    rel = '/admin.html';
  } else if (!ADMIN_PATH && isAdminFile) {
    // Секретный путь не настроен — открываем панель по /admin как раньше.
    // Сама панель по-прежнему пускает только по правам, а каждый запрос
    // проверяется по зоне доступа.
    rel = '/admin.html';
  } else if (isAdminFile) {
    // Кто-то стучится в стандартный адрес панели — это либо сканер, либо
    // попытка подбора. Записываем в лог: по нему видно, что вас щупают.
    const ip = clientIp(req);
    console.warn(`🛡  Попытка открыть админ-панель по стандартному адресу ${rel} с ${ip}`);
    // Ответ такой же, как для любого отсутствующего файла — не подтверждаем,
    // что панель вообще существует
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  // Короткие адреса правовых документов: /terms и /privacy. Нужны, чтобы
  // ссылку можно было дать платёжному сервису или магазину приложений
  // без расширения в конце.
  // Картинки тем форума лежат в data/forum, а не в public
  if (rel.startsWith('/forum-img/')) {
    const fsx = require('fs');
    const pth = require('path');
    const safe = pth.basename(rel.slice('/forum-img/'.length));
    const file = pth.join(process.cwd(), 'data', 'forum', safe);
    if (fsx.existsSync(file)) {
      const ext = pth.extname(safe).slice(1).toLowerCase();
      const type = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' });
      res.end(fsx.readFileSync(file));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  if (rel === '/terms' || rel === '/terms/') rel = '/terms.html';
  if (rel === '/privacy' || rel === '/privacy/') rel = '/privacy.html';
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
      // Просим браузер присылать модель устройства и версию системы.
      // Chrome с версии 110 подставляет в обычную строку «Android 10; K»
      // вместо настоящей модели — это защита приватности, и получить
      // модель можно ТОЛЬКО так. Заголовок действует на последующие
      // запросы, поэтому первый вход останется без модели.
      'Accept-CH': 'Sec-CH-UA-Model, Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform',
      'Critical-CH': 'Sec-CH-UA-Model',
      // Картинки разрешаем и с чужих сайтов: администратор указывает
      // ссылку на фото босса, а игроки прикрепляют изображения к темам
      // форума. Прежняя политика (только 'self') молча блокировала их —
      // ссылка сохранялась, но картинка не показывалась.
      // Скрипты и стили по-прежнему только свои: именно они опасны.
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; "
        + "script-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; "
        + "media-src 'self' https:; connect-src 'self'; frame-ancestors 'self';",
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
            ip: clientIp(req),
            // Строка браузера: по ней определяем устройство. Нужна и роутам
            // (регистрация, вход), и учёту активности ниже.
            ua: String(req.headers['user-agent'] || '').slice(0, 400),
            // Подсказки браузера: настоящая модель и версия системы.
            // Кавычки вокруг значений снимаем — браузер шлёт их в кавычках.
            // Сырые заголовки — для диагностики в панели: без них нельзя
            // понять, передаёт ли прокси адрес вообще
            rawHeaders: { ...req.headers, __socket: String((req.socket && req.socket.remoteAddress) || '') },
            hints: {
              model: String(req.headers['sec-ch-ua-model'] || '').replace(/^"|"$/g, '').slice(0, 60),
              platform: String(req.headers['sec-ch-ua-platform'] || '').replace(/^"|"$/g, '').slice(0, 30),
              platformVersion: String(req.headers['sec-ch-ua-platform-version'] || '').replace(/^"|"$/g, '').slice(0, 30),
            },
          };

          // Авторизация (если маршрут не открытый)
          if (!found.opts.open) {
            const token = (req.headers['x-token'] as string) || '';
            const sessions = db.load<Record<string, any>>('sessions', {});
            const users = db.load<Record<string, any>>('users', {});
            const rec = sessions[token];
            // Формат сессии: { u: id, at: время последней активности }.
            // Строка — старый бессрочный формат, переводим на новый.
            const SESSION_TTL = 30 * 24 * 3600 * 1000;
            let userId: string | null = null;
            if (typeof rec === 'string') {
              sessions[token] = { u: rec, at: Date.now() };
              userId = rec;
            } else if (rec && rec.u) {
              if (Date.now() - (rec.at || 0) > SESSION_TTL) {
                delete sessions[token];
                db.save('sessions');
                return sendJson(res, 401, { error: 'Сессия истекла — войдите заново' }, acceptEncoding);
              }
              userId = rec.u;
              // Продлеваем при активности, но пишем не чаще раза в час,
              // чтобы не дёргать сохранение на каждый запрос
              if (Date.now() - (rec.at || 0) > 3600 * 1000) {
                rec.at = Date.now();
                db.save('sessions');
              }
            }
            const user = userId && users[userId];
            if (!user) return sendJson(res, 401, { error: 'Требуется вход в игру' }, acceptEncoding);
            // Срочный бан снимается сам по истечении срока
            if (user.banned && (user as any).banUntil && (user as any).banUntil <= Date.now()) {
              user.banned = false;
              (user as any).banUntil = 0;
              user.banReason = '';
              db.save('users');
            }
            if (user.banned) {
              // Запрос /api/me пропускаем: игрок должен войти и увидеть
              // окно с причиной и сроком, а не пустую ошибку. Всё остальное
              // закрыто — играть он не может.
              const banPayload = {
                banned: true,
                reason: user.banReason || 'Нарушение правил',
                until: (user as any).banUntil || 0,
                bannedAt: (user as any).bannedAt || 0,
                name: user.name,
              };
              if (pathname === '/api/me') {
                return sendJson(res, 200, { banInfo: banPayload, banned: true, name: user.name }, acceptEncoding);
              }
              return sendJson(res, 403, {
                error: 'Ваш аккаунт заблокирован администрацией.'
                  + (user.banReason ? ' Причина: ' + user.banReason : '')
                  + ((user as any).banUntil
                      ? ` Осталось: ${Math.max(1, Math.round(((user as any).banUntil - Date.now()) / 60000))} мин.`
                      : ' Блокировка бессрочная.'),
                banned: true,
                banInfo: banPayload,
              }, acceptEncoding);
            }
            if (found.opts.admin) {
              // Полный доступ определяет модуль ролей: сейчас это только
              // владелец. Старое поле isAdmin само по себе прав не даёт —
              // иначе приостановка полномочий администраторов ничего бы
              // не значила.
              // Доступ определяется ЗОНОЙ запроса: владельцу открыто всё,
              // администратору — все зоны, кроме ресурсов, акций, базы,
              // ролей и настроек сезона. Незнакомый админский адрес
              // считается владельческим — безопасная сторона по умолчанию.
              let allowed = false;
              try {
                const roles = require('../services/roles');
                allowed = roles.canAccessZone(user, roles.zoneOfPath(pathname));
              } catch (e) { allowed = !!user.isAdmin; }
              if (!allowed) {
                // Обычный игрок стучится в админский запрос — это уже
                // осознанная попытка, а не случайность: логируем с именем
                console.warn(`🛡  Игрок «${user.name}» (id ${user.id}, ip ${reqCtx.ip}) пытался вызвать ${found.method} ${pathname}`);
                return sendJson(res, 403, { error: 'Недостаточно прав для этого раздела' }, acceptEncoding);
              }
              // Необязательный белый список адресов: если ADMIN_IPS задан, админские
              // запросы принимаются только с перечисленных адресов. Даже угнанная
              // сессия администратора становится бесполезной с чужого адреса.
              const allowList = String(process.env.ADMIN_IPS || '').split(',').map((x) => x.trim()).filter(Boolean);
              if (allowList.length && !allowList.includes(reqCtx.ip)) {
                console.warn(`🛡  Админский запрос ${pathname} с НЕразрешённого адреса ${reqCtx.ip} (игрок «${user.name}»)`);
                return sendJson(res, 403, { error: 'Доступ с этого адреса запрещён' }, acceptEncoding);
              }
            }
            // Время в игре для расширенной статистики
            try { require('../services/stats').tickPlayTime(user); } catch (e) {}
            // Учёт адреса и устройства на КАЖДОМ запросе, а не только при
            // входе по паролю: игрок с действующим токеном не логинится
            // месяцами, и данных о нём просто не появлялось бы. Внутри
            // стоит защита от лишних записей — см. touch().
            try {
              require('../services/access').touch(user, reqCtx.ip, reqCtx.ua, reqCtx.hints);
            } catch (e) {}
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
