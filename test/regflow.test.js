// ═══════════════════════════════════════════════════════════════════
// test/regflow.test.js — регистрация целиком, как её видит игрок
//
// Проверяем весь путь одним куском, без заглушек по дороге:
//
//   «Подписать контракт» → сервер придумал код из 6 цифр → код УЕХАЛ В
//   ПИСЬМО → игрок ввёл его в форме → верный пускает, неверный нет.
//
// Отдельно — тот же путь при УСТАРЕВШЕМ шаблоне письма в базе. Именно
// там всё и ломалось: шаблон, сохранённый до появления кода, живёт в
// базе своей жизнью, письмо уходит с одной кнопкой, а форма требует
// код, которого никто не присылал. Проверки по частям это пропускали:
// код генерировался правильно, письмо отправлялось успешно — а игрок
// всё равно не мог войти.
//
// Код читаем ИЗ ПИСЬМА, а не из базы: иначе проверка не заметит, что до
// игрока он не доехал.
//
// Запуск: node test/regflow.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const PORT = 4500 + Math.floor(Math.random() * 80);
const BASE = 'http://127.0.0.1:' + PORT;
let srv = null, workDir = '';
const letters = [];

// Шаблон, сохранённый до появления кода, — ровно тот, что лежал на
// живом сервере: кнопка, ссылка, ни одной цифры.
const STALE_VERIFY = {
  subject: 'Подтверждение почты — {{игра}}',
  html: '<h2>Привет, {{имя}}!</h2>'
    + '<p>Чтобы активировать аккаунт в игре «{{игра}}», подтвердите почту по кнопке ниже:</p>'
    + '<p><a href="{{ссылка}}">Подтвердить почту</a></p>',
  changedAt: 1, changedBy: 'старая версия',
};

