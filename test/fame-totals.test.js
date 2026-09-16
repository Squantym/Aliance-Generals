// ═══════════════════════════════════════════════════════════════════
// test/fame-totals.test.js — Зал славы считает подвиги, а не кошелёк
//
// Что стережётся:
//  1. «Хранитель мира» — сколько игрок помиловал за всё время, а не
//     сколько жетонов у него на руках. Вложил жетоны в казну легиона —
//     место в зале славы остаётся (жалоба 17.09.2026).
//  2. «Коллекционер гербов» — сколько гербов сорвано, а не сколько
//     осталось после трат.
//  3. «Сегодня» — прирост за день по тем же счётчикам; траты его не
//     обнуляют.
//  4. Обновление посреди дня: в утреннем снимке новых показателей нет —
//     они дописываются текущим значением, и «сегодня» не показывает у
//     всех всю историю.
//  5. Настоящий путь: проникновение с перемирием растит счётчик.
//
// Запуск: node test/fame-totals.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const u = require('../dist/src/core/utils');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const fame = require('../dist/src/services/fame');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  let ipN = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `fm${++ipN}@t.ru`, 'ru', '10.0.6.' + ipN);
    return Object.values(player.users()).find((x) => x.name === name);
  };
  const top = (d, section, id) => d[section].find((c) => c.id === id).top;
  const valueOf = (list, p) => (list.find((x) => x.id === p.id) || {}).value || 0;

  const Peace = await reg('Миротворец');
  const Hoard = await reg('Копилка');
  const Taker = await reg('Сборщик');

  // Утренний снимок в СТАРОМ виде: как на сервере до обновления —
  // балансы под старыми ключами, новых показателей нет
  Peace.counters.trucesMade = 150; Peace.tokens = 150;
  Hoard.counters.trucesMade = 20;  Hoard.tokens = 20;
  Taker.counters.crestsTorn = 90;  Taker.ears = 90;
  const store = db.load('dailyFame', {});
  store.snapshotDate = u.dayKey();
  store.snapshot = {};
  for (const p of [Peace, Hoard, Taker]) store.snapshot[p.id] = { ears: p.ears || 0, tokens: p.tokens || 0, level: p.level, battles: 0, battleLoot: 0, buildingsBuilt: 0, allianceMembers: 0 };
  db.save('dailyFame');

  console.log('\n[1] Потратил — место осталось');
  Peace.tokens = 0;           // всё вложил в казну легиона
  Taker.ears = 3;             // гербы ушли на постройки
  let d = fame.fame();
  const mercy = top(d, 'allTime', 'mercy');
  ok(mercy[0].id === Peace.id && mercy[0].value === 150, `«Хранитель мира»: первый — Миротворец, 150 (${mercy[0].name}, ${mercy[0].value})`);
  ok(valueOf(mercy, Hoard) === 20, 'у второго — 20');
  const crests = top(d, 'allTime', 'ears');
  ok(crests[0].id === Taker.id && crests[0].value === 90, `«Коллекционер гербов»: 90 сорванных, а не 3 на руках (${crests[0].value})`);
  ok(/Помиловано/.test(d.allTime.find((c) => c.id === 'mercy').desc), 'в описании — помилованные, а не жетоны');

  console.log('\n[2] Обновление посреди дня');
  ok(valueOf(top(d, 'daily', 'mercy'), Peace) === 0, '«сегодня» не показывает всю историю');
  ok(valueOf(top(d, 'daily', 'ears'), Taker) === 0, 'и по гербам тоже');
  const snap = db.load('dailyFame', {}).snapshot;
  ok(snap[Peace.id].trucesMade === 150 && snap[Taker.id].crestsTorn === 90, 'новые показатели дописаны в утренний снимок');

  console.log('\n[3] «Сегодня» — прирост, траты не мешают');
  Peace.counters.trucesMade += 4;
  Peace.tokens = 0;           // и эти четыре сразу потратил
  Taker.counters.crestsTorn += 2;
  d = fame.fame();
  ok(valueOf(top(d, 'daily', 'mercy'), Peace) === 4, `сегодня помиловал 4 (${valueOf(top(d, 'daily', 'mercy'), Peace)})`);
  ok(valueOf(top(d, 'daily', 'ears'), Taker) === 2, 'сегодня сорвал 2');
  ok(valueOf(top(d, 'allTime', 'mercy'), Peace) === 154, 'за всё время — 154');

  console.log('\n[4] Новый день');
  fame.forceResetSnapshot();
  d = fame.fame();
  ok(valueOf(top(d, 'daily', 'mercy'), Peace) === 0 && valueOf(top(d, 'allTime', 'mercy'), Peace) === 154, 'новый день с нуля, итог сохранён');
  Peace.counters.trucesMade += 1;
  ok(valueOf(top(fame.fame(), 'daily', 'mercy'), Peace) === 1, 'за новый день — 1');

  console.log('\n[5] Настоящее перемирие растит счётчик');
  const battle = fs.readFileSync(path.join(__dirname, '..', 'src/services/battle.ts'), 'utf8');
  ok(/user\.tokens\+\+;\s*\n\s*ach\.bump\(user, 'trucesMade', 1/.test(battle), 'перемирие: жетон и счётчик trucesMade вместе');
  ok(/user\.ears\+\+;\s*\n\s*ach\.bump\(user, 'crestsTorn', 1/.test(battle), 'срыв герба: герб и счётчик crestsTorn вместе');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
