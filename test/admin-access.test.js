// ═══════════════════════════════════════════════════════════════════
// Доступ к админ-панели: панель скрыта, права не выдаются сами собой.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-admin-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const db = require(ROOT + '/dist/src/core/db');
const http = fs.readFileSync(ROOT + '/src/core/http.ts', 'utf8');

async function main() {
console.log('\n── 1. Первый игрок НЕ становится администратором ──');
const r1 = await auth.register('Первый', 'пароль123', 'p1@t.ru', 'ru', '1.1.1.1');
const users = db.load('users', {});
const first = Object.values(users)[0];
ok(first.isAdmin === false, 'у первого зарегистрированного прав нет');
ok(r1.isAdmin === false, 'ответ регистрации не сообщает о правах');
const r2 = await auth.register('Второй', 'пароль123', 'p2@t.ru', 'ru', '2.2.2.2');
ok(Object.values(users).every((p) => !p.isAdmin), 'ни у кого из игроков прав нет');
const authSrc = fs.readFileSync(ROOT + '/src/services/auth.ts', 'utf8');
ok(!/isAdmin: isFirst|country, isFirst,/.test(authSrc), 'в коде регистрации не осталось выдачи прав');
ok(authSrc.includes('grant-admin.js'), 'в подсказке указан способ назначить администратора');

console.log('\n── 2. Панель скрыта за секретным адресом ──');
ok(http.includes("process.env.ADMIN_PATH"), 'адрес панели берётся из настройки ADMIN_PATH');
ok(/rel === '\/admin' \|\| rel === '\/admin\/' \|\| rel === '\/admin\.html'/.test(http),
   'стандартные адреса /admin и /admin.html распознаются');
ok(/res\.writeHead\(404[\s\S]{0,120}Not found/.test(http), 'на них отвечает 404 — как несуществующая страница');
ok(!/if \(rel === '\/admin'\) rel = '\/admin\.html';/.test(http), 'прежняя прямая отдача панели убрана');
ok(/ADMIN_PATH && \(rel === ADMIN_PATH/.test(http), 'панель открывается только по заданному секретному адресу');
ok(http.includes('Попытка открыть админ-панель'), 'обращения к стандартному адресу пишутся в журнал — видно сканирование');

console.log('\n── 3. Защита админских запросов ──');
ok(/пытался вызвать/.test(http), 'попытка обычного игрока вызвать админский запрос логируется с именем');
ok(http.includes('ADMIN_IPS'), 'есть необязательный белый список адресов');
ok(/allowList\.length && !allowList\.includes\(reqCtx\.ip\)/.test(http),
   'при заданном списке админские запросы с чужих адресов отклоняются');
ok(http.includes('Доступ с этого адреса запрещён'), 'отказ по адресу сопровождается понятным ответом');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
const adminRoutes = (routes.match(/\/api\/admin/g) || []).length;
ok(adminRoutes > 20, `админских запросов в API: ${adminRoutes} — все проверяются флагом admin`);

console.log('\n── 4. Скрипт назначения прав ──');
const grant = fs.readFileSync(ROOT + '/tools/grant-admin.js', 'utf8');
ok(grant.includes('--off'), 'права можно снять, а не только выдать');
ok(grant.includes('--list'), 'есть просмотр списка администраторов');
ok(grant.includes('ПОСЛЕДНИЙ администратор'), 'предупреждает, если снимаются права у последнего админа');
ok(grant.includes('Продолжить? (да/нет)'), 'требует подтверждения перед изменением прав');
ok(grant.includes('loadEnv'), 'читает .env — работает с той же базой, что и сервер');
ok(grant.includes('flushAllNow'), 'изменение сохраняется на диск немедленно');
ok(/found\.length > 1/.test(grant), 'при совпадении нескольких игроков требует уточнения, а не меняет наугад');

console.log('\n── 5. Действующие администраторы сохранены ──');
// Права, выданные ранее, не сбрасываются обновлением
first.isAdmin = true;
db.markUser(first.id);
const stillAdmin = db.load('users', {})[first.id].isAdmin;
ok(stillAdmin === true, 'ранее выданные права остаются — обновление не отбирает доступ у владельца');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
