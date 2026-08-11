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
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ДЫРА: ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
// Чистим настройку прав: она хранится в базе и иначе перетекала бы
// между прогонами тестов
try { const dbz = require(ROOT + '/dist/src/core/db'); const z = dbz.load('roleZones', {}); for (const k of Object.keys(z)) delete z[k]; dbz.save('roleZones'); } catch (e) {}
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
// GRANT_MARK: права выдаются владельцем — роль сама по себе их не даёт
for (const z of ['players', 'chat', 'moderation', 'security', 'support', 'legions', 'news', 'event', 'roles']) {
  try { roles.setRoleZone(own, 'admin', z, true, []); } catch (e) {}
}
try { roles.setRoleZone(own, 'moderator', 'chat', true, []); } catch (e) {}
denied(() => roles.setRoleZone(mod, 'moderator', 'economy', true, []), 'Дозор', 'изменение прав ролей');
denied(() => roles.banChat(mod, own.id, 60, 'x', []), 'Дозор', 'блокировка чата владельцу');
denied(() => roles.banChat(mod, adm.id, 60, 'x', []), 'Дозор', 'блокировка чата администратору');

console.log('\n── 2. Модератор: чем должен ──');
clean();
// Право на чаты выдаётся владельцем — по умолчанию его нет
roles.setRoleZone(own, 'moderator', 'chat', true, []);
allowed(() => roles.banChat(mod, vic.id, 60, 'Оскорбления', [], ['global']), 'Дозор', 'блокировка общего чата');
allowed(() => roles.unbanChat(mod, vic.id, []), 'Дозор', 'снятие блокировки чата');
allowed(() => roles.banChat(mod, vic.id, 60, 'Спам', [], ['global', 'legion', 'mail']), 'Дозор', 'блокировка всех каналов');
allowed(() => roles.unbanChat(mod, vic.id, []), 'Дозор', 'снятие');
ok(roles.zonesFor(mod).join(',') === 'chat',
   'дозорному выдана только модерация чатов — разделов панели нет');

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
ok(roles.zonesFor(own).length === 14, 'у владельца все 14 разделов');

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
const banFn = rolesSrc.slice(rolesSrc.indexOf('function banAccount'), rolesSrc.indexOf('function unbanAccount'));
ok(banFn.includes("canAccessZone(actor, 'moderation')"), 'banAccount требует зону «Модерация»');
ok(!/roleOf\(actor\) === 'moderator'/.test(banFn),
   'право определяется выданной зоной, а не ролью — так решил владелец');
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

console.log('\n── 7б. Права выдаёт владелец ──');
// Раньше опасные зоны были запрещены роли жёстко. Теперь решает владелец:
// он может открыть «Дозору» что угодно, кроме управления базой.
for (const zone of ['moderation', 'security', 'economy', 'roles', 'season']) {
  try { roles.setRoleZone(own, 'moderator', zone, true, []); ok(true, `владелец может открыть «Дозору» зону ${zone}`); }
  catch (e) { ok(false, `зона ${zone} не выдалась: ${e.message}`); }
  roles.setRoleZone(own, 'moderator', zone, false, []);
}
try { roles.setRoleZone(own, 'moderator', 'database', true, []); ok(false, 'база данных выдалась'); }
catch (e) { ok(true, 'управление базой не выдаётся никому — только владелец'); }
clean();
denied(() => roles.banAccount(mod, vic.id, 60, 'x', []), 'Дозор', 'без выданного права бан аккаунта недоступен');

console.log('\n── 8. Кнопки в интерфейсе ──');
// Кнопка бана аккаунта не должна попадать в разметку у модератора.
// Прятать её стилем недостаточно: она остаётся в DOM, и её видно тому,
// кто откроет исходник страницы.
const coreUi = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
ok(/\(App\.me\.staffZones \|\| \[\]\)\.indexOf\('moderation'\) >= 0/.test(coreUi),
   'кнопка бана аккаунта рисуется только при наличии зоны «Модерация»');
ok(!/id="pf-accban" style="width:100%;display:none"/.test(coreUi),
   'кнопка больше не прячется стилем — её просто нет в разметке');
ok(/if \(accBtn\)/.test(coreUi), 'обработчики переживают отсутствие кнопки');
ok(/id="pf-chatban"/.test(coreUi), 'кнопка блокировки чата остаётся у всех сотрудников');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
