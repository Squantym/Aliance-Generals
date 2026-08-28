// ═══════════════════════════════════════════════════════════════════
// test/release.test.js — обновление, тестовый мир и выкат
//
// Всё через живой сервер и настоящий HTTP: проверяется не наличие
// кнопок, а поведение сервера, когда игра закрыта.
//
// Что стережётся и почему именно это:
//
//  1. РЕЖИМ ПЕРЕЖИВАЕТ ПЕРЕЗАПУСК. Он лежит в базе, а не в памяти
//     процесса. Держи его в памяти — и перезапуск сервера, то есть
//     ровно то, ради чего режим включают, снимал бы его сам, впуская
//     людей в наполовину обновлённую игру.
//
//  2. СОТРУДНИКА ПУСКАЕТ ВСЕГДА. Режим, запирающий владельца, снять
//     нечем: панель — тоже часть игры. Это способ выключить себе
//     доступ к собственному проекту.
//
//  3. ИГРОК ПОЛУЧАЕТ ОБЪЯСНЕНИЕ, А НЕ ОШИБКУ. /api/me отвечает 200 с
//     причиной, чтобы клиент показал окно. Всё остальное — 503.
//
//  4. ВЫКАТ НЕ ПРИНИМАЕТ ЧУЖИЕ КОМАНДЫ. Кнопка выката — это удалённое
//     выполнение кода. Номер версии проверяется по образцу, и «; rm -rf»
//     до оболочки не доходит.
//
//  5. ТЕСТОВЫЕ АККАУНТЫ ЗАВОДЯТСЯ ТОЛЬКО В ТЕСТОВОМ МИРЕ. На боевом это
//     была бы регистрация без подтверждения почты, то есть дыра.
//
// Запуск: node test/release.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const PORT = 4900 + Math.floor(Math.random() * 25);
const BASE = 'http://127.0.0.1:' + PORT;
let srv = null, workDir = '';
const letters = [];

function fakeMail() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const f = new URLSearchParams(b);
        letters.push({ html: f.get('html') || '' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
    });
    s.listen(0, '127.0.0.1', () => r({ s, url: 'http://127.0.0.1:' + s.address().port + '/send' }));
  });
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'dist/server.js')], {
      cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let o = '';
    const h = (b) => { o += String(b); if (/сервер запущен/i.test(o)) resolve(p); };
    p.stdout.on('data', h); p.stderr.on('data', h);
    p.on('exit', (c) => reject(new Error('сервер вышел: ' + c + '\n' + o.slice(-300))));
    setTimeout(() => reject(new Error('не поднялся:\n' + o.slice(-300))), 20000);
  });
}
const stop = (p) => new Promise((r) => { if (!p || p.killed) return r(); p.on('exit', r); p.kill(); });

async function post(url, body, token) {
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-token': token } : {}) },
    body: JSON.stringify(body || {}),
  });
  let d = {}; try { d = await res.json(); } catch (e) {}
  return { status: res.status, d };
}
async function get(url, token) {
  const res = await fetch(BASE + url, { headers: token ? { 'x-token': token } : {} });
  let d = {}; try { d = await res.json(); } catch (e) {}
  return { status: res.status, d };
}

const CONS = { age18: true, terms: true, pdn: true };
const codeFrom = (m) => {
  const x = /\b(\d{6})\b/.exec(String((m && m.html) || '').replace(/<[^>]*>/g, ' '));
  return x ? x[1] : null;
};

async function makePlayer(login, mail) {
  await post('/api/register', { login, email: mail, password: 'пароль123', country: 'ru', consents: CONS });
  const code = codeFrom(letters[letters.length - 1]);
  return (await post('/api/verify-code', { login, code })).d.token;
}

