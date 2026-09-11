// ═══════════════════════════════════════════════════════════════════
// test/yookassa.test.js — оплата через ЮKassa
//
// Настоящая ЮKassa в тесте не участвует: транспорт подменён поддельной,
// которая ведёт платежи в памяти. Игра при этом работает по-настоящему —
// через HTTP, с открытым маршрутом уведомлений, как на сервере.
//
// Что стережётся:
//  1. Без ключей оплата выключена; с ключами платёж создаётся на сумму
//     заказа, в рублях, с номером заказа и ключом идемпотентности.
//  2. Уведомлению НЕ верят: «оплачено» в теле при неоплаченном платеже
//     ничего не начисляет; чужой номер платежа не вызывает даже запроса.
//  3. Настоящая оплата зачисляется ровно один раз, повтор ничего не даёт.
//  4. Не та сумма или чужой номер заказа — не зачисляется.
//  5. Отмена, сверка игроком, недоступность ЮKassa, возврат.
//  6. Секретный ключ не попадает ни в один ответ и ни в базу.
//
// Запуск: node test/yookassa.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-yookassa';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STAFF_2FA_REQUIRED = '0';
process.env.PORT = '3495';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = TEST_CWD + '/data';
process.env.APP_URL = 'https://game.example';
const SHOP = 'test-shop-1';
const SECRET = 'test_SECRET_do_not_leak_42';
process.env.YOOKASSA_SHOP_ID = SHOP;
process.env.YOOKASSA_SECRET_KEY = SECRET;

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const BASE = 'http://127.0.0.1:3495';
const seen = [];   // все сырые ответы — проверим, что ключ не утёк ни в один
async function api(m, p, tok, body) {
  const r = await fetch(BASE + p, {
    method: m, headers: { 'Content-Type': 'application/json', 'x-token': tok || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await r.text();
  seen.push(raw);
  let data = {};
  try { data = JSON.parse(raw); } catch (e) {}
  return { status: r.status, data };
}

// ── Поддельная ЮKassa ──
const fake = { payments: {}, refunds: {}, calls: [], seq: 0, down: false };
function fakeTransport(url, init) {
  fake.calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
  if (fake.down) return Promise.reject(new Error('сеть недоступна'));
  const m = /\/v3\/(payments|refunds)(?:\/([^/]+))?$/.exec(url);
  if (!m) return Promise.resolve({ status: 404, json: { code: 'not_found' } });
  if (init.method === 'POST' && m[1] === 'payments' && !m[2]) {
    const b = JSON.parse(init.body);
    const id = 'pay_' + (++fake.seq);
    fake.payments[id] = {
      id, status: 'pending', paid: false, amount: b.amount, metadata: b.metadata, description: b.description,
      confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=' + id },
    };
    return Promise.resolve({ status: 200, json: fake.payments[id] });
  }
  const coll = m[1] === 'payments' ? fake.payments : fake.refunds;
  const obj = coll[decodeURIComponent(m[2] || '')];
  return Promise.resolve(obj ? { status: 200, json: obj } : { status: 404, json: { code: 'not_found', description: 'not found' } });
}

(async () => {
  require(ROOT + '/dist/server.js');
  await new Promise((r) => setTimeout(r, 1800));
  const yk = require(ROOT + '/dist/src/services/yookassa');
  yk.setTransport(fakeTransport);
  const auth = require(ROOT + '/dist/src/services/auth');
  const player = require(ROOT + '/dist/src/services/player');
  const db = require(ROOT + '/dist/src/core/db');
  const payments = require(ROOT + '/dist/src/services/payments');

  const tokP = (await auth.register('Покупатель', 'пароль123', 'buy@t.ru', 'ru', '1.1.1.1')).token;
  const tokN = (await auth.register('Сосед', 'пароль123', 'nb@t.ru', 'ru', '2.2.2.2')).token;
  const U = player.users();
  const P = Object.values(U).find((x) => x.name === 'Покупатель');
  const orders = () => db.load('payments', {});
  const notify = (event, object) => api('POST', '/api/payments/yookassa', '', { type: 'notification', event, object });
  const create = async (packageId) => {
    const r = await api('POST', '/api/payments/create', tokP, { packageId: packageId || 'gold_100' });
    const o = r.data.orderId ? orders()[r.data.orderId] : null;
    return { r, o, pay: o ? fake.payments[o.providerRef] : null };
  };

  console.log('\n[1] Витрина знает, включена ли оплата');
  ok((await api('GET', '/api/payments/packages', tokP)).data.enabled === true, 'с ключами оплата включена');
  delete process.env.YOOKASSA_SECRET_KEY;
  ok(payments.packages().enabled === false, 'без секретного ключа — выключена');
  process.env.YOOKASSA_SECRET_KEY = SECRET;

  console.log('\n[2] Платёж создаётся на сумму заказа');
  const gold0 = P.gold || 0;
  const a = await create('gold_100');
  ok(a.r.status === 200 && /^https:\/\/yoomoney\.ru\//.test(a.r.data.payUrl || ''), `игрок получил ссылку на оплату (${a.r.status})`);
  const call = fake.calls[fake.calls.length - 1];
  ok(call.method === 'POST' && /\/v3\/payments$/.test(call.url), 'запрос ушёл на создание платежа');
  ok(call.body.amount.value === '99.00' && call.body.amount.currency === 'RUB', `сумма ${call.body.amount.value} ${call.body.amount.currency}`);
  ok(call.body.capture === true, 'списание сразу, без холда');
  ok(call.body.metadata.orderId === a.r.data.orderId, 'номер заказа передан в metadata');
  ok(call.headers['Idempotence-Key'] === 'order-' + a.r.data.orderId, 'ключ идемпотентности — номер заказа');
  ok(call.headers.Authorization === 'Basic ' + Buffer.from(SHOP + ':' + SECRET).toString('base64'), 'авторизация по shopId и ключу');
  ok(call.body.confirmation.return_url === 'https://game.example/#bank/gold', 'после оплаты игрок вернётся в банк');
  ok(/100 золота/.test(call.body.description), `в описании видно, за что платят: «${call.body.description}»`);
  ok((P.gold || 0) === gold0, 'до оплаты золото не начислено');

  console.log('\n[3] Уведомлению не верят на слово');
  const forged = await notify('payment.succeeded', {
    id: a.o.providerRef, status: 'succeeded', paid: true,
    amount: { value: '99.00', currency: 'RUB' }, metadata: { orderId: a.o.id },
  });
  ok(forged.status === 200, 'ЮKassa получает 200');
  ok((P.gold || 0) === gold0 && orders()[a.o.id].status === 'pending', '«оплачено» в теле при неоплаченном платеже — ничего не начислено');
  const callsBefore = fake.calls.length;
  await notify('payment.succeeded', { id: 'pay_invented_999', status: 'succeeded', paid: true });
  ok(fake.calls.length === callsBefore, 'выдуманный номер платежа — в ЮKassa даже не ходили');
  ok((await api('POST', '/api/payments/yookassa', '', {})).status === 200, 'пустое уведомление не роняет сервер');

  console.log('\n[4] Настоящая оплата — ровно один раз');
  a.pay.status = 'succeeded'; a.pay.paid = true;
  await notify('payment.succeeded', { id: a.o.providerRef });
  const credited = orders()[a.o.id].creditedGold;
  ok(orders()[a.o.id].status === 'paid', 'заказ оплачен');
  ok(credited >= 100 && (P.gold || 0) === gold0 + credited, `зачислено ${credited} золота`);
  await notify('payment.succeeded', { id: a.o.providerRef });
  const chk = await api('POST', '/api/payments/check', tokP, { orderId: a.o.id });
  ok((P.gold || 0) === gold0 + credited, 'повторное уведомление и сверка второй раз не начислили');
  // Сверка сама пропускает оплаченный заказ, поэтому защиту зачисления
  // проверяем отдельно: без неё хватило бы одной ошибки в сверке
  ok(payments.confirmPayment(a.o.id).ok === false && (P.gold || 0) === gold0 + credited,
     'подтверждение уже оплаченного заказа ничего не начисляет');
  ok(chk.data.status === 'paid', 'сверка показывает «оплачено»');
  const paySrc = fs.readFileSync(path.join(ROOT, 'src/services/payments.ts'), 'utf8');
  ok(/Зачислено 🪙 \$\{credited\}/.test(paySrc), 'в уведомлении игроку — зачисленное, а не номинал пакета');

  console.log('\n[5] Не та сумма или чужой номер — не зачисляется');
  const b = await create('gold_525');
  b.pay.status = 'succeeded'; b.pay.paid = true; b.pay.amount = { value: '1.00', currency: 'RUB' };
  let g = P.gold;
  await notify('payment.succeeded', { id: b.o.providerRef });
  ok(P.gold === g && orders()[b.o.id].status === 'pending', 'оплачен 1 ₽ вместо 490 — не зачислено');
  const c = await create('gold_1100');
  c.pay.status = 'succeeded'; c.pay.paid = true; c.pay.metadata = { orderId: a.o.id };
  await notify('payment.succeeded', { id: c.o.providerRef });
  ok(P.gold === g && orders()[c.o.id].status === 'pending', 'в платеже номер другого заказа — не зачислено');

  console.log('\n[6] Отмена');
  const d = await create('gold_100');
  d.pay.status = 'canceled'; d.pay.cancellation_details = { party: 'yoo_money', reason: 'expired_on_confirmation' };
  await notify('payment.canceled', { id: d.o.providerRef });
  ok(orders()[d.o.id].status === 'cancelled', 'отменённый платёж — заказ отменён');
  ok((await api('GET', '/api/payments/orders', tokP)).data.orders.find((o) => o.id === d.o.id).canCheck === false, 'отменённый больше не сверяется');

  console.log('\n[7] Сверка игроком');
  const e = await create('gold_100');
  e.pay.status = 'succeeded'; e.pay.paid = true;
  ok((await api('POST', '/api/payments/check', tokN, { orderId: e.o.id })).status >= 400, 'чужой заказ сверить нельзя');
  g = P.gold;
  const mine = await api('POST', '/api/payments/check', tokP, { orderId: e.o.id });
  ok(mine.data.status === 'paid' && P.gold > g, 'уведомление не пришло — сверка сама зачислила');
  const f = await create('gold_100');
  await api('POST', '/api/payments/check', tokP, { orderId: f.o.id });
  const n1 = fake.calls.length;
  await api('POST', '/api/payments/check', tokP, { orderId: f.o.id });
  ok(fake.calls.length === n1, 'частые нажатия не долбят ЮKassa запросами');
  const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  ok(/'\/api\/payments\/check'[^\n]*noLog: true/.test(routes), 'сверка не засоряет журнал действий');

  console.log('\n[8] ЮKassa недоступна');
  fake.down = true;
  const down = await api('POST', '/api/payments/create', tokP, { packageId: 'gold_100' });
  ok(down.status >= 400 && /не списаны/.test(down.data.error || ''), `игроку понятно, что деньги не списаны (${down.status})`);
  const failedOrder = Object.values(orders()).filter((o) => o.userId === P.id).sort((x, y) => y.createdAt - x.createdAt)[0];
  ok(failedOrder && failedOrder.status === 'failed' && !failedOrder.payUrl, 'заказ помечен «не создан»');
  const retry = await notify('payment.succeeded', { id: f.o.providerRef });
  ok(retry.status >= 500, `уведомление при недоступной ЮKassa — ${retry.status}, ЮKassa повторит`);
  fake.down = false;

  console.log('\n[9] Возврат');
  fake.refunds.rf_1 = { id: 'rf_1', status: 'succeeded', payment_id: a.o.providerRef, amount: { value: '99.00', currency: 'RUB' } };
  await notify('refund.succeeded', { id: 'rf_1', payment_id: a.o.providerRef });
  await notify('refund.succeeded', { id: 'rf_1', payment_id: a.o.providerRef });
  ok(orders()[a.o.id].refundedRub === 99, `возврат учтён один раз (${orders()[a.o.id].refundedRub} ₽)`);
  const logs = require(ROOT + '/dist/src/services/auditLog');
  const listed = await (require(ROOT + '/dist/src/services/admin').listLogs({ limit: 200 }));
  ok((listed.logs || []).some((l) => l.path === '/system/payment-refund'), 'о возврате есть запись в журнале для владельца');
  ok(!!logs, 'журнал доступен');

  console.log('\n[10] Защита от шквала заказов');
  let blocked = null;
  for (let i = 0; i < 12 && !blocked; i++) {
    const r = await api('POST', '/api/payments/create', tokP, { packageId: 'gold_100' });
    if (r.status >= 400) blocked = r.data.error;
  }
  ok(/Слишком много неоплаченных/.test(blocked || ''), 'больше 10 неоплаченных заказов за час создать нельзя');

  console.log('\n[11] Секретный ключ никуда не утёк');
  ok(seen.every((raw) => raw.indexOf(SECRET) === -1), `ни в одном из ${seen.length} ответов игры`);
  ok(JSON.stringify(orders()).indexOf(SECRET) === -1, 'и в заказах в базе');

  console.log('\n[12] Маршруты и клиент');
  ok(/'\/api\/payments\/yookassa'[^\n]*open: true/.test(routes), 'уведомления принимаются без входа в игру');
  ok(/'\/api\/offers\/order'[^\n]*payments\.pay\(/.test(routes), 'набор за рубли тоже уходит в ЮKassa');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  const bank = core.slice(core.indexOf('App.screens.bank = async'), core.indexOf("if (tab === 'reserve')"));
  ok((bank.match(/await App\._syncPayments\(\)/g) || []).length === 2, 'после возврата с оплаты банк сверяет заказы (золото и наборы)');
  ok(/YOOKASSA_SHOP_ID/.test(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')), 'в .env.example описано, куда вписать ключи');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 300); });
