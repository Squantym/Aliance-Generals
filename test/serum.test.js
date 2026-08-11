// ═══════════════════════════════════════════════════════════════════
// «Сыворотка омоложения»: полная остановка набора опыта на 24 часа.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-serum-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const market = require(ROOT + '/dist/src/services/market');
const daily = require(ROOT + '/dist/src/services/dailyQuests');
const config = require(ROOT + '/dist/config/gameConfig');

async function main() {
await auth.register('Испытатель', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
const user = Object.values(player.users())[0];
user.level = 50; user.gold = 500;

console.log('\n── 1. Товар на чёрном рынке ──');
const item = config.MARKET_ITEM_BY_ID['serum'];
ok(!!item, 'предмет есть в каталоге');
ok(item.name === 'Сыворотка омоложения', `название: ${item.name}`);
ok(item.gold === 100, `цена: ${item.gold} золота`);
ok(item.durMin === 1440, `длительность: ${item.durMin / 60} часа`);
ok(item.kind === 'buff' && item.effect.type === 'xp_block', 'тип эффекта — блокировка опыта');
ok(fs.existsSync(path.join(ROOT, 'public/img/market/serum.webp')), 'картинка предмета на месте');
const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
ok(/'landmine','serum'/.test(app), 'картинка подключена к витрине рынка');

console.log('\n── 2. Покупка ──');
const goldBefore = user.gold;
const xpBefore = user.xp, lvlBefore = user.level;
market.buyItem(user, 'serum', '', []);
ok(user.gold === goldBefore - 100, `списано ${goldBefore - user.gold} золота`);
ok(player.isXpBlocked(user) === true, 'блокировка опыта активна');
const left = player.xpBlockLeftMin(user);
ok(left > 1430 && left <= 1440, `осталось ${left} мин (около суток)`);

console.log('\n── 3. Опыт не начисляется НИОТКУДА ──');
// Единая точка начисления перекрывает все источники сразу
const got1 = player.addXp(user, 5000, []);
ok(got1 === 0 && user.xp === xpBefore, 'прямое начисление опыта не проходит');

// Бой
const notices = [];
player.addXp(user, 300, notices);
ok(user.xp === xpBefore, 'опыт за бой не начисляется');

// Задание
daily.ensureDaily(user);
const ids = config.pickDailyQuests(user.daily.day);
const q = config.DAILY_QUEST_BY_ID[ids[0]];
daily.accept(user, q.id, []);
daily.bump(user, q.counter, config.dailyQuestTarget(q.base, q.diff, user.level, q.counter, q.fixedTarget));
const reward = daily.claim(user, q.id, []);
ok(reward.xp > 0, `награда за задание содержит ${reward.xp} XP...`);
ok(user.xp === xpBefore, '...но опыт игроку не начислен');
ok(user.level === lvlBefore, 'уровень не изменился — ради этого предмет и покупают');

console.log('\n── 4. Деньги и прочее приходят как обычно ──');
const moneyBefore = user.dollars;
player.addMoney(user, 100000, true);
ok(user.dollars > moneyBefore, 'деньги начисляются — блокируется ТОЛЬКО опыт');
const goldNow = user.gold;
player.addGold(user, 50);
ok(user.gold === goldNow + 50, 'золото тоже приходит');

console.log('\n── 5. После окончания действия ──');
for (const e of user.effects) if (e.type === 'xp_block') e.expiresAt = Date.now() - 1000;
ok(player.isXpBlocked(user) === false, 'по истечении суток блокировка снимается');
ok(player.xpBlockLeftMin(user) === 0, 'остаток времени обнуляется');
const got2 = player.addXp(user, 1000, []);
ok(got2 > 0 && user.xp > xpBefore, `опыт снова начисляется (+${got2})`);
// Накопленное за время действия НЕ возвращается
ok(user.xp < xpBefore + 6300, 'опыт, сгоревший под сывороткой, не возвращается задним числом');

console.log('\n── 6. Отображение эффекта ──');
market.buyItem(user, 'serum', '', []);
const view = player.effectsView(user);
const eff = view.find((e) => e.id === 'serum');
ok(!!eff, 'эффект виден в списке активных');
ok(/опыт не начисляется/.test(eff.desc), `подпись: «${eff.desc}»`);
ok(!/\+100%/.test(eff.desc), 'не показывается как «+100%» — это читалось бы как бонус к опыту');

console.log('\n── 7. Продление покупкой ──');
const leftBefore = player.xpBlockLeftMin(user);
market.buyItem(user, 'serum', '', []);
const leftAfter = player.xpBlockLeftMin(user);
ok(leftAfter > leftBefore, `повторная покупка продлевает действие (${leftBefore} → ${leftAfter} мин)`);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
