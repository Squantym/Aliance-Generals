// Админ-выдача наёмников В ОБХОД аукциона:
// (1) выдача любого наёмника любому игроку, любое количество;
// (2) количество = суток аренды, повторная выдача ПРОДЛЕВАЕТ срок;
// (3) эффект реально работает (как у выигравшего на аукционе);
// (4) отзыв наёмника;
// (5) АУКЦИОН НЕ ЗАТРОНУТ: лоты, ставки и победители работают как прежде.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const market = require('../dist/src/services/market');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };
const RENT_MS = c.AUCTION.RENT_HOURS * 3600 * 1000;

(async () => {
  await db.init();
  await auth.register('Главком', 'password1', 'a@a.com', 'ru', '1.1.1.1');
  await auth.register('Боец', 'password1', 'b@a.com', 'ru', '1.1.1.2');
  const admin = Object.values(player.users()).find(x => x.name === 'Главком');
  const target = Object.values(player.users()).find(x => x.name === 'Боец');
  admin.isAdmin = true;

  console.log('\n[1] Список наёмников для админки');
  const list = market.adminCommandersList();
  eq('наёмников 5', list.commanders.length, 5);
  eq('срок аренды из конфига', list.rentHours, c.AUCTION.RENT_HOURS);
  ok('у каждого есть id, имя и тип эффекта', list.commanders.every(m => m.id && m.name && m.effectType));

  console.log('\n[2] Выдача по позывному, любое количество');
  const r1 = market.adminGrantCommander(admin, { name: 'Боец', commanderId: 'berserk', count: 3 }, []);
  eq('выдан нужному игроку', r1.targetName, 'Боец');
  eq('количество учтено', r1.count, 3);
  ok('срок ≈ 3 × аренда', Math.abs((r1.expiresAt - Date.now()) - 3 * RENT_MS) < 60000);
  const eff = target.effects.find(e => e.commanderId === 'berserk');
  ok('эффект появился у игрока', !!eff);
  eq('тип эффекта как у наёмника', eff.type, 'atk_pct');
  ok('помечен как наёмник', eff.merc === true && /^cmd_berserk_/.test(eff.id));

  console.log('\n[3] Повторная выдача ПРОДЛЕВАЕТ срок');
  const wasUntil = target.effects.find(e => e.commanderId === 'berserk').expiresAt;
  const r2 = market.adminGrantCommander(admin, { name: 'Боец', commanderId: 'berserk', count: 2 }, []);
  ok('отмечено как продление', r2.extended === true);
  const nowUntil = target.effects.find(e => e.commanderId === 'berserk').expiresAt;
  ok('срок вырос ровно на 2 аренды', Math.abs((nowUntil - wasUntil) - 2 * RENT_MS) < 60000);

  console.log('\n[4] Эффект реально действует (боевой множитель)');
  const mulWith = player.effMul(target, 'atk_pct');
  ok('atk_pct применяется (>1)', mulWith > 1);

  console.log('\n[5] Наёмник с комбо-эффектом даёт оба эффекта');
  market.adminGrantCommander(admin, { name: 'Боец', commanderId: 'tycoon', count: 1 }, []);
  ok('upkeep_pct выдан', target.effects.some(e => e.type === 'upkeep_pct' && e.commanderId === 'tycoon'));
  ok('income_pct выдан', target.effects.some(e => e.type === 'income_pct' && e.commanderId === 'tycoon'));

  console.log('\n[6] Список держателей для админки');
  const holders = market.adminCommanderHolders().holders;
  ok('игрок числится держателем', holders.some(x => x.name === 'Боец' && x.commanderId === 'berserk'));
  ok('указан остаток часов', holders.every(x => typeof x.hoursLeft === 'number'));

  console.log('\n[7] Отзыв наёмника');
  market.adminRevokeCommander(admin, { name: 'Боец', commanderId: 'berserk' }, []);
  ok('эффект снят', !target.effects.some(e => e.commanderId === 'berserk'));
  throws('повторный отзыв отклонён', () => market.adminRevokeCommander(admin, { name: 'Боец', commanderId: 'berserk' }, []));

  console.log('\n[8] Защита: только админ и только существующие цели');
  throws('не-админ не может выдавать', () => market.adminGrantCommander(target, { name: 'Боец', commanderId: 'ghost', count: 1 }, []));
  throws('несуществующий игрок', () => market.adminGrantCommander(admin, { name: 'НетТакого', commanderId: 'ghost', count: 1 }, []));
  throws('несуществующий наёмник', () => market.adminGrantCommander(admin, { name: 'Боец', commanderId: 'nope', count: 1 }, []));
  const r3 = market.adminGrantCommander(admin, { name: 'Боец', commanderId: 'ghost', count: 0 }, []);
  eq('количество 0 поднимается до 1', r3.count, 1);

  console.log('\n[9] АУКЦИОН НЕ ЗАТРОНУТ админ-выдачей');
  market.tick(); // создаёт лоты
  const av1 = market.auctionView(target);
  const lotsBefore = JSON.stringify((av1.lots || []).map(l => ({ id: l.commanderId, best: l.best })));
  market.adminGrantCommander(admin, { name: 'Боец', commanderId: 'fortress', count: 5 }, []);
  const av2 = market.auctionView(target);
  const lotsAfter = JSON.stringify((av2.lots || []).map(l => ({ id: l.commanderId, best: l.best })));
  eq('лоты аукциона не изменились', lotsAfter, lotsBefore);
  ok('лоты на месте', (av2.lots || []).length > 0);
  // Ставка игрока по-прежнему работает
  target.gold = 1e9;
  const lot = av2.lots[0];
  const before = target.gold;
  market.bid(target, lot.id, c.AUCTION.MIN_BID, []);
  const av3 = market.auctionView(target);
  const l3 = av3.lots.find(l => l.id === lot.id);
  ok('ставка принята аукционом', l3.best && l3.best.name === 'Боец');
  ok('золото за ставку списано', target.gold < before);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
