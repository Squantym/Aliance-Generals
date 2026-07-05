// Тест перевода действий в журнале (logTranslate): id → названия,
// исправленные пути (навыки/уши/контейнеры/клуб).
// Запуск: node test/logs.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const lt = require('../dist/src/services/logTranslate');

let passed = 0;
const has = (name, text, needle) => {
  assert.ok(text && text.includes(needle), `❌ ${name}: «${text}» не содержит «${needle}»`);
  passed++; console.log(`  ✅ ${name}: ${text}`);
};
const notRaw = (name, text) => {
  assert.ok(text && !text.startsWith('/api/'), `❌ ${name}: сырой путь «${text}»`);
  passed++;
};

console.log('\n[1] Предметы рынка: id → название');
const ammoName = c.MARKET_ITEM_BY_ID['ammo'].name;   // «Цинк боеприпасов»
console.log('  (ammo → ' + ammoName + ')');
const d1 = lt.describe('/api/market/buy', { itemId: 'ammo' }, {});
has('market/buy разворачивает имя', d1, ammoName);
assert.ok(!/«ammo»/.test(d1), '❌ в логе остался сырой id ammo');
passed++;

console.log('\n[2] Навык: /api/skill + stat → русское название');
const d2 = lt.describe('/api/skill', { stat: 'cruelty' }, {});
has('skill: cruelty → жестокость', d2, 'жестокость');
notRaw('skill не сырой путь', d2);
const d2b = lt.describe('/api/skill', { stat: 'agility' }, {});
has('skill: agility → ловкость', d2b, 'ловкость');

console.log('\n[3] Трофей: id → название');
const trophyId = c.TROPHIES[0].id, trophyName = c.TROPHIES[0].name;
const d3 = lt.describe('/api/trophies/start', { id: trophyId }, {});
has(`трофей ${trophyId} → ${trophyName}`, d3, trophyName);

console.log('\n[4] Спецоперация: confId → название конфликта');
const conf = c.CONFLICTS[0];
const d4 = lt.describe('/api/missions/start', { confId: conf.id }, {});
has(`конфликт ${conf.id} → ${conf.name}`, d4, conf.name);

console.log('\n[5] Легион-магазин: itemId → название');
const li = c.LEGION_SHOP_ITEMS[0];
const d5 = lt.describe('/api/legion/shop/buy', { itemId: li.id, qty: 3 }, {});
has(`легион-предмет ${li.id} → ${li.name}`, d5, li.name);
has('количество ×3', d5, '×3');

console.log('\n[6] Исправленные пути (раньше показывали сырьё)');
has('контейнер /api/market/open', lt.describe('/api/market/open', { tier: 2, qty: 1 }, {}), 'тир 2');
has('уши /api/ears/restore', lt.describe('/api/ears/restore', {}, { cost: 20 }), 'ухо');
has('клуб преферанс /api/club/pref/hit', lt.describe('/api/club/pref/hit', {}, {}), 'преферанс');
has('клуб минёр /api/club/mine/open', lt.describe('/api/club/mine/open', {}, {}), 'минёр');
has('покупка золота /api/payments/create', lt.describe('/api/payments/create', { packageId: 'p1' }, {}), 'золот');
has('ежедневка /api/daily/claim', lt.describe('/api/daily/claim', {}, {}), 'ежеднев');
has('контракт /api/contracts/claim', lt.describe('/api/contracts/claim', {}, {}), 'контракт');
has('босс /api/event/attack', lt.describe('/api/event/attack', {}, { dealtDamage: 50, crit: true }), 'урон');

console.log('\n[7] Бой и техника (регресс — не сломались)');
has('атака война', lt.describe('/api/war/attack', {}, { targetName: 'Враг', win: true, loot: 1000 }), 'ПОБЕДА');
const unitId = c.UNITS[0].id, unitNm = c.UNITS[0].name;
has('покупка техники', lt.describe('/api/units/buy', { unitId, qty: 5 }, { spent: 5000 }), unitNm);

console.log('\n[8] Неизвестный путь → null (покажется маршрут отдельной колонкой)');
assert.strictEqual(lt.describe('/api/some/unknown', {}, {}), null);
passed++; console.log('  ✅ неизвестный путь → null');

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
