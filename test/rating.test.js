// Новая НАКОПИТЕЛЬНАЯ система рейтинга:
//   победа +1, поражение −1, ухо/жетон +3, тебе отрезали ухо −3, мина −3.
// Плюс: старт с нуля, rating() читает поле (не формулу от уровня).
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Рейтинг1', 'password1', 'r1@a.com', 'ru', '1.1.1.1');
  await auth.register('Рейтинг2', 'password1', 'r2@a.com', 'ru', '1.1.1.2');
  const u1 = Object.values(player.users()).find(x => x.name === 'Рейтинг1');
  const u2 = Object.values(player.users()).find(x => x.name === 'Рейтинг2');

  console.log('\n[1] Старт с нуля, рейтинг НЕ зависит от уровня');
  eq('новый игрок: рейтинг 0', player.rating(u1), 0);
  u1.level = 250; // раньше формула давала level*150 → 37500
  eq('высокий уровень НЕ повышает рейтинг', player.rating(u1), 0);

  console.log('\n[2] addRating меняет рейтинг (в т.ч. в минус)');
  player.addRating(u1, 5);
  eq('после +5 рейтинг 5', player.rating(u1), 5);
  player.addRating(u1, -8);
  eq('после −8 рейтинг −3 (уходит в минус)', player.rating(u1), -3);
  u1.rating = 0;

  console.log('\n[3] Победа +1 / поражение −1 в реальном бою');
  u1.level = 100; u2.level = 100;
  const hi = c.UNITS[Math.min(18, c.UNITS.length - 1)], lo = c.UNITS[0];
  u1.units = { [hi.id]: { 0: 3000, 1: 0, 2: 0 } };  // доминирует
  u2.units = { [lo.id]: { 0: 1, 1: 0, 2: 0 } };
  u2.skills.agility = 0;
  const reset = (p) => { p.lastAttackAt = 0; p.pendingFatality = null; p.pendingBankHack = null; p.pendingMineDefuse = null;
    const mx = player.maxima(p); p.res.hp.cur = mx.hp; p.res.am.cur = mx.am; p.res.en.cur = mx.en; };
  let wins = 0, defLosses = 0;
  for (let i = 0; i < 5; i++) {
    reset(u1); u2.res.hp.cur = player.maxima(u2).hp;
    const r = battle.attack(u1, u2.id, []);
    if (r.encounter) continue;
    if (r.win) { wins++; defLosses++; }
  }
  ok(`атакующий побеждал (${wins} раз)`, wins > 0);
  eq('рейтинг атакующего = число побед', player.rating(u1), wins);
  eq('рейтинг защитника = −(число поражений)', player.rating(u2), -defLosses);

  console.log('\n[4] Отрезанное ухо: +3 нападавшему, −3 жертве');
  u1.rating = 0; u2.rating = 0;
  u2.earsCurrent = 2; u2.earsLost = 0; u2.earsLostAt = []; u2.earCutters = [null, null];
  u1.pendingFatality = { targetId: u2.id, name: u2.name, isBot: false, exp: Date.now() + 60000 };
  battle.fatality(u1, 'ear', []);
  eq('нападавший +3 за ухо', player.rating(u1), 3);
  eq('жертва −3 за отрезанное ухо', player.rating(u2), -3);

  console.log('\n[5] Жетон (помилование): +3 помиловавшему, жертва не теряет');
  u1.rating = 0; u2.rating = 0;
  u1.pendingFatality = { targetId: u2.id, name: u2.name, isBot: false, exp: Date.now() + 60000 };
  battle.fatality(u1, 'mercy', []);
  eq('помиловавший +3 за жетон', player.rating(u1), 3);
  eq('помилованный рейтинг не теряет', player.rating(u2), 0);

  console.log('\n[6] Подрыв на мине: −3');
  u1.rating = 0;
  u1.pendingMineDefuse = { targetId: u2.id, isBot: false, wires: ['a','b','c'], correctIdx: 0, techLossPct: 10, aArmyEntries: [] };
  battle.mineDefuse(u1, 1, []); // неверный провод → подрыв
  eq('подорвавшийся −3', player.rating(u1), -3);

  console.log('\n[7] Успешное разминирование НЕ снимает −3 (бой продолжается)');
  u1.rating = 0;
  u1.pendingMineDefuse = { targetId: u2.id, isBot: false, wires: ['a','b','c'], correctIdx: 2, techLossPct: 10, aArmyEntries: [] };
  battle.mineDefuse(u1, 2, []); // верный провод → бой продолжается
  ok(`штрафа за подрыв нет (рейтинг ${player.rating(u1)} ≥ 0)`, player.rating(u1) >= 0);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
