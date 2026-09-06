// ═══════════════════════════════════════════════════════════════════
// test/trophyremoval.test.js — снятые трофеи и возврат золота
//
// Из игры убраны два трофея, оставшиеся от фаталити: «Тесак мясника»
// (срывал сразу две части герба) и «Набор полевого хирурга» (возвращал
// часть на место).
//
// Просто выкинуть их было нельзя. Прокачка стоила золота по формуле
// 10·2^уровень, и на максимуме это 15 345 за первый и 10 230 за второй —
// до 25 575 на двоих, то есть около 20 000 ₽ по прайсу магазина. Молча
// забрать оплаченное — это не правка баланса, а изъятие купленного.
//
// Поэтому здесь проверяется не только «трофеев нет», но и то, что
// золото за них вернулось — и вернулось ОДИН раз, а не при каждом
// обращении к игроку (refresh зовётся на каждый запрос).
//
// Запуск: node test/trophyremoval.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
require('./_guard');
const DATA = path.join(process.cwd(), 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const trophies = require('../dist/src/services/trophies');
const cfg = require('../dist/config/gameConfig');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

(async () => {
  await db.init();
  await auth.register('Ветеран', 'пароль123', 'v@t.ru', 'ru', '1.1.1.1');
  const U = Object.values(player.users()).find((x) => x.name === 'Ветеран');

  console.log('\n── 1. Трофеев больше нет в игре ──');
  for (const id of ['butcher', 'sewing']) {
    ok(`«${id}» убран из списка трофеев`, !cfg.TROPHIES.some((t) => t.id === id));
  }
  ok('и их эффекты тоже',
     !cfg.TROPHIES.some((t) => t.apply === 'double_ear' || t.apply === 'ear_restore'));
  ok('список снятых объявлен — по нему считается возврат',
     Array.isArray(cfg.TROPHIES_REMOVED) && cfg.TROPHIES_REMOVED.length === 2);

  console.log('\n── 2. Бой их больше не спрашивает ──');
  // Разбор кода: если ссылка останется, эффект будет считаться от
  // несуществующего трофея — то есть всегда нулём, но молча.
  const battleSrc = fs.readFileSync(path.join(ROOT, 'src/services/battle.ts'), 'utf8');
  ok('double_ear в бою не упоминается', !/discountPct\([^)]*'double_ear'/.test(battleSrc));
  ok('ear_restore в бою не упоминается', !/discountPct\([^)]*'ear_restore'/.test(battleSrc));
  const appSrc = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  ok('окно итога не ждёт двойного срыва', !/res\.doubleCut/.test(appSrc));
  ok('и не ждёт возврата части', !/res\.restored/.test(appSrc));

  console.log('\n── 3. Возврат золота ──');
  // Собираем игрока так, как он лежит в базе: трофеи прокачаны.
  const cost = (lvl, exp) => cfg.trophyUpgradeCost(lvl, exp);
  let expected = 0;
  for (let l = 0; l < 10; l++) expected += cost(l, true);   // butcher, дорогой
  for (let l = 0; l < 4; l++) expected += cost(l, false);   // sewing, 4 уровня
  U.trophies = { butcher: 10, sewing: 4, medal: 3 };
  U.gold = 0;
  player.refresh(U);
  ok(`возвращено ${U.gold} 🪙 — ровно стоимость прокачки`, U.gold === expected);
  ok('снятые трофеи убраны у игрока',
     U.trophies.butcher === undefined && U.trophies.sewing === undefined);
  ok('чужие трофеи не тронуты', U.trophies.medal === 3);

  console.log('\n── 4. Возврат ровно один раз ──');
  // refresh зовётся на КАЖДЫЙ запрос игрока. Повторный возврат
  // превратил бы это в бесконечный источник золота.
  const after = U.gold;
  for (let i = 0; i < 5; i++) player.refresh(U);
  ok('пять повторных обращений золота не добавили', U.gold === after);

  console.log('\n── 5. Незаконченная прокачка тоже возвращается ──');
  // За неё золото уже списано, а трофея игрок не получит никогда.
  await auth.register('Второй', 'пароль123', 'v2@t.ru', 'ru', '1.1.1.1');
  const U2 = Object.values(player.users()).find((x) => x.name === 'Второй');
  U2.gold = 0;
  U2.trophies = {};
  // В очереди лежит ЦЕЛЕВОЙ уровень: заплачено за переход с предыдущего.
  U2.trophyQueue = [
    { id: 'butcher', level: 3, startedAt: Date.now(), finishesAt: Date.now() + 3600000 },
    { id: 'medal', level: 2, startedAt: Date.now(), finishesAt: Date.now() + 3600000 },
  ];
  player.refresh(U2);
  ok(`возвращено за незаконченную прокачку ${U2.gold} 🪙`, U2.gold === cost(2, true));
  ok('снятый трофей выкинут из очереди',
     !(U2.trophyQueue || []).some((j) => j.id === 'butcher'));
  ok('чужая прокачка в очереди осталась',
     (U2.trophyQueue || []).some((j) => j.id === 'medal'));

  console.log('\n── 6. Кому возвращать нечего — тому ничего не меняется ──');
  await auth.register('Третий', 'пароль123', 'v3@t.ru', 'ru', '1.1.1.1');
  const U3 = Object.values(player.users()).find((x) => x.name === 'Третий');
  U3.gold = 777;
  U3.trophies = { medal: 1 };
  player.refresh(U3);
  ok('золото не изменилось', U3.gold === 777);
  ok('его трофей на месте', U3.trophies.medal === 1);

  console.log('\n── 7. Экран трофеев их не показывает ──');
  const view = trophies.list(U);
  const ids = (Array.isArray(view) ? view : (view.trophies || view.list || [])).map((t) => t.id);
  ok('в списке для игрока снятых трофеев нет',
     !ids.includes('butcher') && !ids.includes('sewing'));
  ok('а другие трофеи на месте', ids.includes('medal'));

  console.log('\n── 8. Сама проверка умеет краснеть ──');
  // Прежняя версия этой строки сравнивала expected сама с собой
  // (x === 0 + x) и проходила всегда. Проверяем формулу по контрольной
  // точке: десятый уровень дорогого трофея стоит 10·2^9·1.5 = 7680.
  ok('формула цены не изменилась (10 ур. дорогого = 7680)', cost(9, true) === 7680);
  ok('возврат — сумма ступеней, а не одна из них', expected > cost(9, true));
  ok('возврат сверялся с живым золотом игрока', after > 0);
  ok('разбор кода различает наличие ссылки',
     /discountPct\([^)]*'double_ear'/.test("trophies.discountPct(user, 'double_ear')"));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
