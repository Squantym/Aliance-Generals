// Тест: предмет боевого пояса РАСХОДУЕТСЯ и исчезает из пояса везде
// (и у бойца combatant.gear, и в staging battle.gear, и в battleState).
// Регрессия на баг рассинхронизации (splice бойца не обновлял battle.gear).
// Запуск: node test/battleitems.test.js  (после npm run build)
const assert = require('assert');
const db = require('../dist/src/core/db');
const lb = require('../dist/src/services/legionBattle');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

const um = db.load('users', {}); const lm = db.load('legions', {}); const bm = db.load('battles', {});
for (const m of [um, lm, bm]) for (const k of Object.keys(m)) delete m[k];
const now = Date.now();

function mkUser(id) {
  return { id, name: id, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: false, country: 'ru', status: '', createdAt: now, lastSeen: now, level: 60, xp: 0, dollars: 0, gold: 0, bank: 0, skillPoints: 0, skills: { energy: 20, health: 20, ammo: 20, cruelty: 0, agility: 0 }, res: { hp: { cur: 200, t: now }, en: { cur: 200, t: now }, am: { cur: 100, t: now } }, units: {}, workshops: 0, modernQueue: [], buildings: {}, secretDevs: {}, superSecret: 0, ears: 0, tokens: 0, earsCurrent: 2, battle: {}, counters: {}, effects: [], trophies: {}, allianceId: null, legionId: 'lA', saboteurs: {}, saboteurLimits: {}, silos: [], lasers: [], mines: [] };
}
const V = mkUser('u_v');
um['u_v'] = V;
lm['lA'] = { id: 'lA', name: 'Альфа', leaderId: 'u_v', members: ['u_v'], battleBuildings: {}, arsenal: {}, activeBattle: { battleId: 'B1', enemyId: 'lB' } };
lm['lB'] = { id: 'lB', name: 'Браво', leaderId: 'x', members: [], battleBuildings: {}, arsenal: {} };

function combatant(id, side, dir) {
  return { userId: id, name: id, side, role: 'assault', roleMul: { atk: 1, def: 1, dmgReduce: 0 }, hp: 150, maxHp: 200, shield: 0, direction: dir, ready: true, readyAt: now, lastActionAt: 0, lastMoveAt: 0, lastItemAt: 0, gear: ['dome', 'medkit'], statusEffects: [], alive: true, stats: { dmgDealt: 0, dmgTaken: 0, healed: 0, kills: 0, guards: 0, itemsUsed: 0 } };
}
const cv = combatant('u_v', 'A', 1);
bm['B1'] = {
  id: 'B1', legionA: 'lA', legionB: 'lB', legionAName: 'Альфа', legionBName: 'Браво',
  startedAt: now - 1000, prepEndsAt: now - 1000, activeStartAt: now - 1000, activeEndsAt: now + 3600000,
  phase: 'active', combatants: { u_v: cv },
  // staging-пояс — ОТДЕЛЬНЫЙ массив (как после gearPick с .slice())
  gear: { u_v: ['dome', 'medkit'] },
  guardLinks: {}, guardExpiry: {}, log: [], activity: {},
};

console.log('\n[1] До применения предмет есть везде');
ok('в поясе бойца есть dome', bm['B1'].combatants.u_v.gear.includes('dome'));
ok('в staging battle.gear есть dome', bm['B1'].gear.u_v.includes('dome'));
const before = lb.battleState(V).battle;
ok('battleState.myGear содержит dome', (before.myGear || []).includes('dome'));

console.log('\n[2] Применяем dome (иммунитет, на себя)');
const N = [];
lb.useItem(V, 'dome', '', N);

console.log('\n[3] После применения предмет ИСЧЕЗ везде');
ok('из пояса бойца dome убран', !bm['B1'].combatants.u_v.gear.includes('dome'));
ok('из staging battle.gear dome убран (sync)', !bm['B1'].gear.u_v.includes('dome'));
const after = lb.battleState(V).battle;
ok('battleState.myGear больше не содержит dome', !(after.myGear || []).includes('dome'));
ok('второй предмет (medkit) на месте', bm['B1'].combatants.u_v.gear.includes('medkit'));
const beltNow = after.myGear || (after.me && after.me.gear) || [];
ok('в поясе (как видит фронт) остался ровно 1 предмет', beltNow.length === 1);
ok('этот предмет — medkit', beltNow[0] === 'medkit');

console.log('\n[4] Кулдаун предмета выставлен (нельзя сразу применить снова)');
let threw = false;
try { lb.useItem(V, 'medkit', '', N); } catch (e) { threw = true; }
ok('повторное применение блокируется кулдауном', threw);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
