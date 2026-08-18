// ═══════════════════════════════════════════════════════════════════
// Фото босса по внешней ссылке: приём адреса, отсев опасных схем и —
// главное — политика безопасности, которая эти картинки пропускает.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-boss-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const we = require(ROOT + '/dist/src/services/worldEvent');
const http = fs.readFileSync(ROOT + '/src/core/http.ts', 'utf8');

async function main() {
await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1');
const own = Object.values(player.users())[0];
own.role = 'owner'; own.isAdmin = true;

const startWith = (image) => {
  try { we.adminStop(own, []); } catch (e) {}
  we.adminStart(own, { name: 'Босс', hp: 1000, goldPool: 1000, image }, []);
  return we.view(own).image;
};

console.log('\n── 1. Какие ссылки принимаются ──');
ok(startWith('https://example.com/boss.png') === 'https://example.com/boss.png',
   'внешняя ссылка с https сохраняется как есть');
ok(startWith('example.com/boss.jpg') === 'https://example.com/boss.jpg',
   'адрес без схемы дополняется https — так удобнее вставлять');
ok(startWith('//cdn.site/boss.webp') === 'https://cdn.site/boss.webp',
   'протокол-относительная ссылка тоже принимается');
ok(startWith('/img/bosses/armada.webp') === '/img/bosses/armada.webp',
   'файл с сервера продолжает работать — старый способ не сломан');

console.log('\n── 2. Что отбрасывается ──');
for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAA', 'vbscript:x', 'file:///etc/passwd']) {
  let rejected = false;
  try { startWith(bad); } catch (e) { rejected = true; }
  ok(rejected, `опасная ссылка отклонена: ${bad.slice(0, 24)}`);
}

console.log('\n── 3. Политика безопасности пропускает картинки ──');
// Главная причина, по которой внешние ссылки не работали: заголовок
// разрешал картинки только со своего домена, и браузер молча их блокировал
// Политика собирается списком строк в securityHeaders() — раньше она
// была одной длинной строкой в объекте заголовков. Регулярка искала
// старую форму и не находила ничего, из-за чего падали разом все
// проверки ниже, включая «картинки с чужих сайтов разрешены».
const cspAt = http.indexOf("h['Content-Security-Policy']");
ok(cspAt > 0, 'заголовок политики задан');
const cspText = http.slice(cspAt, cspAt + 900);
ok(/img-src 'self' data: https: http:/.test(cspText), 'картинки разрешены с любых сайтов');
ok(!/img-src 'self' data:;/.test(cspText), 'прежнее ограничение снято');
ok(/script-src 'self'/.test(cspText), 'скрипты по-прежнему только свои — это и есть защита');
ok(/style-src 'self'/.test(cspText), 'стили тоже');
ok(/connect-src 'self'/.test(cspText), 'запросы к чужим серверам запрещены');
ok(/frame-ancestors 'self'/.test(cspText), 'игру можно встроить только на своём домене');
ok(/frame-ancestors 'none'/.test(cspText), 'панель нельзя встроить вообще — у неё политика строже');

console.log('\n── 4. Показ в игре ──');
const core = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
ok(/class="boss-photo" src="\$\{UI\.esc\(d\.image\)\}"/.test(core), 'фото выводится по сохранённой ссылке');
ok(/onerror="this\.style\.display='none'"/.test(core), 'битая ссылка не ломает экран');
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');
ok(/id="ev-image"/.test(adminJs), 'в панели есть поле для ссылки');
ok(/ev-img-preview/.test(adminJs), 'есть предпросмотр — ошибку видно сразу');
ok(/ссылку на любую картинку из интернета/.test(adminJs), 'в панели объяснено, что файл класть не нужно');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
