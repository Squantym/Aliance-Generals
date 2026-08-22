// ═══════════════════════════════════════════════════════════════════
// test/bugfix178.test.js — ошибки, найденные при сплошной проверке
//
// Каждый блок проверяет ПОВЕДЕНИЕ (вызов модуля), а не текст исходника:
// проверка текста молча зеленеет от любой правки формулировки и
// однажды уже удержала в проекте ошибку истории боёв.
//
// Запуск: node test/bugfix178.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
const db      = require('../dist/src/core/db');
const config  = require('../dist/config/gameConfig');
const player  = require('../dist/src/services/player');
const battle  = require('../dist/src/services/battle');
const market  = require('../dist/src/services/market');
const arena   = require('../dist/src/services/arena');
const lb      = require('../dist/src/services/legionBattle');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (=${a})`); };

const um = player.users();
const realRandom = Math.random;
const HOUR = 3600 * 1000;
function reset() { for (const k of Object.keys(um)) delete um[k]; }
function mk(id) {
  const t = Date.now();
  return {
    id, name: id, level: 50, dollars: 0, gold: 0, rating: 0,
    skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 },
    res: { hp: { cur: 100, t }, en: { cur: 100, t }, am: { cur: 5, t } },
    units: {}, buildings: {}, secretDevs: {}, superSecret: 0, trophies: {},
    counters: { fatalities: 0, earsCut: 0 },
    battle: { fatalities: 0, attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0 },
    effects: [], ears: 0, earsLost: 0, earsCurrent: 2, earsLostAt: [],
    earPenaltyUntil: 0, earCutters: [null, null], earMessage: null,
    missions: {}, achStages: {}, allianceId: null, legionId: null,
    lastIncomeAt: t,
  };
}

// ───────────────────────────────────────────────────────────────────
console.log('\n[1] Содержание армии списывается ОДИН раз, а не дважды');
// Было: сначала счёт обнулялся на всю сумму долга, а потом остаток
// долга считался уже от НУЛЕВОГО счёта — то есть техника продавалась
// на полный долг вдобавок к снятым деньгам.
reset();
const unit = config.UNITS.find((x) => x.id === 'ground_1');
const A = mk('a');
A.units = { [unit.id]: { 0: 10000 } };        // армия заведомо не по карману
um['a'] = A;

const upkeepPerHour = player.totalUpkeep(A) - player.totalIncome(A);
ok('содержание превышает доход', upkeepPerHour > 0);

const half = Math.floor(upkeepPerHour / 2);
A.dollars = half;                              // денег хватает ровно на половину
A.lastIncomeAt = Date.now() - HOUR - 1000;     // прошёл ровно 1 час
const unitsBefore = player.unitTotalCount(A, unit.id);

player.refresh(A);

const perUnit = Math.max(1, Math.floor(unit.price * 0.5));   // 50% цены
const sold = unitsBefore - player.unitTotalCount(A, unit.id);
const rightSold = Math.ceil((upkeepPerHour - half) / perUnit);  // долг МИНУС наличные
const wrongSold = Math.ceil(upkeepPerHour / perUnit);           // как было: весь долг
ok(`ошибочный и верный расчёт различимы (${rightSold} против ${wrongSold})`, rightSold < wrongSold);
eq('продано техники ровно на НЕПОКРЫТУЮ часть долга', sold, rightSold);
eq('остаток от продажи вернулся на счёт',
   A.dollars, sold * perUnit - (upkeepPerHour - half));

// ───────────────────────────────────────────────────────────────────
console.log('\n[2] Список потерь — текст, а не «[object Object]»');
const txt = battle.lossesToText([
  { name: 'Т-54', count: 3, id: 'ground_1' },
  { name: 'БТР-60', count: 1, id: 'ground_2' },
]);
ok('нет [object Object]', !/\[object Object\]/.test(String(txt)));
eq('читаемый список', txt, 'Т-54 ×3, БТР-60 ×1');
eq('пустые потери → null', battle.lossesToText([]), null);
eq('нет массива → null', battle.lossesToText(undefined), null);

console.log('\n    и это же читает защитник в уведомлении о реальной атаке');
// Главная проверка: не сам помощник, а то, что уведомление им пользуется.
// Именно разрыв между «функция есть» и «её никто не зовёт» и был ошибкой.
reset();
const notif = require('../dist/src/services/notifications');
const ATK = mk('atk'); const DEF = mk('def');
ATK.level = 60; DEF.level = 60;
ATK.units = { ground_1: { 0: 400 } };      // заведомо сильнее
DEF.units = { ground_1: { 0: 5 } };
ATK.res.am.cur = 50;
um['atk'] = ATK; um['def'] = DEF;
Math.random = () => 0.5;
try { battle.attack(ATK, 'def', []); } catch (e) { console.log('    (атака отклонена: ' + e.message + ')'); }
Math.random = realRandom;
const box = notif.list({ id: 'def' }).notifications
  .filter((n) => n.kind === 'attack_lost' || n.kind === 'attack_defended');
ok('защитник получил уведомление об атаке', box.length > 0);
const lt = box[0].payload.lossesText;
ok(`в уведомлении нет [object Object] (там: ${JSON.stringify(lt)})`,
   !/\[object Object\]/.test(String(lt)));
ok('потери названы техникой, а не пустым местом',
   lt === null || /×\d+/.test(String(lt)));

// ───────────────────────────────────────────────────────────────────
console.log('\n[3] «Тесак мясника»: за два уха рейтинг +6, а не +9');
// Начисление за второе ухо стояло в коде ДВАЖДЫ.
reset();
const B1 = mk('a'); B1.trophies = { butcher: 10 };
const V1 = mk('v');
um['a'] = B1; um['v'] = V1;
B1.pendingFatality = { targetId: 'v', isBot: false, exp: Date.now() + 60000 };
Math.random = () => 0.1;                 // двойной срез срабатывает
battle.fatality(B1, 'ear', []);
Math.random = realRandom;
eq('срезано оба уха', V1.earsLost, 2);
eq('рейтинг нападавшего +3 за каждое ухо', B1.rating, 6);
eq('рейтинг жертвы −3 за каждое ухо', V1.rating, -6);

console.log('\n    и за одно ухо по-прежнему +3');
reset();
const B2 = mk('a'); const V2 = mk('v');
um['a'] = B2; um['v'] = V2;
B2.pendingFatality = { targetId: 'v', isBot: false, exp: Date.now() + 60000 };
Math.random = () => 0.99;                // двойной срез НЕ срабатывает
battle.fatality(B2, 'ear', []);
Math.random = realRandom;
eq('срезано одно ухо', V2.earsLost, 1);
eq('рейтинг нападавшего +3', B2.rating, 3);

// ───────────────────────────────────────────────────────────────────
console.log('\n[4] Неудачная покупка не двигает счётчики поручений');
// Было: счётчик поручения увеличивался ДО проверки жертвы. Запрос падал
// ошибкой, золото оставалось на месте — а прогресс поручения шёл.
reset();
const C = mk('a'); um['a'] = C;
const debuff = config.MARKET_ITEMS.find((i) => i.kind === 'debuff');
ok('в конфиге есть падлянка', !!debuff);
C.gold = 1000000;
const goldBefore = C.gold;

let threw = false;
try { market.buyItem(C, debuff.id, 'НетТакогоИгрока', []); } catch (e) { threw = true; }
ok('покупка с несуществующей жертвой отклонена', threw);
eq('золото не списано', C.gold, goldBefore);
const counters = (C.daily && C.daily.counters) || {};
eq('счётчик покупок не двинулся', Number(counters.marketBought || 0), 0);
eq('счётчик по товару не двинулся', Number(counters['buy:' + debuff.id] || 0), 0);

console.log('\n    а удачная покупка — двигает');
reset();
const D = mk('a'); um['a'] = D; D.gold = 1000000;
const buff = config.MARKET_ITEMS.find((i) => i.kind !== 'debuff');
market.buyItem(D, buff.id, '', []);
const cnt2 = (D.daily && D.daily.counters) || {};
ok('счётчик покупок увеличился', Number(cnt2.marketBought || 0) === 1);
ok('золото списано', D.gold < 1000000);

// ───────────────────────────────────────────────────────────────────
console.log('\n[5] Арена: если не вышел НИКТО — взносы возвращаются');
// Было: всех помечали выбывшими, бой закрывался как «завершённый», и
// банк из взносов исчезал вместе с ним.
reset();
const arenaStore = db.load('arena', {});
const div = arena.DIV_IDS[0];
const entry = arena.DIVISIONS[div].entry;
const currency = arena.DIVISIONS[div].currency;

const fighters = {};
const ids = ['p1', 'p2', 'p3'];
for (const id of ids) {
  const p = mk(id);
  if (currency === 'gold') p.gold = 0; else p.dollars = 0;
  um[id] = p;
  fighters[id] = { id, name: id, flag: '', hp: 100, alive: true, seen: false,
                   entered: false, kills: 0, killedIds: [], log: [] };
}
arenaStore.divs = arenaStore.divs || {};
arenaStore.divs[div] = arenaStore.divs[div] || { ratings: {}, history: [] };
const s = arenaStore.divs[div];
s.battle = {
  id: 'b-test', state: 'preparing', fighters,
  prepareUntil: Date.now() - 1000, pot: entry * ids.length,
  startedAt: 0, finishedAt: 0,
};
arena.tick();

const st = s.battle;
eq('бой отменён, а не «завершён»', st.state, 'cancelled');
for (const id of ids) {
  const p = um[id];
  const back = currency === 'gold' ? p.gold : p.dollars;
  eq(`взнос вернулся игроку ${id}`, back, entry);
}

// ───────────────────────────────────────────────────────────────────
console.log('\n[6] Бой легиона: автораздача использует ВСЕ 5 направлений');
// Было вписано [1, 2, 3] — два направления пустовали, а на первые три
// набивалось больше разрешённых пяти человек.
eq('направлений в игре', lb.DIRECTIONS, 5);
eq('названий направлений', lb.DIR_NAMES.length, 5);

reset();
const all = db.load('legions', {});
const battlesStore = db.load('battles', {});
const combatants = {};
const need = lb.MAX_PER_DIR * lb.DIRECTIONS;      // полный состав одной стороны
for (let i = 0; i < need; i++) {
  const id = 'x' + i;
  um[id] = mk(id);
  combatants[id] = {
    userId: id, name: id, side: 'A', role: 'assault', hp: 100, maxHp: 100,
    alive: true, ready: false, direction: 0, stats: { dmgDealt: 0, dmgTaken: 0, kills: 0, healed: 0 },
    statusEffects: [], lastActionAt: 0,
  };
}
battlesStore['lb-test'] = {
  id: 'lb-test', phase: 'prep', prepEndsAt: Date.now() - 1000,
  activeEndsAt: Date.now() + HOUR, combatants, log: [], activity: {},
  sideA: { legionId: 'L1', name: 'A' }, sideB: { legionId: 'L2', name: 'B' },
  guardLinks: {}, guardExpiry: {},
};
lb.tickAllBattles(all, um);

const dirs = Object.values(combatants).map((c) => c.direction);
const used = [...new Set(dirs)].sort((a, b) => a - b);
eq('задействованы все пять направлений', used.join(','), '1,2,3,4,5');
const perDir = {};
for (const d of dirs) perDir[d] = (perDir[d] || 0) + 1;
const over = Object.entries(perDir).filter(([, n]) => n > lb.MAX_PER_DIR);
ok(`лимит ${lb.MAX_PER_DIR} чел. на направление не превышен (${JSON.stringify(perDir)})`, over.length === 0);

// ───────────────────────────────────────────────────────────────────
console.log('\n[7] Правки ЧУЖОГО игрока помечаются к сохранению');
// Слой http сохраняет только автора запроса. Всё, что меняется у других
// игроков, обязано звать db.markUser явно — иначе изменение живёт лишь
// в памяти процесса и исчезает при перезапуске (pm2 restart на деплое).
const realMark = db.markUser;
let marked = [];
db.markUser = (id) => { marked.push(id); return realMark.call(db, id); };

console.log('\n    падлянка — помечена жертва');
reset(); marked = [];
const E = mk('a'); const F = mk('victim'); F.name = 'victim';
um['a'] = E; um['victim'] = F; E.gold = 1000000;
market.buyItem(E, debuff.id, 'victim', []);
ok('эффект применён к жертве', (F.effects || []).length > 0);
ok('жертва помечена к записи', marked.includes('victim'));

console.log('\n    перебитая ставка — помечен прежний лидер');
reset(); marked = [];
const G = mk('bidder1'); const H = mk('bidder2');
um['bidder1'] = G; um['bidder2'] = H;
G.gold = 1000000; H.gold = 1000000;
// Аукцион живёт в общем хранилище и переживает прогон теста: без сброса
// второй запуск падал бы на «минимальная ставка» от вчерашнего лидера.
const w = db.load('world', {});
w.auctions = [];
const lots = market.auctionView(G).lots;
ok('лоты аукциона есть', lots.length > 0);
const lotId = lots[0].id;
market.bid(G, lotId, config.AUCTION.MIN_BID, []);
const goldAfterBid = G.gold;
marked = [];
market.bid(H, lotId, config.AUCTION.MIN_BID + config.AUCTION.BID_STEP, []);
eq('золото прежнему лидеру возвращено', G.gold, goldAfterBid + config.AUCTION.MIN_BID);
ok('прежний лидер помечен к записи', marked.includes('bidder1'));

console.log('\n    послание на профиле — помечена жертва');
reset(); marked = [];
const I = mk('cutter'); const J = mk('vic2');
um['cutter'] = I; um['vic2'] = J;
J.earCutters = [{ id: 'cutter', name: 'cutter' }, { id: 'cutter', name: 'cutter' }];
battle.leaveEarMessage(I, 'vic2', 'сдавайся', []);
ok('послание записано', !!(J.earMessage && J.earMessage.text));
ok('жертва помечена к записи', marked.includes('vic2'));

db.markUser = realMark;



// ───────────────────────────────────────────────────────────────────
console.log('\n[8] Клуб офицеров: поручение засчитывается за ИГРУ, а не за мусор');
// Та же ошибка, что была на чёрном рынке: счётчик «сыграл в клубе» стоял
// ДО проверки хода. Запрос с мусором падал ошибкой, попытка не тратилась —
// а поручение закрывалось. И так сколько угодно раз подряд.
const club = require('../dist/src/services/club');
const cnt = (p) => Number(((p.daily && p.daily.counters) || {}).clubPlayed || 0);

reset();
const S = mk('a'); um['a'] = S;
club.safeStart(S);
let bad = 0;
for (const wrong of ['', 'абв', '11', '111111', '1123']) {   // мусор, не по длине, с повторами
  try { club.safeTry(S, wrong, []); } catch (e) { bad++; }
}
eq('все пять кривых попыток отклонены', bad, 5);
eq('счётчик клуба не сдвинулся', cnt(S), 0);
const triesBefore = S.club.safe.triesLeft;
club.safeTry(S, '1234', []);
eq('настоящая попытка засчитана в поручение', cnt(S), 1);
ok(`настоящая попытка потратила ход (${triesBefore} → ${S.club.safe.triesLeft})`,
   S.club.safe.triesLeft < triesBefore);

console.log('\n    то же в артиллерии');
reset();
const R = mk('a'); um['a'] = R;
club.artyStart(R);
let bad2 = 0;
for (const wrong of [0, -50, 999999]) {
  try { club.artyShoot(R, wrong, []); } catch (e) { bad2++; }
}
eq('выстрелы вне допустимой дистанции отклонены', bad2, 3);
eq('счётчик клуба не сдвинулся', cnt(R), 0);

console.log('\n    и в аукционе ставок');
reset();
const Q = mk('a'); um['a'] = Q;
let bad3 = 0;
for (const wrong of [[], [1], [999999, 0, 0, 0, 0, 0, 0, 0]]) {
  try { club.bidsPlay(Q, wrong, []); } catch (e) { bad3++; }
}
eq('кривые наборы ставок отклонены', bad3, 3);
eq('счётчик клуба не сдвинулся', cnt(Q), 0);

console.log(`\n═══ Всего проверок: ${passed} ═══`);
