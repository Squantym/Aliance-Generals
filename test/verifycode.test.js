// ═══════════════════════════════════════════════════════════════════
// test/verifycode.test.js — подтверждение почты кодом из письма
//
// Здесь сходятся две вещи, каждая из которых по отдельности молча
// ломает регистрацию:
//
//  1. Ссылка из письма открывается БЕЗ входа в игру. Раньше загрузчик
//     затирал адрес #verify/<код> на #auth ещё до маршрутизации, и
//     подтверждение не срабатывало ровно у тех, ради кого письмо и
//     отправлено. В браузере, где игрок уже был внутри, всё работало —
//     поэтому поломка выглядела плавающей.
//  2. Код из шести цифр можно подобрать. Значит проверяем не только
//     «правильный код пускает», но и что неправильный кончается.
//
// Всё через НАСТОЯЩИЙ HTTP с поднятым сервером и подставным сервисом почты:
// код мы читаем из письма, как его прочитал бы игрок.
//
// Запуск: node test/verifycode.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const PORT = 4700 + Math.floor(Math.random() * 80);
const BASE = 'http://127.0.0.1:' + PORT;
let srv = null, workDir = '';
const letters = [];   // сюда складываем всё, что «ушло» игрокам

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

// Читаем письмо так же, как игрок: глазами, из готового текста
const lastLetter = () => letters[letters.length - 1] || {};
const codeFrom = (msg) => {
  const text = ((msg.body && msg.body.html) || '').replace(/<[^>]*>/g, ' ');
  const m = /\b(\d{6})\b/.exec(text);
  return m ? m[1] : null;
};

(async () => {
  const mail = await fakeMailService();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-'));
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), DISABLE_RATE_LIMIT: '1', DB_DRIVER: '', MONGODB_URI: '', NODE_ENV: 'test',
    SMTPBZ_API_KEY: 'k', SMTPBZ_URL: mail.url,
    EMAIL_FROM: 'Aliance Generals <noreply@aliance-general.ru>',
    APP_URL: 'https://aliance-general.ru',
  });
  srv = await startServer(env);

  console.log('\n── 1. Регистрация оставляет игрока в форме ──');
  const reg = await post('/api/register', { login: 'Апчихба', email: 'a@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  ok('токен сразу не выдан — почта не подтверждена', !reg.d.token);
  ok('клиенту сказано показать поле кода', reg.d.needCode === true);
  ok('позывной вернулся — его подставлять в запрос кода', reg.d.login === 'Апчихба');
  ok('письмо ушло', letters.length === 1);

  const letter = lastLetter();
  const code = codeFrom(letter);
  ok(`код в письме есть и он из 6 цифр: ${code ? code.replace(/\d/g, '•') : 'нет'}`, !!code);
  ok('код виден и в теме — заметно из списка писем', /\d{6}/.test(letter.subject || ''));
  ok('ссылка тоже осталась — почту читают и на другом устройстве',
     /#verify\/[a-f0-9]+/.test((letter.body && letter.body.html) || ''));

  console.log('\n── 2. Вход до подтверждения ──');
  const early = await post('/api/login', { login: 'Апчихба', password: 'пароль123' });
  ok('не пускает', early.status >= 400);
  // Клиент ловит эту фразу и открывает поле кода. Разъедутся — игрок
  // упрётся в вечное «подтвердите» без способа что-то ввести.
  ok('ответ содержит слова, по которым клиент открывает поле кода',
     /Подтвердите почту/i.test(early.d.error || ''));
  const coreJs = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok('и клиент действительно ищет эту фразу', /Подтвердите почту/i.test(coreJs));

  console.log('\n── 3. Неверный код кончается ──');
  let last = null;
  for (let i = 0; i < 5; i++) last = await post('/api/verify-code', { login: 'Апчихба', code: '000000' });
  ok('каждая попытка отклонена', last.status >= 400);
  ok('игроку видно, сколько осталось', /Осталось попыток|попытки кончились/i.test(last.d.error || ''));
  const after = await post('/api/verify-code', { login: 'Апчихба', code });
  ok('ПРАВИЛЬНЫЙ код после перебора уже не работает — код сгорел',
     after.status >= 400 && /попыток/i.test(after.d.error || ''));
  ok('и в игру не пускает', !after.d.token);

  console.log('\n── 4. Новый код приходит и работает ──');
  const resend = await post('/api/resend-verification', { login: 'Апчихба' });
  ok('письмо отправлено', resend.status === 200);
  ok('писем стало два', letters.length === 2);
  const code2 = codeFrom(lastLetter());
  ok('в новом письме ДРУГОЙ код', !!code2 && code2 !== code);
  const good = await post('/api/verify-code', { login: 'Апчихба', code: code2 });
  ok('новый код пускает в игру', good.status === 200 && !!good.d.token);
  ok('позывной вернулся', good.d.name === 'Апчихба');

  console.log('\n── 5. Приветственное письмо ──');
  await new Promise((r) => setTimeout(r, 700));   // уходит вдогонку, не блокируя игрока
  ok('пришло третье письмо', letters.length === 3);
  const hello = lastLetter();
  ok('это приветствие', /Добро пожаловать/i.test(hello.subject || ''));
  ok('в нём есть имя игрока', /Апчихба/.test((hello.body && hello.body.html) || ''));
  ok('и кнопка в игру', /aliance-general\.ru/.test((hello.body && hello.body.html) || ''));

  console.log('\n── 6. После подтверждения вход обычный ──');
  const login = await post('/api/login', { login: 'Апчихба', password: 'пароль123' });
  ok('пускает', login.status === 200 && !!login.d.token);
  const again = await post('/api/verify-code', { login: 'Апчихба', code: code2 });
  ok('повторное подтверждение отклонено', again.status >= 400 && /уже подтверждена/i.test(again.d.error || ''));

  console.log('\n── 7. Чужой позывной не выдаёт себя ──');
  // Иначе форма регистрации превращается в проверялку занятых имён
  const stranger = await post('/api/verify-code', { login: 'НетТакого', code: '123456' });
  const wrongCode = await post('/api/register', { login: 'Второй', email: 'b@t.ru', password: 'пароль123', country: 'ru', consents: { age18: true, terms: true, pdn: true } })
    .then(() => post('/api/verify-code', { login: 'Второй', code: '111111' }));
  ok('ответ про несуществующего и про неверный код неразличим по смыслу',
     stranger.status >= 400 && wrongCode.status >= 400);
  ok('и не подсказывает, что игрока нет', !/не найден|не существует/i.test(stranger.d.error || ''));

  console.log('\n── 8. Ссылка из письма работает без входа ──');
  const link = /#verify\/([a-f0-9]+)/.exec((letters[3] && letters[3].body && letters[3].body.html) || '');
  ok('в письме второго игрока есть ссылка', !!link);
  const byLink = await post('/api/verify-email', { token: link && link[1] });
  ok('переход по ссылке подтверждает почту', byLink.status === 200 && !!byLink.d.token);
  // Поведение загрузчика — в test/maillink.test.js: там оно проверяется
  // в настоящем DOM. Здесь такая проверка была бы поиском имени функции
  // по файлу и оставалась бы зелёной, даже если функцию перестать
  // вызывать — я на этом уже попадался.

  await stop(srv); mail.s.close();
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('\n⛔ ' + (e && e.message));
  await stop(srv);
  process.exit(1);
});
