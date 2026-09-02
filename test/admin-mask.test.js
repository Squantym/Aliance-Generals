// ═══════════════════════════════════════════════════════════════════
// Маскировка админ-панели: секретный адрес вместо /admin, защита от
// ошибок настройки и от самоблокировки.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const http = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
const hide = fs.readFileSync(path.join(ROOT, 'tools/hide-admin.js'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');

console.log('\n── 1. Маскировка ──');
ok(/ADMIN_PATH && \(rel === ADMIN_PATH \|\| rel === ADMIN_PATH \+ '\/'\)/.test(http),
   'панель открывается по секретному адресу');
const adminBlock = http.slice(http.indexOf('} else if (isAdminFile) {'), http.indexOf('Короткие адреса правовых документов'));
ok(adminBlock.includes('writeHead(404') && adminBlock.includes("end('Not found')"),
   'при заданном ADMIN_PATH адрес /admin отвечает 404, как несуществующая страница');
ok(/} else if \(!ADMIN_PATH && isAdminFile\)/.test(http),
   'без настройки работает обычный /admin — доступ не теряется');
ok(http.includes('Попытка открыть админ-панель'), 'обращения к /admin пишутся в журнал');

console.log('\n── 2. Защита от ошибок настройки ──');
ok(/if \(ADMIN_PATH && !ADMIN_PATH\.startsWith\('\/'\)\) ADMIN_PATH = '\/' \+ ADMIN_PATH/.test(http),
   'путь без ведущего слэша исправляется автоматически');
ok(/ADMIN_PATH\.endsWith\('\/'\)\) ADMIN_PATH = ADMIN_PATH\.slice\(0, -1\)/.test(http),
   'лишний слэш в конце отбрасывается');
ok(/\['\/', '\/api', '\/index\.html', '\/js', '\/css', '\/img'\]\.includes\(ADMIN_PATH\)/.test(http),
   'пути, занятые игрой, отклоняются — панель не может перекрыть саму игру');
ok(/маскировка отключена, панель на \/admin/.test(http),
   'при опасном пути маскировка выключается, а не ломает сервер');

console.log('\n── 3. Скрипт настройки ──');
ok(fs.existsSync(path.join(ROOT, 'tools/hide-admin.js')), 'скрипт tools/hide-admin.js существует');
ok(/function generatePath/.test(hide), 'умеет придумать случайный адрес');
ok(/crypto\.randomBytes/.test(hide), 'адрес генерируется криптостойко, а не Math.random');
ok(/--show/.test(hide) && /--off/.test(hide), 'есть просмотр текущего адреса и отключение маскировки');
ok(/fs\.copyFileSync\(ENV, ENV \+ '\.bak-'/.test(hide), 'перед правкой .env делается копия — в нём лежат доступы');
ok(/RESERVED\.includes\(target\)/.test(hide), 'занятые игрой пути не принимаются');
ok(/Кириллица не подойдёт/.test(hide), 'кириллица отклоняется с объяснением');
ok(/target\.length < 8/.test(hide), 'слишком короткие адреса отклоняются — их подбирают перебором');
ok(/replace\(\/\\n\*\$\/, ''\) \+ '\\n'/.test(hide), 'файл .env остаётся с завершающим переносом строки');

console.log('\n── 4. Как сотрудник узнаёт адрес ──');
// Проверяем СМЫСЛ, а не точный текст выражения: раньше здесь стоял
// слепок строки, и он краснел на любой переработке, ничего не сообщая
// о поведении.
ok(/staffPanel:[\s\S]{0,400}zonesFor\(req\.user\)\.length[\s\S]{0,80}return null;/.test(routes),
   'адрес приходит только тем, у кого есть доступ');
// Запасной путь обязателен: при незаданном ADMIN_PATH адрес приходил
// пустым, и кнопки в настройках не было ВООБЩЕ, хотя панель работала.
ok(/staffPanel:[\s\S]{0,600}\|\| '\/admin'/.test(routes),
   'без ADMIN_PATH адрес не пустой, а запасной /admin');
ok(core.includes('Открыть панель управления'), 'в игре есть кнопка входа в панель');
ok(core.includes('запоминать его не нужно'), 'сотруднику не нужно знать секретный путь');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
