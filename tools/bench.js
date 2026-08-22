// ═══════════════════════════════════════════════════════════════════
// tools/bench.js — замер скорости на синтетической базе игроков.
//
// Смысл: понять, что именно начнёт тормозить при росте числа игроков,
// ДО того как это увидят люди. Скрипт ничего не сохраняет на диск —
// он работает с базой в памяти процесса.
//
// Запуск: node tools/bench.js [сколько_игроков]   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const N = Number(process.argv[2] || 3000);

const db      = require('../dist/src/core/db');
const config  = require('../dist/config/gameConfig');
const player  = require('../dist/src/services/player');
const battle  = require('../dist/src/services/battle');

const um = player.users();
for (const k of Object.keys(um)) delete um[k];

const t0 = Date.now();
const unitIds = config.UNITS.slice(0, 40).map((x) => x.id);
for (let i = 0; i < N; i++) {
  const t = Date.now() - Math.floor(Math.random() * 86400000);
  const id = 'u' + i;
  const units = {};
  for (let k = 0; k < 8; k++) {
    const uid = unitIds[(i + k) % unitIds.length];
    units[uid] = { 0: 10 + (i % 30), 1: i % 5, 2: i % 3 };
  }
  um[id] = {
    id, name: 'Игрок' + i, level: 1 + (i % 250), dollars: i * 1000, gold: i % 5000,
    rating: i % 900, xp: i * 137, country: 'ru',
    skills: { energy: 5, health: 5, ammo: 5, cruelty: 5, agility: 5 },
    res: { hp: { cur: 100, t }, en: { cur: 100, t }, am: { cur: 50, t } },
    units, buildings: { hq: 5, barracks: 3 }, secretDevs: {}, superSecret: 0,
    trophies: {}, counters: {}, effects: [],
    battle: { fatalities: 0, attacks: i % 50, wins: i % 30, losses: i % 20, defWins: 0, defLosses: 0 },
    ears: 0, earsLost: 0, earsCurrent: 2, earsLostAt: [], earPenaltyUntil: 0,
    earCutters: [null, null], earMessage: null, missions: {}, achStages: {},
    allianceId: null, legionId: null, lastIncomeAt: t, lastSeen: t,
    tutorial: { step: 0, done: true },
    access: { ips: [{ ip: '10.0.' + (i % 250) + '.' + (i % 99), at: t, n: 3 }] },
  };
}
console.log(`База из ${N} игроков собрана за ${Date.now() - t0} мс\n`);

const me = um['u0'];
function bench(name, fn, iters) {
  try { fn(); } catch (e) { console.log(`  ${name.padEnd(38)} — не запустилось: ${e.message}`); return; }
  const runs = iters || 20;
  const s = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn();
  const ms = Number(process.hrtime.bigint() - s) / 1e6 / runs;
  const mark = ms > 50 ? '⛔' : ms > 10 ? '⚠️ ' : '  ';
  console.log(`${mark} ${name.padEnd(38)} ${ms.toFixed(2)} мс`);
}

console.log('── На каждый заход игрока ──');
bench('player.refresh (регенерация, доход)', () => player.refresh(me), 200);
bench('player.mePayload (главный экран)', () => player.mePayload(me), 50);
bench('battle.opponents (список целей)', () => battle.opponents(me), 20);
bench('player.findByName (поиск по имени)', () => player.findByName('Игрок' + (N - 1)), 50);

console.log('\n── Сохранение ──');
bench('markUser × 100 (пометить, не писать)', () => {
  for (let i = 0; i < 100; i++) db.markUser('u' + i);
}, 20);

console.log('\nГотово.');
process.exit(0);
