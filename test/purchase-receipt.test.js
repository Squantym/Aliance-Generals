// ═══════════════════════════════════════════════════════════════════
// test/purchase-receipt.test.js — окно покупки и квитанция в почте
//
// Решение: покупка зачисляется СРАЗУ при оплате, а окно с «Забрать» —
// квитанция, которая только закрывается. Если бы выдача ждала кнопку,
// игрок, закрывший вкладку, остался бы без оплаченного, а кнопка стала
// бы местом, где пытаются получить покупку дважды.
//
// Что стережётся:
//  1. Золото и набор на счету сразу, до всякой кнопки.
//  2. Окно в очереди у игрока на сервере: пропустил — дождётся.
//  3. «Забрать» ничего не начисляет: ни свой повтор, ни чужой номер.
//  4. Квитанцию в почте нельзя «забрать» как награду.
//  5. Письмо от «Система»: время покупки, сумма, состав построчно,
//     золото и деньги — с картинками.
//  6. В интерфейсе окно идёт раньше достижений и не перекрывается ими.
//
// Запуск: node test/purchase-receipt.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const offers = require('../dist/src/services/offers');
const payments = require('../dist/src/services/payments');
const rewards = require('../dist/src/services/rewards');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const fails = (n, fn, part) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};
const tick = () => new Promise((r) => setTimeout(r, 15));

