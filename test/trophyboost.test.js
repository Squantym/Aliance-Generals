// ═══════════════════════════════════════════════════════════════════
// test/trophyboost.test.js — цена ускорения прокачки трофея
//
// Жалоба игроков: ускорение не привязано ко времени. Прокачке осталось
// десять минут, а ускорение стоит столько же, сколько у только что
// запущенной, — платишь за время, которое уже прошло.
//
// Что стережётся:
//  1. Цена = полная × доля ОСТАВШЕГОСЯ времени: в момент старта прежняя,
//     на половине пути — половина, в конце — минимальное золото.
//  2. Экран и сервер считают одной формулой: сколько показали, столько и
//     списали. Разойтись им нельзя — игрок жмёт по числу на кнопке.
//  3. Масштаб цены не изменился: полная цена — те же 10 золота за час
//     прокачки, что и была. Это правка жалобы, а не пересмотр цен.
//  4. У VIP цена стартует с полной: доля считается от длительности его
//     собственной прокачки, а не от табличной.
//  5. Экран обновляется, пока идёт прокачка, — иначе цена на кнопке
//     стоит на месте, хотя на сервере уже упала.
//
// Запуск: node test/trophyboost.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const trophies = require('../dist/src/services/trophies');
const config = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const near = (n, a, b, tol) => { assert.ok(Math.abs(a - b) <= tol, `❌ ${n}: ${a} vs ${b} (±${tol})`); passed++; console.log(`  ✅ ${n} (${a})`); };

(async () => {
  await db.init();

  console.log('\n[1] Формула: платим за остаток');
  const now = Date.now();
  const lvl = 5;
  const totalMs = config.trophyTrainMinutes(lvl) * 60000;
  const full = config.trophyBoostGold(lvl);
  eq('полная цена не изменилась — 10 золота за час',
     full, Math.max(1, Math.round((config.trophyTrainMinutes(lvl) / 60) * 10)));
  eq('в момент старта платим полную',
     config.trophyBoostGoldLeft(lvl, 1, now, now + totalMs), full);
  near('на половине пути — половина',
     config.trophyBoostGoldLeft(lvl, 1, now - totalMs / 2, now + totalMs / 2), Math.round(full / 2), 1);
  near('осталась четверть — четверть цены',
     config.trophyBoostGoldLeft(lvl, 1, now - totalMs * 0.75, now + totalMs * 0.25), Math.round(full / 4), 1);
  eq('когда время вышло — минимальное золото',
     config.trophyBoostGoldLeft(lvl, 1, now - totalMs, now), 1);
  ok('цена никогда не ноль и не минус',
     config.trophyBoostGoldLeft(lvl, 1, now - totalMs * 2, now - totalMs) === 1);
  // Прокачка первого уровня — час: цена падает на глазах, но не до нуля
  eq('у часовой прокачки за минуту до конца остаётся минимум',
     config.trophyBoostGoldLeft(1, 1, now - 59 * 60000, now + 60000), 1);

  console.log('\n[2] Живая прокачка: цена падает, списывается показанная');
  await auth.register('Коллекционер', 'пароль123', 'k@t.ru', 'ru', '1.1.1.1');
  const user = Object.values(player.users()).find((x) => x.name === 'Коллекционер');
  user.level = 50; user.gold = 1000000;
  const nx = [];
  trophies.startUpgrade(user, 'medal', nx);
  const proc = (user.trophyQueue || [])[0];
  ok('прокачка запущена', !!proc);
  const view1 = trophies.list(user).trophies.find((t) => t.id === 'medal');
  const fullMedal = config.trophyBoostGold(proc.level, undefined);
  eq('сразу после запуска на кнопке полная цена', view1.boostGold, fullMedal);

  // Отматываем время: половина прокачки позади
  const half = Math.round((proc.finishesAt - proc.startedAt) / 2);
  proc.startedAt -= half; proc.finishesAt -= half;
  const view2 = trophies.list(user).trophies.find((t) => t.id === 'medal');
  ok(`на середине цена упала: было ${view1.boostGold}, стало ${view2.boostGold}`,
     view2.boostGold < view1.boostGold);
  near('и упала примерно вдвое', view2.boostGold, Math.round(fullMedal / 2), 1);

  const goldBefore = user.gold;
  const r = trophies.boostUpgrade(user, 'medal', nx);
  eq('сервер списал ровно то, что было на кнопке', goldBefore - user.gold, view2.boostGold);
  eq('и в ответе та же цена', r.cost, view2.boostGold);
  player.refresh(user);
  eq('трофей прокачан', (user.trophies || {}).medal, 1);

  console.log('\n[3] Почти доделанная прокачка стоит копейки');
  trophies.startUpgrade(user, 'shield', nx);
  const proc2 = (user.trophyQueue || []).find((p) => p.id === 'shield');
  const fullShield = config.trophyBoostGold(proc2.level, undefined);
  const total2 = proc2.finishesAt - proc2.startedAt;
  proc2.startedAt -= total2 - 60000; proc2.finishesAt -= total2 - 60000;   // осталась минута
  const view3 = trophies.list(user).trophies.find((t) => t.id === 'shield');
  ok(`за минуту до конца просят ${view3.boostGold}, а не ${fullShield}`, view3.boostGold < fullShield);
  const before2 = user.gold;
  trophies.boostUpgrade(user, 'shield', nx);
  eq('списано столько же, сколько показано', before2 - user.gold, view3.boostGold);

  console.log('\n[4] VIP не получает скидку на старте');
  await auth.register('Подписчик', 'пароль123', 'v@t.ru', 'ru', '2.2.2.2');
  const vipUser = Object.values(player.users()).find((x) => x.name === 'Подписчик');
  vipUser.level = 50; vipUser.gold = 1000000;
  require('../dist/src/services/vip').grant(null, vipUser, 30, 'тест', []);
  trophies.startUpgrade(vipUser, 'medal', nx);
  const vproc = (vipUser.trophyQueue || [])[0];
  const vView = trophies.list(vipUser).trophies.find((t) => t.id === 'medal');
  eq('цена стартует с полной, хотя прокачка короче',
     vView.boostGold, config.trophyBoostGold(vproc.level, undefined));
  ok('а сама прокачка у подписчика действительно короче',
     vproc.finishesAt - vproc.startedAt < config.trophyTrainMinutes(vproc.level) * 60000);

  console.log('\n[5] Экран не замирает');
  const market = fs.readFileSync(path.join(ROOT, 'public/js/screens/market.js'), 'utf8');
  const at = market.indexOf('Автообновление, пока идёт прокачка');
  ok('у трофеев автообновление есть', at > 0);
  ok('и оно не пустое — экран перерисовывается',
     /App\._trophyTimer = setTimeout/.test(market.slice(at, at + 500)));
  ok('перед списанием спрашивают подтверждение с ценой',
     /UI\.confirm\(`Ускорить за \$\{UI\.fmtNum\(cost\)\} золота\?`/.test(market));
  ok('цена в подтверждении берётся с той же кнопки', /t \? t\.boostGold : 0/.test(market));
  const economy = fs.readFileSync(path.join(ROOT, 'public/js/screens/economy.js'), 'utf8');
  ok('в производстве автообновление тоже ожило', /App\._prodTimer = setTimeout/.test(economy));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
