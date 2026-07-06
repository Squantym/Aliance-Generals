// Тест обратной связи мини-игры взлома сейфа: ответ на ввод кода должен
// содержать быки/коровы, накопленную историю попыток, а при провале —
// раскрытый код сейфа. (Была ошибка: history не передавался на клиент,
// и игрок не видел подсказок.)
// Запуск: node test/heistfeedback.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
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
    level: 20, xp: 0, dollars: 0, gold: 0, bank: opts.bank ?? 0, skillPoints: 0,
    skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 },
    res: { hp: { cur: 100, max: 100, t: now }, en: { cur: 100, max: 100, t: now }, am: { cur: 100, max: 100, t: now } },
    units: {}, workshops: 0, modernQueue: [], buildings: {}, secretDevs: {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0, earsCurrent: c.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 },
    counters: {}, achStages: {}, missions: {}, tutorial: { step: 0, done: true }, effects: [],
    trophies: Object.fromEntries(c.TROPHIES.map((t) => [t.id, (opts.trophies || {})[t.id] || 0])),
    club: {}, allianceId: null, legionId: null, lastIncomeAt: now,
    pendingFatality: null, lastChatAt: 0, trophyQueue: [],
    pendingBankHack: null, bankHackCountToday: 0, bankHackVictimsToday: [],
    landmines: 0, pendingMineDefuse: null, recentAttacks: {},
  };
}

const notices = { push: () => {} };
const H = mkUser('u_h', 'Взломщик', { trophies: { safecracker: 5 } });
const V = mkUser('u_v', 'Жертва', { bank: 50000 });
usersMap['u_h'] = H; usersMap['u_v'] = V;

// Ставим сейф с ИЗВЕСТНЫМ кодом, чтобы проверить быки/коровы детерминированно
function openSafe(triesLeft) {
  H.pendingBankHack = {
    targetId: 'u_v', targetName: 'Жертва', bankAmount: 50000,
    code: '1234', digits: 4, triesLeft: triesLeft || 6, maxTries: 6, history: [],
  };
}

console.log('\n[1] Неверная попытка: возвращаются быки/коровы и история');
openSafe(6);
// Догадка '1243' против '1234' → 2 быка (1,2 на месте), 2 коровы (4,3 не там)
const g1 = bankHack.guess(H, '1243', notices);
eq('не завершено', g1.finished, false);
eq('быков = 2', g1.result.bulls, 2);
eq('коров = 2', g1.result.cows, 2);
ok('в ответе есть история', Array.isArray(g1.result.history));
eq('история из 1 попытки', g1.result.history.length, 1);
eq('в истории сохранён ввод', g1.result.history[0].guess, '1243');
eq('в истории быки', g1.result.history[0].bulls, 2);
eq('в истории коровы', g1.result.history[0].cows, 2);
eq('осталось попыток 5', g1.result.triesLeft, 5);

console.log('\n[2] Полный промах и накопление истории');
const g2 = bankHack.guess(H, '5678', notices); // 0/0 против 1234
eq('быков = 0', g2.result.bulls, 0);
eq('коров = 0', g2.result.cows, 0);
eq('история выросла до 2', g2.result.history.length, 2);
eq('вторая попытка в истории', g2.result.history[1].guess, '5678');

console.log('\n[3] Провал (кончились попытки) раскрывает код сейфа');
openSafe(1); // последняя попытка
const g3 = bankHack.guess(H, '9876', notices); // неверно → попытки кончились
eq('завершено', g3.finished, true);
eq('код НЕ разгадан', g3.result.cracked, false);
eq('кончились попытки', g3.result.outOfTries, true);
eq('раскрыт реальный код', g3.result.code, '1234');

console.log('\n[4] Угаданный код: раскрыт код + флаг cracked');
openSafe(6);
const g4 = bankHack.guess(H, '1234', notices); // точное совпадение
eq('завершено', g4.finished, true);
eq('код разгадан', g4.result.cracked, true);
eq('4 быка', g4.result.bulls, 4);
eq('раскрыт код', g4.result.code, '1234');
ok('есть флаг тревоги/успеха', typeof g4.result.alarmed === 'boolean' && typeof g4.result.stolen === 'number');

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
