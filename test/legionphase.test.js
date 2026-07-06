// Тест перехода фаз легион-боя: ленивый prep→active при опросе (без ожидания
// 30-сек фонового тика) — причина «чёрного экрана» и «не пускает в бой».
// Запуск: node test/legionphase.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const lb = require('../dist/src/services/legionBattle');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

const um = db.load('users', {}); const lm = db.load('legions', {}); const bm = db.load('battles', {});
function reset() { for (const m of [um, lm, bm]) for (const k of Object.keys(m)) delete m[k]; }
const now = Date.now();

function mkUser(id) {
  return { id, name: id, email: id + '@t.t', passHash: 'x', salt: 'x', country: 'ru', status: '', createdAt: now, lastSeen: now, level: 20, xp: 0, dollars: 0, gold: 0, bank: 0, skillPoints: 0, skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 }, res: { hp: { cur: 100, max: 100, t: now }, en: { cur: 50, max: 100, t: now }, am: { cur: 7, max: 100, t: now } }, units: {}, buildings: {}, secretDevs: {}, superSecret: 0, ears: 0, tokens: 0, earsLost: 0, earsCurrent: 2, earsLostAt: [], battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 }, counters: {}, trophies: {}, effects: [], allianceId: null, legionId: null, lastIncomeAt: now, saboteurs: { ground: 0, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 }, saboteurLimits: { ground: 50, sea: 50, air: 50, secret: 50, building: 50 }, silos: [] };
}
function mkC(id, side, dir) { um[id] = mkUser(id); return { userId: id, name: id, side, role: 'assault', roleMul: { atk: 1, def: 1, dmgReduce: 0 }, hp: 100, maxHp: 100, shield: 0, direction: dir, ready: false, readyAt: 0, lastActionAt: 0, lastMoveAt: 0, lastItemAt: 0, gear: [], statusEffects: [], alive: true, stats: { dmgDealt: 0, dmgTaken: 0, healed: 0, kills: 0, guards: 0, itemsUsed: 0 } }; }
function setupBattle(opts) {
  reset();
  lm['lA'] = { id: 'lA', name: 'A', activeBattle: { battleId: 'B1' }, arsenal: {}, battleBuildings: {} };
  lm['lB'] = { id: 'lB', name: 'B', activeBattle: { battleId: 'B1' }, arsenal: {}, battleBuildings: {} };
  const v = mkC('u_v', 'A', opts.dir ?? null); um['u_v'].legionId = 'lA';
  const combatants = { u_v: v };
  if (!opts.noEnemy) combatants.u_e = mkC('u_e', 'B', opts.dir ?? null);
  bm['B1'] = Object.assign({
    id: 'B1', legionA: 'lA', legionB: 'lB', legionAName: 'A', legionBName: 'B',
    startedAt: now - 70000, combatants, gear: {}, guardLinks: {}, guardExpiry: {}, log: [], activity: {},
  }, opts.battle);
  return v;
}

console.log('\n[1] Ленивый prep→active при опросе состояния');
setupBattle({ battle: { phase: 'prep', prepEndsAt: now - 2000 } }); // таймер истёк, фаза ещё prep
eq('до опроса фаза prep', bm['B1'].phase, 'prep');
const st = lb.battleState(um['u_v']);
eq('в ответе фаза active', st.battle.phase, 'active');
eq('в хранилище фаза active', bm['B1'].phase, 'active');
ok('activeEndsAt проставлен', !!bm['B1'].activeEndsAt);
eq('таймер боя в ответе > 0', st.battle.timeLeft > 0, true);

console.log('\n[2] Авто-готовность и балансировка направления при переходе');
eq('направление проставлено авто', bm['B1'].combatants.u_v.direction, 1);
eq('боец помечен ready', bm['B1'].combatants.u_v.ready, true);

console.log('\n[3] Пока таймер prep НЕ истёк — фаза остаётся prep');
setupBattle({ battle: { phase: 'prep', prepEndsAt: now + 30000 } });
const st2 = lb.battleState(um['u_v']);
eq('фаза всё ещё prep', st2.battle.phase, 'prep');
ok('prepSecsLeft > 0', st2.battle.prepSecsLeft > 0);

console.log('\n[4] no-show: одна сторона пуста → бой сразу завершается');
setupBattle({ noEnemy: true, battle: { phase: 'prep', prepEndsAt: now - 2000 } });
const st3 = lb.battleState(um['u_v']);
ok('бой завершён (нет боя в ответе или phase done)', !st3.battle || st3.battle.phase === 'done' || bm['B1'].phase === 'done');

console.log('\n[5] Завершение активной фазы по истечении времени (ленивое)');
setupBattle({ dir: 1, battle: { phase: 'active', activeStartAt: now - 100000, activeEndsAt: now - 2000 } });
lb.battleState(um['u_v']);
eq('активная фаза завершилась', bm['B1'].phase, 'done');

console.log('\n[6] tickAllBattles по-прежнему двигает фазу (общий тик)');
setupBattle({ battle: { phase: 'prep', prepEndsAt: now - 2000 } });
lb.tickAllBattles(lm, um);
eq('фоновый тик перевёл prep→active', bm['B1'].phase, 'active');

console.log('\n[7] Активная фаза: DoT НЕ тикает лениво (только фоновый тик)');
setupBattle({ dir: 1, battle: { phase: 'active', activeStartAt: now, activeEndsAt: now + 600000 } });
// вешаем ядовитый эффект и опрашиваем состояние несколько раз — HP не должно
// падать от опросов (иначе DoT ускорялся бы от частых poll)
bm['B1'].combatants.u_v.statusEffects = [{ type: 'dot', expiresAt: now + 600000, dmg: 10 }];
const hp0 = bm['B1'].combatants.u_v.hp;
lb.battleState(um['u_v']); lb.battleState(um['u_v']); lb.battleState(um['u_v']);
eq('HP не изменилось от опросов (DoT не лениво)', bm['B1'].combatants.u_v.hp, hp0);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
