/* ===================================================================
 * sw.js — Service Worker «Альянс Генералов»
 *
 * СТРАТЕГИЯ (важно понимать перед правками):
 *  • /api/*            — НИКОГДА не кешируем. Игра живая, данные всегда с сервера.
 *  • навигация (HTML)  — network-first. index.html отдаётся с no-cache и содержит
 *                        свежие ?v=хэш для CSS/JS. Если сети нет — offline.html.
 *  • /js/, /css/       — cache-first. Безопасно: в URL есть ?v=хэш от содержимого
 *                        (см. src/core/assetHash.ts). Меняется файл → меняется URL.
 *  • /img/, шрифты     — cache-first (контент иммутабельный).
 *
 * KILL SWITCH: если что-то пойдёт не так на проде — ставим в /sw-config.json
 * {"kill": true}, и воркер сам себя удаляет, чистит кеши и перезагружает клиентов.
 * Файл отдаётся с no-cache, поэтому флаг долетает до всех.
 * =================================================================== */

const SW_VERSION   = 'v1';
const SHELL_CACHE  = 'ag-shell-' + SW_VERSION;
const ASSET_CACHE  = 'ag-assets-' + SW_VERSION;
const OFFLINE_URL  = '/offline.html';
const KILL_URL     = '/sw-config.json';
const KILL_CHECK_MS = 10 * 60 * 1000;   // проверяем флаг не чаще раза в 10 минут

// Что кладём в кеш сразу при установке (минимум — оболочка офлайна)
const PRECACHE = [
  OFFLINE_URL,
  '/img/pwa/icon-192.png',
  '/img/pwa/icon-512.png',
];

let lastKillCheck = 0;

// ── Установка ─────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Не валим установку, если какой-то файл не скачался
    await Promise.all(PRECACHE.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();   // новая версия активируется сразу
  })());
});

// ── Активация: чистим старые кеши и забираем клиентов ─────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (await checkKill()) return;   // если стоит флаг — самоудалились
    const names = await caches.keys();
    await Promise.all(names.map((n) => {
      if (n.startsWith('ag-') && n !== SHELL_CACHE && n !== ASSET_CACHE) return caches.delete(n);
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

// ── Проверка kill switch ──────────────────────────────────────────
async function checkKill() {
  try {
    const res = await fetch(KILL_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return false;
    const cfg = await res.json();
    if (cfg && cfg.kill === true) {
      await selfDestruct();
      return true;
    }
  } catch (e) { /* нет сети — просто живём дальше */ }
  return false;
}

async function selfDestruct() {
  try {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('ag-')).map((n) => caches.delete(n)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) c.navigate(c.url);   // перезагружаем вкладки на «чистую» версию
  } catch (e) {}
}

// ── Перехват запросов ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Только GET и только свой origin. Остальное — мимо воркера.
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  const p = url.pathname;

  // API живой игры и служебные файлы воркера — всегда напрямую в сеть
  if (p.startsWith('/api/') || p === '/sw.js' || p === KILL_URL || p === '/manifest.json') return;

  // Навигация (открытие страницы) — network-first, офлайн-заглушка в запасе
  if (req.mode === 'navigate') {
    event.respondWith(navigationHandler(req));
    return;
  }

  // Статика с хэшем в URL и картинки/шрифты — cache-first
  if (/^\/(?:js|css|img|fonts)\//.test(p) || p === '/favicon.png' || p === '/favicon.svg') {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Остальное — как обычно
});

async function navigationHandler(req) {
  maybeCheckKill();
  try {
    const fresh = await fetch(req);
    return fresh;
  } catch (e) {
    // Сети нет: пробуем отдать сохранённую страницу, иначе офлайн-экран
    const cached = await caches.match(req);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('Нет соединения', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    // Кешируем только успешные полноценные ответы своего origin
    if (res && res.status === 200 && res.type === 'basic') {
      const cache = await caches.open(ASSET_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    const any = await caches.match(req, { ignoreSearch: true });
    if (any) return any;
    throw e;
  }
}

// Ненавязчивая проверка флага (не чаще раза в 10 минут)
function maybeCheckKill() {
  const t = Date.now();
  if (t - lastKillCheck < KILL_CHECK_MS) return;
  lastKillCheck = t;
  checkKill();
}

// ── Push-уведомления ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) { d = { title: 'Альянс Генералов', body: event.data ? event.data.text() : '' }; }

  event.waitUntil(self.registration.showNotification(d.title || 'Альянс Генералов', {
    body: d.body || '',
    icon: '/img/pwa/icon-192.png',
    badge: '/img/pwa/icon-192.png',
    tag: d.tag || 'ag',
    renotify: true,
    vibrate: [80, 40, 80],
    data: { url: d.url || '/' },
  }));
});

// Клик по уведомлению — открываем игру на нужном экране
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.indexOf(self.location.origin) === 0) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(url); } catch (e) {} }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

// ── Сообщения от страницы ─────────────────────────────────────────
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'KILL') event.waitUntil(selfDestruct());
});
