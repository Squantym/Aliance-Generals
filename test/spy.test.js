// Тест системы разведки (трофей «Спутник-шпион»).
// Запуск: node test/spy.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const player = require('../dist/src/services/player');
const features = require('../dist/src/services/features');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, '❌ ' + name);
  passed++; console.log('  ✅ ' + name);
}
function eq(name, a, b) {
  assert.strictEqual(a, b, `❌ ${name}: получено ${a}, ожидалось ${b}`);
  passed++; console.log(`  ✅ ${name} (= ${a})`);
}
const near = (x, t) => Math.abs(x - t) < 1e-9;

// ---------------------------------------------------------------
console.log('\n[1] config.spyReveal — точность по уровням');
const R = (l) => c.spyReveal(l);
ok('ур.0: техника 50%',            near(R(0).units, 0.5));
ok('ур.0: постройки скрыты',        R(0).buildings === null);
ok('ур.0: секретки скрыты',         R(0).secrets === null);
ok('ур.1: техника 50%',            near(R(1).units, 0.5));
ok('ур.2: техника 62.5%',          near(R(2).units, 0.625));
ok('ур.3: техника 75%',            near(R(3).units, 0.75));
ok('ур.4: техника 87.5%',          near(R(4).units, 0.875));
ok('ур.5: техника 100%',           near(R(5).units, 1.0));
ok('ур.5: постройки 70%',          near(R(5).buildings, 0.70));
ok('ур.5: секретки ещё скрыты',    R(5).secrets === null);
ok('ур.6: постройки 85%',          near(R(6).buildings, 0.85));
ok('ур.7: постройки 100%',         near(R(7).buildings, 1.0));
ok('ур.7: секретки ещё скрыты',    R(7).secrets === null);
ok('ур.8: секретки 70%',           near(R(8).secrets, 0.70));
ok('ур.9: секретки 80%',           near(R(9).secrets, 0.80));
ok('ур.10: секретки 90% (не 100)', near(R(10).secrets, 0.90));
ok('ур.10: техника 100%',          near(R(10).units, 1.0));
ok('ур.10: постройки 100%',        near(R(10).buildings, 1.0));
ok('ур.<10: live выключен',        R(9).live === false);
ok('ур.10: live включён',          R(10).live === true);

// ---------------------------------------------------------------
console.log('\n[2] Стоимость и время прокачки спутника-шпиona');
// costMul 1.3 (+30% к базе, НЕ expensive), timeMul 2.0 (×2 время)
for (const lvl of [0, 3, 7]) {
  const base = c.trophyUpgradeCost(lvl);                 // обычный трофей
  const sat  = c.trophyUpgradeCost(lvl, false, 1.3);     // спутник
  eq(`цена ур.${lvl}: +30% к базе`, sat, Math.round(base * 1.3));
}
for (const L of [1, 5, 10]) {
  const sat = c.trophyTrainMinutes(L, 2.0);
  const expect = Math.round(60 * Math.pow(1.7, L - 1) * 2); // как в коде: умножаем, потом округляем
  eq(`время ур.${L}: ×2 к базе`, sat, expect);
}
// Трофей зарегистрирован в конфиге
const satDef = c.TROPHIES.find((t) => t.id === 'satellite');
ok('трофей satellite есть в TROPHIES', !!satDef);
ok('satellite: apply=spy', satDef.apply === 'spy');
ok('satellite: costMul 1.3 / timeMul 2', satDef.costMul === 1.3 && satDef.timeMul === 2.0);

// ---------------------------------------------------------------
console.log('\n[3] Интеграция: spyOn / spyReport');
// Сидим базу в памяти (JSON-режим, кэш store)
const usersMap = db.load('users', {});
for (const k of Object.keys(usersMap)) delete usersMap[k];

