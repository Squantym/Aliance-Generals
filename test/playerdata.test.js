// ═══════════════════════════════════════════════════════════════════
// test/playerdata.test.js — копия данных игрока только по запросу
//
// У игрока в настройках была кнопка «Скачать копию данных». Владелец её
// убрал. Закон даёт право на копию своих данных, но кнопки не требует —
// достаточно ответить на запрос в 10 рабочих дней (Политика, п. 11.1).
// Чтобы право оставалось исполнимым, выгрузка переехала в карточку
// игрока в штабе.
//
// Что стережётся (через настоящий HTTP — права решает слой http.ts):
//  1. У игрока нет ни кнопки, ни адреса самостоятельной выгрузки.
//  2. Выгрузку делает только сотрудник с зоной «Игроки».
//  3. В файле нет секретов: хеша пароля, соли, токенов.
//  4. Каждая выгрузка чужих данных пишется в журнал с именем сотрудника.
//
// Запуск: node test/playerdata.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-playerdata';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STAFF_2FA_REQUIRED = '0';
process.env.PORT = '3493';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = TEST_CWD + '/data';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const BASE = 'http://127.0.0.1:3493';
async function api(m, p, tok, body) {
  const r = await fetch(BASE + p, {
    method: m, headers: { 'Content-Type': 'application/json', 'x-token': tok || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  require(ROOT + '/dist/server.js');
  await new Promise((r) => setTimeout(r, 1800));

  const auth = require(ROOT + '/dist/src/services/auth');
  const player = require(ROOT + '/dist/src/services/player');
  const db = require(ROOT + '/dist/src/core/db');
  const roles = require(ROOT + '/dist/src/services/roles');

  const ownerTok = (await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1')).token;
  const adminTok = (await auth.register('Куратор', 'пароль123', 'a@t.ru', 'ru', '2.2.2.2')).token;
  const comTok   = (await auth.register('Дозорный', 'пароль123', 'c@t.ru', 'ru', '3.3.3.3')).token;
  const playTok  = (await auth.register('Игрок', 'пароль123', 'p@t.ru', 'ru', '4.4.4.4')).token;
  const U = player.users();
  const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
  const own = by('Хозяин'), adm = by('Куратор'), com = by('Дозорный'), P = by('Игрок');
  own.role = 'owner'; own.isAdmin = true;
  adm.role = 'admin'; adm.isAdmin = true;
  com.role = 'moderator';
  const zones = db.load('roleZones', {});
  zones.admin = ['players'];     // карточки игроков — есть
  zones.moderator = ['chat'];    // «Дозор» — только чаты — выгружать нельзя
  db.save('roleZones');

  console.log('\n[1] У игрока самостоятельной выгрузки нет');
  const self = await api('GET', '/api/my-data', playTok);
  ok(self.status === 404, `адрес /api/my-data убран (ответ ${self.status})`);
  const coreJs = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
  ok(!/my-data/.test(coreJs), 'кнопки и обработчика в настройках нет');
  ok(/Копия своих данных[\s\S]{0,200}Права субъекта/.test(coreJs),
     'игроку сказано, как получить копию — по запросу, через Политику');

  console.log('\n[2] Выгрузка — только у сотрудника с зоной «Игроки»');
  const byPlayer = await api('GET', '/api/admin/player-data/' + P.id, playTok);
  ok(byPlayer.status >= 400, `игроку отказано (${byPlayer.status})`);
  const byCom = await api('GET', '/api/admin/player-data/' + P.id, comTok);
  ok(byCom.status >= 400, `сотруднику без «Игроков» отказано (${byCom.status})`);
  const byAdmin = await api('GET', '/api/admin/player-data/' + P.id, adminTok);
  ok(byAdmin.status === 200, 'сотрудник с «Игроками» выгружает');
  const byOwner = await api('GET', '/api/admin/player-data/' + P.id, ownerTok);
  ok(byOwner.status === 200, 'владелец выгружает');
  ok(roles.zoneOfPath('/api/admin/player-data/x') === 'players', 'адрес размечен зоной «Игроки»');

  console.log('\n[3] В копии — данные игрока, но не секреты');
  const d = byAdmin.data;
  ok(d.аккаунт && d.аккаунт.name === 'Игрок', 'позывной в выгрузке');
  ok(d.аккаунт && d.аккаунт.email === 'p@t.ru', 'и почта');
  ok(typeof d.пояснение === 'string' && /по запросу/.test(d.пояснение), 'в файле объяснено, что это и почему без пароля');
  const raw = JSON.stringify(d);
  ok(!/passHash/.test(raw), 'хеша пароля нет');
  ok(!/"salt"/.test(raw), 'соли нет');
  ok(!/emailVerifyToken/.test(raw), 'токена подтверждения нет');
  const missing = await api('GET', '/api/admin/player-data/нет-такого', ownerTok);
  ok(missing.status >= 400, 'несуществующий игрок — понятный отказ');

  console.log('\n[4] Выгрузка пишется в журнал');
  const logs = (await api('GET', '/api/admin/logs?limit=500', ownerTok)).data.logs || [];
  const rec = logs.filter((l) => l.path === '/api/admin/player-data');
  ok(rec.length >= 2, `записей о выгрузке: ${rec.length}`);
  ok(rec.some((l) => l.userId === adm.id), 'видно, какой сотрудник выгружал');

  console.log('\n[5] Кнопка в карточке игрока в штабе');
  const panel = fs.readFileSync(ROOT + '/public/js/admin2/player.js', 'utf8');
  ok(/id="pl-data-copy"/.test(panel), 'кнопка «Копия данных» есть');
  ok(/api\/admin\/player-data\//.test(panel), 'и она зовёт служебный адрес');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  // Выход с паузой: Windows роняет libuv («UV_HANDLE_CLOSING»), если
  // закрыть процесс, пока fetch ещё держит соединение открытым
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
