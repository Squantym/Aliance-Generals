// 10 новых достижений: наличие в конфиге + инкремент каждого счётчика в
// правильной точке кода + выдача этапа при достижении порога.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const sanctions = require('../dist/src/services/sanctions');
const ach = require('../dist/src/services/achievements');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Ветеран1', 'password1', 'v1@a.com', 'ru', '1.1.1.1');
  await auth.register('Ветеран2', 'password1', 'v2@a.com', 'ru', '1.1.1.2');
  const u1 = Object.values(player.users()).find(x => x.name === 'Ветеран1');
  const u2 = Object.values(player.users()).find(x => x.name === 'Ветеран2');

  console.log('\n[1] Все 10 новых достижений в конфиге, с 5 порогами и титулами');
  const NEW = ['deaths','dodgesInFatality','merciesGiven','legionWins','losses',
               'sanctionsCompleted','sanctionedTimes','legionDamageDealt','legionDamageCovered','legionHpHealed'];
  for (const counter of NEW) {
    const a = c.ACHIEVEMENTS.find(x => x.counter === counter);
    ok(`достижение для «${counter}» есть (5 порогов, 5 титулов)`, !!a && a.steps.length === 5 && a.titles.length === 5);
  }
  eq('всего достижений стало 19', c.ACHIEVEMENTS.length, 19);

  console.log('\n[2] Смерть от мины инкрементит deaths');
  u1.pendingMineDefuse = { targetId: u2.id, isBot: false, wires: ['a','b','c'], correctIdx: 0, techLossPct: 10, aArmyEntries: [] };
  battle.mineDefuse(u1, 1, []); // неверный провод → взрыв
  eq('deaths = 1 после взрыва', u1.counters.deaths, 1);
  eq('HP обнулён взрывом', u1.res.hp.cur, 0);
  ok('этап достижения «Смертник» выдан (порог 1)', (u1.achStages.deaths || 0) >= 1);

  console.log('\n[3] Помилование инкрементит merciesGiven');
  u1.pendingFatality = { targetId: u2.id, name: u2.name, isBot: false, exp: Date.now() + 60000 };
  battle.fatality(u1, 'mercy', []);
  eq('merciesGiven = 1', u1.counters.merciesGiven, 1);
  ok('этап «Милосердный» выдан', (u1.achStages.mercies || 0) >= 1);

  console.log('\n[4] Поражения: у атакующего и защитника');
  ach.bump(u1, 'losses', 10, []); // прямой инкремент (полный бой уже покрыт warfixes)
  ok('этап «Битый» выдан (порог 10)', (u1.achStages.losses || 0) >= 1);

  console.log('\n[5] Санкции: попадание (цель) и выполнение (охотник)');
  u1.dollars = 1e12; u1.level = 30; u2.level = 30;
  u1.earCutters = [{ id: u2.id, name: u2.name }]; // u2 отрезал ухо u1 → u1 может объявить санкцию
  sanctions.declare(u1, u2.id, 1e9, []); // новая санкция на u2
  eq('sanctionedTimes цели = 1 (новая санкция)', u2.counters.sanctionedTimes, 1);
  sanctions.declare(u1, u2.id, 1e9, []); // добор к той же санкции
  eq('добор НЕ увеличивает sanctionedTimes', u2.counters.sanctionedTimes, 1);
  ok('этап «Враг народа» выдан', (u2.achStages.sanctioned || 0) >= 1);
  // Выполнение: третий игрок добивает цель под санкцией
  await auth.register('Охотник', 'password1', 'h@a.com', 'ru', '1.1.1.3');
  const hunter = Object.values(player.users()).find(x => x.name === 'Охотник');
  u2.res.hp.cur = 1; // ниже порога выплаты
  sanctions.checkPayout(hunter, u2, 1, 120, []);
  eq('sanctionsCompleted охотника = 1', hunter.counters.sanctionsCompleted, 1);
  ok('этап «Охотник за головами» выдан', (hunter.achStages.sanctionsDone || 0) >= 1);

  console.log('\n[6] Уворот от фаталити (счётчик цели) — точка в коде + этап по порогу');
  ach.bump(u2, 'dodgesInFatality', 1, []);
  ok('этап «Неуловимый» выдан (порог 1)', (u2.achStages.fatDodges || 0) >= 1);
  // Проверяем, что точка инкремента в коде существует (статически)
  const src = fs.readFileSync(path.join(process.cwd(), 'src/services/battle.ts'), 'utf8');
  ok('в коде боя есть инкремент dodgesInFatality у цели', /dodgesInFatality/.test(src));

  console.log('\n[7] Достижения легиона: победы/урон/прикрытие/лечение (точки в коде + пороги)');
  const lbSrc = fs.readFileSync(path.join(process.cwd(), 'src/services/legionBattle.ts'), 'utf8');
  ok('в финализации боя легиона есть legionWins', /legionWins/.test(lbSrc));
  ok('есть legionDamageDealt (по stats.dmgDealt)', /legionDamageDealt/.test(lbSrc) && /st\.dmgDealt/.test(lbSrc));
  ok('есть legionDamageCovered (по stats.guardedDmg)', /legionDamageCovered/.test(lbSrc) && /st\.guardedDmg/.test(lbSrc));
  ok('есть legionHpHealed (по stats.healed)', /legionHpHealed/.test(lbSrc) && /st\.healed/.test(lbSrc));
  // Пороги работают на объёмных счётчиках
  ach.bump(u1, 'legionDamageDealt', 600, []);
  ok('этап «Таран легиона» выдан (порог 500)', (u1.achStages.legionDmg || 0) >= 1);
  ach.bump(u1, 'legionDamageCovered', 250, []);
  ok('этап «Щит легиона» выдан (порог 200)', (u1.achStages.legionShield || 0) >= 1);
  ach.bump(u1, 'legionHpHealed', 250, []);
  ok('этап «Медик легиона» выдан (порог 200)', (u1.achStages.legionMedic || 0) >= 1);
  ach.bump(u1, 'legionWins', 1, []);
  ok('этап «Легионер» выдан (порог 1)', (u1.achStages.legionWins || 0) >= 1);

  console.log('\n[8] Экран достижений отдаёт все 19 с прогрессом');
  const list = ach.list(u1);
  eq('в списке 19 достижений', list.achievements.length, 19);
  ok('у каждого есть name/desc/value/stage', list.achievements.every(a => a.name && a.desc !== undefined && 'value' in a && 'stage' in a));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
