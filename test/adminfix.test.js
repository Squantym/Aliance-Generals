// Тесты: (1) сброс миссий в админке чистит реальные поля прогресса;
// (2) живой рейтинг по урону в активном событии.
// Запуск: node test/adminfix.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const admin = require('../dist/src/services/admin');
const worldEvent = require('../dist/src/services/worldEvent');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

const usersMap = db.load('users', {});
for (const k of Object.keys(usersMap)) delete usersMap[k];
const now = Date.now();
function mkUser(id, name, isAdmin) {
  return {
    id, name, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: !!isAdmin,
    emailVerified: true, country: 'ru', status: '', createdAt: now, lastSeen: now,
    level: 20, xp: 0, dollars: 1e6, gold: 0, bank: 0, skillPoints: 0,
    skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 },
    res: { hp: { cur: 5000, t: now }, en: { cur: 100, t: now }, am: { cur: 100, t: now } },
    units: {}, workshops: 0, modernQueue: [], buildings: {}, secretDevs: {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0, earsCurrent: c.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    earCutters: [null, null], earMessage: null,
    battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 },
    counters: { wins: 0, attacks: 0, fatalities: 0, unitsBought: 0, buildingsBuilt: 0, missionStages: 7, earsCut: 0, moneyEarned: 0, battleLoot: 0, level: 20 },
    achStages: {}, missions: {}, tutorial: { step: 3, done: false }, effects: [],
    trophies: Object.fromEntries(c.TROPHIES.map((t) => [t.id, 0])),
    club: {}, allianceId: null, legionId: null, lastIncomeAt: now,
    pendingFatality: null, lastChatAt: 0, trophyQueue: [],
    // Реальный прогресс миссий:
    missionProgress: { conf_1: { completed: 2, firstReward: true, ops: { 0: 3, 1: 2 } } },
    missionQueue: [{ id: 'q1', confId: 'conf_1', opIdx: 1, stepIdx: 2, finishesAt: now + 60000, xp: 10, money: 100 }],
  };
}
const adminU = mkUser('u_admin', 'Админ', true);
const hero = mkUser('u_hero', 'Боец', false);
const hero2 = mkUser('u_hero2', 'Боец2', false);
usersMap['u_admin'] = adminU;
usersMap['u_hero'] = hero;
usersMap['u_hero2'] = hero2;
const notices = { push: () => {} };

console.log('\n[1] Сброс миссий у одного игрока (resetParam) чистит РЕАЛЬНЫЕ поля');
// до сброса — прогресс есть
ok('до сброса: missionProgress не пуст', Object.keys(hero.missionProgress).length > 0);
ok('до сброса: missionQueue не пуст', hero.missionQueue.length > 0);
admin.resetParam(adminU, { param: 'missions', userId: 'u_hero' }, notices);
eq('missionProgress очищен', Object.keys(hero.missionProgress).length, 0);
eq('missionQueue очищен', hero.missionQueue.length, 0);
eq('counters.missionStages = 0', hero.counters.missionStages, 0);
// hero2 не тронут
ok('другой игрок не затронут (userId точечный)', Object.keys(hero2.missionProgress).length > 0);

console.log('\n[2] Сброс миссий у ВСЕХ (resetMissions) — не трогает админов');
admin.resetMissions(adminU, {}, notices);
eq('hero2.missionProgress очищен', Object.keys(hero2.missionProgress).length, 0);
eq('hero2.missionQueue очищен', hero2.missionQueue.length, 0);
// админ (adminU) — в reset у всех пропускается (t.isAdmin continue), его прогресс не трогаем
ok('админ пропущен при сбросе у всех', Object.keys(adminU.missionProgress).length > 0);

console.log('\n[3] Полный сброс аккаунта тоже чистит missionProgress/missionQueue');
const victim = mkUser('u_victim', 'Жертва', false);
usersMap['u_victim'] = victim;
admin.resetAccount(adminU, { userId: 'u_victim' }, notices);
eq('resetAccount: missionProgress пуст', Object.keys(victim.missionProgress).length, 0);
eq('resetAccount: missionQueue пуст', victim.missionQueue.length, 0);
eq('resetAccount: missionStages = 0', victim.counters.missionStages, 0);

console.log('\n[4] Живой рейтинг по урону в активном событии');
const ev = db.load('world_event', {});
for (const k of Object.keys(ev)) delete ev[k];
Object.assign(ev, {
  active: true, name: 'Босс', hp: 5000, maxHp: 10000,
  goldPool: 1000, dropMin: 5, dropMax: 10, dropChance: 2,
  killReward: 100, reward1: 300, reward2: 200, reward3: 100,
  contributors: { u_hero: 500, u_hero2: 1200, u_admin: 800 },
  attacks: { u_hero: 5, u_hero2: 12, u_admin: 8 },
  names: { u_hero: 'Боец', u_hero2: 'Боец2', u_admin: 'Админ' },
});
const v = worldEvent.view(hero); // смотрит Боец (u_hero)
ok('в ответе есть ranking', Array.isArray(v.ranking));
eq('участников в рейтинге', v.ranking.length, 3);
eq('1 место — Боец2 (урон 1200)', v.ranking[0].name, 'Боец2');
eq('1 место урон', v.ranking[0].damage, 1200);
eq('2 место — Админ (800)', v.ranking[1].name, 'Админ');
eq('3 место — Боец (500)', v.ranking[2].name, 'Боец');
ok('в записи есть attacks', v.ranking[0].attacks === 12);
eq('myRank для Бойца = 3', v.myRank, 3);
eq('myDamage для Бойца = 500', v.myDamage, 500);
// Игрок, не участвовавший — myRank 0
const outsider = mkUser('u_out', 'Новичок', false);
usersMap['u_out'] = outsider;
eq('не участвовал → myRank 0', worldEvent.view(outsider).myRank, 0);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
