// ═══════════════════════════════════════════════════════════════════
// test/invites-admin.test.js — раздел панели «Приглашения»
//
// Что стережётся:
//  1. По каждому пригласившему: сколько пришло, сколько дошло до 50,
//     сколько заходит, сколько золота он с них получил.
//  2. Раскрытая строка — каждый приглашённый; сколько он потратил, не
//     показывается, только доля пригласившему.
//  3. Поиск по пригласившему, приглашённому и коду; сортировки.
//  4. Удалённый пригласивший и разошедшийся старый счётчик видны.
//  5. Раздел — зона «Игроки»: без неё и игроку — нельзя.
//
// Запуск: node test/invites-admin.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-invites-admin';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STAFF_2FA_REQUIRED = '0';
process.env.ALLOW_UNVERIFIED_EMAIL = '1';
process.env.PORT = '3497';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = TEST_CWD + '/data';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const BASE = 'http://127.0.0.1:3497';
async function api(p, tok) {
  const r = await fetch(BASE + p, { headers: { 'x-token': tok || '' } });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}

(async () => {
  require(ROOT + '/dist/server.js');
  await new Promise((r) => setTimeout(r, 1800));
  const auth = require(ROOT + '/dist/src/services/auth');
  const player = require(ROOT + '/dist/src/services/player');
  const db = require(ROOT + '/dist/src/core/db');
  let n = 0;
  const reg = async (name) => (await auth.register(name, 'пароль123', `inv${++n}@t.ru`, 'ru', '10.2.0.' + n)).token;

  const tOwner = await reg('Хозяин');
  const tMod = await reg('Смотритель');
  const tSup = await reg('Помощник');
  const tPlayer = await reg('Вербовщик');
  await reg('Второй');
  for (const f of ['Друг1', 'Друг2', 'Друг3', 'Новичок']) await reg(f);
  const U = player.users();
  const by = (x) => Object.values(U).find((p) => p.name === x);
  by('Хозяин').role = 'owner'; by('Хозяин').isAdmin = true;
  by('Смотритель').role = 'admin'; by('Смотритель').isAdmin = true;
  by('Помощник').role = 'moderator'; by('Помощник').isAdmin = true;
  const zones = db.load('roleZones', {});
  zones.admin = ['players'];
  zones.moderator = ['moderation'];
  db.save('roleZones');

  const boss = by('Вербовщик'), boss2 = by('Второй');
  boss.refCode = 'GENTEST1'; boss.refCount = 5; boss.refEarnings = 70;
  const now = Date.now();
  const link = (name, who, extra) => Object.assign(by(name), { referredBy: who.id, createdAt: now - 1000 * (10 - name.length) }, extra || {});
  link('Друг1', boss, { level: 55, refLevel50Paid: true, refGoldGiven: 50, lastSeen: now - 3600e3 });
  link('Друг2', boss, { level: 12, refGoldGiven: 20, lastSeen: now - 10 * 86400e3 });
  link('Друг3', boss, { level: 51, refLevel50Paid: true, lastSeen: now - 60e3, createdAt: now });
  link('Новичок', boss2, { level: 3, lastSeen: now });
  // Приглашённый от удалённого игрока
  const orphan = by('Хозяин');
  orphan.referredBy = 'gone_player_1';

  console.log('\n[1] Сводка и строки');
  const r = await api('/api/admin/invites', tOwner);
  ok(r.status === 200, `владелец открывает раздел (${r.status})`);
  const d = r.data;
  ok(d.totals.invited === 5 && d.totals.inviters === 3, `пришло 5, пригласивших 3 (${d.totals.invited}/${d.totals.inviters})`);
  ok(d.totals.reached50 === 2 && d.totals.goldForLevel50 === 200, `до 50 дошли 2, за это 🪙 ${d.totals.goldForLevel50}`);
  ok(d.totals.goldFromPurchases === 70 && d.totals.goldToNewbies === 250, 'доля с покупок 70, новичкам 5×50');
  const row = d.rows[0];
  ok(row.inviter.name === 'Вербовщик' && row.inviter.refCode === 'GENTEST1', 'первым — у кого больше приглашённых');
  ok(row.count === 3 && row.reached50 === 2 && row.active === 2, `пригласил 3, до 50: 2, заходят: 2 (${row.count}/${row.reached50}/${row.active})`);
  ok(row.goldFromPurchases === 70 && row.goldForLevel50 === 200 && row.sharePct >= 10, 'получил 70 с покупок и 200 за 50 уровень');
  ok(row.counter === 5, 'старый счётчик виден, когда разошёлся с живым списком');
  ok(row.friends.map((f) => f.name).join() === 'Друг3,Друг1,Друг2', 'приглашённые — от новых к старым');
  const f1 = row.friends.find((f) => f.name === 'Друг1');
  ok(f1.reached50 && f1.goldToInviter === 50 && f1.level === 55 && f1.id === by('Друг1').id, 'по приглашённому: уровень, 50, доля');
  const keys = JSON.stringify(d);
  ok(!/refGoldBought|spent|priceRub|payments/i.test(keys), 'сколько потратил приглашённый — не показано');
  const gone = d.rows.find((x) => x.inviter.id === 'gone_player_1');
  ok(gone && gone.inviter.name === '(удалён)' && gone.count === 1, 'удалённый пригласивший — отдельной строкой');

  console.log('\n[2] Поиск и сортировка');
  const q = async (s) => (await api('/api/admin/invites?' + s, tOwner)).data;
  ok((await q('q=Друг2')).rows.map((x) => x.inviter.name).join() === 'Вербовщик', 'поиск по приглашённому находит пригласившего');
  ok((await q('q=gentest1')).rows.length === 1, 'поиск по коду');
  ok((await q('q=Второй')).rows.length === 1 && (await q('q=Второй')).rows[0].friends[0].name === 'Новичок', 'поиск по пригласившему');
  ok((await q('q=никого')).rows.length === 0, 'лишнего не находит');
  ok((await q('sort=recent')).rows[0].friends[0].name !== undefined, 'сортировка «недавние» работает');
  const byGold = (await q('sort=gold')).rows;
  ok(byGold[0].inviter.name === 'Вербовщик', 'сортировка по полученному золоту');

  console.log('\n[2б] Адреса и устройства');
  const acc = (ips, devs, extra) => Object.assign({
    ips: Object.fromEntries(ips.map((ip) => [ip, { count: 1, firstAt: now, lastAt: now }])),
    devices: Object.fromEntries(devs.map((d) => [d.key, { key: d.key, label: d.label, fp: d.fp || '', dids: d.dids || [], lastAt: now }])),
    regIp: ips[0], lastIp: ips[ips.length - 1], regDevice: devs[0] && devs[0].label, lastDevice: devs[0] && devs[0].label, lastAt: now,
  }, extra || {});
  boss.access = acc(['5.5.5.5', '10.0.0.7'], [{ key: 'k-boss', label: 'Samsung SM-A536E, Chrome', fp: 'FP-BOSS', dids: ['did-boss-1'] }]);
  // Друг1 — тот же телефон (по метке браузера) и тот же адрес
  by('Друг1').access = acc(['8.8.4.4', '5.5.5.5'], [{ key: 'k-f1', label: 'Samsung SM-A536E, Chrome', fp: 'FP-OTHER', dids: ['did-boss-1'] }]);
  // Друг2 — общий только ЛОКАЛЬНЫЙ адрес и голая строка браузера без отпечатка: это не улики
  by('Друг2').access = acc(['10.0.0.7', '9.9.9.9'], [{ key: 'k-boss', label: 'Samsung SM-A536E, Chrome', fp: '' }]);
  // Друг3 — ничего общего
  by('Друг3').access = acc(['1.2.3.4'], [{ key: 'k-f3', label: 'iPhone, Safari', fp: 'FP-3' }]);
  const m = await q('');
  const mb = m.rows.find((x) => x.inviter.name === 'Вербовщик');
  const F = (n) => mb.friends.find((f) => f.name === n);
  ok(mb.inviter.access && mb.inviter.access.regIp === '5.5.5.5' && /SM-A536E/.test(mb.inviter.access.lastDevice), 'у пригласившего — адрес и устройство');
  ok(F('Друг1').access.lastIp === '5.5.5.5' && F('Друг1').access.regIp === '8.8.4.4' && F('Друг1').access.ipCount === 2, 'у приглашённого — адрес регистрации и последнего входа');
  ok(F('Друг1').matched && F('Друг1').same.ips.join() === '5.5.5.5' && /SM-A536E/.test(F('Друг1').same.devices[0]), 'общий адрес и общее устройство найдены');
  ok(!F('Друг2').matched, 'локальный адрес и строка браузера без отпечатка — не совпадение');
  ok(!F('Друг3').matched && F('Друг3').access.devCount === 1, 'без общего — не отмечен');
  ok(mb.matched === 1 && m.totals.matched === 1, 'совпадений: 1 у пригласившего и 1 всего');
  const onlyM = await q('match=1');
  ok(onlyM.rows.length === 1 && onlyM.rows[0].inviter.name === 'Вербовщик', 'фильтр «только с совпадениями»');
  ok((await q('sort=matched')).rows[0].inviter.name === 'Вербовщик', 'сортировка по совпадениям');
  const newbie = m.rows.find((x) => x.inviter.name === 'Второй').friends[0];
  ok(newbie.access.regIp === '10.2.0.9' && newbie.matched === false, 'адрес с регистрации виден; у пригласившего без входов совпадений нет');

  console.log('\n[3] Доступ');
  ok((await api('/api/admin/invites', tMod)).status === 200, 'сотруднику с зоной «Игроки» — можно');
  ok((await api('/api/admin/invites', tSup)).status >= 400, 'без зоны «Игроки» — нельзя');
  ok((await api('/api/admin/invites', tPlayer)).status >= 400, 'игроку — нельзя');
  // Сервис проверяет права и сам — на случай, если его позовут не из маршрута
  const refs = require(ROOT + '/dist/src/services/referrals');
  let denied = '';
  try { refs.adminInvites(by('Помощник'), {}); } catch (e) { denied = e.message; }
  ok(/Недостаточно прав/.test(denied), 'сервис без зоны «Игроки» отказывает и сам');

  console.log('\n[4] Экран');
  const screen = fs.readFileSync(path.join(ROOT, 'public/js/admin2/invites.js'), 'utf8');
  const shell = fs.readFileSync(path.join(ROOT, 'public/js/admin2/shell.js'), 'utf8');
  ok(/A2\.screens\.invites = render/.test(screen) && /\/api\/admin\/invites/.test(screen), 'экран «Приглашения» в панели');
  ok(/id: 'invites',[^\n]*zone: 'players'/.test(shell), 'пункт меню — в зоне «Игроки»');
  ok(/<script src="\/js\/admin2\/invites\.js"><\/script>/.test(fs.readFileSync(path.join(ROOT, 'public/admin2.html'), 'utf8')), 'и подключён');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 300); });
