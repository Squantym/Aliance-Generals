// ═══════════════════════════════════════════════════════════════════
// Роли (владелец / администратор / модератор «Дозор») и модерация чата.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-roles-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
// Чистим настройку прав: она хранится в базе и иначе перетекала бы
// между прогонами тестов
try { const dbz = require(ROOT + '/dist/src/core/db'); const z = dbz.load('roleZones', {}); for (const k of Object.keys(z)) delete z[k]; dbz.save('roleZones'); } catch (e) {}
const social = require(ROOT + '/dist/src/services/social');

async function main() {
for (const [n, e] of [['Хозяин','o@t.ru'],['Куратор','a@t.ru'],['Дозорный','m@t.ru'],['Боец','p@t.ru'],['Нарушитель','b@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const users = player.users();
const by = (n) => users[Object.keys(users).find((id) => users[id].name === n)];
const owner = by('Хозяин'), admin = by('Куратор'), mod = by('Дозорный'), pl = by('Боец'), bad = by('Нарушитель');
owner.role = 'owner'; owner.isAdmin = true;

console.log('\n── 1. Иерархия ролей ──');
ok(roles.isOwner(owner) && roles.isAdmin(owner) && roles.isModerator(owner), 'владелец обладает всеми правами');
ok(roles.roleOf(pl) === null, 'у обычного игрока роли нет');
const legacy = { id: 'x', isAdmin: true };
ok(roles.roleOf(legacy) === 'admin', 'игрок со старым флагом isAdmin числится администратором');
// Полномочия администраторов включены, но ограничены зонами
ok(roles.adminPowersEnabled() === true, 'полномочия администраторов включены');
ok(roles.roleOf(legacy) === 'admin', 'старый флаг isAdmin читается как роль «администратор»');
ok(roles.zonesFor(legacy).length < roles.zonesFor(owner).length,
   `но прав у него меньше, чем у владельца (${roles.zonesFor(legacy).length} против ${roles.zonesFor(owner).length})`);

console.log('\n── 2. Владелец назначает роли ──');
const n1 = [];
roles.setRole(owner, admin.id, 'admin', n1);
roles.setRole(owner, mod.id, 'moderator', n1);
// Владелец выдаёт ролям рабочий набор прав. По умолчанию их нет:
// роль — это только должность, возможности назначает владелец.
for (const z of ['players', 'chat', 'moderation', 'security', 'support', 'legions', 'news', 'event', 'roles']) {
  try { roles.setRoleZone(owner, 'admin', z, true, []); } catch (e) {}
}
try { roles.setRoleZone(owner, 'moderator', 'chat', true, []); } catch (e) {}

ok(roles.roleOf(mod) === 'moderator', 'назначен модератор');
ok(mod.isAdmin === false, 'у модератора НЕТ прав администратора — доступа к ресурсам и удалению аккаунтов не будет');
ok(roles.roleLabel(mod) === 'Дозор', `подпись модератора: «${roles.roleLabel(mod)}»`);
ok(roles.roleLabel(owner) === 'Владелец', 'подпись владельца');
ok(roles.roleOf(admin) === 'admin', 'назначен администратор');
ok(roles.isAdmin(admin) === true, 'после выдачи прав доступ в панель появился');
ok(roles.isModerator(admin) === true, 'и модерация чатов — она тоже выдана');
roles.setRoleZone(owner, 'admin', 'economy', false, []);
roles.setRoleZone(owner, 'admin', 'discounts', false, []);
ok(roles.canAccessZone(admin, 'economy') === false, 'что не выдано — то недоступно: ресурсы');
ok(roles.canAccessZone(admin, 'discounts') === false, 'и акции');
ok(roles.roleLabel(admin) === 'Администратор', `подпись: «${roles.roleLabel(admin)}»`);
roles.setRole(owner, mod.id, 'moderator', n1);



console.log('\n── 3. Границы при назначении ролей ──');
const nMod = [];
roles.setRole(admin, pl.id, 'moderator', nMod);
ok(roles.roleOf(pl) === 'moderator', 'администратор может назначить модератора');
roles.setRole(admin, pl.id, null, nMod);
fails(() => roles.setRole(admin, mod.id, 'admin', []), 'по старшинству', 'администратора назначить не может');
fails(() => roles.setRole(admin, owner.id, null, []), 'по старшинству', 'владельца снять не может');
fails(() => roles.setRole(mod, pl.id, 'moderator', []), 'Нет права «Роли»', 'модератор не может раздавать роли');
fails(() => roles.setRole(owner, owner.id, null, []), 'самому себе', 'нельзя менять роль самому себе');
const n2 = [];
roles.setRole(owner, pl.id, 'moderator', n2);
ok(roles.roleOf(pl) === 'moderator', 'владелец назначает модератора');
roles.setRole(owner, pl.id, null, n2);
ok(roles.roleOf(pl) === null, 'и снимает роль');

console.log('\n── 4. Блокировка чата модератором ──');
fails(() => roles.banChat(mod, bad.id, 60, '', []), 'причину', 'без причины заблокировать нельзя');
const n3 = [];
const ban = roles.banChat(mod, bad.id, 60, 'Оскорбления', n3);
ok(ban.minutes === 60 && ban.reason === 'Оскорбления', `блокировка на ${ban.minutes} мин, причина: ${ban.reason}`);
ok(bad.chatBan.byName === 'Дозорный', 'записано, кто заблокировал');
const info = roles.chatBanInfo(bad);
ok(info && info.active, 'блокировка активна');
// Нарушитель не может писать, и видит срок с причиной
fails(() => social.chatPost(bad, 'привет всем'), 'Оскорбления', 'в чат писать нельзя, причина сообщается игроку');
fails(() => social.chatPost(bad, 'привет'), 'Дозор', 'указано, кто выдал блокировку');
// Остальные пишут свободно
pl.lastChatAt = 0;
social.chatPost(pl, 'обычное сообщение');
ok(true, 'остальные игроки пишут свободно');

console.log('\n── 5. Срок и снятие ──');
bad.chatBan.until = Date.now() - 1000;                    // срок вышел
ok(roles.chatBanInfo(bad) === null, 'истёкшая блокировка перестаёт действовать сама');
bad.lastChatAt = 0;
social.chatPost(bad, 'снова могу писать');
ok(true, 'после истечения срока чат снова доступен');
roles.banChat(mod, bad.id, 1440, 'Спам', []);
const n4 = [];
roles.unbanChat(mod, bad.id, n4);
ok(roles.chatBanInfo(bad) === null, 'модератор может снять блокировку досрочно');
ok(roles.bannedList().length === 0, 'список действующих блокировок пуст');

console.log('\n── 6. Кого блокировать нельзя ──');
fails(() => roles.banChat(mod, mod.id, 60, 'тест', []), 'самому себе', 'себе — нельзя');
fails(() => roles.banChat(mod, admin.id, 60, 'тест', []), 'сотрудника проекта', 'модератор не может заблокировать администратора');
const nAdmBan = [];
roles.banChat(admin, pl.id, 60, 'проверка прав', nAdmBan);
ok(roles.chatBanInfo(pl) !== null, 'администратор тоже может блокировать чат');
roles.unbanChat(admin, pl.id, nAdmBan);
const n5 = [];
roles.setRole(owner, pl.id, 'moderator', n5);
fails(() => roles.banChat(mod, pl.id, 60, 'тест', []), 'сотрудника проекта', 'модератор не может заблокировать другого модератора');
roles.banChat(owner, pl.id, 30, 'проверка', n5);
ok(roles.chatBanInfo(pl) !== null, 'а владелец модератора заблокировать может');
fails(() => roles.banChat(mod, owner.id, 60, 'тест', []), 'владельца', 'владельца не заблокировать никому');
roles.unbanChat(owner, pl.id, n5);
roles.setRole(owner, pl.id, null, n5);

console.log('\n── 7. Ограничения срока ──');
const long = roles.banChat(mod, bad.id, 999999, 'проверка предела', []);
ok(long.minutes === roles.MAX_BAN_MINUTES, `срок ограничен сверху: ${long.minutes} мин (${roles.humanMinutes(long.minutes)})`);
roles.unbanChat(mod, bad.id, []);
const short = roles.banChat(mod, bad.id, -50, 'проверка минимума', []);
ok(short.minutes >= 1, `отрицательный срок превращается в минимальный: ${short.minutes} мин`);
roles.unbanChat(mod, bad.id, []);

console.log('\n── 8. Список сотрудников ──');
const staff = roles.staffList();
ok(staff.length >= 3, `в списке ${staff.length} сотрудника`);
ok(staff[0].role === 'owner', 'владелец в начале списка');
ok(staff.every((s) => s.label), 'у каждого указана подпись роли');

console.log('\n── 9. Значки и интерфейс ──');
const view = social.chatGet(pl);
const modMsg = view.messages.find((m) => m.uid === pl.id);
ok('staff' in view.messages[0] && 'staffLabel' in view.messages[0], 'сообщения чата несут роль автора');
const soc = fs.readFileSync(ROOT + '/public/js/screens/social.js', 'utf8');
ok(/role-tag role-tag-\$\{msg\.staff\}/.test(soc), 'приписка роли рисуется рядом с именем в чате');
ok(soc.includes('data-mute'), 'у сотрудника есть кнопка блокировки возле сообщения');
const app = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
ok(app.includes('showChatBanDialog'), 'окно блокировки существует');
ok(/15 минут[\s\S]{0,300}30 суток/.test(app), 'срок выбирается из готовых вариантов — от 15 минут до 30 суток');
ok(app.includes('Оскорбления') && app.includes('Спам и флуд'), 'частые причины вынесены кнопками');
ok(app.includes('ban-reason-text'), 'причину можно вписать свою');
ok(/Укажите причину блокировки/.test(app), 'без причины окно не даёт заблокировать');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(css.includes('.chat-staff-moderator') && css.includes('.ban-dialog'), 'стили значков и окна добавлены');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
ok(routes.includes('/api/mod/chat-ban') && routes.includes('/api/staff/role'), 'роуты модерации и ролей есть');
ok(routes.includes('staffRole'), 'фронт узнаёт свою роль из /api/me');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
