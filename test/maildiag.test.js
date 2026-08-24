// ═══════════════════════════════════════════════════════════════════
// test/maildiag.test.js — кнопка «Проверить сервис» в панели
//
// Проверяем не текст на кнопке, а поведение: узнаёт ли игра, что ключ
// выдан на ДРУГОЙ площадке Unisender, и подсказывает ли ровно ту строку
// для .env, которая это чинит.
//
// Ошибка «User with id … not found» читается как поломка аккаунта, из-за
// чего владелец идёт в поддержку и ждёт сутками то, что чинится строчкой.
// Ради этого разбора маршрут и написан — значит и тест про это.
//
// Площадки Unisender подменяем своими: настоящие в тесте дёргать нельзя.
// Запуск: node test/maildiag.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const fsx = require('fs');
const osx = require('os');
const pathx = require('path');
const ROOT = pathx.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const PORT = 4820 + Math.floor(Math.random() * 60);
const BASE = 'http://127.0.0.1:' + PORT;
let workDir = '', srv = null;

// Подставная площадка Unisender: либо признаёт ключ, либо отвечает той
// самой ошибкой про ненайденного пользователя.
function fakePlatform(mode) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (mode === 'ok') {
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'success', domains: [{ domain: 'aliance-general.ru', domain_verified: true }] }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ status: 'error', message: "User with id '8316838' not found" }));
        }
      });
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, url: 'http://127.0.0.1:' + s.address().port }));
  });
}

function startServer(extraEnv) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [pathx.join(ROOT, 'dist/server.js')], {
      cwd: workDir,
      env: Object.assign({}, process.env, {
        PORT: String(PORT), DISABLE_RATE_LIMIT: '1', DB_DRIVER: '', MONGODB_URI: '', NODE_ENV: 'test',
      }, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (b) => { out += String(b); if (/сервер запущен/i.test(out)) resolve(proc); };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (c) => reject(new Error('сервер вышел: ' + c + '\n' + out.slice(-400))));
    setTimeout(() => reject(new Error('сервер не поднялся:\n' + out.slice(-400))), 20000);
  });
}
function stopServer(p) {
  return new Promise((r) => { if (!p) return r(); p.on('exit', () => r()); p.kill('SIGTERM'); setTimeout(r, 3000); });
}

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-token': token || '' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
const post = (p, t, b) => api('POST', p, t, b || {});

