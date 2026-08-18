// ═══════════════════════════════════════════════════════════════════
// Панель администратора: рабочий стол, карточка игрока, собственные
// окна мер. Задача — сделать её удобной для повседневной работы и
// заметно отличной от панели владельца, которая про настройку игры.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-panel-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
// Чистим настройку прав: она хранится в базе и иначе перетекала бы
// между прогонами тестов
try { const dbz = require(ROOT + '/dist/src/core/db'); const z = dbz.load('roleZones', {}); for (const k of Object.keys(z)) delete z[k]; dbz.save('roleZones'); } catch (e) {}
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');

async function main() {
for (const [n, e] of [['Хозяин','o@t.ru'],['Куратор','a@t.ru'],['Дозорный','m@t.ru'],['Игрок','p@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const own = by('Хозяин'), adm = by('Куратор'), mod = by('Дозорный'), pl = by('Игрок');
own.role = 'owner'; own.isAdmin = true;
roles.setRole(own, adm.id, 'admin', []);
roles.setRole(own, mod.id, 'moderator', []);

// Владелец выдаёт роли рабочий набор прав — экономику и акции не даём,
// как это и делается на практике
for (const z of ['players','chat','moderation','security','support','legions','news','event','roles']) {
  try { roles.setRoleZone(own, 'admin', z, true, []); } catch (e) {}
  try { roles.setRoleZone(own, 'arbiter', z, true, []); } catch (e) {}
}
try { roles.setRoleZone(own, 'moderator', 'chat', true, []); } catch (e) {}
try { roles.setRoleZone(own, 'commissar', 'chat', true, []); roles.setRoleZone(own, 'commissar', 'roles', true, []); } catch (e) {}

console.log('\n── 1. Панель открывается сводкой, а не списком ──');
ok(/tab: 'home'/.test(adminJs), 'стартовая вкладка — «Сводка»');
ok(/\{ id:'home', *label:'📊 Сводка', *group:'Люди' \}/.test(adminJs),
   'вкладка есть и без ограничения по зоне — доступна всем сотрудникам');
ok(/renderHome/.test(adminJs), 'у неё свой экран');
ok(adminJs.indexOf("id:'home'") < adminJs.indexOf("id:'players'"), 'сводка стоит первой');

console.log('\n── 2. Сводка показывает, что требует внимания ──');
ok(/\/api\/admin\/dashboard/.test(routes), 'есть роут сводки');
ok(/Требует внимания/.test(adminJs), 'блок срочного');
ok(/kind: d\.tickets\.oldest >= 24 \? 'hot' : 'warn'/.test(adminJs),
   'обращения старше суток помечаются как срочные');
ok(css.includes('.adm-alert-hot'), 'для них свой цвет');
ok(/самое старое ждёт/.test(adminJs), 'показывается возраст самого старого обращения');
ok(/Ничего срочного/.test(adminJs), 'при пустой очереди — понятное сообщение, а не пустой экран');
ok(/data-goto-tab/.test(adminJs), 'из сводки можно перейти сразу в нужный раздел');

console.log('\n── 3. Сводка учитывает права ──');
const dash = routes.slice(routes.indexOf("'/api/admin/dashboard'"), routes.indexOf("'/api/admin/player-card"));
ok(/const has = \(z: string\) => zones\.indexOf\(z\) >= 0/.test(dash), 'проверяются зоны сотрудника');
ok(/if \(has\('support'\)\)/.test(dash), 'обращения только тем, у кого есть поддержка');
ok(/has\('moderation'\) \? roles\.bannedList\(\)/.test(dash), 'меры только тем, у кого есть модерация');
ok(/has\('support'\) && d\.tickets\.open/.test(adminJs), 'интерфейс тоже сверяется с правами');

console.log('\n── 4. Поиск и карточка игрока ──');
ok(/Найти игрока/.test(adminJs), 'поиск прямо на первом экране');
ok(/\/api\/admin\/player-card/.test(routes), 'есть роут карточки');
ok(/showPlayerCard/.test(adminJs), 'карточка открывается окном');
const card = routes.slice(routes.indexOf("'/api/admin/player-card"), routes.indexOf('БАЗА ДАННЫХ'));
ok(/chatBan:/.test(card) && /accountBan:/.test(card), 'в карточке видны действующие меры');
ok(/recent/.test(card), 'и последние действия игрока');
ok(/can: \{/.test(card), 'карточка сообщает, какие действия доступны смотрящему');
ok(/p\.can\.resources \?/.test(adminJs), 'баланс показывается только тем, кто работает с ресурсами');
ok(/canAccessZone\(req\.user, 'players'\)/.test(card), 'карточка требует зону «Игроки»');

console.log('\n── 5. Меры прямо из карточки ──');
ok(/data-act="chat"/.test(adminJs), 'блокировка чата из карточки');
ok(/data-act="acc"/.test(adminJs), 'блокировка аккаунта из карточки');
ok(/p\.can\.chatBan \?/.test(adminJs) && /p\.can\.accountBan \?/.test(adminJs),
   'кнопки рисуются только при наличии прав — у «Дозора» бана аккаунта не будет');
ok(/Открыть профиль в игре/.test(adminJs), 'можно перейти к игровому профилю');

console.log('\n── 6. Окна мер работают внутри панели ──');
// В админке не подключён app.js — окна из игры там недоступны
const adminHtml = fs.readFileSync(ROOT + '/public/admin.html', 'utf8');
ok(!/js\/app\.js/.test(adminHtml), 'app.js в панель не подключён');
ok(/banChatDialog/.test(adminJs), 'у панели своё окно блокировки чата');
ok(/banAccountDialog/.test(adminJs), 'и своё окно блокировки аккаунта');
ok(/_wireBanDialog/.test(adminJs), 'обработчики окон вынесены отдельно');
ok(!/App\.showChatBanDialog/.test(adminJs), 'панель не зовёт функции из игры — иначе окна не открылись бы');
ok(/data-scope-all/.test(adminJs), 'в окне есть выбор каналов и «Всё сразу»');
ok(/adm-purge/.test(adminJs), 'и удаление сообщений');

console.log('\n── 7. Прозрачность работы сотрудника ──');
ok(/Мои действия за сутки/.test(adminJs), 'сотрудник видит собственный журнал');
ok(/Все действия сотрудников записываются/.test(adminJs), 'об этом прямо сказано');
ok(/myActions/.test(dash), 'сервер отдаёт эти данные');
ok(/listForUser\(me\.id/.test(dash), 'берутся действия именно этого сотрудника');

console.log('\n── 8. Оформление отличается от панели владельца ──');
ok(css.includes('.adm-hello'), 'у сводки своя шапка с именем и статистикой');
ok(css.includes('.adm-alert'), 'блоки срочного оформлены');
ok(css.includes('.adm-card'), 'карточка игрока оформлена');
ok(/@media \(max-width: 420px\)[\s\S]{0,200}adm-card-rows/.test(css), 'карточка адаптирована под телефон');

console.log('\n── 9. Разделение владелец / администратор ──');
const admZones = roles.zonesFor(adm), ownZones = roles.zonesFor(own);
ok(ownZones.length > admZones.length, `у владельца разделов больше (${ownZones.length} против ${admZones.length})`);
ok(!admZones.includes('economy') && !admZones.includes('database'),
   'администратору недоступны ресурсы и база — это настройка игры, а не работа с людьми');
ok(admZones.includes('players') && admZones.includes('moderation') && admZones.includes('support'),
   'зато доступно всё для повседневной работы');
roles.setRoleZone(own, 'moderator', 'chat', true, []);
ok(roles.zonesFor(mod).join(',') === 'chat',
   'дозорному выдана только модерация чатов — разделов панели у него нет');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
