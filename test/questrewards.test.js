// ═══════════════════════════════════════════════════════════════════
// test/questrewards.test.js — награды и формулировки поручений
//
// Три правила владельца, и каждое из них легко потерять при следующей
// правке конфига:
//
//  1. За ВСЕ поручения дня золота больше не дают. Бонус выдавал 150–300 🪙
//     в сутки любому, кто просто доиграл день до конца.
//  2. За все НЕДЕЛЬНЫЕ — ровно 100 🪙, не больше и не зависит от уровня.
//     Прежняя формула давала 750–1500 и в одиночку перекрывала клуб.
//  3. Контрабанда возвращает половину ПОТРАЧЕННОГО золота. Это и есть
//     главная проверка файла: раньше считалась половина ПРАЙСА, и при
//     скидке 50% на контейнеры игроку возвращали всё, что он отдал, —
//     контейнеры доставались бесплатно.
//
// Плюс формулировки: в условии должно быть написано, что делать
// («Построить 91 здание»), а не название поручения и число.
//
// Запуск: node test/questrewards.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const daily = require('../dist/src/services/dailyQuests');
const market = require('../dist/src/services/market');
const discounts = require('../dist/src/services/discounts');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Исполнитель', 'пароль123', 'q@t.ru', 'ru', '1.1.1.1');
  const U = Object.values(player.users()).find((x) => x.name === 'Исполнитель');
  U.level = 120;
  const nx = [];

  console.log('\n[1] Бонус за все поручения дня отменён');
  for (const lvl of [1, 50, 120, 300]) {
    eq(`на уровне ${lvl} бонус равен нулю`, c.dailyAllBonusGold(lvl), 0);
  }
  eq('и в списке дня он тоже ноль', daily.list(U).bonusGold, 0);
  // Маршрут остался — старый клиент из кеша должен получить внятный
  // отказ, а не молча забрать ноль и записать «бонус получен»
  throws('забрать отменённый бонус нельзя', () => daily.claimBonus(U, nx));
  ok('и отметка «бонус получен» не появилась', !daily.ensureDaily(U).bonusClaimed);

  console.log('\n[2] Бонус за все недельные — ровно 100');
  for (const lvl of [1, 50, 120, 300]) {
    eq(`на уровне ${lvl} бонус ровно 100`, c.weeklyAllBonusGold(lvl), 100);
  }
  eq('в списке недели то же число', daily.weeklyList(U).bonusGold, 100);
  eq('число вынесено в конфиг', c.WEEKLY_ALL_BONUS_GOLD, 100);

  console.log('\n[3] Условие поручения написано словами');
  const all = [...c.DAILY_QUESTS, ...c.WEEKLY_QUESTS];
  const bad = [];
  for (const q of all) {
    const target = c.dailyQuestTarget(q.base, q.diff, U.level, q.counter, q.fixedTarget);
    const d = c.questDemand(q.counter, target, q);
    // Должно быть действие + число, и это не должно быть просто именем
    if (!d || d === q.name || !/\d/.test(d) || d.length < 10) bad.push(q.id + ': ' + d);
  }
  ok(bad.length ? `без человеческой формулировки: ${bad.join(', ')}` : 'у всех поручений сказано, что делать',
     bad.length === 0);
  eq('стройка — это стройка зданий',
     c.questDemand('buildingsBuilt', 91, {}), 'Построить 91 здание');
  eq('и число склоняется правильно',
     c.questDemand('buildingsBuilt', 192, {}), 'Построить 192 здания');
  eq('и на пяти тоже', c.questDemand('buildingsBuilt', 5, {}), 'Построить 5 зданий');
  ok('у контрабанды назван товар, а не счётчик',
     /Технологичный кейс/.test(c.questDemand('buy:keis', 20, { item: 'keis' })));
  // В списке для UI формулировка обязана быть — иначе экран покажет
  // старое «Название — число»
  ok('список дня отдаёт формулировку', daily.list(U).quests.every((q) => !!q.demand));
  ok('и список недели тоже', daily.weeklyList(U).quests.every((q) => !!q.demand));

  console.log('\n[4] Контрабанда возвращает половину ПОТРАЧЕННОГО');
  const keis = c.CONTAINERS.find((x) => x.id === 'keis');
  ok('контейнер из конфига найден', !!keis && keis.gold > 0);
  // Без скидки: половина прайса и половина потраченного совпадают
  eq('без скидки — половина прайса',
     c.smuggleGoldBack({ item: 'keis', fixedTarget: 20 }, keis.gold * 20),
     Math.round(keis.gold * 20 * 0.5));
  // Со скидкой 50% игрок отдал вдвое меньше — и назад получает половину
  // ИМЕННО этого, а не половину прайса
  const spentHalf = Math.floor(keis.gold * 0.5) * 20;
  const back = c.smuggleGoldBack({ item: 'keis', fixedTarget: 20 }, spentHalf);
  eq('со скидкой возвращается половина потраченного', back, Math.round(spentHalf * 0.5));
  ok('то есть меньше, чем игрок отдал', back < spentHalf);
  ok('и меньше, чем половина прайса', back < Math.round(keis.gold * 20 * 0.5));

  console.log('\n[5] И это работает на живой покупке со скидкой');
  discounts.set('container', 50, 1);
  const quest = c.WEEKLY_QUEST_BY_ID.w_supplies;
  ok('недельное поручение на кейсы на месте', !!quest && quest.item === 'keis');
  U.gold = 1000000;
  const w = daily.ensureWeekly(U);
  w.accepted[quest.id] = { at: Date.now(), base: 0, baseGold: 0 };
  const goldBefore = U.gold;
  // Контейнеры покупаются пачками по 1/3/5 и ложатся на склад — двадцать
  // кейсов это четыре покупки по пять, ровно как их берёт живой игрок.
  for (let i = 0; i < 4; i++) market.buyContainers(U, keis.tier, 5, nx);
  const spent = goldBefore - U.gold;
  ok(`золото списано со скидкой (${spent} за ${quest.fixedTarget} шт.)`,
     spent > 0 && spent < keis.gold * quest.fixedTarget);
  eq('счётчик потраченного совпадает со списанным',
     daily.ensureWeekly(U).counters['goldOn:keis'], spent);
  const got = U.gold;
  daily.weeklyClaim(U, quest.id, nx);
  const paid = U.gold - got;
  eq('вернули ровно половину потраченного', paid, Math.round(spent * 0.5));
  ok('а не половину прайса', paid < Math.round(keis.gold * quest.fixedTarget * 0.5));
  discounts.set('container', 0, 0);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
