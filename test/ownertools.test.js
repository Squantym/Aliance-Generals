// ═══════════════════════════════════════════════════════════════════
// test/ownertools.test.js — две владельческие ручки, которых нет ни у кого
//
//   1) Тихая выдача ресурсов — без единого следа.
//   2) Удаление записей журнала.
//
// Обе проверяются через НАСТОЯЩИЙ HTTP, а не прямым вызовом сервиса, и
// иначе нельзя: «без записи в журнале» обеспечивает не сервис, а слой
// http.ts — он пишет каждый POST авторизованного игрока. Проверка на
// уровне модуля показала бы зелёное при работающей записи.
//
// Что стережётся:
//  • тихая выдача и очистка журнала доступны ТОЛЬКО владельцу — ни
//    администратору с выданными зонами, ни модератору;
//  • после тихой выдачи нет ни записи в журнале, ни снимка «перед
//    выдачей», ни подарочного окна, ни письма, ни строки «Выдано
//    администрацией» в статистике золота игрока;
//  • ресурсы при этом действительно начислены — тихо не значит «никак»;
//  • очистка снимает то и только то, что просили: игрока, срок, всё.
//
// Запуск: node test/ownertools.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-ownertools';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STAFF_2FA_REQUIRED = '0';
process.env.PORT = '3491';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = TEST_CWD + '/data';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const eqZero = (v, n) => ok(!v, `${n} (сейчас ${v})`);

