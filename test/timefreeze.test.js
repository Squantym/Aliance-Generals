// ═══════════════════════════════════════════════════════════════════
// test/timefreeze.test.js — заморозка игровых таймеров на обновление
//
// Проверяется обещание, данное игроку в окне обновления: «назначенные
// бои не пройдут без вас». Оно складывается из двух половин, и каждая
// без другой бесполезна:
//
//   1. МИР НЕ ДВИЖЕТСЯ, пока игра закрыта. Бой, назначенный на середину
//      получасового окна, иначе прошёл бы в пустой игре — все его
//      участники проиграли бы, не сделав ни одного хода.
//
//   2. СРОКИ СДВИГАЮТСЯ ПРИ ОТКРЫТИИ ровно на длительность простоя.
//      Без этого бой, до которого оставалось пять минут, начался бы
//      через десять секунд после открытия — люди не успели бы вернуться.
//
// И два ограничения, каждое из которых — отдельное решение:
//
//   3. ПРОШЕДШИЕ СРОКИ НЕ ТРОГАЕМ. Сдвинуть их значит воскресить уже
//      закончившееся.
//
//   4. ЯКОРЯ НАКОПЛЕНИЯ НЕ ТРОГАЕМ. Доход, лечение, регенерация идут от
//      меток в прошлом (lastIncomeAt и родня). Сдвинь их — и обновление
//      превратится в наказание: игрока и из игры выгнали, и час лечения
//      ему не засчитали.
//
// Запуск: node test/timefreeze.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Своя папка данных: тест пишет в базу, и делать это в рабочей нельзя.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-'));
fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });
process.chdir(workDir);
process.env.DB_DRIVER = '';
process.env.MONGODB_URI = '';
process.env.NODE_ENV = 'test';

const db = require(path.join(ROOT, 'dist/src/core/db.js'));
const tf = require(path.join(ROOT, 'dist/src/services/timefreeze.js'));

const HOUR = 3600000;
const now = Date.now();

