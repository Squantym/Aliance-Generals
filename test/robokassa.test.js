// ═══════════════════════════════════════════════════════════════════
// test/robokassa.test.js — оплата через Робокассу
//
// Настоящая Робокасса в тесте не участвует: запрос состояния счёта идёт в
// поддельную, а уведомления об оплате тест подписывает сам — так же, как
// это делает Робокасса. Игра работает по-настоящему, через HTTP.
//
// Что стережётся:
//  1. Без ключей оплата выключена; с ключами ссылка на оплату подписана
//     паролем №1, сумма «99.00», номер счёта — целое число, наш заказ — в
//     Shp_order. Способ оплаты НЕ навязан: иначе пропали бы зарубежные карты.
//  2. Уведомлению без верной подписи паролем №2 не верят: чужая подпись,
//     подпись паролем №1, тестовая подпись на боевом, чужой Shp_order,
//     другая сумма — ничего не зачисляют.
//  3. Верное уведомление (POST формой, как шлёт Робокасса) зачисляет ровно
//     один раз и получает ответ «OK<номер>» простым текстом.
//  4. Возврат игрока (Success/Fail) ничего не зачисляет и ведёт в банк.
//  5. Сверка: «счёт не найден» — заказ ждёт; оплачен — зачислен; другая
//     сумма — нет; отменён — отменён; касса недоступна — понятный отказ.
//  6. Панель: состояние кассы и адреса для кабинета — только владельцу;
//     возврат виден после сверки; зарубежная карта помечена.
//  7. Тестовый режим: IsTest=1 и тестовые пароли, оплата помечена тестовой.
//  8. Пароли не попадают ни в один ответ, ни в ссылку, ни в базу.
//
// Запуск: node test/robokassa.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-robokassa';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STAFF_2FA_REQUIRED = '0';
process.env.PORT = '3495';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = TEST_CWD + '/data';
process.env.APP_URL = 'https://game.example';
const LOGIN = 'generals-shop';
const PASS1 = 'live_PASS1_do_not_leak_11';
const PASS2 = 'live_PASS2_do_not_leak_22';
const TPASS1 = 'test_PASS1_do_not_leak_33';
const TPASS2 = 'test_PASS2_do_not_leak_44';
const SECRETS = [PASS1, PASS2, TPASS1, TPASS2];
const RK_KEYS = ['ROBOKASSA_LOGIN', 'ROBOKASSA_PASS1', 'ROBOKASSA_PASS2', 'ROBOKASSA_TEST_PASS1', 'ROBOKASSA_TEST_PASS2', 'ROBOKASSA_TEST', 'ROBOKASSA_HASH'];
for (const k of RK_KEYS) delete process.env[k];
function keysOn() {
  Object.assign(process.env, {
    ROBOKASSA_LOGIN: LOGIN, ROBOKASSA_PASS1: PASS1, ROBOKASSA_PASS2: PASS2,
    ROBOKASSA_TEST_PASS1: TPASS1, ROBOKASSA_TEST_PASS2: TPASS2, ROBOKASSA_TEST: '0',
  });
}

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

const BASE = 'http://127.0.0.1:3495';
const seen = [];   // все сырые ответы — проверим, что пароли не утекли ни в один
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
// Уведомление так, как его шлёт Робокасса: POST формой
async function result(fields, how) {
  const form = new URLSearchParams(fields).toString();
  const r = how === 'GET'
    ? await fetch(BASE + '/api/payments/robokassa/result?' + form)
    : await fetch(BASE + '/api/payments/robokassa/result', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
    });
  const text = await r.text();
  seen.push(text);
  return { status: r.status, text, type: r.headers.get('content-type') || '' };
}
// Подпись уведомления: сумма КАК ПРИСЛАНА, номер, пароль №2, Shp по алфавиту
const sign = (sum, inv, pass, orderId) => md5(`${sum}:${inv}:${pass}:Shp_order=${orderId}`);
const note = (o, extra) => Object.assign({
  OutSum: '99.000000', InvId: String(o.inv), Fee: '3.47', EMail: 'b@t.ru',
  PaymentMethod: 'BankCard', IncCurrLabel: 'BankCardPSR', IsTest: '0', Shp_order: o.id,
  SignatureValue: sign('99.000000', o.inv, PASS2, o.id).toUpperCase(),
}, extra || {});

