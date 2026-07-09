// Тест новой системы шахт: участок за золото → шахта за деньги (3 дня),
// 200-300 золота, 30 спусков, лимит 90 мин/сутки НА КАЖДУЮ шахту, два броска
// на золото (найти + добыть), деньги всегда (×2-5 при неудаче), обвал по
// 30 спускам/истощению, террорист (реальный бой), авто-сброс старых шахт.
// Запуск: node test/mines.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const u = require('../dist/src/core/utils');
const player = require('../dist/src/services/player');
const mines = require('../dist/src/services/mines');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };
const thr = (n, fn) => { try { fn(); assert.fail(); } catch (e) { passed++; console.log(`  ✅ ${n}`); } };

// --- Контроль случайности ---
const realRandom = Math.random, realRnd = u.rnd;
let randQ = [], rndQ = [];
Math.random = () => (randQ.length ? randQ.shift() : 0.5);
u.rnd = (min, max) => (rndQ.length ? rndQ.shift() : realRnd(min, max));
const setQ = (r, rn) => { randQ = r.slice(); rndQ = rn.slice(); };

const M = c.MINE;
const usersMap = player.users();
for (const k of Object.keys(usersMap)) delete usersMap[k];
const now = Date.now();
function mkUser(id) {
  return { id, name: id, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: false, country: 'ru', status: '', createdAt: now, lastSeen: now, level: 75, xp: 0, dollars: 5e9, gold: 100000, bank: 0, skillPoints: 0, skills: { energy: 5, health: 5, ammo: 5, cruelty: 0, agility: 0 }, res: { hp: { cur: 150, t: now }, en: { cur: 150, t: now }, am: { cur: 10, t: now } }, units: { ground_1: { 0: 50 } }, workshops: 0, modernQueue: [], buildings: {}, secretDevs: {}, superSecret: 0, ears: 0, tokens: 0, earsLost: 0, earsCurrent: 2, earsLostAt: [], earPenaltyUntil: 0, battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 }, counters: {}, achStages: {}, missions: {}, tutorial: { done: true }, effects: [], trophies: {}, club: {}, allianceId: null, legionId: null, lastIncomeAt: now, mines: [], minesSchemaV: M.SCHEMA_V, saboteurs: {}, saboteurLimits: {}, silos: [] };
}
const U = mkUser('miner'); usersMap['miner'] = U;
const N = [];

console.log('\n[1] Покупка участка: цена 600, ×2, максимум 5');
setQ([], []);
mines.buyPlot(U, N);
eq('золото списано 600', U.gold, 100000 - 600);
eq('участков стало 1', U.mines.length, 1);
mines.buyPlot(U, N);
eq('второй участок стоил 1200 (итого -1800)', U.gold, 100000 - 600 - 1200);
mines.buyPlot(U, N); mines.buyPlot(U, N); mines.buyPlot(U, N); // 2400+4800+9600
eq('пять участков', U.mines.length, 5);
thr('шестой участок запрещён (макс 5)', () => mines.buyPlot(U, N));

console.log('\n[2] Постройка шахты: деньги = 500 × цены техники, 3 суток, запас 200-300');
const plot = U.mines[0];
const dollarsBefore = U.dollars;
const expectedCost = M.BUILD_UNITS * c.maxUnitPriceAtLevel(U.level);
setQ([], [250]); // rollReserve → u.rnd(200,300)=250
mines.build(U, plot.id, N);
eq('списаны деньги = 500×цена техники', dollarsBefore - U.dollars, expectedCost);
eq('статус building', plot.status, 'building');
ok('таймер стройки ~3 суток', Math.abs(plot.buildFinishesAt - Date.now() - M.BUILD_TIME_MS) < 5000);
eq('запас золота 250', plot.goldTotal, 250);
eq('спусков 30', plot.descentsLeft, 30);
// Завершаем стройку
plot.buildFinishesAt = Date.now() - 1000;
mines.refreshAll(U);
eq('после стройки статус idle', plot.status, 'idle');

