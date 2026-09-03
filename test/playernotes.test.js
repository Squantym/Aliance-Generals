// ═══════════════════════════════════════════════════════════════════
// test/playernotes.test.js — служебные заметки о игроке
//
// Всё, что панель знала о человеке, — это его действия. Того, что знает
// разбиравший сотрудник — «жаловался дважды, оба раза не подтвердилось»,
// «обещал вернуть выданное по ошибке», — записать было негде. Каждый
// следующий разбор начинался с нуля, в том числе у того же сотрудника
// через месяц.
//
// Что стережётся:
//
//  1. ЗАМЕТКА ВИДНА СОТРУДНИКАМ И НЕ ВИДНА ИГРОКУ. Это рабочие пометки,
//     а не переписка с человеком.
//
//  2. ЧУЖУЮ УБИРАЕТ ТОЛЬКО ВЛАДЕЛЕЦ. Иначе запись «выдал себе ресурсы»
//     жила бы ровно до того, как её увидит тот, о ком она.
//
//  3. АВТОР И ВРЕМЯ ПИШУТСЯ ВСЕГДА. Заметка без подписи бесполезна.
//
// Владелец назначается через OWNER_NAME, а не tools/grant-admin.js:
// скрипт требует остановленного сервера, а нам нужен живой.
//
// Запуск: node test/playernotes.test.js  (после npm run build)
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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plnotes-'));
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
  console.log('\n── 1. Заводим владельца и двух игроков ──');
  await makePlayer('Хозяин', 'v@t.ru');
  await makePlayer('Боец', 'b@t.ru');
  await makePlayer('Второй', 'b2@t.ru');
  await wait(900);                 // отложенная запись на диск
  await stop(srv);
  srv = await startServer();       // на старте OWNER_NAME выдаёт права

  const owner = (await post('/api/login', { login: 'Хозяин', password: 'пароль123' })).d.token;
  const player = (await post('/api/login', { login: 'Боец', password: 'пароль123' })).d.token;
  ok('владелец вошёл', !!owner);
  const players = await get('/api/admin/players', owner);
  ok('и получил права', players.status === 200);
  const target = (players.d.players || []).find((x) => x.name === 'Боец');
  ok('игрок для заметок найден', !!target);

  console.log('\n── 2. Заметка записывается и подписывается ──');
  const card0 = await get('/api/admin/player-card/' + target.id, owner);
  ok('в карточке есть место под заметки', Array.isArray(card0.d.notes));
  ok('пока их нет', card0.d.notes.length === 0);

  const add1 = await post('/api/admin/player-note',
    { userId: target.id, text: 'Жаловался дважды, оба раза не подтвердилось.' }, owner);
  ok('заметка принята', add1.status === 200);

  const card1 = await get('/api/admin/player-card/' + target.id, owner);
  ok('она в карточке', card1.d.notes.length === 1);
  ok('текст сохранён целиком', /не подтвердилось/.test(card1.d.notes[0].text));
  ok('автор подписан', card1.d.notes[0].byName === 'Хозяин');
  ok('время записано', card1.d.notes[0].at > 0);

  console.log('\n── 3. Пустую не принимаем ──');
  const empty = await post('/api/admin/player-note', { userId: target.id, text: '   ' }, owner);
  ok('пустая заметка отклонена', empty.status >= 400);

  console.log('\n── 4. Игрок своих заметок не видит ──');
  // Главная проверка файла: это рабочие пометки сотрудников. Утечка их
  // игроку — это не «неудобно», это разговор, которого никто не вёл.
  const me = await get('/api/me', player);
  const meJson = JSON.stringify(me.d);
  ok('в /api/me заметок нет', !/не подтвердилось/.test(meJson));
  const card2 = await get('/api/admin/player-card/' + target.id, player);
  ok('и в чужую панель игрок не попадает', card2.status >= 400);

  console.log('\n── 5. Заметки не путаются между игроками ──');
  const other = (players.d.players || []).find((x) => x.name === 'Второй');
  const cardOther = await get('/api/admin/player-card/' + other.id, owner);
  ok('у другого игрока заметок нет', (cardOther.d.notes || []).length === 0);

  console.log('\n── 6. Убрать можно, и это попадает в журнал ──');
  const noteId = card1.d.notes[0].id;
  const del = await post('/api/admin/player-note/delete',
    { userId: target.id, noteId }, owner);
  ok('заметка убрана', del.status === 200);
  const card3 = await get('/api/admin/player-card/' + target.id, owner);
  ok('её больше нет', (card3.d.notes || []).length === 0);

  const logs = await get('/api/admin/logs?limit=50', owner);
  const texts = JSON.stringify(logs.d);
  ok('запись о заметке в журнале по-русски', /Оставил заметку о игроке/.test(texts));
  ok('и об удалении тоже', /Убрал заметку о игроке/.test(texts));
  ok('сырых адресов в этих строках нет', !/api\/admin\/player-note[^"]*"human/.test(texts));

  await stop(srv); mail.s.close();
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
