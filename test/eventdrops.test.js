// Тест: (1) авто-восстановление дропа у старого «сломанного» события
// (dropChance/min/max == 0, но пул > 0); (2) живая настройка adminSetDrops.
// Запуск: node test/eventdrops.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const worldEvent = require('../dist/src/services/worldEvent');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

const usersMap = db.load('users', {});
for (const k of Object.keys(usersMap)) delete usersMap[k];
const now = Date.now();
function mkUser(id, name, admin) {
  return {
    id, name, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: !!admin,
    emailVerified: true, country: 'ru', status: '', createdAt: now, lastSeen: now,
    level: 20, xp: 0, dollars: 1e6, gold: 0, bank: 0, skillPoints: 0,
    skills: { energy: 0, health: 0, ammo: 999, cruelty: 0, agility: 0 },
    res: { hp: { cur: 9e6, t: now }, en: { cur: 9e6, t: now }, am: { cur: 9e6, t: now } },
    units: {}, workshops: 0, modernQueue: [], buildings: {}, secretDevs: {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0, earsCurrent: c.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 },
    counters: { wins: 0, attacks: 0, fatalities: 0, unitsBought: 0, buildingsBuilt: 0, missionStages: 0, earsCut: 0, moneyEarned: 0, battleLoot: 0, level: 20 },
    achStages: {}, missions: {}, tutorial: { step: 0, done: true }, effects: [],
    trophies: Object.fromEntries(c.TROPHIES.map((t) => [t.id, 0])),
    club: {}, allianceId: null, legionId: null, lastIncomeAt: now,
    pendingFatality: null, lastChatAt: 0, trophyQueue: [],
  };
}
const admin = mkUser('u_admin', 'Админ', true);
const hero = mkUser('u_hero', 'Боец', false);
usersMap['u_admin'] = admin;
usersMap['u_hero'] = hero;
const notices = { push: () => {} };

// Записываем СЛОМАННОЕ событие ровно как в проде: нулевые параметры дропа, пул есть
function setBrokenEvent() {
  const e = db.load('world_event', {});
  for (const k of Object.keys(e)) delete e[k];
  Object.assign(e, {
    active: true, name: 'Израильский тоцок Нетаньяхо',
    hp: 9971677, maxHp: 10000000,
    goldPool: 30000, dropChance: 0, dropMin: 0, dropMax: 0,   // ← баг: всё по нулям
    killReward: 3000, reward1: 3000, reward2: 2000, reward3: 1000,
    contributors: {}, attacks: {}, names: {}, startedAt: now, lastResult: null,
  });
  return e;
}

console.log('\n[1] Авто-восстановление: view() чинит нулевой дроп');
setBrokenEvent();
const v = worldEvent.view(hero);
eq('dropChance восстановлен на 2 (было 0)', v.dropChance, 2);
eq('dropMin восстановлен на 5', v.dropMin, 5);
eq('dropMax восстановлен на 10 (>0 → не «пул исчерпан»)', v.dropMax, 10);
ok('пул не тронут (30000)', v.goldPoolLeft === 30000);
// в БД тоже сохранилось
const eDb = db.load('world_event', {});
eq('в БД dropChance = 2', eDb.dropChance, 2);

console.log('\n[2] После починки золото реально капает и пул уменьшается');
let drops = 0, totalGold = 0;
const poolBefore = eDb.goldPool, goldBefore = hero.gold;
for (let i = 0; i < 3000; i++) {
  hero.res.am.cur = 9e6; hero.lastAttackAt = 0;
  const ev = db.load('world_event', {}); ev.hp = ev.maxHp; // лечим босса
  const r = worldEvent.attack(hero, notices);
  if (r.goldDrop > 0) { drops++; totalGold += r.goldDrop; }
}
const poolAfter = db.load('world_event', {}).goldPool;
console.log(`  атак: 3000, выпадений: ${drops}, золота: ${totalGold}, пул: ${poolBefore}->${poolAfter}`);
ok('золото выпадало (drops > 0)', drops > 0);
eq('золото игрока = сумме выпавшего', hero.gold - goldBefore, totalGold);
eq('пул уменьшился ровно на выданное', poolBefore - poolAfter, totalGold);

console.log('\n[3] Живая настройка adminSetDrops (шанс 30%, докинуть пул)');
setBrokenEvent();
worldEvent.view(hero); // авто-починка до 2%
const r2 = worldEvent.adminSetDrops(admin, { dropChance: 30, dropMin: 20, dropMax: 50, addGoldPool: 70000 }, notices);
eq('шанс стал 30%', r2.dropChance, 30);
eq('мин 20', r2.dropMin, 20);
eq('макс 50', r2.dropMax, 50);
eq('пул += 70000 (30000+70000)', r2.goldPoolLeft, 100000);
// пустые поля не трогают текущие значения
const r3 = worldEvent.adminSetDrops(admin, { dropChance: '', dropMin: '', dropMax: '', addGoldPool: '' }, notices);
eq('пустые поля не изменили шанс', r3.dropChance, 30);
eq('пустые поля не изменили пул', r3.goldPoolLeft, 100000);

console.log('\n[4] При шансе 30% дроп заметно чаще (~30%)');
let d2 = 0;
for (let i = 0; i < 3000; i++) {
  hero.res.am.cur = 9e6; hero.lastAttackAt = 0;
  const ev = db.load('world_event', {}); ev.hp = ev.maxHp;
  if (worldEvent.attack(hero, notices).goldDrop > 0) d2++;
}
const rate = d2 / 3000 * 100;
console.log(`  частота дропа при 30%: ${rate.toFixed(1)}%`);
ok(`частота ≈ 30% (26..34): ${rate.toFixed(1)}%`, rate > 26 && rate < 34);

console.log('\n[5] Намеренно отключённый дроп НЕ чинится (chance 0, но диапазон задан)');
const e5 = db.load('world_event', {});
for (const k of Object.keys(e5)) delete e5[k];
Object.assign(e5, { active: true, name: 'X', hp: 100, maxHp: 100, goldPool: 5000, dropChance: 0, dropMin: 5, dropMax: 10, contributors: {}, attacks: {}, names: {} });
const v5 = worldEvent.view(hero);
eq('явный dropChance 0 сохраняется (не авточинится)', v5.dropChance, 0);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
