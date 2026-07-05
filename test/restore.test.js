// Тест: новые цены восстановления ресурсов (20-25) и что refill полностью
// восстанавливает ресурс и списывает золото.
// Запуск: node test/restore.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const player = require('../dist/src/services/player');
const market = require('../dist/src/services/market');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

console.log('\n[1] Базовые цены восстановления подняты в диапазон 20-25');
eq('энергия («Заря») = 20', c.MARKET_ITEM_BY_ID['energy'].gold, 20);
eq('здоровье («Аптечка») = 22', c.MARKET_ITEM_BY_ID['medkit'].gold, 22);
eq('боеприпасы («Цинк») = 25', c.MARKET_ITEM_BY_ID['ammo'].gold, 25);
for (const id of ['energy', 'medkit', 'ammo']) {
  const g = c.MARKET_ITEM_BY_ID[id].gold;
  ok(`${id}: цена в диапазоне 20..25 (${g})`, g >= 20 && g <= 25);
}

console.log('\n[2] Покупка refill полностью восстанавливает ресурс и списывает золото');
const usersMap = db.load('users', {});
for (const k of Object.keys(usersMap)) delete usersMap[k];
const now = Date.now();
function mkUser() {
  return {
    id: 'u1', name: 'Боец', email: 'u1@t.t', passHash: 'x', salt: 'x', isAdmin: false,
    emailVerified: true, country: 'ru', status: '', createdAt: now, lastSeen: now,
    level: 20, xp: 0, dollars: 1e6, gold: 1000, bank: 0, skillPoints: 0,
    skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 },
    res: { hp: { cur: 1, t: now }, en: { cur: 0, t: now }, am: { cur: 0, t: now } },
    units: {}, workshops: 0, modernQueue: [], buildings: {}, secretDevs: {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0, earsCurrent: c.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 },
    counters: { wins: 0, attacks: 0, fatalities: 0, unitsBought: 0, buildingsBuilt: 0, missionStages: 0, earsCut: 0, moneyEarned: 0, battleLoot: 0, level: 20 },
    achStages: {}, missions: {}, tutorial: { step: 0, done: true }, effects: [],
    trophies: Object.fromEntries(c.TROPHIES.map((t) => [t.id, 0])),
    club: {}, allianceId: null, legionId: null, lastIncomeAt: now,
    pendingFatality: null, lastChatAt: 0, trophyQueue: [], dailyQuests: {},
  };
}
const user = mkUser();
usersMap['u1'] = user;
const notices = { push: () => {} };
const mx = player.maxima(user);

// Боеприпасы: 0 -> max, золото -25
let goldBefore = user.gold;
market.buyItem(user, 'ammo', null, notices);
eq('боеприпасы восстановлены до максимума', user.res.am.cur, mx.am);
eq('золото списано на 25', goldBefore - user.gold, 25);

// Энергия: 0 -> max, золото -20
goldBefore = user.gold;
market.buyItem(user, 'energy', null, notices);
eq('энергия восстановлена до максимума', user.res.en.cur, mx.en);
eq('золото списано на 20', goldBefore - user.gold, 20);

// Здоровье: 1 -> max, золото -22
goldBefore = user.gold;
market.buyItem(user, 'medkit', null, notices);
eq('здоровье восстановлено до максимума', user.res.hp.cur, mx.hp);
eq('золото списано на 22', goldBefore - user.gold, 22);

console.log('\n[3] При нехватке золота покупка отклоняется (для попапа)');
user.gold = 5;
user.res.am.cur = 0;
let threw = false;
try { market.buyItem(user, 'ammo', null, notices); } catch (e) { threw = /золот/i.test(e.message); }
ok('покупка ammo за 25 при 5 золота отклонена', threw);
eq('боеприпасы не восстановлены', user.res.am.cur, 0);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
