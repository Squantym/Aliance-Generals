// Статика: файлы с кириллицей и пробелами в имени.
// Браузер кодирует путь (Латипко.webp → %D0%9B%D0%B0...), сервер обязан
// декодировать его перед поиском файла — иначе фото босса даёт 404.
// Плюс проверяем, что защита от выхода за public/ не сломалась.
const assert = require('assert');
const path = require('path'), fs = require('fs');
const ROOT = process.cwd();
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

console.log('\n[1] Код статики декодирует URL-путь');
const src = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
ok('есть decodeURIComponent для пути', /decodeURIComponent\(rel\)/.test(src));
ok('декодирование обёрнуто в try (битые %-последовательности не роняют)', /try \{ rel = decodeURIComponent\(rel\); \} catch/.test(src));
ok('декодирование ДО сборки пути к файлу', src.indexOf('decodeURIComponent(rel)') < src.indexOf('path.join(PUBLIC_DIR, rel)'));

console.log('\n[2] Защита от обхода каталога сохранена');
ok('проверка выхода за PUBLIC_DIR на месте', /if \(!filePath\.startsWith\(PUBLIC_DIR\)\)/.test(src));
ok('нулевой байт отклоняется', /rel\.indexOf\('\\0'\) !== -1/.test(src));
ok('проверка идёт ПОСЛЕ декодирования (иначе обход через %2e%2e)',
   src.indexOf('decodeURIComponent(rel)') < src.indexOf('filePath.startsWith(PUBLIC_DIR)'));

console.log('\n[3] Путь с кириллицей проходит валидацию ссылки на фото');
const we = fs.readFileSync(path.join(ROOT, 'src/services/worldEvent.ts'), 'utf8');
ok('sanitizeImage принимает /img/... без ограничений на алфавит', /\^\\\/\(img\|images\|uploads\)\\\//.test(we));

console.log('\n[4] Папка для фото боссов существует');
ok('public/img/bosses создана', fs.existsSync(path.join(ROOT, 'public/img/bosses')));

console.log('\n[5] Админ видит список реальных файлов на сервере');
const we2 = require('../dist/src/services/worldEvent');
const lst = we2.adminListImages();
ok('эндпоинт отдаёт каталог', lst.dir === 'public/img/bosses');
ok('сообщает, существует ли папка', typeof lst.exists === 'boolean');
ok('files — массив с name и url', Array.isArray(lst.files));
// Кладём временный файл и проверяем, что он появляется в списке
const tmp = path.join(ROOT, 'public/img/bosses/__test_boss.webp');
fs.copyFileSync(path.join(ROOT, 'public/img/instructors/volkov.webp'), tmp);
const lst2 = we2.adminListImages();
ok('новый файл виден в списке', lst2.files.some(f => f.name === '__test_boss.webp'));
ok('url формируется как /img/bosses/имя', lst2.files.find(f => f.name === '__test_boss.webp').url === '/img/bosses/__test_boss.webp');
fs.unlinkSync(tmp);
ok('README не попадает в список (только картинки)', !we2.adminListImages().files.some(f => /readme/i.test(f.name)));

console.log('\n[6] Админка показывает список и подставляет путь');
const adm = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok('админка запрашивает список файлов', /\/api\/admin\/event\/images/.test(adm));
ok('есть предупреждение о пустой папке (файл не задеплоен)', /не доехал/.test(adm));
ok('клик по файлу подставляет путь в поле', /boss-img-pick/.test(adm));

console.log(`\n✅ Все проверки пройдены: ${passed}`);
process.exit(0);
