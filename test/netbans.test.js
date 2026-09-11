// ═══════════════════════════════════════════════════════════════════
// test/netbans.test.js — адреса, устройства, сравнение и бан по сети
//
// Через настоящий HTTP: бан проверяет слой http.ts, а адрес и устройство
// приходят заголовками — ровно как у живого игрока за nginx.
//
// Что стережётся:
//  1. Сессия без устройства и адреса дозаполняется первым же запросом —
//     в панели больше нет «неизвестного устройства».
//  2. Сравнение отличает общее устройство от общей сети.
//  3. Бан по адресу закрывает вход и регистрацию с адреса, но не трогает
//     остальных и не запирает сотрудников.
//  4. Бан по устройству ловит по метке браузера с любого адреса и по
//     отпечатку, если метка новая. Честный владелец такой же модели
//     телефона не страдает.
//  5. Адрес и устройство сотрудника забанить нельзя; срок и снятие бана
//     работают; права — по зонам.
//
// Запуск: node test/netbans.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-netbans';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STAFF_2FA_REQUIRED = '0';
process.env.PORT = '3497';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = TEST_CWD + '/data';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Mobile Safari/537.36';
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const FP_PHONE = '1080x2400|24bit|2.75|Europe/Moscow|ru|cpu8|mem8|Linux armv8l|5tp';
const dev = (ip, ua, fp, did) => ({ ip, ua, fp, did });
const D = {
  owner:    dev('8.8.8.8', UA_PC, '1920x1080|24bit|1.00|Europe/Moscow|ru|cpu12|mem8|Win32|0tp', 'didOwner0000001'),
  mod:      dev('9.9.9.9', UA_PC, '1366x768|24bit|1.00|Europe/Moscow|ru|cpu4|mem4|Win32|0tp', 'didModer0000001'),
  violator: dev('5.5.5.5', UA_ANDROID, FP_PHONE, 'didViolator00001'),
  twin:     dev('6.6.6.6', UA_ANDROID, FP_PHONE, 'didViolator00001'),   // тот же телефон, другая сеть
  neighbor: dev('5.5.5.5', UA_PC, '1600x900|24bit|1.00|Europe/Moscow|ru|cpu8|mem8|Win32|0tp', 'didNeighbor00001'),
  stranger: dev('4.4.4.4', UA_ANDROID, FP_PHONE, 'didStranger00001'),    // такая же модель телефона
  passer:   dev('7.7.7.7', UA_PC, '2560x1440|30bit|1.25|Asia/Omsk|ru|cpu16|mem16|Win32|0tp', 'didPasser000001'),
};

