// ═══════════════════════════════════════════════════════════════════
// test/mines-terror.test.js — несколько нападений террористов за спуск
//
// Что стережётся (решение владельца, 17.09.2026):
//  1. До 3 попыток за спуск, у каждой свой бросок шанса. Короткий спуск
//     вмещает меньше: 10-20 мин — одну, 30-40 — две, от 50 — три.
//  2. Моменты случайные, внутри спуска, между соседними ≥ 20 минут.
//  3. Нападения идут по одному: следующее — после отражения
//     предыдущего и не раньше чем через 20 минут после него; не влезает
//     в спуск — отменяется.
//  4. Не отбил — спуск потерян, больше не нападают.
//  5. Отбил все — спуск завершается как обычно, отбитые посчитаны.
//
// Запуск: node test/mines-terror.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const u = require('../dist/src/core/utils');
const player = require('../dist/src/services/player');
const mines = require('../dist/src/services/mines');

let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const M = c.MINE;
const MIN = 60 * 1000;
const realRandom = Math.random;
const users = player.users();
for (const k of Object.keys(users)) delete users[k];
const now = Date.now();
const U = { id: 'mt', name: 'mt', level: 75, dollars: 5e12, gold: 1e6, tokens: 0, skills: { energy: 5, health: 5, ammo: 5 },
  res: { hp: { cur: 150, t: now }, en: { cur: 150, t: now }, am: { cur: 10, t: now } }, units: { ground_1: { 0: 50 } },
  buildings: {}, secretDevs: {}, effects: [], trophies: {}, counters: {}, battle: {}, mines: [], minesSchemaV: M.SCHEMA_V };
users[U.id] = U;
player.buildArmy = () => ({ power: 5e9 });   // игрок гарантированно отбивается
const N = [];
// Бой тратит здоровье и боеприпасы — перед каждым боем пополняем
const refill = () => { const t = Date.now(); U.res = { hp: { cur: 150, t }, en: { cur: 150, t }, am: { cur: 10, t } }; };

// Готовая шахта
Math.random = realRandom;
mines.buyPlot(U, N);
const mine = U.mines[0];
mines.build(U, mine.id, N);
mine.buildFinishesAt = now - 1000; mines.refreshAll(U);

function start(minutes, rnd) {
  Math.random = rnd;
  mine.status = 'idle'; mine.pendingResult = null; mine.minutesUsedToday = 0; mine.descentsLeft = 20; mine.goldLeft = 200;
  const t0 = Date.now();
  mines.descend(U, mine.id, minutes, N);
  Math.random = realRandom;
  const list = mine.terror ? [mine.terror.at].concat(mine.terrorQueue) : [];
  return { t0, list };
}
const always = () => 0;          // каждая попытка срабатывает, моменты — в начале отрезков
const never = () => 0.999;       // ни одна не срабатывает

console.log('\n[1] Сколько попыток вмещает спуск');
for (const [min, want] of [[10, 1], [20, 1], [30, 2], [40, 2], [50, 3], [90, 3]]) {
  const { list } = start(min, always);
  ok(list.length === want, `${min} мин — попыток: ${list.length} (ждём ${want})`);
}
ok(start(90, never).list.length === 0 && mine.terror === null, 'шанс не сработал — нападений нет');
let k = 0;
const oneOfThree = () => [0.1, 0.9, 0.1][k++] !== undefined ? [0.1, 0.9, 0.1][k - 1] : realRandom();
k = 0;
ok(start(90, oneOfThree).list.length === 2, 'из трёх попыток сработали две — две и назначено');

console.log('\n[2] Моменты: внутри спуска, с интервалом ≥ 20 минут');
let worstGap = Infinity, inside = true;
for (let i = 0; i < 300; i++) {
  const { t0, list } = start(10 * (1 + Math.floor(realRandom() * 9)), () => (realRandom() < 0.5 ? realRandom() * 0.49 : realRandom()));
  for (let j = 0; j < list.length; j++) {
    if (list[j] < t0 + MIN - 5 || list[j] > mine.descentEndsAt + 5) inside = false;
    if (j) worstGap = Math.min(worstGap, list[j] - list[j - 1]);
  }
}
ok(inside, 'все нападения — после первой минуты и до конца спуска');
ok(worstGap >= M.TERRORIST_MIN_GAP_MS - 5, `наименьший интервал: ${Math.round(worstGap / MIN)} мин`);
const spread = new Set();
for (let i = 0; i < 50; i++) spread.add(Math.round((start(90, () => (realRandom() < 0.3 ? 0 : realRandom())).list[0] || 0) / MIN));
ok(spread.size > 5, `время первого нападения случайное (${spread.size} разных минут из 50 спусков)`);