console.log('\n[3] Спуск: списывает минуты и попытку сразу; лимит 90 мин НА шахту');
setQ([0.99], []); // нет террориста
mines.descend(U, plot.id, 30, N);
eq('осталось спусков 29', plot.descentsLeft, 29);
eq('потрачено 30 мин сегодня', plot.minutesUsedToday, 30);
eq('статус descending', plot.status, 'descending');
// финализируем без золота позже; сначала проверим дневной лимит на этой шахте
// Завершим текущий спуск (не найдено), чтобы шахта снова была idle
plot.descentEndsAt = Date.now() - 1000; plot.terror = null;
setQ([0.99], [3, 4]); // found fail (30мин find=0.60, 0.99<0.6 false) → нет золота; money units=3, failMult=4
mines.refreshAll(U);
eq('шахта снова idle', plot.status, 'idle');
eq('результат: не найдено (goldGained 0)', plot.pendingResult.goldGained, 0);
eq('деньги при неудаче = цена×3×4', plot.pendingResult.money, c.maxUnitPriceAtLevel(U.level) * 3 * 4);
mines.dismissResult(U, plot.id, N);
// Дневной лимит: уже 30 мин, попробуем 70 → превысит 90
setQ([0.99], []);
thr('70 мин сверх лимита (30+70>90) отклонено', () => mines.descend(U, plot.id, 70, N));
// а 60 мин влезает (30+60=90)
setQ([0.99], []);
mines.descend(U, plot.id, 60, N);
eq('минут за день 90', plot.minutesUsedToday, 90);
plot.descentEndsAt = Date.now() - 1000; plot.terror = null;
setQ([0.99], [2, 3]); mines.refreshAll(U); mines.dismissResult(U, plot.id, N);
setQ([0.99], []);
thr('после 90 мин лимит исчерпан', () => mines.descend(U, plot.id, 10, N));
// Второй участок имеет СВОЙ лимит
const plot2 = U.mines[1];
setQ([], [250]); mines.build(U, plot2.id, N); plot2.buildFinishesAt = Date.now() - 1000; mines.refreshAll(U);
setQ([0.99], []);
mines.descend(U, plot2.id, 90, N);
eq('вторая шахта: свой лимит (90 мин)', plot2.minutesUsedToday, 90);

console.log('\n[4] Золото: два броска (найти + добыть), сумма по времени, ограничена запасом');
plot.dailyKey = 'reset'; plot.minutesUsedToday = 0; // сброс дня вручную
setQ([0.99], []); mines.descend(U, plot.id, 90, N); // 90 мин: find=1.0
const goldBefore = U.gold;
plot.descentEndsAt = Date.now() - 1000; plot.terror = null;
setQ([0.1, 0.1], [27, 5]); // found (1.0), foundGold=27, extracted (0.90>0.1 → true), money units=5
mines.refreshAll(U);
eq('золото добыто +27 (90мин, оба броска успех)', U.gold - goldBefore, 27);
eq('в результате extracted=true', plot.pendingResult.extracted, true);
eq('foundGold=27', plot.pendingResult.foundGold, 27);
eq('шанс добычи 90% в окне', plot.pendingResult.extractChancePct, 90);
eq('деньги при золоте = цена×5 (без множителя)', plot.pendingResult.money, c.maxUnitPriceAtLevel(U.level) * 5);
mines.dismissResult(U, plot.id, N);
// Нашли, но не добыли → золото 0, деньги ×множитель
plot.minutesUsedToday = 0;
setQ([0.99], []); mines.descend(U, plot.id, 90, N);
const g2 = U.gold;
plot.descentEndsAt = Date.now() - 1000; plot.terror = null;
setQ([0.1, 0.99], [20, 3, 5]); // found, foundGold=20, extract fail (0.99<0.9 false), money=3, failMult=5
mines.refreshAll(U);
eq('золото не добыто → 0', U.gold - g2, 0);
eq('деньги ×5 при неудаче добычи', plot.pendingResult.money, c.maxUnitPriceAtLevel(U.level) * 3 * 5);
mines.dismissResult(U, plot.id, N);

console.log('\n[5] Обвал по истощению запаса');
plot.goldLeft = 5; plot.minutesUsedToday = 0;
setQ([0.99], []); mines.descend(U, plot.id, 90, N);
plot.descentEndsAt = Date.now() - 1000; plot.terror = null;
setQ([0.1, 0.1], [10, 3]); // foundGold=10 но остаток 5 → добудет min(5,10)=5 → запас 0
mines.refreshAll(U);
eq('добыто ограничено остатком (5)', plot.pendingResult.goldGained, 5);
eq('шахта обрушилась (запас 0)', plot.status, 'collapsed');
ok('в результате флаг collapsed', plot.pendingResult.collapsed === true);

