// ═══════════════════════════════════════════════════════════════════
// Пять ролей: владелец → арбитр → администратор, владелец → комиссар →
// дозор. Проверяем старшинство, полномочия и компактные приписки.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-hier-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
// Чистим настройку прав: она хранится в базе и иначе перетекала бы
// между прогонами тестов
try { const dbz = require(ROOT + '/dist/src/core/db'); const z = dbz.load('roleZones', {}); for (const k of Object.keys(z)) delete z[k]; dbz.save('roleZones'); } catch (e) {}

async function main() {
const names = [['Хозяин','o'],['Арбитр1','ar'],['Админ1','ad'],['Комиссар1','co'],['Дозор1','mo'],['Игрок','pl']];
for (const [n, e] of names) await auth.register(n, 'пароль123', e + '@t.ru', 'ru', '1.1.1.1');
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const own = by('Хозяин'), arb = by('Арбитр1'), adm = by('Админ1'),
      com = by('Комиссар1'), mod = by('Дозор1'), pl = by('Игрок');
own.role = 'owner'; own.isAdmin = true;
for (const [n, r] of [['Арбитр1','arbiter'],['Админ1','admin'],['Комиссар1','commissar'],['Дозор1','moderator']]) {
  roles.setRole(own, by(n).id, r, []);
}

console.log('\n── 1. Пять ролей ──');
ok(roles.roleOf(arb) === 'arbiter', 'арбитр назначен');
ok(roles.roleOf(com) === 'commissar', 'комиссар назначен');
ok(roles.roleLabel(arb) === 'Арбитр' && roles.roleLabel(com) === 'Комиссар', 'подписи ролей');
ok(roles.rankOf('owner') > roles.rankOf('arbiter'), 'владелец старше арбитра');
ok(roles.rankOf('arbiter') > roles.rankOf('admin'), 'арбитр старше администратора');
ok(roles.rankOf('commissar') > roles.rankOf('moderator'), 'комиссар старше дозорного');

console.log('\n── 2. Права не выдаются вместе с ролью ──');
for (const [who, u] of [['арбитр', arb], ['администратор', adm], ['комиссар', com], ['дозорный', mod]]) {
  ok(roles.zonesFor(u).length === 0, `${who}: сразу после назначения прав нет ни одного`);
}
ok(roles.isAdmin(arb) === false, 'арбитр без выданных прав в панель не войдёт');
ok(roles.isModerator(com) === false, 'комиссар без права «Модерация чатов» чаты не модерирует');
fails(() => roles.banChat(mod, pl.id, 60, 'x', [], ['global']), 'Нет права «Модерация чатов»',
      'дозорный не может блокировать чат, пока право не выдано');
fails(() => roles.banAccount(arb, pl.id, 60, 'x', []), 'Нет права «Баны аккаунтов»',
      'арбитр не может банить, пока право не выдано');
fails(() => roles.setRole(arb, pl.id, 'moderator', []), 'Нет права «Роли»',
      'и не может назначать роли');

console.log('\n── 3. Владелец выдаёт возможности ──');
roles.setRoleZone(own, 'arbiter', 'chat', true, []);
ok(roles.isModerator(arb) === true, 'после выдачи «Модерация чатов» арбитр модерирует чаты');
roles.setRoleZone(own, 'arbiter', 'moderation', true, []);
ok(roles.canAccessZone(arb, 'moderation'), 'после выдачи «Баны аккаунтов» — может банить');
roles.setRoleZone(own, 'arbiter', 'roles', true, []);
ok(roles.isAdmin(arb) === true, 'с выданными правами появляется доступ в панель');
roles.setRoleZone(own, 'moderator', 'chat', true, []);
ok(roles.isModerator(mod) === true, 'дозорному тоже выдаётся модерация чатов');
roles.banChat(mod, pl.id, 60, 'Оскорбления', [], ['global']);
ok(roles.chatBanInfo(pl) !== null, 'и он ею пользуется');
roles.unbanChat(mod, pl.id, []);
fails(() => roles.banAccount(mod, pl.id, 60, 'x', []), 'Нет права «Баны аккаунтов»',
      'но бан аккаунта ему не выдавали — недоступен');

console.log('\n── 3б. Старое поведение ролей ──');
ok(roles.zonesFor(own).length === 14, 'у владельца по-прежнему все разделы');
fails(() => roles.setRoleZone(own, 'admin', 'database', true, []), 'нельзя открыть',
      'управление базой не выдаётся никому, кроме владельца');
// Для дальнейших проверок выдаём ролям права
roles.setRoleZone(own, 'admin', 'roles', true, []);
roles.setRoleZone(own, 'commissar', 'roles', true, []);
roles.setRoleZone(own, 'commissar', 'chat', true, []);

console.log('\n── 4. Кто кого назначает ──');
const tryAssign = (actor, role) => {
  try { roles.setRole(actor, pl.id, role, []); roles.setRole(own, pl.id, null, []); return true; }
  catch (e) { return false; }
};
ok(tryAssign(own, 'arbiter') && tryAssign(own, 'commissar'), 'владелец назначает любые роли');
ok(tryAssign(arb, 'admin') && tryAssign(arb, 'commissar') && tryAssign(arb, 'moderator'),
   'арбитр назначает администраторов, комиссаров и дозорных');
ok(!tryAssign(arb, 'arbiter'), 'но не равного себе арбитра');
ok(tryAssign(adm, 'moderator') && !tryAssign(adm, 'admin'), 'администратор — только дозорных');
ok(tryAssign(com, 'moderator') && !tryAssign(com, 'commissar'), 'комиссар — только дозорных');
ok(!tryAssign(mod, 'moderator'), 'дозорный не назначает никого');

console.log('\n── 5. Нельзя трогать равных и старших ──');
fails(() => roles.setRole(adm, arb.id, null, []), 'ниже вас по старшинству', 'админ не снимет арбитра');
fails(() => roles.setRole(com, adm.id, null, []), 'ниже вас по старшинству', 'комиссар не тронет админа');
fails(() => roles.setRole(arb, own.id, null, []), 'ниже вас по старшинству', 'арбитр не тронет владельца');
const n1 = [];
roles.setRole(arb, adm.id, null, n1);
ok(roles.roleOf(adm) === null, 'зато арбитр может снять администратора');
roles.setRole(own, adm.id, 'admin', []);

console.log('\n── 6. Приписки к имени ──');
ok(roles.roleTag(own) === 'owner', `владелец: «${roles.roleTag(own)}»`);
ok(roles.roleTag(arb) === 'arbiter', `арбитр: «${roles.roleTag(arb)}»`);
ok(roles.roleTag(adm) === 'admin', `администратор: «${roles.roleTag(adm)}» вместо «Администратор»`);
ok(roles.roleTag(com) === 'commissar', `комиссар: «${roles.roleTag(com)}»`);
ok(roles.roleTag(mod) === 'дозор', `дозорный: «${roles.roleTag(mod)}»`);
ok(roles.roleTag(pl) === '', 'у обычного игрока приписки нет');

console.log('\n── 7. Приписки в интерфейсе ──');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(/\.role-tag \{[\s\S]{0,200}vertical-align: super/.test(css), 'приписка стоит по верхней линии текста');
ok(/\.role-tag \{[\s\S]{0,120}font-size: 9px/.test(css), 'шрифт мелкий');
for (const r of ['owner', 'arbiter', 'admin', 'commissar', 'moderator']) {
  ok(css.includes(`.role-tag-${r}`), `у роли ${r} свой цвет приписки`);
}
const soc = fs.readFileSync(ROOT + '/public/js/screens/social.js', 'utf8');
ok(/<sup class="role-tag role-tag-\$\{msg\.staff\}"/.test(soc), 'в чате приписка выводится тегом sup');
ok(/msg\.staffTag/.test(soc), 'используется короткая форма');
const core = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
ok(/<sup class="role-tag role-tag-\$\{p\.staffRole\}"/.test(core), 'в профиле тоже приписка');
const app = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
ok(/arbiter: *\{ tag: 'arbiter'/.test(app) && /commissar: *\{ tag: 'commissar'/.test(app),
   'новые роли есть в метках списка целей');

console.log('\n── 8. Панель знает о новых ролях ──');
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');
ok(/arbiter: 'Арбитр'/.test(adminJs) && /commissar: 'Комиссар'/.test(adminJs), 'подписи в панели');
ok(/CAN = \{ owner: \['arbiter','admin','commissar','moderator'\]/.test(adminJs),
   'кнопки назначения совпадают с правами на сервере');
const perms = roles.permissionsView();
ok(perms.roles.length === 4, `настраиваются возможности всех четырёх ролей (${perms.roles.map((r) => r.name).join(', ')})`);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
