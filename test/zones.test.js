// ═══════════════════════════════════════════════════════════════════
// Зоны доступа: что может администратор, а что — только владелец.
// Плюс срочные баны аккаунта (от 1 минуты).
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-zones-test';
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
const admin = require(ROOT + '/dist/src/services/admin');

async function main() {
for (const [n, e] of [['Хозяин','o@t.ru'],['Помощник','a@t.ru'],['Дозорный','m@t.ru'],['Боец','p@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const owner = by('Хозяин'), adm = by('Помощник'), mod = by('Дозорный'), pl = by('Боец');
owner.role = 'owner'; owner.isAdmin = true;
roles.setRole(owner, adm.id, 'admin', []);
roles.setRole(owner, mod.id, 'moderator', []);

// Админу выдаём рабочие права, но НЕ экономику и не акции — так владелец
// и настраивает на практике
for (const z of ['players','chat','moderation','security','support','legions','news','event','roles']) {
  try { roles.setRoleZone(owner, 'admin', z, true, []); } catch (e) {}
}

console.log('\n── 1. Что доступно администратору ──');
const allowedForAdmin = [
  ['/api/admin/players', 'поиск и просмотр игроков'],
  ['/api/admin/logs', 'журнал действий'],
  ['/api/admin/ban', 'баны аккаунтов'],
  ['/api/mod/chat-ban', 'блокировка чата (кляп)'],
  ['/api/admin/set-password', 'сброс пароля'],
  ['/api/admin/reset', 'сброс прогресса'],
  ['/api/admin/support', 'обращения в поддержку'],
  ['/api/admin/support/reply', 'ответы игрокам'],
  ['/api/admin/push/broadcast', 'push-уведомления'],
  ['/api/admin/legion/set', 'управление легионами'],
  ['/api/admin/tournaments/create', 'турниры'],
  ['/api/admin/event/start', 'мировое событие'],
  ['/api/staff/role', 'назначение модераторов'],
  ['/api/admin/delete-account', 'удаление аккаунта'],
];
for (const [p, what] of allowedForAdmin) {
  ok(roles.canAccessZone(adm, roles.zoneOfPath(p)), `админ: ${what}`);
}

console.log('\n── 2. Что осталось только владельцу ──');
const ownerOnly = [
  ['/api/admin/grant', 'выдача ресурсов'],
  ['/api/admin/grant-all', 'массовая выдача'],
  ['/api/admin/take', 'списание ресурсов'],
  ['/api/admin/rewards/grant', 'предметные награды'],
  ['/api/admin/merc/grant', 'выдача наёмников'],
  ['/api/admin/global-buff', 'глобальные бонусы'],
  ['/api/admin/discounts', 'акции и скидки'],
  ['/api/admin/discount', 'изменение акции'],
  ['/api/admin/db/backup', 'копии базы'],
  ['/api/admin/db/restore', 'восстановление из снимка'],
  ['/api/admin/season/end', 'завершение сезона'],
  ['/api/admin/unknown-future-route', 'новый неизвестный раздел'],
];
for (const [p, what] of ownerOnly) {
  const z = roles.zoneOfPath(p);
  ok(roles.canAccessZone(owner, z) && !roles.canAccessZone(adm, z), `только владелец: ${what}`);
}
ok(roles.zoneOfPath('/api/admin/unknown-future-route') === null,
   'новый админский адрес по умолчанию закрыт для админов — безопасная сторона');

console.log('\n── 2б. Каждый служебный роут отнесён к зоне ──');
// Неразмеченный адрес по умолчанию считается владельческим — это верно
// с точки зрения безопасности, но означает, что администратор не сможет
// им пользоваться. Так тихо отвалились просмотр профиля игрока и работа
// с группами: в логах появлялись «пытался вызвать», хотя права были.
const routesSrc = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
const allPaths = [...new Set([...routesSrc.matchAll(/'(\/api\/(?:admin|staff|mod)[^']*)'/g)].map((m) => m[1]))];
const unmapped = allPaths.filter((p) => !roles.zoneOfPath(p.replace(/:[a-zA-Z]+/g, 'x')));
ok(allPaths.length > 50, `служебных роутов в API: ${allPaths.length}`);
ok(unmapped.length === 0, `все роуты отнесены к зонам${unmapped.length ? ' ⚠ без зоны: ' + unmapped.join(', ') : ''}`);
for (const [p, what] of [
  ['/api/admin/player-view/x', 'просмотр карточки игрока'],
  ['/api/admin/player-snapshot/x', 'состояние аккаунта'],
  ['/api/admin/groups/legion', 'список групп'],
  ['/api/admin/groups/legion/x', 'работа с группой'],
]) {
  ok(roles.canAccessZone(adm, roles.zoneOfPath(p)), `администратору доступно: ${what}`);
}

console.log('\n── 3. Модератор и обычный игрок ──');
ok(roles.zonesFor(mod).length === 0, 'у модератора зон админ-панели нет');
ok(roles.zonesFor(pl).length === 0, 'у обычного игрока тоже');
roles.setRoleZone(owner, 'moderator', 'chat', true, []);
ok(roles.isModerator(mod) === true, 'после выдачи права модерация чатов доступна');
ok(roles.zonesFor(adm).length === 9 && roles.zonesFor(owner).length === 14,
   `зон у админа: ${roles.zonesFor(adm).length}, у владельца: ${roles.zonesFor(owner).length}`);

console.log('\n── 4. Границы при назначении ролей ──');
const n1 = [];
roles.setRole(adm, pl.id, 'moderator', n1);
ok(roles.roleOf(pl) === 'moderator', 'администратор назначает модератора');
roles.setRole(adm, pl.id, null, n1);
ok(roles.roleOf(pl) === null, 'и снимает его');
fails(() => roles.setRole(adm, pl.id, 'admin', []), 'по старшинству', 'администратора назначить не может');
fails(() => roles.setRole(adm, owner.id, null, []), 'по старшинству', 'владельца тронуть не может');

console.log('\n── 5. Баны: от 1 минуты до бессрочного ──');
const n2 = [];
admin.setBan(owner, { userId: pl.id, banned: true, reason: 'Остынь', minutes: 1 }, n2);
ok(pl.banned === true, 'игрок заблокирован');
const leftMs = pl.banUntil - Date.now();
ok(leftMs > 0 && leftMs <= 60 * 1000, `срок — 1 минута (осталось ${Math.round(leftMs / 1000)} с)`);
admin.setBan(owner, { userId: pl.id, banned: false }, n2);
ok(pl.banned === false && pl.banUntil === 0, 'разбан снимает и срок');

admin.setBan(owner, { userId: pl.id, banned: true, reason: 'Серьёзное нарушение' }, n2);
ok(pl.banned === true && pl.banUntil === 0, 'без указания срока бан бессрочный');
admin.setBan(owner, { userId: pl.id, banned: false }, n2);

admin.setBan(adm, { userId: pl.id, banned: true, reason: 'Проверка', minutes: 15 }, n2);
ok(pl.banned === true, 'администратор тоже может банить');
admin.setBan(adm, { userId: pl.id, banned: false }, n2);

console.log('\n── 6. Кого банить нельзя ──');
fails(() => admin.setBan(adm, { userId: owner.id, banned: true, reason: 'x' }, []), 'владельца', 'владельца не забанить');
fails(() => admin.setBan(adm, { userId: mod.id, banned: true, reason: 'x' }, []), 'сотрудника', 'администратор не банит модератора');
const n3 = [];
admin.setBan(owner, { userId: mod.id, banned: true, reason: 'Нарушение', minutes: 5 }, n3);
ok(mod.banned === true, 'а владелец сотрудника забанить может');
admin.setBan(owner, { userId: mod.id, banned: false }, n3);

console.log('\n── 7. Истёкший бан снимается сам ──');
const http = fs.readFileSync(ROOT + '/src/core/http.ts', 'utf8');
ok(/banUntil && \(user as any\)\.banUntil <= Date\.now\(\)/.test(http), 'при обращении к API просроченный бан снимается');
ok(/Осталось: \$\{Math\.max\(1/.test(http), 'игрок видит, сколько осталось до разблокировки');
ok(/Блокировка бессрочная/.test(http), 'при бессрочном бане так и написано');

console.log('\n── 8. Интерфейс ──');
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');
ok(/'1 минута'/.test(adminJs), 'в окне бана есть срок «1 минута»');
ok(/Бессрочно/.test(adminJs), 'и вариант «Бессрочно»');
ok(adminJs.includes('adm-ban-reason'), 'причина вводится в том же окне');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
ok(routes.includes('staffZones'), 'фронт получает список доступных ему зон');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
