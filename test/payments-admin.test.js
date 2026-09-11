// ═══════════════════════════════════════════════════════════════════
// test/payments-admin.test.js — раздел «Платежи»: всё о каждой оплате
//
// Что стережётся:
//  1. Заказ помнит, откуда нажали «Купить»: адрес, устройство, метка.
//  2. Хранится ответ ЮKassa: способ, карта (без полного номера), банк,
//     суммы с комиссией, коды авторизации; уведомления идут в хронологию.
//  3. Раздел видит только владелец — ни администратор с правами, ни игрок.
//  4. Поиск по номеру, позывному, 4 цифрам карты и адресу работает.
//  5. «Сверить с ЮKassa» обновляет данные; секретный ключ не утекает.
//
// Запуск: node test/payments-admin.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
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
process.env.YOOKASSA_SHOP_ID = 'shop-77';
process.env.YOOKASSA_SECRET_KEY = SECRET;

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

const fake = { payments: {}, refunds: {}, seq: 0 };
function transport(url, init) {
  const m = /\/v3\/(payments|refunds)(?:\/([^/]+))?$/.exec(url);
  if (init.method === 'POST' && m && m[1] === 'payments' && !m[2]) {
    const b = JSON.parse(init.body);
    const id = 'pay_' + (++fake.seq);
    fake.payments[id] = {
      id, status: 'pending', paid: false, test: true, amount: b.amount,
      income_amount: { value: (Number(b.amount.value) * 0.965).toFixed(2), currency: 'RUB' },
      created_at: new Date().toISOString(), description: b.description, metadata: b.metadata,
      recipient: { account_id: 'shop-77', gateway_id: 'gw-1' },
      payment_method: {
        type: 'bank_card', id: 'pm_' + id, saved: false, title: 'Bank card *4477',
        card: { first6: '555555', last4: '4477', expiry_month: '12', expiry_year: '2030',
          card_type: 'MasterCard', issuer_country: 'RU', issuer_name: 'Sberbank',
          card_product: { code: 'MCS', name: 'MasterCard Standard' } },
      },
      confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=' + id },
    };
    return Promise.resolve({ status: 200, json: fake.payments[id] });
  }
  const coll = m && m[1] === 'refunds' ? fake.refunds : fake.payments;
  const obj = m ? coll[decodeURIComponent(m[2] || '')] : null;
  return Promise.resolve(obj ? { status: 200, json: obj } : { status: 404, json: { code: 'not_found' } });
}

