// ═══════════════════════════════════════════════════════════════════
// Три правки: журнал начислений золота (владельцу), починка контрактов,
// щадящие требования к трудным действиям, счётчик онлайна.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-fix3-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
const daily = require(ROOT + '/dist/src/services/dailyQuests');
const features = require(ROOT + '/dist/src/services/features');
const config = require(ROOT + '/dist/config/gameConfig');

async function main() {
await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1');
await auth.register('Боец', 'пароль123', 'p@t.ru', 'ru', '2.2.2.2');
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const own = by('Хозяин'), pl = by('Боец');
own.role = 'owner'; own.isAdmin = true;

console.log('\n── 1. Контракты снова считают прогресс ──');
// bump писал только в дневные счётчики, а контракты читают накопительные
const before = (pl.counters || {}).marketBought || 0;
daily.bump(pl, 'marketBought', 1);
ok((pl.counters.marketBought || 0) === before + 1,
   'покупка на чёрном рынке попадает в накопительный счётчик');
ok(pl.daily.counters.marketBought >= 1, 'и в дневной — оба хранилища заполняются');
for (const key of ['clubPlayed', 'saboteursBought', 'sanctionsCompleted', 'legionWins']) {
  const was = (pl.counters || {})[key] || 0;
  daily.bump(pl, key, 2);
  ok((pl.counters[key] || 0) === was + 2, `счётчик «${key}» тоже накапливается`);
}

console.log('\n── 2. Контракт выполняется ──');
pl.level = 20;
const marketDef = config.CONTRACTS_POOL.find((c) => c.id === 'c_market');
ok(!!marketDef, 'контракт на чёрный рынок есть в наборе');
// Прогоняем полный цикл на реальном контракте
features.contractsView(pl);
const ct = (pl.contracts || [])[0];
ok(!!ct, 'контракты выданы');
const view1 = features.contractsView(pl).contracts;
ok(view1.length > 0, `в списке ${view1.length} контракта`);
const c0 = view1[0];
const def0 = config.CONTRACTS_POOL.find((x) => c0.id.startsWith(x.id));
// В игре боевые счётчики растут через achievements.bump рядом с daily.bump —
// повторяем оба вызова, как это делает боевой код
const ach = require(ROOT + '/dist/src/services/achievements');
daily.bump(pl, def0.counter, c0.target);
const COUNTED_ELSEWHERE = ['attacks','wins','fatalities','earsCut','buildingsBuilt','unitsBought','missionStages'];
if (COUNTED_ELSEWHERE.includes(def0.counter)) ach.bump(pl, def0.counter, c0.target, []);
const view2 = features.contractsView(pl).contracts.find((x) => x.id === c0.id);
ok(view2.current > 0, `прогресс пошёл: ${view2.current}/${view2.target}`);
ok(view2.done === true, 'контракт выполнен — раньше прогресс оставался нулевым');

console.log('\n── 2б. Нет двойного счёта ──');
// Боевые счётчики увеличиваются через achievements.bump, поэтому
// daily.bump не должен добавлять их второй раз
const achMod = require(ROOT + '/dist/src/services/achievements');
for (const key of ['attacks', 'wins', 'fatalities', 'unitsBought', 'missionStages']) {
  const was = (pl.counters || {})[key] || 0;
  daily.bump(pl, key, 1);
  ok((pl.counters[key] || 0) === was, `«${key}»: daily.bump не трогает накопительный — учёт в другом месте`);
  achMod.bump(pl, key, 1, []);
  ok((pl.counters[key] || 0) === was + 1, `«${key}»: растёт ровно на единицу за действие`);
}

console.log('\n── 3. Щадящие требования к трудным действиям ──');
ok(config.HARD_COUNTERS.includes('fatalities') && config.HARD_COUNTERS.includes('earsCut'),
   'фаталити и уши считаются трудными действиями');
// Базовое правило: уровень/10, сложность добавляет 1-2 действия
for (const [lvl, expect] of [[10, 1], [20, 2], [30, 3], [50, 5], [100, 10]]) {
  const t = config.dailyQuestTarget(8, 1.0, lvl, 'fatalities');
  ok(t === expect, `простое поручение на ур. ${lvl}: ${t} фаталити (правило: ${expect})`);
}
const midFat = config.dailyQuestTarget(8, 1.6, 100, 'fatalities');
ok(midFat === 11, `поручение средней сложности на 100 ур.: ${midFat} (+1 к базовому)`);
const hardFat = config.dailyQuestTarget(50, 2.4, 300, 'fatalities');
ok(hardFat <= 35, `сложное на 300 уровне: ${hardFat} — раньше было 384`);
const earQuest = config.DAILY_QUESTS.find((q) => q.counter === 'earsCut');
ok(config.dailyQuestTarget(earQuest.base, earQuest.diff, 10, 'earsCut') <= 3,
   'уши на 10 уровне — не больше трёх');
// Обычные счётчики не тронуты
ok(config.dailyQuestTarget(60, 1.0, 300, 'attacks') > 100,
   'требования к обычным действиям (атаки) остались прежними');
// Контракты
const fatContract = config.CONTRACTS_POOL.find((c) => c.id === 'c_fatal');
ok(config.contractTarget(fatContract.targets[0], 10, 'fatalities') === 1,
   'контракт «Палач» на 10 уровне — одно фаталити');
ok(config.contractTarget(fatContract.targets[0], 100, 'fatalities') === 10,
   'на 100 уровне — десять');
ok(config.contractTarget(8, 100, 'unitsBought') > 8, 'обычные контракты считаются по-старому');

console.log('\n── 4. Журнал начислений золота ──');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
ok(/\/api\/admin\/gold-log/.test(routes), 'есть роут журнала золота');
const gl = routes.slice(routes.indexOf("'/api/admin/gold-log'"), routes.indexOf('ЖУРНАЛ ДЕЙСТВИЙ СОТРУДНИКОВ'));
ok(/isOwner\(req\.user\)\) throw new u\.ApiError\('Только для владельца'\)/.test(gl),
   'доступен только владельцу — администраторам нет');
