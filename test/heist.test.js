// Тест системы взлома банков (трофей «Медвежатник») и мин (трофей
// «Растяжка»): юнит-логика (код/быки-коровы, провода) + интеграция
// через реальный battle.attack()/bankHackGuess/bankHackSkip/mineDefuse.
// Запуск: node test/heist.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const battle = require('../dist/src/services/battle');
const bankHack = require('../dist/src/services/bankHack');
const landmines = require('../dist/src/services/landmines');
const market = require('../dist/src/services/market');

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
    landmines: opts.landmines ?? 0, pendingMineDefuse: null,
    recentAttacks: {},
  };
}

// ===================================================================
console.log('\n[1] Юнит: генерация кода сейфа и «быки/коровы»');
const code1 = bankHack.generateCode(4);
eq('код длины 4', code1.length, 4);
ok('цифры не повторяются', new Set(code1.split('')).size === 4);
eq('точное совпадение = 4 быка, 0 коров', JSON.stringify(bankHack.evaluateGuess('1234', '1234')), JSON.stringify({ bulls: 4, cows: 0 }));
eq('все цифры не на своих местах = 0 быков, 4 коровы', JSON.stringify(bankHack.evaluateGuess('1234', '4321')), JSON.stringify({ bulls: 0, cows: 4 }));
eq('частичное совпадение', JSON.stringify(bankHack.evaluateGuess('1234', '1243')), JSON.stringify({ bulls: 2, cows: 2 }));
eq('полный промах', JSON.stringify(bankHack.evaluateGuess('1234', '5678')), JSON.stringify({ bulls: 0, cows: 0 }));

console.log('\n[2] Юнит: конфиг-таблицы взлома банка (0..10 уровень)');
eq('offerChance ур.0 = 1%', c.BANK_HACK.offerChancePct(0), 1);
eq('offerChance ур.10 = 10%', c.BANK_HACK.offerChancePct(10), 10);
eq('successChance ур.0 = 0%', c.BANK_HACK.successChancePct[0], 0);
eq('successChance ур.1 = 20%', c.BANK_HACK.successChancePct[1], 20);
eq('successChance ур.10 = 70%', c.BANK_HACK.successChancePct[10], 70);
eq('lootPct ур.1 = 1%', c.BANK_HACK.lootPct[1], 1);
eq('lootPct ур.10 = 10%', c.BANK_HACK.lootPct[10], 10);

console.log('\n[3] Юнит: конфиг-таблицы мин (0..10 уровень)');
eq('triggerChance ур.1 = 2%', c.MINES.triggerChancePct[1], 2);
eq('triggerChance ур.10 = 20%', c.MINES.triggerChancePct[10], 20);
eq('techLoss ур.1 = 3%', c.MINES.techLossPct[1], 3);
eq('techLoss ур.10 = 30%', c.MINES.techLossPct[10], 30);

console.log('\n[4] Юнит: раскладка проводов 3-2-1 — единственный цвет = верный');
for (let i = 0; i < 200; i++) {
  const { wires, correctIdx } = landmines.generateWires();
  eq === undefined; // no-op guard (avoid stray)
  assert.strictEqual(wires.length, 6);
  const counts = {};
  wires.forEach((w) => { counts[w] = (counts[w] || 0) + 1; });
  const singleColors = Object.keys(counts).filter((k) => counts[k] === 1);
  assert.strictEqual(singleColors.length, 1, 'должен быть ровно один уникальный цвет');
  assert.strictEqual(wires[correctIdx], singleColors[0], 'correctIdx должен указывать на уникальный цвет');
}
passed++; console.log('  ✅ 200 раскладок: ровно один уникальный провод, correctIdx верный');

console.log('\n[5] Юнит: destroyExactPct — точное уничтожение % техники');
const victim = { units: { ground_1: { 0: 1000, 1: 0, 2: 0 } } };
const entries = [{ unitId: 'ground_1', mk: 0, taken: 1000, name: 'Танк' }];
const lost = landmines.destroyExactPct(victim, entries, 30);
eq('уничтожено ровно 30% из 1000', lost[0].count, 300);
eq('осталось 700 в юните', victim.units.ground_1[0], 700);

