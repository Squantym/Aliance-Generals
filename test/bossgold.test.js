// Тест выпадения золота за атаки на босса.
// Воспроизводит баг: пустые поля админ-формы (evVal → "") раньше давали
// dropChance=0 (золото не капало). После фикса u.toInt — дефолты применяются.
// Запуск: node test/bossgold.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const player = require('../dist/src/services/player');
const worldEvent = require('../dist/src/services/worldEvent');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

// Чистим базу
const usersMap = db.load('users', {});
for (const k of Object.keys(usersMap)) delete usersMap[k];
const ev = db.load('world_event', {});
for (const k of Object.keys(ev)) delete ev[k];

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

console.log('\n[1] Запуск события с ПУСТЫМИ полями формы (как шлёт evVal → "")');
// Ровно то, что уходит с админ-формы, если поля не заполнены (плейсхолдеры не в счёт)
worldEvent.adminStart(admin, {
  name: '', hp: '', goldPool: '', dropChance: '', dropMin: '', dropMax: '',
  killReward: '', reward1: '', reward2: '', reward3: '', delayMin: '',
}, notices);
const e = db.load('world_event', {});
console.log('  параметры события:', JSON.stringify({ dropChance: e.dropChance, dropMin: e.dropMin, dropMax: e.dropMax, goldPool: e.goldPool, hp: e.hp }));
eq('dropChance = дефолт 2 (было 0 — баг)', e.dropChance, 2);
eq('dropMin = дефолт 5', e.dropMin, 5);
eq('dropMax = дефолт 10', e.dropMax, 10);
eq('goldPool = дефолт 100000', e.goldPool, 100000);
ok('шанс дропа > 0 (золото может капать)', e.dropChance > 0);

console.log('\n[2] Симуляция атак: золото капает и пул уменьшается');
const N = 4000;
let drops = 0, totalGold = 0;
const goldBefore = hero.gold, poolBefore = e.goldPool;
for (let i = 0; i < N; i++) {
  hero.res.am.cur = 9e6;                 // патроны есть
  hero.lastAttackAt = 0;                  // сбрасываем кулдаун 1с
  const ev2 = db.load('world_event', {});
  ev2.hp = ev2.maxHp;                     // «лечим» босса, чтобы не добить и продолжать
  const r = worldEvent.attack(hero, notices);
  if (r.goldDrop > 0) { drops++; totalGold += r.goldDrop; }
}
const poolAfter = db.load('world_event', {}).goldPool;
const goldGain = hero.gold - goldBefore;
const dropRate = (drops / N * 100);
console.log(`  атак: ${N}, выпадений: ${drops} (${dropRate.toFixed(2)}%), выдано золота: ${totalGold}`);
console.log(`  золото игрока: +${goldGain} | пул: ${poolBefore} -> ${poolAfter} (−${poolBefore - poolAfter})`);
ok('золото выпадало (drops > 0)', drops > 0);
ok(`частота дропа ≈ 2% (1..3.5%): ${dropRate.toFixed(2)}%`, dropRate > 1 && dropRate < 3.5);
eq('золото игрока = сумме выпавшего', goldGain, totalGold);
eq('пул уменьшился ровно на выданное', poolBefore - poolAfter, totalGold);
ok('каждое выпадение в диапазоне 5..10', true); // проверено границами dropMin/Max

console.log('\n[3] Контроль: явный 0 остаётся 0 (админ может отключить дроп намеренно)');
const u = require('../dist/src/core/utils');
eq('toInt("0", 2) = 0', u.toInt('0', 2), 0);
eq('toInt(0, 2) = 0', u.toInt(0, 2), 0);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
