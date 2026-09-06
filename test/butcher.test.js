const CREST_PARTS = require('../dist/config/gameConfig').CREST.PARTS;
// Тест «Тесак мясника» (трофей butcher, effect double_ear): шанс отрезать
// СРАЗУ ОБА уха при фаталити. Проверяем: шанс = 6%×уровень; при срабатывании
// отрезаются оба уха; при ур.0 не срабатывает; нужны оба уха у жертвы.
// Запуск: node test/butcher.test.js  (после npm run build)
const assert = require('assert');
const db = require('../dist/src/core/db');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const trophies = require('../dist/src/services/trophies');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (=${a})`); };

const um = player.users();
const realRandom = Math.random;
const now = Date.now();
function mk(id) {
  return { id, name: id, level: 50, skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 }, res: { hp: { cur: 100, t: now }, en: { cur: 100, t: now }, am: { cur: 5, t: now } }, units: {}, buildings: {}, secretDevs: {}, superSecret: 0, trophies: {}, counters: { breaches: 0, crestsTorn: 0 }, battle: { breaches: 0, attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0 }, effects: [], ears: 0, crestPartsLost: 0, crestParts: CREST_PARTS, crestLostAt: [], crestTakers: new Array(CREST_PARTS).fill(null), crestMessage: null, missions: {}, achStages: {}, allianceId: null, legionId: null };
}
function reset() { for (const k of Object.keys(um)) delete um[k]; }

console.log('\n[1] Шанс = 6% × уровень трофея');
reset();
const A = mk('a'); A.trophies = { butcher: 10 }; um['a'] = A;
eq('ур.10 → 60%', trophies.discountPct(A, 'double_ear'), 60);
A.trophies = { butcher: 5 };
eq('ур.5 → 30%', trophies.discountPct(A, 'double_ear'), 30);
A.trophies = {};
eq('без трофея → 0%', trophies.discountPct(A, 'double_ear'), 0);

console.log('\n[2] Срабатывание: срываются СРАЗУ ДВЕ части герба');
reset();
const A2 = mk('a'); A2.trophies = { butcher: 10 }; const V2 = mk('v');
um['a'] = A2; um['v'] = V2;
A2.pendingBreach = { targetId: 'v', isBot: false, exp: now + 60000 };
Math.random = () => 0.1;   // dodge(0.1<0=false), doubleCut(10<60=true)
battle.breach(A2, 'crest', []);
Math.random = realRandom;
eq('на месте осталась одна часть из трёх', V2.crestParts, 1);
eq('сорвано частей у хозяина', V2.crestPartsLost, 2);
eq('в коллекцию +2 герба', A2.ears, 2);
ok('обе части снял этот игрок', V2.crestTakers[0] && V2.crestTakers[1] && V2.crestTakers[0].id === 'a' && V2.crestTakers[1].id === 'a');

console.log('\n[3] При ур.0 двойной срыв НЕ срабатывает (только одна часть)');
reset();
const A3 = mk('a'); A3.trophies = {}; const V3 = mk('v');
um['a'] = A3; um['v'] = V3;
A3.pendingBreach = { targetId: 'v', isBot: false, exp: now + 60000 };
Math.random = () => 0.1;
battle.breach(A3, 'crest', []);
Math.random = realRandom;
eq('снята только одна часть', V3.crestParts, 2);
eq('в коллекцию +1', A3.ears, 1);

console.log('\n[4] Двойной срыв требует хотя бы две части на месте');
reset();
const A4 = mk('a'); A4.trophies = { butcher: 10 }; const V4 = mk('v'); V4.crestParts = 1; // на месте только одна часть
um['a'] = A4; um['v'] = V4;
A4.pendingBreach = { targetId: 'v', isBot: false, exp: now + 60000 };
Math.random = () => 0.1;
battle.breach(A4, 'crest', []);
Math.random = realRandom;
eq('у жертвы с 1 ухом срезано только оно', V4.crestParts, 0);
eq('в коллекцию +1 (двойной невозможен)', A4.ears, 1);

console.log('\n[5] Против БОТА трофей тоже работает (в коллекцию 2 уха)');
reset();
const A5 = mk('a'); A5.trophies = { butcher: 10 }; um['a'] = A5;
A5.pendingBreach = { targetId: 'bot_x', isBot: true, exp: now + 60000 };
Math.random = () => 0.1;   // 10 < 60 → двойной отрез
battle.breach(A5, 'crest', []);
Math.random = realRandom;
eq('против бота: +2 уха в коллекцию', A5.ears, 2);
reset();
const A6 = mk('a'); A6.trophies = {}; um['a'] = A6;
A6.pendingBreach = { targetId: 'bot_x', isBot: true, exp: now + 60000 };
Math.random = () => 0.1;
battle.breach(A6, 'crest', []);
Math.random = realRandom;
eq('против бота без трофея: +1 ухо', A6.ears, 1);

Math.random = realRandom;
console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
