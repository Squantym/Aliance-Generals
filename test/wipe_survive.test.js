// ═══════════════════════════════════════════════════════════════════
// test/wipe_survive.test.js — мир пережил обнуление, игра работает
//
// ЧТО СЛУЧИЛОСЬ НА БОЕВОМ. После обнуления мира клуб офицеров отвечал
// «Внутренняя ошибка сервера» на каждый запрос. Причина не в клубе:
// db.wipeEverything чистит коллекции НА МЕСТЕ — у объекта удаляются все
// ключи, потому что сервисы держат на него ссылку с первого вызова.
// Для коллекции-словаря это правильно. Но у clubmatch была СТРУКТУРА
// ({ queue, matches, seq }), и после чистки от неё остался «{}» — а
// первый же st.queue.filter() ронял и /api/club, и /api/club/live,
// который опрашивается с любого экрана. В базе коллекция так и лежала:
// строкой «{}».
//
// Отсюда проверка: обнуляем структуры ВСЕХ загруженных коллекций ровно
// так же, как это делает обнуление мира, и убеждаемся, что игра после
// этого отвечает. Новая коллекция со структурой обязана уметь
// восстанавливаться при чтении, а не при первом создании.
//
// Запуск: node test/wipe_survive.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Уцелевший', 'пароль123', 'w@t.ru', 'ru', '1.1.1.1');
  const U = Object.values(player.users()).find((x) => x.name === 'Уцелевший');
  U.level = 50;

  // Экраны, которые игрок открывает первым делом после захода. Клуб и
  // его живая очередь — первыми: именно они и падали.
  const probes = [
    ['клуб офицеров',      () => require('../dist/src/services/club').view(U)],
    ['очередь клуба',      () => require('../dist/src/services/clubMatch').liveView(U)],
    ['сейф штаба',         () => require('../dist/src/services/safeCrack').view(U)],
    ['военный займ',       () => require('../dist/src/services/lottery').view(U)],
    ['сезон',              () => require('../dist/src/services/seasons').view(U)],
    ['арена',              () => require('../dist/src/services/arena').view(U)],
    ['лоты дня',           () => require('../dist/src/services/lots').view(U)],
    ['скидки',             () => require('../dist/src/services/discounts').getActive()],
    ['режим обслуживания', () => require('../dist/src/services/maintenance').view()],
    ['поручения дня',      () => require('../dist/src/services/dailyQuests').list(U)],
    ['поручения недели',   () => require('../dist/src/services/dailyQuests').weeklyList(U)],
  ];

  console.log('\n[1] До обнуления всё отвечает');
  for (const [name, fn] of probes) {
    let err = null;
    try { fn(); } catch (e) { err = e; }
    ok(`${name}: отвечает`, !err);
  }
  const known = db.loadedNames().filter((n) => n !== 'users');
  ok(`коллекций в памяти (${known.length})`, known.length >= 8);
  ok('клубная коллекция среди них', known.includes('clubmatch'));

  console.log('\n[2] Обнуление мира: структуры коллекций стёрты');
  // Ровно то же, что делает db.wipeEverything: массив — в ноль длины,
  // объект — в пустой объект, НО тот же самый объект (ссылку сервисы
  // уже держат).
  for (const n of known) {
    const box = db.peek(n);
    if (Array.isArray(box)) box.length = 0;
    else if (box && typeof box === 'object') for (const k of Object.keys(box)) delete box[k];
  }
  eq('клубная коллекция теперь пуста', JSON.stringify(db.peek('clubmatch')), '{}');

  console.log('\n[3] И после этого игра работает');
  const broken = [];
  for (const [name, fn] of probes) {
    try { fn(); ok(`${name}: пережил обнуление`, true); }
    catch (e) { broken.push(`${name} → ${e.message}`); ok(`${name}: пережил обнуление`, false); }
  }
  ok(broken.length ? `упало после обнуления: ${broken.join('; ')}` : 'ни один экран не упал',
     broken.length === 0);

  console.log('\n[4] Клуб не просто «не упал», а работает по-настоящему');
  const club = require('../dist/src/services/club');
  const cm = require('../dist/src/services/clubMatch');
  const v = club.view(U);
  ok('игры на месте', !!v.pref && !!v.intercept && !!v.sniper && !!v.thimble);
  eq('очередь пуста и это нормально', cm.stateSummary().queue, 0);
  // Встать в очередь после обнуления тоже надо уметь: это запись в ту
  // самую коллекцию, структуру которой стёрли.
  U.gold = 1000;
  const nx = [];
  const q = cm.enqueue(U, 'intercept', nx);
  eq('в очередь встаём', q.state, 'queue');
  eq('и она снова считается', cm.stateSummary().queue, 1);
  cm.leaveQueue(U, 'intercept', nx);
  eq('и выходим', cm.stateSummary().queue, 0);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
