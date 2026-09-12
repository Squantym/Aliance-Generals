// ═══════════════════════════════════════════════════════════════════
// test/auction-bid.test.js — ставки на аукционе наёмников
//
// Что стережётся:
//  1. Начальная ставка — 100 золота, шаг — 5. Числа лежат в конфиге, и
//     тест сверяет с ним же И с поведением: иначе правка конфига без
//     правки проверки прошла бы молча.
//  2. Ставка ниже минимума и ставка не по шагу отклоняются.
//  3. Перебить лидера можно ровно на шаг, прежнему возвращается золото.
//  4. Уже висящие лоты без ставок подтягиваются к новой начальной цене —
//     иначе после выката игроки видели бы старую до конца суток.
//
// Запуск: node test/auction-bid.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const market = require('../dist/src/services/market');
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
  const reg = async (name, ip) => {
    await auth.register(name, 'пароль123', `${ip}@t.ru`, 'ru', '10.0.12.' + ip);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.gold = 5000;
    return p;
  };

  console.log('\n[1] Начальная ставка и шаг');
  ok(config.AUCTION.MIN_BID === 100, `начальная ставка: ${config.AUCTION.MIN_BID} золота`);
  ok(config.AUCTION.BID_STEP === 5, `шаг ставки: ${config.AUCTION.BID_STEP} золота`);
  const view = market.auctionView();
  ok(view.minBid === 100 && view.bidStep === 5, 'игра получает те же числа с сервера');
  ok(view.lots.length === config.AUCTION.LOTS, `лотов на торгах: ${view.lots.length}`);
  ok(view.lots.every((l) => l.minBid === 100), 'у каждого лота начальная ставка 100');

  console.log('\n[2] Проверка ставок');
  const A = await reg('Скупщик', 1);
  const B = await reg('Перекупщик', 2);
  const lotId = view.lots[0].id;
  fails(() => market.bid(A, lotId, 95, nx), 'Минимальная ставка', 'ниже начальной — отказ');
  fails(() => market.bid(A, lotId, 102, nx), 'кратна шагу', 'не по шагу — отказ');
  const goldBefore = A.gold;
  market.bid(A, lotId, 100, nx);
  ok(A.gold === goldBefore - 100, `начальная ставка списана: ${goldBefore} → ${A.gold}`);
  fails(() => market.bid(B, lotId, 103, nx), 'Минимальная ставка', 'перебить меньше чем на шаг нельзя');
  market.bid(B, lotId, 105, nx);
  ok(A.gold === goldBefore, `перебитому вернули золото: снова ${A.gold}`);
  const after = market.auctionView().lots.find((l) => l.id === lotId);
  ok(after.best && after.best.amount === 105, `лидирует ставка ${after.best.amount}`);
  ok(after.minBid === 110, `следующая ставка — ${after.minBid}, ровно на шаг больше`);

  console.log('\n[3] Старые лоты подтягиваются к новой цене');
  const w = db.load('world', {});
  const idle = w.auctions.find((l) => !l.best);
  idle.minBid = 500;                       // как было записано до выката
  market.tick();
  ok(idle.minBid === 100, 'лот без ставок получил новую начальную цену');
  const taken = w.auctions.find((l) => l.id === lotId);
  taken.minBid = 500;                      // по этому лоту уже торгуются
  market.tick();
  ok(taken.minBid === 500, 'лот со ставкой не трогаем — торги уже идут от своей цены');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