// ===================================================================
console.log('\n[6] Интеграция: покупка мин на чёрном рынке');
const buyer = mkUser('u_buyer', 'Покупатель');
usersMap['u_buyer'] = buyer;
const notices = { push: () => {} };
let r = market.buyMines(buyer, 5, notices);
eq('куплено 5 мин', r.bought, 5);
eq('цена 5×10=50 золота', r.cost, 50);
eq('запас = 5', buyer.landmines, 5);
r = market.buyMines(buyer, 5, notices);
eq('ещё 5 -> запас 10 (максимум)', buyer.landmines, 10);
let threw = false;
try { market.buyMines(buyer, 5, notices); } catch (e) { threw = /максимум/i.test(e.message); }
ok('покупка сверх максимума (10) отклонена', threw);
// Покупка больше 5 за раз обрезается до 5
const buyer2 = mkUser('u_buyer2', 'Покупатель2');
usersMap['u_buyer2'] = buyer2;
market.buyMines(buyer2, 999, notices);
eq('покупка >5 за раз обрезается до 5', buyer2.landmines, 5);

// ===================================================================
console.log('\n[7] Интеграция: взлом банка через battle.attack() — полный цикл');
const hacker = mkUser('u_hacker', 'Хакер', { trophies: { safecracker: 10 } }); // макс. уровень -> успех почти гарантирован
const victim1 = mkUser('u_victim1', 'Жертва1', { bank: 10000 });
usersMap['u_hacker'] = hacker;
usersMap['u_victim1'] = victim1;

// Форсируем 100% шанс окна взлома, подменив трофей на максимум и подождав
// достаточное число попыток (статистически) — либо напрямую вызываем bankHack.tryOffer
let offer = null;
for (let i = 0; i < 2000 && !offer; i++) {
  offer = bankHack.tryOffer(hacker, victim1);
}
ok('окно взлома предложено хотя бы раз за 2000 попыток (шанс 10%)', !!offer);
ok('pendingBankHack установлен', !!hacker.pendingBankHack);
eq('ammo не потрачен при предложении', hacker.res.am.cur, 9999);

// Подсматриваем настоящий код (тест имеет доступ к внутреннему состоянию)
const realCode = hacker.pendingBankHack.code;
const bankBefore = victim1.bank;
const dollarsBefore = hacker.dollars;
let guessResult = bankHack.guess(hacker, realCode, notices);
ok('код угадан (cracked=true)', guessResult.result.cracked === true);
// При уровне 10 трофея (successChance=50%) исход либо успех, либо тревога —
// проверим статистически на новой серии, а тут просто убедимся в консистентности:
ok('banHack завершён (finished=true)', guessResult.finished === true);
eq('pendingBankHack очищен после угадывания', hacker.pendingBankHack, null);

console.log('\n[8] Статистика: successChance ур.10 ≈ 70%, ур.0 = гарантированный провал');
let successCount = 0;
const TRIALS = 800;
for (let i = 0; i < TRIALS; i++) {
  const h = mkUser('u_stat', 'Стат', { trophies: { safecracker: 10 } });
  const v = mkUser('u_statv', 'СтатЖертва', { bank: 1000 });
  usersMap['u_stat'] = h; usersMap['u_statv'] = v;
  h.pendingBankHack = { targetId: 'u_statv', targetName: v.name, bankAmount: v.bank, code: '1234', digits: 4, triesLeft: 6, maxTries: 6, history: [] };
  const res = bankHack.guess(h, '1234', notices);
  if (res.result.cracked && !res.result.alarmed) successCount++;
}
const rate = successCount / TRIALS * 100;
console.log(`  успехов при ур.10: ${successCount}/${TRIALS} = ${rate.toFixed(1)}% (ожидаем ~50%)`);
ok(`частота успеха ур.10 в разумных пределах (60-80%): ${rate.toFixed(1)}%`, rate > 60 && rate < 80);

