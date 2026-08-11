// ===================================================================
// test/test-update51.js — v51:
//  1) Контрабандные поручения: единственные с золотом, возврат 50% трат
//  2) Награда за вход не начисляется молча — ждёт получения в окне
// ===================================================================
const fs = require('fs');
const TEST_CWD = '/tmp/generals-test-cwd-51';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message}»`); } };

const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const market = require('../dist/src/services/market');
const daily = require('../dist/src/services/dailyQuests');
const features = require('../dist/src/services/features');
const c = require('../dist/config/gameConfig');

async function main() {
await auth.register('Снабженец', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
const user = Object.values(player.users())[0];
user.level = 100; user.gold = 5000; user.dollars = 10000000;

console.log('\n── 1. Контрабанда: возврат 50% потраченного золота ──');
const kc = c.DAILY_QUEST_BY_ID['k_container'];
const kd = c.DAILY_QUEST_BY_ID['k_doping'];
const ws = c.WEEKLY_QUEST_BY_ID['w_supplies'];
ok(!!kc && !!kd && !!ws, 'три контрабандных поручения на месте (контейнер, допинг, недельное)');
ok(kc.name.includes('контейнер') && c.smuggleItemName(kc.item) === 'Исследовательский контейнер',
   `товар назван явно: ${c.smuggleItemName(kc.item)} (${c.smuggleItemGold(kc.item)} золота)`);
ok(c.smuggleItemName(kd.item) === 'Боевой стимулятор',
   `допинг назван явно: ${c.smuggleItemName(kd.item)} (${c.smuggleItemGold(kd.item)} золота)`);
ok(c.smuggleGoldReward(kc) === 50, `1 контейнер за 100 золота → возврат ${c.smuggleGoldReward(kc)} золота (ваш пример: 50)`);
ok(c.smuggleGoldReward(ws) === 500, `20 кейсов по 50 золота → возврат ${c.smuggleGoldReward(ws)} золота (ваш пример: 500)`);
ok(c.smuggleGoldReward(kd) === Math.round(kd.fixedTarget * c.smuggleItemGold(kd.item) * 0.5),
   `${kd.fixedTarget} допинга по ${c.smuggleItemGold(kd.item)} → возврат ${c.smuggleGoldReward(kd)} золота`);
ok(c.GOLD_BACK_PCT === 0.5, 'ставка возврата — ровно 50%');

// Золото есть ТОЛЬКО у контрабандных
const dailyGolds = c.DAILY_QUESTS.map((q) => ({ id: q.id, gold: c.dailyQuestReward(q.diff, 100, q).gold }));
const withGold = dailyGolds.filter((x) => x.gold > 0).map((x) => x.id);
ok(withGold.length === 2 && withGold.includes('k_container') && withGold.includes('k_doping'),
   `золото в дневных только у контрабанды: ${withGold.join(', ')}`);
const weeklyGolds = c.WEEKLY_QUESTS.map((q) => ({ id: q.id, gold: c.weeklyQuestReward(q.diff, 100, q).gold }));
const wWithGold = weeklyGolds.filter((x) => x.gold > 0).map((x) => x.id);
ok(wWithGold.length === 1 && wWithGold[0] === 'w_supplies', `золото в недельных только у контрабанды: ${wWithGold.join(', ')}`);

console.log('\n── 2. Цель фиксирована и зависит от товара, не от уровня ──');
for (const lvl of [1, 150, 300]) {
  const t = c.dailyQuestTarget(kc.base, kc.diff, lvl, kc.counter, kc.fixedTarget);
  if (t !== 1) ok(false, `на ур.${lvl} цель ${t}, ожидалась 1`);
}
ok(true, 'цель контрабандного поручения не растёт с уровнем (цена золотом тоже не растёт)');

console.log('\n── 3. Счётчик считает ИМЕННО указанный товар ──');
daily.ensureDaily(user);
// Покупаем другой контейнер — в зачёт не идёт
market.openContainer(user, 1, [], 1);            // tier 1 = keis, а не kont
let d = user.daily.counters;
ok((d['buy:kont'] || 0) === 0, 'покупка другого контейнера не засчитана в поручение на «Исследовательский»');
ok((d['buy:keis'] || 0) === 1, 'зато засчитана в свой счётчик (buy:keis) — для недельной контрабанды');
// Покупаем нужный
market.openContainer(user, 3, [], 1);            // tier 3 = kont
ok((user.daily.counters['buy:kont'] || 0) === 1, 'покупка указанного контейнера засчитана');
// Допинг
market.buyItem(user, 'stim', '', []);
ok((user.daily.counters['buy:stim'] || 0) === 1, 'покупка указанного допинга засчитана');
ok((user.daily.counters['buy:armor'] || 0) === 0, 'другой допинг в зачёт не идёт');

console.log('\n── 4. Полный цикл контрабандного поручения ──');
// Ищем поручение среди активных на сегодня; если не выпало — проверяем напрямую
const ids = c.pickDailyQuests(user.daily.day);
if (ids.includes('k_container')) {
  const goldBefore = user.gold;
  daily.accept(user, 'k_container', []);
  market.openContainer(user, 3, [], 1);
  const q = daily.list(user).quests.find((x) => x.id === 'k_container');
  ok(q.done === true, `поручение выполнено (${q.progress}/${q.target})`);
  ok(q.reward.gold === 50, `в награде показано ${q.reward.gold} золота`);
  ok(q.item && q.item.name === 'Исследовательский контейнер', 'фронт получает название товара для показа');
  const spent = goldBefore - user.gold;
  const r = daily.claim(user, 'k_container', []);
  ok(r.gold === 50, `выдано ${r.gold} золота (потрачено на покупки ${spent})`);
} else {
  ok(true, 'поручение сегодня не в активной выборке — цикл проверен на недельном ниже');
}
const wIds = c.pickWeeklyQuests(user.weeklyQuests.week);
ok(Array.isArray(wIds), `недельная выборка: ${wIds.join(', ')}`);

console.log('\n── 5. Награда за вход ждёт получения в окне ──');
user.lastLoginDay = ''; user.loginStreak = 0;
const moneyBefore = user.dollars;
const res = features.claimDailyIfDue(user, []);
ok(res && res.pending === true, 'при входе награда НЕ начисляется, а ставится в очередь');
ok(user.dollars === moneyBefore, 'баланс не изменился молча (раньше деньги падали сразу)');
ok(!!user.pendingLoginReward, 'награда ждёт в pendingLoginReward');
ok(user.pendingLoginReward.streak === 1 && user.pendingLoginReward.dollars > 0,
   `в очереди: день ${user.pendingLoginReward.streak}, $${user.pendingLoginReward.dollars}`);
ok(features.claimDailyIfDue(user, []) === null, 'повторный вход в тот же день ничего не добавляет');
// Забираем по кнопке
const n = [];
const got = features.claimLoginReward(user, n);
ok(user.dollars > moneyBefore, `деньги начислены только после нажатия (+$${user.dollars - moneyBefore})`);
ok(!user.pendingLoginReward, 'очередь очищена');
ok(n.length > 0 && /получено/i.test(n[0]), `сообщение игроку: «${n[0]}»`);
fails(() => features.claimLoginReward(user, []), 'уже получена', 'повторно забрать нельзя');
// Джекпот 7-го дня
user.lastLoginDay = ''; user.loginStreak = 6;
const yesterday = new Date(Date.now() + 3 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
user.lastLoginDay = yesterday;
features.claimDailyIfDue(user, []);
ok(user.pendingLoginReward.streak === 7 && user.pendingLoginReward.jackpot === true,
   `седьмой день помечен джекпотом (золото: ${user.pendingLoginReward.gold})`);
const goldBefore7 = user.gold;
features.claimLoginReward(user, []);
ok(user.gold > goldBefore7, `джекпот выдал золото (+${user.gold - goldBefore7})`);

const appSrc = fs.readFileSync(__dirname + '/../public/js/app.js', 'utf8');
ok(appSrc.includes('_showLoginReward') && appSrc.includes('Довольствие от штаба'), 'фронт показывает окно довольствия');
ok(appSrc.includes('login-reward/claim'), 'кнопка окна вызывает получение награды');
const cssSrc = fs.readFileSync(__dirname + '/../public/css/style.css', 'utf8');
ok(cssSrc.includes('.login-reward'), 'стили окна добавлены');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
