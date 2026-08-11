// ===================================================================
// test/test-update49.js — v49:
//  задача 2: окно докупки техники в спецоперациях (данные сметы + html-диалог)
//  задача 3: принятие задания, прогресс только после принятия, награда по кнопке
// ===================================================================
const fs = require('fs');
const TEST_CWD = '/tmp/generals-test-cwd-49';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message}»`); } };

const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const missions = require('../dist/src/services/missions');
const daily = require('../dist/src/services/dailyQuests');
const config = require('../dist/config/gameConfig');

async function main() {
await auth.register('Боец', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
const user = Object.values(player.users())[0];
user.level = 60; user.dollars = 50000000;

console.log('\n── Задача 2: смета техники для шага спецоперации ──');
let step = null, sf = null;
for (const conf of config.CONFLICTS) {
  for (const op of conf.operations || []) {
    for (const st of op.steps || []) {
      if (st.require && st.require.units && st.require.units.byType && st.require.level <= 60) {
        const t = missions.unitShortfall(user, st);
        if (t) { step = st; sf = t; break; }
      }
    }
    if (sf) break;
  }
  if (sf) break;
}
ok(!!sf, 'смета по недостающей технике формируется');
ok(sf.items.length > 0, `в смете ${sf.items.length} позиций техники`);
ok(sf.items.every((it) => it.unitId && it.unitName), 'у каждой позиции есть id и название (для картинки и подписи)');
ok(sf.items.every((it) => it.unitPrice > 0 && it.cost === it.unitPrice * it.deficit),
   'цена за единицу и сумма позициисогласованы');
ok(sf.totalCost === sf.items.reduce((s, it) => s + it.cost, 0), `итоговая сумма = сумме позиций ($${sf.totalCost})`);
ok(sf.deficit === sf.items.reduce((s, it) => s + it.deficit, 0), `общее количество к покупке: ${sf.deficit} ед.`);
ok(typeof sf.canAfford === 'boolean' && typeof sf.minLevel === 'number', 'есть признак «хватает денег» и минимальный уровень техники');
sf.items.forEach((it) => {
  const img = `${__dirname}/../public/img/units/${it.unitId}.webp`;
  ok(fs.existsSync(img), `картинка техники «${it.unitName}» существует (${it.unitId}.webp)`);
});
// Диалог должен уметь показывать готовую разметку
const uiSrc = fs.readFileSync(__dirname + '/../public/js/ui.js', 'utf8');
ok(uiSrc.includes('opts.html ? message'), 'UI.confirm умеет показывать разметку (opts.html) — сырых HTML-тегов больше не будет');
const warSrc = fs.readFileSync(__dirname + '/../public/js/screens/war.js', 'utf8');
ok(warSrc.includes('html: true'), 'окно докупки техники вызывает диалог с html: true');
ok(warSrc.includes('buy-units-total') && warSrc.includes('buy-units-img'), 'в окне есть картинки техники и блок итоговой суммы');
const cssSrc = fs.readFileSync(__dirname + '/../public/css/style.css', 'utf8');
ok(cssSrc.includes('.buy-units-row') && cssSrc.includes('.buy-units-total'), 'стили окна добавлены');

console.log('\n── Задача 3: принятие задания и награда по кнопке ──');
const d = daily.ensureDaily(user);
const listBefore = daily.list(user);
const q0 = listBefore.quests[0];
ok(listBefore.quests.every((q) => q.accepted === false), 'все поручения изначально НЕ приняты');
ok(listBefore.quests.every((q) => q.progress === 0), 'у непринятых поручений прогресс нулевой');

const quest = config.DAILY_QUEST_BY_ID[q0.id];
// Действия ДО принятия не должны попадать в зачёт
daily.bump(user, quest.counter, 5);
let l = daily.list(user);
ok(l.quests[0].progress === 0, 'действия до принятия не идут в зачёт (прогресс всё ещё 0)');
fails(() => daily.claim(user, q0.id, []), 'Сначала примите', 'награду нельзя забрать без принятия');

// Принимаем
const n1 = [];
daily.accept(user, q0.id, n1);
l = daily.list(user);
ok(l.quests[0].accepted === true, 'поручение принято');
ok(l.quests[0].progress === 0, 'точка отсчёта зафиксирована: прогресс с нуля, прежние 5 действий не зачлись');
ok(n1.length > 0 && /принято/i.test(n1[0]), `игрок получил подтверждение: «${n1[0]}»`);
fails(() => daily.accept(user, q0.id, []), 'уже принято', 'повторное принятие отклоняется');

// Действия ПОСЛЕ принятия идут в зачёт
daily.bump(user, quest.counter, 3);
l = daily.list(user);
ok(l.quests[0].progress === 3, `после принятия прогресс растёт: ${l.quests[0].progress}`);
fails(() => daily.claim(user, q0.id, []), 'ещё не выполнено', 'награда недоступна, пока цель не достигнута');

// Догоняем цель
const target = l.quests[0].target;
daily.bump(user, quest.counter, target);
l = daily.list(user);
ok(l.quests[0].done === true, `цель достигнута (${l.quests[0].progress}/${target}) — появилась кнопка получения`);
const moneyBefore = user.dollars;
const n2 = [];
const reward = daily.claim(user, q0.id, n2);
ok(user.dollars > moneyBefore, `награда выдана только по кнопке (+$${user.dollars - moneyBefore})`);
ok(reward.xp > 0, `опыт начислен: +${reward.xp} XP`);
l = daily.list(user);
ok(l.quests[0].claimed === true, 'поручение отмечено как полученное');
fails(() => daily.claim(user, q0.id, []), 'уже получена', 'повторно забрать награду нельзя');

console.log('\n── Бонус за все поручения требует принятия ──');
fails(() => daily.claimBonus(user, []), 'Примите и выполните', 'бонус дня недоступен, пока не приняты и не выполнены все');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
