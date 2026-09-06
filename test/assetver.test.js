// ═══════════════════════════════════════════════════════════════════
// test/assetver.test.js — правка экрана обязана доходить до игрока
//
// ЧТО БЫЛО НАЙДЕНО. Экраны (public/js/screens/*.js) грузятся не тегом в
// HTML, а из кода: App._loadScreen сам дописывает версию к адресу. И
// дописывал он ОДНУ версию на все экраны сразу — хэш app.js.
//
// Пока app.js не менялся, адрес /js/screens/market.js?v=<хэш app.js>
// оставался прежним. А версионированные адреса отдаются с заголовком
// immutable на ГОД (cacheControlFor в http.ts). То есть браузер вообще
// не спрашивал сервер: правка экрана не доходила ни после перезагрузки,
// ни после переустановки — до следующего года.
//
// Насколько это било: за пять выпусков подряд market.js менялся трижды,
// app.js — ни разу. Три правки подряд не увидел бы ни один игрок,
// открывавший игру до них, и при этом ничего не выглядело сломанным —
// худший вид поломки.
//
// Поэтому здесь проверяется вся цепочка:
//   1. Сервер считает хэш КАЖДОГО экрана по его содержимому.
//   2. Сервер кладёт карту хэшей в страницу.
//   3. Клиент берёт из карты хэш нужного экрана, а не чужой.
//
// Запуск: node test/assetver.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');

process.env.MONGODB_URI = '';
require('./_guard');

const assetHash = require('../dist/src/core/assetHash');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

console.log('\n── 1. У каждого экрана свой хэш ──');
const map = assetHash.screenMap();
const files = fs.readdirSync(path.join(ROOT, 'public/js/screens')).filter((n) => n.endsWith('.js'));
ok(`экранов найдено (${files.length})`, files.length >= 5);
ok('карта покрывает все экраны',
   files.every((n) => typeof map[n.slice(0, -3)] === 'string'));
ok('хэши непустые и короткие',
   Object.values(map).every((h) => /^[0-9a-f]{8}$/.test(h)));

// Хэш обязан считаться по СОДЕРЖИМОМУ файла, а не по имени или времени
const own = (name) => crypto.createHash('md5')
  .update(fs.readFileSync(path.join(ROOT, 'public/js/screens', name + '.js')))
  .digest('hex').slice(0, 8);
const wrong = Object.keys(map).filter((k) => map[k] !== own(k));
ok(wrong.length ? `хэш не сходится с содержимым: ${wrong.join(', ')}` : 'хэш сходится с содержимым файла',
   wrong.length === 0);

console.log('\n── 2. Разные экраны — разные версии ──');
// В этом и была суть поломки: одна версия на всех.
const uniq = new Set(Object.values(map));
ok(`версий столько же, сколько экранов (${uniq.size} из ${Object.keys(map).length})`,
   uniq.size === Object.keys(map).length);

console.log('\n── 3. Правка одного экрана не трогает остальные ──');
// Меняем файл на диске, пересчитываем карту, возвращаем как было.
const victim = path.join(ROOT, 'public/js/screens/market.js');
const backup = fs.readFileSync(victim);
let after = null;
try {
  fs.writeFileSync(victim, Buffer.concat([backup, Buffer.from('\n// проверка версии\n')]));
  after = assetHash.screenMap();
} finally {
  fs.writeFileSync(victim, backup);
}
ok('версия изменённого экрана поменялась', after && after.market !== map.market);
const others = Object.keys(map).filter((k) => k !== 'market');
ok('версии остальных остались прежними',
   after && others.every((k) => after[k] === map[k]));
// И возврат файла возвращает прежний хэш — значит считается содержимое
ok('после возврата файла хэш прежний', assetHash.screenMap().market === map.market);

console.log('\n── 4. Сервер кладёт карту в страницу ──');
const http = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
ok('карта считается при отдаче HTML', /assetHash\.screenMap\(\)/.test(http));
ok('и подставляется в <head>', /window\.__SCREENS=/.test(http));

