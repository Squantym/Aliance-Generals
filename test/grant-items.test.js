// ═══════════════════════════════════════════════════════════════════
// test/grant-items.test.js — выдача игроку чего угодно (18.09.2026)
//
// ЧТО БЫЛО. В окне выдачи были только числа: деньги, золото, опыт,
// гербы, жетоны. VIP, контейнер чёрного рынка, наёмника, технику и
// готовый набор из магазина владелец добирал по другим разделам или не
// мог выдать вовсе.
//
// Что стережётся:
//  1. Позиции выдаются тем же кодом, что и наборы (offers.grantItems):
//     VIP на дни, контейнер, наёмник, техника, деньги.
//  2. Готовый набор из магазина выдаётся целиком и БЕСПЛАТНО: денег не
//     списывает и в «продано» не попадает — это выдача, а не покупка.
//  3. Удалённый набор выдать нельзя — честный отказ.
//  4. Тихая выдача остаётся тихой: золото из позиций не попадает в
//     статистику игрока.
//  5. Массовая выдача умеет то же самое.
//  6. Письмо-награда несёт те же позиции, и они выдаются при получении.
//  7. Битые позиции (чужой тип, нулевое количество) отбрасываются.
//  8. Окно выдачи в панели умеет собрать позиции и набор.
//
// Запуск: node test/grant-items.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const admin = require('../dist/src/services/admin');
const offers = require('../dist/src/services/offers');
const rewards = require('../dist/src/services/rewards');
const vip = require('../dist/src/services/vip');
const config = require('../dist/config/gameConfig');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, name) => {
  let err = '';
  try { fn(); } catch (e) { err = e.message; }
  ok(err.indexOf(part) >= 0, `${name}: «${err || 'ошибки не было'}»`);
};

