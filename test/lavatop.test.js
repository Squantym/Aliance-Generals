// ═══════════════════════════════════════════════════════════════════
// test/lavatop.test.js — оплата зарубежной картой (Lava Top), 18.09.2026
//
// Настоящая Lava в тесте не участвует: рядом поднимается поддельная —
// обычный http-сервер, отвечающий как её API. Игра работает целиком,
// через HTTP, со своим сервером во временной папке.
//
// Что стережётся:
//  1. Без ключей зарубежной оплаты в игре нет вовсе: ни кнопки у пакета,
//     ни у набора. Один ключ API без ключа вебхука — касса НЕ готова:
//     подтвердить оплату будет нечем.
//  2. Панель: список товаров тянется из каталога Lava, связка товара
//     игры с товаром кассы сохраняется, снимается и видна игроку.
//  3. Заказ: счёт выставляет Lava, игра запоминает её номер контракта,
//     сумму и валюту, и уводит игрока по её ссылке.
//  4. Уведомление: чужой ключ (или логин с паролем) — отказ, чужой
//     контракт — отказ, отказ оплаты — ничего не начисляем. Верное —
//     зачисляет ровно один раз. Другая сумма НЕ причина отказа: в примерах
//     Lava суммы «неровные» (курс, комиссия) — выдаём и пишем владельцу.
//  4б. Каталог — со всех страниц (nextPage) и без постов; после оплаты
//     игрок возвращается в банк игры.
//  5. Бонусы к покупке работают так же, как при оплате Робокассой.
//  6. Наборы: зарубежная кнопка появляется только у связанного набора,
//     оплата выдаёт содержимое.
//  7. Ключи не попадают ни в один ответ игры.
//
// Запуск: node test/lavatop.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const ROOT = path.join(__dirname, '..');
const PORT = 4800 + Math.floor(Math.random() * 60);
const LAVA_PORT = PORT + 1;
const BASE = 'http://127.0.0.1:' + PORT;
const API_KEY = 'lava_api_' + Math.random().toString(36).slice(2);
const HOOK_KEY = 'lava_hook_' + Math.random().toString(36).slice(2);
const OFFER_ID = '836b9fc5-7ae9-4a27-9642-592bc44072b7';
const OFFER2_ID = '11112222-3333-4444-5555-666677778888';

let passed = 0, failed = 0;
const ok = (c, n, extra) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };

