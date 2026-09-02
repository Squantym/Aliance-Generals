// ═══════════════════════════════════════════════════════════════════
// test/boostprice.test.js — цена ускорения за золото
//
// Стережёт одно правило: минута ОСТАТКА стоит одно золото, и цена,
// которую игрок видит, равна той, которую с него спишут.
//
// Почему это отдельный тест. Цена ускорения жила в трёх местах и во
// всех трёх считалась по-разному:
//   • спецоперации — один раз при запуске шага, от ПОЛНОЙ длительности
//     (timeMin/6), дальше не менялась;
//   • производство — плоские 100 золота независимо от остатка;
//   • клиент — рисовал то константу из шапки экрана, то настоящую цену
//     процесса, отчего число «падало с 20 до 2» при переходе между
//     экранами, а списывалась третья величина.
//
// Теперь формула одна — config.boostGoldFor(finishesAt), — и этот файл
// не даёт ей снова разъехаться по сервисам.
//
// Запуск: node test/boostprice.test.js
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.env.MONGODB_URI = '';
const DATA = path.join(process.cwd(), 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const production = require('../dist/src/services/production');
const c = require('../dist/config/gameConfig');

let passed = 0;
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

const MIN = 60000;

(async () => {
  await db.init();

  console.log('\n── 1. Сама формула ──');
  eq('девять минут — девять золота', c.boostGoldFor(Date.now() + 9 * MIN), 9);
  eq('одна минута — одно золото', c.boostGoldFor(Date.now() + 1 * MIN), 1);
  // Неполная минута всё равно платная: иначе последние секунды любого
  // процесса ускорялись бы даром, и это стало бы обычным приёмом.
  eq('меньше минуты — но не даром', c.boostGoldFor(Date.now() + 20 * 1000), 1);
  eq('уже истекло — всё равно не даром', c.boostGoldFor(Date.now() - 5000), 1);
  // Полтора часа: проверяем, что округляем ВВЕРХ, а не вниз.
  eq('90 минут — 90 золота', c.boostGoldFor(Date.now() + 90 * MIN), 90);

  console.log('\n── 2. Производство: цена падает вместе с остатком ──');
  await auth.register('Технарь', 'password1', 't@t.com', 'ru', '1.1.1.1');
  const U = Object.values(player.users()).find((x) => x.name === 'Технарь');
  U.level = c.PRODUCTION_UNLOCK_LEVEL;   // ниже этого view() отдаёт заглушку без очереди
  U.gold = 1000;
  const unit = c.UNITS[0];
  const mkProc = (minLeft) => ([{
    id: 'p1', unitId: unit.id, unitName: unit.name, qty: 1,
    fromMk: 0, toMk: 1, startedAt: Date.now(), finishesAt: Date.now() + minLeft * MIN,
  }]);

  U.modernQueue = mkProc(7);
  const q = () => production.view(U).queue.find((x) => x.id === 'p1');
  eq('семь минут остатка — семь золота', q().boostCost, 7);

  U.modernQueue = mkProc(2);
  eq('осталось две — цена два', q().boostCost, 2);
  ok('и ускорить ещё можно', q().canBoost === true);

  console.log('\n── 3. Списывают ровно то, что показали ──');
  // Главная проверка файла. Раньше кнопка показывала цену процесса,
  // подтверждение — плоскую из шапки, а сервер брал третью.
  U.modernQueue = mkProc(4);
  const shown = q().boostCost;
  const before = U.gold;
  production.boostProcess(U, 'p1', []);
  eq('списано ровно показанное', before - U.gold, shown);
  eq('и это четыре золота за четыре минуты', shown, 4);
  ok('процесс закрыт', U.modernQueue[0].finishesAt <= Date.now());

  console.log('\n── 4. Спецоперации считают тем же правилом ──');
  // Не «похоже считают», а буквально той же функцией: два сервиса,
  // одна формула. Разъедутся — этот тест покраснеет.
  U.modernQueue = mkProc(11);
  const prodCost = q().boostCost;
  const missionCost = c.boostGoldFor(Date.now() + 11 * MIN);
  eq('производство и формула сходятся', prodCost, missionCost);
  ok('и это не унаследованная константа',
     prodCost !== c.MODERN.BOOST_GOLD_COST && prodCost !== c.MISSION_STEP.BOOST_GOLD_COST);

  console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
