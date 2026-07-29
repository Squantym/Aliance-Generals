// ===================================================================
// test/test-update50.js — v50: задачи 4 и 5
//  4) спецоперации 5..30, недельные поручения, портреты заказчиков
//  5) чат: признак союзника по личному альянсу и ответ игроку
// ===================================================================
const fs = require('fs');
const TEST_CWD = '/tmp/generals-test-cwd-50';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message}»`); } };

const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const social = require('../dist/src/services/social');
const daily = require('../dist/src/services/dailyQuests');
const c = require('../dist/config/gameConfig');

async function main() {
await auth.register('Боец', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
await auth.register('Союзник', 'пароль123', 'b@t.ru', 'ru', '2.2.2.2');
await auth.register('Посторонний', 'пароль123', 'd@t.ru', 'ru', '3.3.3.3');
const users = player.users();
const by = (n) => users[Object.keys(users).find((id) => users[id].name === n)];
const hero = by('Боец'), ally = by('Союзник'), other = by('Посторонний');

console.log('\n── Задача 4: спецоперации сокращены до 5..30 ──');
const stageTargets = [];
for (const lvl of [1, 10, 50, 121, 300]) {
  const easy = c.dailyQuestTarget(20, 1.0, lvl, 'missionStages');
  const hard = c.dailyQuestTarget(50, 2.4, lvl, 'missionStages');
  stageTargets.push(easy, hard);
  console.log(`  (ур.${lvl}: простое ${easy}, сложное ${hard} шагов)`);
}
ok(Math.min(...stageTargets) >= c.MISSION_STAGES_MIN, `минимум ${Math.min(...stageTargets)} — не ниже ${c.MISSION_STAGES_MIN}`);
ok(Math.max(...stageTargets) <= c.MISSION_STAGES_MAX, `максимум ${Math.max(...stageTargets)} — не выше ${c.MISSION_STAGES_MAX}`);
ok(c.dailyQuestTarget(20, 1.0, 300, 'missionStages') > c.dailyQuestTarget(20, 1.0, 1, 'missionStages'), 'цель растёт с уровнем');
// Прочие счётчики не задеты
ok(c.dailyQuestTarget(60, 1.0, 300, 'attacks') > 100, 'обычные задания (атаки) считаются по прежней формуле');

console.log('\n── Задача 4: недельные поручения ──');
ok(c.WEEKLY_QUESTS.length >= 8, `${c.WEEKLY_QUESTS.length} уникальных недельных поручений`);
const dailyIds = new Set(c.DAILY_QUESTS.map((q) => q.id));
ok(c.WEEKLY_QUESTS.every((q) => !dailyIds.has(q.id)), 'недельные поручения — отдельные, не дубли дневных');
ok(c.WEEKLY_QUESTS.every((q) => c.DAILY_CHARS[q.char]), 'у каждого недельного поручения есть существующий заказчик');
c.WEEKLY_QUESTS.forEach((q) => {
  const img = `${__dirname}/../public/img/instructors/${q.char}.webp`;
  if (!fs.existsSync(img)) ok(false, `нет портрета заказчика ${q.char}`);
});
ok(true, 'портреты всех заказчиков недельных поручений на месте');
// Портреты дневных заказчиков тоже проверим
const missingDaily = [...new Set(c.DAILY_QUESTS.map((q) => q.char))]
  .filter((ch) => !fs.existsSync(`${__dirname}/../public/img/instructors/${ch}.webp`));
ok(missingDaily.length === 0, `портреты всех дневных заказчиков на месте${missingDaily.length ? ': нет ' + missingDaily.join(', ') : ''}`);
const appSrc = fs.readFileSync(__dirname + '/../public/js/app.js', 'utf8');
ok(appSrc.includes('ic-instr-stub'), 'при отсутствии файла портрета показывается заглушка, а не битая картинка');

hero.level = 121;
const wl = daily.weeklyList(hero);
ok(wl.quests.length === c.WEEKLY_PICK_COUNT, `активно ${wl.quests.length} недельных поручений`);
ok(wl.quests.every((q) => q.accepted === false && q.progress === 0), 'недельные тоже начинаются с «не принято»');
ok(typeof wl.resetInDays === 'number' && wl.resetInDays >= 1, `сброс через ${wl.resetInDays} дн. (понедельник)`);
// Лимиты и награды выше дневных
const dw = c.dailyQuestReward(2.4, 121), ww = c.weeklyQuestReward(2.4, 121, c.WEEKLY_QUEST_BY_ID['w_offensive']);
console.log(`  (награда ур.121, сложное: день +${dw.xp} XP / $${dw.dollars} · неделя +${ww.xp} XP / $${ww.dollars} / ${ww.gold} золота)`);
ok(ww.dollars === dw.dollars * c.WEEKLY_REWARD_MULT, `недельные деньги = дневные × ${c.WEEKLY_REWARD_MULT}`);
// v51: золото дают ТОЛЬКО контрабандные поручения (возврат 50% трат),
// у остальных в награде лишь деньги и опыт
ok(ww.gold === 0, 'у обычного недельного поручения золота в награде нет');
const smug = c.WEEKLY_QUEST_BY_ID['w_supplies'];
ok(c.weeklyQuestReward(smug.diff, 121, smug).gold === 500, 'у недельной контрабанды — 500 золота (возврат половины трат)');
ok(c.weeklyQuestTarget(0, 2.4, 121, 'missionStages') === c.dailyQuestTarget(50, 2.4, 121, 'missionStages') * c.WEEKLY_STAGES_MULT,
   `недельные спецоперации = дневные × ${c.WEEKLY_STAGES_MULT} (${c.weeklyQuestTarget(0, 2.4, 121, 'missionStages')} шагов)`);

console.log('\n── Задача 4: недельный цикл принятия и награды ──');
const wq = wl.quests[0];
const quest = c.WEEKLY_QUEST_BY_ID[wq.id];
fails(() => daily.weeklyClaim(hero, wq.id, []), 'Сначала примите', 'без принятия награду не забрать');
daily.bump(hero, quest.counter, 7);                     // до принятия — не в зачёт
daily.weeklyAccept(hero, wq.id, []);
ok(daily.weeklyList(hero).quests.find((q) => q.id === wq.id).progress === 0, 'действия до принятия не зачлись');
daily.bump(hero, quest.counter, wq.target);
const wq2 = daily.weeklyList(hero).quests.find((q) => q.id === wq.id);
ok(wq2.done === true, `недельное выполнено (${wq2.progress}/${wq2.target})`);
const goldBefore = hero.gold, moneyBefore = hero.dollars;
const wReward = daily.weeklyClaim(hero, wq.id, []);
const isSmuggle = !!c.WEEKLY_QUEST_BY_ID[wq.id].item;
ok(hero.dollars > moneyBefore, `награда выдана по кнопке (+$${hero.dollars - moneyBefore})`);
ok(isSmuggle ? hero.gold > goldBefore : hero.gold === goldBefore,
   isSmuggle ? `контрабанда вернула золото (+${hero.gold - goldBefore})` : 'у обычного поручения золота нет — как и задумано');
fails(() => daily.weeklyClaim(hero, wq.id, []), 'уже получена', 'повторно забрать нельзя');
// Дневные и недельные счётчики независимы
const dailyCounters = hero.daily.counters[quest.counter] || 0;
ok(dailyCounters > 0 && hero.weekly.counters[quest.counter] > 0, 'счётчики ведутся отдельно для дня и недели');

console.log('\n── Задача 5: чат ──');
// Взаимный личный альянс: Боец ↔ Союзник
hero.allianceRoster = [{ id: ally.id, name: ally.name }];
ally.allianceRoster = [{ id: hero.id, name: hero.name }];
other.allianceRoster = [];
social.chatPost(ally, 'Прикрываю с левого фланга');
other.lastChatAt = 0;
social.chatPost(other, 'Кто на квадрате 12?');
hero.lastChatAt = 0;
social.chatPost(hero, 'Принял');
const view = social.chatGet(hero);
const mAlly = view.messages.find((m) => m.uid === ally.id);
const mOther = view.messages.find((m) => m.uid === other.id);
const mSelf = view.messages.find((m) => m.uid === hero.id);
ok(mAlly && mAlly.ally === true, 'сообщение союзника помечено ally — рядом с именем будет звёздочка');
ok(mOther && mOther.ally === false, 'сообщение постороннего не помечено');
ok(mSelf && mSelf.self === true, 'своё сообщение помечено self — кнопки «Ответить» у себя не будет');
// Не взаимный альянс не считается
other.allianceRoster = [{ id: hero.id, name: hero.name }];   // односторонне
const view2 = social.chatGet(hero);
ok(view2.messages.find((m) => m.uid === other.id).ally === false, 'односторонний альянс не даёт звёздочку (нужна взаимность)');
// Без смотрящего (гость) — без флагов, но и без падения
const guest = social.chatGet(null);
ok(Array.isArray(guest.messages) && guest.messages.length >= 3, 'чат отдаётся и без авторизации');
const socSrc = fs.readFileSync(__dirname + '/../public/js/screens/social.js', 'utf8');
ok(socSrc.includes('chat-ally-star'), 'фронт рисует звёздочку союзника');
ok(socSrc.includes('data-reply'), 'фронт рисует кнопку «Ответить»');
ok(socSrc.includes('setSelectionRange'), 'по «Ответить» имя подставляется в поле и курсор уходит в конец');
const cssSrc = fs.readFileSync(__dirname + '/../public/css/style.css', 'utf8');
ok(cssSrc.includes('.chat-reply') && cssSrc.includes('.chat-msg-ally'), 'стили чата добавлены');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
