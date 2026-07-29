// ===================================================================
// test/test-update53.js — v53: КРИТИЧЕСКИЙ ФИКС
// Недельные поручения (v50) жили в user.weekly — поле недельного СЕЗОНА.
// Два модуля перетирали объект друг друга, из-за чего у активных игроков
// обнулялся счёт сезона. Теперь поручения живут в user.weeklyQuests.
// Этот тест — тот, которого не хватило в v50: сосуществование систем.
// ===================================================================
const fs = require('fs');
const TEST_CWD = '/tmp/generals-test-cwd-53';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const seasons = require('../dist/src/services/seasons');
const daily = require('../dist/src/services/dailyQuests');
const c = require('../dist/config/gameConfig');

async function main() {
await auth.register('Ветеран', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
const user = Object.values(player.users())[0];
user.level = 50;

console.log('\n── 1. Воспроизведение бага (как было до фикса) ──');
// Сезон начисляет очки
seasons.onFatalityEar(user);
seasons.onFatalityEar(user);
seasons.onWin && seasons.onWin(user);
const earsAfterSeason = user.weekly && user.weekly.ears;
ok(earsAfterSeason === 2, `сезон ведёт счёт в user.weekly (ears=${earsAfterSeason})`);
ok(!!user.weekly.weekId, `у сезонного объекта есть weekId=${user.weekly.weekId}`);

// Игрок совершает действие -> bump -> ensureWeekly (до фикса это ТЁРЛО сезон)
daily.bump(user, 'attacks', 1);
ok(user.weekly && user.weekly.ears === 2,
   'ФИКС: действие игрока больше НЕ стирает сезонные очки (ears по-прежнему 2)');
ok(user.weekly.weekId && !user.weekly.week,
   'user.weekly остался чисто сезонным объектом');
ok(user.weeklyQuests && user.weeklyQuests.week && user.weeklyQuests.counters.attacks === 1,
   'недельные поручения ведут счёт в СВОЁМ поле weeklyQuests');

// И обратно: сезонный хук не трогает прогресс поручений
daily.bump(user, 'wins', 3);
const questCountersBefore = JSON.stringify(user.weeklyQuests.counters);
seasons.onFatalityEar(user);
ok(JSON.stringify(user.weeklyQuests.counters) === questCountersBefore,
   'сезонный хук не стирает прогресс недельных поручений');
ok(user.weekly.ears === 3, `сезонные уши растут дальше (ears=${user.weekly.ears})`);

console.log('\n── 2. Миграция пострадавших данных ──');
// Имитация игрока с прода: в user.weekly застрял формат поручений v50-v52
const victim = { ...user, id: 'x2', name: 'Пострадавший' };
victim.weekly = { week: c.weekUtcKey(), counters: { attacks: 40 }, accepted: { w_meatgrinder: { at: 1, base: 0 } }, claimed: {}, bonusClaimed: false };
victim.weeklyQuests = null;
daily.ensureWeekly(victim);
ok(victim.weeklyQuests && victim.weeklyQuests.counters.attacks === 40,
   'прогресс поручений из захваченного поля перенесён в weeklyQuests (attacks=40)');
ok(victim.weeklyQuests.accepted.w_meatgrinder, 'принятые поручения пережили миграцию');
ok(!victim.weekly || !victim.weekly.week,
   'поле weekly освобождено для сезона');
seasons.onFatalityEar(victim);
ok(victim.weekly && victim.weekly.weekId && victim.weekly.ears === 1,
   'сезон пересоздал свой объект и снова считает очки');

console.log('\n── 3. Недельные поручения работают в новом поле ──');
const wl = daily.weeklyList(user);
ok(wl.quests.length === c.WEEKLY_PICK_COUNT, `выборка недельных поручений на месте (${wl.quests.length})`);
const wq = wl.quests[0];
daily.weeklyAccept(user, wq.id, []);
const quest = c.WEEKLY_QUEST_BY_ID[wq.id];
daily.bump(user, quest.counter, wq.target);
const done = daily.weeklyList(user).quests.find((q) => q.id === wq.id);
ok(done.done === true, `цикл поручения работает (${done.progress}/${done.target})`);
ok(user.weekly.weekId && !user.weekly.counters, 'и всё это время сезонный объект нетронут');

console.log('\n── 4. Страховка от повторения: поле сезона не задевается нигде ──');
const src = fs.readFileSync(__dirname + '/../src/services/dailyQuests.ts', 'utf8');
const badWrites = (src.match(/\(user as any\)\.weekly\s*=/g) || []).filter((x) => !src.includes('weekly = null'));
ok(src.includes('weeklyQuests'), 'dailyQuests работает только с weeklyQuests');
ok((src.match(/\.weekly\s*=\s*\{/g) || []).length === 0, 'нет ни одной записи объекта в user.weekly из dailyQuests');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
