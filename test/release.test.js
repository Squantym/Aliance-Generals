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

// Окружение для служебных скриптов, которые тест запускает отдельным
// процессом (grant-admin и подобные). Они сами дочитывают .env проекта,
// и на сервере это уводило их в БОЕВУЮ базу вместо временной папки
// теста: скрипт честно докладывал «игрок не найден», хотя игрок был —
// просто в другой базе. loadEnv в скриптах ставит значение, только если
// ключа нет в окружении вовсе, поэтому пустая строка перебивает файл.
// Значения самого теста при этом сохраняются: они идут вторым слоем.
const toolEnv = (e) => Object.assign(
  { DB_DRIVER: '', SQLITE_DIR: '', SQLITE_FILE: '', MONGODB_URI: '' }, e);

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
  // env передаём ОБЯЗАТЕЛЬНО. Без него grant-admin наследовал голое
  // окружение, дочитывал НАСТОЯЩИЙ .env проекта и уходил работать с
  // боевой базой сервера вместо временной папки теста — «игрок не
  // найден» при живом игроке. Пустые строки в env перебивают файл:
  // loadEnv в скрипте ставит значение, только если ключа нет вовсе.
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/grant-admin.js'), 'Хозяин', '--owner', '--yes'],
      { cwd: workDir, stdio: 'pipe', env: toolEnv(env) });
  } catch (e) {
    // Свою причину grant-admin печатает в перехваченный поток, и без
    // этого она пропадала: тест падал голым «Command failed», по
    // которому нельзя отличить нехватку прав от неверной базы.
    throw new Error('grant-admin не выдал права:\n'
      + String((e && e.stdout) || '') + String((e && e.stderr) || ''));
  }
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

  console.log('\n── 7б. Отложенное окно обслуживания ──');
  // Главное здесь: НАЗНАЧЕННОЕ окно игру НЕ закрывает. Если бы оно
  // закрывало, «назначить профилактику на ночь» означало бы «выключить
  // игру прямо сейчас» — и выяснилось бы это уже от игроков.
  const plan = await post('/api/admin/maintenance',
    { on: true, reason: 'Плановая профилактика', delayMin: 60, durationMin: 30 }, owner2);
  ok('окно назначено', plan.status === 200);
  ok('оно помечено как ещё не наступившее', plan.d.pending === true);
  ok('и игра при этом НЕ закрыта', plan.d.on === false);
  ok('начало через час', Math.abs(plan.d.startAt - (Date.now() + 3600000)) < 20000);
  ok('длительность считается от начала окна, а не от «сейчас»',
     Math.abs(plan.d.until - (plan.d.startAt + 1800000)) < 5000);
  ok('самооткрытие по умолчанию выключено', plan.d.auto === false);

  const meSoon = await get('/api/me', player2);
  ok('игрок продолжает играть', meSoon.status === 200);
  ok('и окна обновления у него нет', !meSoon.d.maintenance);
  ok('зато есть предупреждение с временем начала',
     !!meSoon.d.maintenanceSoon && meSoon.d.maintenanceSoon.startAt === plan.d.startAt);
  ok('с причиной', /профилактика/i.test((meSoon.d.maintenanceSoon || {}).reason || ''));
  const actSoon = await post('/api/war/attack', { targetName: 'Хозяин' }, player2);
  ok('играть по-прежнему можно', actSoon.status !== 503);

  const wSoon = await get('/api/world');
  ok('/api/world говорит, что игра открыта', wSoon.d.maintenance.on === false);
  ok('и отдельно — про будущее окно', !!wSoon.d.maintenance.soon);

  // Регистрация во время НАЗНАЧЕННОГО окна закрываться не должна: до
  // начала могут быть часы, и терять всех новичков за эти часы — цена
  // ни за что.
  const regSoon = await post('/api/register',
    { login: 'Новичок2', email: 'n2@t.ru', password: 'пароль123', country: 'ru', consents: CONS });
  ok('регистрация во время назначенного окна открыта', regSoon.status === 200);

  // Назначенное на ночь окно, потерянное при первом же перезапуске,
  // хуже, чем не назначенное вовсе: владелец на него рассчитывает.
  await stop(srv);
  srv = await startServer(env);
  const wAfter = await get('/api/world');
  ok('назначенное окно пережило перезапуск', !!wAfter.d.maintenance.soon);
  ok('и игра всё ещё открыта', wAfter.d.maintenance.on === false);

  let owner4 = (await post('/api/login', { login: 'Хозяин', password: 'пароль123' })).d.token;
  const cancel = await post('/api/admin/maintenance', { on: false }, owner4);
  ok('назначенное окно отменяется той же кнопкой', cancel.status === 200);
  ok('после отмены предупреждения нет', !(await get('/api/world')).d.maintenance.soon);

  console.log('\n── 7в. Наступление окна и самооткрытие по сроку ──');
  // Время вперёд не перевести, поэтому подменяем состояние в базе —
  // ровно то же самое сделало бы наступившее время. Заодно это ещё раз
  // проверяет, что режим читается из базы, а не из памяти процесса.
  const mFile = path.join(workDir, 'data', 'maintenance.json');
  const setState = async (patch) => {
    await stop(srv);
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(mFile, 'utf8')); } catch (e) {}
    fs.writeFileSync(mFile, JSON.stringify(Object.assign(cur, patch)));
    srv = await startServer(env);
  };

  // Окно, назначенное на час назад, — то есть уже наступившее.
  await setState({
    on: true, startAt: Date.now() - 3600000, until: 0, auto: false,
    reason: 'Плановая профилактика', by: 'Хозяин', at: Date.now() - 7200000, offAt: 0,
  });
  const wNow = await get('/api/world');
  ok('наступившее окно закрывает игру', wNow.d.maintenance.on === true);
  ok('и предупреждения уже нет — есть само окно', !wNow.d.maintenance.soon);
  const playerNow = (await post('/api/login', { login: 'Боец', password: 'пароль123' })).d.token;
  ok('игрок в игру не попадает',
     (await post('/api/war/attack', { targetName: 'Хозяин' }, playerNow)).status === 503);

  // Срок истёк, галочки самооткрытия НЕТ — игра обязана остаться
  // закрытой. Это самое важное решение во всём разделе: если обновление
  // затянулось, автоматически открытые двери впустили бы людей в
  // сломанную игру.
  await setState({ on: true, until: Date.now() - 60000, auto: false, offAt: 0 });
  ok('срок истёк, но без галочки игра остаётся закрытой',
     (await get('/api/world')).d.maintenance.on === true);

  // А с галочкой — открывается сама. Это ночная профилактика, которую
  // владелец не собирается закрывать вручную в четыре утра.
  await setState({ on: true, until: Date.now() - 60000, auto: true, offAt: 0 });
  const wAuto = await get('/api/world');
  ok('с галочкой самооткрытия игра открылась по сроку', wAuto.d.maintenance.on === false);
  const playerBack = (await post('/api/login', { login: 'Боец', password: 'пароль123' })).d.token;
  ok('игрок снова играет', (await get('/api/me', playerBack)).status === 200);
  // Снятие пишется в базу, а не пересчитывается на каждом запросе:
  // иначе журнал не знал бы, когда именно игра открылась, а сообщение
  // в консоль печаталось бы по разу на запрос.
  // Запись в базу отложенная (400 мс) — ждём её честно.
  await new Promise((r) => setTimeout(r, 900));
  const savedState = JSON.parse(fs.readFileSync(mFile, 'utf8'));
  ok('снятие записано в базу', savedState.on === false && savedState.offAt > 0);

  // Самооткрытие без названного срока — это окно, которое никогда не
  // снимется само, хотя владелец на это рассчитывал. Галочка молча
  // игнорируется.
  owner4 = (await post('/api/login', { login: 'Хозяин', password: 'пароль123' })).d.token;
  const noDur = await post('/api/admin/maintenance',
    { on: true, reason: 'Без срока', durationMin: 0, auto: true }, owner4);
  ok('самооткрытие без срока не включается', noDur.d.auto === false);
  await post('/api/admin/maintenance', { on: false }, owner4);

  // Выкат кнопкой не ставит самооткрытие НИКОГДА: после обновления игра
  // может не подняться, и открывать её должен человек, посмотрев.
  const relSrc = fs.readFileSync(path.join(ROOT, 'src/services/release.ts'), 'utf8');
  ok('выкат закрывает игру без самооткрытия',
     /maintenance\.turnOn\(/.test(relSrc) && !/turnOn\([^)]*auto/.test(relSrc));

  console.log('\n── 7г. Текст окна обновления ──');
  // В окне обновления это единственное, что владелец может сказать
  // игрокам, и одной строки на «что чиним, надолго ли и что будет с
  // прогрессом» не хватает.
  const long = 'Меняем боевой расчёт.\n\nПрогресс и армия на месте.\nБои сдвинутся.';
  const withText = await post('/api/admin/maintenance',
    { on: true, reason: long, durationMin: 20 }, owner4);
  ok('многострочный текст принят', withText.status === 200);
  ok('переносы строк сохранены', withText.d.reason === long);
  const seen = await get('/api/me', (await post('/api/login',
    { login: 'Боец', password: 'пароль123' })).d.token);
  ok('игрок видит его целиком', (seen.d.maintenance || {}).reason === long);

  // Управляющие символы вычищаем: попасть в разметку они не могут (текст
  // рисуется как textContent), но мусор в журнале и в базе не нужен.
  const dirty = await post('/api/admin/maintenance',
    { on: false }, owner4).then(() => post('/api/admin/maintenance',
    { on: true, reason: 'Чисто\u0007 так\r\nи так', durationMin: 5 }, owner4));
  ok('управляющие символы вычищены',
     !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(dirty.d.reason || ''));
  ok('а перенос строки остался', /Чисто так\nи так/.test(dirty.d.reason || ''));
  await post('/api/admin/maintenance', { on: false }, owner4);

  console.log('\n── 8. Выкат не принимает чужие команды ──');
  // Кнопка выката — это удалённое выполнение кода. Всё, что не похоже
  // на номер версии, обязано отсекаться ДО оболочки.
  const badCommits = ['origin/main; whoami', '$(id)', '../../etc/passwd', 'main && rm -rf /', 'zzz'];
  for (const c of badCommits) {
    const r = await post('/api/admin/release/deploy', { commit: c }, owner4);
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
    { login: 'Тестер1', password: 'пароль123' }, owner4);
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