(async () => {
  // Первая площадка — чужая, вторая признаёт ключ. Игра по умолчанию
  // ходит на первую: ровно та ситуация, которую разбираем.
  const alien = await fakePlatform('notfound');
  const home = await fakePlatform('ok');

  workDir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'generals-diag-'));
  fsx.mkdirSync(pathx.join(workDir, 'data'), { recursive: true });

  const mailEnv = {
    UNISENDER_API_KEY: 'testkey123',
    UNISENDER_HOSTS: [alien.url, home.url].join(','),
    UNISENDER_URL: alien.url + '/ru/transactional/api/v1/email/send.json',
    EMAIL_FROM: 'Generals <noreply@aliance-general.ru>',
    APP_URL: 'https://aliance-general.ru',
  };

  // Регистрируем БЕЗ почтовых настроек — иначе игра потребует
  // подтверждения по письму, которого в тесте некому доставить.
  // Это не обход, а ровно то поведение, ради которого всё и делается:
  // как только ключ задан, без подтверждения в игру не пускают.
  srv = await startServer({});
  await post('/api/register', null, { login: 'Владелец', email: 'own@test.ru', password: 'пароль123', country: 'ru' });
  await post('/api/register', null, { login: 'Игрок', email: 'pl@test.ru', password: 'пароль123', country: 'ru' });
  await stopServer(srv);
  execFileSync(process.execPath, [pathx.join(ROOT, 'tools/grant-admin.js'), 'Владелец', '--owner', '--yes'],
    { cwd: workDir, stdio: 'pipe' });
  srv = await startServer(mailEnv);

  const owner = (await post('/api/login', null, { login: 'Владелец', password: 'пароль123' })).data.token;

  console.log('\n── 1. Ключ с другой площадки — игра это понимает ──');
  const r = await post('/api/admin/mail/diagnose', owner);
  ok('маршрут существует', r.status === 200);
  ok('рабочая площадка найдена', (r.data.hosts || []).some((h) => h.recognized === true && h.host === home.url));
  ok('чужая помечена чужой', (r.data.hosts || []).some((h) => h.recognized === false && h.host === alien.url));
  ok('видно, куда шлём сейчас', (r.data.hosts || []).some((h) => h.current && h.host === alien.url));
  ok('вердикт объясняет ошибку сервиса', /не туда|другой площадке/i.test(r.data.verdict || ''));
  ok('подсказана готовая строка для .env',
     r.data.fix === `UNISENDER_URL=${home.url}/ru/transactional/api/v1/email/send.json`);
  ok('ok=false, пока адрес не исправлен', r.data.ok === false);
  ok('домены с рабочей площадки показаны',
     (r.data.hosts.find((h) => h.host === home.url).domains || []).some((d) => d.name === 'aliance-general.ru' && d.verified));
  ok('ключ не раскрыт целиком', !JSON.stringify(r.data).includes('testkey123'));

  console.log('\n── 2. Подсказка действительно чинит отправку ──');
  // Тот же ключ, но адрес уже правильный — как после правки .env
  await stopServer(srv);
  srv = await startServer(Object.assign({}, mailEnv, {
    UNISENDER_URL: home.url + '/ru/transactional/api/v1/email/send.json',
  }));
  const owner2 = (await post('/api/login', null, { login: 'Владелец', password: 'пароль123' })).data.token;
  const r2 = await post('/api/admin/mail/diagnose', owner2);
  ok('теперь площадка совпадает', r2.data.ok === true);
  ok('лишних правок не советует', !r2.data.fix);
  // И главное: письмо после этого реально уходит
  const sent = await post('/api/admin/mail/preview', owner2, { id: 'verify', to: 'kto@example.com' });
  ok('образец письма ушёл', sent.status === 200 && sent.data.ok === true);

  console.log('\n── 3. Мусор в ключе виден отдельно ──');
  await stopServer(srv);
  srv = await startServer(Object.assign({}, mailEnv, { UNISENDER_API_KEY: 'ключ с пробелом' }));
  const owner3 = (await post('/api/login', null, { login: 'Владелец', password: 'пароль123' })).data.token;
  const r3 = await post('/api/admin/mail/diagnose', owner3);
  ok('посторонние символы замечены', r3.data.keyDirty === true);

  console.log('\n── 4. Универсальный адрес советуем раньше конкретной площадки ──');
  // Поддержка Unisender подтвердила: есть адрес, который сам направляет
  // запрос на площадку владельца ключа. Он и должен быть советом по
  // умолчанию — прибитая площадка перестанет работать, если аккаунт
  // переедет, и всё повторится сначала.
  await stopServer(srv);
  const universal = await fakePlatform('ok');   // «goapi»: ключ признаёт
  srv = await startServer(Object.assign({}, mailEnv, {
    UNISENDER_ANY_HOST: universal.url,
    // Универсальный СПЕЦИАЛЬНО не первый в списке: иначе «первый рабочий»
    // совпал бы с ним случайно, и проверка ничего бы не проверяла —
    // такой тест зеленеет и при выкинутом приоритете.
    UNISENDER_HOSTS: [alien.url, home.url, universal.url].join(','),
    UNISENDER_URL: alien.url + '/ru/transactional/api/v1/email/send.json',
  }));
  const owner4 = (await post('/api/login', null, { login: 'Владелец', password: 'пароль123' })).data.token;
  const r4 = await post('/api/admin/mail/diagnose', owner4);
  ok('советует именно универсальный адрес',
     r4.data.fix === `UNISENDER_URL=${universal.url}/ru/transactional/api/v1/email/send.json`);
  ok('а не конкретную площадку', !String(r4.data.fix).includes(home.url));
  ok('но говорит, где живёт аккаунт', String(r4.data.verdict).includes(home.url));
  ok('и объясняет причину отказов', /User with id/.test(r4.data.verdict || ''));

  console.log('\n── 5. Права: чужому проверка закрыта ──');
  const plain = (await post('/api/login', null, { login: 'Игрок', password: 'пароль123' })).data.token;
  ok('обычный игрок получает отказ', (await post('/api/admin/mail/diagnose', plain)).status >= 400);

  await stopServer(srv);
  alien.s.close(); home.s.close(); universal.s.close();
  try { fsx.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('\n⛔ ' + (e && e.message));
  await stopServer(srv);
  process.exit(1);
});
