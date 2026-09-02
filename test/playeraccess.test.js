// ═══════════════════════════════════════════════════════════════════
// test/playeraccess.test.js — адреса и устройства в досье игрока
//
// Раздел был в прежней панели (Admin.showAccess) и потерялся в новой:
// осталась только таблица открытых прямо сейчас сессий. Ручка
// /api/admin/access/:id и данные всё это время были на месте — их
// просто некому было показать, и на вопрос «кто с какого адреса
// заходит» ответить было нечем.
//
// Отдельно стережётся подсказка про nginx. Если сервер не передаёт игре
// адрес посетителя, у ВСЕХ игроков в панели будет один и тот же
// локальный адрес. Это не ошибка игры, и владелец должен узнать об этом
// из самой панели, а не искать причину в коде неделю.
//
// Запуск: node test/playeraccess.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) {}
if (!JSDOM) { console.log('⛔ jsdom не установлен'); process.exit(1); }

const ESC = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CARD = {
  id: 'u1', name: 'Боец', level: 12, flag: '', online: false, lastSeen: Date.now(),
  roleLabel: 'игрок', createdAt: Date.now(), email: 'b@t.ru',
  dollars: 0, gold: 0, recent: [], can: {},
};

function access(ips, devices) {
  return {
    id: 'u1', name: 'Боец', level: 12,
    registered: { at: Date.now() - 86400000, ip: ips[0] ? ips[0].ip : '—', device: 'Chrome / Windows' },
    last: { at: Date.now(), ip: ips[0] ? ips[0].ip : '—', device: 'Chrome / Windows' },
    ips, devices, related: [], characters: [], sessions: [],
  };
}

async function boot(accessData) {
  const dom = new JSDOM('<!doctype html><body><div id="c"></div></body>',
    { url: 'https://aliance-general.ru/admin', runScripts: 'outside-only' });
  const win = dom.window;
  win.UI = { esc: ESC, toast: () => {} };
  win.API = {
    get: async (url) => {
      if (url.indexOf('/api/admin/access/') === 0) return accessData;
      return CARD;
    },
  };
  win.A2 = { screens: {}, crumbs: () => {}, refresh: () => {} };
  win.A2Router = { go: () => {}, build: () => '#' };
  win.Admin = { renderGrantForm: () => {} };
  win.eval(fs.readFileSync(path.join(ROOT, 'public/js/admin2/player.js'), 'utf8'));
  const el = win.document.getElementById('c');
  await win.A2.screens.player(el, { arg: 'u1' });
  // Адреса грузятся отдельным запросом уже после отрисовки карточки.
  await new Promise((r) => setTimeout(r, 30));
  return { win, el };
}

(async () => {
  console.log('\n── 1. Раздел вообще есть ──');
  const real = [
    { ip: '185.75.189.217', count: 12, firstAt: Date.now() - 8e8, lastAt: Date.now() },
    { ip: '95.24.11.3', count: 3, firstAt: Date.now() - 4e8, lastAt: Date.now() - 1e7 },
  ];
  const devs = [{
    key: 'k1', label: 'Chrome / Windows', count: 15, isReg: true,
    firstAt: Date.now() - 8e8, lastAt: Date.now(), ips: [{ ip: '185.75.189.217', count: 12 }],
  }];
  let { win, el } = await boot(access(real, devs));
  const box = () => win.document.getElementById('pl-access');
  ok('карточка адресов на странице', !!box());
  ok('заголовок на месте', /Адреса и устройства/.test(box().innerHTML));
  ok('загрузка сменилась данными', !/Загружаю/.test(box().innerHTML));

  console.log('\n── 2. Адреса показаны с числом входов ──');
  ok('первый адрес виден', /185\.75\.189\.217/.test(box().innerHTML));
  ok('второй тоже', /95\.24\.11\.3/.test(box().innerHTML));
  ok('число входов показано', />12</.test(box().innerHTML));
  ok('в заголовке их количество', /Адреса \(2\)/.test(box().innerHTML));

  console.log('\n── 3. Устройства и их адреса ──');
  ok('устройство показано', /Chrome \/ Windows/.test(box().innerHTML));
  ok('отмечено, с какого регистрировались', /регистрация/.test(box().innerHTML));
  ok('адреса устройства перечислены', /×12/.test(box().innerHTML));

  console.log('\n── 4. Подсказки про nginx нет, когда адреса настоящие ──');
  ok('лишнего предупреждения нет', !/a2-warn/.test(box().innerHTML));

  console.log('\n── 5. Все адреса локальные — панель объясняет причину ──');
  // Главная проверка файла. Без подсказки владелец видит одинаковый
  // адрес у всех и ищет ошибку в игре, а она в конфигурации сервера.
  ({ win, el } = await boot(access(
    [{ ip: '127.0.0.1', count: 40, firstAt: Date.now(), lastAt: Date.now() }], [])));
  const html = win.document.getElementById('pl-access').innerHTML;
  ok('предупреждение показано', /a2-warn/.test(html));
  ok('названы нужные заголовки', /X-Real-IP/.test(html) && /X-Forwarded-For/.test(html));
  ok('сказано, что дело в nginx', /nginx/i.test(html));

  console.log('\n── 6. Пустые данные не роняют страницу ──');
  ({ win, el } = await boot(access([], [])));
  const empty = win.document.getElementById('pl-access').innerHTML;
  ok('раздел отрисован', /Адреса и устройства/.test(empty));
  ok('сказано, что пусто', /пуст/i.test(empty));
  ok('и ложного предупреждения нет', !/a2-warn/.test(empty));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