// ── Поддельная Робокасса: состояние счетов ──
const fake = { states: {}, calls: [], down: false };
function xmlFor(inv) {
  const s = fake.states[inv];
  if (!s) return '<?xml version="1.0"?><OperationStateResponse xmlns="http://merchant.roboxchange.com/WebService/"><Result><Code>3</Code><Description>Операция не найдена</Description></Result></OperationStateResponse>';
  return `<?xml version="1.0"?><OperationStateResponse xmlns="http://merchant.roboxchange.com/WebService/">
  <Result><Code>0</Code></Result>
  <State><Code>${s.code}</Code><RequestDate>2026-09-16T10:00:00+03:00</RequestDate><StateDate>2026-09-16T09:59:00+03:00</StateDate></State>
  <Info><IncCurrLabel>${s.curr || 'BankCardForeignPSR'}</IncCurrLabel><IncSum>${s.incSum || '1.12'}</IncSum><IncAccount>${s.account || '411111******1111'}</IncAccount>
    <PaymentMethod><Code>BankCard</Code><Description>${s.method || 'Банковская карта, выпущенная за рубежом'}</Description></PaymentMethod>
    <OutCurrLabel>RUB</OutCurrLabel><OutSum>${s.sum || '99'}</OutSum><Rate>88.39</Rate></Info>
</OperationStateResponse>`;
}
function transport(url) {
  fake.calls.push(url);
  if (fake.down) return Promise.reject(new Error('сеть недоступна'));
  const q = new URL(url).searchParams;
  const inv = q.get('InvoiceID');
  const pass = q.get('IsTest') === '1' ? TPASS2 : PASS2;
  if (q.get('MerchantLogin') !== LOGIN || q.get('Signature') !== md5(`${LOGIN}:${inv}:${pass}`)) {
    return Promise.resolve({ status: 200, text: '<OperationStateResponse><Result><Code>2</Code><Description>Неверная подпись</Description></Result></OperationStateResponse>' });
  }
  return Promise.resolve({ status: 200, text: xmlFor(inv) });
}