const now = Date.now();
function mkUser(id, name) {
  return {
    id, name, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: false,
    emailVerified: true, country: 'ru', status: '', createdAt: now, lastSeen: now,
    level: 20, xp: 0, dollars: 1e6, gold: 1e9, bank: 0, skillPoints: 0,
    skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 },
    res: { hp: { cur: c.PLAYER.BASE_HP, t: now }, en: { cur: c.PLAYER.BASE_ENERGY, t: now }, am: { cur: c.PLAYER.BASE_AMMO, t: now } },
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

const target = mkUser('u_target', 'Цель');
target.units = { ground_1: [1000, 0, 0] };      // 1000 наземных
target.buildings = { sklad: 10, bunker: 5 };     // доходная + оборонительная
target.secretDevs = { kara: 8 };                 // секретка
target.superSecret = 3;                          // супер-разработка
const spy = mkUser('u_spy', 'Шпион');
usersMap['u_target'] = target;
usersMap['u_spy'] = spy;

const notices = { push: () => {} };
function doSpy(lvl) {
  spy.trophies.satellite = lvl;
  spy.spyCount = 0;              // сброс дневного лимита для теста
  features.spyOn(spy, 'u_target', notices);
  return spy.spyReports['u_target'];
}

// ур.1 — только техника, ±50%
let r = doSpy(1);
ok('ур.1: техника раскрыта', Array.isArray(r.units) && r.units.length === 1);
ok('ур.1: постройки скрыты (null)', r.buildings === null);
ok('ур.1: секретки скрыты (null)', r.secretDevs === null);
ok('ур.1: не live', r.live === false);
eq('ур.1: accUnits', r.accUnits, 50);
ok('ур.1: количество в ±50% (500..1500)', r.units[0].count >= 500 && r.units[0].count <= 1500);

// ур.5 — + постройки (70%), секреток нет
r = doSpy(5);
eq('ур.5: accUnits 100', r.accUnits, 100);
eq('ур.5: техника точна (1000)', r.units[0].count, 1000);
ok('ур.5: постройки раскрыты (2 шт.)', Array.isArray(r.buildings) && r.buildings.length === 2);
eq('ур.5: accBuild', r.accBuild, 70);
ok('ур.5: секретки скрыты', r.secretDevs === null);

// ур.8 — + секретки (70%)
r = doSpy(8);
ok('ур.8: секретки раскрыты', Array.isArray(r.secretDevs) && r.secretDevs.length === 1);
ok('ур.8: супер-разработка раскрыта', !!r.superDevInfo);
eq('ур.8: accSecret', r.accSecret, 70);

// ур.10 — live + всё максимально, секретки 90%
r = doSpy(10);
ok('ур.10: live включён', r.live === true);
ok('ур.10: liveUntil ~ +3 дня', r.liveUntil > Date.now() + 2.9 * 864e5 && r.liveUntil < Date.now() + 3.1 * 864e5);
eq('ур.10: accUnits 100', r.accUnits, 100);
eq('ур.10: техника точна', r.units[0].count, 1000);
eq('ур.10: постройки точны (10)', r.buildings.find((b) => b.id === 'sklad').count, 10);
eq('ур.10: accSecret 90', r.accSecret, 90);

// spyReport для live — пересобирается по актуальным данным
target.units = { ground_1: [2000, 0, 0] };       // цель докупила технику
const live = features.spyReport(spy, 'u_target');
eq('live: техника обновилась (2000)', live.units[0].count, 2000);

// spyReport — истёкший live скрывается и удаляется
spy.spyReports['u_target'].liveUntil = Date.now() - 1000;
spy.spyReports['u_target'].live = true;
const expired = features.spyReport(spy, 'u_target');
ok('истёкший live → null', expired === null);
ok('истёкший live → удалён из отчётов', !spy.spyReports['u_target']);

// ---------------------------------------------------------------
console.log('\n[4] Границы зашумления (ур.1, точность 50%, 300 прогонов)');
target.units = { ground_1: [1000, 0, 0] };
const counts = [];
for (let i = 0; i < 300; i++) {
  spy.trophies.satellite = 1; spy.spyCount = 0;
  features.spyOn(spy, 'u_target', notices);
  counts.push(spy.spyReports['u_target'].units[0].count);
}
const mn = Math.min(...counts), mx = Math.max(...counts);
const uniq = new Set(counts).size;
ok(`минимум ≥ 500 (${mn})`, mn >= 500);
ok(`максимум ≤ 1500 (${mx})`, mx <= 1500);
ok(`значения случайны (${uniq} уникальных)`, uniq > 20);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
