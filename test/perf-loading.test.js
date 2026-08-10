// ═══════════════════════════════════════════════════════════════════
// Скорость загрузки: ядро отдельно от разделов, ленивые картинки,
// приоритеты и кеширование.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
const httpSrc = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
const swSrc = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
const nginxSrc = fs.readFileSync(path.join(ROOT, 'nginx.example.conf'), 'utf8');

console.log('\n── 1. Первый заход грузит только ядро ──');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
ok(scripts.includes('/js/screens/core.js'), 'ядро экранов подключено сразу');
for (const heavy of ['war', 'social', 'market', 'economy', 'news', 'saboteurs']) {
  ok(!scripts.includes(`/js/screens/${heavy}.js`), `«${heavy}» больше не грузится до старта`);
}
// Сколько весило раньше и сколько сейчас
const sizeOf = (f) => fs.statSync(path.join(ROOT, 'public', f)).size;
const lazy = ['js/screens/war.js', 'js/screens/social.js', 'js/screens/market.js',
              'js/screens/economy.js', 'js/screens/news.js', 'js/screens/saboteurs.js'];
const saved = lazy.reduce((n, f) => n + sizeOf(f), 0);
ok(saved > 250 * 1024, `с первого захода снято ${Math.round(saved / 1024)} КБ исходного кода`);

console.log('\n── 2. Подгрузка по требованию ──');
ok(/_SCREEN_FILES:/.test(app), 'есть карта «экран → файл»');
ok(/_loadScreen\(name\)/.test(app), 'экран подгружается при переходе');
ok(/if \(App\._loadingScreens\[file\]\) return App\._loadingScreens\[file\]/.test(app),
   'повторный переход не качает файл дважды');
ok(/el\.onerror = \(\) => \{/.test(app), 'обрыв связи обрабатывается');
ok(/Не удалось загрузить раздел/.test(app), 'игрок получает понятное сообщение, а не пустой экран');
ok(/async route\(\)/.test(app), 'маршрутизатор ждёт загрузки перед отрисовкой');
// Все экраны из карты должны существовать в своих файлах
const map = /_SCREEN_FILES: \{([\s\S]*?)\n  \},/.exec(app)[1];
const pairs = [...map.matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]);
const manifestMatch = /<script id="screen-assets" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
let screenAssets = {};
try { screenAssets = manifestMatch ? JSON.parse(manifestMatch[1]) : {}; } catch (e) {}
const lazyFiles = [...new Set(pairs.map((x) => x[1]))];
const unversioned = lazyFiles.filter((file) => screenAssets[file] !== `/js/screens/${file}.js`);
ok(manifestMatch && unversioned.length === 0,
   unversioned.length ? `в карте версий отсутствуют: ${unversioned.join(', ')}`
     : 'каждый ленивый файл объявлен в HTML для подстановки контентного хэша');
ok(/el\.src = App\._screenAssetUrl\(file\)/.test(app), 'загрузчик использует версионированный URL');
ok(/el\.href = App\._screenAssetUrl\(file\)/.test(app), 'prefetch использует тот же версионированный URL');
ok(pairs.length >= 20, `в карте ${pairs.length} разделов`);
let missing = [];
for (const [screen, file] of pairs) {
  const src = fs.readFileSync(path.join(ROOT, `public/js/screens/${file}.js`), 'utf8');
  if (!new RegExp(`App\\.screens\\.${screen}\\s*=`).test(src)) missing.push(`${screen}→${file}`);
}
ok(missing.length === 0, missing.length ? `неверные связи: ${missing.join(', ')}` : 'каждый экран лежит в указанном файле');
// Экраны ядра не должны быть в карте — иначе игра полезла бы за файлом зря
const coreSrc = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
const coreScreens = [...coreSrc.matchAll(/App\.screens\.(\w+)\s*=/g)].map((m) => m[1]);
const wrong = coreScreens.filter((n) => pairs.some(([s]) => s === n));
ok(wrong.length === 0, wrong.length ? `экраны ядра попали в карту: ${wrong.join(', ')}` : 'экраны ядра в карту не попали');

console.log('\n── 3. Предзагрузка не мешает медленной связи ──');
ok(/_prefetchScreens\(\)/.test(app), 'популярные разделы подтягиваются заранее');
ok(/if \(conn\.saveData\) return;/.test(app), 'при включённой экономии трафика — не грузим');
ok(/2g\$/.test(app), 'на 2G — тоже не грузим, канал нужен для текущего экрана');
ok(/requestIdleCallback/.test(app), 'делается в простое, а не в момент открытия');
ok(/rel = 'prefetch'/.test(app), 'используется низкий приоритет');

console.log('\n── 4. Приоритеты в шапке страницы ──');
ok(/<link rel="preload" href="\/css\/style\.css" as="style">/.test(html), 'стили просим заранее');
ok(/<link rel="preload" href="\/js\/app\.js" as="script">/.test(html), 'ядро скриптов тоже');
ok(/<link rel="preload" href="\/js\/screens\/core\.js" as="script">/.test(html), 'и экраны ядра');

console.log('\n── 5. Картинки ──');
const imgFiles = ['js/app.js', ...fs.readdirSync(path.join(ROOT, 'public/js/screens')).map((f) => 'js/screens/' + f)];
// Баннеры боя грузятся сразу намеренно: они выскакивают поверх экрана,
// и ленивая загрузка дала бы пустое место в самый заметный момент.
// Всё остальное должно быть ленивым.
let noAttr = 0, lazyCount = 0, eagerCount = 0;
const offenders = [];
for (const f of imgFiles) {
  const src = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  for (const m of src.matchAll(/<img\s[^>]*>/g)) {
    if (/loading="lazy"/.test(m[0])) lazyCount++;
    else if (/loading="eager"/.test(m[0])) eagerCount++;
    else { noAttr++; offenders.push(f + ': ' + m[0].slice(0, 50)); }
  }
}
ok(noAttr === 0, noAttr ? `картинок без указания: ${offenders.join(' | ')}`
   : `${lazyCount} картинок по мере показа, ${eagerCount} баннеров сразу — все размечены`);
ok(lazyCount > eagerCount, `ленивых больше, чем немедленных (${lazyCount} против ${eagerCount})`);

console.log('\n── 6. Сжатие и кеш ──');
ok(/'public, max-age=31536000, immutable'/.test(httpSrc), 'картинки и шрифты кешируются на год');
// no-cache не значит «не кешировать»: копия хранится, но её свежесть
// проверяется запросом, и при 304 не качается ни байта
ok(/: 'no-cache';/.test(httpSrc), 'скрипты перепроверяются, но не качаются заново');
const compressSrc = fs.readFileSync(path.join(ROOT, 'src/core/compress.ts'), 'utf8');
ok(/SW_VERSION\s*=\s*'v2'/.test(swSrc), 'версия Service Worker поднята — старый кеш будет удалён');
ok(/isCode && !url\.searchParams\.has\('v'\)/.test(swSrc) && /networkFirstAsset\(req\)/.test(swSrc),
   'Service Worker не отдаёт неверсионированный JS из вечного cache-first');
ok(/map \$arg_v \$code_cache_control/.test(nginxSrc), 'nginx различает код с хэшем и без хэша');
ok(/location = \/sw\.js[\s\S]*?Cache-Control "no-cache"/.test(nginxSrc),
   'nginx не запирает Service Worker в годовом кеше');
ok(/if \(ae\.includes\('br'\)\) return 'br'/.test(compressSrc), 'предпочитается brotli — он сжимает лучше gzip');
ok(/COMPRESSIBLE/.test(compressSrc), 'сжимается только то, что сжимается');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