(async () => {
  await db.init();
  await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1');
  await auth.register('Покупатель', 'пароль123', 'p@t.ru', 'ru', '1.1.1.2');
  await auth.register('Сосед', 'пароль123', 'n@t.ru', 'ru', '1.1.1.3');
  const by = (n) => Object.values(player.users()).find((x) => x.name === n);
  const O = by('Хозяин'), P = by('Покупатель'), N = by('Сосед');
  O.role = 'owner';
  const nx = [];
  const orders = () => db.load('payments', {});
  const receipts = () => rewards.listFor(P).filter((r) => r.kind === 'receipt');

  console.log('\n[1] Золото на счету сразу, окно — в очереди');
  P.gold = 0;
  const g = payments.createOrder(P, 'gold_2875', nx);
  ok('оплата подтверждена', payments.confirmPayment(g.orderId).ok === true);
  const credited = orders()[g.orderId].creditedGold;
  ok(`золото зачислено до всякой кнопки (${P.gold})`, credited >= 2875 && P.gold === credited);
  const pend = payments.pendingPurchases(P);
  eq('окно покупки в очереди', pend.length, 1);
  ok('в окне — золото с картинкой', pend[0].items.length === 1 && pend[0].items[0].icon === '/img/icons/gold.webp'
     && /2.875 золота/.test(pend[0].items[0].text));
  ok('у окна есть картинка плашки', /\/img\//.test(pend[0].image));
  ok('очередь едет в /api/me — окно откроется на любом экране',
     /pendingPurchases: \(\(\) => \{[\s\S]{0,120}require\('\.\/payments'\)\.pendingPurchases\(user\)/.test(
       fs.readFileSync(path.join(ROOT, 'src/services/player.ts'), 'utf8')));

  console.log('\n[2] Квитанция в почте от «Система»');
  eq('письмо пришло одно', receipts().length, 1);
  const letter = receipts()[0];
  eq('от «Система»', letter.from, 'Система');
  ok('в заголовке — что куплено', /Покупка: 2.875 золота/.test(letter.title));
  ok('время покупки по Москве', /Время покупки: \d\d\.\d\d\.\d{4} \d\d:\d\d \(МСК\)/.test(letter.reason));
  ok('сумма оплаты', /Оплачено: 2.490 ₽/.test(letter.reason));
  ok('номер заказа', letter.reason.includes(g.orderId));
  ok('золото построчно с картинкой', letter.lines.length === 1 && letter.lines[0].icon === '/img/icons/gold.webp');
  eq('квитанция не висит «к получению»', rewards.pendingCount(P), 0);

  console.log('\n[3] Попытки получить покупку второй раз');
  const goldAfter = P.gold;
  fails('квитанцию нельзя «забрать» как награду', () => rewards.claim(P, letter.id, nx), 'квитанция');
  eq('золото не изменилось', P.gold, goldAfter);
  ok('повторное подтверждение оплаты отклонено', payments.confirmPayment(g.orderId).ok === false);
  eq('второго письма нет', receipts().length, 1);
  eq('и второго окна нет', payments.pendingPurchases(P).length, 1);
  payments.ackPurchase(N, g.orderId);
  eq('чужое «Забрать» не трогает очередь покупателя', payments.pendingPurchases(P).length, 1);
  payments.ackPurchase(P, 'выдуманный-номер');
  eq('выдуманный номер — тоже', payments.pendingPurchases(P).length, 1);
  payments.ackPurchase(P, g.orderId);
  eq('«Забрать» закрыло окно', payments.pendingPurchases(P).length, 0);
  eq('и ничего не начислило', P.gold, goldAfter);
  payments.ackPurchase(P, g.orderId);
  eq('повторное нажатие — тоже ничего', P.gold, goldAfter);

  console.log('\n[4] Набор: состав построчно с картинками');
  const offer = offers.adminSave(O, {
    title: 'Штурмовой набор', priceRub: 499,
    items: [{ type: 'gold', qty: 300 }, { type: 'dollars', qty: 5000000 }, { type: 'unit', id: 'ground_10', qty: 5 }, { type: 'xp', qty: 100 }],
  }, nx);
  const g0 = P.gold, d0 = P.dollars;
  const so = offers.orderForRub(P, offer.id, nx);
  payments.confirmPayment(so.orderId);
  ok('золото и деньги из набора — сразу', P.gold === g0 + 300 && P.dollars - d0 === 5000000);
  const po = payments.pendingPurchases(P).find((x) => x.id === so.orderId);
  ok('окно на набор в очереди', !!po && Array.isArray(po.items));
  eq('в окне все 4 позиции', po.items.length, 4);
  ok('золото — с картинкой золота', po.items.some((x) => x.icon === '/img/icons/gold.webp' && /300 золота/.test(x.text)));
  ok('деньги — с картинкой денег', po.items.some((x) => x.icon === '/img/icons/dollar.webp'));
  ok('техника — со своей картинкой', po.items.some((x) => x.icon === '/img/units/ground_10.webp'));
  ok('название набора в окне', /Штурмовой набор/.test(po.title));
  const ol = receipts().find((r) => r.reason.includes(so.orderId));
  ok('квитанция на набор пришла', !!ol && ol.lines.length === 4 && /Набор «Штурмовой набор»/.test(ol.title));
  ok('в квитанции 499 ₽', /Оплачено: 499 ₽/.test(ol.reason));
  offers.adminRemove(O, offer.id, nx);
  eq('набор удалили — окно и письмо остались прежними', payments.pendingPurchases(P).find((x) => x.id === so.orderId).items.length, 4);
  const g2 = payments.createOrder(P, 'gold_100', nx);
  payments.confirmPayment(g2.orderId);
  eq('пропущенные окна копятся: сейчас два', payments.pendingPurchases(P).length, 2);

  console.log('\n[5] Окно в интерфейсе');
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
  UI.toast = () => {};
  global.App = load('public/js/app.js', 'App');
  App.refreshMe = async () => {}; App.rerender = () => {}; App.go = () => {};
  load('public/js/screens/core.js', 'App'); load('public/js/screens/social.js', 'App');
  App.achImg = () => '';
  App.me = {
    pendingPurchases: JSON.parse(JSON.stringify(payments.pendingPurchases(P))),
    pendingAchievements: [{ id: 'a1', name: 'Первое достижение', desc: 'Сделать', threshold: 1, achId: 'x', stage: 1, dollars: 1 }],
  };
  const posted = [];
  API.post = async (url, body) => { posted.push({ url, body }); return { ok: true }; };
  App._processAchQueue();
  let pop = document.getElementById('buy-popup');
  ok('окно покупки открылось', !!pop);
  ok('достижение ждёт, пока окно покупки не закрыто', !document.getElementById('ach-popup'));
  ok('в окне картинки купленного', pop.querySelectorAll('.offer-item img').length >= 3);
  ok('есть «Забрать», крестика нет', !!pop.querySelector('#buy-popup-take') && !pop.querySelector('.ach-popup-x'));
  App._processAchQueue();
  eq('повторный опрос не открывает второе такое же окно', document.querySelectorAll('#buy-popup').length, 1);
  const firstId = App.me.pendingPurchases[0].id;
  pop.querySelector('#buy-popup-take').click();
  await tick();
  ok('«Забрать» сообщило серверу номер заказа', posted.some((p) => p.url === '/api/payments/ack' && p.body.orderId === firstId));
  pop = document.getElementById('buy-popup');
  ok('следующая покупка — следующим окном', !!pop && !document.getElementById('ach-popup'));
  pop.querySelector('#buy-popup-take').click();
  await tick();
  ok('покупки кончились — пришла очередь достижения', !document.getElementById('buy-popup') && !!document.getElementById('ach-popup'));

  console.log('\n[6] Квитанция в почте на экране');
  const c = document.getElementById('content');
  API.get = async (url) => {
    if (url === '/api/rewards') return { rewards: rewards.listFor(P), pending: rewards.pendingCount(P) };
    if (url === '/api/mail') return { threads: [] };
    return {};
  };
  await App.screens.mail(c);
  // Текст, а не разметка: неразрывный пробел в «2 875» разметка отдаёт
  // как &nbsp;, и проверка по innerHTML ложно краснела бы
  const text = c.textContent;
  ok('квитанции видны', /Покупка: 2.875 золота/.test(text) && /Штурмовой набор/.test(text));
  ok('время покупки на месте', /Время покупки:/.test(text));
  ok('золото и деньги с картинками', !!c.querySelector('img[src="/img/icons/gold.webp"]') && !!c.querySelector('img[src="/img/icons/dollar.webp"]'));
  eq('кнопки «Забрать» у квитанций нет', c.querySelectorAll('[data-claim-reward]').length, 0);
  ok('удалить квитанцию можно', c.querySelectorAll('[data-del-reward]').length >= 3);

  console.log('\n[7] Маршрут');
  const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  ok('«Забрать» — отдельный маршрут, и он ничего не выдаёт', /'\/api\/payments\/ack'[^\n]*payments\.ackPurchase\(/.test(routes));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