(async () => {
  require(ROOT + '/dist/server.js');
  await new Promise((r) => setTimeout(r, 1800));
  const rk = require(ROOT + '/dist/src/services/robokassa');
  rk.setTransport(transport);
  const http = require(ROOT + '/dist/src/core/http');
  const auth = require(ROOT + '/dist/src/services/auth');
  const player = require(ROOT + '/dist/src/services/player');
  const db = require(ROOT + '/dist/src/core/db');
  const auditLog = require(ROOT + '/dist/src/services/auditLog');

  const reg = async (n, i) => (await auth.register(n, 'пароль123', `rk${i}@t.ru`, 'ru', '10.1.1.' + i)).token;
  const tOwner = await reg('Хозяин', 1);
  const tAdmin = await reg('Куратор', 2);
  const tB = await reg('Покупатель', 3);
  const tC = await reg('Второй', 4);
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const O = by('Хозяин'), A = by('Куратор'), B = by('Покупатель'), C = by('Второй');
  O.role = 'owner'; O.isAdmin = true;
  A.role = 'admin'; A.isAdmin = true;
  const zones = db.load('roleZones', {});
  zones.admin = ['roles', 'players', 'security', 'economy', 'moderation'];
  db.save('roleZones');
  const orders = () => db.load('payments', {});
  const buy = async (tok) => {
    const r = await api('POST', '/api/payments/create', tok, { packageId: 'gold_100' });
    const o = orders()[r.data.orderId];
    return { r, o, id: r.data.orderId, inv: o && o.invId };
  };
  const audits = async (p) => (await auditLog.listAll(500)).filter((e) => e.path === p);

  console.log('\n[1] Без ключей оплата выключена');
  const off = await api('GET', '/api/payments/packages', tB);
  ok(off.status === 200 && off.data.enabled === false, 'витрина: оплата выключена');
  const b0 = await buy(tB);
  ok(b0.r.status === 200 && b0.r.data.payUrl === null && !b0.inv, 'заказ создан, счёт не выставлен');
  const noKeysPv = await api('GET', '/api/admin/payments-provider', tOwner);
  ok(noKeysPv.status === 200 && noKeysPv.data.configured === false && /ROBOKASSA_LOGIN/.test(noKeysPv.data.problem),
     `панель говорит, чего не хватает: «${noKeysPv.data.problem}»`);

  console.log('\n[2] Ссылка на оплату');
  keysOn();
  const on = await api('GET', '/api/payments/packages', tB);
  ok(on.data.enabled === true && Array.isArray(on.data.methods) && on.data.methods.length === 0, 'оплата включена, своего выбора способа нет');
  ok(/за рубежом/.test(on.data.payNote) && /Робокасс/.test(on.data.payNote), 'игроку сказано про зарубежные карты и Робокассу');
  const b1 = await buy(tB);
  const url = new URL(b1.r.data.payUrl);
  const q = url.searchParams;
  ok(url.origin + url.pathname === 'https://auth.robokassa.ru/Merchant/Index.aspx', 'ведёт на страницу Робокассы');
  ok(q.get('MerchantLogin') === LOGIN && q.get('OutSum') === '99.00', `магазин и сумма «${q.get('OutSum')}»`);
  ok(/^\d+$/.test(q.get('InvId')) && Number(q.get('InvId')) >= 1000 && Number(q.get('InvId')) === b1.inv, `номер счёта — целое: ${q.get('InvId')}`);
  ok(q.get('Shp_order') === b1.id, 'наш номер заказа — в Shp_order');
  ok(q.get('SignatureValue') === md5(`${LOGIN}:99.00:${b1.inv}:${PASS1}:Shp_order=${b1.id}`), 'подпись паролем №1 с Shp_order');
  ok(!q.has('IncCurrLabel') && !q.has('PaymentMethods'), 'способ оплаты не навязан — зарубежные карты доступны');
  ok(!q.has('IsTest') && !q.has('Receipt'), 'боевой режим: без IsTest и без чека');
  ok(/золота/.test(q.get('Description')) && q.get('Description').length <= 100 && q.get('Email') === 'rk3@t.ru', 'описание и почта покупателя');
  ok(b1.o.provider === 'robokassa' && b1.o.providerRef === String(b1.inv) && b1.o.rkTest === false, 'заказ помнит счёт');
  const b2 = await buy(tC);
  ok(b2.inv === b1.inv + 1, `следующий счёт — следующий номер (${b2.inv})`);

  console.log('\n[3] Поддельные уведомления');
  const gold0 = B.gold;
  let r = await result(note(b1, { SignatureValue: 'deadbeef'.repeat(4) }));
  ok(r.status === 400 && r.text === 'bad sign', 'чужая подпись — отказ');
  r = await result(note(b1, { SignatureValue: sign('99.000000', b1.inv, PASS1, b1.id) }));
  ok(r.status === 400, 'подпись паролем №1 (его видно в ссылке оплаты по длине и алгоритму) — отказ');
  r = await result(note(b1, { SignatureValue: sign('99.000000', b1.inv, TPASS2, b1.id), IsTest: '1' }));
  ok(r.status === 400, 'тестовая подпись на боевом — отказ');
  r = await result(note(b1, { Shp_order: b2.id, SignatureValue: sign('99.000000', b1.inv, PASS2, b2.id) }));
  ok(r.status === 400 && r.text === 'unknown order', 'верная подпись, но чужой заказ в Shp_order — отказ');
  r = await result(note(b1, { OutSum: '1.00', SignatureValue: sign('1.00', b1.inv, PASS2, b1.id) }));
  ok(r.status === 400 && r.text === 'bad sum', 'другая сумма — отказ');
  r = await result({ OutSum: '99.00', SignatureValue: 'x' });
  ok(r.status === 400, 'без номера счёта — отказ');
  ok(orders()[b1.id].status === 'pending' && B.gold === gold0, 'ничего не зачислено');
  ok((await audits('/system/payment-forged')).length >= 4, 'подделки записаны в журнал');
  ok((await audits('/system/payment-mismatch')).length >= 2, 'расхождения записаны в журнал');

  console.log('\n[4] Настоящее уведомление');
  r = await result(note(b1));
  ok(r.status === 200 && r.text === 'OK' + b1.inv, `ответ Робокассе: «${r.text}»`);
  ok(/^text\/plain/.test(r.type), 'простым текстом, не JSON');
  const paid = orders()[b1.id];
  ok(paid.status === 'paid' && B.gold === gold0 + paid.creditedGold && paid.creditedGold >= 100, `зачислено ${paid.creditedGold} золота`);
  ok(paid.rkResult && paid.rkResult.Fee === '3.47' && paid.rkResult.IncCurrLabel === 'BankCardPSR' && !('SignatureValue' in paid.rkResult),
     'уведомление сохранено без подписи');
  ok((paid.events || []).some((e) => e.event === 'result'), 'уведомление — в хронологии заказа');
  r = await result(note(b1));
  ok(r.status === 200 && r.text === 'OK' + b1.inv && B.gold === gold0 + paid.creditedGold, 'повтор: «OK», второй раз не зачислено');
  // Робокасса может слать и GET — метод выбирается в кабинете
  const gC = C.gold;
  r = await result(note(b2, { SignatureValue: sign('99.000000', b2.inv, PASS2, b2.id) }), 'GET');
  ok(r.status === 200 && r.text === 'OK' + b2.inv && C.gold > gC, 'уведомление методом GET тоже принимается');

  console.log('\n[5] Возврат игрока со страницы оплаты');
  const b3 = await buy(tB);
  const back = await fetch(BASE + `/api/payments/robokassa/success?OutSum=99.00&InvId=${b3.inv}&Shp_order=${b3.id}&SignatureValue=${md5(`99.00:${b3.inv}:${PASS1}:Shp_order=${b3.id}`)}`, { redirect: 'manual' });
  ok(back.status === 302 && back.headers.get('location') === '/#bank/gold', `Success → ${back.headers.get('location')}`);
  ok(orders()[b3.id].status === 'pending', 'по Success URL ничего не зачислено');
  const fail = await fetch(BASE + `/api/payments/robokassa/fail?OutSum=99.00&InvId=${b3.inv}`, { method: 'POST', redirect: 'manual' });
  ok(fail.status === 302 && fail.headers.get('location') === '/#bank/gold', 'Fail → обратно в банк');
  const redir = (p) => { const x = http.redirectReply(p); const s = Object.getOwnPropertySymbols(x)[0]; return x[s].location; };
  ok(redir('//evil.example') === '/' && redir('https://evil.example') === '/' && redir('/\\evil') === '/' && redir('/#bank/offers') === '/#bank/offers',
     'перенаправление — только внутрь сайта');

  console.log('\n[6] Сверка заказа');
  fake.calls.length = 0;
  let ck = await api('POST', '/api/payments/check', tB, { orderId: b3.id });
  ok(ck.status === 200 && ck.data.status === 'pending', 'счёт ещё не открывали (код 3) — заказ ждёт');
  const call = new URL(fake.calls[0]);
  ok(call.searchParams.get('Signature') === md5(`${LOGIN}:${b3.inv}:${PASS2}`) && !fake.calls[0].includes(PASS2), 'запрос состояния подписан паролем №2, пароля в адресе нет');
  fake.states[b3.inv] = { code: '100', sum: '98' };
  orders()[b3.id].checkedAt = 0;
  ck = await api('POST', '/api/payments/check', tB, { orderId: b3.id });
  ok(ck.data.status === 'pending', 'оплачено на другую сумму — не зачислено');
  fake.states[b3.inv] = { code: '100', sum: '99' };
  ck = await api('POST', '/api/payments/check', tB, { orderId: b3.id });
  ok(ck.data.status === 'pending', 'повторная сверка раньше паузы — без запроса');
  orders()[b3.id].checkedAt = 0;
  const g3 = B.gold;
  ck = await api('POST', '/api/payments/check', tB, { orderId: b3.id });
  ok(ck.data.status === 'paid' && B.gold > g3, 'оплачено на верную сумму — зачислено сверкой');
  const b4 = await buy(tB);
  fake.states[b4.inv] = { code: '10' };
  ck = await api('POST', '/api/payments/check', tB, { orderId: b4.id });
  ok(ck.data.status === 'cancelled', 'отменён в Робокассе — отменён у нас');
  const b5 = await buy(tB);
  fake.down = true;
  ck = await api('POST', '/api/payments/check', tB, { orderId: b5.id });
  fake.down = false;
  ok(ck.status >= 400 && /покупка придёт автоматически/.test(ck.data.error || ''), 'касса недоступна — понятный отказ');
  ok((await api('POST', '/api/payments/check', tC, { orderId: b5.id })).status >= 400, 'чужой заказ сверить нельзя');

  console.log('\n[7] Панель владельца');
  const pv = await api('GET', '/api/admin/payments-provider', tOwner);
  ok(pv.status === 200 && pv.data.configured === true && pv.data.test === false, 'касса подключена, боевой режим');
  ok(pv.data.resultUrl === 'https://game.example/api/payments/robokassa/result'
     && pv.data.successUrl === 'https://game.example/api/payments/robokassa/success'
     && pv.data.failUrl === 'https://game.example/api/payments/robokassa/fail', 'адреса для кабинета Робокассы');
  ok((await api('GET', '/api/admin/payments-provider', tAdmin)).status >= 400, 'администратору — нельзя');
  ok((await api('GET', '/api/admin/payments-provider', tB)).status >= 400, 'игроку — нельзя');
  const one = (await api('GET', '/api/admin/payments/' + b3.id, tOwner)).data;
  ok(one.providerName === 'Робокасса' && one.invId === b3.inv && one.method.foreign === true, 'зарубежная карта помечена');
  ok(one.money.incSum === '1.12' && one.money.incCurr === 'BankCardForeignPSR' && one.method.account === '411111******1111', 'что и в какой валюте платил покупатель');
  const d1 = (await api('GET', '/api/admin/payments/' + b1.id, tOwner)).data;
  ok(d1.money.amount === 99 && d1.money.commission === 3.47 && d1.money.income === 95.53, `комиссия ${d1.money.commission} ₽, придёт ${d1.money.income} ₽`);
  const list = (await api('GET', '/api/admin/payments?q=' + b3.inv, tOwner)).data;
  ok(list.rows.length === 1 && /^🌍/.test(list.rows[0].method), `поиск по номеру счёта; способ: «${list.rows[0] && list.rows[0].method}»`);
  fake.states[b3.inv] = { code: '60', sum: '99' };
  const rf = await api('POST', '/api/admin/payments/' + b3.id + '/refresh', tOwner, {});
  ok(rf.status === 200 && rf.data.refundedRub === 99 && rf.data.money.providerStatus === 'возвращён покупателю', 'возврат виден после сверки');
  await api('POST', '/api/admin/payments/' + b3.id + '/refresh', tOwner, {});
  ok((await audits('/system/payment-refund')).length === 1, 'возврат записан в журнал один раз');
  ok((await api('POST', '/api/admin/payments/' + b3.id + '/refresh', tAdmin, {})).status >= 400, 'сверять может только владелец');
  // Старый заказ ЮKassa: показывается, но сверять его не с чем
  const legacy = orders()[b0.id];
  legacy.provider = 'yookassa'; legacy.providerRef = 'pay_old';
  const lg = await api('POST', '/api/admin/payments/' + b0.id + '/refresh', tOwner, {});
  ok(lg.status >= 400 && /ЮKassa/.test(lg.data.error || ''), 'старый заказ ЮKassa — честный отказ');
  ok((await api('GET', '/api/admin/payments/' + b0.id, tOwner)).data.providerName === 'ЮKassa (отключена)', 'и помечен как отключённая касса');

  console.log('\n[8] Тестовый режим');
  process.env.ROBOKASSA_TEST = '1';
  const t1 = await buy(tC);
  const tq = new URL(t1.r.data.payUrl).searchParams;
  ok(tq.get('IsTest') === '1' && tq.get('SignatureValue') === md5(`${LOGIN}:99.00:${t1.inv}:${TPASS1}:Shp_order=${t1.id}`), 'IsTest=1 и подпись тестовым паролем №1');
  r = await result(note(t1, { IsTest: '1', SignatureValue: sign('99.000000', t1.inv, TPASS2, t1.id) }));
  ok(r.text === 'OK' + t1.inv && orders()[t1.id].status === 'paid', 'тестовое уведомление принято в тестовом режиме');
  const tl = (await api('GET', '/api/admin/payments?test=1', tOwner)).data;
  ok(tl.rows.some((x) => x.id === t1.id && x.test === true) && tl.totals.testCount === 1, 'оплата помечена тестовой');
  const pvT = await api('GET', '/api/admin/payments-provider', tOwner);
  ok(pvT.data.test === true, 'панель видит тестовый режим');
  process.env.ROBOKASSA_TEST = '0';
  const real = (await api('GET', '/api/admin/payments?test=0', tOwner)).data;
  ok(real.totals.paidRub === 297 && !real.rows.some((x) => x.id === t1.id), `в настоящие деньги тестовая не попала: ${real.totals.paidRub} ₽`);

  console.log('\n[9] Пароли не утекли');
  ok(seen.every((raw) => SECRETS.every((s) => raw.indexOf(s) === -1)), `ни в одном из ${seen.length} ответов`);
  const dump = JSON.stringify(orders());
  ok(SECRETS.every((s) => dump.indexOf(s) === -1), 'и в заказах в базе');
  const client = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(!/ЮKassa/.test(client) && !/_choosePayMethod/.test(client) && /App\._payNote\(data\)/.test(client), 'экран банка: без выбора способа, с пояснением');
  const screen = fs.readFileSync(path.join(ROOT, 'public/js/admin2/payments.js'), 'utf8');
  ok(/payments-provider/.test(screen) && /Сверить с Робокассой/.test(screen), 'раздел «Платежи» показывает кассу');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 300); });
