// ═══════════════════════════════════════════════════════════════════
// test/pay-speed.test.js — путь до страницы оплаты (jsdom, 18.09.2026)
//
// ЧТО БЫЛО. Игрок жаловался на долгое открытие окна оплаты и QR-кода.
// Наша часть отвечает за 1–3 мс (заказ подписывается на месте, в кассу
// никто не ходит), время уходит на стороне кассы. Но кнопка при этом
// молчала: её жали второй раз и заводили второй заказ.
//
// Заранее соединяться с кассой владелец запретил (18.09.2026) — никаких
// preconnect к чужому домену в игре быть не должно.
//
// Что стережётся:
//  1. Кнопка «Купить» на время перехода отключается и говорит об этом.
//  2. Повторное нажатие второго заказа не создаёт.
//  3. Отказ сервера показан, кнопка снова рабочая.
//  4. Игра сама не соединяется с кассой до нажатия «Купить».
//
// Запуск: node test/pay-speed.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { JSDOM, VirtualConsole } = require('jsdom');
// jsdom не умеет уходить на другой адрес и шумит об этом — нам это не мешает
const vc = new VirtualConsole();
vc.on('jsdomError', () => {});
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/', virtualConsole: vc });
Object.assign(global, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(path.join(ROOT, f), 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI');
global.API = load('public/js/api.js', 'API');
const toasts = [];
UI.toast = (t) => toasts.push(t); UI.confirm = async () => true;
global.OfferCard = load('public/js/offercard.js', 'OfferCard');
dom.window.OfferCard = global.OfferCard;
global.App = load('public/js/app.js', 'App');
App.refreshMe = async () => {}; App.rerender = () => {}; App.go = () => {};
load('public/js/screens/core.js', 'App');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const wait = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const links = () => [...document.head.querySelectorAll('link')].filter((l) => /robokassa/.test(l.href));

const PACKAGES = { packages: [{ id: 'gold_100', gold: 100, priceRub: 99, label: '100 золота' }], enabled: true, promos: [], methods: [], payNote: '' };
const OFFERS = { offers: [{ id: 'of1', title: 'Набор', emoji: '🎁', items: [], priceGold: 0, priceRub: 199, canBuyGold: false, canBuyRub: true }] };

(async () => {
  App.me = { id: 'u1', name: 'Игрок', level: 10, gold: 0, dollars: 0, vip: false, legion: null, res: {} };
  const c = document.getElementById('content');
  const posts = [];
  let reply = { orderId: 'o1', payUrl: 'https://auth.robokassa.ru/Merchant/Index.aspx?x=1' };
  API.get = async (u) => (u === '/api/payments/packages' ? JSON.parse(JSON.stringify(PACKAGES))
    : u === '/api/payments/orders' ? { orders: [] }
    : u === '/api/offers' ? JSON.parse(JSON.stringify(OFFERS)) : {});
  API.post = async (u, b) => { posts.push({ u, b }); if (reply instanceof Error) throw reply; return JSON.parse(JSON.stringify(reply)); };

  console.log('\n[1] Кнопка «Купить» отвечает сразу');
  await App.screens.bank(c, 'gold');
  await wait();
  const btn = c.querySelector('[data-buy-pkg]');
  ok('кнопка найдена', !!btn);
  const p = btn.onclick();
  ok('на время перехода — «Открываем оплату…»', /Открываем оплату/.test(btn.innerHTML));
  ok('и она отключена', btn.disabled === true);
  btn.onclick();
  await p; await wait();
  ok(`повторное нажатие второго заказа не создало (${posts.length})`, posts.length === 1);
  ok('заказ ушёл на создание', posts[0].u === '/api/payments/create' && posts[0].b.packageId === 'gold_100');

  console.log('\n[3] Отказ сервера');
  posts.length = 0; toasts.length = 0;
  reply = new Error('Слишком много неоплаченных заказов за час');
  await App.screens.bank(c, 'gold');
  await wait();
  const btn2 = c.querySelector('[data-buy-pkg]');
  await btn2.onclick();
  await wait();
  ok('причина показана игроку', toasts.some((t) => /неоплаченных заказов/.test(t)));
  ok('кнопка снова рабочая', btn2.disabled === false && /Купить/.test(btn2.innerHTML));

  console.log('\n[4] Наборы за рубли — так же');
  posts.length = 0;
  reply = { orderId: 'o2', payUrl: 'https://auth.robokassa.ru/Merchant/Index.aspx?x=2' };
  await App.screens.bank(c, 'offers');
  await wait();
  const ob = c.querySelector('[data-offer-rub]');
  ok('кнопка набора найдена', !!ob);
  const p2 = ob.onclick();
  ok('на время перехода — «Открываем оплату…»', /Открываем оплату/.test(ob.innerHTML) && ob.disabled === true);
  ob.onclick();
  await p2; await wait();
  ok(`второго заказа нет (${posts.length})`, posts.length === 1 && posts[0].u === '/api/offers/order');

  console.log('\n[5] Сами к кассе не ходим');
  // Владелец запретил заранее соединяться с Робокассой: игра открывает
  // её адрес только тогда, когда игрок сам нажал «Купить».
  ok('в банке не появилось ни одной ссылки на кассу', links().length === 0);
  const inGame = ['public/index.html', 'public/js/app.js', 'public/js/screens/core.js']
    .filter((f) => /rel=['"]?(preconnect|dns-prefetch)|preconnect|dns-prefetch/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))
      && /robokassa/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok(`ни preconnect, ни dns-prefetch к кассе${inGame.length ? ': ' + inGame.join(', ') : ''}`, inGame.length === 0);

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
