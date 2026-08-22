// ═══════════════════════════════════════════════════════════════════
// test/timers.test.js — секундные отсчёты не должны копиться
//
// Ошибка: окно боя перерисовывается раз в 4 секунды, и на каждой
// отрисовке заводился НОВЫЙ секундный таймер, а старый не гасился.
// За час боя их набиралось под тысячу: все писали в одно и то же поле
// своё значение (цифра прыгала), вкладка ела процессор и тормозила
// тем сильнее, чем дольше открыта.
//
// Проверяем поведение: после десяти отрисовок живым должен остаться
// РОВНО ОДИН отсчёт.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { JSDOM } = require(ROOT + '/node_modules/jsdom');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

function harness(html) {
  const dom = new JSDOM(html, { url: 'https://x.test/', runScripts: 'outside-only' });
  const w = dom.window;
  global.window = w; global.document = w.document;
  const timers = [];
  global.setInterval = (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms, alive: true }); return id; };
  global.clearInterval = (id) => { const t = timers.find((x) => x.id === id); if (t) t.alive = false; };
  global.setTimeout = () => 0;
  global.requestAnimationFrame = (fn) => { fn(); return 0; };
  global.localStorage = w.localStorage;
  global.location = w.location;
  global.navigator = w.navigator;
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  eval(fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8').replace(/^const UI = /m, 'UI = '));
  UI.toast = () => {};
  global.UI = UI; w.UI = UI;
  global.API = { token: () => 't', setToken() {}, get: async () => ({}), post: async () => ({}) };
  w.API = global.API;
  let App;
  eval(fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8').replace(/^const App = /m, 'App = '));
  global.App = App; w.App = App;
  App.rerender = () => {}; App.refreshMe = async () => {};
  const alive = () => timers.filter((t) => t.alive).length;
  return { App, timers, alive, w };
}

console.log('\n[1] Окно боя легиона: отсчёт один, сколько бы ни было отрисовок');
{
  const h = harness('<div id="bw-timer">10:00</div>');
  const b = { phase: 'prep', prepSecsLeft: 600, timeLeft: 3600 };
  h.App._startBattleWindowTimer(b);
  ok(h.alive() === 1, `после первой отрисовки живых отсчётов: ${h.alive()}`);
  // Окно опрашивается раз в 4 секунды — имитируем 10 опросов подряд
  for (let i = 0; i < 10; i++) h.App._startBattleWindowTimer(b);
  ok(h.alive() === 1, `после ещё десяти отрисовок живых отсчётов: ${h.alive()} (должен быть 1)`);
  ok(h.timers.length === 11, `таймеров всего заводилось: ${h.timers.length}, из них погашено ${h.timers.length - h.alive()}`);

  // И тикает именно последний — с актуальным временем с сервера
  const last = h.timers[h.timers.length - 1];
  last.fn();
  ok(h.w.document.getElementById('bw-timer').textContent === UI.fmtTimer(599),
     'живой отсчёт показывает время, пришедшее с сервера');
}

console.log('\n[2] Отсчёт гаснет сам, когда окно закрыли');
{
  const h = harness('<div id="bw-timer">01:00</div>');
  h.App._startBattleWindowTimer({ phase: 'active', timeLeft: 60 });
  h.w.document.body.innerHTML = '';          // игрок закрыл окно боя
  h.timers[h.timers.length - 1].fn();        // следующий тик
  ok(h.alive() === 0, 'после закрытия окна отсчёт погашен');
}

// ── Про главный экран и вкладку легиона ────────────────────────────
// Там та же ошибка и та же правка (App._lcgTimer, App._legionBattleTimer),
// но честного теста на них здесь нет: оба отсчёта появляются только когда
// с сервера пришли конкретные данные (идёт вызов / идёт бой легиона), а
// подделать их из этой обвязки — значит проверять свою же подделку.
// Написать «экран загрузился ✅» и считать это проверкой было бы обманом.

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
