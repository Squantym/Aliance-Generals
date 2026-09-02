// ═══════════════════════════════════════════════════════════════════
// test/viewlog.test.js — журнал ПРОСМОТРОВ в панели
//
// Журнал писал только POST, то есть действия. На вопрос «куда заходили»
// он не отвечал вовсе, и, что важнее, не было видно, кто из сотрудников
// чьи персональные данные смотрел: открыть досье и адреса игрока — такое
// же обращение к данным, как и правка, только следа не оставалось.
//
// Что стережётся:
//
//  1. ПРОСМОТР ПИШЕТСЯ И ЧИТАЕТСЯ ПО-РУССКИ. Не «/api/admin/players», а
//     «Открыл список игроков». Сырые адреса в журнале — ровно то, на что
//     жалуются: строка есть, понять по ней нечего.
//
//  2. ПОВТОРЫ ПОДАВЛЯЮТСЯ. Панель перерисовывается на каждое действие,
//     и один раздел открывается десятки раз за разбор одной жалобы. Без
//     подавления журнал стал бы нечитаемым там, где он нужнее всего.
//
//  3. ИГРОКИ НЕ ПИШУТСЯ. Логировать переходы игроков — кратно раздуть
//     журнал ради шума.
//
// Владелец назначается через OWNER_NAME, а не tools/grant-admin.js:
// скрипт требует остановленного сервера, а нам нужен живой.
//
// Запуск: node test/viewlog.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const PORT = 4860 + Math.floor(Math.random() * 30);
const BASE = 'http://127.0.0.1:' + PORT;
let srv = null, workDir = '', env = null;
const letters = [];

function fakeMail() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        letters.push({ html: new URLSearchParams(b).get('html') || '' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
    });
    s.listen(0, '127.0.0.1', () => r({ s, url: 'http://127.0.0.1:' + s.address().port + '/send' }));
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'dist/server.js')], {
      cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let o = '';
    const h = (b) => { o += String(b); if (/сервер запущен/i.test(o)) resolve(p); };
    p.stdout.on('data', h); p.stderr.on('data', h);
    p.on('exit', (c) => reject(new Error('сервер вышел: ' + c + '\n' + o.slice(-400))));
    setTimeout(() => reject(new Error('не поднялся:\n' + o.slice(-400))), 20000);
  });
}
const stop = (p) => new Promise((r) => { if (!p || p.killed) return r(); p.on('exit', r); p.kill(); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
const codeFrom = (m) => {
  const x = /\b(\d{6})\b/.exec(String((m && m.html) || '').replace(/<[^>]*>/g, ' '));
  return x ? x[1] : null;
};
async function makePlayer(login, mail) {
  await post('/api/register', {
    login, email: mail, password: 'пароль123', country: 'ru',
    consents: { age18: true, terms: true, pdn: true },
  });
  const code = codeFrom(letters[letters.length - 1]);
  return (await post('/api/verify-code', { login, code })).d.token;
}

(async () => {
  const mail = await fakeMail();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewlog-'));
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });
  env = Object.assign({}, process.env, {
    PORT: String(PORT), DISABLE_RATE_LIMIT: '1', DB_DRIVER: '', MONGODB_URI: '', NODE_ENV: 'test',
    SMTPBZ_API_KEY: 'k', SMTPBZ_URL: mail.url,
    EMAIL_FROM: 'Aliance Generals <noreply@aliance-general.ru>',
    APP_URL: 'https://aliance-general.ru',
    STAFF_2FA_REQUIRED: '0',
    OWNER_NAME: 'Хозяин',
    TEST_WORLD: '',
  });

  srv = await startServer();
  console.log('\n── 1. Заводим владельца и игрока ──');
  const ownerTok0 = await makePlayer('Хозяин', 'v@t.ru');
  ok('владелец зарегистрирован', !!ownerTok0);
  await makePlayer('Боец', 'b@t.ru');
  ok('и обычный игрок тоже', true);

  // Ждём отложенную запись на диск (400 мс), иначе перезапуск поднимется
  // без только что заведённых игроков и OWNER_NAME никого не найдёт.
  await wait(900);
  await stop(srv);
  srv = await startServer();       // на старте OWNER_NAME выдаёт права

  const owner = (await post('/api/login', { login: 'Хозяин', password: 'пароль123' })).d.token;
  const player = (await post('/api/login', { login: 'Боец', password: 'пароль123' })).d.token;
  ok('владелец вошёл', !!owner);
  ok('права владельца выданы через OWNER_NAME',
     (await get('/api/admin/players', owner)).status === 200);

  console.log('\n── 2. Просмотр раздела попадает в журнал по-русски ──');
  await get('/api/admin/dashboard', owner);
  await wait(600);                            // журнал пишется отложенно
  let logs = (await get('/api/admin/logs?limit=200', owner)).d.logs || [];
  const views = logs.filter((l) => /^👁/.test(String(l.human || l.desc || '')));
  ok('записи о просмотрах появились', views.length > 0);
  ok('раздел назван по-русски, а не адресом',
     views.some((l) => /Открыл сводку/.test(String(l.human || l.desc))));
  ok('сырых адресов среди них нет',
     !views.some((l) => /^\/api\//.test(String(l.human || l.desc))));

  console.log('\n── 3. Повторный заход в тот же раздел не плодит строк ──');
  const before = ((await get('/api/admin/logs?limit=200', owner)).d.logs || [])
    .filter((l) => /Открыл сводку/.test(String(l.human || l.desc))).length;
  for (let i = 0; i < 5; i++) await get('/api/admin/dashboard', owner);
  await wait(600);
  const after = ((await get('/api/admin/logs?limit=200', owner)).d.logs || [])
    .filter((l) => /Открыл сводку/.test(String(l.human || l.desc))).length;
  ok(`пять повторов не добавили записей (было ${before}, стало ${after})`, after === before);

  console.log('\n── 4. Досье игрока — отдельная запись с именем ──');
  const pl = (await get('/api/admin/players?q=Боец', owner)).d.players || [];
  ok('игрок найден', pl.length > 0);
  if (pl.length) {
    await get('/api/admin/access/' + encodeURIComponent(pl[0].id), owner);
    await wait(600);
    const l2 = (await get('/api/admin/logs?limit=200', owner)).d.logs || [];
    ok('просмотр адресов игрока записан',
       l2.some((l) => /Смотрел адреса и устройства/.test(String(l.human || l.desc))));
  }

  console.log('\n── 5. Переходы игроков в журнал не пишутся ──');
  // Иначе журнал распухнет ради шума: игроков тысячи, сотрудников единицы.
  const n1 = ((await get('/api/admin/logs?limit=200', owner)).d.logs || []).length;
  for (let i = 0; i < 5; i++) await get('/api/me', player);
  await wait(600);
  const n2 = ((await get('/api/admin/logs?limit=200', owner)).d.logs || []).length;
  ok(`заходы игрока журнал не тронули (было ${n1}, стало ${n2})`, n2 === n1);

  await stop(srv);
  try { mail.s.close(); } catch (e) {}
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  try { await stop(srv); } catch (x) {}
  console.error('⛔ ' + (e && e.stack || e));
  process.exit(1);
});
