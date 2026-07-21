// Окно «купить всю нужную технику» для спецоперации:
// (1) startStep при нехватке техники возвращает needUnits (смету), НЕ тратя энергию.
// (2) buyRequiredUnits докупает дефицит по цене магазина; деньги списываются.
// (3) после покупки startStep реально запускает шаг.
// (4) активная АКЦИЯ (скидка) уменьшает цену в смете.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const missions = require('../dist/src/services/missions');
const units = require('../dist/src/services/units');
const discounts = require('../dist/src/services/discounts');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Комбат', 'password1', 'k@a.com', 'ru', '1.1.1.1');
  const user = Object.values(player.users()).find(x => x.name === 'Комбат');

  // Каспийский кризис (idx 2, minLevel 25), шаг op0/step0:
  // требует уровень 25, мощь 128, 11 ед. техники ур.10+.
  user.level = 25;
  user.res.en.cur = 999;
  // Даём много ДЕШЁВОЙ техники ур.1 — мощь наберётся, но техники ур.10+ = 0
  user.units = { ground_1: { 0: 400, 1: 0, 2: 0 } };
  user.dollars = 10_000_000_000;
  db.save('users');

  const conf = c.CONFLICTS.find(x => x.id === 'caspian');
  const step = conf.operations[0].steps[0];
  console.log('\n[1] Нехватка техники → startStep возвращает смету needUnits');
  const enBefore = user.res.en.cur;
  const r1 = missions.startStep(user, 'caspian', 0, 0, []);
  ok('вернулся needUnits (а не запуск)', r1 && r1.needUnits && !r1.processId);
  ok('дефицит техники > 0', r1.needUnits.deficit > 0);
  eq('дефицит = требование − наличие', r1.needUnits.deficit, step.require.units.count - 0);
  ok('в смете указан юнит для покупки', !!r1.needUnits.unitId);
  eq('энергия НЕ потрачена', user.res.en.cur, enBefore);
  eq('очередь миссий пуста (шаг не запущен)', (user.missionQueue || []).length, 0);

  console.log('\n[2] Смета = цена магазина × дефицит');
  const cu = c.UNIT_BY_ID[r1.needUnits.unitId];
  const priceNoSale = units.priceFor(user, cu);
  eq('unitPrice = цена магазина', r1.needUnits.unitPrice, priceNoSale);
  eq('totalCost = цена × дефицит', r1.needUnits.totalCost, priceNoSale * r1.needUnits.deficit);

  console.log('\n[3] Покупка докупает дефицит и списывает деньги');
  const moneyBefore = user.dollars;
  const haveBefore = Object.values(user.units[r1.needUnits.unitId] || {}).reduce((a, b) => a + b, 0);
  const short3 = missions.startStep(user, 'caspian', 0, 0, []).needUnits; // свежая смета
  missions.buyRequiredUnits(user, 'caspian', 0, 0, []);
  const haveAfter = Object.values(user.units[r1.needUnits.unitId] || {}).reduce((a, b) => a + b, 0);
  eq('куплено ровно дефицит', haveAfter - haveBefore, short3.deficit);
  // Списание не больше сметы (может быть меньше из-за наград за достижения при покупке)
  ok('деньги потрачены (не больше сметы)', (moneyBefore - user.dollars) > 0 && (moneyBefore - user.dollars) <= short3.totalCost);

  console.log('\n[4] После покупки startStep реально запускает шаг');
  const r2 = missions.startStep(user, 'caspian', 0, 0, []);
  ok('шаг запущен (есть processId, нет needUnits)', r2 && r2.processId && !r2.needUnits);
  eq('шаг в очереди', (user.missionQueue || []).length, 1);
  ok('энергия потрачена на запуск', user.res.en.cur < enBefore);

  console.log('\n[5] Акция уменьшает цену в смете');
  // Новый чистый игрок для чистоты (без запущенного шага)
  await auth.register('Комбат2', 'password1', 'k2@a.com', 'ru', '1.1.1.2');
  const u2 = Object.values(player.users()).find(x => x.name === 'Комбат2');
  u2.level = 25; u2.res.en.cur = 999; u2.units = { ground_1: { 0: 400, 1: 0, 2: 0 } }; u2.dollars = 10_000_000_000;
  const before = missions.startStep(u2, 'caspian', 0, 0, []).needUnits;
  discounts.set('unit', 30, 24); // акция −30% на технику, 24ч
  const after = missions.startStep(u2, 'caspian', 0, 0, []).needUnits;
  ok('в смете отражена акция', after.discount && after.discount.pct === 30);
  ok('цена по акции ниже базовой', after.unitPrice < before.unitPrice);
  ok('акция −30% ≈ базовая цена (допуск округления)', Math.abs(after.unitPrice - before.unitPrice * 0.7) <= 2);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