// Двойник почтового сервиса. Формат обязан совпадать с настоящим:
// SMTP.BZ принимает обычную форму, а не JSON, и ключ ждёт заголовком
// Authorization. Двойник на JSON пропустил бы мимо себя весь настоящий
// путь отправки — тест был бы зелёным при неработающей почте.
// В letters складываем письмо в удобном виде: тема и разметка.
function fakeMailService() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const f = new URLSearchParams(b);
        letters.push({
          subject: f.get('subject') || '',
          to: f.get('to') || '',
          body: { html: f.get('html') || '' },
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
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

async function post(p, body) {
  const res = await fetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let d = {}; try { d = await res.json(); } catch (e) {}
  return { status: res.status, d };
}

// Так код ищет игрок: глазами, в тексте письма
const codeInLetter = (msg) => {
  const text = ((msg && msg.body && msg.body.html) || '').replace(/<[^>]*>/g, ' ');
  const m = /\b(\d{6})\b/.exec(text);
  return m ? m[1] : null;
};

// Полный проход: регистрация → код из письма → неверные попытки → вход
async function fullPass(login, mail, label) {
  const before = letters.length;
  const reg = await post('/api/register', { login, email: mail, password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  ok(`${label}: регистрация принята и просит код`, reg.status === 200 && reg.d.needCode === true);
  ok(`${label}: письмо ушло`, letters.length === before + 1);

  const letter = letters[letters.length - 1];
  const code = codeInLetter(letter);
  ok(`${label}: КОД ЕСТЬ В ПИСЬМЕ`, !!code);
  ok(`${label}: письмо ушло на указанный адрес`, letter.to === mail);
  if (!code) return null;

  // Неверный код не пускает и не сжигает верный раньше времени
  const bad = await post('/api/verify-code', { login, code: code === '111111' ? '222222' : '111111' });
  ok(`${label}: неверный код не пускает`, bad.status >= 400 && !bad.d.token);
  ok(`${label}: сказано, сколько попыток осталось`, /Осталось попыток/i.test(bad.d.error || ''));

  const good = await post('/api/verify-code', { login, code });
  ok(`${label}: верный код пускает в игру`, good.status === 200 && !!good.d.token);

  const login2 = await post('/api/login', { login, password: 'пароль123' });
  ok(`${label}: после подтверждения обычный вход работает`, login2.status === 200 && !!login2.d.token);
  return code;
}

(async () => {
  const mail = await fakeMailService();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regflow-'));
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), DISABLE_RATE_LIMIT: '1', DB_DRIVER: '', MONGODB_URI: '', NODE_ENV: 'test',
    SMTPBZ_API_KEY: 'k', SMTPBZ_URL: mail.url,
    EMAIL_FROM: 'Aliance Generals <noreply@aliance-general.ru>',
    APP_URL: 'https://aliance-general.ru',
  });

  console.log('\n── 1. Заводской шаблон: путь целиком ──');
  srv = await startServer(env);
  const c1 = await fullPass('Апчихба', 'a@t.ru', 'заводской');

  console.log('\n── 2. Код у каждого свой ──');
  const c2 = await fullPass('Второй', 'b@t.ru', 'второй игрок');
  ok('коды двух игроков различаются', !!c1 && !!c2 && c1 !== c2);
  ok('код — ровно шесть цифр', /^\d{6}$/.test(c1 || ''));
  ok('и не начинается с нуля — ведущий ноль теряется при копировании',
     !!c1 && c1[0] !== '0' && !!c2 && c2[0] !== '0');

  console.log('\n── 3. УСТАРЕВШИЙ шаблон в базе — тот самый случай ──');
  // Кладём в базу шаблон без {{код}} и перезапускаем сервер: ровно то,
  // что было на живом сервере после давнего нажатия «Сохранить».
  await stop(srv);
  const dbFile = path.join(workDir, 'data', 'mailTemplates.json');
  fs.writeFileSync(dbFile, JSON.stringify({ verify: STALE_VERIFY }, null, 2));
  srv = await startServer(env);

  const stale = await fullPass('Третий', 'c@t.ru', 'устаревший шаблон');
  // Берём именно письмо с кодом: последним лежит уже приветственное,
  // которое уходит вдогонку после успешного подтверждения.
  const staleLetter = [...letters].reverse().find((m) => /Подтверждение почты/i.test(m.subject || ''));
  ok('текст владельца при этом сохранён',
     /подтвердите почту по кнопке ниже/i.test((staleLetter && staleLetter.body || {}).html || ''));
  ok('и код дописан к нему, а не вместо него', !!stale && (staleLetter.body.html || '').includes(stale));

  console.log('\n── 4. Все попытки неверные — доступа нет ──');
  await post('/api/register', { login: 'Четвёртый', email: 'd@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  const real = codeInLetter(letters[letters.length - 1]);
  for (let i = 0; i < 5; i++) await post('/api/verify-code', { login: 'Четвёртый', code: '000000' });
  const afterBurn = await post('/api/verify-code', { login: 'Четвёртый', code: real });
  ok('после пяти ошибок даже верный код не пускает', afterBurn.status >= 400 && !afterBurn.d.token);
  const tryLogin = await post('/api/login', { login: 'Четвёртый', password: 'пароль123' });
  ok('и войти паролем тоже нельзя', tryLogin.status >= 400 && !tryLogin.d.token);

  console.log('\n── 5. Новый код после провала — и вход открывается ──');
  const resent = await post('/api/resend-verification', { login: 'Четвёртый' });
  ok('новое письмо ушло', resent.status === 200);
  const fresh = codeInLetter(letters[letters.length - 1]);
  ok('в нём новый код, и он есть в письме', !!fresh && fresh !== real);
  const finally_ = await post('/api/verify-code', { login: 'Четвёртый', code: fresh });
  ok('новый код пускает в игру', finally_.status === 200 && !!finally_.d.token);

  console.log('\n── 6. Чужой код не подходит ──');
  await post('/api/register', { login: 'Пятый', email: 'e@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  const codeOfFifth = codeInLetter(letters[letters.length - 1]);
  await post('/api/register', { login: 'Шестой', email: 'f@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  const cross = await post('/api/verify-code', { login: 'Шестой', code: codeOfFifth });
  ok('код одного игрока не подтверждает другого', cross.status >= 400 && !cross.d.token);

  await stop(srv); mail.s.close();
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('\n⛔ ' + (e && e.message));
  await stop(srv);
  process.exit(1);
});