const BASE = 'http://127.0.0.1:3491';
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
  const adminTok = (await auth.register('Помощник', 'пароль123', 'a@t.ru', 'ru', '2.2.2.2')).token;
  const modTok   = (await auth.register('Дозорный', 'пароль123', 'm@t.ru', 'ru', '3.3.3.3')).token;
  await auth.register('Боец', 'пароль123', 'p@t.ru', 'ru', '4.4.4.4');
  await auth.register('Сосед', 'пароль123', 'n@t.ru', 'ru', '5.5.5.5');
  const U = player.users();
  const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
  const own = by('Хозяин'), adm = by('Помощник'), mod = by('Дозорный');
  const P = by('Боец'), N = by('Сосед');
  own.role = 'owner'; own.isAdmin = true;
  adm.role = 'admin'; adm.isAdmin = true;
  mod.role = 'moderator';
  // Помощнику выдаём ВСЕ зоны, какие вообще можно выдать: проверка должна
  // упираться в «владелец», а не в нехватку прав.
  const zonesBox = db.load('roleZones', {});
  zonesBox.admin = roles.zonesOfRole('owner');
  zonesBox.moderator = roles.zonesOfRole('owner');
  db.save('roleZones');

  const logsOf = async (who) => {
    const r = await api('GET', '/api/admin/logs?limit=1000' + (who ? '&userId=' + who : ''), ownerTok);
    return r.data.logs || [];
  };
  const hasPath = (logs, p) => logs.some((l) => String(l.path || '') === p);

  console.log('\n[1] Тихая выдача — только у владельца');
  const denied = await api('POST', '/api/admin/grant-quiet', adminTok, { userId: P.id, gold: 100 });
  ok(denied.status >= 400 && /владельц/i.test(denied.data.error || ''),
     `администратору со всеми зонами отказано: ${denied.data.error}`);
  const denied2 = await api('POST', '/api/admin/grant-quiet', modTok, { userId: P.id, gold: 100 });
  ok(denied2.status >= 400, `«Дозору» отказано: ${denied2.data.error}`);
  ok((P.gold || 0) === 0, 'при отказе ничего не начислено');

  console.log('\n[2] Обычная выдача оставляет следы — это точка отсчёта');
  const beforeHist = db.playerHistory(N.id, 50).length;
  const norm = await api('POST', '/api/admin/grant', ownerTok, { userId: N.id, gold: 500, dollars: 1000 });
  ok(norm.status === 200, 'обычная выдача прошла');
  ok(N.gold === 500, `золото начислено: ${N.gold}`);
  ok(hasPath(await logsOf(''), '/api/admin/grant'), 'запись о выдаче в журнале есть');
  ok(db.playerHistory(N.id, 50).length > beforeHist, 'снимок «перед выдачей» сделан');
  ok((N.pendingGifts || []).length === 1, 'игроку показали подарочное окно');
  ok((N.stats.goldGot.admin || 0) === 500, `в статистике золота источник «администрация»: ${N.stats.goldGot.admin}`);

  console.log('\n[3] Тихая выдача: ресурсы есть, следов нет');
  const histBefore = db.playerHistory(P.id, 50).length;
  const myLogsBefore = (await logsOf(P.id)).length;
  const giftsBefore = (P.pendingGifts || []).length;
  const q = await api('POST', '/api/admin/grant-quiet', ownerTok,
                      { userId: P.id, gold: 777, dollars: 4000, xp: 50, tokens: 3 });
  ok(q.status === 200, 'владелец выдал тихо');
  ok(P.gold === 777, `золото начислено: ${P.gold}`);
  ok(P.dollars >= 4000, `деньги начислены: ${P.dollars}`);
  ok((P.adminTokens || 0) === 3, 'жетоны начислены');
  const all = await logsOf('');
  ok(!hasPath(all, '/api/admin/grant-quiet'), 'записи о тихой выдаче в журнале НЕТ');
  ok(hasPath(all, '/api/admin/grant'), 'при этом журнал жив: обычная выдача в нём осталась');
  ok((await logsOf(P.id)).length === myLogsBefore, 'и у игрока в журнале новых записей не появилось');
  ok(db.playerHistory(P.id, 50).length === histBefore, 'снимка «перед выдачей» не делали');
  ok((P.pendingGifts || []).length === giftsBefore, 'подарочного окна игрок не увидел');
  ok(!(P.stats && P.stats.goldGot && P.stats.goldGot.admin), 'в статистике золота источника «администрация» нет');
  const mail = await api('GET', '/api/notifications', (await auth.login('Боец', 'пароль123', '4.4.4.4')).token);
  const notes = (mail.data.items || mail.data.notifications || []);
  ok(!notes.some((x) => /выдал|подарок/i.test(JSON.stringify(x))), 'письма о выдаче игроку не пришло');

  console.log('\n[4] Очистка журнала — только у владельца');
  const cDenied = await api('POST', '/api/admin/logs/clear', adminTok, { all: true });
  ok(cDenied.status >= 400 && /владелец/i.test(cDenied.data.error || ''),
     `администратору отказано: ${cDenied.data.error}`);
  ok((await logsOf('')).length > 0, 'журнал после отказа на месте');
  const cDenied2 = await api('POST', '/api/admin/logs/clear', modTok, { all: true });
  ok(cDenied2.status >= 400, '«Дозору» отказано');

  console.log('\n[5] Очистка по игроку — чужие записи не трогает');
  // Насыпаем записей от двух игроков
  const nTok = (await auth.login('Сосед', 'пароль123', '5.5.5.5')).token;
  const pTok = (await auth.login('Боец', 'пароль123', '4.4.4.4')).token;
  for (let i = 0; i < 3; i++) await api('POST', '/api/status', nTok, { text: 'сосед ' + i });
  for (let i = 0; i < 3; i++) await api('POST', '/api/status', pTok, { text: 'боец ' + i });
  ok((await logsOf(N.id)).length >= 3, `записей соседа: ${(await logsOf(N.id)).length}`);
  ok((await logsOf(P.id)).length >= 3, `записей бойца: ${(await logsOf(P.id)).length}`);
  const cl = await api('POST', '/api/admin/logs/clear', ownerTok, { userId: 'Сосед' });
  ok(cl.status === 200 && cl.data.removed > 0, `снято записей: ${cl.data.removed}`);
  ok((await logsOf(N.id)).length === 0, 'у соседа записей не осталось');
  ok((await logsOf(P.id)).length >= 3, 'записи бойца целы');

  console.log('\n[6] Очистка по сроку — вместе с упакованным хвостом');
  // Записи старше недели живут не строками, а сжатыми сутками в
  // log_packs. Очистка обязана снимать и их: удали она только
  // «горячую» таблицу — журнал выглядел бы очищенным ровно до
  // следующего чтения, которое добирает недостающее из блоков.
  db.appendLog({ at: Date.now() - 10 * 86400000, userId: P.id, userName: 'Боец', path: '/api/старое', desc: 'Старое действие' });
  db.appendLog({ at: Date.now() - 9 * 86400000, userId: N.id, userName: 'Сосед', path: '/api/тоже-старое', desc: 'Старое действие' });
  ok((await logsOf(P.id)).some((l) => l.path === '/api/старое'), 'старая запись легла');
  db.packLogs(20);
  const packedRows = (db.logStats() || {}).packedRows || 0;
  ok(packedRows >= 2, `старое ушло в упакованные блоки: ${packedRows} записей`);
  ok((await logsOf(P.id)).some((l) => l.path === '/api/старое'), 'и по-прежнему читается из блока');
  const old = await api('POST', '/api/admin/logs/clear', ownerTok, { days: 5 });
  ok(old.status === 200 && old.data.removed >= 2, `старше 5 дн. снято: ${old.data.removed}`);
  ok(old.data.packs >= 1, `в том числе упакованных блоков: ${old.data.packs}`);
  eqZero((db.logStats() || {}).packedRows, 'упакованных записей не осталось');
  const afterOld = await logsOf(P.id);
  ok(!afterOld.some((l) => l.path === '/api/старое'), 'старой записи нет');
  ok(!(await logsOf(N.id)).some((l) => l.path === '/api/тоже-старое'), 'и у соседа тоже');
  ok(afterOld.length > 0, 'свежие записи на месте');

  console.log('\n[7] Полная очистка требует подтверждения');
  const empty = await api('POST', '/api/admin/logs/clear', ownerTok, {});
  ok(empty.status >= 400, `пустой запрос журнал не стирает: ${empty.data.error}`);
  ok((await logsOf('')).length > 0, 'журнал на месте');
  const wipe = await api('POST', '/api/admin/logs/clear', ownerTok, { all: true });
  ok(wipe.status === 200 && wipe.data.removed > 0, `очищено записей: ${wipe.data.removed}`);
  const rest = await logsOf('');
  // Сама очистка пишется в журнал: иначе он пустеет молча и по нему не
  // отличить чистку от потери данных.
  ok(rest.length <= 1, `после полной очистки осталось записей: ${rest.length}`);
  ok(rest.every((l) => l.path === '/api/admin/logs/clear'), 'осталась только запись о самой очистке');

  console.log('\n[8] Разметка адресов');
  ok(roles.zoneOfPath('/api/admin/grant-quiet') === 'roles', 'тихая выдача не попала в зону «Ресурсы»');
  ok(roles.zoneOfPath('/api/admin/logs/clear') === 'roles', 'очистка журнала размечена');
  ok(roles.zoneOfPath('/api/admin/grant') === 'economy', 'обычная выдача осталась в «Ресурсах»');
  const adminJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  ok(/g-quiet/.test(adminJs) && /grant-quiet/.test(adminJs), 'кнопка тихой выдачи есть в панели');
  ok(/log-del-all/.test(adminJs) && /logs\/clear/.test(adminJs), 'кнопки очистки журнала есть в панели');
  const ownerGate = adminJs.split('g-quiet')[0].slice(-160);
  ok(/staffRole === 'owner'/.test(ownerGate), 'кнопку тихой выдачи видит только владелец');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
