// ═══════════════════════════════════════════════════════════════════
// test/containers-bulk.test.js — «Открыть все» на сотнях контейнеров
//
// Что стережётся:
//  1. Открывается ровно столько, сколько списано со склада. До 274 за раз
//     вскрывалось не больше 100, а списывались все: из 300 ящиков
//     открывались 100, 200 пропадали (жалоба: «вместо 600 секретных
//     около 300»). Центр развития даёт ровно 2 разработки, контейнер —
//     ровно 1, поэтому счёт проверяется точно, без вероятностей.
//  2. Допинг из пачки — одной строкой, а не строкой на каждый ящик.
//  3. Разовый возврат пропавшего: сверх сотни из старой истории — на
//     склад, письмо от «Системы»; второй раз не выдаёт; новые (полные)
//     открытия не считаются потерей.
//  4. В допингах на чёрном рынке виден заголовок товара.
//
// Запуск: node test/containers-bulk.test.js   (после npm run build)
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
const market = require('../dist/src/services/market');
const rewards = require('../dist/src/services/rewards');
const config = require('../dist/config/gameConfig');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const devSum = (p) => Object.values(p.secretDevs || {}).reduce((a, b) => a + b, 0);
const sabSum = (p) => ['ground', 'sea', 'air', 'building', 'secret', 'suicide'].reduce((s, k) => s + ((p.saboteurs || {})[k] || 0), 0);

(async () => {
  await db.init();
  let ipN = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `cb${++ipN}@t.ru`, 'ru', '10.0.8.' + ipN);
    return Object.values(player.users()).find((x) => x.name === name);
  };
  const T2 = config.CONTAINERS[1], T3 = config.CONTAINERS[2], T5 = config.CONTAINERS[4];
  ok(T5.chance === 200 && T3.chance === 100, 'шансы центра и контейнера — ровно 200% и 100%');

  console.log('\n[1] «Открыть все» на 300 ящиках');
  const A = await reg('Вскрыватель');
  market.addContainers(A, T5.tier, 300);
  const d0 = devSum(A), s0 = sabSum(A), m0 = A.dollars;
  const nx = [];
  const r = market.openOwned(A, T5.tier, 'all', nx);
  ok(r.qty === 300 && market.ownedCount(A, T5.tier) === 0, `со склада списано 300, осталось ${market.ownedCount(A, T5.tier)}`);
  ok(devSum(A) - d0 === 600, `центр развития ×300 — ровно 600 разработок (выпало ${devSum(A) - d0})`);
  ok(r.loot.devList.reduce((s, x) => s + x.count, 0) === 600, 'окно добычи показывает те же 600');
  const sab = sabSum(A) - s0;
  ok(sab >= 300 * T5.sab[0] && sab <= 300 * T5.sab[1], `диверсантов — за все 300 ящиков: ${sab}`);
  const unit = config.minUnitPriceAtLevel(A.level || 1);
  ok(A.dollars - m0 >= 300 * T5.moneyUnits[0] * unit, 'деньги — за все 300 ящиков');
  ok(r.history.qty === 300 && r.history.full === true, 'в истории: 300, открыто полностью');
  const dopingLines = nx.filter((x) => /Из контейнер/.test(x));
  ok(dopingLines.length === 1 && /×\d+/.test(dopingLines[0]), `допинг — одной строкой (строк: ${dopingLines.length})`);
  const dopingGot = Object.values(r.loot.doping).reduce((a, b) => a + b, 0);
  ok(dopingGot >= 300 * Math.floor(T5.doping / 100), `допинга выпало за все ящики: ${dopingGot}`);

  const B = await reg('Вскрыватель2');
  market.addContainers(B, T3.tier, 250);
  const b0 = devSum(B);
  market.openOwned(B, T3.tier, 'all', []);
  ok(devSum(B) - b0 === 250, `исследовательский ×250 — ровно 250 разработок (${devSum(B) - b0})`);

  console.log('\n[2] Возврат пропавшего');
  const C = await reg('Пострадавший');
  const D = await reg('НеПострадавший');
  // Как в живой базе: записи до исправления — без признака full
  C.containerHistory = [
    { id: 'h1', tier: T5.tier, tierName: T5.name, qty: 300, dropped: {}, at: Date.now() - 1000 },
    { id: 'h2', tier: T2.tier, tierName: T2.name, qty: 135, dropped: {}, at: Date.now() - 2000 },
    { id: 'h3', tier: T3.tier, tierName: T3.name, qty: 100, dropped: {}, at: Date.now() - 3000 },
    { id: 'h4', tier: T3.tier, tierName: T3.name, qty: 5, dropped: {}, at: Date.now() - 4000 },
  ];
  D.containerHistory = [{ id: 'h5', tier: T3.tier, tierName: T3.name, qty: 60, dropped: {}, at: Date.now() }];
  const before5 = market.ownedCount(C, T5.tier);
  const res = market.refundLostContainers();
  ok(market.ownedCount(C, T5.tier) - before5 === 200, `центр развития: вернулось 200 (${market.ownedCount(C, T5.tier) - before5})`);
  ok(market.ownedCount(C, T2.tier) === 35, `ящик забытых технологий: вернулось 35 (${market.ownedCount(C, T2.tier)})`);
  ok(market.ownedCount(C, T3.tier) === 0, 'ровно 100 и меньше — ничего не пропадало, не возвращаем');
  ok(market.ownedCount(D, T3.tier) === 0 && !rewards.listFor(D).length, 'у непострадавшего ни ящиков, ни письма');
  ok(market.ownedCount(A, T5.tier) === 0, 'полное открытие после исправления — не потеря');
  ok(res.players === 1 && res.containers === 235, `итог: ${res.containers} ящиков у ${res.players} игрока`);
  const letters = rewards.listFor(C);
  ok(letters.length === 1 && letters[0].kind === 'receipt' && letters[0].claimed === true, 'письмо от «Системы» — без кнопки «Забрать»');
  ok(letters[0].lines.some((l) => l.text === `${T5.name} ×200` && l.icon === `/img/containers/${T5.id}.webp`), 'в письме — что вернули, с картинкой');
  const again = market.refundLostContainers();
  ok(again.containers === 0 && market.ownedCount(C, T5.tier) === 200 && rewards.listFor(C).length === 1, 'второй вызов ничего не выдаёт');
  const boot = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
  ok(/if \(!meta\.lostContainersRefunded\) \{\s*\n\s*const r = market\.refundLostContainers\(\);/.test(boot), 'при запуске возврат идёт один раз, по флагу');

  console.log('\n[3] Название допинга на рынке');
  const screen = fs.readFileSync(path.join(ROOT, 'public/js/screens/market.js'), 'utf8');
  const buffCard = screen.slice(screen.indexOf("if (tab === 'buffs' || tab === 'debuffs')"), screen.indexOf("if (tab === 'mines')"));
  ok(/class="market-img"[^\n]*: ''\}\s*\n\s*<div class="name">\$\{UI\.esc\(x\.name\)\}<\/div>/.test(buffCard), 'заголовок товара выводится и при картинке');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
