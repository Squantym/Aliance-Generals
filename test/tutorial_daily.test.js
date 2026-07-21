// Курс молодого бойца + поручения:
// (1) бюджет курса: золото ≤ 500, доллары ≤ 100 Bn;
// (2) все события курса реально доставляются (attack/buy_unit/win/build_income/mission_step);
// (3) новые daily-счётчики earsCut/saboteursBought учитываются;
// (4) требование техники в спецоперации зависит от уровня операции.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const tutorial = require('../dist/src/services/tutorial');
const daily = require('../dist/src/services/dailyQuests');
const saboteurs = require('../dist/src/services/saboteurs');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();

  console.log('\n[1] Бюджет курса молодого бойца: ≤500 золота, ≤100 Bn');
  const goldSum = c.TUTORIAL.reduce((s, q) => s + (q.gold || 0), 0) + c.TUTORIAL_FINAL_GOLD;
  const dollarSum = c.TUTORIAL.reduce((s, q) => s + (q.dollars || 0), 0);
  ok(`заданий в курсе много (${c.TUTORIAL.length} ≥ 12)`, c.TUTORIAL.length >= 12);
  eq('золото курса ровно 500', goldSum, 500);
  ok(`доллары курса ≤ 100 Bn (факт ${(dollarSum/1e9).toFixed(1)} Bn)`, dollarSum <= 100_000_000_000);
  ok('все события курса из числа доставляемых', c.TUTORIAL.every(q => ['attack','buy_unit','win','build_income','mission_step'].includes(q.event)));

  console.log('\n[2] Все шаги курса реально проходятся событиями');
  await auth.register('Новобранец', 'password1', 'n@a.com', 'ru', '1.1.1.1');
  const u = Object.values(player.users()).find(x => x.name === 'Новобранец');
  u.tutorial = { step: 0, done: false };
  let guard = 0;
  while (!u.tutorial.done && guard++ < 50) {
    const ev = c.TUTORIAL[u.tutorial.step].event;
    tutorial.notify(u, ev, []);
  }
  ok('курс полностью пройден событиями (нет тупиковых шагов)', u.tutorial.done === true);
  eq('пройдены все шаги', u.tutorial.step, c.TUTORIAL.length);

  console.log('\n[3] Новые daily-счётчики: earsCut и saboteursBought');
  // saboteursBought бампится при покупке диверсантов
  const rec = Object.values(player.users()).find(x => x.name === 'Новобранец');
  rec.dollars = 1e15; rec.gold = 1e9; rec.level = 50;
  const d0 = daily.ensureDaily(rec).counters.saboteursBought || 0;
  saboteurs.buyPack(rec, 'ground', 1, []); // покупка пачки
  const d1 = daily.ensureDaily(rec).counters.saboteursBought || 0;
  ok('saboteursBought вырос после покупки', d1 > d0);
  // Поручения используют эти счётчики
  ok('есть поручение на earsCut', c.DAILY_QUESTS.some(q => q.counter === 'earsCut'));
  ok('есть поручение на saboteursBought', c.DAILY_QUESTS.some(q => q.counter === 'saboteursBought'));

  console.log('\n[4] Требование техники в спецоперации зависит от уровня операции');
  const easy = c.CONFLICTS[0].operations[0].steps[0];         // низкий уровень
  const hard = c.CONFLICTS[c.CONFLICTS.length-1].operations[0].steps[0]; // высокий
  ok('на низком уровне зазор к технике заметный', hard.require.units.minLevel > easy.require.units.minLevel);
  // На высоком конфликте требуемый уровень техники близок к уровню шага
  const hardStepLevel = c.CONFLICTS[c.CONFLICTS.length-1].minLevel; // ур. доступа шага op0/step0
  ok('на высоком уровне нужна техника ~уровня операции', hard.require.units.minLevel >= hardStepLevel - 5);

  console.log('\n[5] Поручения списка отдают персонажа и описание');
  rec.level = 100;
  const list = daily.list(rec);
  eq('в списке 9 поручений', list.quests.length, 9);
  ok('у поручения есть заказчик, роль и описание', list.quests.every(q => q.charName && q.charRole && q.flavor));
  ok('у поручения есть сложность и награда', list.quests.every(q => q.difficulty && q.reward && q.reward.dollars > 0));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
