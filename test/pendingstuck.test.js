// ═══════════════════════════════════════════════════════════════════
// test/pendingstuck.test.js — застрявшая незавершённая регистрация
//
// Ловушка, в которую попал владелец на живом сервере:
//   • аккаунт создан, почта не подтверждена — войти нельзя;
//   • позывной и адрес заняты им же — зарегистрироваться заново нельзя;
//   • «прислать письмо заново» отвечает «отправлено», письма нет.
//
// Третий пункт — самый вредный: сервис почты отказывал (кончился лимит),
// а игроку уходило бодрое HTTP 200. Причина оставалась в консоли сервера,
// куда владелец не ходит, поэтому со стороны это выглядело как «игра
// сломалась молча». Проверяем все три и то, что выход теперь есть.
//
// Всё через настоящий HTTP с подставным сервисом почты, который умеет
// отказывать по команде.
//
// Запуск: node test/pendingstuck.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const PORT = 4600 + Math.floor(Math.random() * 80);
const BASE = 'http://127.0.0.1:' + PORT;

// Окружение для служебных скриптов, которые тест запускает отдельным
// процессом (grant-admin и подобные). Они сами дочитывают .env проекта,
// и на сервере это уводило их в БОЕВУЮ базу вместо временной папки
// теста: скрипт честно докладывал «игрок не найден», хотя игрок был —
// просто в другой базе. loadEnv в скриптах ставит значение, только если
// ключа нет в окружении вовсе, поэтому пустая строка перебивает файл.
// Значения самого теста идут последним слоем: worldreset включает
// SQLite намеренно, и обнулять его настройки нельзя.
const toolEnv = (e) => Object.assign({}, process.env,
  { DB_DRIVER: '', SQLITE_DIR: '', SQLITE_FILE: '', MONGODB_URI: '' }, e || {});
let srv = null, workDir = '';
let mailMode = 'ok';
const letters = [];

// Двойник почтового сервиса. Формат обязан совпадать с настоящим:
// SMTP.BZ принимает обычную форму, а не JSON, и ключ ждёт заголовком
// Authorization. Двойник на JSON пропустил бы мимо себя весь настоящий
// путь отправки — тест был бы зелёным при неработающей почте.
// В letters складываем письмо в удобном виде: тема и разметка.
// mailMode переключается по ходу теста: так проверяется отказ ПОСРЕДИ
// работы, а не «сломано с самого начала».
function fakeMailService() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (mailMode === 'fail') {
          // Настоящий вид отказа сервиса: сырой английский текст, который
          // игроку показывать нельзя, а владельцу — обязательно.
          res.writeHead(429);
          res.end(JSON.stringify({ success: false, message: 'Monthly limit reached' }));
          return;
        }
        const f = new URLSearchParams(b);
        letters.push({
          subject: f.get('subject') || '',
          to: f.get('to') || '',
          body: { html: f.get('html') || '' },
        });
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, id: 'j' + letters.length }));
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
const stop = (p) => new Promise((r) => { if (!p) return r(); p.on('exit', () => r()); p.kill('SIGTERM'); setTimeout(r, 3000); });

async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method, headers: { 'Content-Type': 'application/json', 'x-token': token || '' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let d = {}; try { d = await res.json(); } catch (e) {}
  return { status: res.status, d };
}
const post = (p, b, t) => api('POST', p, b || {}, t);
const get = (p, t) => api('GET', p, undefined, t);

const codeFrom = (msg) => {
  const text = ((msg.body && msg.body.html) || '').replace(/<[^>]*>/g, ' ');
  const m = /\b(\d{6})\b/.exec(text);
  return m ? m[1] : null;
};
// Сжигаем код: пять неверных попыток превращают регистрацию в мусор,
// который раньше держал имя и почту навсегда
const burn = async (login) => {
  for (let i = 0; i < 5; i++) await post('/api/verify-code', { login, code: '000000' });
};