console.log('\n[3] По одному, с интервалом после отражения');
start(90, always);
const plan = [mine.terror.at].concat(mine.terrorQueue);
ok(plan.length === 3 && mine.terrorQueue.length === 2, 'три нападения: одно активное, два в очереди');
// Сдвигаем спуск в прошлое: первое нападение уже наступило
const shift = (ms) => { mine.descentEndsAt -= ms; mine.terror.at -= ms; mine.terror.deadline -= ms; mine.terrorQueue = mine.terrorQueue.map((x) => x - ms); };
shift(mine.terror.at - Date.now() + 1000);
let v = mines.view(U).mines[0];
ok(v.descent.terror && v.descent.terror.active, 'первое нападение активно');
const secondPlanned = mine.terrorQueue[0];
const r1 = Date.now();
refill();
mines.fightTerrorists(U, mine.id, N);
ok(mine.terrorsRepelled === 1 && mine.terrorQueue.length === 1, 'первое отбито, в очереди осталось одно');
ok(mine.terror.at >= Math.max(secondPlanned, r1 + M.TERRORIST_MIN_GAP_MS) - 5, 'второе — не раньше 20 минут после отражения');
ok(!mines.view(U).mines[0].descent.terror, 'пока второе не наступило, активного нападения нет');
ok(/могут напасть снова/.test(N[N.length - 1]), 'игрока предупредили, что это не последнее');
let thrown = '';
try { mines.fightTerrorists(U, mine.id, N); } catch (e) { thrown = e.message; }
ok(/нет активного нападения/.test(thrown), 'драться с ещё не наступившим нельзя');

console.log('\n[4] Второе не отбито — спуск потерян, третьего не будет');
const g0 = U.gold, d0 = U.dollars;
mine.terror.at = Date.now() - 31 * MIN; mine.terror.deadline = Date.now() - MIN;
mine.descentEndsAt = Date.now() - 1000;
mines.refreshAll(U);
ok(mine.status === 'idle' && mine.pendingResult && mine.pendingResult.ruined === true, 'спуск испорчен');
ok(U.gold === g0 && U.dollars === d0, 'ни золота, ни денег');
ok(mine.terrorQueue.length === 0 && mine.terror === null, 'очередь нападений снята');
ok(mine.pendingResult.terrorsRepelled === 1, 'в итоге посчитано одно отбитое');

console.log('\n[5] Отбиты все три — обычный итог');
start(90, always);
for (let i = 0; i < 3; i++) {
  // Прокручиваем время к текущему нападению
  const back = mine.terror.at - Date.now() + 1000;
  if (back > 0) shift(back);
  mines.refreshAll(U);
  refill();
  mines.fightTerrorists(U, mine.id, N);
}
ok(mine.terrorsRepelled === 3 && mine.terrorQueue.length === 0, 'отбиты все три');
ok(mine.status === 'descending', 'спуск продолжается до своего конца');
mine.descentEndsAt = Date.now() - 1000;
mines.refreshAll(U);
ok(mine.status === 'idle' && mine.pendingResult.ruined === false && mine.pendingResult.terrorsRepelled === 3, 'спуск завершён целым, отбито 3');

console.log('\n[6] Отбил, а следующее не влезает в спуск — его нет');
start(50, always);
mine.terrorQueue = [mine.descentEndsAt - MIN];
shift(mine.terror.at - Date.now() + 1000);
mine.descentEndsAt = Date.now() + 5 * MIN;          // до конца 5 минут, интервал 20
refill();
mines.fightTerrorists(U, mine.id, N);
ok(mine.terrorQueue.length === 0 && mine.terror.repelled === true, 'позднее нападение отменено');
ok(/в безопасности/.test(N[N.length - 1]), 'игроку сказано, что золото в безопасности');

console.log(`\n✅ Все проверки пройдены: ${passed}`);
process.exit(0);