// Уровень 0: успех должен быть невозможен (0%)
let successAtZero = 0;
for (let i = 0; i < 200; i++) {
  const h = mkUser('u_stat0', 'Стат0', { trophies: { safecracker: 0 } });
  usersMap['u_stat0'] = h;
  h.pendingBankHack = { targetId: 'u_statv', targetName: 'x', bankAmount: 1000, code: '1234', digits: 4, triesLeft: 6, maxTries: 6, history: [] };
  const res = bankHack.guess(h, '1234', notices);
  if (res.result.cracked && !res.result.alarmed) successAtZero++;
}
eq('успех при ур.0 трофея невозможен (0 из 200)', successAtZero, 0);

console.log('\n[9] Похищенные деньги списываются из bank жертвы и добавляются нападающему');
{
  const h = mkUser('u_loot', 'Грабитель', { trophies: { safecracker: 10 } });
  const v = mkUser('u_lootv', 'ЖертваДеньги', { bank: 10000 });
  usersMap['u_loot'] = h; usersMap['u_lootv'] = v;
  h.pendingBankHack = { targetId: 'u_lootv', targetName: v.name, bankAmount: v.bank, code: '5678', digits: 4, triesLeft: 6, maxTries: 6, history: [] };
  // Форсируем успех статистически — повторяем, пока не получится (ур.10=70%)
  let done = false, dollarsBefore2 = h.dollars, bankBefore2 = v.bank;
  for (let i = 0; i < 200 && !done; i++) {
    v.bank = bankBefore2; // сбрасываем на случай промежуточных попыток
    h.pendingBankHack = { targetId: 'u_lootv', targetName: v.name, bankAmount: v.bank, code: '5678', digits: 4, triesLeft: 6, maxTries: 6, history: [] };
    const res = bankHack.guess(h, '5678', notices);
    if (res.result.cracked && !res.result.alarmed) { done = true;
      eq('украдено 10% от банка (ур.10)', res.result.stolen, Math.floor(bankBefore2 * 0.10));
      eq('bank жертвы уменьшился ровно на украденное', v.bank, bankBefore2 - res.result.stolen);
      ok('нападающий получил украденное', h.dollars >= dollarsBefore2 + res.result.stolen);
    }
  }
  ok('удалось зафиксировать хотя бы один успешный взлом для проверки', done);
}

console.log('\n[10] Дневной лимит: до 10 попыток взлома в день, провал тоже считается попыткой');
{
  const h = mkUser('u_daily', 'Дневной', { trophies: { safecracker: 5 } });
  usersMap['u_daily'] = h;
  // 10 разных жертв — каждую можно взломать 1 раз в день
  const codes = ['0192','0193','0194','0195','0196','0197','0198','0219','0231','0246'];
  for (let i = 0; i < 10; i++) {
    const v = mkUser('u_dailyv' + i, 'Жертва' + i, { bank: 5000 });
    usersMap['u_dailyv' + i] = v;
    h.pendingBankHack = { targetId: v.id, targetName: v.name, bankAmount: v.bank, code: codes[i], digits: 4, triesLeft: 6, maxTries: 6, history: [] };
    bankHack.guess(h, h.pendingBankHack.code, notices);
  }
  eq('bankHackCountToday = 10 после 10 попыток', h.bankHackCountToday, 10);
  // 11-я попытка (новая жертва) должна быть отклонена — дневной лимит исчерпан
  const v11 = mkUser('u_dailyv11', 'Жертва11', { bank: 5000 });
  usersMap['u_dailyv11'] = v11;
  const off11 = bankHack.tryOffer(h, v11);
  eq('11-е предложение в тот же день отклонено (лимит 10)', off11, null);
}

