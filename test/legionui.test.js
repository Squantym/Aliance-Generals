// Тест переработки боевого окна легиона:
//  1) приватность ресурсов (ammo/energy видит только сам игрок, HP виден всем);
//  2) послебоевой экран доступен после завершения (и после обнуления связи);
//  3) топ-3 по урону/лечению/защите/убийствам в финальном отчёте.
// Запуск: node test/legionui.test.js  (после npm run build)
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
  return { id, name: id, email: id + '@t.t', passHash: 'x', salt: 'x', country: 'ru', status: '', createdAt: now, lastSeen: now, level: 20, xp: 0, dollars: 0, gold: 0, bank: 0, skillPoints: 0, skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 }, res: { hp: { cur: 100, max: 100, t: now }, en: { cur: 44, max: 100, t: now }, am: { cur: 9, max: 100, t: now } }, units: {}, buildings: {}, secretDevs: {}, superSecret: 0, ears: 0, tokens: 0, earsLost: 0, earsCurrent: 2, earsLostAt: [], battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 }, counters: {}, trophies: {}, effects: [], allianceId: null, legionId: 'lA', lastIncomeAt: now, saboteurs: { ground: 0, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 }, saboteurLimits: { ground: 50, sea: 50, air: 50, secret: 50, building: 50 }, silos: [] };
}
function mkC(id, side, dir, stats) {
  um[id] = mkUser(id); um[id].legionId = side === 'A' ? 'lA' : 'lB';
  return { userId: id, name: id, side, role: 'assault', roleMul: { atk: 1, def: 1, dmgReduce: 0 }, hp: 80, maxHp: 100, shield: 0, direction: dir, ready: true, readyAt: now, lastActionAt: 0, lastMoveAt: 0, lastItemAt: 0, gear: [], statusEffects: [], alive: true, stats: Object.assign({ dmgDealt: 0, dmgTaken: 0, healed: 0, kills: 0, guards: 0, itemsUsed: 0 }, stats || {}) };
}
function setup(battleOver) {
  reset();
  lm['lA'] = { id: 'lA', name: 'Альфа', activeBattle: { battleId: 'B1' }, arsenal: {}, battleBuildings: {}, reserves: 1000, battleStats: { wins: 0, losses: 0 } };
  lm['lB'] = { id: 'lB', name: 'Браво', activeBattle: { battleId: 'B1' }, arsenal: {}, battleBuildings: {}, reserves: 1000, battleStats: { wins: 0, losses: 0 } };
  const v = mkC('u_v', 'A', 1, { dmgDealt: 300, healed: 0, guards: 5, kills: 2 });
  const a2 = mkC('u_a2', 'A', 1, { dmgDealt: 150, healed: 400, guards: 1, kills: 0 });
  const e1 = mkC('u_e1', 'B', 1, { dmgDealt: 200, healed: 50, guards: 3, kills: 1 });
  const e2 = mkC('u_e2', 'B', 1, { dmgDealt: 90, healed: 0, guards: 8, kills: 0 });
  bm['B1'] = { id: 'B1', legionA: 'lA', legionB: 'lB', legionAName: 'Альфа', legionBName: 'Браво', startedAt: now - 100, prepEndsAt: now - 100, activeStartAt: now - 100, activeEndsAt: battleOver ? now - 1000 : now + 3600000, phase: 'active', combatants: { u_v: v, u_a2: a2, u_e1: e1, u_e2: e2 }, gear: {}, guardLinks: {}, guardExpiry: {}, log: [], activity: {} };
  return v;
}

console.log('\n[1] Приватность: свои ammo/energy вижу, чужие скрыты, HP виден');
setup(false);
const st = lb.battleState(um['u_v']).battle;
const dir = st.directions.find(d => d.dir === 1);
const meView = st.me;
const enemy = dir.enemies.find(x => x.userId === 'u_e1');
const ally = dir.allies.find(x => x.userId === 'u_a2');
ok('свои ammo видны', meView.ammo !== null && meView.ammo !== undefined);
ok('своя energy видна', meView.energy !== null && meView.energy !== undefined);
eq('ammo врага скрыт', enemy.ammo, null);
eq('energy врага скрыта', enemy.energy, null);
eq('ammo союзника скрыт', ally.ammo, null);
eq('energy союзника скрыта', ally.energy, null);
ok('HP врага виден (для таргета)', enemy.hp != null && enemy.maxHp != null);
ok('HP союзника виден', ally.hp != null);

console.log('\n[2] Послебоевой экран: итоги при завершении по времени');
setup(true);
const done1 = lb.battleState(um['u_v']).battle;
eq('фаза done', done1.phase, 'done');
ok('есть finalReport', !!done1.finalReport);
ok('есть мой боец со статой', done1.me && done1.me.stats && done1.me.stats.dmgDealt === 300);
ok('есть победитель', done1.winningSide === 'A' || done1.winningSide === 'B');

console.log('\n[3] Итоги доступны после обнуления activeBattle (грейс-период)');
eq('activeBattle обнулён', !!lm['lA'].activeBattle, false);
const done2 = lb.battleState(um['u_v']).battle;
ok('итоги всё ещё отдаются', done2 && done2.phase === 'done' && !!done2.finalReport);

console.log('\n[4] Топ-3 по характеристикам в отчёте');
const r = done2.finalReport;
ok('есть top3', !!r.top3);
ok('топ урона отсортирован по убыванию', r.top3.damage[0].value >= r.top3.damage[r.top3.damage.length - 1].value);
eq('лидер урона — u_v (300)', r.top3.damage[0].name, 'u_v');
eq('значение топ-урона', r.top3.damage[0].value, 300);
eq('лидер лечения — u_a2 (400)', r.top3.healing[0].name, 'u_a2');
eq('лидер защиты — u_e2 (8 прикрытий)', r.top3.defense[0].name, 'u_e2');
ok('топ-3 не длиннее 3', r.top3.damage.length <= 3 && r.top3.healing.length <= 3 && r.top3.defense.length <= 3);
ok('в топе урона только с уроном > 0', r.top3.damage.every(x => x.value > 0));
ok('есть топ убийств', Array.isArray(r.top3.kills));
eq('лидер убийств — u_v (2)', r.top3.kills[0].name, 'u_v');

console.log('\n[5] Грейс-период истёк → итоги больше не отдаются');
bm['B1'].finishedAt = now - (11 * 60 * 1000); // 11 минут назад (грейс 10 мин)
const afterGrace = lb.battleState(um['u_v']).battle;
eq('после грейса боя нет', afterGrace, null);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