(async () => {
  console.log('\n── 1. Что считается сроком в будущем ──');
  // Правило по имени, а не по списку конкретных полей: список протух бы
  // на первом же новом таймере, причём молча.
  const future = ['battleAt', 'prepEndsAt', 'activeEndsAt', 'readyAt', 'finishesAt',
    'buildFinishesAt', 'descentEndsAt', 'expiresAt', 'endsAt', 'nextStartAt',
    'banUntil', 'vipUntil', 'guardedUntil', 'armorUntil', 'critUntil',
    'earPenaltyUntil', 'blockedUntil', 'prepareUntil', 'resetsAt'];
  for (const k of future) ok(`срок: ${k}`, tf.isFutureKey(k) === true);

  const pastKeys = ['createdAt', 'regAt', 'startedAt', 'finishedAt', 'bannedAt',
    'lastIncomeAt', 'lastAttackAt', 'lastSeenAt', 'earsLostAt', 'at', 'offAt',
    'paidAt', 'updatedAt', 'frozenFrom'];
  for (const k of pastKeys) ok(`не срок: ${k}`, tf.isFutureKey(k) === false);

  ok('не срок: обычное поле gold', tf.isFutureKey('gold') === false);
  ok('не срок: level', tf.isFutureKey('level') === false);

  console.log('\n── 2. Сдвиг: что уехало, а что осталось ──');
  const users = db.load('users', {});
  users.u1 = {
    id: 'u1', name: 'Боец', gold: 500, level: 12,
    createdAt: now - 10 * HOUR,          // запись о прошлом
    lastIncomeAt: now - 600000,          // якорь накопления дохода
    earsLostAt: now - 300000,            // якорь отрастания уха
    lastAttackAt: now - 60000,           // якорь отката атаки
    banUntil: now + 2 * HOUR,            // срок в будущем
    guardedUntil: now - 60000,           // срок УЖЕ прошёл
    build: { buildFinishesAt: now + 30 * 60000 },      // вложенный объект
    lasers: [{ readyAt: now + 45 * 60000 }, { readyAt: now - 1000 }], // массив
  };
  db.save('users');

  const legions = db.load('legions', {});
  legions.l1 = { id: 'l1', name: 'Первый', war: { enemyId: 'l2', role: 'attacker', battleAt: now + 5 * 60000 } };
  legions.l2 = { id: 'l2', name: 'Второй', war: { enemyId: 'l1', role: 'defender', battleAt: now + 5 * 60000 } };
  db.save('legions');

  const before = JSON.parse(JSON.stringify({ u: users.u1, l: legions.l1 }));

  const DELTA = 30 * 60000;              // простой полчаса
  const r = tf.shiftFuture(now, DELTA);
  ok('сдвиг выполнен', r.ok === true);
  ok('и что-то действительно переехало', r.moved > 0);

  // Главное обещание: бой был через пять минут — снова через пять минут.
  ok('бой легиона уехал ровно на длительность простоя',
     legions.l1.war.battleAt === before.l.war.battleAt + DELTA);
  ok('и у второй стороны тоже', legions.l2.war.battleAt === before.l.war.battleAt + DELTA);
  ok('постройка уехала', users.u1.build.buildFinishesAt === before.u.build.buildFinishesAt + DELTA);
  ok('срок бана уехал', users.u1.banUntil === before.u.banUntil + DELTA);
  ok('срок в массиве уехал', users.u1.lasers[0].readyAt === before.u.lasers[0].readyAt + DELTA);

  console.log('\n── 3. Прошедшее не воскрешаем ──');
  ok('истёкшая броня осталась истёкшей', users.u1.guardedUntil === before.u.guardedUntil);
  ok('готовый лазер остался готовым', users.u1.lasers[1].readyAt === before.u.lasers[1].readyAt);

  console.log('\n── 4. Накопления в пользу игрока не замораживаем ──');
  // Иначе обновление становится наказанием: и из игры выгнали, и полчаса
  // лечения не засчитали.
  ok('доход идёт как шёл', users.u1.lastIncomeAt === before.u.lastIncomeAt);
  ok('ухо отрастает как отрастало', users.u1.earsLostAt === before.u.earsLostAt);
  ok('откат атаки не продлился', users.u1.lastAttackAt === before.u.lastAttackAt);
  ok('дата регистрации не поехала', users.u1.createdAt === before.u.createdAt);

  console.log('\n── 5. Обычные числа не трогаем ──');
  // Без проверки «похоже на метку времени» сюда уехало бы всё подряд.
  ok('золото на месте', users.u1.gold === 500);
  ok('уровень на месте', users.u1.level === 12);

  console.log('\n── 6. Пределы ──');
  const tooLong = tf.shiftFuture(now, 13 * HOUR);
  ok('простой больше 12 часов сроки не двигает', tooLong.ok === false);
  ok('и объясняет почему', /предел/i.test(tooLong.why));
  ok('бой при этом не тронут', legions.l1.war.battleAt === before.l.war.battleAt + DELTA);

  const tiny = tf.shiftFuture(now, 3000);
  ok('простой в три секунды — шум, не двигаем', tiny.ok === false);
  ok('нулевой сдвиг тоже', tf.shiftFuture(now, 0).ok === false);

  console.log('\n── 7. Таблица коллекций совпадает с настоящими ──');
  // Пустое значение здесь обязано совпадать с тем, с каким коллекцию
  // читает её собственный сервис. Прочитать `world` как `{}` значит
  // подсунуть владельцу объект без chat и auctions — и уронить чат.
  const src = ['src/services', 'src'].flatMap((d) => {
    const p = path.join(ROOT, d);
    return fs.readdirSync(p).filter((f) => f.endsWith('.ts')).map((f) => path.join(p, f));
  }).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const shapes = { world: /chat/, arena: /divs/, groupBattle: /registered/ };
  for (const [name, re] of Object.entries(shapes)) {
    const mine = JSON.stringify(tf.COLLECTIONS[name]);
    ok(`${name} читается со своим пустым значением`, re.test(mine));
  }
  // И наоборот: коллекции журнала и аналитики в список попасть не должны.
  for (const bad of ['actionLogs', 'analytics', 'maintenance', 'weeklyMetricsBackup']) {
    ok(`${bad} не сдвигаем`, !(bad in tf.COLLECTIONS));
  }
  ok('исходники прочитаны (проверка не пустая)', src.length > 10000);

  console.log('\n── 8. Мировой тик замирает, но данные пишутся ──');
  // Тик подтягивает свои модули в момент вызова, поэтому подменяем
  // им функции в кэше require и просто считаем вызовы. Проверять
  // «двигался ли мир» по последствиям было бы гаданием: тик ловит свои
  // ошибки, и упавший resolveWars выглядел бы как «не вызывался».
  const worldTick = require(path.join(ROOT, 'dist/src/services/worldTick.js'));
  const maint = require(path.join(ROOT, 'dist/src/services/maintenance.js'));
  const market = require(path.join(ROOT, 'dist/src/services/market.js'));
  let game = 0, house = 0;
  // Первый вызов игровой половины считаем и роняем нарочно: заодно
  // проверяется, что упавшая война не уносит с собой сохранение данных.
  market.tick = () => { game++; throw new Error('нарочная поломка тика'); };
  db.saveAll = () => { house++; };

  // turnOff при выключенном режиме — законный отказ, а не поломка.
  const openGame = () => { try { maint.turnOff('тест'); } catch (e) {} };
  openGame();
  let t = worldTick.tick();
  ok('игра открыта — мир движется', t.frozen === false && game === 1);
  ok('упавшая война не уносит с собой сохранение данных', house === 1);

  maint.schedule('Хозяин', { reason: 'Тест', delayMin: 0, durationMin: 30 });
  t = worldTick.tick();
  ok('игра закрыта — мир НЕ движется', t.frozen === true && game === 1);
  ok('а данные всё равно пишутся', house === 2);

  // Назначенное, но ещё не наступившее окно игру не останавливает.
  openGame();
  maint.schedule('Хозяин', { reason: 'Тест', delayMin: 60, durationMin: 30 });
  t = worldTick.tick();
  ok('назначенное на потом окно мир не останавливает', t.frozen === false && game === 2);

  console.log('\n── 9. Открытие игры размораживает сроки ──');
  // Здесь проверяется сама проводка: сдвиг обязан случиться по кнопке
  // «Открыть игру», а не только если позвать timefreeze руками.
  openGame();
  const wasAt = Date.now() + 5 * 60000;
  legions.l1.war.battleAt = wasAt;
  legions.l2.war.battleAt = wasAt;
  db.save('legions');

  maint.schedule('Хозяин', { reason: 'Обновление', delayMin: 0, durationMin: 30 });
  // Время вперёд не перевести — двигаем назад момент, с которого стоят
  // таймеры. Для сдвига это ровно то же самое, что простой в 10 минут.
  const st = db.load('maintenance', {});
  st.frozenFrom = Date.now() - 10 * 60000;
  db.save('maintenance');

  maint.turnOff('Хозяин');
  const moved = legions.l1.war.battleAt - wasAt;
  ok('бой уехал примерно на длительность простоя',
     Math.abs(moved - 10 * 60000) < 5000);
  ok('игра открыта', maint.isOn() === false);
  const av = maint.adminView();
  ok('панель показывает сводку разморозки', !!av.lastFreeze && av.lastFreeze.moved > 0);
  ok('и заморозка снята', av.frozenFrom === 0);

  // Отмена ещё не наступившего окна ничего не сдвигает: замораживать
  // было нечего, игра всё это время работала.
  const beforeCancel = legions.l1.war.battleAt;
  maint.schedule('Хозяин', { reason: 'Потом', delayMin: 60, durationMin: 30 });
  maint.turnOff('Хозяин');
  ok('отмена назначенного окна сроки не двигает',
     legions.l1.war.battleAt === beforeCancel);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  try { process.chdir(ROOT); fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
