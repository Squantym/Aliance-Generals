// ═══════════════════════════════════════════════════════════════════
// Как сотрудники попадают в панель: вход по зонам, скрытие разделов,
// кнопка в игре вместо знания секретного адреса.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const adminJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
const http = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');

console.log('\n── 1. Вход в панель — по зонам доступа ──');
ok(/me\.staffZones && me\.staffZones\.length/.test(adminJs), 'панель пускает по зонам, а не по старому флагу isAdmin');
ok(adminJs.includes('Модератор работает из чата'), 'модератору объясняют, что панель ему не нужна');
ok(/У этой учётной записи нет доступа к панели/.test(adminJs), 'постороннему — понятный отказ');
ok(/const me = await API\.get\('\/api\/me'\)[\s\S]{0,200}staffZones/.test(adminJs), 'после входа по паролю зоны тоже проверяются');

console.log('\n── 2. Разделы скрыты по правам ──');
ok(/tabs\.filter\(t=>\(!t\.zone\|\|Admin\.can\(t\.zone\)\)/.test(adminJs), 'недоступные вкладки не показываются');
ok(/id:'econ',[^}]*zone:'economy'/.test(adminJs), 'вкладка «Экономика» помечена владельческой зоной');
ok(/ownerOnly:true/.test(adminJs), 'журнал золота открыт только владельцу');
ok(/Admin\.can\('database'\)/.test(adminJs), 'блок базы виден по праву на базу');
ok(/Admin\._tabIds\.indexOf\(Admin\.tab\) === -1/.test(adminJs), 'если открытый раздел недоступен, сотрудника уводит на доступный');
ok(adminJs.includes('can(zone)'), 'есть проверка доступа к разделу');

console.log('\n── 3. Секретный адрес не расходится по людям ──');
ok(/staffPanel: \(require\('\.\/services\/roles'\)\.zonesFor\(req\.user\)\.length/.test(routes),
   'адрес панели отдаётся ТОЛЬКО тем, у кого есть доступ');
ok(/\? \(process\.env\.ADMIN_PATH \|\| null\) : null\)/.test(routes), 'остальным приходит null — адрес им не виден');
ok(core.includes('Открыть панель управления'), 'у сотрудника в настройках есть кнопка входа');
ok(/App\.me\.staffPanel/.test(core), 'кнопка показывается только при наличии доступа');
ok(core.includes('запоминать его не нужно'), 'сотруднику объяснено, что адрес знать не нужно');
ok(/staffRole === 'moderator'/.test(core), 'модератору показывают его инструменты — чат, а не панель');

console.log('\n── 4. Панель по-прежнему скрыта от посторонних ──');
ok(/rel === '\/admin' \|\| rel === '\/admin\/' \|\| rel === '\/admin\.html'/.test(http), 'стандартные адреса закрыты');
ok(http.includes('Попытка открыть админ-панель'), 'попытки записываются в журнал');
ok(/canAccessZone\(user, roles\.zoneOfPath\(pathname\)\)/.test(http), 'каждый запрос проверяется по своей зоне');

console.log('\n── 5. Назначение владельца без потери правки ──');
const server = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
ok(server.includes('OWNER_NAME'), 'владельца можно задать переменной OWNER_NAME в .env');
ok(/\(target as any\)\.role = 'owner'/.test(server), 'роль выставляется при старте сервера');
ok(/держит игроков в памяти и при остановке/.test(server),
   'в коде объяснено, почему правка из скрипта пропадала');
ok(/toLowerCase\(\) === low/.test(server), 'позывной сравнивается без учёта регистра');
const grantSrc = fs.readFileSync(path.join(ROOT, 'tools/grant-admin.js'), 'utf8');
ok(/function serverRunning/.test(grantSrc), 'скрипт определяет работающий сервер');
ok(/СЕЙЧАС РАБОТАЕТ СЕРВЕР ИГРЫ/.test(grantSrc),
   'и отказывается менять роль на живую — иначе изменение молча затрётся');
const adminJs2 = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/renderRoles/.test(adminJs2), 'в панели есть вкладка «Роли» — назначение без остановки сервера');
ok(/data-r="owner"/.test(adminJs2), 'владелец может назначить владельца');
// Кнопки остальных ролей формируются из списка доступных назначений
ok(/canAssign\.map\(\(r\) =>/.test(adminJs2), 'кнопки ролей строятся по правам назначающего');
ok(/moderator: 'Дозор'/.test(adminJs2), 'дозорный есть в списке ролей');

console.log('\n── 6. Скрипт ролей различает роли ──');
const grant = fs.readFileSync(path.join(ROOT, 'tools/grant-admin.js'), 'utf8');
ok(/const currentRole = target\.role \|\| \(target\.isAdmin \? 'admin' : null\)/.test(grant),
   'текущая роль вычисляется с учётом старого флага isAdmin');
ok(/const wantRole = OFF \? null : \(OWNER \? 'owner'/.test(grant), 'запрошенная роль определяется отдельно');
ok(/if \(currentRole === wantRole\)/.test(grant),
   'сравниваются РОЛИ, а не факт наличия прав — повышение админа до владельца больше не игнорируется');

console.log('\n── 7. Скрипт деплоя устойчив ──');
const deploy = fs.readFileSync(path.join(ROOT, 'tools/deploy.sh'), 'utf8');
ok(/pm2 describe "\$PM2_NAME" > \/dev\/null 2>&1/.test(deploy), 'наличие процесса проверяется перед перезапуском');
ok(/pm2 start dist\/server\.js --name/.test(deploy), 'если процесса нет — запускается заново, а не падает');
ok(/pm2 save/.test(deploy), 'список процессов сохраняется — после перезагрузки сервера игра поднимется сама');
ok(/не установлен sqlite3 — страховочная копия НЕ создана/.test(deploy), 'предупреждение об отсутствии sqlite3 стало понятным');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
