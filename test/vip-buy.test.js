// ═══════════════════════════════════════════════════════════════════
// Покупка VIP за золото, оформление страницы подписки и журнал золота
// с выбором игрока и понятными записями.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-vipbuy-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 45)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const vip = require(ROOT + '/dist/src/services/vip');
const tr = require(ROOT + '/dist/src/services/logTranslate');
const core = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');

async function main() {
await auth.register('Игрок', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
const u = Object.values(player.users())[0];

console.log('\n── 1. Покупка подписки ──');
ok(vip.PRICE_GOLD === 500, `цена: ${vip.PRICE_GOLD} золота`);
ok(vip.PRICE_DAYS === 7, `срок: ${vip.PRICE_DAYS} дней`);
u.gold = 200;
fails(() => vip.buy(u, []), 'Не хватает', 'без денег купить нельзя');
ok(!vip.isVip(u), 'подписка не выдана');
u.gold = 1200;
const n1 = [];
vip.buy(u, n1);
ok(vip.isVip(u), 'после покупки подписка активна');
ok(u.gold === 700, `золото списано: осталось ${u.gold}`);
ok(vip.vipInfo(u).daysLeft === 7, `дней: ${vip.vipInfo(u).daysLeft}`);
ok(/VIP оформлен на 7 дн/.test(n1[0]), `сообщение: «${n1[0].slice(0, 40)}…»`);
vip.buy(u, []);
ok(vip.vipInfo(u).daysLeft === 14, 'продление прибавляет дни, а не сбрасывает');
ok(u.gold === 200, 'за продление списано ещё раз');
ok(/app\.add\('POST', '\/api\/vip\/buy'/.test(routes), 'роут покупки зарегистрирован');
ok(/priceGold: vip\.PRICE_GOLD/.test(routes), 'цена приходит в игру с сервера');

console.log('\n── 2. Кнопка покупки ──');
ok(/id="vip-buy"/.test(core), 'кнопка есть на странице подписки');
ok(/Купить VIP/.test(core), 'подпись «Купить VIP»');
ok(/Продлить подписку/.test(core), 'у подписчика — «Продлить»');
ok(/api\/vip\/buy/.test(core), 'кнопка обращается к серверу');
ok(/UI\.confirm\([\s\S]{0,200}Оформить VIP-подписку/.test(core), 'перед списанием спрашивается подтверждение');
ok(/pf2-vip-btn vip-buy/.test(core), 'кнопка в профиле тоже оформлена');
ok(!/pf2-vip-btn" id="pf-vip" disabled/.test(core), 'кнопка больше не отключена');
ok(/\.vip-buy \{[\s\S]{0,240}linear-gradient\(150deg, #f3d27a/.test(css), 'на тёмных темах кнопка золотая');
ok(/body\.theme-light \.btn\.vip-buy[\s\S]{0,240}color: #f3d27a/.test(css), 'на светлых — тёмная с золотым текстом');
for (const t of ['light', 'paper', 'sand']) {
  ok(css.includes(`body.theme-${t} .btn.vip-buy`), `светлая тема «${t}» учтена`);
}

console.log('\n── 3. Оформление преимуществ ──');
ok(/const hl = \(t\) =>/.test(core), 'цифры подсвечиваются');
ok(/vip-num/.test(core), 'у них свой класс');
ok(/\.vip-num \{ color: var\(--gold\)/.test(css), 'цифры золотого цвета');
ok(/\.vip-price b \{ color: var\(--gold\)/.test(css), 'цена тоже золотом');
ok(/vip-item-text/.test(core), 'текст описания оформлен отдельно');

console.log('\n── 4. Понятные записи в журнале ──');
const cases = [
  ['/api/lots/buy', { itemName: 'Боевой стимулятор', qty: 2, gold: 24, discountPct: 20 }, 'Боевой стимулятор'],
  ['/api/lots/bid', { devName: 'Монолит', gold: 150 }, 'Ставка на лот'],
  ['/api/vip/buy', { days: 7, gold: 500 }, 'Купил VIP'],
  ['/system/lot-win', { devName: 'Атлант', gold: 300 }, 'Выиграл лот'],
  ['/system/lot-refund', { devName: 'Уран', gold: 150 }, 'Возврат ставки'],
  ['/api/admin/vip/grant', { targetName: 'Боец', days: 30 }, 'Выдал VIP'],
];
for (const [p, body, expect] of cases) {
  const text = tr.describe(p, body);
  ok(!!text && text.includes(expect), `«${p}» → «${(text || 'нет перевода').slice(0, 52)}»`);
}
ok(!/\/api\/lots\/buy/.test(tr.describe('/api/lots/buy', { itemName: 'X', gold: 1 })),
   'сырой адрес запроса в описании не появляется');

console.log('\n── 5. Журнал золота: выбор игрока ──');
const gl = routes.slice(routes.indexOf("'/api/admin/gold-log'"), routes.indexOf('ЖУРНАЛ ДЕЙСТВИЙ СОТРУДНИКОВ'));
ok(/const players = live/.test(gl), 'сервер отдаёт список игроков');
ok(/if \(!who\) \{/.test(gl), 'без выбранного игрока — только список и сводка');
ok(/report\.gold\.bySource/.test(gl), 'по игроку видно, откуда пришло золото');
ok(/translate\.describe\(l\.path, l\.body, l\.result\)/.test(gl),
   'записи переводятся на человеческий язык');
ok(/\.filter\(\(r\) => r\.gold > 0\)/.test(gl), 'показываются только операции с золотом');
ok(/isOwner\(req\.user\)/.test(gl), 'раздел остаётся только для владельца');
ok(/data-gp=/.test(adminJs), 'в панели игрок открывается нажатием');
ok(/id="gold-back"/.test(adminJs), 'есть возврат к списку');
ok(/<th class="num">На счету<\/th>/.test(adminJs), 'у каждого видно получено, потрачено и остаток');
ok(/sel\.groups/.test(adminJs), 'разбивка по источникам показана группами');
ok(!/r\.sourceLabel/.test(adminJs), 'прежние технические ярлыки убраны');
ok(css.includes('.gold-player'), 'стили списка добавлены');
ok(css.includes('.gold-op'), 'стили истории добавлены');

console.log('\n── 6. Журнал золота: таблица с расшифровкой ──');
const stats = require(ROOT + '/dist/src/services/stats');
const u2 = u;
player.addGold(u2, 3300, 'purchase');
player.addGold(u2, 500, 'event:Армада Кобальт');
player.addGold(u2, 300, 'event:Армада Кобальт (топ урона)');
player.addGold(u2, 800, 'season:Итоги недели — 1 место');
player.addGold(u2, 1000, 'admin:Компенсация за баг');
player.addGold(u2, -240, 'market');
player.addGold(u2, -24, 'lot_buff:Боевой стимулятор');
const rep = stats.report(u2);

const bySrc = (id) => rep.gold.bySource.find((x) => x.id === id);
ok(bySrc('purchase') && bySrc('purchase').value >= 3300, 'покупки за деньги учтены отдельно');
ok(bySrc('event') && bySrc('event').value === 800, `события: ${bySrc('event').value}`);
ok(bySrc('event').details.some((x) => x.label === 'Армада Кобальт'),
   'видно, за КАКОЕ событие получено золото');
ok(bySrc('event').details.length === 2, 'разные начисления одного события показаны раздельно');
ok(bySrc('season') && bySrc('season').details.some((x) => /1 место/.test(x.label)),
   'по сезону видно место, за которое дали награду');
ok(bySrc('admin') && bySrc('admin').details.some((x) => /Компенсация/.test(x.label)),
   'у выдачи администрацией видна причина');

const bySpend = (id) => rep.gold.bySpending.find((x) => x.id === id);
ok(bySpend('market') && bySpend('market').label === 'Чёрный рынок', 'траты на рынке подписаны по-русски');
ok(bySpend('lot_buff') && bySpend('lot_buff').details.some((x) => x.label === 'Боевой стимулятор'),
   'по лотам видно, что именно куплено');
ok(rep.gold.bySpending.every((x) => x.label !== x.id), 'ни одна трата не показана техническим кодом');

// Группировка поступлений на сервере
const gl2 = routes.slice(routes.indexOf("'/api/admin/gold-log'"), routes.indexOf('ЖУРНАЛ ДЕЙСТВИЙ СОТРУДНИКОВ'));
ok(/Куплено за деньги/.test(gl2), 'группа «Куплено за деньги»');
ok(/Выиграно в игре/.test(gl2), 'группа «Выиграно в игре»');
ok(/Начислено администрацией/.test(gl2), 'группа «Начислено администрацией»');
ok(/spending: report\.gold\.bySpending/.test(gl2), 'траты отдаются отдельным разделом');

// Таблицы в панели
ok(/<table class="gold-table">/.test(adminJs), 'данные выводятся таблицей');
ok(/<th>Игрок<\/th>/.test(adminJs), 'в списке игроков есть заголовки столбцов');
ok(/<th class="num">Получено<\/th>/.test(adminJs) && /<th class="num">Потрачено<\/th>/.test(adminJs),
   'столбцы «Получено» и «Потрачено»');
ok(/📥 Получено/.test(adminJs) && /📤 Потрачено/.test(adminJs), 'разделы разнесены');
ok(/gold-detail/.test(adminJs), 'подробности выводятся вложенными строками');
ok(/Что произошло/.test(adminJs), 'в истории понятный заголовок вместо адреса');
ok(css.includes('.gold-table'), 'стили таблицы добавлены');
ok(/\.table-wrap \{ overflow-x: auto/.test(css), 'на узком экране таблица прокручивается');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