(async () => {
  const mail = await fakeMailService();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-'));
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), DISABLE_RATE_LIMIT: '1', DB_DRIVER: '', MONGODB_URI: '', NODE_ENV: 'test',
    // Второй фактор сотрудников проверяется отдельно (test/consents.test.js).
    // Здесь он только мешал бы: тест про недоставку писем, а не про вход.
    STAFF_2FA_REQUIRED: '0',
    SMTPBZ_API_KEY: 'k', SMTPBZ_URL: mail.url,
    EMAIL_FROM: 'Aliance Generals <noreply@aliance-general.ru>',
    APP_URL: 'https://aliance-general.ru',
  });
  srv = await startServer(env);

  console.log('\n── 1. Отказ сервиса почты больше не выглядит успехом ──');
  await post('/api/register', { login: 'Апчихба', email: 'a@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  await burn('Апчихба');                 // чтобы пауза между письмами не мешала
  mailMode = 'fail';
  const bad = await post('/api/resend-verification', { login: 'Апчихба' });
  ok('игрок видит отказ, а не «письмо отправлено»', bad.status >= 400);
  ok('и понятную подсказку, что делать', /не удалось|попробуйте|поддержк/i.test(bad.d.error || ''));
  ok('сырой текст сервиса игроку не показываем', !/Monthly limit/i.test(bad.d.error || ''));

  console.log('\n── 2. Владельцу видна настоящая причина ──');
  // Заводим владельца отдельно, пока почта ещё «работает»
  mailMode = 'ok';
  await post('/api/register', { login: 'Владелец', email: 'own@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  const ownerCode = codeFrom(letters[letters.length - 1]);
  await post('/api/verify-code', { login: 'Владелец', code: ownerCode });
  await stop(srv);
  execFileSync(process.execPath, [path.join(ROOT, 'tools/grant-admin.js'), 'Владелец', '--owner', '--yes'],
    { cwd: workDir, stdio: 'pipe', env: toolEnv(env) });
  srv = await startServer(env);
  const owner = (await post('/api/login', { login: 'Владелец', password: 'пароль123' })).d.token;

  // Именно этот адрес дёргает панель (кнопка «Проверить» в разделе почты)
  const check = await get('/api/admin/email-status', owner);
  ok('панель отдаёт список неподтверждённых', check.status === 200 && Array.isArray(check.d.list));
  const stuck = (check.d.list || []).find((x) => x.name === 'Апчихба');
  ok('застрявший игрок в списке', !!stuck);
  ok(`причина недоставки видна владельцу: «${stuck && stuck.mailError}»`,
     !!stuck && /Monthly limit/i.test(stuck.mailError || ''));
  ok('и когда это было', !!stuck && stuck.mailAt > 0);

  console.log('\n── 3. Выход первый: подтвердить вручную ──');
  const manual = await post('/api/admin/verify-email', { userId: stuck.id }, owner);
  ok('владелец подтверждает почту кнопкой', manual.status === 200);
  const nowIn = await post('/api/login', { login: 'Апчихба', password: 'пароль123' });
  ok('игрок сразу входит', nowIn.status === 200 && !!nowIn.d.token);

  console.log('\n── 4. Выход второй: перерегистрация поверх выдохшейся ──');
  mailMode = 'ok';
  await post('/api/register', { login: 'Заброшен', email: 'z@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  const stillFresh = await post('/api/register', { login: 'Заброшен', email: 'other@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  ok('пока код живой — имя занято, чужую регистрацию не перебить', stillFresh.status >= 400);

  await burn('Заброшен');                // регистрация выдохлась
  const retakeName = await post('/api/register', { login: 'Заброшен', email: 'new@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  ok('после этого имя можно занять заново', retakeName.status === 200 && retakeName.d.needCode === true);

  await burn('Заброшен');
  const retakeMail = await post('/api/register', { login: 'СовсемДругой', email: 'new@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  ok('и адрес почты тоже освобождается', retakeMail.status === 200);

  console.log('\n── 5. Подтверждённый аккаунт забрать нельзя ──');
  // Иначе перерегистрацией можно было бы затереть живого игрока
  const takeLive = await post('/api/register', { login: 'Апчихба', email: 'evil@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  ok('имя живого игрока защищено', takeLive.status >= 400 && /занят/i.test(takeLive.d.error || ''));
  const takeLiveMail = await post('/api/register', { login: 'Злодей', email: 'a@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  ok('и его почта тоже', takeLiveMail.status >= 400 && /используется/i.test(takeLiveMail.d.error || ''));
  const stillWorks = await post('/api/login', { login: 'Апчихба', password: 'пароль123' });
  ok('живой аккаунт цел и пускает', stillWorks.status === 200);

  console.log('\n── 6. Новый код после перерегистрации работает ──');
  const fresh = letters[letters.length - 1];
  const freshCode = codeFrom(fresh);
  ok('письмо с кодом ушло на новый адрес', fresh.to === 'new@t.ru');
  const enter = await post('/api/verify-code', { login: 'СовсемДругой', code: freshCode });
  ok('код пускает в игру', enter.status === 200 && !!enter.d.token);

  await stop(srv); mail.s.close();
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('\n⛔ ' + (e && e.message));
  await stop(srv);
  process.exit(1);
});
