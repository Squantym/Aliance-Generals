// ═══════════════════════════════════════════════════════════════════
// ПОСТОЯННЫЙ АУДИТ ПРИВИЛЕГИЙ
// Перебирает опасные действия и проверяет, что каждая роль может ровно
// то, что должна. Тест появился после случая, когда модератор получил
// возможность блокировать аккаунты игроков.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-priv-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ДЫРА: ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
const admin = require(ROOT + '/dist/src/services/admin');

// Действие должно быть ЗАПРЕЩЕНО
const denied = (fn, who, what) => {
  try { fn(); ok(false, `${who} смог: ${what}`); }
  catch (e) { ok(true, `${who} не может: ${what}`); }
};
// Действие должно быть РАЗРЕШЕНО
const allowed = (fn, who, what) => {
  try { fn(); ok(true, `${who} может: ${what}`); }
  catch (e) { ok(false, `${who} НЕ смог: ${what} → ${e.message}`); }
};

async function main() {
for (const [n, e] of [['Хозяин','o@t.ru'],['Куратор','a@t.ru'],['Дозорный','m@t.ru'],['Жертва','v@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const own = by('Хозяин'), adm = by('Куратор'), mod = by('Дозорный'), vic = by('Жертва');
own.role = 'owner'; own.isAdmin = true;
roles.setRole(own, adm.id, 'admin', []);
roles.setRole(own, mod.id, 'moderator', []);
const clean = () => { vic.banned = false; vic.banUntil = 0; vic.chatBan = null; vic.lastChatAt = 0; };

console.log('\n── 1. Модератор: чем НЕ должен распоряжаться ──');
clean();
denied(() => roles.banAccount(mod, vic.id, 60, 'x', []), 'Дозор', 'блокировка аккаунта');
denied(() => roles.unbanAccount(mod, vic.id, []), 'Дозор', 'снятие бана аккаунта');
denied(() => admin.setBan(mod, { userId: vic.id, banned: true, reason: 'x' }, []), 'Дозор', 'бан через админку');
denied(() => admin.setPassword(mod, { userId: vic.id, password: 'новый12345' }, []), 'Дозор', 'смена чужого пароля');
denied(() => admin.resetAccount(mod, { userId: vic.id }, []), 'Дозор', 'сброс аккаунта');
denied(() => admin.deleteAccount(mod, { userId: vic.id, confirmName: vic.name }, []), 'Дозор', 'удаление аккаунта');
denied(() => admin.grant(mod, { userId: vic.id, gold: 1000 }, []), 'Дозор', 'выдача ресурсов');
denied(() => admin.grantAll(mod, { gold: 100 }, []), 'Дозор', 'массовая выдача');
denied(() => roles.setRole(mod, vic.id, 'moderator', []), 'Дозор', 'назначение ролей');
denied(() => roles.setRoleZone(mod, 'moderator', 'economy', true, []), 'Дозор', 'изменение прав ролей');
denied(() => roles.banChat(mod, own.id, 60, 'x', []), 'Дозор', 'блокировка чата владельцу');
denied(() => roles.banChat(mod, adm.id, 60, 'x', []), 'Дозор', 'блокировка чата администратору');

console.log('\n── 2. Модератор: чем должен ──');
clean();
allowed(() => roles.banChat(mod, vic.id, 60, 'Оскорбления', [], ['global']), 'Дозор', 'блокировка общего чата');
allowed(() => roles.unbanChat(mod, vic.id, []), 'Дозор', 'снятие блокировки чата');
allowed(() => roles.banChat(mod, vic.id, 60, 'Спам', [], ['global', 'legion', 'mail']), 'Дозор', 'блокировка всех каналов');
allowed(() => roles.unbanChat(mod, vic.id, []), 'Дозор', 'снятие');
ok(roles.zonesFor(mod).length === 0, 'у модератора нет разделов админ-панели');

console.log('\n── 3. Администратор ──');
clean();
allowed(() => admin.setBan(adm, { userId: vic.id, banned: true, reason: 'Проверка', minutes: 60 }, []), 'Админ', 'блокировка аккаунта');
allowed(() => admin.setBan(adm, { userId: vic.id, banned: false }, []), 'Админ', 'снятие бана');
allowed(() => roles.banChat(adm, vic.id, 60, 'Проверка', [], ['global']), 'Админ', 'блокировка чата');
roles.unbanChat(adm, vic.id, []);
denied(() => admin.grant(adm, { userId: vic.id, gold: 1000 }, []), 'Админ', 'выдача ресурсов');
denied(() => roles.setRole(adm, vic.id, 'admin', []), 'Админ', 'назначение администратора');
denied(() => roles.setRoleZone(adm, 'admin', 'economy', true, []), 'Админ', 'расширение своих прав');
denied(() => roles.banAccount(adm, own.id, 60, 'x', []), 'Админ', 'бан владельца');
denied(() => roles.banChat(adm, own.id, 60, 'x', []), 'Админ', 'блокировка чата владельцу');

console.log('\n── 4. Владелец ──');
clean();
allowed(() => admin.grant(own, { userId: vic.id, gold: 100 }, []), 'Владелец', 'выдача ресурсов');
allowed(() => roles.setRole(own, vic.id, 'moderator', []), 'Владелец', 'назначение ролей');
allowed(() => roles.setRoleZone(own, 'admin', 'economy', true, []), 'Владелец', 'настройка прав ролей');
roles.setRoleZone(own, 'admin', 'economy', false, []);
roles.setRole(own, vic.id, null, []);
ok(roles.zonesFor(own).length === 12, 'у владельца все 12 разделов');

console.log('\n── 5. Обычный игрок ──');
clean();
denied(() => roles.banChat(vic, mod.id, 60, 'x', []), 'Игрок', 'блокировка чата');
denied(() => admin.setBan(vic, { userId: mod.id, banned: true, reason: 'x' }, []), 'Игрок', 'бан аккаунта');
denied(() => admin.grant(vic, { userId: vic.id, gold: 999999 }, []), 'Игрок', 'выдача себе ресурсов');
denied(() => roles.setRole(vic, vic.id, 'owner', []), 'Игрок', 'назначение себя владельцем');

console.log('\n── 6. Защита не полагается только на роуты ──');
const adminSrc = fs.readFileSync(ROOT + '/src/services/admin.ts', 'utf8');
ok(/function assertZone/.test(adminSrc), 'внутри сервиса есть проверка зоны');
for (const [fn, zone] of [['grant', 'economy'], ['grantAll', 'economy'], ['setBan', 'moderation'],
                          ['resetAccount', 'security'], ['deleteAccount', 'moderation'], ['setPassword', 'security']]) {
  const idx = adminSrc.indexOf(`function ${fn}(adminUser`);
  const head = adminSrc.slice(idx, idx + 260);
  ok(head.includes(`assertZone(adminUser, '${zone}'`), `${fn}: права проверяются внутри функции (зона ${zone})`);
}
const rolesSrc = fs.readFileSync(ROOT + '/src/services/roles.ts', 'utf8');
ok(/function banAccount[\s\S]{0,400}canAccessZone\(actor, 'moderation'\)/.test(rolesSrc),
   'banAccount требует зону «Модерация», а не просто статус сотрудника');
ok(!/function banAccount\(actor[\s\S]{0,200}isModerator\(actor\)\) throw/.test(rolesSrc),
   'прежняя проверка «любой сотрудник» убрана');

console.log('\n── 7. Адреса блокировки аккаунта в админской зоне ──');
const routesSrc = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
ok(!/\/api\/mod\/ban'/.test(routesSrc), 'адрес /api/mod/ban убран');
ok(/\/api\/admin\/account-ban'/.test(routesSrc), 'бан аккаунта переехал в /api/admin/');
for (const p of ['/api/admin/account-ban', '/api/admin/account-unban']) {
  const z = roles.zoneOfPath(p);
  ok(z === 'moderation', `${p} → зона ${z}`);
  ok(!roles.canAccessZone(mod, z), `модератору адрес ${p} закрыт на входе`);
}

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
