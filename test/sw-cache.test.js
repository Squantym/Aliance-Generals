// ═══════════════════════════════════════════════════════════════════
// Служебный работник PWA: обновления кода должны доходить до игроков.
//
// Здесь была самая коварная беда проекта: код отдавался «из кеша
// первыми», браузер вообще не спрашивал сервер, и после деплоя игроки
// не видели новых разделов — при этом ничего не выглядело сломанным.
// Заголовки Cache-Control не помогали: работник перехватывает запрос
// раньше них.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const sw = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');

console.log('\n── 1. Код обновляется, а не берётся из кеша ──');
ok(/if \(\/\^\\\/\(\?:js\|css\)\\\/\/\.test\(p\)\) \{\s*\n\s*event\.respondWith\(networkFirst\(req\)\)/.test(sw),
   'скрипты и стили идут сначала в сеть');
ok(!/\(\?:js\|css\|img\|fonts\)[\s\S]{0,80}cacheFirst/.test(sw),
   'прежнее правило «код из кеша» убрано');
ok(/async function networkFirst\(req\)/.test(sw), 'стратегия «сеть, кеш в запасе» реализована');
// В запасе кеш всё-таки остаётся — игра должна открываться без связи
const nf = sw.slice(sw.indexOf('async function networkFirst'), sw.indexOf('async function cacheFirst'));
ok(/catch \(e\)[\s\S]{0,200}caches\.match\(req\)/.test(nf), 'при обрыве связи берётся кеш');
ok(/cache\.put\(req, res\.clone\(\)\)/.test(nf), 'свежий ответ кладётся в кеш — офлайн работает');

console.log('\n── 2. Картинки по-прежнему из кеша ──');
ok(/if \(\/\^\\\/\(\?:img\|fonts\)\\\/\//.test(sw), 'картинки и шрифты отдаются из кеша');
ok(/async function cacheFirst\(req\)/.test(sw), 'стратегия сохранена — трафик не тратится зря');

console.log('\n── 3. Версия кеша ──');
const ver = /SW_VERSION\s*=\s*'([^']+)'/.exec(sw);
ok(!!ver, `версия задана: ${ver && ver[1]}`);
ok(ver[1] !== 'v1', 'версия поднята — прежние кеши будут выброшены');
ok(/caches\.delete\(n\)/.test(sw), 'при смене версии старые кеши удаляются');
ok(/SHELL_CACHE\s*=\s*'ag-shell-' \+ SW_VERSION/.test(sw), 'имя кеша содержит версию');
ok(/Версию НУЖНО поднимать/.test(sw), 'в коде оставлена памятка для будущих обновлений');

console.log('\n── 4. Немедленное вступление в силу ──');
ok(/skipWaiting/.test(sw), 'новая версия не ждёт закрытия вкладок');
ok(/clients\.claim/.test(sw), 'берёт управление сразу');
ok(/p === '\/sw\.js'/.test(sw), 'сам файл работника всегда качается из сети — иначе обновить его нельзя');
ok(/p\.startsWith\('\/api\/'\)/.test(sw), 'запросы игры не кешируются вовсе');

console.log('\n── 5. Заголовки сервера согласованы ──');
const http = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
const cc = http.slice(http.indexOf("if (['.css', '.js'].includes(ext))"), http.indexOf("if (['.woff'"));
ok(/: 'no-cache';/.test(cc), 'сервер тоже требует перепроверки для кода');
ok(!/max-age=86400/.test(cc), 'суточной свежести больше нет');

console.log('\n── 6. Экран войны отдаёт все вкладки ──');
const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
const defs = (war.match(/App\.screens\.war\s*=/g) || []).length;
ok(defs === 1, `экран войны определён один раз (${defs}) — дублей нет`);
for (const [t, label] of [['targets', 'Вторжение'], ['group', 'Групповые бои'],
                          ['arena', 'Арена'], ['sanctions', 'Санкции'], ['event', 'Событие']]) {
  ok(new RegExp(`data-wartab="${t}"`).test(war), `вкладка «${label}» есть в разметке`);
}
ok(/data-wartab="targets">\$\{App\.tabImg\('war_targets', 20\)\}Вторжение/.test(war),
   'вкладка называется «Вторжение»');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
