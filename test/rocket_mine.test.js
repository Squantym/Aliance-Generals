// Урон ракеты (100% мощи) и уведомления о шахте:
// (1) техника: суммарно теряется рандомно 400..1000 (не всегда 1000);
// (2) диверсанты: суммарно ~100..150 разных, редкие (секретные/построечные) реже;
// (3) шахта: при позднем (после дедлайна) заходе НЕ шлётся вводящее в заблуждение
//     уведомление; в пределах окна — уведомление приходит.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const silos = require('../dist/src/services/silos');
const saboteurs = require('../dist/src/services/saboteurs');
const mines = require('../dist/src/services/mines');
const notifications = require('../dist/src/services/notifications');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

function bigArmy(u) {
  u.units = {};
  // много техники разных тиров, чтобы было что терять (>2000 суммарно)
  for (const cu of c.UNITS.slice(0, 20)) u.units[cu.id] = { 0: 200, 1: 0, 2: 0 };
}

(async () => {
  await db.init();

  console.log('\n[1] Урон техники ракетой при 100%: рандом 400..1000, НЕ всегда 1000');
  const losses = [];
  for (let i = 0; i < 40; i++) {
    await auth.register('Цель' + i, 'password1', `t${i}@a.com`, 'ru', '1.1.1.' + (i % 250));
    const tgt = Object.values(player.users()).find(x => x.name === 'Цель' + i);
    bigArmy(tgt);
    const rep = silos.applyRocketDamage('Атакующий', tgt, 1.0); // 100% мощи
    losses.push(rep.techDestroyedCount);
  }
  const mn = Math.min(...losses), mx = Math.max(...losses);
  ok(`все потери в диапазоне [400..1000] (факт ${mn}..${mx})`, mn >= 400 && mx <= 1000);
  ok('потери НЕ фиксированы (есть разброс)', new Set(losses).size > 5);
  ok(`не всегда 1000 (минимум ${mn} < 1000)`, mn < 1000);
  eq('конфиг TECH_LOSS_MIN = 400', c.SILO.TECH_LOSS_MIN, 400);

  console.log('\n[2] Диверсанты ракетой при 100%: ~100..150 всего, редкие реже');
  const totals = [], commons = [], rares = [];
  for (let i = 0; i < 40; i++) {
    const tgt = Object.values(player.users()).find(x => x.name === 'Цель' + i);
    saboteurs.ensure(tgt);
    tgt.saboteurs.ground = 1000; tgt.saboteurs.sea = 1000; tgt.saboteurs.air = 1000;
    tgt.saboteurs.secret = 1000; tgt.saboteurs.building = 1000;
    tgt.saboteurRareLossAccum = 0;
    const lost = saboteurs.rocketDestroy(tgt, 1.0, []);
    const total = Object.values(lost).reduce((s, n) => s + n, 0);
    const common = (lost.ground || 0) + (lost.sea || 0) + (lost.air || 0);
    const rare = (lost.secret || 0) + (lost.building || 0);
    totals.push(total); commons.push(common); rares.push(rare);
  }
  const tMin = Math.min(...totals), tMax = Math.max(...totals);
  const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
  const avgCommon = commons.reduce((a, b) => a + b, 0) / commons.length;
  const avgRare = rares.reduce((a, b) => a + b, 0) / rares.length;
  console.log(`     всего ${tMin}..${tMax} (сред ${avgTotal.toFixed(0)}), обычных ~${avgCommon.toFixed(0)}, редких ~${avgRare.toFixed(0)}`);
  ok('суммарно около 100..150 (допуск ±15%)', avgTotal >= 85 && avgTotal <= 165);
  ok('есть разброс по количеству', new Set(totals).size > 5);
  ok('редких теряется заметно меньше, чем обычных', avgRare < avgCommon);
  ok('редкие всё же иногда гибнут (правило 5:1)', avgRare > 0);

  console.log('\n[3] Шахта: позднее (после дедлайна) обращение НЕ шлёт вводящее уведомление');
  await auth.register('Шахтёр', 'password1', 'sh@a.com', 'ru', '9.9.9.9');
  const miner = Object.values(player.users()).find(x => x.name === 'Шахтёр');
  // Смоделируем активный спуск с нападением, дедлайн которого УЖЕ прошёл
  const now = Date.now();
  miner.mines = [{
    id: 'm1', status: 'descending', descentMinutes: 10, descentEndsAt: now - 1000,
    descentsLeft: 2, goldLeft: 1000, minutesUsedToday: 10,
    terror: { at: now - 20 * 60000, deadline: now - 10 * 60000, timing: 'mid', repelled: false, resolved: false, failed: false, notified: false },
  }];
  const before = notifications.list(miner).notifications.length;
  mines.refreshAll(miner);
  const after = notifications.list(miner).notifications.length;
  eq('уведомление НЕ отправлено (дедлайн прошёл)', after, before);
  ok('нападение помечено как проваленное/разрешённое', !miner.mines.length || miner.mines[0].terror === null || miner.mines[0].terror.failed);

  console.log('\n[4] Шахта: в пределах окна уведомление ПРИХОДИТ');
  const miner2 = Object.values(player.users()).find(x => x.name === 'Шахтёр');
  const now2 = Date.now();
  miner2.mines = [{
    id: 'm2', status: 'descending', descentMinutes: 10, descentEndsAt: now2 + 5 * 60000,
    descentsLeft: 2, goldLeft: 1000, minutesUsedToday: 10,
    terror: { at: now2 - 1000, deadline: now2 + 9 * 60000, timing: 'mid', repelled: false, resolved: false, failed: false, notified: false },
  }];
  const b2 = notifications.list(miner2).notifications.length;
  mines.refreshAll(miner2);
  const a2 = notifications.list(miner2).notifications.length;
  ok('уведомление о нападении отправлено (есть время отбить)', a2 > b2);
  ok('нападение помечено notified', miner2.mines[0].terror.notified === true);

  console.log('\n[5] tickAll обрабатывает активные спуски (экспортирован)');
  ok('mines.tickAll существует', typeof mines.tickAll === 'function');
  mines.tickAll(); // не должно бросать

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
