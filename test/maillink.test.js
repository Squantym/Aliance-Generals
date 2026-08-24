// ═══════════════════════════════════════════════════════════════════
// test/maillink.test.js — ссылка из письма открывается БЕЗ входа
//
// Тот самый баг, из-за которого подтверждение «не работало»: загрузчик
// игры делал безусловное «нет игрока → на экран входа» и затирал адрес
// #verify/<код> ещё до маршрутизации. Игрок жал кнопку в письме, попадал
// на форму входа и читал «подтвердите почту» — то есть подтверждение
// ломалось ровно у тех, ради кого письмо и отправлено. А в браузере, где
// игрок уже был внутри, всё работало, поэтому поломка выглядела
// плавающей и её долго не удавалось поймать.
//
// Проверяем ПОВЕДЕНИЕ в настоящем DOM: подсовываем разные адреса и
// смотрим, куда игра решит пойти. Проверка «в файле есть такая функция»
// тут не годится — она остаётся зелёной, если функцию перестали
// вызывать (на этом я один раз уже попался).
//
// Запуск: node test/maillink.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) {}
if (!JSDOM) { console.log('⛔ jsdom не установлен'); process.exit(1); }

const appSrc = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');

// Поднимаем App в чистом DOM. Всё, что ходит в сеть и в браузерные
// службы, подменяем заглушками: нас интересует одно решение — куда
// игра отправит игрока, у которого нет входа.
function bootWith(hash, hasPlayer) {
  const dom = new JSDOM(`<!doctype html><body><div id="content"></div></body>`, {
    url: 'https://aliance-general.ru/' + hash,
    runScripts: 'outside-only',
  });
  const win = dom.window;
  const visited = [];

  win.UI = { esc: (s) => String(s), toast() {}, confirm: async () => false, prompt: async () => null };
  win.API = {
    token: () => (hasPlayer ? 'tok' : ''),
    setToken() {}, get: async () => ({}), post: async () => ({}),
  };
  win.localStorage.setItem('theme', 'dark');
  // app.js объявляет App через const — в window он сам не попадает
  win.eval(appSrc + '\n;window.App = App;');
  const App = win.App;

  // Подменяем всё, что уводит в сторону от проверяемого решения
  App.setTheme = () => {};
  App._initPwa = () => {};
  App.startOnlineCounter = () => {};
  App._prefetchScreens = () => {};
  App.renderHeader = () => {};
  App.updateCombatBar = () => {};
  App.me = hasPlayer ? { id: '1', name: 'Игрок' } : null;
  const realRoute = App.route.bind(App);
  App.route = () => { visited.push('route:' + win.location.hash); };
  App._handleVerify = (t) => { visited.push('verify:' + t); };
  App._handlePasswordReset = (t) => { visited.push('reset:' + t); };

  return { win, App, visited, realRoute };
}

(async () => {
  console.log('\n── 1. Ссылка подтверждения у НЕвошедшего игрока ──');
  {
    const { win, App, visited } = bootWith('#verify/abc123', false);
    await App.init();
    ok('адрес письма уцелел, а не стал #auth', win.location.hash === '#verify/abc123');
    ok('маршрутизатор получил именно его', visited.some((v) => v === 'route:#verify/abc123'));
    ok('на экран входа не увели', win.location.hash !== '#auth');
  }

  console.log('\n── 2. Ссылка сброса пароля — так же ──');
  {
    const { win, App } = bootWith('#reset/xyz789', false);
    await App.init();
    ok('адрес уцелел', win.location.hash === '#reset/xyz789');
  }

  console.log('\n── 3. Обычный экран у невошедшего по-прежнему ведёт ко входу ──');
  {
    const { win, App } = bootWith('#home', false);
    await App.init();
    ok('увели на вход', win.location.hash === '#auth');
  }
  {
    const { win, App } = bootWith('', false);
    await App.init();
    ok('пустой адрес — тоже на вход', win.location.hash === '#auth');
  }

  console.log('\n── 4. Маршрутизатор доводит адрес до обработчика ──');
  {
    const { App, visited, realRoute } = bootWith('#verify/tok777', false);
    App.route = realRoute;      // настоящий маршрутизатор, не заглушка
    await App.init();
    ok('вызван обработчик подтверждения с кодом из адреса', visited.includes('verify:tok777'));
  }
  {
    const { App, visited, realRoute } = bootWith('#reset/tok888', false);
    App.route = realRoute;
    await App.init();
    ok('и обработчик смены пароля', visited.includes('reset:tok888'));
  }

  console.log('\n── 5. Что считается письмом, а что нет ──');
  const cases = [
    ['#verify/abc', true, 'ссылка подтверждения'],
    ['#reset/abc', true, 'ссылка смены пароля'],
    ['#verify', false, 'слово без кода — не ссылка из письма'],
    ['#home', false, 'обычный экран'],
    ['#auth', false, 'экран входа'],
    ['', false, 'пустой адрес'],
  ];
  for (const [hash, want, label] of cases) {
    const { App } = bootWith(hash, false);
    ok(`${label}: ${want ? 'да' : 'нет'}`, App._isMailLink() === want);
  }

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