console.log('\n── 5. Клиент берёт СВОЙ хэш, а не чужой ──');
const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
ok('есть выбор версии по имени экрана', /_screenVer\(file\)/.test(app));
ok('загрузка экрана использует его', /screens\/\$\{file\}\.js\?v=\$\{App\._screenVer\(file\)\}/.test(app));
// Главный сторож: возврат к общей версии — это ровно та поломка
const buildForScreens = /screens\/\$\{file\}\.js\?v=\$\{App\.BUILD\}/.test(app);
ok('общая версия app.js экранам больше не подставляется', !buildForScreens);
ok('запасной вариант на месте (страница из кеша без карты)',
   /return App\.BUILD;/.test(app));

console.log('\n── 6. Сама проверка умеет краснеть ──');
// Раздел 5 держится на разборе исходника — убедимся, что он различает
// правильный и сломанный вариант.
ok('образец со старой версией распознаётся',
   /screens\/\$\{file\}\.js\?v=\$\{App\.BUILD\}/.test('el.src = `/js/screens/${file}.js?v=${App.BUILD}`;'));
ok('образец с новой — нет',
   !/screens\/\$\{file\}\.js\?v=\$\{App\.BUILD\}/.test('el.src = `/js/screens/${file}.js?v=${App._screenVer(file)}`;'));
ok('карта строится из живых файлов, а не из списка в коде',
   Object.keys(map).length === files.length);

console.log('\n── 7. Живой сервер: карта доезжает до страницы ──');
// Разбор исходника показывает намерение, а не результат. Поднимаем
// настоящий сервер из корня проекта (только там есть public/) и
// смотрим, что он реально отдаёт браузеру.
const { spawn } = require("child_process");
const nodeHttp = require("http");

// Свой запрос вместо fetch. Встроенный fetch держит пул соединений,
// который не закрывается по требованию, и process.exit() при живом пуле
// роняет libuv на Windows — тест выходил с кодом 127 при всех зелёных
// проверках. Обычный http-запрос закрывается явно.
function getText(url) {
  return new Promise((resolve) => {
    const req = nodeHttp.get(url, { agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(4000, () => { req.destroy(); resolve(null); });
  });
}

async function liveCheck() {
  const PORT = 3197;
  const hadData = fs.existsSync(path.join(ROOT, "data"));
  // stdio: "ignore" намеренно. С открытыми каналами вывода Node на
  // Windows роняет libuv при выходе («UV_HANDLE_CLOSING»), и тест
  // возвращает код 127 — то есть считается упавшим, хотя все проверки
  // прошли. Зелёный тест, отчитывающийся провалом, бесполезен вдвойне.
  // Готовность ловим опросом порта, а не разбором вывода.
  const srv = spawn(process.execPath, [path.join(ROOT, "dist/server.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DISABLE_RATE_LIMIT: "1",
      DB_DRIVER: "", MONGODB_URI: "", NODE_ENV: "test",
    }),
    stdio: "ignore",
  });
  let html = null;
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 300));
    const r2 = await getText("http://127.0.0.1:" + PORT + "/");
    if (r2 && r2.status === 200) { html = r2.body; break; }
  }
  srv.kill();
  await new Promise((r) => { srv.once("exit", r); setTimeout(r, 3000); });
  // Прибираем за собой: сервер в JSON-режиме заводит data/ в проекте
  if (!hadData) { try { fs.rmSync(path.join(ROOT, "data"), { recursive: true, force: true }); } catch (e) {} }
  return html;
}

(async () => {
  const html = await liveCheck();
  ok('сервер поднялся и отдал страницу', !!html && html.length > 500);
  if (html) {
    const m = /window\.__SCREENS=(\{.*?\});/.exec(html);
    ok('карта версий экранов есть в странице', !!m);
    let mp = null;
    if (m) { try { mp = JSON.parse(m[1]); } catch (e) {} }
    ok('карта разбирается и покрывает экраны', !!mp && Object.keys(mp).length === files.length);
    ok('версия market совпадает с содержимым файла', !!mp && mp.market === own('market'));
    const appTag = /\/js\/app\.js\?v=([0-9a-f]{8})/.exec(html);
    ok('app.js тоже версионирован', !!appTag);
    // Главное: экран и app.js — РАЗНЫЕ версии. Совпадение означало бы
    // возврат к поломке, из-за которой правки не доходили.
    ok('версия экрана НЕ равна версии app.js', !!mp && !!appTag && mp.market !== appTag[1]);
  }

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})();