// Тест новой механики сейфа: окно взлома выпадает ПОСЛЕ боя (а не до),
// с низким шансом и только при трофее «Медвежатник» ≥ 1.
// Запуск: node test/heistpostcombat.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const battle = require('../dist/src/services/battle');
const bankHack = require('../dist/src/services/bankHack');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

const usersMap = db.load('users', {});
for (const k of Object.keys(usersMap)) delete usersMap[k];
const now = Date.now();

function mkUser(id, name, opts) {
  opts = opts || {};
  return {
    id, name, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: false,
    emailVerified: true, country: 'ru', status: '', createdAt: now, lastSeen: now,
    level: 20, xp: 0, dollars: 1000, gold: 1e6, bank: opts.bank ?? 10000, skillPoints: 0,
    skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 },
    res: { hp: { cur: 100, max: 100, t: now }, en: { cur: 100, max: 100, t: now }, am: { cur: 9999, max: 9999, t: now } },
    units: opts.units || { ground_1: [1000, 0, 0] },
    workshops: 0, modernQueue: [], buildings: {}, secretDevs: {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0, earsCurrent: c.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 },
    counters: { wins: 0, attacks: 0, fatalities: 0, unitsBought: 0, buildingsBuilt: 0, missionStages: 0, earsCut: 0, moneyEarned: 0, battleLoot: 0, level: 20 },
    achStages: {}, missions: {}, tutorial: { step: 0, done: true }, effects: [],
    trophies: Object.fromEntries(c.TROPHIES.map((t) => [t.id, (opts.trophies || {})[t.id] || 0])),
    club: {}, allianceId: null, legionId: null, lastIncomeAt: now,
    pendingFatality: null, lastChatAt: 0, trophyQueue: [],
    pendingBankHack: null, bankHackCountToday: 0, bankHackVictimsToday: [],
    landmines: 0, pendingMineDefuse: null, recentAttacks: {},
  };
}

const notices = { push: () => {} };
const origRandom = Math.random;
// Хелпер: выполнить атаку с форсированным random (для детерминизма окна сейфа)
function attackWith(attacker, targetId, rnd) {
  attacker.lastAttackAt = 0;
  attacker.pendingBankHack = null;
  attacker.pendingFatality = null;
  Math.random = rnd;
  try { return battle.attack(attacker, targetId, notices); }
  finally { Math.random = origRandom; }
}

console.log('\n[1] Атака НЕ возвращает окно сейфа ДО боя — сразу идёт бой');
const A = mkUser('u_a', 'Медвежатник', { trophies: { safecracker: 5 } });
const V = mkUser('u_v', 'Жертва', { bank: 100000 });
usersMap['u_a'] = A; usersMap['u_v'] = V;
// random=0.999 → сейф НЕ выпадает (0.999*100=99.9 >= шанс) — чистый бой
const r1 = attackWith(A, 'u_v', () => 0.999);
ok('вернулся результат боя (есть поле win)', typeof r1.win === 'boolean');
ok('окно сейфа НЕ выпало', r1.encounter !== 'bank_hack');
eq('сейф не висит', A.pendingBankHack, null);
eq('боеприпас потрачен (бой прошёл)', A.res.am.cur, 9998);

console.log('\n[2] Сейф выпадает ПОСЛЕ боя (результат боя + окно вместе)');
V.bank = 100000;
// random=0 → сейф выпадает (0 < шанс). Бой при этом уже прошёл.
const r2 = attackWith(A, 'u_v', () => 0);
ok('в ответе есть результат боя (win задан)', typeof r2.win === 'boolean');
eq('в ответе есть окно сейфа', r2.encounter, 'bank_hack');
ok('pendingBankHack выставлен ПОСЛЕ боя', !!A.pendingBankHack);
eq('цель окна = жертва', r2.targetName, 'Жертва');
ok('бой реально прошёл (attacks увеличился)', A.battle.attacks >= 2);

console.log('\n[3] Взлом решается без повторного боя');
const attacksBefore = A.battle.attacks;
const amBefore = A.res.am.cur;
const code = A.pendingBankHack.code;
const g = battle.bankHackGuess(A, code, notices);
ok('взлом завершён', g.safeResolved === true && !!g.bankHack);
eq('pendingBankHack очищен', A.pendingBankHack, null);
eq('повторного боя не было (attacks не изменился)', A.battle.attacks, attacksBefore);
eq('боеприпас не тратился повторно', A.res.am.cur, amBefore);

console.log('\n[4] Без трофея (ур.0) сейф не выпадает даже при random=0');
const B = mkUser('u_b', 'Новичок', { trophies: { safecracker: 0 } });
const V2 = mkUser('u_v2', 'Жертва2', { bank: 100000 });
usersMap['u_b'] = B; usersMap['u_v2'] = V2;
let sawSafe = false;
for (let i = 0; i < 20; i++) {
  V2.res.hp.cur = V2.res.hp.max; B.res.hp.cur = B.res.hp.max; // не «уйти в лазарет» от серии
  const r = attackWith(B, 'u_v2', () => 0);
  if (r.encounter === 'bank_hack') sawSafe = true;
  B.pendingBankHack = null;
}
ok('сейф ни разу не выпал без трофея', !sawSafe);

console.log('\n[5] Сейф не выпадает, если у жертвы пустой банк');
V.bank = 0;
A.bankHackVictimsToday = []; A.bankHackCountToday = 0; // изолируем причину — только пустой банк
let sawEmpty = false;
for (let i = 0; i < 20; i++) {
  V.res.hp.cur = V.res.hp.max; A.res.hp.cur = A.res.hp.max;
  const r = attackWith(A, 'u_v', () => 0);
  if (r.encounter === 'bank_hack') sawEmpty = true;
  A.pendingBankHack = null;
}
ok('сейф не выпал при пустом банке жертвы', !sawEmpty);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
