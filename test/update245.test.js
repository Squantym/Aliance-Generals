// ═══════════════════════════════════════════════════════════════════
// test/update245.test.js — трофеи по одному, чат альянса, цена построек
//
// Что стережётся:
//  1. Трофеи: в работе только один, и пока он прокачивается — не
//     действует. Иначе улучшение бесплатно по времени: поставил и
//     воюешь с прежним бонусом.
//  2. Чат альянса: альянсы в игре ЛИЧНЫЕ, общей комнаты нет. Игрок
//     читает только тех, с кем он во взаимном альянсе. Проверяется с
//     трёх сторон: союзник видит, посторонний — нет, и наоборот.
//  3. Цена построек: рост смягчён вдвое (13.09.2026). Проверяется и
//     число в конфиге, и сама кривая — чтобы правка конфига без правки
//     смысла не прошла молча.
//  4. Сезон: в панели нет зашитых старых наград, показывается то, что
//     вернул сервер.
//
// Запуск: node test/update245.test.js   (после npm run build)
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
const pa = require('../dist/src/services/personalAlliance');
const social = require('../dist/src/services/social');
const trophies = require('../dist/src/services/trophies');
const buildings = require('../dist/src/services/buildings');
const config = require('../dist/config/gameConfig');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const fails = (fn, part, n) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};

