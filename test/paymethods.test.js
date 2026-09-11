// ═══════════════════════════════════════════════════════════════════
// test/paymethods.test.js — выбор способа оплаты: СБП, SberPay, T-Pay
//
// Что стережётся:
//  1. Игроку предлагаются ровно три способа, у каждого место под
//     официальный логотип.
//  2. Выбранный способ уходит в ЮKassa как payment_method_data нужного
//     типа (sbp / sberbank / tinkoff_bank) и запоминается в заказе.
//  3. Выдуманный способ не принимается; отказ ЮKassa по способу — понятное
//     сообщение, а не «сломалась оплата».
//  4. Окно выбора: белые плашки одной высоты (брендбук НСПК), закрытие
//     не создаёт заказ.
//  5. Документы: плашек «подключается» нет, способы перечислены.
//
// Запуск: node test/paymethods.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
process.env.YOOKASSA_SHOP_ID = 'shop-pm';
process.env.YOOKASSA_SECRET_KEY = 'test_pm_secret';
process.env.APP_URL = 'https://game.example';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const payments = require('../dist/src/services/payments');
const yk = require('../dist/src/services/yookassa');
let passed = 0;
// Порядок (условие, название) — как во всех вызовах ниже. Первая версия
// объявляла его наоборот, и тест проверял истинность строки названия:
// зелёный при любом коде. Поймали проверками-поломками.
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const tick = () => new Promise((r) => setTimeout(r, 15));

const sent = [];
let rejectMethod = false;
yk.setTransport(async (url, init) => {
  const body = init.body ? JSON.parse(init.body) : null;
  sent.push(body);
  if (rejectMethod) return { status: 400, json: { type: 'error', code: 'invalid_request', description: 'Payment method is not available', parameter: 'payment_method_data' } };
  const id = 'pay_' + sent.length;
  return { status: 200, json: { id, status: 'pending', confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout?orderId=' + id } } };
});

(async () => {
  await db.init();
  await auth.register('Покупатель', 'пароль123', 'pm@t.ru', 'ru', '10.0.2.1');
  const P = Object.values(player.users()).find((x) => x.name === 'Покупатель');
  const nx = [];

  console.log('\n[1] Какие способы предлагаются');
  const m = payments.packages().methods;
  ok(Array.isArray(m) && m.map((x) => x.id).join(',') === 'sbp,sberpay,tpay', `способы: ${m.map((x) => x.id).join(', ')}`);
  ok(/Система быстрых платежей \(СБП\)/.test(m[0].name), 'СБП названа полностью, как в брендбуке');
  ok(m.every((x) => x.logo === '' || /^\/img\/pay\/(sbp|sberpay|tpay)\.(svg|png|webp)$/.test(x.logo)), 'логотип — только официальный файл из img/pay, иначе пусто');
  delete process.env.YOOKASSA_SECRET_KEY;
  ok(payments.packages().methods.length === 0, 'без ключей способов нет');
  process.env.YOOKASSA_SECRET_KEY = 'test_pm_secret';

  console.log('\n[2] Способ уходит в ЮKassa');
  for (const [id, type] of [['sbp', 'sbp'], ['sberpay', 'sberbank'], ['tpay', 'tinkoff_bank']]) {
    const created = payments.createOrder(P, 'gold_100', nx);
    const r = await payments.pay(P, created, nx, { method: id });
    const b = sent[sent.length - 1];
    ok(!!r.payUrl && b.payment_method_data && b.payment_method_data.type === type, `${id} → payment_method_data.type = ${type}`);
    ok(db.load('payments', {})[created.orderId].method === id, `и способ ${id} записан в заказ`);
  }
  const plain = payments.createOrder(P, 'gold_100', nx);
  await payments.pay(P, plain, nx, {});
  ok(!sent[sent.length - 1].payment_method_data, 'без выбора — страница ЮKassa покажет свой список');

  console.log('\n[3] Чужой способ и отказ ЮKassa');
  const fake = payments.createOrder(P, 'gold_100', nx);
  let msg = '';
  try { await payments.pay(P, fake, nx, { method: 'paypal' }); } catch (e) { msg = e.message; }
  ok(/Выберите способ оплаты/.test(msg), 'выдуманный способ не принят');
  rejectMethod = true;
  const off = payments.createOrder(P, 'gold_100', nx);
  msg = '';
  try { await payments.pay(P, off, nx, { method: 'tpay' }); } catch (e) { msg = e.message; }
  ok(/T-Pay сейчас недоступен/.test(msg) && /не списаны/.test(msg), `отказ по способу объяснён: «${msg}»`);
  rejectMethod = false;

  console.log('\n[4] Окно выбора');
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.location = dom.window.location;
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  const load = (f, name) => {
    let code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    code += `\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`;
    eval(code);
    return globalThis.__x;
  };
  global.UI = load('public/js/ui.js', 'UI');
  global.API = load('public/js/api.js', 'API');
  global.App = load('public/js/app.js', 'App');
  load('public/js/screens/core.js', 'App');
  const views = [
    { id: 'sbp', name: 'Система быстрых платежей (СБП)', hint: 'банк', logo: '/img/pay/sbp.svg' },
    { id: 'sberpay', name: 'SberPay', hint: 'сбер', logo: '' },
    { id: 'tpay', name: 'T-Pay', hint: 'т', logo: '' },
  ];
  let pick = App._choosePayMethod(views, '100 золота — 99 ₽');
  await tick();
  const box = document.getElementById('pay-methods');
  ok(!!box && box.querySelectorAll('.pay-method').length === 3, 'три способа в окне');
  ok(box.querySelectorAll('.pay-logo').length === 3, 'у каждого — плашка под логотип');
  ok(!!box.querySelector('.pay-logo img[src="/img/pay/sbp.svg"][loading="eager"]'), 'официальный файл СБП показывается картинкой');
  ok(/SberPay/.test(box.querySelectorAll('.pay-logo')[1].textContent), 'нет файла — на плашке название, а не самодельный знак');
  box.querySelector('[data-pm="sberpay"]').click();
  ok(await pick === 'sberpay' && !document.getElementById('pay-methods'), 'выбор возвращает способ и закрывает окно');
  pick = App._choosePayMethod(views, '');
  await tick();
  document.getElementById('pm-x').click();
  ok(await pick === null, 'закрыл окно — заказа не будет');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  ok(/\.pay-logo \{[^}]*background: #fff/.test(css) && /\.pay-logo img \{ height: 28px/.test(css),
     'белая плашка и одна высота логотипов для всех способов');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(/'\/api\/payments\/create', \{ packageId: btn\.dataset\.buyPkg, method \}/.test(core)
     && /'\/api\/offers\/order', \{ offerId: b\.dataset\.offerRub, method \}/.test(core), 'и пакет золота, и набор уходят с выбранным способом');

  console.log('\n[5] Документы');
  const pay = fs.readFileSync(path.join(ROOT, 'public/payments.html'), 'utf8');
  const terms = fs.readFileSync(path.join(ROOT, 'public/terms.html'), 'utf8');
  ok(!/Приём платежей подключается/.test(pay + terms), 'плашек «подключается» нет');
  ok(/1\.3\. Способы оплаты/.test(pay) && /QR-коду/.test(pay), 'способы оплаты, включая QR-код СБП, в Правилах платежей');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