// ── Поддельная Lava Top ──
const lavaCalls = [];
let contractN = 0;
const lava = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const key = req.headers['x-api-key'];
    lavaCalls.push({ url: req.url, method: req.method, key, body });
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (key !== API_KEY) return send(401, { error: 'bad api key' });
    // Каталог по схеме gate.lava.top/docs: { items: [{ type, data }], nextPage }.
    // Вторая страница — по полному адресу из nextPage; в ленте есть пост.
    if (req.method === 'GET' && req.url.indexOf('/api/v2/products') === 0) {
      if (req.url.indexOf('beforeCreatedAt=') < 0) {
        return send(200, {
          items: [
            { type: 'PRODUCT', data: { title: 'Золото 100', offers: [
              { id: OFFER_ID, name: 'Пакет', prices: [{ amount: 1.5, currency: 'USD' }, { amount: 1.4, currency: 'EUR' }] }] } },
            { type: 'POST', data: { title: 'Новости игры', body: 'пост в ленте, не товар' } },
          ],
          nextPage: 'http://127.0.0.1:' + LAVA_PORT + '/api/v2/products?beforeCreatedAt=2026-01-01T00:00:00Z',
        });
      }
      return send(200, { items: [
        { type: 'PRODUCT', data: { title: 'Стартовый набор', offers: [
          { id: OFFER2_ID, name: '', prices: [{ amount: 2.5, currency: 'USD' }] }] } },
      ], nextPage: null });
    }
    if (req.method === 'POST' && req.url === '/api/v3/invoice') {
      const d = JSON.parse(body || '{}');
      const amount = d.offerId === OFFER_ID ? 1.5 : 2.5;
      const id = `contract-${++contractN}`;
      return send(201, { id, status: 'in-progress', amountTotal: { amount, currency: d.currency || 'USD' },
        paymentUrl: 'https://app.lava.top/pay/' + id });
    }
    send(404, { error: 'not found' });
  });
});

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lava-'));
fs.mkdirSync(path.join(work, 'data'));
const baseEnv = {
  PORT: String(PORT), DISABLE_RATE_LIMIT: '1', STAFF_2FA_REQUIRED: '0', DB_DRIVER: '', MONGODB_URI: '', NODE_ENV: 'test',
  LAVATOP_API_URL: 'http://127.0.0.1:' + LAVA_PORT,
  ENV_OVERRIDE: 'PORT,LAVATOP_API_URL,LAVATOP_API_KEY,LAVATOP_WEBHOOK_KEY,LAVATOP_CURRENCY',
};
let srv;
const start = (extra) => new Promise((res, rej) => {
  const env = Object.assign({}, process.env, baseEnv, extra || {});
  srv = spawn(process.execPath, [path.join(ROOT, 'dist/server.js')], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const on = (b) => { out += b; if (/сервер запущен/i.test(out)) res(); };
  srv.stdout.on('data', on); srv.stderr.on('data', on);
  srv.on('exit', (c) => rej(new Error('сервер вышел с кодом ' + c + ': ' + out.slice(-300))));
});
const stop = () => new Promise((r) => { if (!srv || srv.exitCode !== null) return r(); srv.once('exit', r); srv.kill('SIGTERM'); setTimeout(() => { try { srv.kill('SIGKILL'); } catch (e) {} r(); }, 5000); });
const call = async (m, p, t, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', 'x-token': t || '' }, body: b ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch (e) { j = txt; }
  return { s: r.status, d: j, raw: txt };
};
const hook = async (body, key) => {
  const h = { 'Content-Type': 'application/json' };
  if (key !== null) h['X-Api-Key'] = key === undefined ? HOOK_KEY : key;
  const r = await fetch(BASE + '/api/payments/lavatop/webhook', { method: 'POST', headers: h, body: JSON.stringify(body) });
  return { s: r.status, t: await r.text() };
};
const paid = (contractId, amount, currency) => ({
  eventType: 'payment.success', status: 'completed',
  product: { id: 'p1', title: 'Золото 100' }, buyer: { email: 'x@t.ru' },
  contractId, amount, currency: currency || 'USD', timestamp: new Date().toISOString(),
});

(async () => {
  await new Promise((r) => lava.listen(LAVA_PORT, '127.0.0.1', r));

  console.log('\n[1] Без ключей зарубежной оплаты нет');
  await start({ LAVATOP_API_KEY: '', LAVATOP_WEBHOOK_KEY: '' });
  const reg = async (l) => call('POST', '/api/register', null, { login: l, email: l + '@t.ru', password: 'parol12345', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  for (const l of ['owner1', 'buyer1', 'buyer2']) {
    const r = await reg(l);
    if (r.s !== 200) throw new Error('регистрация: ' + JSON.stringify(r.d));
  }
  await new Promise((r) => setTimeout(r, 1200));
  await stop();
  execFileSync(process.execPath, [path.join(ROOT, 'tools/grant-admin.js'), 'owner1', '--owner', '--yes'],
    { cwd: work, env: Object.assign({}, process.env, baseEnv, { DB_DRIVER: '', SQLITE_DIR: '', SQLITE_FILE: '' }), stdio: 'pipe' });
  await start({ LAVATOP_API_KEY: '', LAVATOP_WEBHOOK_KEY: '' });
  const login = async (l) => (await call('POST', '/api/login', null, { login: l, password: 'parol12345' })).d.token;
  let T = await login('owner1'), B = await login('buyer1');
  let pk = await call('GET', '/api/payments/packages', B);
  ok(!pk.d.lava || pk.d.lava.enabled === false, 'у игрока зарубежной оплаты нет', pk.d.lava);
  ok(!(pk.d.packages || []).some((p) => p.lava), 'и у пакетов тоже');
  let st = await call('GET', '/api/admin/lavatop', T);
  ok(st.s === 200 && st.d.configured === false && /LAVATOP_API_KEY/.test(st.d.problem), `панель говорит, чего не хватает: «${st.d.problem}»`);
  const noHook = await call('POST', '/api/payments/create', B, { packageId: 'gold_100', provider: 'lavatop' });
  ok(noHook.s !== 200, 'оплатить нечем — честный отказ: ' + (noHook.d.error || ''));

  console.log('\n[2] Ключ API без ключа уведомлений — касса не готова');
  await stop();
  await start({ LAVATOP_API_KEY: API_KEY, LAVATOP_WEBHOOK_KEY: '' });
  T = await login('owner1'); B = await login('buyer1');
  st = await call('GET', '/api/admin/lavatop', T);
  ok(st.d.configured === true && st.d.ready === false && /LAVATOP_WEBHOOK_KEY/.test(st.d.problem),
     `«настроена не до конца»: ${st.d.problem}`);
  pk = await call('GET', '/api/payments/packages', B);
  ok(!pk.d.lava.enabled, 'кнопки у игрока по-прежнему нет');

  console.log('\n[3] Панель: список товаров и связка');
  await stop();
  await start({ LAVATOP_API_KEY: API_KEY, LAVATOP_WEBHOOK_KEY: HOOK_KEY, LAVATOP_CURRENCY: 'USD' });
  T = await login('owner1'); B = await login('buyer1');
  let B2 = await login('buyer2');
  st = await call('GET', '/api/admin/lavatop', T);
  ok(st.d.ready === true && /\/api\/payments\/lavatop\/webhook$/.test(st.d.webhookUrl), `адрес для кабинета: ${st.d.webhookUrl}`);
  ok((st.d.rows || []).some((r) => r.key === 'gold_100'), 'в списке есть пакеты золота');
  const prods = await call('GET', '/api/admin/lavatop/products', T);
  ok(prods.s === 200 && prods.d.products.length === 2, `товары подтянулись со всех страниц: ${prods.d.products.length}`, prods.d);
  ok(!prods.d.products.some((p) => /Новости/.test(p.title)), 'посты из ленты в список товаров не попали');
  ok(lavaCalls.some((c) => /contentCategories=PRODUCT/.test(c.url)), 'просим у Lava только товары');
  const p1 = prods.d.products.find((p) => p.offerId === OFFER_ID);
  ok(p1 && p1.price === 1.5 && p1.currency === 'USD' && /Золото 100/.test(p1.title), `цена и название: ${p1 && p1.title} — ${p1 && p1.price} ${p1 && p1.currency}`);
  ok(lavaCalls.some((c) => c.url.indexOf('/api/v2/products') === 0 && c.key === API_KEY), 'в Lava ушёл ключ API');
  const notOwner = await call('GET', '/api/admin/lavatop', B);
  ok(notOwner.s >= 400, 'обычному игроку раздел закрыт');
  let m = await call('POST', '/api/admin/lavatop/map', T, { key: 'gold_100', offerId: OFFER_ID, title: p1.title, amount: p1.price, currency: p1.currency });
  ok(m.s === 200, 'связка сохранена', m.d);
  pk = await call('GET', '/api/payments/packages', B);
  const gp = (pk.d.packages || []).find((p) => p.id === 'gold_100');
  ok(pk.d.lava.enabled === true && gp.lava && gp.lava.amount === 1.5 && gp.lava.currency === 'USD',
     `у пакета появилась зарубежная цена: ${gp.lava && gp.lava.amount} ${gp.lava && gp.lava.currency}`);
  ok(!(pk.d.packages || []).find((p) => p.id === 'gold_525').lava, 'у несвязанного пакета кнопки нет');

  console.log('\n[4] Заказ и оплата');
  await call('POST', '/api/admin/donate-bonus/save', T, { title: 'Первое пополнение', kind: 'gold', pct: 50, limit: 'first' });
  const gold0 = (await call('GET', '/api/me', B)).d.gold;
  const ord = await call('POST', '/api/payments/create', B, { packageId: 'gold_100', provider: 'lavatop' });
  ok(ord.s === 200 && /^https:\/\/app\.lava\.top\/pay\//.test(ord.d.payUrl || ''), 'ссылка на оплату от Lava', ord.d);
  const inv = lavaCalls.filter((c) => c.url === '/api/v3/invoice').pop();
  const invBody = JSON.parse(inv.body);
  ok(invBody.offerId === OFFER_ID && invBody.currency === 'USD' && invBody.email === 'buyer1@t.ru',
     'в Lava ушли товар, валюта и почта покупателя', invBody);
  ok(/\/#bank\/gold$/.test(invBody.successful_return_url || '') && invBody.failure_return_url === invBody.successful_return_url
     && invBody.cancel_return_url === invBody.successful_return_url,
     `после оплаты игрок вернётся в банк: ${invBody.successful_return_url}`, invBody);
  const contractId = ord.d.payUrl.split('/').pop();
  let bad = await hook(paid(contractId, 1.5), 'wrong-key');
  ok(bad.s === 401, 'чужой ключ — отказ');
  bad = await hook(paid(contractId, 1.5), null);
  ok(bad.s === 401, 'без ключа — отказ');
  // Ключ той же длины: короткий отсекается по длине, а этот — только сравнением
  bad = await hook(paid(contractId, 1.5), 'X'.repeat(HOOK_KEY.length));
  ok(bad.s === 401, 'ключ той же длины, но чужой — отказ');
  bad = await hook(paid('contract-999', 1.5));
  ok(bad.s === 400, 'чужой контракт — отказ');
  bad = await hook({ eventType: 'payment.failed', status: 'failed', contractId, amount: 1.5, currency: 'USD' });
  ok(bad.s === 200 && (await call('GET', '/api/me', B)).d.gold === gold0, 'отказ оплаты ничего не начислил');
  let good = await hook(paid(contractId, 1.5));
  ok(good.s === 200, 'верное уведомление принято');
  good = await hook(paid(contractId, 1.5));
  ok(good.s === 200, 'повтор — снова принят');
  const gold1 = (await call('GET', '/api/me', B)).d.gold;
  ok(gold1 - gold0 === 150, `зачислено ${gold1 - gold0} (100 + 50% за первое пополнение), повтор не удвоил`);
  const hist = await call('GET', '/api/payments/orders', B);
  const row = (hist.d.orders || []).find((o) => o.id === ord.d.orderId);
  ok(row && row.status === 'paid', 'заказ оплачен в истории игрока');
  const adm = await call('GET', '/api/admin/payments?q=' + ord.d.orderId, T);
  ok(JSON.stringify(adm.d).indexOf(API_KEY) < 0 && JSON.stringify(adm.d).indexOf(HOOK_KEY) < 0, 'ключей в панели нет');

  console.log('\n[4б] Логин и пароль вместо ключа; сумма в уведомлении другая');
  // Второй способ защиты из кабинета Lava: Authorization: Basic
  await stop();
  await start({ LAVATOP_API_KEY: API_KEY, LAVATOP_WEBHOOK_KEY: 'lavahook:' + HOOK_KEY, LAVATOP_CURRENCY: 'USD' });
  T = await login('owner1'); B = await login('buyer1'); B2 = await login('buyer2');
  await call('POST', '/api/admin/lavatop/map', T, { key: 'gold_100', offerId: OFFER_ID, title: 'Золото 100', amount: 1.5, currency: 'USD' });
  const gB = (await call('GET', '/api/me', B)).d.gold;
  const ord2 = await call('POST', '/api/payments/create', B, { packageId: 'gold_100', provider: 'lavatop' });
  const c2 = ord2.d.payUrl.split('/').pop();
  const basic = (pair) => ({ 'Authorization': 'Basic ' + Buffer.from(pair).toString('base64') });
  const hookH = async (body, headers) => {
    const r = await fetch(BASE + '/api/payments/lavatop/webhook', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });
    return r.status;
  };
  ok(await hookH(paid(c2, 1.5), basic('lavahook:неверный')) === 401, 'неверный пароль — отказ');
  ok(await hookH(paid(c2, 1.5), basic('чужой:' + HOOK_KEY)) === 401, 'чужой логин — отказ');
  // Сумма «неровная», как в примерах Lava (пересчёт или комиссия)
  ok(await hookH(paid(c2, 1.37), basic('lavahook:' + HOOK_KEY)) === 200, 'верные логин и пароль — принято');
  ok((await call('GET', '/api/me', B)).d.gold - gB === 100,
     'покупка выдана, хотя сумма в уведомлении отличается от цены: деньги у игрока уже списаны');
  const logs = await call('GET', '/api/admin/logs', T);
  ok(logs.s === 200 && JSON.stringify(logs.d).indexOf('проверьте в кабинете Lava') >= 0,
     'расхождение суммы записано владельцу в журнал');
  // Дальше снова способ «ключ в X-Api-Key» — как в остальных разделах
  await stop();
  await start({ LAVATOP_API_KEY: API_KEY, LAVATOP_WEBHOOK_KEY: HOOK_KEY, LAVATOP_CURRENCY: 'USD' });
  T = await login('owner1'); B = await login('buyer1'); B2 = await login('buyer2');

  console.log('\n[5] Наборы');
  const offRes = await call('POST', '/api/admin/offers/save', T, { title: 'Стартовый', items: [{ type: 'gold', qty: 700 }], priceRub: 199, enabled: true });
  const offId = offRes.d.id;
  let cat = (await call('GET', '/api/offers', B2)).d.offers.find((o) => o.id === offId);
  ok(cat && cat.canBuyRub === true && cat.canBuyLava === false, 'пока набор не связан — зарубежной кнопки нет');
  await call('POST', '/api/admin/lavatop/map', T, { key: 'offer:' + offId, offerId: OFFER2_ID, title: 'Стартовый набор', amount: 2.5, currency: 'USD' });
  cat = (await call('GET', '/api/offers', B2)).d.offers.find((o) => o.id === offId);
  ok(cat.canBuyLava === true, 'после связки кнопка появилась');
  const g0 = (await call('GET', '/api/me', B2)).d.gold;
  const oo = await call('POST', '/api/offers/order', B2, { offerId: offId, provider: 'lavatop' });
  ok(oo.s === 200 && /lava\.top/.test(oo.d.payUrl || ''), 'счёт на набор выставлен', oo.d);
  await hook(paid(oo.d.payUrl.split('/').pop(), 2.5));
  ok((await call('GET', '/api/me', B2)).d.gold - g0 === 700, 'набор выдан после оплаты');

  console.log('\n[6] Снятие связки');
  await call('POST', '/api/admin/lavatop/map', T, { key: 'gold_100', offerId: '' });
  pk = await call('GET', '/api/payments/packages', B);
  ok(!(pk.d.packages || []).find((p) => p.id === 'gold_100').lava, 'связка снята — кнопки нет');
  const after = await call('POST', '/api/payments/create', B, { packageId: 'gold_100', provider: 'lavatop' });
  ok(after.s !== 200, 'и заказать нельзя: ' + (after.d.error || ''));

  await stop();
  await new Promise((r) => lava.close(r));

  console.log('\n[7] Каталог: чужой адрес страницы и посты с ценой');
  // Прямо в модуле, с подменённым транспортом: так видно, КУДА он ходит
  process.env.LAVATOP_API_KEY = API_KEY;
  process.env.LAVATOP_WEBHOOK_KEY = HOOK_KEY;
  process.env.LAVATOP_API_URL = 'https://gate.lava.top';
  const L = require(ROOT + '/dist/src/services/lavatop');
  const visited = [];
  L.setTransport(async (url) => {
    visited.push(url);
    return { status: 200, text: JSON.stringify({
      items: [
        { type: 'PRODUCT', data: { title: 'Товар', offers: [{ id: 'o-1', prices: [{ amount: 3, currency: 'USD' }] }] } },
        // Платный пост с ценой — это не товар игры, в список не берём
        { type: 'POST', data: { title: 'Платный пост', offers: [{ id: 'o-post', prices: [{ amount: 1, currency: 'USD' }] }] } },
      ],
      // Следующая страница на ЧУЖОМ хосте: ключ API туда уйти не должен
      nextPage: 'https://evil.example/api/v2/products?beforeCreatedAt=x',
    }) };
  });
  let catErr = '', list7 = null;
  try { list7 = await L.products(); } catch (e) { catErr = e.message; }
  ok(!visited.some((u) => /evil\.example/.test(u)), 'на чужой адрес из nextPage ключ не ушёл');
  ok(/вне API Lava/.test(catErr), `и это честная ошибка, а не молчание: «${catErr}»`);
  L.setTransport(async () => ({ status: 200, text: JSON.stringify({ items: [
    { type: 'PRODUCT', data: { title: 'Товар', offers: [{ id: 'o-1', prices: [{ amount: 3, currency: 'USD' }] }] } },
    { type: 'POST', data: { title: 'Платный пост', offers: [{ id: 'o-post', prices: [{ amount: 1, currency: 'USD' }] }] } },
  ], nextPage: null }) }));
  list7 = await L.products();
  ok(list7.length === 1 && list7[0].offerId === 'o-1', 'пост с ценой в список товаров не попал');
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('⛔ ' + (e && e.stack || e));
  try { await stop(); lava.close(); } catch (x) {}
  process.exit(1);
});
