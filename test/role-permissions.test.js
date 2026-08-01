// ═══════════════════════════════════════════════════════════════════
// Настройка возможностей ролей: владелец включает и выключает разделы
// панели для администраторов и модераторов.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-perm-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');

async function main() {
for (const [n, e] of [['Хозяин','o@t.ru'],['Куратор','a@t.ru'],['Дозорный','m@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const owner = by('Хозяин'), adm = by('Куратор'), mod = by('Дозорный');
owner.role = 'owner'; owner.isAdmin = true;
roles.setRole(owner, adm.id, 'admin', []);
roles.setRole(owner, mod.id, 'moderator', []);

console.log('\n── 1. Настройки по умолчанию ──');
const v0 = roles.permissionsView();
ok(v0.zones.length === 12, `разделов для настройки: ${v0.zones.length}`);
ok(v0.zones.every((z) => z.name && z.note), 'у каждого раздела есть название и пояснение');
const admDef = v0.roles.find((r) => r.id === 'admin');
ok(admDef.zones.length === 8, `администратору по умолчанию открыто ${admDef.zones.length} разделов`);
ok(!admDef.zones.includes('economy') && !admDef.zones.includes('database'),
   'ресурсы и база данных изначально закрыты');
ok(admDef.custom === false, 'помечено как «по умолчанию»');

console.log('\n── 2. Владелец открывает раздел ──');
ok(roles.canAccessZone(adm, 'economy') === false, 'до настройки выдача ресурсов админу закрыта');
const n1 = [];
roles.setRoleZone(owner, 'admin', 'economy', true, n1);
ok(roles.canAccessZone(adm, 'economy') === true, 'после включения — открыта');
ok(/Открыт раздел «Ресурсы»/.test(n1[0]), `сообщение: «${n1[0]}»`);
ok(roles.zonesFor(adm).includes('economy'), 'вкладка появится в панели администратора');
const v1 = roles.permissionsView();
ok(v1.roles.find((r) => r.id === 'admin').custom === true, 'настройка помечена как изменённая');

console.log('\n── 3. Владелец закрывает раздел ──');
const n2 = [];
roles.setRoleZone(owner, 'admin', 'security', false, n2);
ok(roles.canAccessZone(adm, 'security') === false, 'сброс паролей закрыт');
ok(/Закрыт раздел «Безопасность»/.test(n2[0]), `сообщение: «${n2[0]}»`);
ok(!roles.zonesFor(adm).includes('security'), 'вкладка исчезнет из панели');

console.log('\n── 4. Модератору можно дать разделы ──');
ok(roles.zonesFor(mod).length === 0, 'по умолчанию у модератора разделов панели нет');
roles.setRoleZone(owner, 'moderator', 'players', true, []);
ok(roles.canAccessZone(mod, 'players') === true, 'после включения модератор видит раздел «Игроки»');
ok(roles.isModerator(mod) === true, 'модерация чата у него осталась');
roles.setRoleZone(owner, 'moderator', 'players', false, []);

console.log('\n── 5. Защита от самоблокировки ──');
fails(() => roles.setRoleZone(owner, 'owner', 'database', false, []), 'всегда полный доступ',
      'владельцу нельзя отключить свои разделы');
ok(roles.zonesFor(owner).length === 12, 'у владельца по-прежнему все 12 разделов');
fails(() => roles.setRoleZone(adm, 'admin', 'database', true, []), 'только владелец',
      'администратор не может расширить себе права');
fails(() => roles.setRoleZone(mod, 'admin', 'players', false, []), 'только владелец',
      'модератор тоже не может');
fails(() => roles.setRoleZone(owner, 'admin', 'выдуманная-зона', true, []), 'Неизвестный раздел',
      'несуществующий раздел отклоняется');

console.log('\n── 6. Сброс к исходным ──');
const n3 = [];
roles.resetRoleZones(owner, 'admin', n3);
const v3 = roles.permissionsView();
const admAfter = v3.roles.find((r) => r.id === 'admin');
ok(admAfter.custom === false, 'пометка «изменено» снята');
ok(admAfter.zones.length === 8, `вернулось ${admAfter.zones.length} разделов по умолчанию`);
ok(roles.canAccessZone(adm, 'economy') === false, 'ресурсы снова закрыты');
ok(roles.canAccessZone(adm, 'security') === true, 'безопасность снова открыта');

console.log('\n── 7. Настройка переживает перезапуск ──');
roles.setRoleZone(owner, 'admin', 'database', true, []);
const db = require(ROOT + '/dist/src/core/db');
const saved = db.load('roleZones', {});
ok(Array.isArray(saved.admin) && saved.admin.includes('database'),
   'настройка сохранена в базу, а не только в памяти');

console.log('\n── 8. Интерфейс ──');
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');
ok(adminJs.includes('Возможности ролей'), 'блок настройки есть во вкладке «Роли»');
ok(/data-perm-zone/.test(adminJs), 'разделы переключаются галочками');
ok(/data-perm-reset/.test(adminJs), 'есть кнопка сброса к исходным');
ok(/iAmOwner \? `/.test(adminJs), 'блок виден только владельцу');
ok(/cb\.checked = !enabled;/.test(adminJs), 'при ошибке галочка возвращается в прежнее положение');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(css.includes('.perm-item'), 'стили добавлены');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
ok(/\/api\/staff\/permissions/.test(routes), 'роут настройки есть');
ok(/isOwner\(req\.user\)\) throw new u\.ApiError\('Только для владельца'\)/.test(routes), 'чтение настроек — только владельцу');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