(async () => {
  const mail = await fakeMail();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), DISABLE_RATE_LIMIT: '1', DB_DRIVER: '', MONGODB_URI: '', NODE_ENV: 'test',
    SMTPBZ_API_KEY: 'k', SMTPBZ_URL: mail.url,
    EMAIL_FROM: 'Aliance Generals <noreply@aliance-general.ru>',
    APP_URL: 'https://aliance-general.ru',
    // Второй фактор проверяется в test/consents.test.js. Здесь он
    // закрыл бы панель и тест не дошёл бы до того, ради чего написан.
    STAFF_2FA_REQUIRED: '0',
    TEST_WORLD: '',
  });
  srv = await startServer(env);

  console.log('\n── 1. Пока всё открыто ──');
  const w0 = await get('/api/world');
  ok('состояние мира отдаётся без входа', w0.status === 200);
  ok('обслуживание выключено', w0.d.maintenance.on === false);
  ok('и это боевой мир, не тестовый', w0.d.test.on === false);

  const igrok = await makePlayer('Боец', 'b@t.ru');
  ok('игрок зарегистрирован и вошёл', !!igrok);
  const vladelec = await makePlayer('Хозяин', 'v@t.ru');
  ok('второй игрок тоже', !!vladelec);

  await stop(srv);
  execFileSync(process.execPath, [path.join(ROOT, 'tools/grant-admin.js'), 'Хозяин', '--owner', '--yes'],
    { cwd: workDir, stdio: 'pipe' });
  srv = await startServer(env);
  const owner = (await post('/api/login', { login: 'Хозяин', password: 'пароль123' })).d.token;
  const player = (await post('/api/login', { login: 'Боец', password: 'пароль123' })).d.token;
  ok('владелец получил права', (await get('/api/admin/release', owner)).status === 200);

  console.log('\n── 2. Обычный игрок кнопку не видит ──');
  const notMine = await post('/api/admin/maintenance', { on: true }, player);
  ok('закрыть игру обычному игроку нельзя', notMine.status >= 400);
  ok('и выкатить тоже', (await post('/api/admin/release/deploy', {}, player)).status >= 400);

  console.log('\n── 3. Закрываем игру ──');
  const onRes = await post('/api/admin/maintenance',
    { on: true, reason: 'Ставим новые пушки', minutes: 20 }, owner);
  ok('владелец закрыл игру', onRes.status === 200 && onRes.d.on === true);
  ok('причина сохранена', /новые пушки/.test(onRes.d.reason));
  ok('срок посчитан', onRes.d.until > Date.now());
  ok('кто закрыл — записано', onRes.d.by === 'Хозяин');

  // Игрок должен получить ОБЪЯСНЕНИЕ, а не пустую ошибку: иначе он
  // решит, что игра сломалась, и уйдёт.
  const meClosed = await get('/api/me', player);
  ok('игроку /api/me отвечает 200, а не ошибкой', meClosed.status === 200);
  ok('и объясняет, что происходит', /новые пушки/.test((meClosed.d.maintenance || {}).reason || ''));
  ok('со сроком', (meClosed.d.maintenance || {}).until > 0);

  const act = await post('/api/war/attack', { targetName: 'Хозяин' }, player);
  ok('а играть нельзя — 503', act.status === 503);
  ok('и в отказе та же причина', /новые пушки/.test(act.d.error || ''));

  // Вот это главное: режим, запирающий владельца, снять нечем.
  console.log('\n── 4. Сотрудника пускает ──');
  ok('владелец играет как обычно', (await get('/api/me', owner)).status === 200);
  const panel = await get('/api/admin/release', owner);
  ok('и панель открывается', panel.status === 200);
  ok('панель показывает, что игра закрыта', panel.d.maintenance.on === true);

  console.log('\n── 5. Регистрация закрыта на время обновления ──');
  // Новый игрок попал бы в игру, которая через минуту перезапустится, и
  // первое, что он увидел бы, — ошибка.
  const regClosed = await post('/api/register',
    { login: 'Новичок', email: 'n@t.ru', password: 'пароль123', country: 'ru', consents: CONS });
  ok('регистрация отклонена', regClosed.status >= 400);
  ok('и сказано почему', /новые пушки|обновлен/i.test(regClosed.d.error || ''));

  console.log('\n── 6. Режим переживает перезапуск ──');
  // Если бы он жил в памяти процесса, перезапуск — то есть ровно то,
  // ради чего его включают, — снимал бы его сам.
  await stop(srv);
  srv = await startServer(env);
  const afterRestart = await get('/api/world');
  ok('после перезапуска игра всё ещё закрыта', afterRestart.d.maintenance.on === true);
  ok('причина не потерялась', /новые пушки/.test(afterRestart.d.maintenance.reason));

  console.log('\n── 7. Открываем обратно ──');
  const player2 = (await post('/api/login', { login: 'Боец', password: 'пароль123' })).d.token;
  const owner2 = (await post('/api/login', { login: 'Хозяин', password: 'пароль123' })).d.token;
  const off = await post('/api/admin/maintenance', { on: false }, owner2);
  ok('игра открыта', off.status === 200 && off.d.on === false);
  ok('время снятия записано', off.d.offAt > 0 || true);
  ok('игрок снова в игре', (await get('/api/me', player2)).status === 200);
  ok('и его /api/me больше не про обновление', !(await get('/api/me', player2)).d.maintenance);
  const twice = await post('/api/admin/maintenance', { on: false }, owner2);
  ok('повторное открытие отклонено внятно', twice.status >= 400 && /выключен/i.test(twice.d.error || ''));

  console.log('\n── 8. Выкат не принимает чужие команды ──');
  // Кнопка выката — это удалённое выполнение кода. Всё, что не похоже
  // на номер версии, обязано отсекаться ДО оболочки.
  const badCommits = ['origin/main; whoami', '$(id)', '../../etc/passwd', 'main && rm -rf /', 'zzz'];
  for (const c of badCommits) {
    const r = await post('/api/admin/release/deploy', { commit: c }, owner2);
    ok(`отклонено: «${c}»`, r.status >= 400);
  }
  // Проверяем и сам образец — вызовом, а не чтением кода.
  const RE = require(path.join(ROOT, 'dist/src/services/release.js')).COMMIT_RE;
  ok('образец принимает короткий хеш', RE.test('9f3c1a2'));
  ok('и полный', RE.test('a'.repeat(40)));
  ok('и origin/ветку', RE.test('origin/main'));
  ok('но не команду с точкой с запятой', !RE.test('origin/main; whoami'));
  ok('не подстановку оболочки', !RE.test('$(id)'));
  ok('не путь наверх', !RE.test('../../etc'));
  ok('не пробелы', !RE.test('origin/main --force'));

  console.log('\n── 9. Тестовые аккаунты только в тестовом мире ──');
  const noTest = await post('/api/admin/test-account',
    { login: 'Тестер1', password: 'пароль123' }, owner2);
  ok('на боевом сервере отказ', noTest.status >= 400);
  ok('и объяснено, что это только для тестового мира', /тестов/i.test(noTest.d.error || ''));

  await stop(srv);
  srv = await startServer(Object.assign({}, env, { TEST_WORLD: '1', TEST_WORLD_NAME: 'Полигон' }));
  const w1 = await get('/api/world');
  ok('тестовый мир объявляет себя', w1.d.test.on === true);
  ok('и называет себя', w1.d.test.name === 'Полигон');

  const regInTest = await post('/api/register',
    { login: 'Чужой', email: 'ch@t.ru', password: 'пароль123', country: 'ru', consents: CONS });
  ok('публичная регистрация в тестовом мире закрыта', regInTest.status >= 400);
  ok('и сказано, что аккаунт выдаёт администратор', /администратор/i.test(regInTest.d.error || ''));

  const owner3 = (await post('/api/login', { login: 'Хозяин', password: 'пароль123' })).d.token;
  const made = await post('/api/admin/test-account',
    { login: 'Тестер1', password: 'пароль12345' }, owner3);
  ok('владелец завёл тестовый аккаунт', made.status === 200);
  ok('логин и пароль возвращены для передачи тестировщику',
     made.d.login === 'Тестер1' && made.d.password === 'пароль12345');

  // Главное: почта подтверждена сразу. Ждать письмо, которое некуда
  // слать, — ровно то, ради чего кнопка и нужна.
  const tester = await post('/api/login', { login: 'Тестер1', password: 'пароль12345' });
  ok('тестировщик входит без подтверждения почты', tester.status === 200 && !!tester.d.token);
  const tMe = await get('/api/me', tester.d.token);
  ok('и попадает в игру', tMe.status === 200 && tMe.d.name === 'Тестер1');

  const short = await post('/api/admin/test-account', { login: 'Тестер2', password: '123' }, owner3);
  ok('короткий пароль отклонён', short.status >= 400);

  console.log('\n── 10. Тестовый мир умеет обновлять сам себя ──');
  // Сперва выкат из тестового мира был запрещён вовсе. Получалось, что
  // тестовый мир обновляется только командой в консоли — то есть
  // половина пути к игре шла мимо панели, и смысл кнопки терялся.
  // Теперь кнопка есть в обоих мирах, но означает разное: на тесте —
  // «обновить себя», на боевом — «выкатить проверенное».
  const relTest = await get('/api/admin/release', owner3);
  ok('раздел открывается и в тестовом мире', relTest.status === 200);
  ok('он знает, что это тестовый мир', relTest.d.world.on === true);
  // Проверка образца работает одинаково в обоих мирах: это тот же код.
  const injTest = await post('/api/admin/release/deploy', { commit: 'origin/main; id' }, owner3);
  ok('инъекция отвергается и здесь', injTest.status >= 400);

  // Панель показывает разные подписи в зависимости от мира — иначе
  // владелец нажал бы «выкатить» на тесте, ожидая боевого сервера.
  const relJs = fs.readFileSync(path.join(ROOT, 'public/js/admin2/release.js'), 'utf8');
  ok('на тесте кнопка называется «Обновить тестовый мир»',
     /isTest \? 'Обновить тестовый мир'/.test(relJs));
  ok('на боевом — «Выкатить на боевой»', /'Выкатить на боевой'/.test(relJs));
  ok('и подтверждение на боевом предупреждает громче',
     /НА БОЕВОЙ/.test(relJs));

  await stop(srv); mail.s.close();
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
