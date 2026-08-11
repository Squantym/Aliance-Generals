// ═══════════════════════════════════════════════════════════════════
// Пять жалоб по VIP: кнопка «кто разведал», полная статистика,
// ускорение УЖЕ ЗАПУЩЕННЫХ улучшений трофеев, бесплатная смена
// позывного, пять лечений в госпитале без ожидания.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-vipfix-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 42)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const vip = require(ROOT + '/dist/src/services/vip');
const troph = require(ROOT + '/dist/src/services/trophies');
const hosp = require(ROOT + '/dist/src/services/hospital');
const stats = require(ROOT + '/dist/src/services/stats');
const feat = require(ROOT + '/dist/src/services/features');
const core = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
const app = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');

async function main() {
for (const [n, e] of [['ВИП','a'],['Шпион','b'],['Обычный','c']]) {
  await auth.register(n, 'пароль123', e + '@t.ru', 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const v = by('ВИП'), spy = by('Шпион'), plain = by('Обычный');
for (const x of [v, spy, plain]) { x.level = 100; x.dollars = 1e12; x.gold = 100000; }

console.log('\n── 1. Ускорение УЖЕ ЗАПУЩЕННЫХ улучшений ──');
const t0 = troph.list(v).trophies[0];
troph.startUpgrade(v, t0.id, []);
const before = Math.round((v.trophyQueue[0].finishesAt - Date.now()) / 60000);
ok(before > 0, `улучшение запущено без подписки: ${before} мин`);
vip.grant(null, v, 30, 'тест', []);
player.refresh(v);
const after = Math.round((v.trophyQueue[0].finishesAt - Date.now()) / 60000);
ok(after < before, `после покупки подписки: ${before} → ${after} мин`);
ok(Math.abs(after - before / 2) <= 1, 'сокращение ровно вдвое, как заявлено');
player.refresh(v); player.refresh(v);
const again = Math.round((v.trophyQueue[0].finishesAt - Date.now()) / 60000);
ok(again === after, 'повторные обращения не сокращают время снова');
const tsrc = fs.readFileSync(ROOT + '/src/services/trophies.ts', 'utf8');
ok(/if \(!proc\.vipCut\)/.test(tsrc), 'пересчёт защищён пометкой — иначе таймер таял бы при каждом запросе');

console.log('\n── 2. Госпиталь: пять лечений без ожидания ──');
let healed = 0;
for (let i = 0; i < 8; i++) { v.res.hp.cur = 10; try { hosp.heal(v, []); healed++; } catch (e) {} }
ok(healed === 6, `подряд вылечился ${healed} раз: одно обычное плюс пять по подписке`);
ok(vip.left(v, 'heal') === 0, 'суточный запас израсходован');
plain.res.hp.cur = 10;
hosp.heal(plain, []);
plain.res.hp.cur = 10;
fails(() => hosp.heal(plain, []), 'раз в 5 минут', 'без подписки ожидание действует как прежде');
const hsrc = fs.readFileSync(ROOT + '/src/services/hospital.ts', 'utf8');
ok(/vipSrv\.spend\(user, 'heal'\)/.test(hsrc), 'лечение списывает суточную попытку');

console.log('\n── 3. Кто разведал ──');
feat.spyOn(spy, v.id, []);
ok(v.spiedBy && v.spiedBy.list.length === 1, 'разведка записана цели');
ok(v.spiedBy.list[0].name === 'Шпион', `видно имя: ${v.spiedBy.list[0].name}`);
ok(/id="pf-spied"/.test(core), 'в профиле есть кнопка «Кто меня разведал»');
ok(/App\.showSpiedBy\(\)/.test(core), 'кнопка открывает список');
ok(/async showSpiedBy\(\)/.test(app), 'экран реализован');
ok(/api\/spied-by/.test(app), 'данные берутся с сервера');
ok(/Сегодня вас никто не разведывал/.test(app), 'пустой список объяснён понятно');
ok(css.includes('.spied-row'), 'стили списка добавлены');

console.log('\n── 4. Полная статистика ──');
const rep = stats.report(v);
for (const k of ['hoursInGame', 'daysInService', 'money', 'gold', 'units', 'saboteurs', 'battle']) {
  ok(rep[k] !== undefined, `раздел «${k}» есть в отчёте`);
}
ok(Array.isArray(rep.units.byTypeLost), 'потери техники разбиты по родам войск');
ok(Array.isArray(rep.saboteurs.byTypeBought), 'диверсанты разбиты по типам');
ok(/id="pf-stats"/.test(core), 'в профиле есть кнопка «Полная статистика»');
ok(/async showFullStats\(\)/.test(app), 'экран реализован');
ok(/api\/stats-full/.test(app), 'данные берутся с сервера');
for (const t of ['В строю', 'Деньги', 'Золото', 'Техника', 'Диверсанты', 'Бои']) {
  ok(app.includes(t), `в окне есть раздел «${t}»`);
}
ok(css.includes('.stats-table'), 'стили таблицы добавлены');
ok(/\.stats-full \{[\s\S]{0,120}overflow-y: auto/.test(css), 'длинная статистика прокручивается');

console.log('\n── 5. Смена позывного ──');
ok(/id="pf-rename"/.test(core), 'в профиле есть кнопка смены позывного');
ok(/async showRename\(\)/.test(app), 'окно смены реализовано');
ok(/api\/rename/.test(app), 'запрос уходит на сервер');
const oldName = v.name;
player.renameSelf(v, 'Новое Имя', []);
ok(v.name === 'Новое Имя', `позывной сменён: «${oldName}» → «${v.name}»`);
fails(() => player.renameSelf(v, 'Ещё Раз', []), 'раз в 30 дней', 'повторно — только через месяц');
fails(() => player.renameSelf(plain, 'Кто-то', []), 'VIP-подписке', 'без подписки недоступно');

console.log('\n── 6. Кнопки видны только подписчикам ──');
ok(/App\.me\.vip \? `[\s\S]{0,200}pf2-vip-tools/.test(core), 'блок инструментов показывается по подписке');
ok(css.includes('.pf2-vip-tools'), 'стили блока добавлены');

console.log('\n── 7. Госпиталь: кнопка не блокируется у подписчика ──');
// Настоящая причина жалобы: сервер лечение разрешал, но экран показывал
// ожидание и делал кнопку недоступной — до сервера дело не доходило
const v9 = by('Шпион');
vip.grant(null, v9, 30, 'проверка', []);
v9.level = 50; v9.dollars = 1e12;
let clicks = 0, blocked = 0;
for (let i = 0; i < 7; i++) {
  v9.res.hp.cur = 10;
  const view = hosp.view(v9);
  if (view.cooldownLeft > 0) { blocked++; continue; }
  try { hosp.heal(v9, []); clicks++; } catch (e) {}
}
ok(clicks === 6, `подряд доступно ${clicks} лечений: одно обычное и пять по подписке`);
ok(blocked === 1, 'кнопка блокируется только после исчерпания запаса');
const hsrc2 = fs.readFileSync(ROOT + '/src/services/hospital.ts', 'utf8');
ok(/vipHealsLeft > 0 \? 0 : rawCooldown/.test(hsrc2),
   'сервер обнуляет ожидание, пока есть суточные лечения');
ok(/vipHealsLeft,/.test(hsrc2), 'остаток лечений передаётся на экран');
ok(/cooldownRaw: rawCooldown/.test(hsrc2), 'настоящее ожидание тоже передаётся — для подписи');
const mkt = fs.readFileSync(ROOT + '/public/js/screens/market.js', 'utf8');
ok(/const vipSkip = \(data\.vipHealsLeft \|\| 0\) > 0 && \(data\.cooldownRaw \|\| 0\) > 0/.test(mkt),
   'экран понимает, что лечение идёт вне очереди');
ok(/Вылечиться вне очереди/.test(mkt), 'на кнопке это написано');
ok(/Лечений вне очереди/.test(mkt), 'показан остаток на сегодня');

// Обычный игрок: ограничение работает как прежде
const plain2 = by('Обычный');
plain2.level = 50; plain2.dollars = 1e12;
plain2.res.hp.cur = 10;
// Игрок мог лечиться раньше по ходу сценария — снимаем ожидание
plain2.lastHospitalHeal = 0;
hosp.heal(plain2, []);
plain2.res.hp.cur = 10;
ok(hosp.view(plain2).cooldownLeft > 0, 'без подписки ожидание остаётся');
ok(hosp.view(plain2).vipHealsLeft === 0, 'и лечений вне очереди у него нет');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
