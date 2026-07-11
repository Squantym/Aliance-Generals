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
  return { id, name: id, level: 50, skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 }, res: { hp: { cur: 100, t: now }, en: { cur: 100, t: now }, am: { cur: 5, t: now } }, units: {}, buildings: {}, secretDevs: {}, superSecret: 0, trophies: {}, counters: { fatalities: 0, earsCut: 0 }, battle: { fatalities: 0, attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0 }, effects: [], ears: 0, earsLost: 0, earsCurrent: 2, earsLostAt: [], earPenaltyUntil: 0, earCutters: [null, null], earMessage: null, missions: {}, achStages: {}, allianceId: null, legionId: null };
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

console.log('\n[2] Срабатывание: отрезаются ОБА уха');
reset();
const A2 = mk('a'); A2.trophies = { butcher: 10 }; const V2 = mk('v');
um['a'] = A2; um['v'] = V2;
A2.pendingFatality = { targetId: 'v', isBot: false, exp: now + 60000 };
Math.random = () => 0.1;   // dodge(0.1<0=false), doubleCut(10<60=true)
battle.fatality(A2, 'ear', []);
Math.random = realRandom;
eq('жертва потеряла оба уха', V2.earsCurrent, 0);
eq('отрезано ушей у жертвы', V2.earsLost, 2);
eq('в коллекцию +2 уха', A2.ears, 2);
ok('оба слота отрезал этот игрок', V2.earCutters[0] && V2.earCutters[1] && V2.earCutters[0].id === 'a' && V2.earCutters[1].id === 'a');

console.log('\n[3] При ур.0 двойной отрез НЕ срабатывает (только одно ухо)');
reset();
const A3 = mk('a'); A3.trophies = {}; const V3 = mk('v');
um['a'] = A3; um['v'] = V3;
A3.pendingFatality = { targetId: 'v', isBot: false, exp: now + 60000 };
Math.random = () => 0.1;
battle.fatality(A3, 'ear', []);
Math.random = realRandom;
eq('срезано только одно ухо', V3.earsCurrent, 1);
eq('в коллекцию +1', A3.ears, 1);

console.log('\n[4] Двойной отрез требует оба уха у жертвы');
reset();
const A4 = mk('a'); A4.trophies = { butcher: 10 }; const V4 = mk('v'); V4.earsCurrent = 1; // только одно ухо
um['a'] = A4; um['v'] = V4;
A4.pendingFatality = { targetId: 'v', isBot: false, exp: now + 60000 };
Math.random = () => 0.1;
battle.fatality(A4, 'ear', []);
Math.random = realRandom;
eq('у жертвы с 1 ухом срезано только оно', V4.earsCurrent, 0);
eq('в коллекцию +1 (двойной невозможен)', A4.ears, 1);

Math.random = realRandom;
console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
