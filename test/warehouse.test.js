// ═══════════════════════════════════════════════════════════════════
// test/warehouse.test.js — склад допинга, цена легиона, санкции
//
//  1. Склад допинга: покупка кладёт товар на полку, а не применяет его;
//     применяется он кнопкой и только когда в нём есть смысл. Добыча из
//     контейнера ложится туда же — раньше пять аптечек из пачки ящиков
//     сгорали разом при полном здоровье.
//  2. Легион: $1 млрд плюс 100 золота. Проверяются обе половины цены —
//     забыть списать золото легко, и никто бы этого не заметил.
//  3. Санкции: объявить награду можно на любого, кто нападал, а не
//     только на того, кто отрезал ухо.
//
// Запуск: node test/warehouse.test.js   (после npm run build)
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
const market = require('../dist/src/services/market');
const groups = require('../dist/src/services/groups');
const sanctions = require('../dist/src/services/sanctions');
const battle = require('../dist/src/services/battle');
const config = require('../dist/config/gameConfig');
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
  const nx = [];
  let ip = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `wh${++ip}@t.ru`, 'ru', '10.0.20.' + ip);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 60; p.gold = 5000; p.dollars = 1e12;
    return p;
  };

  console.log('\n[1] Склад допинга');
  const U = await reg('Снабженец');
  const mx = player.maxima(U);
  U.res.am.cur = 0;
  const goldBefore = U.gold;
  market.buyItem(U, 'ammo', null, nx);
  ok(market.itemCount(U, 'ammo') === 1, 'купленный цинк лёг на склад');
  ok(U.res.am.cur === 0, 'и НЕ сработал в момент покупки');
  ok(goldBefore - U.gold === config.MARKET_ITEM_BY_ID['ammo'].gold, 'золото списано по прайсу');
  market.buyItem(U, 'ammo', null, nx);
  ok(market.itemCount(U, 'ammo') === 2, 'покупки копятся');
  market.useItem(U, 'ammo', nx);
  ok(U.res.am.cur === mx.am && market.itemCount(U, 'ammo') === 1,
     'применение восстановило боеприпасы и сняло одну штуку со склада');
  fails(() => market.useItem(U, 'ammo', nx), 'и так полные', 'на полном ресурсе штуку не тратим');
  ok(market.itemCount(U, 'ammo') === 1, 'и она осталась на складе');
  fails(() => market.useItem(U, 'medkit', nx), 'нет на складе', 'чего нет — применить нельзя');
  fails(() => market.useItem(U, 'sabotage', nx), 'к врагу', 'падлянки складом не пользуются');
  // Бафф со склада вешается как обычно
  market.buyItem(U, 'stim', null, nx);
  market.useItem(U, 'stim', nx);
  ok((U.effects || []).some((e) => e.type === 'atk_pct'), 'бафф со склада действует');
  // В витрине видно, сколько чего лежит
  const shelf = market.itemsList(U).buffs.find((x) => x.id === 'ammo');
  ok(shelf.owned === 1, `витрина показывает остаток: ${shelf.owned}`);
  // Добыча из контейнеров — туда же
  const V = await reg('Кладовщик');
  V.res.hp.cur = 1;
  const before = Object.values(V.itemsOwned || {}).reduce((a, b) => a + b, 0);
  market.openContainersFree(V, config.CONTAINERS[4], 5, nx);
  const after = Object.values(V.itemsOwned || {}).reduce((a, b) => a + b, 0);
  ok(after > before, `допинг из контейнеров лёг на склад: ${after} шт.`);
  ok(V.res.hp.cur === 1, 'и не сгорел мимо — здоровье осталось нетронутым');

  console.log('\n[2] Легион: деньги и золото');
  ok(config.LEGION.CREATE_COST === 1000000000 && config.LEGION.CREATE_GOLD === 100,
     `создание стоит $${config.LEGION.CREATE_COST.toLocaleString('ru-RU')} и 🪙 ${config.LEGION.CREATE_GOLD}`);
  const L1 = await reg('Командир');
  L1.dollars = config.LEGION.CREATE_COST; L1.gold = 99;
  fails(() => groups.create(L1, 'legion', 'Стальные волки', nx), 'не хватает золота',
        'без золота легион не создать');
  L1.gold = 150;
  groups.create(L1, 'legion', 'Стальные волки', nx);
  ok(L1.gold === 50, `золото списано: осталось ${L1.gold}`);
  ok(Math.round(L1.dollars) === 0, 'и деньги тоже');
  ok(!!L1.legionId, 'легион создан');
  const view = groups.view(L1, 'legion');
  ok(view.rules.createGold === 100, 'цена в золоте видна в интерфейсе');

  console.log('\n[3] Санкции — на любого, кто нападал');
  const A = await reg('Обидчик'), B = await reg('Потерпевший');
  fails(() => sanctions.declare(B, A.id, 1e9, nx), 'нападал',
        'без нападения санкцию не объявить');
  // Настоящая атака: список нападавших ведётся в бою
  A.res.am.cur = 10;
  battle.attack(A, B.id, nx);
  ok(!!(B.attackedBy || {})[A.id], 'нападавший записан у защитника');
  B.dollars = 1e10;
  sanctions.declare(B, A.id, 1e9, nx);
  ok(sanctions.isUnderSanction(A.id), 'санкция объявлена — награда за голову висит');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
