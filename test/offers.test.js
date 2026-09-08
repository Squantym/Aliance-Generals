// ═══════════════════════════════════════════════════════════════════
// test/offers.test.js — «Спецпредложения»: наборы, собранные в панели
//
// Набор — это запись: состав, цена, срок и лимит на игрока. Здесь
// стережётся то, что легко сломать и трудно заметить:
//
//  1. Состав выдаётся ПОЛНОСТЬЮ и теми же руками, что и обычная выдача
//     (золото через player, VIP через vip, наёмник и контейнеры через
//     market). Своей выдачи у наборов нет и быть не должно.
//  2. Витрина показывает ровно то, что выдаётся: один и тот же список.
//  3. Срок, лимит на игрока и цена соблюдаются — иначе набор станет
//     бесконечным источником золота и подписок.
//  4. Конструктор — под зоной «Ресурсы»: собрать набор может лишь тот,
//     кому владелец это доверил.
//
// Запуск: node test/offers.test.js  (после npm run build)
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
const roles = require('../dist/src/services/roles');
const offers = require('../dist/src/services/offers');
const payments = require('../dist/src/services/payments');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const fails = (n, fn, part) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};

(async () => {
  await db.init();
  await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1');
  await auth.register('Боец', 'пароль123', 'p@t.ru', 'ru', '1.1.1.2');
  await auth.register('Сотрудник', 'пароль123', 's@t.ru', 'ru', '1.1.1.3');
  const O = Object.values(player.users()).find((x) => x.name === 'Хозяин');
  const P = Object.values(player.users()).find((x) => x.name === 'Боец');
  const S = Object.values(player.users()).find((x) => x.name === 'Сотрудник');
  O.role = 'owner'; S.role = 'admin';
  P.level = 60; P.gold = 5000;
  const nx = [];
  const zonesBox = db.load('roleZones', {});

  const full = () => ({
    title: 'Набор новичка', emoji: '🎁', note: 'Всё на старте',
    items: [
      { type: 'gold', qty: 300 },
      { type: 'dollars', qty: 5000000 },
      { type: 'tokens', qty: 3 },
      { type: 'skill', qty: 2 },
      { type: 'vip', days: 7 },
      { type: 'merc', id: 'ghost', days: 3 },
      { type: 'container', tier: 1, qty: 5 },
      { type: 'unit', id: 'ground_10', qty: 50 },
    ],
    priceGold: 900, oldPriceGold: 1500, priceRub: 199, oldPriceRub: 399,
    endAt: Date.now() + 7 * 86400000, limitPerPlayer: 1,
  });

  console.log('\n[1] Конструктор проверяет, что собрано');
  fails('без названия не сохранить', () => offers.adminSave(O, { items: [{ type: 'gold', qty: 1 }], priceGold: 1 }, nx), 'название');
  fails('без состава не сохранить', () => offers.adminSave(O, { title: 'Пустой', priceGold: 1, items: [] }, nx), 'позицию');
  fails('без цены не сохранить', () => offers.adminSave(O, { title: 'Даром', items: [{ type: 'gold', qty: 1 }] }, nx), 'цену');
  fails('конец раньше начала — отказ',
        () => offers.adminSave(O, { title: 'Задом наперёд', priceGold: 1, items: [{ type: 'gold', qty: 1 }],
                                    startAt: Date.now() + 1000, endAt: Date.now() }, nx), 'раньше');
  // Мусор в составе отбрасывается, а не сохраняется «как есть»
  const cleaned = offers.adminSave(O, { title: 'С мусором', priceGold: 10, items: [
    { type: 'gold', qty: 50 }, { type: 'дракон', qty: 1 }, { type: 'merc', id: 'нет-такого', days: 2 },
    { type: 'container', tier: 99, qty: 1 }, { type: 'gold', qty: 0 },
  ] }, nx);
  eq('в наборе осталась только годная позиция', cleaned.offer.items.length, 1);
  offers.adminRemove(O, cleaned.id, nx);

  console.log('\n[2] Витрина показывает то же, что выдаётся');
  const made = offers.adminSave(O, full(), nx);
  const cat = offers.catalog(P);
  eq('набор виден игроку', cat.offers.length, 1);
  const shown = cat.offers[0];
  eq('позиций в витрине столько же, сколько в наборе', shown.items.length, full().items.length);
  ok('состав описан словами', shown.items.every((x) => typeof x.text === 'string' && x.text.length > 2));
  ok('у техники и контейнера есть картинка', shown.items.some((x) => x.icon && /\/img\//.test(x.icon)));
  eq('цена в золоте', shown.priceGold, 900);
  eq('и в рублях', shown.priceRub, 199);
  eq('перечёркнутая цена показана', shown.oldPriceGold, 1500);
  ok('до конца показа есть время', shown.endsInSec > 0 && shown.endsInSec <= 7 * 86400);

  console.log('\n[3] Покупка за золото выдаёт ВЕСЬ состав');
  const before = {
    gold: P.gold, dollars: P.dollars, tokens: P.tokens || 0, skill: P.skillPoints || 0,
    units: player.unitTotalCount(P, 'ground_10'),
    devs: Object.values(P.secretDevs || {}).reduce((a, b) => a + b, 0),
  };
  const buyNx = [];
  offers.buyForGold(P, made.id, buyNx);
  eq('золото: списана цена, начислено из набора', P.gold, before.gold - 900 + 300);
  eq('деньги начислены', P.dollars - before.dollars, 5000000);
  eq('жетоны начислены', (P.tokens || 0) - before.tokens, 3);
  eq('очки навыков начислены', (P.skillPoints || 0) - before.skill, 2);
  ok('VIP выдан на неделю', Math.round((P.vipUntil - Date.now()) / 86400000) === 7);
  ok('наёмник нанят', (P.effects || []).some((e) => e.commanderId === 'ghost' && e.expiresAt > Date.now()));
  eq('техника доехала до ангара', player.unitTotalCount(P, 'ground_10') - before.units, 50);
  ok('контейнеры открыты — разработки прибавились',
     Object.values(P.secretDevs || {}).reduce((a, b) => a + b, 0) > before.devs);
  ok('игроку перечислили, что он получил', buyNx.some((t) => /Набор «Набор новичка» ваш/.test(t)));

  console.log('\n[4] Лимит на игрока и срок действия');
  P.gold = 5000;
  fails('второй раз тот же набор не купить', () => offers.buyForGold(P, made.id, nx), 'можно купить');
  eq('в витрине это видно', offers.catalog(P).offers[0].canBuyGold, false);
  eq('и счётчик покупок вырос', offers.catalog(P).offers[0].boughtByMe, 1);
  // Просроченный набор исчезает с витрины и не покупается
  const expired = offers.adminSave(O, {
    title: 'Вчерашний', priceGold: 10, items: [{ type: 'gold', qty: 10 }],
    startAt: Date.now() - 2 * 86400000, endAt: Date.now() - 86400000,
  }, nx);
  ok('просроченного набора в витрине нет', !offers.catalog(P).offers.some((x) => x.id === expired.id));
  fails('и купить его нельзя', () => offers.buyForGold(P, expired.id, nx), 'не действует');
  // Выключенный — то же самое
  const off = offers.adminSave(O, {
    title: 'Спрятанный', priceGold: 10, items: [{ type: 'gold', qty: 10 }], enabled: false,
  }, nx);
  ok('выключенный набор скрыт', !offers.catalog(P).offers.some((x) => x.id === off.id));

  console.log('\n[5] Цена соблюдается');
  const poor = offers.adminSave(O, {
    title: 'Дорогой', priceGold: 100000, items: [{ type: 'gold', qty: 1 }],
  }, nx);
  fails('без золота не купить', () => offers.buyForGold(P, poor.id, nx), 'Не хватает золота');
  const rubOnly = offers.adminSave(O, {
    title: 'Только за рубли', priceRub: 149, items: [{ type: 'gold', qty: 100 }],
  }, nx);
  fails('рублёвый набор за золото не берётся', () => offers.buyForGold(P, rubOnly.id, nx), 'за золото не продаётся');

  console.log('\n[6] Рублёвая покупка выдаётся только после оплаты');
  const goldBefore = P.gold;
  const orderNx = [];
  const order = offers.orderForRub(P, rubOnly.id, orderNx);
  ok('заказ создан', !!order.orderId);
  eq('и он ждёт оплаты', order.status, 'pending');
  eq('пока ничего не выдано', P.gold, goldBefore);
  eq('и счётчик покупок не двинулся', offers.catalog(P).offers.find((x) => x.id === rubOnly.id).boughtByMe, 0);
  // Подтверждение платежа (его позовёт webhook провайдера)
  payments.confirmPayment(order.orderId);
  eq('после подтверждения золото из набора начислено', P.gold, goldBefore + 100);
  eq('и покупка засчитана', offers.catalog(P).offers.find((x) => x.id === rubOnly.id).boughtByMe, 1);
  const orders = payments.myOrders(P).orders;
  ok('заказ помечен оплаченным', orders.some((o) => o.id === order.orderId && o.status === 'paid'));
  ok('и в истории видно, за что платили', orders.some((o) => o.title === 'Только за рубли'));

  console.log('\n[7] Конструктор — по зоне «Ресурсы»');
  zonesBox.admin = [];
  fails('без зоны список не открыть', () => offers.adminList(S), 'Недостаточно прав');
  fails('и набор не создать', () => offers.adminSave(S, full(), nx), 'Недостаточно прав');
  fails('и не удалить', () => offers.adminRemove(S, made.id, nx), 'Недостаточно прав');
  zonesBox.admin = ['economy'];
  ok('с зоной список открывается', Array.isArray(offers.adminList(S).offers));
  const byStaff = offers.adminSave(S, { title: 'От сотрудника', priceGold: 5, items: [{ type: 'gold', qty: 5 }] }, nx);
  ok('и набор создаётся', !!byStaff.id);
  eq('адрес размечен зоной', roles.zoneOfPath('/api/admin/offers/save'), 'economy');
  ok('витрина игроку зоны не требует', Array.isArray(offers.catalog(P).offers));

  console.log('\n[8] Панель отдаёт всё для сборки');
  const pal = offers.adminList(O).palette;
  ok('типы позиций перечислены', pal.types.length >= 8);
  ok('наёмники на выбор', pal.mercs.length === c.COMMANDERS.length);
  ok('контейнеры на выбор', pal.containers.length === c.CONTAINERS.length);
  ok('техника на выбор', pal.units.length === c.UNITS.length);

  console.log('[9] Набор доступен из ОБЕИХ панелей и виден игроку');
  // Панелей две — старая (public/js/admin.js) и новая (admin2). Новая
  // зовёт те же функции Admin.*, но список подвкладок держит СВОЙ, и
  // конструктор наборов в него не попал: собрать предложение было негде,
  // хотя весь код для этого лежал на месте. Сверяем списки целиком —
  // одна забытая строка повторит ровно ту же пропажу.
  const v1 = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  const v2 = fs.readFileSync(path.join(ROOT, 'public/js/admin2/econ.js'), 'utf8');
  const idsOf = (src, block) => {
    const m = src.slice(src.indexOf(block));
    const list = m.slice(0, m.indexOf(']'));
    const out = [];
    const re = /id: '([a-z]+)'/g;
    let m2;
    while ((m2 = re.exec(list))) out.push(m2[1]);
    return out;
  };
  const oldTabs = idsOf(v1, 'renderEcon(c) {');
  const newTabs = idsOf(v2, 'const SUBS = [');
  ok('в старой панели есть конструктор наборов', oldTabs.indexOf('offers') >= 0);
  ok('и в новой тоже', newTabs.indexOf('offers') >= 0);
  eq('подвкладки экономики в обеих панелях совпадают',
     oldTabs.slice().sort().join(','), newTabs.slice().sort().join(','));
  ok('новая панель рисует набор той же функцией', /fn: 'renderOffers'/.test(v2));
  ok('функция сборки набора на месте', /renderOffers\(c\)/.test(v1) && /loadOffers/.test(v1));
  // Витрина в банке: игрок ищет «Спецпредложения», а не «Наборы»
  const bank = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok('в банке есть вкладка спецпредложений', /bank\/offers'">🎁 Спецпредложения/.test(bank));
  ok('витрина берёт наборы с сервера', /API\.get\('\/api\/offers'\)/.test(bank));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