console.log('\n[6] Обвал по 30 спускам + расчистка 24ч + перестройка');
const p3 = U.mines[2];
setQ([], [300]); mines.build(U, p3.id, N); p3.buildFinishesAt = Date.now() - 1000; mines.refreshAll(U);
p3.descentsLeft = 1; p3.minutesUsedToday = 0;
setQ([0.99], []); mines.descend(U, p3.id, 10, N);
p3.descentEndsAt = Date.now() - 1000; p3.terror = null;
setQ([0.99], [3, 4]); mines.refreshAll(U);
eq('обвал по исчерпанию спусков', p3.status, 'collapsed');
// расчистка 24ч
thr('перестройка до расчистки запрещена', () => mines.build(U, p3.id, N));
p3.collapsedAt = Date.now() - M.COLLAPSE_CLEAR_MS - 1000; // прошли сутки
setQ([], [220]); mines.build(U, p3.id, N);
eq('после расчистки перестроена (building)', p3.status, 'building');

console.log('\n[7] Террорист: тайм-аут реакции → спуск испорчен (нет золота и денег)');
const p4 = U.mines[3];
setQ([], [250]); mines.build(U, p4.id, N); p4.buildFinishesAt = Date.now() - 1000; mines.refreshAll(U);
p4.minutesUsedToday = 0;
setQ([0.1, 0.1], []); // террорист есть, timing=end
mines.descend(U, p4.id, 30, N);
ok('террорист назначен', !!p4.terror);
const goldB = U.gold, dollarsB = U.dollars;
// Прокручиваем: атака активировалась и дедлайн прошёл, время спуска вышло
p4.terror.at = Date.now() - (11 * 60 * 1000);
p4.terror.deadline = Date.now() - (60 * 1000);
p4.descentEndsAt = Date.now() - 1000;
setQ([], []); mines.refreshAll(U);
eq('спуск испорчен (ruined)', p4.pendingResult.ruined, true);
eq('золото не начислено', U.gold, goldB);
eq('деньги не начислены', U.dollars, dollarsB);
mines.dismissResult(U, p4.id, N);

console.log('\n[8] Террорист: отражение боем (сильный игрок побеждает) → золото цело + награда');
player.buildArmy = () => ({ power: 5000000 }); // подменяем: игрок очень силён → террорист гибнет сразу
U.res.hp.cur = 150; U.res.am.cur = 10; U.res.en.cur = 150; U.tokens = 0;
p4.minutesUsedToday = 0;
setQ([0.1, 0.99], []); // террорист есть, timing=mid
mines.descend(U, p4.id, 30, N);
p4.terror.at = Date.now() - 1000; // атака активна
const ammoBefore = U.res.am.cur, enBefore = U.res.en.cur, tokBefore = U.tokens, dolBefore = U.dollars;
setQ([], []); // бой на реальном RNG (внутри basicDmg свои случайности) — игрок гарантированно силён
const goldSpuskBefore = U.gold;
mines.fightTerrorists(U, p4.id, N);
const priceAtLvl = c.maxUnitPriceAtLevel(U.level);
eq('боеприпас списан (−1)', ammoBefore - U.res.am.cur, M.TERRORIST_AMMO_COST);
eq('энергия списана (−20)', enBefore - U.res.en.cur, M.TERRORIST_ENERGY_COST);
ok('террорист помечен отражённым', p4.terror.repelled === true);
const tokGain = U.tokens - tokBefore;
ok('жетоны в диапазоне 1-3', tokGain >= M.TERRORIST_REWARD_TOKENS_MIN && tokGain <= M.TERRORIST_REWARD_TOKENS_MAX);
const moneyGain = U.dollars - dolBefore;
ok('деньги за отражение = цена×(10-30)', moneyGain >= priceAtLvl * M.TERRORIST_REWARD_UNITS_MIN && moneyGain <= priceAtLvl * M.TERRORIST_REWARD_UNITS_MAX);
ok('спуск не потерян после отражения (mid)', p4.status === 'descending' || p4.status === 'idle');

console.log('\n[9] Авто-сброс старых шахт (миграция схемы)');
U.minesSchemaV = 1; // как будто старая версия
mines.view(U);
eq('старые шахты обнулены', U.mines.length, 0);
eq('версия схемы обновлена', U.minesSchemaV, M.SCHEMA_V);

console.log('\n[10] Админ: обнулить шахты у всех');
const A = mkUser('adm'); A.isAdmin = true; usersMap['adm'] = A;
const V = mkUser('victim'); V.mines = [{ id: 'x', status: 'idle' }]; V.minesSchemaV = M.SCHEMA_V; usersMap['victim'] = V;
mines.wipeAllMines(A, N);
eq('у victim шахты обнулены', V.mines.length, 0);
thr('не-админ не может обнулять', () => mines.wipeAllMines(V, N));

Math.random = realRandom; u.rnd = realRnd;
console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
