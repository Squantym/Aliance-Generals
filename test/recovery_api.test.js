// Сквозная проверка сверки с копией через настоящий HTTP.
// Сервер поднимаем в этом же процессе — база у теста и у сервера общая.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-recovery-api';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
// Второй фактор сотрудников проверяется отдельно (test/consents.test.js).
// Здесь он мешал бы: тест про резервные копии, а не про вход в панель.
process.env.STAFF_2FA_REQUIRED = '0';
process.env.PORT = '3478';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = TEST_CWD + '/data';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const BASE = 'http://127.0.0.1:3478';
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

  const owner = (await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1')).token;
  await auth.register('Жертва', 'пароль123', 'v@t.ru', 'ru', '2.2.2.2');
  const U = player.users();
  const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
  const own = by('Хозяин'), vic = by('Жертва');
  own.role = 'owner'; own.isAdmin = true;

  // Наполняем жертву добром
  vic.dollars = 5_000_000_000; vic.gold = 27865; vic.level = 300;
  vic.units = { ground_1: { 0: 5000, 1: 200, 2: 50 } };
  vic.buildings = { sklad: 40 };
  db.markUser(vic.id);
  await db.flushAllNow().catch(() => {});

  console.log('\n── 1. Копия базы через админку ──');
  const mk = await api('POST', '/api/admin/db/backup', owner, {});
  ok(mk.status === 200 && mk.data.file, `копия создана: ${mk.data.file ? path.basename(mk.data.file) : '—'}`);
  const st = await api('GET', '/api/admin/db/stats', owner);
  ok((st.data.backups || []).length > 0, `копий в списке: ${(st.data.backups || []).length}`);
  ok(st.data.backups[0].kind === 'manual', `происхождение размечено: ${st.data.backups[0].kind}`);
  ok(!!st.data.logs && st.data.logs.keepDays === 90, `срок хранения журнала: ${st.data.logs && st.data.logs.keepDays} дн.`);
  const file = st.data.backups[0].file;

  console.log('\n── 2. СБОЙ: у игрока всё пропало ──');
  vic.dollars = 0; vic.gold = 0; vic.units = {}; vic.buildings = {};
  db.markUser(vic.id);

  console.log('\n── 3. Сверка через админку ──');
  const r = await api('GET', `/api/admin/db/player-at?file=${encodeURIComponent(file)}&q=Жертва`, owner);
  ok(r.status === 200 && r.data.found, 'игрок найден в копии');
  ok(r.data.player && r.data.player.name === 'Жертва', `имя: ${r.data.player && r.data.player.name}`);
  ok(r.data.existsNow === true, 'сопоставлен с текущим игроком (id восстановлен из копии)');
  ok(r.data.wasBalance.dollars === 5_000_000_000, `было денег: ${r.data.wasBalance.dollars}`);
  ok(r.data.nowBalance.dollars === 0, 'сейчас ноль');
  ok(r.data.diff.dollars === -5_000_000_000, `разница по деньгам: ${r.data.diff.dollars}`);
  ok(r.data.diff.units === -5250, `разница по технике: ${r.data.diff.units}`);
  ok((r.data.lostUnits || []).length > 0, `поимённо пропало видов техники: ${(r.data.lostUnits || []).length}`);
  ok(r.data.lostUnits.some((x) => x.lost === 5000), 'указано точное количество по каждому виду');
  ok((r.data.lostBuildings || []).length > 0, 'пропавшие здания перечислены');

  console.log('\n── 4. Секреты через API не утекают ──');
  const raw = JSON.stringify(r.data);
  ok(!/passHash|salt|resetToken/.test(raw), 'ни хэша, ни соли, ни токенов в ответе');

  console.log('\n── 5. Чужому маршрут закрыт ──');
  const vicTok = (await auth.login('Жертва', 'пароль123', '2.2.2.2')).token;
  const denied = await api('GET', `/api/admin/db/player-at?file=${encodeURIComponent(file)}&q=Жертва`, vicTok);
  ok(denied.status === 403 || denied.status === 401, `обычному игроку отказано: HTTP ${denied.status}`);

  console.log('\n── 6. Подстановка пути отбивается и через HTTP ──');
  const hack = await api('GET', '/api/admin/db/player-at?file=' + encodeURIComponent('../../../etc/passwd') + '&q=Жертва', owner);
  ok(hack.status >= 400, `HTTP ${hack.status} — отклонено`);

  console.log('\n── 7. Журнал пишет баланс при обычной игре ──');
  const vicTok2 = (await auth.login('Жертва', 'пароль123', '2.2.2.2')).token;
  await api('POST', '/api/notifications/read-all', vicTok2, {});
  await new Promise((res) => setTimeout(res, 200));
  const logs = await db.tailLogs(20, vic.id);
  const withBal = logs.filter((l) => l.bal);
  ok(withBal.length > 0, `записей со срезом счёта: ${withBal.length}`);
  ok(withBal[0].bal && typeof withBal[0].bal.d === 'number', 'в срезе есть деньги');
  ok(withBal[0].desc && !/\/api\//.test(withBal[0].desc), `описание человекочитаемое: «${withBal[0].desc}»`);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})();