(async () => {
  require(ROOT + '/dist/server.js');
  await new Promise((r) => setTimeout(r, 1800));
  require(ROOT + '/dist/src/services/yookassa').setTransport(transport);
  const auth = require(ROOT + '/dist/src/services/auth');
  const player = require(ROOT + '/dist/src/services/player');
  const db = require(ROOT + '/dist/src/core/db');
  const payments = require(ROOT + '/dist/src/services/payments');

  const tOwner = (await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1')).token;
  const tAdmin = (await auth.register('Куратор', 'пароль123', 'a@t.ru', 'ru', '1.1.1.2')).token;
  const tBuyer = (await auth.register('Покупатель', 'пароль123', 'b@t.ru', 'ru', '1.1.1.3')).token;
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const O = by('Хозяин'), A = by('Куратор'), B = by('Покупатель');
  O.role = 'owner'; O.isAdmin = true;
  A.role = 'admin'; A.isAdmin = true;
  const zones = db.load('roleZones', {});
  zones.admin = ['roles', 'players', 'security', 'economy', 'moderation'];   // всё, что можно выдать
  db.save('roleZones');
  const orders = () => db.load('payments', {});

  console.log('\n[1] Заказ помнит, откуда платили');
  const cr = await api('POST', '/api/payments/create', tBuyer, { packageId: 'gold_100' }, BUYER);
  ok(cr.status === 200 && !!cr.data.payUrl, 'заказ создан и ушёл в ЮKassa');
  const o = orders()[cr.data.orderId];
  ok(o.buyer && o.buyer.ip === '5.6.7.8', `адрес покупателя: ${o.buyer && o.buyer.ip}`);
  ok(o.buyer && /SM-A536E/.test(o.buyer.device), `устройство: ${o.buyer && o.buyer.device}`);
  ok(o.buyer && o.buyer.did === BUYER.did, 'метка браузера');
  ok(o.yk && o.yk.payment_method.card.last4 === '4477', 'ответ ЮKassa сохранён сразу при создании');

  console.log('\n[2] Оплата: ответ ЮKassa и хронология');
  const p = fake.payments[o.providerRef];
  p.status = 'succeeded'; p.paid = true; p.captured_at = new Date().toISOString();
  p.authorization_details = { rrn: '603668680243', auth_code: '062467', three_d_secure: { applied: true } };
  await api('POST', '/api/payments/yookassa', '', { type: 'notification', event: 'payment.succeeded', object: { id: o.providerRef } }, { ip: '185.71.76.10' });
  const paid = orders()[o.id];
  ok(paid.status === 'paid', 'заказ оплачен');
  ok(paid.yk.authorization_details && paid.yk.authorization_details.rrn === '603668680243', 'коды авторизации сохранены');
  ok((paid.events || []).length === 1 && paid.events[0].event === 'payment.succeeded' && paid.events[0].ip === '185.71.76.10',
     'уведомление ЮKassa записано с адресом отправителя');

  console.log('\n[3] Раздел только для владельца');
  const list = await api('GET', '/api/admin/payments', tOwner);
  ok(list.status === 200 && list.data.rows.length === 1, `владелец видит платежи (${list.status})`);
  const row = list.data.rows[0];
  ok(/Банковская карта •••• 4477, Sberbank/.test(row.method), `способ оплаты в списке: «${row.method}»`);
  ok(row.buyerIp === '5.6.7.8' && row.userName === 'Покупатель' && row.test === true, 'игрок, адрес и пометка «тест»');
  ok(list.data.totals.testCount === 1 && list.data.totals.paidRub === 0, 'тестовая оплата не попадает в настоящие деньги');
  ok((await api('GET', '/api/admin/payments', tAdmin)).status >= 400, 'администратору со всеми правами — нельзя');
  ok((await api('GET', '/api/admin/payments/' + o.id, tAdmin)).status >= 400, 'и карточку платежа тоже');
  ok((await api('GET', '/api/admin/payments', tBuyer)).status >= 400, 'игроку — тем более');

  console.log('\n[4] Поиск');
  for (const [q, what] of [['4477', '4 цифры карты'], ['Покупатель', 'позывной'], ['5.6.7.8', 'адрес'], [o.providerRef, 'номер платежа ЮKassa'], [o.id, 'номер заказа']]) {
    const r = await api('GET', '/api/admin/payments?q=' + encodeURIComponent(q), tOwner);
    ok(r.data.rows.length === 1, `находится по: ${what}`);
  }
  ok((await api('GET', '/api/admin/payments?q=нет-такого', tOwner)).data.rows.length === 0, 'лишнего не находит');
  ok((await api('GET', '/api/admin/payments?test=0', tOwner)).data.rows.length === 0, 'фильтр «настоящие» прячет тестовые');

  console.log('\n[5] Карточка платежа');
  const d = (await api('GET', '/api/admin/payments/' + o.id, tOwner)).data;
  ok(d.method.name === 'Банковская карта' && d.method.card.first6 === '555555' && d.method.card.last4 === '4477', 'карта: первые 6 и последние 4 цифры');
  ok(d.method.card.issuerName === 'Sberbank' && d.method.card.issuerCountry === 'RU' && d.method.card.type === 'MasterCard', 'банк, страна, платёжная система');
  ok(d.money.amount === 99 && d.money.currency === 'RUB', 'сумма и валюта');
  // Поддельная ЮKassa берёт 3,5%: 99 × 0,965 = 95,535 → «95.53» в ответе
  ok(d.money.income === 95.53 && d.money.commission === 3.47, `придёт ${d.money.income} ₽, комиссия ${d.money.commission} ₽`);
  ok(d.auth.rrn === '603668680243' && d.auth.threeDs === 'пройдена', 'RRN и 3-D Secure');
  ok(d.buyer.ip === '5.6.7.8' && /SM-A536E/.test(d.buyer.device), 'откуда платили');
  ok(d.receiptLines.length === 1 && d.receiptLines[0].icon === '/img/icons/gold.webp', 'что выдано');
  ok(!!d.raw && d.raw.id === o.providerRef, 'полный ответ ЮKassa доступен');
  ok(!JSON.stringify(d).includes('5555554477') && !/\b\d{16}\b/.test(JSON.stringify(d)), 'полного номера карты нет');

  console.log('\n[6] Сверить с ЮKassa');
  p.refunded_amount = { value: '99.00', currency: 'RUB' };
  const rf = await api('POST', '/api/admin/payments/' + o.id + '/refresh', tOwner, {});
  ok(rf.status === 200 && rf.data.money.refunded === 99, 'после сверки видно возвращённое по данным ЮKassa');
  ok((await api('POST', '/api/admin/payments/' + o.id + '/refresh', tAdmin, {})).status >= 400, 'сверять может только владелец');
  delete process.env.YOOKASSA_SECRET_KEY;
  const noKeys = await api('POST', '/api/payments/create', tBuyer, { packageId: 'gold_100' }, BUYER);
  ok(noKeys.status === 200 && orders()[noKeys.data.orderId].buyer.ip === '5.6.7.8', 'и без ключей адрес покупателя в заказе есть');
  process.env.YOOKASSA_SECRET_KEY = SECRET;

  console.log('\n[7] Секрет не утёк');
  ok(seen.every((raw) => raw.indexOf(SECRET) === -1), `ни в одном из ${seen.length} ответов`);
  const screen = fs.readFileSync(path.join(ROOT, 'public/js/admin2/payments.js'), 'utf8');
  ok(/A2\.screens\.payments = render/.test(screen) && /Сверить с ЮKassa/.test(screen), 'экран «Платежи» в панели');
  ok(/<script src="\/js\/admin2\/payments\.js"><\/script>/.test(fs.readFileSync(path.join(ROOT, 'public/admin2.html'), 'utf8')), 'и подключён');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 300); });
