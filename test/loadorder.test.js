// jsdom: порядок загрузки экрана и витрины акций.
//
// Жалоба игрока: на слабом интернете первым появлялся список скидок, а
// сам раздел ещё грузился. Причина была в порядке: запрос акций уходил
// ДО запроса экрана и приходил раньше — полоса успевала отрисоваться
// поверх «Загрузка…».
//
// Здесь проверяется сам порядок, а не внешний вид:
//   • запрос акций начинается только после того, как экран отрисован;
//   • витрина рисуется последней;
//   • содержимое проявляется сверху вниз, и только при переходе между
//     разделами — при перерисовке текущего экрана мигать нечему.
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
let passed = 0; const ok = (n, c) => { assert.ok(c, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

App.me = { id: 'x', name: 'Боец', level: 10, res: { hp: {}, en: {}, am: {} } };
App.renderHeader = () => {};
App.renderPinnedNews = () => { calls.push('pin'); };

let calls = [];
// Экран отвечает не мгновенно — как на медленной связи
App.screens.home = async (c) => {
  calls.push('screen:start');
  await wait(60);
  calls.push('screen:done');
  c.innerHTML = '<div class="card">раз</div><div class="card">два</div><div class="card">три</div>';
};
API.get = async (url) => {
  calls.push('GET ' + url);
  await wait(10);
  if (url === '/api/discounts') {
    return { items: [
      { pct: 50, label: 'Покупка техники', screen: 'units', expiresAt: Date.now() + 3600000 },
      { pct: 50, label: 'Постройки', screen: 'buildings', expiresAt: Date.now() + 3600000 },
    ] };
  }
  return {};
};

(async () => {
  console.log('\n[1] Акции не обгоняют экран');
  location.hash = '#home';
  await App.route();
  await wait(120);
  const screenDone = calls.indexOf('screen:done');
  const salesReq = calls.indexOf('GET /api/discounts');
  ok('экран запрашивается и рисуется первым', screenDone >= 0);
  ok(`запрос акций уходит уже после экрана (${calls.join(' → ')})`,
     salesReq === -1 || salesReq > screenDone);
  ok('пока экран рисуется, полоса акций пуста',
     document.getElementById('sales-strip').innerHTML === '');
  // Переход между разделами сам запускает проявление — без ручного вызова
  ok('после перехода блоки проявляются сами',
     Array.from(document.getElementById('content').children).every((el) => el.classList.contains('rv-in')));

  console.log('\n[2] Витрина появляется следом, сама');
  await wait(700);   // ждём простоя (requestIdleCallback → setTimeout)
  const strip = document.getElementById('sales-strip').innerHTML;
  ok('витрина акций всё-таки нарисована', /Сейчас действуют акции/.test(strip));
  const rows = (strip.match(/<div class="sales-row"/g) || []).length;
  ok(`и в ней обе акции (строк: ${rows})`, rows === 2);

  console.log('\n[3] Содержимое проявляется сверху вниз');
  calls = [];
  App._revealContent(document.getElementById('content'));
  const kids = Array.from(document.getElementById('content').children);
  ok('блокам роздан класс проявления', kids.every((el) => el.classList.contains('rv-in')));
  const delays = kids.map((el) => el.style.animationDelay);
  ok(`задержка растёт сверху вниз: ${delays.join(', ')}`,
     delays[0] === '0ms' && parseInt(delays[1], 10) > 0 && parseInt(delays[2], 10) > parseInt(delays[1], 10));
  await wait(800);
  ok('после анимации класс снимается — перерисовка не мигает',
     kids.every((el) => !el.classList.contains('rv-in')));

  console.log('\n[4] При перерисовке текущего экрана ничего не мигает');
  App._preserveScroll = true;
  await App.route();
  await wait(40);
  ok('содержимое осталось без класса проявления',
     Array.from(document.getElementById('content').children).every((el) => !el.classList.contains('rv-in')));

  console.log('\n[5] Оформление на месте');
  const css = fs.readFileSync(__dirname + '/../public/css/style.css', 'utf8');
  ok('анимация описана в стилях', /@keyframes rv-in/.test(css));
  ok('и уважает отказ от анимаций', /prefers-reduced-motion: no-preference/.test(css));
  const app = fs.readFileSync(__dirname + '/../public/js/app.js', 'utf8');
  ok('витрина акций вызывается через простой', /_whenIdle\(\(\) => App\.renderSalesStrip\(\)\)/.test(app));

  console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