(async () => {
  await db.init();
  let n = 0;
  const reg = async (name, owner) => {
    await auth.register(name, 'пароль123', `gi_${++n}@t.ru`, 'ru', '10.0.7.' + n);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 30;
    if (owner) p.role = 'owner';
    return p;
  };
  const O = await reg('Владелец', true);
  const A = await reg('Игрок');
  const B = await reg('Второй');
  const N = [];

  const MERC = config.COMMANDERS[0].id;
  const CONT = config.CONTAINERS[0].tier;
  const UNIT = config.UNITS[0].id;
  const containers = (u) => {
    return Number((u.containersOwned || {})[String(CONT)] || 0);
  };

  console.log('\n[1] Позиции: VIP, контейнер, наёмник, техника');
  admin.grant(O, { userId: A.id, items: [
    { type: 'vip', days: 7 },
    { type: 'container', tier: CONT, qty: 3 },
    { type: 'merc', id: MERC, days: 5 },
    { type: 'unit', id: UNIT, qty: 12 },
    { type: 'dollars', qty: 1000 },
  ] }, N);
  ok(vip.isVip(A), 'VIP-подписка выдана');
  ok(containers(A) === 3, `контейнеры на складе: ${containers(A)}`);
  ok((A.effects || []).some((e) => e.commanderId === MERC && e.expiresAt > Date.now()), 'наёмник выдан на срок');
  ok((player.ensureUnit(A, UNIT)[0] || 0) === 12, `техника выдана: ${player.ensureUnit(A, UNIT)[0]}`);
  const gift = (A.pendingGifts || []).slice(-1)[0];
  ok(gift && /VIP/.test(gift.items.join(', ')) && /контейнер|Контейнер|📦/.test(gift.items.join(', ')),
     `игрок увидит окно подарка: ${gift && gift.items.join(', ')}`);

  console.log('\n[2] Готовый набор из магазина');
  const made = offers.adminSave(O, {
    title: 'Стартовый', items: [{ type: 'gold', qty: 250 }, { type: 'vip', days: 3 }],
    priceGold: 500, priceRub: 199, enabled: true,
  }, N);
  const setId = made.id;
  const goldBefore = B.gold || 0;
  const moneyBefore = B.dollars || 0;
  admin.grant(O, { userId: B.id, offerId: setId }, N);
  ok((B.gold || 0) - goldBefore === 250, `состав набора выдан: +${(B.gold || 0) - goldBefore} золота`);
  ok(vip.isVip(B), 'и подписка из набора');
  // Доход построек капает при каждом обновлении игрока, поэтому сверяем
  // не «столько же», а «не меньше»: списания цены не было
  ok((B.dollars || 0) >= moneyBefore, 'деньги за набор не списаны — это выдача, а не покупка');
  const soldNow = offers.adminList(O).offers.find((o) => o.id === setId).sold;
  ok(soldNow === 0, `в «продано» набор не попал: ${soldNow}`);
  ok(!(B.offersBought && B.offersBought[setId]), 'и лимит «в одни руки» не тронут');
  fails(() => admin.grant(O, { userId: B.id, offerId: 'нет-такого' }, N), 'Набор не найден', 'удалённый набор выдать нельзя');

  console.log('\n[3] Битые позиции');
  fails(() => admin.grant(O, { userId: A.id, items: [{ type: 'дракон', qty: 5 }] }, N),
        'Не указано, что выдавать', 'чужой тип отброшен');
  fails(() => admin.grant(O, { userId: A.id, items: [{ type: 'gold', qty: 0 }] }, N),
        'Не указано, что выдавать', 'нулевое количество отброшено');

  console.log('\n[4] Тихая выдача остаётся тихой');
  const goldA = A.gold || 0;
  const srcBefore = JSON.stringify(((A.stats || {}).goldGot) || {});
  admin.grantQuiet(O, { userId: A.id, items: [{ type: 'gold', qty: 400 }, { type: 'vip', days: 1 }] }, N);
  ok((A.gold || 0) - goldA === 400, `золото из позиций пришло: +${(A.gold || 0) - goldA}`);
  ok(JSON.stringify(((A.stats || {}).goldGot) || {}) === srcBefore,
     `в статистике золота следа нет: ${JSON.stringify(((A.stats || {}).goldGot) || {})}`);

  console.log('\n[5] Всем игрокам');
  const before = Object.values(player.users()).map((p) => containers(p));
  const r = admin.grantAll(O, { items: [{ type: 'container', tier: CONT, qty: 2 }] }, N);
  const after = Object.values(player.users()).map((p) => containers(p));
  ok(r.count >= 3 && after.every((v, i) => v === before[i] + 2), `контейнеры получили все (${r.count})`);

  console.log('\n[6] Письмом');
  const goldB = B.gold || 0;
  rewards.adminGrant(O, { userId: B.id, title: 'Подарок', reason: 'за помощь',
    gold: 100, items: [{ type: 'container', tier: CONT, qty: 1 }, { type: 'vip', days: 2 }] }, N);
  const letter = rewards.listFor(B).find((x) => x.title === 'Подарок');
  ok(!!letter, 'письмо пришло');
  ok(/📦|контейнер/i.test(letter.rewardText.join(', ')) && /VIP/i.test(letter.rewardText.join(', ')),
     `в письме видно, что внутри: ${letter.rewardText.join(', ')}`);
  ok((B.gold || 0) === goldB, 'до получения ничего не начислено');
  const contB = containers(B);
  rewards.claim(B, letter.id, N);
  ok((B.gold || 0) - goldB === 100 && containers(B) - contB === 1, 'после «Забрать» выдано всё: и золото, и контейнер');

  console.log('\n[7] Окно выдачи в панели');
  const ui = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  ok(/id="g-items-wrap"[\s\S]{0,200}VIP, контейнеры, наёмники, техника, готовый набор/.test(ui),
     'в окне выдачи есть раздел позиций');
  ok(/renderGrantItems\(\)/.test(ui) && /grantItemsPayload/.test(ui), 'позиции собираются и уходят на сервер');
  const payloadCalls = (ui.match(/Admin\.grantItemsPayload\(/g) || []).length;
  ok(payloadCalls >= 4, `позиции уходят во все виды выдачи: выдать, тихо, письмом, всем (${payloadCalls})`);
  // Сброс нужен в ОБОИХ местах: карточка игрока и массовая выдача.
  // Иначе позиции, набранные прошлому игроку, уехали бы следующему.
  const resets = (ui.match(/Admin\._grantItems = \[\];/g) || []).length;
  ok(resets >= 2, `список позиций чистится при каждом открытии формы (${resets})`);
  ok(/expandOffer/.test(ui), 'письмо несёт состав набора');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
