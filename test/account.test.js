// ═══════════════════════════════════════════════════════════════════
// Кабинет: до трёх персонажей на аккаунт, переключение без пароля и —
// главное — запрет взаимодействия между своими же персонажами.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-acc-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 48)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const acc = require(ROOT + '/dist/src/services/account');
const battle = require(ROOT + '/dist/src/services/battle');
const reinf = require(ROOT + '/dist/src/services/reinforcements');
const feat = require(ROOT + '/dist/src/services/features');
const access = require(ROOT + '/dist/src/services/access');

async function main() {
await auth.register('Первый', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1', 'UA');
await auth.register('Чужой', 'пароль123', 'b@t.ru', 'ru', '2.2.2.2', 'UA');
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const p1 = by('Первый'), other = by('Чужой');

console.log('\n── 1. Создание персонажей ──');
ok(acc.MAX_CHARACTERS === 3, `предел: ${acc.MAX_CHARACTERS} персонажа`);
ok(acc.charactersOf(p1).length === 1, 'сразу после регистрации персонаж один');
const c2 = acc.createCharacter(p1, 'Второй', 'ru', []);
const c3 = acc.createCharacter(p1, 'Третий', 'kz', []);
ok(acc.charactersOf(p1).length === 3, 'создано три персонажа');
fails(() => acc.createCharacter(p1, 'Четвёртый', 'ru', []), 'не больше 3', 'четвёртого создать нельзя');
fails(() => acc.createCharacter(p1, 'Чужой', 'ru', []), 'не больше 3', 'предел проверяется раньше имени');
// Занятое имя при свободном месте
const solo = other;
fails(() => acc.createCharacter(solo, 'Первый', 'ru', []), 'уже занят', 'занятое имя отклоняется');
fails(() => acc.createCharacter(solo, 'ab', 'ru', []), '3–16 символов', 'короткое имя отклоняется');

console.log('\n── 2. Общий аккаунт ──');
const p2 = U[c2.id], p3 = U[c3.id];
ok(acc.accountIdOf(p2) === acc.accountIdOf(p1), 'второй персонаж привязан к тому же аккаунту');
ok(acc.sameAccount(p1, p3) === true, 'третий тоже');
ok(acc.sameAccount(p1, other) === false, 'чужой игрок — другой аккаунт');
ok(p2.email === p1.email, 'почта общая');
ok(p2.passHash === p1.passHash, 'пароль общий — вход один');
ok(p2.level === 1 && p2.dollars > 0, 'новый персонаж начинает с нуля');
ok(p3.country === 'kz', 'страна выбирается своя для каждого');
// Старые записи без accountId считаются самостоятельным аккаунтом
ok(acc.accountIdOf({ id: 'old1' }) === 'old1', 'запись без поля не требует миграции');

console.log('\n── 3. Кабинет ──');
const v = acc.view(p1);
ok(v.characters.length === 3, 'в кабинете три карточки');
ok(v.canCreate === false, 'создание закрыто при заполненных местах');
ok(v.characters.find((x) => x.id === p1.id).current === true, 'текущий персонаж помечен');
const card = v.characters[0];
for (const f of ['name', 'level', 'rating', 'dollars', 'gold', 'flag', 'rank']) {
  ok(card[f] !== undefined, `на карточке есть «${f}»`);
}
ok('alliance' in card && 'legion' in card, 'альянс и легион тоже');
ok(acc.view(other).canCreate === true, 'у игрока с одним персонажем место есть');

console.log('\n── 4. Переключение ──');
const sw = acc.switchTo(p1, c2.id, []);
ok(!!sw.token && sw.token.length > 20, 'выдан токен нового персонажа');
ok(sw.name === 'Второй', `переключение на «${sw.name}»`);
fails(() => acc.switchTo(p1, other.id, []), 'другого аккаунта', 'на чужого персонажа переключиться нельзя');
fails(() => acc.switchTo(p1, p1.id, []), 'уже играете', 'на себя же — тоже');
p3.banned = true;
fails(() => acc.switchTo(p1, p3.id, []), 'заблокирован', 'на заблокированного нельзя');
p3.banned = false;

console.log('\n── 5. Запрет взаимодействия между своими ──');
// Без этого запрета кабинет превращается в схему накрутки
for (const x of [p1, p2]) { x.level = 50; x.res.hp.cur = 5000; x.res.am.cur = 100; }
fails(() => battle.attack(p1, p2.id, []), 'между своими персонажами', 'нападать на своего нельзя');
fails(() => reinf.send(p1, p2.id, []), 'между своими персонажами', 'подкрепление своему нельзя');
fails(() => feat.spyOn(p1, p2.id, []), 'между своими персонажами', 'разведывать своего нельзя');
// А на чужого — можно
other.level = 50;
let spiedOther = true;
try { feat.spyOn(p1, other.id, []); } catch (e) { spiedOther = !/между своими/.test(e.message); }
ok(spiedOther, 'на чужого игрока действия работают как прежде');

console.log('\n── 6. Защита стоит в механиках, а не в интерфейсе ──');
for (const [f, what] of [
  ['src/services/battle.ts', 'бой'],
  ['src/services/reinforcements.ts', 'подкрепления'],
  ['src/services/features.ts', 'разведка и приглашения'],
]) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  ok(/assertNotSelfAccount/.test(src), `${what}: проверка на сервере`);
}
const featSrc = fs.readFileSync(path.join(ROOT, 'src/services/features.ts'), 'utf8');
ok((featSrc.match(/assertNotSelfAccount/g) || []).length >= 2,
   'приглашение друга тоже закрыто — иначе награда за себя же');

console.log('\n── 7. Интерфейс ──');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
ok(/id="cabinet-btn"/.test(html), 'кнопка кабинета есть внизу страницы');
const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
ok(/cabBtn\.style\.display = App\.me \? '' : 'none'/.test(app), 'кнопка видна только после входа');
ok(/async showCreateCharacter\(\)/.test(app), 'окно создания персонажа есть');
const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
ok(/App\.screens\.cabinet/.test(core), 'экран кабинета есть');
ok(/data-switch=/.test(core), 'кнопка переключения на карточке');
ok(/API\.setToken\(r\.token\)/.test(core), 'после переключения сохраняется новый токен');
ok(/не воюют друг с другом/.test(core), 'игроку объяснено ограничение');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(css.includes('.cab-card'), 'стили карточек добавлены');
ok(/@media \(max-width: 420px\)[\s\S]{0,160}\.cab-grid \{ grid-template-columns: 1fr/.test(css),
   'на телефоне карточки в один столбец');
const fields = fs.readFileSync(path.join(ROOT, 'src/core/playerFields.ts'), 'utf8');
ok(/accountId:/.test(fields), 'поле зарегистрировано в реестре');

console.log('\n── 8. Логин аккаунта отдельно от позывного ──');
// Персонажей трое, а вход один — логин не может быть привязан к имени
const solo2 = other;
const nl = [];
auth.setAccountLogin(p1, 'komandir_7', 'пароль123', nl);
ok(p1.accountLogin === 'komandir_7', 'логин задан');
ok(U[c2.id].accountLogin === 'komandir_7', 'у всех персонажей аккаунта логин общий');
ok(/для всех/.test(nl[0]), `сообщение поясняет: «${nl[0].slice(0, 52)}…»`);
fails(() => auth.setAccountLogin(p1, 'ab', 'пароль123', []), '4–20 символов', 'короткий логин отклонён');
fails(() => auth.setAccountLogin(p1, 'логин', 'пароль123', []), 'латиница', 'кириллица отклонена');
fails(() => auth.setAccountLogin(p1, 'novyi_login', 'неверный', []), 'Неверный пароль',
      'без пароля логин не сменить — иначе перехваченная сессия уводит аккаунт');
fails(() => auth.setAccountLogin(solo2, 'komandir_7', 'пароль123', []), 'уже занят', 'занятый логин отклонён');
// Логин не должен совпадать с чужим позывным — иначе вход неоднозначен
await auth.register('Latinec', 'пароль123', 'z@t.ru', 'ru', '9.9.9.9', 'UA');
const lat = by('Latinec');
fails(() => auth.setAccountLogin(solo2, 'Latinec', 'пароль123', []), 'уже занят',
      'логин не может совпасть с чужим позывным');

console.log('\n── 9. Вход тремя способами ──');
for (const [what, value] of [['логин аккаунта', 'komandir_7'], ['почта', 'a@t.ru'], ['позывной', 'Второй']]) {
  let entered = false;
  try { auth.login(value, 'пароль123', '1.1.1.1', 'UA'); entered = true; } catch (e) {}
  ok(entered, `вход по «${what}» работает`);
}
let wrong = false;
try { auth.login('komandir_7', 'неверный', '1.1.1.1', 'UA'); } catch (e) { wrong = /Неверный логин или пароль/.test(e.message); }
ok(wrong, 'при неверном пароле сообщение не раскрывает, существует ли аккаунт');
const asrc = fs.readFileSync(path.join(ROOT, 'src/services/auth.ts'), 'utf8');
ok(/byAccountLogin\.length \? byAccountLogin/.test(asrc), 'логин аккаунта имеет приоритет');
ok(/sort\(\(a: any, b: any\) => \(b\.lastSeen \|\| 0\) - \(a\.lastSeen \|\| 0\)\)/.test(asrc),
   'при нескольких персонажах впускаем того, кто играл последним');

console.log('\n── 10. Прочие запреты между своими ──');
const groups = require(ROOT + '/dist/src/services/groups');
const sanc = require(ROOT + '/dist/src/services/sanctions');
const market = require(ROOT + '/dist/src/services/market');
const cfg = require(ROOT + '/dist/config/gameConfig');
const pp1 = p1, pp2 = U[c2.id];
for (const x of [pp1, pp2]) { x.level = 20; x.dollars = 1e9; x.gold = 1e5; }
// Альянс: три персонажа в одной группе давали бы прибавку к вместимости
try { groups.create(pp1, 'alliance', 'Проверочный', []); } catch (e) {}
fails(() => groups.invite(pp1, 'alliance', pp2.id, []), 'между своими персонажами',
      'свой персонаж не приглашается в альянс — иначе бесплатная вместимость армии');
fails(() => sanc.declare(pp1, pp2.id, 1e6, []), 'между своими персонажами',
      'санкция на своего — способ вернуть ставку и накрутить достижение');
const debuff = cfg.MARKET_ITEMS.find((i) => i.kind === 'debuff');
fails(() => market.buyItem(pp1, debuff.id, pp2.name, []), 'между своими персонажами',
      'падлянка своему персонажу запрещена');
// Всего точек защиты
const guarded = ['battle', 'reinforcements', 'features', 'groups', 'legion', 'market', 'sanctions']
  .filter((f) => /assertNotSelfAccount/.test(fs.readFileSync(path.join(ROOT, `src/services/${f}.ts`), 'utf8')));
ok(guarded.length === 7, `защищено механик: ${guarded.length} (${guarded.join(', ')})`);

console.log('\n── 11. Панель отличает кабинет от мультоводства ──');
// Свои персонажи с одного адреса — законно. Разные аккаунты — повод присмотреться.
const chars = access.sameAccountChars(p1, U);
ok(chars.length === 2, `персонажей аккаунта показано отдельно: ${chars.length}`);
ok(!chars.some((x) => x.id === p1.id), 'сам игрок в список не входит');
access.recordLogin(pp2, '95.1.1.1', 'UA', 'вход');
access.recordLogin(p1, '95.1.1.1', 'UA', 'вход');
access.recordLogin(other, '95.1.1.1', 'UA', 'вход');
const rel = access.related(p1, U);
ok(!rel.some((r) => acc.sameAccount(p1, U[r.id])),
   'свои персонажи не попадают в список подозрительных');
ok(rel.some((r) => r.name === 'Чужой'), 'чужой аккаунт с того же адреса — попадает');
const sum = access.ipSummary(U, 2).find((g) => g.ip === '95.1.1.1');
ok(sum && sum.accounts === 2 && sum.chars === 3,
   `на адресе ${sum.chars} персонажа, но ${sum.accounts} аккаунта — считаются аккаунты`);
const accSrc = fs.readFileSync(path.join(ROOT, 'src/services/access.ts'), 'utf8');
ok(/const accounts = new Set\(list\.map/.test(accSrc),
   'сводка считает аккаунты, а не персонажей — иначе кабинет забил бы список');

console.log('\n── 12. Интерфейс логина ──');
const coreSrc = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
ok(/id="al-new"/.test(coreSrc), 'поле нового логина в настройках');
ok(/id="al-pass"/.test(coreSrc), 'подтверждение паролем');
ok(/api\/account\/login/.test(coreSrc), 'запрос уходит на сервер');
ok(/Логин один на все ваши персонажи/.test(coreSrc), 'игроку объяснено назначение логина');
const routesSrc = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/accountLogin: \(req\.user as any\)\.accountLogin/.test(routesSrc), 'текущий логин приходит в игру');

console.log('\n── 13. Аватарка в кабинете помещается целиком ──');
const cssCab = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
const avaBlock = cssCab.slice(cssCab.indexOf('.cab-ava {'), cssCab.indexOf('.cab-ava-stub'));
ok(!/\.cab-ava \{[^}]*background-size: cover/.test(avaBlock),
   'обрезка убрана — вертикальные портреты теряли больше половины кадра');
ok(/\.cab-ava\.has-photo::after[\s\S]{0,200}background-size: contain/.test(cssCab),
   'картинка вписывается целиком');
ok(/filter: blur\(14px\)/.test(avaBlock), 'пустоту по бокам закрывает размытая копия');
ok(/z-index: 1/.test(cssCab.slice(cssCab.indexOf('.cab-ava.has-photo::after'), cssCab.indexOf('.cab-ava.has-photo::after') + 260)),
   'картинка лежит поверх размытого фона');
ok(/\.cab-ava \{[^}]*height: 150px/.test(avaBlock), 'рамка стала выше — портрет виден лучше');
ok(/\.cab-ava \{[^}]*overflow: hidden/.test(avaBlock), 'размытие не вылезает за карточку');
ok(/\.cab-ava-stub \{ position: relative; z-index: 1/.test(cssCab),
   'заглушка не прячется под фоном');
ok(/@media \(max-width: 420px\)[\s\S]{0,220}\.cab-ava \{ height: 130px/.test(cssCab),
   'на телефоне рамка чуть ниже');
// Проверяем саму суть: сколько кадра терялось при обрезке
const fits = (w, h, bw = 220, bh = 150) => {
  const contain = Math.min(bw / w, bh / h);
  const cover = Math.max(bw / w, bh / h);
  return { shown: Math.round((bw * bh) / (w * cover * h * cover) * 100) };
};
ok(fits(400, 600).shown < 50, `у портрета 400×600 обрезка показывала лишь ${fits(400, 600).shown}% кадра`);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