console.log('\n[11] Одну и ту же жертву нельзя взломать дважды за день; skip не тратит лимит');
{
  const h = mkUser('u_perv', 'Повторный', { trophies: { safecracker: 5 } });
  const v = mkUser('u_pervv', 'ОднаЖертва', { bank: 5000 });
  usersMap['u_perv'] = h; usersMap['u_pervv'] = v;
  h.pendingBankHack = { targetId: v.id, targetName: v.name, bankAmount: v.bank, code: '1357', digits: 4, triesLeft: 6, maxTries: 6, history: [] };
  bankHack.guess(h, '1357', notices);
  eq('счётчик попыток = 1', h.bankHackCountToday, 1);
  eq('жертва отмечена как попытанная сегодня', h.bankHackVictimsToday.includes(v.id), true);
  const offAgain = bankHack.tryOffer(h, v);
  eq('повторная попытка на ТУ ЖЕ жертву в тот же день отклонена', offAgain, null);

  // Skip — не тратит лимит
  const h2 = mkUser('u_skip', 'Скип', { trophies: { safecracker: 5 } });
  const v2 = mkUser('u_skipv', 'ЖертваСкип', { bank: 5000 });
  usersMap['u_skip'] = h2; usersMap['u_skipv'] = v2;
  h2.pendingBankHack = { targetId: v2.id, targetName: v2.name, bankAmount: v2.bank, code: '1357', digits: 4, triesLeft: 6, maxTries: 6, history: [] };
  const targetId = bankHack.skip(h2);
  eq('skip вернул верный targetId', targetId, v2.id);
  eq('pendingBankHack очищен', h2.pendingBankHack, null);
  eq('дневной лимит НЕ израсходован при отказе', h2.bankHackCountToday || 0, 0);
}

// ===================================================================
console.log('\n[12] Интеграция: мина срабатывает через battle.attack(), останавливая бой');
{
  const attacker = mkUser('u_att', 'Атакующий', { units: { ground_1: [2000, 0, 0] } });
  const defender = mkUser('u_def', 'Заминированный', { trophies: { tripwire: 10 }, landmines: 10 });
  usersMap['u_att'] = attacker; usersMap['u_def'] = defender;

  let triggered = null;
  for (let i = 0; i < 500 && !triggered; i++) {
    attacker.res.am.cur = 9999; attacker.res.hp.cur = 100; attacker.lastAttackAt = 0;
    attacker.pendingBankHack = null; attacker.pendingMineDefuse = null;
    defender.landmines = 10; defender.res.hp.cur = 100; // восполняем на случай срабатывания в предыдущей итерации
    const res = battle.attack(attacker, defender.id, notices);
    if (res.encounter === 'mine_defuse') triggered = res;
  }
  ok('мина сработала хотя бы раз за 500 попыток (шанс 20% на ур.10)', !!triggered);
  ok('в ответе 6 проводов', triggered.wires.length === 6);
  ok('pendingMineDefuse установлен у атакующего', !!attacker.pendingMineDefuse);
  eq('мина списана из запаса жертвы', defender.landmines, 9);
}

console.log('\n[13] Неверный провод -> взрыв: 100% здоровья + % техники по трофею жертвы');
{
  const attacker = mkUser('u_att2', 'Атакующий2', { units: { ground_1: [1000, 0, 0] } });
  const defender = mkUser('u_def2', 'Заминированный2', { trophies: { tripwire: 10 }, landmines: 1 });
  usersMap['u_att2'] = attacker; usersMap['u_def2'] = defender;

  // Форсируем срабатывание мины
  let res = null;
  for (let i = 0; i < 500 && !res; i++) {
    attacker.res.am.cur = 9999; attacker.res.hp.cur = 100; attacker.lastAttackAt = 0;
    defender.landmines = 1; defender.res.hp.cur = 100;
    const r = battle.attack(attacker, defender.id, notices);
    if (r.encounter === 'mine_defuse') res = r;
  }
  ok('мина сработала для теста взрыва', !!res);
  const wrongIdx = attacker.pendingMineDefuse.wires.findIndex((w, i) => i !== attacker.pendingMineDefuse.correctIdx);
  const boom = battle.mineDefuse(attacker, wrongIdx, notices);
  eq('exploded = true', boom.exploded, true);
  eq('здоровье снесено до 0', attacker.res.hp.cur, 0);
  eq('техника уничтожена на 30% (ур.10 трофея)', boom.techLossPct, 30);
  ok('lostTech непустой', boom.lostTech.length > 0);
  // Без альянса capacity()=10 — именно столько техники реально берётся в
  // бой (config.ALLIANCE.BASE_CAPACITY), даже если у игрока 1000 в ангаре.
  // Мина уничтожает % ИМЕННО от участвующей в бою техники — это и есть
  // корректное поведение (не от всего ангара).
  const committed = Math.min(1000, c.ALLIANCE.BASE_CAPACITY);
  eq(`уничтожено ровно 30% от участвующих в бою ${committed}`, boom.lostTech[0].count, Math.ceil(committed * 0.30));
  eq('pendingMineDefuse очищен', attacker.pendingMineDefuse, null);
}

