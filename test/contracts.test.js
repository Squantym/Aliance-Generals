// ═══════════════════════════════════════════════════════════════════
// test/contracts.test.js — контракты штаба платят техникой
//
// Золото за контракты убрано: их выдают по три в день, и это был
// постоянный ручеёк премиум-валюты мимо клуба. Теперь штаб платит тем,
// чем и должен, — техникой ПО УРОВНЮ игрока, разной, 100/200/300 единиц
// по ступеням.
//
// Что здесь стережётся:
//  1. В награде техника, а не золото, и её ровно столько, сколько задано.
//  2. Техника открыта игроку по уровню — иначе награда была бы витриной
//     того, чем нельзя пользоваться.
//  3. Разбивка НЕ меняется между показом и выдачей: игрок видит в
//     карточке ровно то, что окажется в ангаре.
//  4. Техника действительно доезжает до ангара.
//
// Запуск: node test/contracts.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const features = require('../dist/src/services/features');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Подрядчик', 'пароль123', 'ct@t.ru', 'ru', '1.1.1.1');
  const U = Object.values(player.users()).find((x) => x.name === 'Подрядчик');
  const nx = [];

  console.log('\n[1] В награде техника, а не золото');
  U.level = 120;
  const v = features.contractsView(U);
  ok('контракты выданы', v.contracts.length > 0);
  for (const ct of v.contracts) {
    ok(`«${ct.name}»: награда — список техники`,
       Array.isArray(ct.rewardUnits) && ct.rewardUnits.length > 0);
    eq(`«${ct.name}»: сумма сходится с заявленной`,
       ct.rewardUnits.reduce((s, x) => s + x.count, 0), ct.rewardTotal);
    ok(`«${ct.name}»: количество из конфига (${ct.rewardTotal})`,
       c.CONTRACT_UNITS.includes(ct.rewardTotal));
    ok(`«${ct.name}»: золота в награде нет`, ct.reward === undefined);
  }

  console.log('\n[2] Техника — по уровню игрока и разная');
  const byId = Object.fromEntries(c.UNITS.map((x) => [x.id, x]));
  for (const ct of v.contracts) {
    const units = ct.rewardUnits.map((x) => byId[x.id]);
    ok(`«${ct.name}»: вся техника открыта по уровню`,
       units.every((x) => x && x.unlock <= U.level));
    ok(`«${ct.name}»: виды не повторяются`,
       new Set(ct.rewardUnits.map((x) => x.id)).size === ct.rewardUnits.length);
    ok(`«${ct.name}»: роды войск разные`,
       new Set(units.map((x) => x.type)).size === units.length);
  }
  // На первом уровне открыты только наземные — награда обязана это пережить
  const low = c.contractUnitPicks(1, 100, 'проба');
  eq('на 1 уровне вид один', low.length, 1);
  eq('и это наземная техника', low[0].type, 'ground');
  eq('но сотня всё равно выдана', low[0].count, 100);
  // На высоком уровне техника другая — не Т-54 на трёхсотом
  const high = c.contractUnitPicks(300, 300, 'проба');
  ok('на 300 уровне техника современная',
     high.every((x) => byId[x.id].unlock > 250));

  console.log('\n[3] Что показали — то и выдали');
  const ct = v.contracts[0];
  const shown = JSON.stringify(ct.rewardUnits);
  eq('повторный просмотр даёт ту же разбивку',
     JSON.stringify(features.contractsView(U).contracts[0].rewardUnits), shown);
  const def = c.CONTRACTS_POOL.find((x) => ct.id.startsWith(x.id));
  ok('описание контракта найдено', !!def);
  throws('невыполненный контракт награду не отдаёт', () => features.claimContract(U, ct.id, nx));
  // Выполняем: двигаем накопительный счётчик, по которому идёт прогресс
  U.counters[def.counter] = (U.counters[def.counter] || 0) + 1000000;
  const goldBefore = U.gold;
  features.claimContract(U, ct.id, nx);
  const got = JSON.parse(shown);
  for (const pick of got) {
    eq(`в ангар легло ${pick.name} ×${pick.count}`,
       player.unitTotalCount(U, pick.id), pick.count);
  }
  eq('золото не начислялось', U.gold, goldBefore);
  ok('в уведомлении названа техника', nx.some((t) => /Штаб передал технику/.test(t)));
  throws('второй раз награду не забрать', () => features.claimContract(U, ct.id, nx));

  console.log('\n[4] Награда складывается с тем, что уже есть');
  const ct2 = features.contractsView(U).contracts.find((x) => !x.claimed);
  ok('есть ещё не закрытый наряд', !!ct2);
  const def2 = c.CONTRACTS_POOL.find((x) => ct2.id.startsWith(x.id));
  U.counters[def2.counter] = (U.counters[def2.counter] || 0) + 1000000;
  const before2 = ct2.rewardUnits.map((x) => player.unitTotalCount(U, x.id));
  features.claimContract(U, ct2.id, nx);
  const okAdd = ct2.rewardUnits.every((x, i) => player.unitTotalCount(U, x.id) === before2[i] + x.count);
  ok('количество прибавилось, а не перезаписалось', okAdd);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
