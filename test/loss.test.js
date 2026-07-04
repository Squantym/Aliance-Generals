// Тест снижения потерь техники в боях в 5 раз.
// Проверяет: (1) константы = старые/5; (2) реальная removeUnits даёт
// среднее снижение ~5× при новом pctBase против старого; (3) потолок ⅓ не мешает.
// Запуск: node test/loss.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const battle = require('../dist/src/services/battle');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const B = c.BATTLE;

console.log('\n[1] Константы потерь = старые ÷ 5');
const OLD = { LOSS_DEF_PCT: 0.02, LOSS_DEF_WIN_PCT: 0.005, LOSS_ATK_PCT: 0.012, LOSS_ATK_WIN_PCT: 0.006 };
for (const k of Object.keys(OLD)) {
  ok(`${k}: ${B[k]} === ${OLD[k]}/5`, near(B[k], OLD[k] / 5));
}

console.log('\n[2] Реальная removeUnits: среднее снижение потерь ≈ 5×');
// Гоняем НАСТОЯЩУЮ removeUnits с одинаковой армией при старом и новом pctBase.
const T = 10000;         // введено в бой (totalTaken)
const BIG = 10_000_000;  // запас в ангаре, чтобы техника не «кончалась»
const N = 8000;          // прогонов на каждую долю

function meanLoss(pctBase, crit) {
  let sum = 0, maxLost = 0;
  for (let i = 0; i < N; i++) {
    const victim = { units: { ground_1: [BIG, 0, 0] } };
    const entries = [{ unitId: 'ground_1', mk: 0, taken: T, name: 'Танк', secret: false }];
    const res = battle.removeUnits(victim, entries, pctBase, crit);
    const lost = res.reduce((s, r) => s + r.count, 0);
    sum += lost; if (lost > maxLost) maxLost = lost;
  }
  return { mean: sum / N, maxLost };
}

// Атакующий при поражении: старый 0.012 vs новый 0.0024
const oldA = meanLoss(0.012, false);
const newA = meanLoss(B.LOSS_ATK_PCT, false);
const ratioA = oldA.mean / newA.mean;
console.log(`  атакующий: старое ср.потеря=${oldA.mean.toFixed(1)}, новое=${newA.mean.toFixed(1)}, отношение=${ratioA.toFixed(2)}×`);
ok('снижение атакующего ≈ 5× (4.6..5.4)', ratioA > 4.6 && ratioA < 5.4);

// Защитник при поражении: старый 0.02 vs новый 0.004
const oldD = meanLoss(0.02, true);
const newD = meanLoss(B.LOSS_DEF_PCT, true);
const ratioD = oldD.mean / newD.mean;
console.log(`  защитник(крит): старое ср.потеря=${oldD.mean.toFixed(1)}, новое=${newD.mean.toFixed(1)}, отношение=${ratioD.toFixed(2)}×`);
ok('снижение защитника ≈ 5× (4.6..5.4)', ratioD > 4.6 && ratioD < 5.4);

console.log('\n[3] Потолок ⅓ не срабатывает (потери остаются пропорциональными)');
const cap = Math.ceil(T / 3);
ok(`старый максимум потерь (${oldD.maxLost}) ≪ потолка (${cap})`, oldD.maxLost < cap);
ok(`новый максимум потерь (${newD.maxLost}) ≪ потолка (${cap})`, newD.maxLost < cap);

console.log('\n[4] Абсолютные потери правдоподобны (новые значения)');
// При 10000 техники в бою типичная потеря атакующего при поражении:
console.log(`  новая средняя потеря атакующего из ${T}: ${newA.mean.toFixed(1)} ед. (${(newA.mean / T * 100).toFixed(3)}%)`);
ok('новая средняя потеря атакующего < 0.5% от армии', newA.mean / T < 0.005);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
