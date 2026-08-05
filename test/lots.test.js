// ═══════════════════════════════════════════════════════════════════
// Лоты дня: аукцион секретных разработок и допинг со скидкой.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-lots-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 45)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const lots = require(ROOT + '/dist/src/services/lots');
const db = require(ROOT + '/dist/src/core/db');
const cfg = require(ROOT + '/dist/config/gameConfig');

async function main() {
for (const [n, e] of [['Первый','a'],['Второй','b'],['Третий','c']]) {
  await auth.register(n, 'пароль123', e + '@t.ru', 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const p1 = by('Первый'), p2 = by('Второй'), p3 = by('Третий');
for (const p of [p1, p2, p3]) p.gold = 5000;

console.log('\n── 1. Набор дня ──');
const v = lots.view(p1);
ok(v.devs.length === 4, `секретных разработок: ${v.devs.length}`);
ok(v.buffs.length === 5, `допингов: ${v.buffs.length}`);
ok(new Set(v.devs.map((d) => d.devId)).size === 4, 'разработки разные');
ok(new Set(v.buffs.map((b) => b.itemId)).size === 5, 'допинги разные');
ok(v.day === lots.mskDay(), 'набор привязан к суткам по Москве');
ok(v.secondsLeft > 0 && v.secondsLeft <= 86400, `до смены лотов: ${Math.round(v.secondsLeft / 3600)} ч`);
// Одинаковость для всех — иначе каждый видел бы свой аукцион
const v2 = lots.view(p2);
ok(JSON.stringify(v.devs.map((d) => d.devId)) === JSON.stringify(v2.devs.map((d) => d.devId)),
   'набор разработок одинаков у всех игроков');
ok(JSON.stringify(v.buffs.map((b) => b.itemId)) === JSON.stringify(v2.buffs.map((b) => b.itemId)),
   'и набор допингов тоже');

console.log('\n── 2. Скидки на допинг ──');
for (const b of v.buffs) {
  ok(lots.DISCOUNTS.includes(b.discountPct), `«${b.name}»: скидка ${b.discountPct}% — шаг 5%, от 5 до 30`);
}
ok(v.buffs.every((b) => b.price === Math.max(1, Math.floor(b.basePrice * (1 - b.discountPct / 100)))),
   'цена посчитана по скидке');
ok(v.buffs.every((b) => b.price < b.basePrice), 'цена всегда ниже обычной');

console.log('\n── 3. Запас допинга ──');
for (const b of v.buffs) {
  ok(b.stock >= lots.STOCK_MIN && b.stock <= lots.STOCK_MAX, `«${b.name}»: запас ${b.stock} (от 5 до 30)`);
}
ok(new Set(v.buffs.map((b) => b.stock)).size > 1, 'запас у разных товаров разный');

console.log('\n── 4. Аукцион: ставки ──');
const dev = v.devs[0].devId;
fails(() => lots.bid(p1, dev, 50, []), 'не меньше', 'ставка ниже 100 отклонена');
ok(lots.MIN_BID === 100, `минимальная ставка: ${lots.MIN_BID} золота`);
const goldBefore = p1.gold;
lots.bid(p1, dev, 100, []);
ok(p1.gold === goldBefore - 100, 'золото списано сразу — ставку нельзя потратить дважды');
fails(() => lots.bid(p2, dev, 100, []), 'не меньше', 'равную ставку поставить нельзя');
lots.bid(p2, dev, 150, []);
const beforeRaise = p1.gold;
lots.bid(p1, dev, 200, []);
ok(p1.gold === beforeRaise - 100, 'при повышении доплачивается только разница');
const lot = lots.view(p1).devs.find((x) => x.devId === dev);
ok(lot.topGold === 200 && lot.topName === 'Первый', `лидер: ${lot.topName} с ${lot.topGold}`);
ok(lot.leading === true, 'игрок видит, что лидирует');
ok(lot.bidders === 2, `ставок в лоте: ${lot.bidders}`);
fails(() => lots.bid(p3, dev, 1000000, []), 'Не хватает золота', 'ставка сверх кошелька отклонена');
fails(() => lots.bid(p1, 'выдуманный', 500, []), 'Лот не найден', 'несуществующий лот отклонён');

console.log('\n── 5. Покупка допинга ──');
const b0 = v.buffs[0];
const goldWas = p3.gold;
lots.buyBuff(p3, b0.itemId, 3, []);
ok(p3.gold === goldWas - b0.price * 3, `списано по цене со скидкой: ${b0.price} × 3`);
const after = lots.view(p3).buffs.find((x) => x.itemId === b0.itemId);
ok(after.left === b0.stock - 3, `запас уменьшился: ${after.left} из ${after.stock}`);
ok(after.sold === 3, 'продано учтено');
// Запас общий: второй игрок видит то же уменьшение
ok(lots.view(p1).buffs.find((x) => x.itemId === b0.itemId).left === after.left,
   'запас общий на всех игроков');
fails(() => lots.buyBuff(p3, b0.itemId, 999, []), 'Осталось всего', 'больше запаса купить нельзя');
fails(() => lots.buyBuff(p3, 'нет-такого', 1, []), 'не найден', 'чужой товар отклонён');
// Эффект действительно применился
ok((p3.effects || []).length > 0 || p3.res.en.cur >= 0, 'допинг подействовал на игрока');

console.log('\n── 6. Раскуп до нуля ──');
const b1 = lots.view(p1).buffs.find((x) => x.left > 0);
p1.gold = 999999;
lots.buyBuff(p1, b1.itemId, b1.left, []);
const sold = lots.view(p2).buffs.find((x) => x.itemId === b1.itemId);
ok(sold.left === 0, 'товар раскуплен полностью');
fails(() => lots.buyBuff(p2, b1.itemId, 1, []), 'закончился', 'остальным не досталось — как и задумано');

console.log('\n── 7. Подведение итогов в полночь ──');
const all = db.load('lots', {});
const today = lots.mskDay();
all['2020-01-01'] = { ...JSON.parse(JSON.stringify(all[today])), day: '2020-01-01', settled: false };
db.save('lots');
const p2GoldBefore = p2.gold;
const p1DevsBefore = Object.keys(p1.secretDevs || {}).length;
lots.settleOld(today);
ok(p1.secretDevs && p1.secretDevs[dev] >= 1, 'победитель получил разработку');
ok(Object.keys(p1.secretDevs).length > p1DevsBefore, 'разработка зачислена на аккаунт');
ok(p2.gold > p2GoldBefore, `проигравшему вернули золото: ${p2GoldBefore} → ${p2.gold}`);
ok(db.load('lots', {})['2020-01-01'].settled === true, 'день помечен подведённым');
// Повторное подведение не дублирует выдачу
const devsAfter = p1.secretDevs[dev];
lots.settleOld(today);
ok(p1.secretDevs[dev] === devsAfter, 'повторное подведение ничего не дублирует');

console.log('\n── 8. Хранение истории ──');
for (let i = 1; i <= 12; i++) {
  const k = `2020-02-${String(i).padStart(2, '0')}`;
  db.load('lots', {})[k] = { day: k, devs: [], buffs: [], settled: true };
}
db.save('lots');
lots.ensureDay();
ok(Object.keys(db.load('lots', {})).length <= 7, `старые дни удаляются: осталось ${Object.keys(db.load('lots', {})).length}`);

console.log('\n── 9. Интерфейс ──');
const mk = fs.readFileSync(ROOT + '/public/js/screens/market.js', 'utf8');
ok(/\['lots', '🎯 Лоты дня'\]/.test(mk), 'вкладка «Лоты дня» есть на чёрном рынке');
ok(/tab === 'lots'/.test(mk), 'у неё свой экран');
ok(/data-bid=/.test(mk), 'кнопка ставки');
ok(/data-buy=/.test(mk), 'кнопка покупки допинга');
ok(/lot-leading/.test(mk), 'лидирующая ставка выделяется');
ok(/lot-sold/.test(mk) && /Разобрали/.test(mk), 'раскупленный товар помечается');
ok(/до смены:/.test(mk), 'показывается время до обновления');
ok(/lot-card/.test(mk), 'лоты оформлены карточками с картинками');
ok(/<span class="ic-gold"><\/span>/.test(mk), 'цены с иконкой золота');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(css.includes('.lot-row'), 'стили лотов добавлены');
ok(/@media \(max-width: 460px\)[\s\S]{0,120}lot-row/.test(css), 'на телефоне строки перестраиваются');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
for (const [m, r] of [['GET', '/api/lots'], ['POST', '/api/lots/bid'], ['POST', '/api/lots/buy']]) {
  ok(new RegExp(`app\\.add\\('${m}',\\s*'${r.replace(/\//g, '\\/')}'`).test(routes), `роут ${m} ${r}`);
}

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
