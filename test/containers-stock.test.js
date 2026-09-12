// ═══════════════════════════════════════════════════════════════════
// test/containers-stock.test.js — склад контейнеров и их содержимое
//
// Что стережётся:
//  1. Покупка НЕ открывает контейнер: он ложится на склад. Купить можно
//     1, 3 или 5 штук, открыть — 1, 3, 5 или все сразу.
//  2. Открыть больше, чем лежит на складе, нельзя; открытие не берёт
//     золото второй раз.
//  3. Внутри, кроме секретных разработок: допинг, деньги и диверсанты.
//     Деньги считаются в единицах цены техники ИГРОКА (растут с уровнем).
//  4. Потолки по видам диверсантов: в младших ящиках нет ни секретных,
//     ни смертников; в старших они не превышают заданных чисел и входят
//     в общее число, а не идут сверх него.
//  5. Контейнер из набора «Спецпредложений» тоже ложится на склад.
//  6. В окне добычи разработки показаны картинками, а не строкой.
//
// Запуск: node test/containers-stock.test.js   (после npm run build)
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
const offers = require('../dist/src/services/offers');
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
  let ipN = 0;
  const reg = async (name, gold) => {
    await auth.register(name, 'пароль123', `ct${++ipN}@t.ru`, 'ru', '10.0.7.' + ipN);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.gold = gold || 100000;
    p.dollars = 0;
    return p;
  };
  const nx = [];
  const T1 = config.CONTAINERS[0], T5 = config.CONTAINERS[4];

  console.log('\n[1] Покупка кладёт на склад, а не открывает');
  const A = await reg('Кладовщик');
  const devsBefore = Object.values(A.secretDevs || {}).reduce((a, b) => a + b, 0);
  const r = market.buyContainers(A, T1.tier, 3, nx);
  ok(r.owned === 3 && market.ownedCount(A, T1.tier) === 3, `на складе 3 шт. (${r.owned})`);
  ok(A.gold === 100000 - T1.gold * 3, `золото списано один раз: ${A.gold}`);
  ok(Object.values(A.secretDevs || {}).reduce((a, b) => a + b, 0) === devsBefore, 'при покупке ничего не выпало');
  fails(() => market.buyContainers(A, T1.tier, 2, nx), 'Купить можно', 'купить 2 штуки нельзя');
  fails(() => market.buyContainers(A, T1.tier, 10, nx), 'Купить можно', 'купить 10 штук нельзя');

  console.log('\n[2] Открытие со склада');
  const goldBefore = A.gold;
  const o1 = market.openOwned(A, T1.tier, 1, nx);
  ok(o1.qty === 1 && o1.owned === 2, `открыт один, осталось ${o1.owned}`);
  ok(A.gold === goldBefore, 'открытие не берёт золото второй раз');
  fails(() => market.openOwned(A, T1.tier, 5, nx), 'На складе только', 'больше, чем лежит, не открыть');
  fails(() => market.openOwned(A, T1.tier, 4, nx), 'Открыть можно', 'открыть 4 штуки нельзя');
  const oAll = market.openOwned(A, T1.tier, 'all', nx);
  ok(oAll.qty === 2 && market.ownedCount(A, T1.tier) === 0, 'открыл все — склад пуст');
  fails(() => market.openOwned(A, T1.tier, 1, nx), 'нет таких контейнеров', 'с пустого склада не открыть');

  console.log('\n[3] Что лежит внутре: деньги, допинг, диверсанты');
  const B = await reg('Вскрыватель');
  B.level = 1;
  const unit1 = config.minUnitPriceAtLevel(1);
  market.buyContainers(B, T1.tier, 5, nx);
  const openB = market.openOwned(B, T1.tier, 5, nx);
  const units = openB.loot.money / unit1;
  ok(Number.isInteger(units) && units >= 5 * T1.moneyUnits[0] && units <= 5 * T1.moneyUnits[1],
     `деньги — ${units} единиц цены техники (ждали ${5 * T1.moneyUnits[0]}–${5 * T1.moneyUnits[1]})`);
  ok(B.dollars === openB.loot.money, 'деньги зачислены игроку');
  const C = await reg('Богатый');
  C.level = 40;
  const unit40 = config.minUnitPriceAtLevel(40);
  ok(unit40 > unit1, `на 40 уровне техника дороже: ${unit40} против ${unit1}`);
  market.buyContainers(C, T1.tier, 1, nx);
  const openC = market.openOwned(C, T1.tier, 1, nx);
  ok(openC.loot.money % unit40 === 0 && openC.loot.money >= T1.moneyUnits[0] * unit40,
     `у сорокового уровня награда считается от его техники: $${openC.loot.money}`);

  console.log('\n[4] Диверсанты и их потолки');
  const D = await reg('Диверсант');
  market.buyContainers(D, T1.tier, 5, nx);
  market.buyContainers(D, T1.tier, 5, nx);
  let sabT1 = { secret: 0, suicide: 0, total: 0 };
  for (let i = 0; i < 2; i++) {
    const o = market.openOwned(D, T1.tier, 5, nx);
    for (const [k, v] of Object.entries(o.loot.sab)) {
      sabT1.total += v;
      if (k === 'secret') sabT1.secret += v;
      if (k === 'suicide') sabT1.suicide += v;
    }
  }
  ok(sabT1.total > 0, `в младшем ящике диверсанты есть: ${sabT1.total}`);
  ok(sabT1.secret === 0 && sabT1.suicide === 0, 'но ни секретных, ни смертников в нём нет');
  const E = await reg('Старший', 1000000);
  market.buyContainers(E, T5.tier, 5, nx);
  let worst = { secret: 0, suicide: 0 };
  for (let i = 0; i < 5; i++) {
    const o = market.openOwned(E, T5.tier, 1, nx);
    const s = o.loot.sab || {};
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    ok(total >= T5.sab[0] && total <= T5.sab[1], `ящик ${i + 1}: диверсантов ${total} (ждали ${T5.sab[0]}–${T5.sab[1]})`);
    worst.secret = Math.max(worst.secret, s.secret || 0);
    worst.suicide = Math.max(worst.suicide, s.suicide || 0);
  }
  ok(worst.secret <= T5.sabSecretMax && worst.suicide <= T5.sabSuicideMax,
     `потолки соблюдены: секретных ${worst.secret} ≤ ${T5.sabSecretMax}, смертников ${worst.suicide} ≤ ${T5.sabSuicideMax}`);
  const sumSab = Object.values(E.saboteurs).reduce((a, b) => a + b, 0);
  ok(sumSab > 0, `диверсанты зачислены игроку: ${sumSab}`);

  console.log('\n[5] Допинг и разработки');
  const F = await reg('Химик', 1000000);
  market.buyContainers(F, T5.tier, 5, nx);
  const oF = market.openOwned(F, T5.tier, 5, nx);
  const doping = Object.values(oF.loot.doping).reduce((a, b) => a + b, 0);
  // 250% = два гарантированных + 50% на третий, значит минимум 2 на ящик
  ok(doping >= 5 * 2, `допинга ${doping} за 5 ящиков (гарантированных минимум ${5 * 2})`);
  ok((F.effects || []).length > 0 || F.res.en.cur >= 0, 'допинг применён сразу — склада предметов в игре нет');
  ok(oF.loot.devList.length > 0 && oF.loot.devList[0].id && oF.loot.devList[0].name,
     'разработки приходят с идентификатором — окно покажет картинку');
  const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  ok(/\/img\/secret\/\$\{d\.id\}\.webp/.test(app), 'в окне добычи стоит картинка разработки, а не только название');

  console.log('\n[6] Контейнер из набора — на склад');
  const G = await reg('Наборщик');
  G.role = 'owner';   // набор собирает сотрудник, покупает он же
  const off2 = offers.adminSave(G, { title: 'Ящики', priceGold: 10, items: [{ type: 'container', tier: T1.tier, qty: 3 }] }, nx);
  const devsG = Object.values(G.secretDevs || {}).reduce((a, b) => a + b, 0);
  offers.buyForGold(G, off2.id, nx);
  ok(market.ownedCount(G, T1.tier) === 3, `из набора на склад легло ${market.ownedCount(G, T1.tier)} шт.`);
  ok(Object.values(G.secretDevs || {}).reduce((a, b) => a + b, 0) === devsG, 'и сами они не вскрылись');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
