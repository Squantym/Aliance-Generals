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
  user.res.en.cur = 5000;
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
  ok('дефицит по типам расписан', Array.isArray(r1.needUnits.items) && r1.needUnits.items.length > 0);
  ok('у каждого типа указан юнит и количество', r1.needUnits.items.every(it => it.unitId && it.deficit > 0 && it.typeRu));
  eq('суммарный дефицит = сумме по типам', r1.needUnits.deficit,
     r1.needUnits.items.reduce((s2, it) => s2 + it.deficit, 0));
  eq('энергия НЕ потрачена', user.res.en.cur, enBefore);
  eq('очередь миссий пуста (шаг не запущен)', (user.missionQueue || []).length, 0);

  console.log('\n[2] Смета = цена магазина × дефицит (по каждому типу)');
  for (const it of r1.needUnits.items) {
    const cu = c.UNIT_BY_ID[it.unitId];
    eq(`${it.typeRu}: цена магазина`, it.unitPrice, units.priceFor(user, cu));
    eq(`${it.typeRu}: стоимость = цена × дефицит`, it.cost, it.unitPrice * it.deficit);
  }
  eq('totalCost = сумма по типам', r1.needUnits.totalCost,
     r1.needUnits.items.reduce((s2, it) => s2 + it.cost, 0));

  console.log('\n[3] Покупка докупает дефицит и списывает деньги');
  const moneyBefore = user.dollars;
  const short3 = missions.startStep(user, 'caspian', 0, 0, []).needUnits; // свежая смета
  const beforeCounts = short3.items.map(it => Object.values(user.units[it.unitId] || {}).reduce((a, b) => a + b, 0));
  missions.buyRequiredUnits(user, 'caspian', 0, 0, []);
  short3.items.forEach((it, i) => {
    const after = Object.values(user.units[it.unitId] || {}).reduce((a, b) => a + b, 0);
    eq(`${it.typeRu}: куплено ровно дефицит`, after - beforeCounts[i], it.deficit);
  });
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
  u2.level = 25; u2.res.en.cur = 5000; u2.units = { ground_1: { 0: 400, 1: 0, 2: 0 } }; u2.dollars = 10_000_000_000;
  const before = missions.startStep(u2, 'caspian', 0, 0, []).needUnits;
  discounts.set('unit', 30, 24); // акция −30% на технику, 24ч
  const after = missions.startStep(u2, 'caspian', 0, 0, []).needUnits;
  ok('в смете отражена акция', after.discount && after.discount.pct === 30);
  ok('общая стоимость по акции ниже', after.totalCost < before.totalCost);
  ok('акция −30% ≈ базовой стоимости', Math.abs(after.totalCost - before.totalCost * 0.7) <= after.items.length * 2);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
