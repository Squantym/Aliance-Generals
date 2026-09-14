// ═══════════════════════════════════════════════════════════════════
// test/bodysize.test.js — предел размера тела запроса и картинки
//
// Жалоба владельца: «в новостях при выкладке изображения появляется
// какая-то ошибка, связанная с сервером». Причина: тело запроса резалось
// на 200 КБ для всех путей, кроме форума, а картинка новости приходит
// в base64 весом до ~700 КБ. Сервер молча рвал соединение — браузер
// показывал «сбой сети», то есть жалобу «ошибка сервера» на нормальной
// картинке.
//
// Что стережётся:
//  1. Картинка проходит по всем ТРЁМ путям, где её реально шлёт браузер:
//     новость, тема форума, картинка события в панели.
//  2. Обычные маршруты остаются на строгом пределе — поднимать его
//     всем подряд нельзя.
//  3. Превышение отвечает понятным 413, а не обрывом связи: обрыв игрок
//     читает как «сервер сломался» и идёт жаловаться.
//  4. Пределы браузера (App._prepareImage) сверены с пределом сервера:
//     если кто-то поднимет качество картинок, тест покраснеет раньше,
//     чем это увидит игрок.
//
// Запуск: node test/bodysize.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
const path = require('path'), fs = require('fs'), httpc = require('http');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const core = require('../dist/src/core/http');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

const KB = 1024;
const PORT = 4900 + Math.floor(Math.random() * 90);

// Тело нужного размера: содержимое неважно, важна длина
const blob = (bytes) => 'x'.repeat(bytes);

function post(pathname, obj) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(obj);
    const r = httpc.request({
      host: '127.0.0.1', port: PORT, path: pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(b); } catch (e) { parsed = {}; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    // Обрыв соединения — то самое «ошибка сервера», от которого уходим
    r.on('error', (e) => resolve({ status: 0, body: { error: String(e.code || e.message) } }));
    r.write(payload);
    r.end();
  });
}

(async () => {
  await db.init();
  const app = core.createApp();
  // Ровно те адреса, что зовёт браузер. Обработчик подставной: проверяем
  // не сохранение картинки, а то, доходит ли тело до обработчика.
  const echo = (req) => ({ ok: true, len: String(req.body.image || '').length });
  for (const p of ['/api/news/image', '/api/forum/topic', '/api/admin/event/image', '/api/alliance/invite']) {
    app.add('POST', p, echo, { open: true });
  }
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 120));

  console.log('\n[1] Картинка доходит по всем трём путям');
  const news = await post('/api/news/image', { image: blob(700 * KB) });
  eq('новость: картинка в 700 КБ принята', news.status, 200);
  eq('и дошла до обработчика целиком', news.body.len, 700 * KB);
  const forum = await post('/api/forum/topic', { image: blob(600 * KB) });
  eq('форум: картинка в 600 КБ принята', forum.status, 200);
  const event = await post('/api/admin/event/image', { image: blob(300 * KB) });
  eq('событие в панели: картинка в 300 КБ принята', event.status, 200);

  console.log('\n[2] Обычные маршруты остались на строгом пределе');
  const small = await post('/api/alliance/invite', { image: blob(100 * KB) });
  eq('обычный запрос на 100 КБ проходит', small.status, 200);
  const fat = await post('/api/alliance/invite', { image: blob(500 * KB) });
  eq('а на 500 КБ — отказ', fat.status, 413);
  ok('предел в отказе назван: 0.2 МБ', /0[.,]2 МБ/.test(String(fat.body.error)));

  console.log('\n[3] Отказ понятный, а не обрыв связи');
  const huge = await post('/api/news/image', { image: blob(2.5 * 1024 * KB) });
  eq('слишком тяжёлая картинка — 413', huge.status, 413);
  ok('соединение не оборвано — ответ прочитан', huge.status !== 0);
  ok('в ответе объяснение по-русски', /Слишком тяжёлый запрос/.test(String(huge.body.error)));
  ok('и подсказка про картинку', /картинк/i.test(String(huge.body.error)));
  ok('назван предел в 2 МБ', /2 МБ/.test(String(huge.body.error)));
  // После отказа сервер обязан продолжать работать: обрыв рвал сокет
  const after = await post('/api/news/image', { image: blob(10 * KB) });
  eq('следующий запрос проходит как ни в чём не бывало', after.status, 200);

  console.log('\n[4] Пределы браузера сверены с пределом сервера');
  const src = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
  const capLine = /const BODY_CAP_IMAGE = ([^;]+);/.exec(src);
  const plainLine = /const BODY_CAP_PLAIN = ([^;]+);/.exec(src);
  ok('пределы заданы в одном месте', !!capLine && !!plainLine);
  const CAP_IMAGE = eval(capLine[1].split('//')[0]);
  const CAP_PLAIN = eval(plainLine[1].split('//')[0]);
  const routesLine = /const IMAGE_ROUTES = (\/.+\/);/.exec(src);
  ok('список путей с картинками задан регуляркой', !!routesLine);
  const RE = eval(routesLine[1]);
  for (const p of ['/api/news/image', '/api/forum/topic', '/api/admin/event/image']) {
    ok(`путь с картинкой в списке: ${p}`, RE.test(p));
  }
  ok('а обычные маршруты в него не попали', !RE.test('/api/alliance/invite') && !RE.test('/api/battle/attack'));

  // Сколько весит самая тяжёлая картинка, которую отдаёт браузер.
  // App._prepareImage жмёт до maxBytes, но меряет длину data-URL, то
  // есть уже в base64 — коэффициент берём из самого app.js.
  const appJs = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  const infl = Number((/out\.length > maxBytes \* ([\d.]+)/.exec(appJs) || [])[1]);
  ok(`запас на base64 в app.js найден: ×${infl}`, infl > 1 && infl < 2);
  const limits = [];
  for (const f of ['public/js/screens/news.js', 'public/js/screens/social.js']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const re = /maxBytes: (\d+) \* 1024/g;
    let m;
    while ((m = re.exec(t))) limits.push(Number(m[1]) * KB * infl);
  }
  // Картинка события жмётся своим кодом в панели — там уже длина data-URL
  const adminJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  const ev = /out\.length > (\d+) \* 1024/.exec(adminJs);
  ok('предел картинки события найден в панели', !!ev);
  limits.push(Number(ev[1]) * KB);
  const worst = Math.max.apply(null, limits);
  ok(`самая тяжёлая картинка браузера — ${Math.round(worst / KB)} КБ`, worst > 0);
  ok(`сервер принимает её с запасом (предел ${Math.round(CAP_IMAGE / KB)} КБ)`, worst * 1.1 < CAP_IMAGE);
  ok('и обычного предела ей бы не хватило — ради этого правка и делалась', worst > CAP_PLAIN);

  // Сервер режет картинку по весу файла (saveForumImage). Этот предел
  // обязан срабатывать РАНЬШЕ предела тела: иначе вместо понятного
  // «слишком большое» игрок снова получит отказ по размеру запроса.
  const routesSrc = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  const fileLim = /buf\.length > (\d+) \* 1024/.exec(routesSrc);
  ok('предел веса файла на сервере найден', !!fileLim);
  const asBase64 = Number(fileLim[1]) * KB * (4 / 3);
  ok(`файл в ${fileLim[1]} КБ в base64 (${Math.round(asBase64 / KB)} КБ) влезает в тело`, asBase64 < CAP_IMAGE);

  server.close();
  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
