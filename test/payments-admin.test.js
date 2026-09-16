// ═══════════════════════════════════════════════════════════════════
// test/payments-admin.test.js — раздел «Платежи»: всё о каждой оплате
//
// Что стережётся:
//  1. Заказ помнит, откуда нажали «Купить»: адрес, устройство, метка.
//  2. Хранится уведомление Робокассы: способ, комиссия; оно идёт в
//     хронологию с адресом отправителя.
//  3. Раздел видит только владелец — ни администратор с правами, ни игрок.
//  4. Поиск по номеру заказа и счёта, позывному и адресу работает.
//  5. Без ключей адрес покупателя всё равно в заказе; пароль не утекает.
// Подписи, подделки и сверка — в test/robokassa.test.js.
//
// Запуск: node test/payments-admin.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-payments-admin';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STAFF_2FA_REQUIRED = '0';
process.env.PORT = '3496';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = TEST_CWD + '/data';
process.env.APP_URL = 'https://game.example';
const SECRET = 'test_SECRET_admin_payments_77';
process.env.ROBOKASSA_LOGIN = 'shop-77';
process.env.ROBOKASSA_PASS1 = 'pass1_admin_payments_77';
process.env.ROBOKASSA_PASS2 = SECRET;
process.env.ROBOKASSA_TEST = '0';
const md5 = (x) => crypto.createHash('md5').update(x, 'utf8').digest('hex');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Mobile Safari/537.36';
const BUYER = { ip: '5.6.7.8', ua: UA_ANDROID, fp: '1080x2400|24bit|2.75|Europe/Moscow|ru|cpu8|mem8', did: 'didBuyer0000001' };
const BASE = 'http://127.0.0.1:3496';
const seen = [];
async function api(m, p, tok, body, d) {
  const x = d || {};
  const headers = { 'Content-Type': 'application/json', 'x-token': tok || '' };
  if (x.ua) headers['user-agent'] = x.ua;
  if (x.ip) headers['x-real-ip'] = x.ip;
  if (x.fp) headers['x-fp'] = x.fp;
  if (x.did) headers['x-did'] = x.did;
  const r = await fetch(BASE + p, { method: m, headers, body: body ? JSON.stringify(body) : undefined });
  const raw = await r.text();
  seen.push(raw);
  let data = {};
  try { data = JSON.parse(raw); } catch (e) {}
  return { status: r.status, data };
}

