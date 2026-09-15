// ═══════════════════════════════════════════════════════════════════
// test/perfclient.test.js — сколько раз игра ходит на сервер
//
// Замер показал: сервер отвечает на любой запрос за 0.3–2 мс, а ждёт
// игрок сеть. Значит выигрыш не в скорости обработчиков, а в ЧИСЛЕ
// поездок. Здесь они и считаются.
//
// Что стережётся:
//  1. Переход между разделами не повторяет /api/me, если ответ получен
//     только что: раньше каждый экран ждал его заново.
//  2. Любое действие игрока сбрасывает этот кэш — списанное золото
//     обязано появиться в шапке сразу, а не через пару секунд.
//  3. Запрос экрана и /api/me уходят ОДНОВРЕМЕННО, а не по очереди.
//  4. Несколько одновременных вызовов склеиваются в один запрос.
//  5. Клуб опрашивается с отступом: пусто — раз в полминуты, идёт
//     партия — раз в пять секунд.
//
// Запуск: node test/perfclient.test.js
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert'); const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM(`<!DOCTYPE html><body>
  <header id="header"></header><div id="pin-news"></div>
  <main id="content"></main><div id="sales-strip"></div><div id="toasts"></div>
</body>`, { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location,
  requestAnimationFrame: (fn) => setTimeout(fn, 0) });
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API');
UI.toast = () => {};
global.App = load('public/js/app.js', 'App');
let passed = 0;
const ok = (n, c) => { assert.ok(c, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Сеть: считаем каждый запрос и отвечаем не мгновенно — как на телефоне
let calls = [];
let rtt = 30;
const ME = { id: 'x', name: 'Боец', level: 10, res: { hp: {}, en: {}, am: {} }, gold: 100 };
// Подменяем САМЫЙ НИЖНИЙ слой — сам поход в сеть. Выше него остаётся
// настоящий код api.js: и склейка повторных нажатий, и сброс свежести
// после действия. Подмени мы get/post целиком — проверяли бы заглушку.
API.req = async (method, url) => {
  calls.push(method + ' ' + url);
  await wait(rtt);
  if (url === '/api/me') return JSON.parse(JSON.stringify(ME));
  if (url === '/api/club/live') return App.__clubAnswer || { kind: 'none' };
  if (url === '/api/discounts') return { items: [] };
  return {};
};
App.renderHeader = () => {};
App.renderPinnedNews = () => {};
App.updateCombatBar = () => {};

(async () => {
  console.log('\n[1] Повторный переход не ходит за /api/me заново');
  App._meAt = 0; App.me = null; calls = [];
  await App.refreshMe();
  eq('первый заход спрашивает сервер', calls.filter((c) => c === 'GET /api/me').length, 1);
  await App.refreshMe();
  await App.refreshMe();
  eq('следующие два — нет', calls.filter((c) => c === 'GET /api/me').length, 1);
  ok('данные при этом есть', !!App.me && App.me.name === 'Боец');
  ok('окно свежести короткое — секунды, не минуты',
     App.ME_TTL_MS >= 1000 && App.ME_TTL_MS <= 5000);

  console.log('\n[2] Действие игрока сбрасывает кэш');
  calls = [];
  await API.post('/api/units/buy', { unitId: 'x', qty: 1 });
  await App.refreshMe();
  eq('после покупки данные перечитываются', calls.filter((c) => c === 'GET /api/me').length, 1);
  // И принудительное обновление всегда идёт на сервер
  calls = [];
  await App.refreshMe(true);
  eq('refreshMe(true) спрашивает сервер всегда', calls.filter((c) => c === 'GET /api/me').length, 1);

  console.log('\n[3] Экран и /api/me запрашиваются одновременно');
  App._meAt = 0; App.me = null; calls = [];
  const t0 = Date.now();
  const [, data] = await Promise.all([App.refreshMe(), API.get('/api/units')]);
  const spent = Date.now() - t0;
  ok('оба запроса ушли', calls.includes('GET /api/me') && calls.includes('GET /api/units'));
  ok(`ждали один круг, а не два (${spent} мс при задержке ${rtt} мс)`, spent < rtt * 1.8);
  ok('данные экрана получены', !!data);
  // И так во всех экранах: последовательной пары не осталось
  const screens = fs.readdirSync(__dirname + '/../public/js/screens');
  let seq = [];
  for (const f of screens) {
    const lines = fs.readFileSync(__dirname + '/../public/js/screens/' + f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (!/^\s*await App\.refreshMe\(\);\s*$/.test(l)) return;
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || /^\s*\/\//.test(lines[j]))) j++;
      if (/^\s*const \w+ = await API\.get\(/.test(lines[j] || '')) seq.push(f + ':' + (i + 1));
    });
  }
  ok(seq.length ? `осталось пар: ${seq.join(', ')}` : 'ни в одном экране не осталось «сначала me, потом своё»',
     seq.length === 0);

  console.log('\n[4] Одновременные вызовы склеиваются');
  App._meAt = 0; App.me = null; calls = [];
  await Promise.all([App.refreshMe(), App.refreshMe(), App.refreshMe()]);
  eq('три вызова — один запрос', calls.filter((c) => c === 'GET /api/me').length, 1);

  console.log('\n[5] Клуб опрашивается с отступом');
  ok('частый ритм — пять секунд', App.CLUB_FAST_MS === 5000);
  ok('редкий — полминуты', App.CLUB_SLOW_MS === 30000);
  App._clubBarKind = null;
  App._clubSchedule();
  const slow = App._clubTimer && App._clubTimer._idleTimeout;
  eq('пусто — следующий опрос через 30 с', slow, App.CLUB_SLOW_MS);
  App._clubBarKind = 'match';
  App._clubSchedule();
  const fast = App._clubTimer && App._clubTimer._idleTimeout;
  eq('идёт партия — через 5 с', fast, App.CLUB_FAST_MS);
  clearTimeout(App._clubTimer);
  const market = fs.readFileSync(__dirname + '/../public/js/screens/market.js', 'utf8');
  ok('вход в клуб возвращает частый опрос сразу', /App\.clubWake\(\)/.test(market));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
