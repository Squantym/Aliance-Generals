// ═══════════════════════════════════════════════════════════════════
// test/donatebonus.test.js — бонусы к покупкам за рубли
//
// Что стережётся:
//  1. Акцию собирает только право «Акции», мусор не сохраняется.
//  2. «Первое пополнение» — только первая оплаченная покупка, даже если
//     два заказа оформлены одновременно.
//  3. «Один раз», «до N раз в день» (с новыми сутками — снова), «каждая».
//  4. Ускорение опыта реально удваивает опыт, повторная покупка продлевает
//     срок, а не складывает проценты.
//  5. Обещанное до оплаты исполняется: удалённая после заказа акция всё
//     равно начисляется; не начавшаяся и закончившаяся — не видны.
//  6. Опыт «к наборам» не цепляется к пакетам золота и наоборот.
//  7. Витрина, квитанция, штаб и оферта.
//
// Запуск: node test/donatebonus.test.js   (после npm run build)
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
const payments = require('../dist/src/services/payments');
const offers = require('../dist/src/services/offers');
const rewards = require('../dist/src/services/rewards');
const DB = require('../dist/src/services/donateBonus');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const fails = (fn, part, n) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};

(async () => {
  await db.init();
  let ipN = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `db${++ipN}@t.ru`, 'ru', '10.0.3.' + ipN);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.gold = 0;
    return p;
  };
  const O = await reg('Хозяин'); O.role = 'owner';
  const Pl = await reg('Игрок');
  const nx = [];
  const clearPromos = () => { const s = db.load('donateBonuses', {}); for (const k of Object.keys(s)) delete s[k]; };
  const buy = (user, pkg) => { const o = payments.createOrder(user, pkg || 'gold_100', nx); return o.orderId; };
  const order = (id) => db.load('payments', {})[id];

  console.log('\n[1] Кто и что может сохранить');
  fails(() => DB.adminSave(Pl, { title: 'x', kind: 'gold', pct: 100, limit: 'first' }, nx), 'Акции', 'игроку — нельзя');
  fails(() => DB.adminSave(O, { title: 'x', kind: 'gold', pct: 0, limit: 'first' }, nx), 'Процент', 'процент 0 не принят');
  fails(() => DB.adminSave(O, { title: 'x', kind: 'gold', pct: 900, limit: 'first' }, nx), 'Процент', 'процент 900 не принят');
  fails(() => DB.adminSave(O, { title: 'x', kind: 'xp', pct: 100, limit: 'every', hours: 0 }, nx), 'Срок ускорения', 'опыт без срока не принят');
  fails(() => DB.adminSave(O, { title: 'x', kind: 'gold', pct: 100, limit: 'daily', perDay: 0 }, nx), 'Раз в день', '«в день» без числа не принят');
  fails(() => DB.adminSave(O, { title: '', kind: 'gold', pct: 100, limit: 'first' }, nx), 'Назовите', 'без названия не принят');
  fails(() => DB.adminSave(O, { title: 'x', kind: 'gold', pct: 100, limit: 'first', startAt: Date.now() + 5000, endAt: Date.now() }, nx), 'раньше', 'конец раньше начала не принят');
  const g = DB.adminSave(O, { title: 'Первое пополнение', kind: 'gold', pct: 100, limit: 'first', target: 'offers' }, nx).promo;
  ok(g.target === 'gold' && g.live === true, 'бонус к золоту всегда относится к пакетам золота');

  console.log('\n[2] Первое пополнение');
  const A = await reg('Первый');
  const view = payments.packages(A);
  ok(view.promos.length === 1 && view.promos[0].available && /за первое пополнение/.test(view.promos[0].text), 'игрок видит акцию до оплаты');
  ok(payments.packages().promos.length === 0, 'без игрока витрина акций не показывает');
  const a1 = buy(A);
  ok(order(a1).promos.length === 1, 'условия ушли в заказ');
  payments.confirmPayment(a1);
  ok(A.gold === 200 && order(a1).creditedGold === 200, `100 золота + 100% = ${A.gold}`);
  const letter = rewards.listFor(A).find((r) => r.kind === 'receipt');
  ok(letter && letter.lines.some((l) => /Бонус «Первое пополнение»: \+100 золота/.test(l.text)), 'бонус виден в квитанции');
  ok(order(a1).promoApplied.length === 1 && order(a1).promoApplied[0].gold === 100, 'и записан в заказ');
  const card = payments.adminGet(O, a1);
  ok(card.promos.length === 1 && card.promos[0].title === 'Первое пополнение', 'владелец видит бонус в карточке заказа «Платежи»');
  ok(/Бонусы к покупке/.test(fs.readFileSync(path.join(ROOT, 'public/js/admin2/payments.js'), 'utf8')), 'и карточка его рисует');
  ok(payments.packages(A).promos.length === 1 && !payments.packages(A).promos[0].available, 'после покупки акция игроку недоступна');
  const a2 = buy(A);
  payments.confirmPayment(a2);
  ok(A.gold === 300, 'вторая покупка — без бонуса');
  const B = await reg('Торопыга');
  const b1 = buy(B), b2 = buy(B);
  payments.confirmPayment(b1); payments.confirmPayment(b2);
  ok(B.gold === 300, `два заказа одновременно — бонус только к первому (${B.gold})`);

  console.log('\n[3] Один раз, до N раз в день, каждая покупка');
  clearPromos();
  DB.adminSave(O, { title: 'Разовый', kind: 'gold', pct: 50, limit: 'once' }, nx);
  const C = await reg('Разовый');
  payments.confirmPayment(buy(C)); payments.confirmPayment(buy(C));
  ok(C.gold === 150 + 100, `один раз: +50 к первой, вторая без бонуса (${C.gold})`);
  clearPromos();
  const daily = DB.adminSave(O, { title: 'Дважды в день', kind: 'gold', pct: 10, limit: 'daily', perDay: 2 }, nx).promo;
  const D = await reg('Ежедневный');
  for (let i = 0; i < 3; i++) payments.confirmPayment(buy(D));
  ok(D.gold === 110 + 110 + 100, `два раза в день с бонусом, третий без (${D.gold})`);
  ok(payments.packages(D).promos[0].leftToday === 0, 'на сегодня исчерпан');
  D.donateBonus.used[daily.id].day = '2000-01-01';          // наступили новые сутки
  payments.confirmPayment(buy(D));
  ok(D.gold === 320 + 110, `новые сутки — бонус снова (${D.gold})`);
  clearPromos();
  DB.adminSave(O, { title: 'Всегда', kind: 'gold', pct: 20, limit: 'every' }, nx);
  const E = await reg('Постоянный');
  payments.confirmPayment(buy(E)); payments.confirmPayment(buy(E));
  ok(E.gold === 240, 'каждая покупка — с бонусом');

  console.log('\n[4] Ускорение опыта');
  clearPromos();
  DB.adminSave(O, { title: 'Опыт ×2', kind: 'xp', pct: 100, limit: 'daily', perDay: 5, hours: 1, target: 'all' }, nx);
  const X = await reg('Ускоренный'), Y = await reg('Обычный');
  payments.confirmPayment(buy(X));
  ok(X.gold === 100, 'опыт — золото не трогает');
  const boost1 = X.donateBonus.xp;
  ok(boost1 && boost1.pct === 100 && Math.abs(boost1.until - (Date.now() + 3600e3)) < 5000, 'ускорение +100% на 1 час');
  // Сравниваем возвращённый реальный опыт: при повышении уровня user.xp
  // уменьшается, и разница «до/после» врала бы
  const rx = player.addXp(X, 10, []), ry = player.addXp(Y, 10, []);
  ok(ry > 0 && rx === 2 * ry, `опыт вдвое: ${rx} против ${ry}`);
  payments.confirmPayment(buy(X));
  ok(X.donateBonus.xp.pct === 100 && Math.abs(X.donateBonus.xp.until - (Date.now() + 2 * 3600e3)) < 5000, 'вторая покупка продлила до 2 часов, процент прежний');
  const xr = rewards.listFor(X).find((r) => r.kind === 'receipt');
  ok(xr && xr.lines.some((l) => /⚡ \+100% опыта на 1 ч/.test(l.text)), 'ускорение в квитанции');
  ok(payments.packages(X).xpBoost && payments.packages(X).xpBoost.pct === 100, 'игрок видит, сколько осталось');
  X.donateBonus.xp.until = Date.now() - 1;
  ok(player.addXp(X, 10, []) === player.addXp(Y, 10, []), 'срок вышел — опыт обычный');

  console.log('\n[5] К наборам и обещанное до оплаты');
  clearPromos();
  DB.adminSave(O, { title: 'Опыт к наборам', kind: 'xp', pct: 50, limit: 'every', hours: 24, target: 'offers' }, nx);
  const F = await reg('Наборщик');
  const fg = buy(F);
  ok(Array.isArray(order(fg).promos) && order(fg).promos.length === 0, 'к пакету золота опыт «к наборам» не цепляется');
  const off = offers.adminSave(O, { title: 'Малый набор', priceRub: 149, items: [{ type: 'gold', qty: 10 }] }, nx);
  const fo = offers.orderForRub(F, off.id, nx);
  ok((order(fo.orderId).promos || []).length === 1, 'к набору — цепляется');
  payments.confirmPayment(fo.orderId);
  ok(F.donateBonus && F.donateBonus.xp && F.donateBonus.xp.pct === 50, 'после оплаты набора ускорение включилось');
  const fr = rewards.listFor(F).find((r) => r.kind === 'receipt');
  ok(fr && fr.lines.some((l) => /⚡ \+50% опыта на 24 ч/.test(l.text)), 'и оно записано в квитанцию набора');
  clearPromos();
  const gone = DB.adminSave(O, { title: 'Исчезающий', kind: 'gold', pct: 100, limit: 'once' }, nx).promo;
  const G = await reg('Терпеливый');
  const go = buy(G);
  DB.adminRemove(O, gone.id, nx);
  payments.confirmPayment(go);
  ok(G.gold === 200, 'акцию удалили, пока игрок платил, — бонус всё равно начислен');
  DB.adminSave(O, { title: 'Будущая', kind: 'gold', pct: 100, limit: 'every', startAt: Date.now() + 3600e3 }, nx);
  DB.adminSave(O, { title: 'Выключенная', kind: 'gold', pct: 100, limit: 'every', enabled: false }, nx);
  ok(payments.packages(G).promos.length === 0, 'не начавшиеся и выключенные акции игрок не видит');

  console.log('\n[6] Экран банка, штаб, оферта');
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
  const data = {
    promos: [
      { title: 'Первое пополнение', kind: 'gold', pct: 100, limit: 'first', text: '+100% золота к пакету, за первое пополнение', available: true, endAt: 0 },
      { title: 'Опыт в течение дня', kind: 'xp', pct: 100, limit: 'daily', perDay: 5, target: 'all', text: '+100% опыта на 1 ч, до 5 раз в день', available: true, leftToday: 3, endAt: Date.now() + 3600e3 },
      { title: 'Старый разовый', kind: 'gold', pct: 50, limit: 'once', text: '…', available: false, endAt: 0 },
    ],
    xpBoost: { pct: 100, until: Date.now() + 1800e3 },
  };
  const html = App._promoBanners(data, 'gold');
  ok(/Первое пополнение/.test(html) && /Опыт в течение дня/.test(html) && /осталось сегодня: 3/.test(html), 'плашки акций с остатком на сегодня');
  ok(!/Старый разовый/.test(html), 'уже полученный разовый бонус не показывается');
  ok(/Ускорение опыта \+100%/.test(html), 'идущее ускорение показано с таймером');
  ok(/\+100 /.test(App._promoGoldLine(data, { gold: 100 })) && /\+525 /.test(App._promoGoldLine(data, { gold: 525 })), 'в карточке пакета — сколько золота сверху');
  ok(!/Первое пополнение/.test(App._promoBanners(data, 'offers')), 'на витрине наборов бонус к золоту не обещается');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(/App\._promoBanners\(data, 'gold'\)/.test(core) && /App\._promoBanners\(promoData, 'offers'\)/.test(core) && /App\._promoGoldLine\(data, p\)/.test(core), 'плашки стоят на обеих вкладках банка');
  // Экран штаба: рисуется, заготовка заполняет форму, сохранение уходит с
  // полями заготовки. Ошибка в этом файле закрыла бы весь раздел «Экономика»
  global.Admin = {};
  global.A2 = { screens: {}, can: () => true };
  load('public/js/admin2/econ.js', 'Admin');
  const posted = [];
  API.get = async () => ({ promos: [
    { id: 'p1', title: 'Идущая', text: '+100% золота к пакету, за первое пополнение', live: true, enabled: true, applied: 7, startAt: 0, endAt: 0, byName: 'Хозяин' },
    { id: 'p2', title: 'Выключенная', text: '…', live: false, enabled: false, applied: 0, startAt: 0, endAt: 0 },
  ] });
  API.post = async (url, body) => { posted.push([url, body]); return {}; };
  UI.toast = () => {};
  const abox = document.createElement('div');
  document.body.appendChild(abox);
  await Admin.renderDonateBonus(abox);
  ok(abox.querySelectorAll('.a2-table tbody tr').length === 2 && /идёт/.test(abox.textContent) && /выключена/.test(abox.textContent), 'штаб: список акций со статусами');
  ok(abox.querySelectorAll('[data-preset]').length === 4, 'штаб: четыре кнопки-заготовки');
  // Сначала портим поля: иначе значения формы по умолчанию (5 раз, 24 ч)
  // совпадают с заготовкой, и проверка прошла бы без её заполнения
  document.getElementById('db-perday').value = '9';
  document.getElementById('db-hours').value = '77';
  abox.querySelector('[data-preset="2"]').click();
  ok(document.getElementById('db-kind').value === 'xp' && document.getElementById('db-limit').value === 'daily'
     && document.getElementById('db-perday').value === '5' && document.getElementById('db-hours').value === '1'
     && abox.querySelector('[data-db="xp"]').style.display === '', 'заготовка «до 5 раз в день» заполнила форму и открыла поля опыта');
  document.getElementById('db-save').click();
  await new Promise((r) => setTimeout(r, 20));
  const sv = posted.find((p) => p[0] === '/api/admin/donate-bonus/save');
  ok(sv && sv[1].kind === 'xp' && sv[1].pct === 100 && sv[1].limit === 'daily' && sv[1].perDay === 5 && sv[1].hours === 1 && sv[1].enabled === true,
     'сохранение уходит с полями заготовки');
  const econ = fs.readFileSync(path.join(ROOT, 'public/js/admin2/econ.js'), 'utf8');
  ok(/id: 'donate'[^\n]*zone: 'discounts'[^\n]*renderDonateBonus/.test(econ) && /Admin\.renderDonateBonus = async function/.test(econ), 'в штабе подвкладка «Бонусы к покупкам»');
  ok((econ.match(/title: '(Первое пополнение|Двойное золото — один раз|Ускорение опыта за покупку|Опыт ×2 на сутки)'/g) || []).length === 4, 'четыре заготовки под частые случаи');
  const pay = fs.readFileSync(path.join(ROOT, 'public/payments.html'), 'utf8');
  ok(/2\.8\. Бонусы к покупке/.test(pay) && /в момент\s+оформления заказа/.test(pay), 'условия бонусов — в Правилах платежей');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