// Источники теперь берутся из накопленной статистики, а не угадываются
// по адресам запросов — цифры совпадают с тем, что видит игрок
ok(/report\.gold\.bySource/.test(gl), 'разбивка по источникам берётся из статистики');
const statsSrc = fs.readFileSync(ROOT + '/dist/src/services/stats.js', 'utf8');
for (const src of ['quest', 'season', 'purchase', 'admin']) {
  ok(statsSrc.includes(src), `источник «${src}» учитывается статистикой`);
}
ok(/req\.query\.userId/.test(gl), 'выбирается конкретный игрок');
ok(/const players = live/.test(gl), 'отдаётся список игроков для выбора');
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');
ok(/id:'gold'/.test(adminJs), 'вкладка «Золото» есть в панели');
ok(/ownerOnly:true/.test(adminJs), 'помечена как владельческая');
ok(/t\.ownerOnly\|\|\(Admin\.me&&Admin\.me\.staffRole==='owner'\)/.test(adminJs),
   'администратору вкладка не показывается');

console.log('\n── 5. Счётчик онлайна ──');
ok(/\/api\/online/.test(routes), 'есть роут счётчика');
const onl = routes.slice(routes.indexOf("'/api/online'"), routes.indexOf("'/api/chat'"));
ok(/5 \* 60 \* 1000/.test(onl), 'онлайн считается по активности за 5 минут');
ok(/!p\.isBot/.test(onl), 'боты не учитываются — цифра настоящая');
ok(/\{ open: true \}/.test(routes.slice(routes.indexOf("'/api/online'"), routes.indexOf("'/api/online'") + 900)),
   'доступен без входа — виден и на странице входа');
const idx = fs.readFileSync(ROOT + '/public/index.html', 'utf8');
ok(/id="online-counter"/.test(idx), 'счётчик добавлен в подвал страницы');
const app = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
ok(/startOnlineCounter/.test(app), 'счётчик обновляется из кода');
ok(/setInterval\(paint, 60000\)/.test(app), 'обновление раз в минуту — без лишней нагрузки');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(css.includes('.online-counter'), 'стили счётчика добавлены');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
