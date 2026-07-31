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
ok(/tabs\.filter\(t=>!t\.zone\|\|Admin\.can\(t\.zone\)\)/.test(adminJs), 'недоступные вкладки не показываются');
ok(/zone:'economy'/.test(adminJs) && /zone:'discounts'/.test(adminJs), 'выдача ресурсов и скидки помечены владельческими зонами');
ok(/zone:'database'/.test(adminJs), 'управление базой — тоже');
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

console.log('\n── 5. Скрипт деплоя устойчив ──');
const deploy = fs.readFileSync(path.join(ROOT, 'tools/deploy.sh'), 'utf8');
ok(/pm2 describe "\$PM2_NAME" > \/dev\/null 2>&1/.test(deploy), 'наличие процесса проверяется перед перезапуском');
ok(/pm2 start dist\/server\.js --name/.test(deploy), 'если процесса нет — запускается заново, а не падает');
ok(/pm2 save/.test(deploy), 'список процессов сохраняется — после перезагрузки сервера игра поднимется сама');
ok(/не установлен sqlite3 — страховочная копия НЕ создана/.test(deploy), 'предупреждение об отсутствии sqlite3 стало понятным');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
