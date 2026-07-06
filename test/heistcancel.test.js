// Тест отмены окна сейфа (bank-hack/cancel): уход с окна снимает
// блокировку атаки без боя и не тратит суточный лимит попыток.
// Запуск: node test/heistcancel.test.js  (после npm run build)
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
    trophies: Object.fromEntries(c.TROPHIES.map((t) => [t.id, 0])),
    club: {}, allianceId: null, legionId: null, lastIncomeAt: now,
    pendingFatality: null, lastChatAt: 0, trophyQueue: [],
    pendingBankHack: null, bankHackCountToday: 0, bankHackVictimsToday: [],
    landmines: 0, pendingMineDefuse: null, recentAttacks: {},
  };
}

const A = mkUser('u_a', 'Атакующий');
const V = mkUser('u_v', 'Жертва', { bank: 50000 });
usersMap['u_a'] = A;
usersMap['u_v'] = V;
const notices = { push: () => {} };

console.log('\n[1] cancel без открытого сейфа — безопасно, возвращает false');
eq('bankHack.cancel(null) = false', bankHack.cancel(A), false);
eq('battle.bankHackCancel(null).cancelled = false', battle.bankHackCancel(A).cancelled, false);
eq('сейф так и не появился', A.pendingBankHack, null);

console.log('\n[2] Открываем сейф вручную и отменяем');
A.pendingBankHack = {
  targetId: 'u_v', targetName: 'Жертва', bankAmount: 50000,
  code: '1234', digits: 4, triesLeft: 5, maxTries: 5, history: [],
};
ok('сейф открыт', !!A.pendingBankHack);
const res = battle.bankHackCancel(A);
eq('cancelled = true', res.cancelled, true);
eq('pendingBankHack снят', A.pendingBankHack, null);

console.log('\n[3] Отмена НЕ тратит суточный лимит и не помечает жертву');
eq('счётчик попыток за день = 0', A.bankHackCountToday, 0);
eq('список жертв за день пуст', A.bankHackVictimsToday.length, 0);

console.log('\n[4] С открытым сейфом атака заблокирована, после отмены — нет');
A.pendingBankHack = {
  targetId: 'u_v', targetName: 'Жертва', bankAmount: 50000,
  code: '1234', digits: 4, triesLeft: 5, maxTries: 5, history: [],
};
let blocked = false, blockMsg = '';
try { battle.attack(A, 'u_v', notices); } catch (e) { blocked = true; blockMsg = e.message; }
ok('атака заблокирована сейфом', blocked && /сейф/i.test(blockMsg));

// Отменяем сейф. Чтобы атака после отмены не открыла НОВЫЙ сейф, исчерпаем
// суточный лимит предложений (tryOffer вернёт null → сразу бой).
battle.bankHackCancel(A);
A.bankHackCountToday = c.BANK_HACK.perDay;
A.lastAttackAt = 0; // сбрасываем антиспам-кулдаун
let safeErr = false;
try { battle.attack(A, 'u_v', notices); }
catch (e) { if (/сейф/i.test(e.message)) safeErr = true; }
ok('после отмены атака НЕ блокируется сейфом', !safeErr);
eq('после боя сейфа снова нет', A.pendingBankHack, null);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