const BASE = 'http://127.0.0.1:3497';
async function api(m, p, tok, body, d) {
  const x = d || D.passer;
  const r = await fetch(BASE + p, {
    method: m,
    headers: {
      'Content-Type': 'application/json', 'x-token': tok || '',
      'user-agent': x.ua, 'x-real-ip': x.ip, 'x-fp': x.fp, 'x-did': x.did,
    },
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

  // Внутренний адрес регистрации: внешний был бы у всех общим и сам по себе
  // давал бы «общую сеть» каждой паре — сравнение это честно показало бы
  const reg = async (n, i) => (await auth.register(n, 'пароль123', `nb${i}@t.ru`, 'ru', '10.0.0.' + i)).token;
  const T = {
    owner: await reg('Хозяин', 1), mod: await reg('Смотритель', 2), violator: await reg('Нарушитель', 3),
    twin: await reg('Двойник', 4), neighbor: await reg('Сосед', 5), stranger: await reg('Тёзка', 6),
    passer: await reg('Прохожий', 7),
  };
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const P = {
    owner: by('Хозяин'), mod: by('Смотритель'), violator: by('Нарушитель'), twin: by('Двойник'),
    neighbor: by('Сосед'), stranger: by('Тёзка'), passer: by('Прохожий'),
  };
  P.owner.role = 'owner'; P.owner.isAdmin = true;
  P.mod.role = 'admin'; P.mod.isAdmin = true;
  const zones = db.load('roleZones', {});
  zones.admin = ['moderation', 'security', 'players'];
  db.save('roleZones');
  // Каждый заходит со своего устройства — так учёт узнаёт адреса и метки
  for (const k of Object.keys(T)) await api('GET', '/api/me', T[k], null, D[k]);

  console.log('\n[1] «Неизвестное устройство» дозаполняется');
  const sessions = db.load('sessions', {});
  const bareToken = 'bare' + 'x'.repeat(36);
  sessions[bareToken] = { u: P.passer.id, at: Date.now(), startedAt: Date.now() };   // так выдают переключение персонажа и ссылка из письма
  const before = auth.sessionsOf(P.passer.id).find((s) => s.token === bareToken);
  ok(before && !before.device && !before.ip, 'сессия без данных браузера — устройство и адрес пусты');
  await api('GET', '/api/me', bareToken, null, D.passer);
  const list = (await api('GET', '/api/admin/sessions', T.owner, null, D.owner)).data.rows || [];
  const row = list.find((r) => r.id === P.passer.id);
  const s = row && (row.sessions || []).find((x) => x.token === bareToken);
  ok(s && /Windows/.test(s.device || ''), `после первого запроса устройство видно: «${s && s.device}»`);
  ok(s && s.ip === '7.7.7.7', `и адрес: ${s && s.ip}`);

  console.log('\n[2] Сравнение отличает устройство от сети');
  const cmp = await api('GET', '/api/admin/net-compare?who=' + encodeURIComponent('Нарушитель, Двойник, Сосед'), T.owner, null, D.owner);
  ok(cmp.status === 200, `сравнение открылось (${cmp.status})`);
  const pair = (a, b) => (cmp.data.pairs || []).find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  ok(pair('Нарушитель', 'Двойник').level === 'high', 'Нарушитель и Двойник — общее устройство');
  ok(pair('Нарушитель', 'Сосед').level === 'low', 'Нарушитель и Сосед — только общий адрес');
  ok(pair('Двойник', 'Сосед').level === 'none', 'Двойник и Сосед — пересечений нет');
  ok((cmp.data.sharedDevices || []).some((g) => g.by === 'did' && g.who.length === 2), 'общая метка браузера найдена');
  ok((cmp.data.sharedIps || []).some((x) => x.ip === '5.5.5.5'), 'общий адрес найден');
  ok((await api('GET', '/api/admin/net-compare?who=Нарушитель', T.owner, null, D.owner)).status >= 400, 'одного игрока сравнить нельзя');
  ok((await api('GET', '/api/admin/net-compare?who=Нарушитель,Сосед', T.passer, null, D.passer)).status >= 400, 'игроку сравнение недоступно');
  const groups = (await api('GET', '/api/admin/device-groups', T.owner, null, D.owner)).data.groups || [];
  ok(groups.some((g) => g.players.some((x) => x.name === 'Нарушитель') && g.players.some((x) => x.name === 'Двойник')),
     'в сводке общих устройств есть Нарушитель с Двойником');

  console.log('\n[3] Бан по адресу');
  const pv = await api('GET', '/api/admin/net-ban-preview?type=ip&value=5.5.5.5', T.mod, null, D.mod);
  ok(pv.status === 200 && pv.data.accounts.some((a) => a.name === 'Сосед'), 'перед баном видно, что заденет и Соседа');
  const ipBan = await api('POST', '/api/admin/net-ban', T.mod, { type: 'ip', value: '5.5.5.5', reason: 'Мультоводство', days: 0 }, D.mod);
  ok(ipBan.status === 200, `адрес заблокирован (${ipBan.status} ${ipBan.data.error || ''})`);
  ok((await api('GET', '/api/rewards', T.violator, null, D.violator)).status === 403, 'Нарушитель с адреса не играет');
  const me = await api('GET', '/api/me', T.violator, null, D.violator);
  ok(me.data.banned === true && /адреса/.test(me.data.banInfo.reason) && /Мультоводство/.test(me.data.banInfo.reason),
     'вместо игры — окно с причиной');
  ok((await api('GET', '/api/rewards', T.neighbor, null, D.neighbor)).status === 403, 'Сосед за тем же адресом тоже (панель об этом предупреждала)');
  ok((await api('GET', '/api/rewards', T.passer, null, D.passer)).status === 200, 'Прохожий с другого адреса играет');
  const regBan = await api('POST', '/api/register', '', { login: 'новыйакк', password: 'пароль123', email: 'x@t.ru', country: 'ru' }, D.violator);
  ok(regBan.status >= 400 && /с этого адреса/.test(regBan.data.error || ''), `регистрация с адреса закрыта: «${regBan.data.error}»`);
  // Контроль: с чистого адреса отказ если и будет, то по другой причине
  // (почта, согласия) — иначе проверка выше ловила бы не бан, а их
  const regFree = await api('POST', '/api/register', '', { login: 'новыйакк', password: 'пароль123', email: 'x@t.ru', country: 'ru' }, D.passer);
  ok(!/с этого адреса/.test(regFree.data.error || ''), 'с чистого адреса бан регистрации не упоминается');
  ok((await api('GET', '/api/rewards', T.owner, null, dev('5.5.5.5', UA_PC, D.owner.fp, D.owner.did))).status === 200,
     'владелец с того же адреса не заперт');

  console.log('\n[4] Сотрудника забанить нельзя, права по зонам');
  const staffBan = await api('POST', '/api/admin/net-ban', T.mod, { type: 'ip', value: '8.8.8.8', reason: 'проверка', days: 1 }, D.mod);
  ok(staffBan.status >= 400 && /сотрудник/.test(staffBan.data.error || ''), 'адрес владельца заблокировать нельзя');
  ok((await api('POST', '/api/admin/net-ban', T.passer, { type: 'ip', value: '7.7.7.7', reason: 'x' }, D.passer)).status >= 400, 'игроку банить нельзя');
  ok((await api('POST', '/api/admin/net-ban', T.mod, { type: 'ip', value: '192.168.1.5', reason: 'x' }, D.mod)).status >= 400, 'внутренний адрес не принимается');

  console.log('\n[5] Бан по устройству');
  const unban = await api('POST', '/api/admin/net-unban', T.mod, { id: ipBan.data.ban.id }, D.mod);
  ok(unban.status === 200 && (await api('GET', '/api/rewards', T.neighbor, null, D.neighbor)).status === 200, 'бан адреса снят — Сосед снова играет');
  const acc = (await api('GET', '/api/admin/access/' + P.twin.id, T.owner, null, D.owner)).data;
  const phone = (acc.devices || []).find((v) => /SM-A536E/.test(v.label));
  ok(phone && phone.canBan && phone.dids.indexOf(D.twin.did) >= 0, 'у телефона Двойника записаны отпечаток и метка');
  const devBan = await api('POST', '/api/admin/net-ban', T.mod, { type: 'device', userId: P.twin.id, key: phone.key, reason: 'Обход бана', days: 0 }, D.mod);
  ok(devBan.status === 200, `устройство заблокировано (${devBan.status} ${devBan.data.error || ''})`);
  ok((await api('GET', '/api/rewards', T.twin, null, D.twin)).status === 403, 'Двойник не играет');
  ok((await api('GET', '/api/rewards', T.violator, null, dev('3.3.3.3', UA_ANDROID, FP_PHONE, D.violator.did))).status === 403,
     'Нарушитель с того же телефона не играет и с нового адреса');
  ok((await api('GET', '/api/rewards', T.violator, null, dev('2.2.2.2', UA_ANDROID, FP_PHONE, 'didFreshCleared1'))).status === 403,
     'очистил браузер (новая метка) — узнан по отпечатку');
  ok((await api('GET', '/api/rewards', T.stranger, null, D.stranger)).status === 200,
     'честный владелец такой же модели телефона играет');
  ok((await api('GET', '/api/rewards', T.passer, null, D.passer)).status === 200, 'Прохожий играет');
  P.passer.access.devices.bare = { key: 'bare', label: 'Chrome без отпечатка', fp: '', dids: [], ips: {}, count: 1, lastAt: Date.now() };
  const bareBan = await api('POST', '/api/admin/net-ban', T.mod, { type: 'device', userId: P.passer.id, key: 'bare', reason: 'x' }, D.mod);
  ok(bareBan.status >= 400 && /ни отпечатка, ни метки/.test(bareBan.data.error || ''), 'устройство без отпечатка и метки не банится — задело бы всех');

  console.log('\n[6] Срок и история');
  const nb = db.load('netBans', {});
  nb[devBan.data.ban.id].until = Date.now() - 1000;
  ok((await api('GET', '/api/rewards', T.twin, null, D.twin)).status === 200, 'срок вышел — Двойник снова играет');
  const hist = (await api('GET', '/api/admin/net-bans', T.mod, null, D.mod)).data.bans || [];
  ok(hist.length === 2 && hist.every((b) => !b.active), 'в истории оба бана, оба неактивны');

  console.log('\n[7] Клиент и панель');
  const apiJs = fs.readFileSync(path.join(ROOT, 'public/js/api.js'), 'utf8');
  ok(/'x-did': this\.did\(\)/.test(apiJs) && /localStorage\.getItem\('gdid'\)/.test(apiJs), 'клиент шлёт метку браузера');
  const shell = fs.readFileSync(path.join(ROOT, 'public/js/admin2/shell.js'), 'utf8');
  ok(/id: 'network'/.test(shell) && /id: 'payments'[^\n]*ownerOnly: true/.test(shell), 'в панели разделы «Адреса и устройства» и «Платежи»');
  const pl = fs.readFileSync(path.join(ROOT, 'public/js/admin2/player.js'), 'utf8');
  ok(/data-netban-ip/.test(pl) && /data-netban-dev/.test(pl), 'в карточке игрока есть кнопки бана адреса и устройства');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 300); });