(async () => {
  require(ROOT + '/dist/server.js');
  await new Promise((r) => setTimeout(r, 1800));
  const auth = require(ROOT + '/dist/src/services/auth');
  const player = require(ROOT + '/dist/src/services/player');
  const db = require(ROOT + '/dist/src/core/db');

  const tOwner = (await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1')).token;
  const tAdmin = (await auth.register('Куратор', 'пароль123', 'a@t.ru', 'ru', '1.1.1.2')).token;
  const tBuyer = (await auth.register('Покупатель', 'пароль123', 'b@t.ru', 'ru', '1.1.1.3')).token;
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const O = by('Хозяин'), A = by('Куратор');
  O.role = 'owner'; O.isAdmin = true;
  A.role = 'admin'; A.isAdmin = true;
  const zones = db.load('roleZones', {});
  zones.admin = ['roles', 'players', 'security', 'economy', 'moderation'];   // всё, что можно выдать
  db.save('roleZones');
  const orders = () => db.load('payments', {});

  console.log('\n[1] Заказ помнит, откуда платили');
  const cr = await api('POST', '/api/payments/create', tBuyer, { packageId: 'gold_100' }, BUYER);
  ok(cr.status === 200 && /robokassa\.ru/.test(cr.data.payUrl || ''), 'заказ создан, ссылка на Робокассу');
  const o = orders()[cr.data.orderId];
  ok(o.buyer && o.buyer.ip === '5.6.7.8', `адрес покупателя: ${o.buyer && o.buyer.ip}`);
  ok(o.buyer && /SM-A536E/.test(o.buyer.device), `устройство: ${o.buyer && o.buyer.device}`);
  ok(o.buyer && o.buyer.did === BUYER.did, 'метка браузера');

  console.log('\n[2] Оплата: уведомление и хронология');
  const form = new URLSearchParams({
    OutSum: '99.000000', InvId: String(o.invId), Fee: '3.47', PaymentMethod: 'SBP', IncCurrLabel: 'SBPPSR',
    Shp_order: o.id, SignatureValue: md5(`99.000000:${o.invId}:${SECRET}:Shp_order=${o.id}`),
  }).toString();
  const res = await fetch(BASE + '/api/payments/robokassa/result', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-real-ip': '185.59.216.1' }, body: form,
  });
  seen.push(await res.text());
  const paid = orders()[o.id];
  ok(paid.status === 'paid', 'заказ оплачен');
  ok((paid.events || []).length === 1 && paid.events[0].event === 'result' && paid.events[0].ip === '185.59.216.1',
     'уведомление Робокассы записано с адресом отправителя');

  console.log('\n[3] Раздел только для владельца');
  const list = await api('GET', '/api/admin/payments', tOwner);
  ok(list.status === 200 && list.data.rows.length === 1, `владелец видит платежи (${list.status})`);
  const row = list.data.rows[0];
  ok(row.method === 'SBP', `способ оплаты в списке: «${row.method}»`);
  ok(row.buyerIp === '5.6.7.8' && row.userName === 'Покупатель' && row.test === false, 'игрок, адрес, не тест');
  ok(list.data.totals.paidRub === 99 && list.data.totals.paidCount === 1, 'оплата попала в настоящие деньги');
  ok((await api('GET', '/api/admin/payments', tAdmin)).status >= 400, 'администратору со всеми правами — нельзя');
  ok((await api('GET', '/api/admin/payments/' + o.id, tAdmin)).status >= 400, 'и карточку платежа тоже');
  ok((await api('GET', '/api/admin/payments', tBuyer)).status >= 400, 'игроку — тем более');

  console.log('\n[4] Поиск');
  for (const [q, what] of [['Покупатель', 'позывной'], ['5.6.7.8', 'адрес'], [String(o.invId), 'номер счёта Робокассы'], [o.id, 'номер заказа']]) {
    const r = await api('GET', '/api/admin/payments?q=' + encodeURIComponent(q), tOwner);
    ok(r.data.rows.length === 1, `находится по: ${what}`);
  }
  ok((await api('GET', '/api/admin/payments?q=нет-такого', tOwner)).data.rows.length === 0, 'лишнего не находит');
  ok((await api('GET', '/api/admin/payments?test=1', tOwner)).data.rows.length === 0, 'фильтр «тестовые» прячет настоящие');

  console.log('\n[5] Карточка платежа');
  const d = (await api('GET', '/api/admin/payments/' + o.id, tOwner)).data;
  ok(d.method.name === 'SBP' && d.method.title === 'SBPPSR', 'способ и метка Робокассы');
  ok(d.money.amount === 99 && d.money.currency === 'RUB' && d.money.commission === 3.47 && d.money.income === 95.53,
     `придёт ${d.money.income} ₽, комиссия ${d.money.commission} ₽`);
  ok(d.buyer.ip === '5.6.7.8' && /SM-A536E/.test(d.buyer.device), 'откуда платили');
  ok(d.receiptLines.length === 1 && d.receiptLines[0].icon === '/img/icons/gold.webp', 'что выдано');
  ok(!!d.raw && d.raw.result && d.raw.result.InvId === String(o.invId) && !('SignatureValue' in d.raw.result),
     'данные уведомления доступны, без подписи');
  delete process.env.ROBOKASSA_PASS2;
  const noKeys = await api('POST', '/api/payments/create', tBuyer, { packageId: 'gold_100' }, BUYER);
  ok(noKeys.status === 200 && orders()[noKeys.data.orderId].buyer.ip === '5.6.7.8', 'и без ключей адрес покупателя в заказе есть');
  process.env.ROBOKASSA_PASS2 = SECRET;

  console.log('\n[6] Пароль не утёк');
  ok(seen.every((raw) => raw.indexOf(SECRET) === -1), `ни в одном из ${seen.length} ответов`);
  const screen = fs.readFileSync(path.join(ROOT, 'public/js/admin2/payments.js'), 'utf8');
  ok(/A2\.screens\.payments = render/.test(screen) && /Сверить с Робокассой/.test(screen), 'экран «Платежи» в панели');
  ok(/<script src="\/js\/admin2\/payments\.js"><\/script>/.test(fs.readFileSync(path.join(ROOT, 'public/admin2.html'), 'utf8')), 'и подключён');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 300); });