(async () => {
  await db.init();
  const nx = [];
  let ip = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `u245_${++ip}@t.ru`, 'ru', '10.0.18.' + ip);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 30; p.gold = 100000; p.dollars = 1e15;
    return p;
  };
  const allies = (a, b) => { pa.invitePlayer(a, b.name, nx); pa.acceptInvite(b, a.id, nx); };

  console.log('\n[1] Трофеи: один в работе, и он не действует');
  const T = await reg('Коллекционер');
  T.trophies = { medal: 3, shield: 2 };
  const atkBefore = trophies.atkBonus(T), defBefore = trophies.defBonus(T);
  ok(atkBefore > 0 && defBefore > 0, `до прокачки бонусы работают: атака ${(atkBefore * 100).toFixed(1)}%, защита ${(defBefore * 100).toFixed(1)}%`);
  trophies.startUpgrade(T, 'medal', nx);
  ok(trophies.atkBonus(T) === 0, 'взятый в прокачку трофей перестал давать бонус');
  ok(trophies.defBonus(T) === defBefore, 'остальные трофеи работают как прежде');
  ok(trophies.activeLevel(T, 'medal') === 0 && trophies.levelOf(T, 'medal') === 3,
     'уровень сохраняется, но в бою не считается');
  fails(() => trophies.startUpgrade(T, 'shield', nx), 'Одновременно улучшают только один',
        'второй трофей в прокачку не берут');
  const listed = trophies.list(T).trophies;
  const medal = listed.find((x) => x.id === 'medal');
  const shield = listed.find((x) => x.id === 'shield');
  ok(medal.training === true && medal.bonusNow === 0, 'в списке видно: прокачивается, бонус сейчас 0');
  ok(shield.busyWith === 'medal', 'у остальных трофеев помечено, чем занята мастерская');
  // Прокачка закончилась — бонус вернулся, уже на новом уровне
  T.trophyQueue[0].finishesAt = Date.now() - 1000;
  trophies.checkCompleted(T);
  ok(trophies.levelOf(T, 'medal') === 4 && trophies.atkBonus(T) > atkBefore,
     `после прокачки уровень ${trophies.levelOf(T, 'medal')}, бонус ${(trophies.atkBonus(T) * 100).toFixed(1)}%`);
  trophies.startUpgrade(T, 'shield', nx);
  ok(!!T.trophyQueue.length, 'мастерская освободилась — можно ставить следующий');

  console.log('\n[2] Чат альянса виден только своим');
  const A = await reg('Первый'), B = await reg('Союзник'), C = await reg('Посторонний');
  fails(() => social.chatPost(A, 'эй, есть кто?', 'alliance'), 'нет взаимных союзников',
        'без союзников в альянс не пишут');
  allies(A, B);
  // Между сообщениями одного игрока стоит защита от спама — в тесте
  // сдвигаем отметку последнего сообщения, а не ждём по-настоящему
  A.lastChatAt = 0;
  social.chatPost(A, 'Собираемся на штурм', 'alliance');
  const seenByB = social.chatGet(B, 0, 'alliance').messages;
  const seenByC = social.chatGet(C, 0, 'alliance').messages;
  const seenByA = social.chatGet(A, 0, 'alliance').messages;
  ok(seenByB.length === 1 && seenByB[0].text === 'Собираемся на штурм', 'союзник сообщение видит');
  ok(seenByC.length === 0, 'посторонний — нет');
  ok(seenByA.length === 1 && seenByA[0].self === true, 'автор видит своё');
  allies(C, B);
  C.lastChatAt = 0;
  social.chatPost(C, 'Привет из другого круга', 'alliance');
  ok(social.chatGet(A, 0, 'alliance').messages.length === 1,
     'у каждого свой круг: союзник союзника сообщение не получает');
  ok(social.chatGet(B, 0, 'alliance').messages.length === 2, 'а общий для обоих союзник видит оба');
  ok(social.chatGet(null, 0, 'alliance').messages.length === 0, 'гостю чат альянса не отдаётся');
  ok(social.chatGet(A, 0, 'global').messages.length === 0, 'в общий чат сообщения альянса не попали');
  pa.removeMember(B, A.id, nx);
  ok(social.chatGet(B, 0, 'alliance').messages.filter((m) => m.uid === A.id).length === 0,
     'вышел из альянса — переписку бывшего союзника больше не видит');

  console.log('\n[3] Цена построек: рост смягчён вдвое');
  ok(config.BUILDING_PRICE_GROWTH.income === 1.006 && config.BUILDING_PRICE_GROWTH.defense === 1.004,
     `рост: доходные ${config.BUILDING_PRICE_GROWTH.income}, оборонительные ${config.BUILDING_PRICE_GROWTH.defense}`);
  const step = Math.pow(config.BUILDING_PRICE_GROWTH.income, 100);
  ok(step > 1.7 && step < 1.9, `каждые +100 копий дорожают в ${step.toFixed(2)} раза, а не в 3.3`);
  const P = await reg('Строитель');
  // Из каталога игры, а не из сырого списка: вид постройки (kind) проставляется
  // при сборке каталога, и без него рост цены не считается
  const b = config.BUILDING_BY_ID[config.INCOME_BUILDINGS[0].id];
  const priceAt = (owned) => { P.buildings = { [b.id]: owned }; return buildings.costFor(P, b, owned, 1); };
  const p0 = priceAt(0), p1000 = priceAt(1000), p1100 = priceAt(1100);
  ok(p0 === b.price, `первая копия стоит ${p0.toLocaleString('ru-RU')} — базовую цену`);
  ok(p1100 / p1000 < 2, `с 1000 до 1100 копий цена растёт в ${(p1100 / p1000).toFixed(2)} раза`);
  ok(p1000 < 1.5e6, `1000-я копия стоит ${Math.round(p1000).toLocaleString('ru-RU')} вместо прежних 454 млн`);
  // Цена считается по КАЖДОЙ копии отдельно, а не «за пачку по цене последней»
  P.buildings = { [b.id]: 10 };
  let manual = 0;
  for (let i = 10; i < 15; i++) manual += Math.round(b.price * Math.pow(config.BUILDING_PRICE_GROWTH.income, i));
  const pack = buildings.costFor(P, b, 10, 5);
  ok(Math.abs(pack - manual) <= 5,
     `пачка из 5 стоит как сумма пяти отдельных копий: ${pack.toLocaleString('ru-RU')}`);

  console.log('\n[4] Сезон: числа из панели, а не зашитые');
  const adminJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  ok(!/\{ gold: 500, tokens: 3 \}/.test(adminJs), 'старых 500/300/100 в панели больше нет');
  ok(/const rw = \(season && season\.rewards\) \|\| \[\];/.test(adminJs), 'панель показывает то, что вернул сервер');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(/rw\[0\]\?\.gold/.test(core), 'и в игре награды сезона берутся с сервера');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
