// ═══════════════════════════════════════════════════════════════════
// test/adminsessions.test.js — новые разделы панели через НАСТОЯЩИЙ HTTP
//
// Здесь проверяется не логика модулей (это делает access2.test.js), а то,
// что адреса панели вообще существуют, закрыты правами и делают то, что
// написано на кнопке. Ровно этот слой ломается тише всего: сервис
// работает, тест зелёный, а кнопка в панели отвечает 404.
//
// Сервер и временную базу поднимаем сами.
// Запуск: node test/adminsessions.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const { spawn, execFileSync } = require('child_process');
const fsx = require('fs');
const osx = require('os');
const pathx = require('path');
const ROOT = pathx.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const PORT = 4930 + Math.floor(Math.random() * 60);
const BASE = 'http://127.0.0.1:' + PORT;
let workDir = '', srv = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [pathx.join(ROOT, 'dist/server.js')], {
      cwd: workDir,
      env: Object.assign({}, process.env, {
        PORT: String(PORT), DISABLE_RATE_LIMIT: '1', DB_DRIVER: '', MONGODB_URI: '', NODE_ENV: 'test',
      }),
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

async function api(method, path, token, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json', 'x-token': token || '' }, headers || {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
const get = (p, t, h) => api('GET', p, t, undefined, h);
const post = (p, t, b, h) => api('POST', p, t, b || {}, h);

const FP_PC = '1920x1080|24bit|1.00|Europe/Moscow|ru-RU|cpu8|mem8|Win32|0tp';
const FP_PHONE = '412x915|24bit|2.63|Europe/Moscow|ru-RU|cpu8|mem4|Linux armv8l|5tp';
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) Chrome/120.0 Mobile Safari/537.36';

(async () => {
  workDir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'generals-sess-'));
  fsx.mkdirSync(pathx.join(workDir, 'data'), { recursive: true });

  srv = await startServer();
  await post('/api/register', null, { login: 'Владелец', email: 'own@test.ru', password: 'пароль123', country: 'ru' });
  await post('/api/register', null, { login: 'Игрок', email: 'pl@test.ru', password: 'пароль123', country: 'ru' });
  await stopServer(srv);
  execFileSync(process.execPath, [pathx.join(ROOT, 'tools/grant-admin.js'), 'Владелец', '--owner', '--yes'],
    { cwd: workDir, stdio: 'pipe' });
  srv = await startServer();

  const owner = (await post('/api/login', null, { login: 'Владелец', password: 'пароль123' })).data.token;

  console.log('\n── 1. Игрок входит с двух устройств ──');
  const pc = (await post('/api/login', null, { login: 'Игрок', password: 'пароль123' }, { 'x-fp': FP_PC, 'user-agent': UA_PC })).data.token;
  const phone = (await post('/api/login', null, { login: 'Игрок', password: 'пароль123' }, { 'x-fp': FP_PHONE, 'user-agent': UA_PHONE })).data.token;
  ok('вход с компьютера дал токен', !!pc);
  ok('вход с телефона дал свой токен', !!phone && phone !== pc);
  // Заходы делаем с теми же заголовками — так учёт увидит оба устройства
  await get('/api/me', pc, { 'x-fp': FP_PC, 'user-agent': UA_PC });
  await get('/api/me', phone, { 'x-fp': FP_PHONE, 'user-agent': UA_PHONE });

  console.log('\n── 2. Карточка входов показывает устройства и сессии ──');
  const list = (await get('/api/admin/players?q=Игрок', owner)).data;
  const target = (list.players || []).find((p) => p.name === 'Игрок');
  ok('игрок найден в панели', !!target);
  const acc = (await get('/api/admin/access/' + target.id, owner)).data;
  ok(`устройств в карточке: ${(acc.devices || []).length}`, (acc.devices || []).length >= 2);
  ok('у каждого устройства есть адреса', (acc.devices || []).every((d) => Array.isArray(d.ips)));
  ok('одно устройство помечено как регистрационное', (acc.devices || []).some((d) => d.isReg));
  // Сессий три, а не две: регистрация тоже выдаёт токен (почта не
  // настроена — аккаунт подтверждается сам и игрок сразу в игре).
  ok(`открытых сессий: ${(acc.sessions || []).length}`, (acc.sessions || []).length === 3);
  ok('у сессии записано устройство', (acc.sessions || []).every((s) => !!s.device));

  console.log('\n── 3. Кто ещё заходил с этого устройства ──');
  const key = acc.devices[0].key;
  const byDev = (await get('/api/admin/by-device?key=' + encodeURIComponent(key), owner)).data;
  ok('ответ содержит список игроков', Array.isArray(byDev.players));
  ok('сам игрок в списке есть', byDev.players.some((p) => p.id === target.id));

  console.log('\n── 4. Закрытие одной сессии ──');
  const one = acc.sessions[0].token;
  const kick1 = await post('/api/admin/sessions/kick', owner, { token: one });
  ok('сессия закрыта', kick1.status === 200 && kick1.data.killed === 1);
  const after = (await get('/api/admin/access/' + target.id, owner)).data;
  ok(`осталось на одну меньше: ${(after.sessions || []).length}`,
     (after.sessions || []).length === (acc.sessions || []).length - 1);
  const dead = await get('/api/me', one, { 'x-fp': FP_PC });
  ok('закрытый токен больше не пускает', dead.status === 401);
  const alive = await get('/api/me', after.sessions[0].token, { 'x-fp': FP_PHONE });
  ok('второе устройство продолжает играть', alive.status === 200);

  console.log('\n── 5. Выброс всех сессий игрока ──');
  const kickAll = await post('/api/admin/sessions/kick', owner, { userId: target.id });
  ok('сессии игрока закрыты', kickAll.status === 200 && kickAll.data.killed >= 1);
  ok('игрок выброшен', (await get('/api/me', after.sessions[0].token)).status === 401);
  ok('сотрудник в панели остался', (await get('/api/me', owner)).status === 200);

  console.log('\n── 6. Журнал безопасности игрока ──');
  const acc2 = (await get('/api/admin/access/' + target.id, owner)).data;
  const kinds = (acc2.security || []).map((s) => s.kind);
  ok(`события записаны: ${kinds.join(', ') || '—'}`, kinds.includes('kicked'));
  ok('вход с нового устройства тоже отмечен', kinds.includes('new_device'));

  console.log('\n── 7. Выброс ВСЕХ ──');
  const p2 = (await post('/api/login', null, { login: 'Игрок', password: 'пароль123' })).data.token;
  ok('игрок снова вошёл', !!p2);
  const all = await post('/api/admin/sessions/kick', owner, { all: true });
  ok(`закрыто всё: ${all.data.killed}`, all.status === 200 && all.data.killed >= 2);
  ok('игрок выброшен', (await get('/api/me', p2)).status === 401);
  ok('сотрудник тоже выброшен — предупреждение в панели честное',
     (await get('/api/me', owner)).status === 401);

  console.log('\n── 8. Права: чужому эти адреса закрыты ──');
  const plainToken = (await post('/api/login', null, { login: 'Игрок', password: 'пароль123' })).data.token;
  ok('обычный игрок не видит сессии', (await get('/api/admin/sessions', plainToken)).status >= 400);
  ok('обычный игрок не может никого выкинуть',
     (await post('/api/admin/sessions/kick', plainToken, { all: true })).status >= 400);
  ok('обычный игрок не видит устройства чужого аккаунта',
     (await get('/api/admin/by-device?key=' + key, plainToken)).status >= 400);
  ok('обычный игрок не правит шаблоны писем',
     (await post('/api/admin/mail/template', plainToken, { id: 'verify', subject: 'x', html: '{{ссылка}}' })).status >= 400);

  console.log('\n── 9. Шаблоны писем через панель ──');
  const owner2 = (await post('/api/login', null, { login: 'Владелец', password: 'пароль123' })).data.token;
  const tpls = await get('/api/admin/mail/templates', owner2);
  ok(`шаблоны отдаются (${(tpls.data.templates || []).length})`,
     tpls.status === 200 && (tpls.data.templates || []).length === 4);
  ok('видно, кому уйдёт рассылка', typeof (tpls.data.audience || {}).ready === 'number');
  const bad = await post('/api/admin/mail/template', owner2, { id: 'verify', subject: 'Тема', html: '<p>без ссылки</p>' });
  ok('шаблон без {{ссылка}} отклонён', bad.status >= 400 && /ссылка/.test(bad.data.error || ''));
  const good = await post('/api/admin/mail/template', owner2,
    { id: 'verify', subject: 'Своя тема', html: '<p>Привет, {{имя}} — <a href="{{ссылка}}">подтвердить</a></p>' });
  ok('правильный шаблон сохраняется', good.status === 200);
  const back = (await get('/api/admin/mail/templates', owner2)).data.templates.find((t) => t.id === 'verify');
  ok('правка вернулась в панель', back.subject === 'Своя тема' && back.isDefault === false);

  await stopServer(srv);
  try { fsx.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('\n⛔ ' + (e && e.message));
  await stopServer(srv);
  process.exit(1);
});