console.log('\n[14] Верный провод -> бой продолжается как обычно');
{
  const attacker = mkUser('u_att3', 'Атакующий3', { units: { ground_1: [1000, 0, 0] } });
  const defender = mkUser('u_def3', 'Заминированный3', { trophies: { tripwire: 10 }, landmines: 1 });
  usersMap['u_att3'] = attacker; usersMap['u_def3'] = defender;

  let res = null;
  for (let i = 0; i < 500 && !res; i++) {
    attacker.res.am.cur = 9999; attacker.res.hp.cur = 100; attacker.lastAttackAt = 0;
    defender.landmines = 1; defender.res.hp.cur = 100;
    const r = battle.attack(attacker, defender.id, notices);
    if (r.encounter === 'mine_defuse') res = r;
  }
  ok('мина сработала для теста разминирования', !!res);
  const correctIdx = attacker.pendingMineDefuse.correctIdx;
  const outcome = battle.mineDefuse(attacker, correctIdx, notices);
  eq('mineDefused = true', outcome.mineDefused, true);
  ok('бой резолвится нормально (есть win/dealt)', typeof outcome.win === 'boolean' && outcome.dealt !== undefined);
  eq('здоровье НЕ снесено взрывом', attacker.res.hp.cur > 0, true);
  eq('pendingMineDefuse очищен', attacker.pendingMineDefuse, null);
}

console.log('\n[15] Мина не действует на ботов и не действует без трофея/без мин в запасе');
{
  const attacker = mkUser('u_att4', 'Атакующий4');
  const noTrophy = mkUser('u_notrophy', 'БезТрофея', { landmines: 10, trophies: { tripwire: 0 } });
  const noMines = mkUser('u_nomines', 'БезМин', { landmines: 0, trophies: { tripwire: 10 } });
  usersMap['u_att4'] = attacker; usersMap['u_notrophy'] = noTrophy; usersMap['u_nomines'] = noMines;
  let anyTrigger = false;
  for (let i = 0; i < 300; i++) {
    attacker.res.am.cur = 9999; attacker.res.hp.cur = 100; attacker.lastAttackAt = 0;
    noTrophy.res.hp.cur = 100;
    const r1 = battle.attack(attacker, noTrophy.id, notices);
    if (r1.encounter === 'mine_defuse') anyTrigger = true;
    attacker.pendingBankHack = null; attacker.pendingMineDefuse = null;
  }
  ok('без прокачки трофея мина никогда не срабатывает (0% при ур.0)', !anyTrigger);
  anyTrigger = false;
  for (let i = 0; i < 300; i++) {
    attacker.res.am.cur = 9999; attacker.res.hp.cur = 100; attacker.lastAttackAt = 0;
    noMines.res.hp.cur = 100;
    const r2 = battle.attack(attacker, noMines.id, notices);
    if (r2.encounter === 'mine_defuse') anyTrigger = true;
    attacker.pendingBankHack = null; attacker.pendingMineDefuse = null;
  }
  ok('без мин в запасе (0 шт.) взрыв невозможен', !anyTrigger);
}

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
