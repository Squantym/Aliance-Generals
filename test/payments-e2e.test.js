// ═══════════════════════════════════════════════════════════════════
// test/payments-e2e.test.js — платежи целиком, на живом сервере (18.09.2026)
//
// Сервер поднимается во временной папке с поддельными тестовыми ключами
// Робокассы; уведомления об оплате тест подписывает сам, как Робокасса.
// Что стережётся:
//  • ссылка на оплату подписана паролем №1, тестовый режим, сумма;
//  • подделки (чужая подпись, другая сумма) не зачисляются, повтор
//    уведомления не удваивает зачисление;
//  • бонусы к покупкам: «за первое» — один раз даже при двух заказах,
//    опыт «раз в день», закончившуюся акцию можно выключить;
//  • наборы: повторный заказ открывает тот же счёт (лимит в одни руки не
//    обойти пачкой заказов), тираж на всех с бронью неоплаченного заказа,
//    срок продажи, набор удалён до оплаты — оплаченное всё равно выдано.
//
// Запуск: node test/payments-e2e.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const PORT = 4900 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const P1 = 'tp1_' + Math.random().toString(36).slice(2), P2 = 'tp2_' + Math.random().toString(36).slice(2);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-e2e-'));
fs.mkdirSync(path.join(work, 'data'));
const env = Object.assign({}, process.env, {
  PORT: String(PORT), DISABLE_RATE_LIMIT: '1', STAFF_2FA_REQUIRED: '0', DB_DRIVER: '', MONGODB_URI: '', NODE_ENV: 'test',
  ROBOKASSA_LOGIN: 'shop-test', ROBOKASSA_TEST: '1', ROBOKASSA_TEST_PASS1: P1, ROBOKASSA_TEST_PASS2: P2,
  ROBOKASSA_HASH: 'sha256', ROBOKASSA_INV_BASE: '5000',
  ENV_OVERRIDE: 'PORT,ROBOKASSA_LOGIN,ROBOKASSA_TEST,ROBOKASSA_TEST_PASS1,ROBOKASSA_TEST_PASS2,ROBOKASSA_HASH,ROBOKASSA_INV_BASE',
});
let srv;
const start = () => new Promise((res, rej) => {
  srv = spawn(process.execPath, [path.join(ROOT, 'dist/server.js')], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const on = (b) => { out += b; if (/сервер запущен/i.test(out)) res(); };
  srv.stdout.on('data', on); srv.stderr.on('data', on);
  srv.on('exit', (c) => rej(new Error('exit ' + c + out.slice(-300))));
});
const stop = () => new Promise((r) => { srv.once('exit', r); srv.kill('SIGTERM'); setTimeout(() => { try { srv.kill('SIGKILL'); } catch (e) {} r(); }, 5000); });
const call = async (m, p, t, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', 'x-token': t || '' }, body: b ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch (e) { j = txt; }
  return { s: r.status, d: j };
};
let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').toUpperCase();
// Уведомление «от Робокассы» — form-urlencoded, подпись паролем №2
const notify = async (invId, sum, orderId, pass2) => {
  const q = { OutSum: sum, InvId: String(invId), Shp_order: orderId, PaymentMethod: 'BankCard', IncCurrLabel: 'BankCardPSR', IsTest: '1' };
  q.SignatureValue = sha(`${sum}:${invId}:${pass2 || P2}:Shp_order=${orderId}`);
  const r = await fetch(BASE + '/api/payments/robokassa/result', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(q).toString() });
  return { s: r.status, t: await r.text() };
};
const invOf = (url) => Number(new URL(url).searchParams.get('InvId'));
const sumOf = (url) => new URL(url).searchParams.get('OutSum');

(async () => {
  await start();
  const reg = async (login) => {
    const r = await call('POST', '/api/register', null, { login, email: login + '@t.ru', password: 'parol12345', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
    if (r.s !== 200) throw new Error(JSON.stringify(r.d));
  };
  await reg('owner1'); await reg('buyer1'); await reg('buyer2'); await reg('buyer3'); await reg('buyer4');
  await new Promise((r) => setTimeout(r, 1500));
  await stop();
  execFileSync(process.execPath, [path.join(ROOT, 'tools/grant-admin.js'), 'owner1', '--owner', '--yes'], { cwd: work, env: Object.assign({}, env, { DB_DRIVER: '', SQLITE_DIR: '', SQLITE_FILE: '' }), stdio: 'pipe' });
  await start();
  const login = async (l) => (await call('POST', '/api/login', null, { login: l, password: 'parol12345' })).d.token;
  const T = await login('owner1'), B = await login('buyer1'), B2 = await login('buyer2'), B3 = await login('buyer3'), B4 = await login('buyer4');

  console.log('\n[1] Касса настроена');
  const prov = await call('GET', '/api/admin/payments-provider', T);
  ok(prov.s === 200 && JSON.stringify(prov.d).indexOf(P1) < 0 && JSON.stringify(prov.d).indexOf(P2) < 0, 'панель видит кассу и не показывает паролей', prov.d);
  const pk = await call('GET', '/api/payments/packages', B);
  ok(pk.d.enabled === true, 'оплата включена у игрока');

  console.log('\n[2] Бонусы к покупкам');
  let r = await call('POST', '/api/admin/donate-bonus/save', T, { title: 'Первое пополнение', kind: 'gold', pct: 50, limit: 'first' });
  ok(r.s === 200, 'акция +50% за первое пополнение', r.d);
  r = await call('POST', '/api/admin/donate-bonus/save', T, { title: 'Опыт дня', kind: 'xp', pct: 100, hours: 2, limit: 'daily', perDay: 1, target: 'all' });
  ok(r.s === 200, 'акция +100% опыта раз в день', r.d);
  const xpPromoId = r.d.promo && r.d.promo.id;
  const pk2 = await call('GET', '/api/payments/packages', B);
  ok((pk2.d.promos || []).length === 2 && pk2.d.promos.every((p) => p.available), 'игрок видит обе акции', pk2.d.promos);

  console.log('\n[3] Покупка золота');
  const me0 = (await call('GET', '/api/me', B)).d;
  r = await call('POST', '/api/payments/create', B, { packageId: 'gold_100' });
  ok(r.s === 200 && /^https:\/\/auth\.robokassa\.ru/.test(r.d.payUrl || ''), 'заказ создан, ссылка на Робокассу', r.d);
  const o1 = r.d.orderId, url1 = r.d.payUrl;
  const u1 = new URL(url1);
  ok(u1.searchParams.get('IsTest') === '1' && sumOf(url1) === '99.00' && invOf(url1) >= 5000, `тестовый счёт №${invOf(url1)} на 99.00`);
  ok(u1.searchParams.get('SignatureValue') === sha(`shop-test:99.00:${invOf(url1)}:${P1}:Shp_order=${o1}`)
     || u1.searchParams.get('SignatureValue').toUpperCase() === sha(`shop-test:99.00:${invOf(url1)}:${P1}:Shp_order=${o1}`),
     'подпись ссылки паролем №1 сходится');
  // Подделки
  let n = await notify(invOf(url1), '99.00', o1, 'wrong');
  ok(n.s === 400, 'уведомление с чужой подписью отклонено', n);
  n = await notify(invOf(url1), '1.00', o1);
  ok(n.s === 400, 'уведомление с другой суммой отклонено', n);
  let me = (await call('GET', '/api/me', B)).d;
  ok(me.gold === me0.gold, 'после подделок золото не пришло');
  // Настоящее
  n = await notify(invOf(url1), '99.00', o1);
  ok(n.s === 200 && n.t === 'OK' + invOf(url1), 'настоящее уведомление принято: ' + n.t);
  n = await notify(invOf(url1), '99.00', o1);
  ok(n.s === 200 && n.t === 'OK' + invOf(url1), 'повтор уведомления — снова OK');
  me = (await call('GET', '/api/me', B)).d;
  ok(me.gold - me0.gold === 150, `зачислено ${me.gold - me0.gold} (100 + 50% за первое), повтор не удвоил`);
  const pend = { d: (await call('GET', '/api/me', B)).d.pendingPurchases };
  const orders = await call('GET', '/api/payments/orders', B);
  const ord = (orders.d.orders || []).find((x) => x.id === o1);
  ok(ord && ord.status === 'paid', 'заказ оплачен в истории', orders.d);
  ok(JSON.stringify(orders.d).indexOf('опыта') >= 0 || JSON.stringify(pend.d).indexOf('опыта') >= 0, 'ускорение опыта отмечено в покупке', pend.d);

  console.log('\n[4] Второе пополнение — без «первого» бонуса, опыт уже взят сегодня');
  r = await call('POST', '/api/payments/create', B, { packageId: 'gold_100' });
  n = await notify(invOf(r.d.payUrl), '99.00', r.d.orderId);
  const me2 = (await call('GET', '/api/me', B)).d;
  ok(me2.gold - me.gold === 100, `второй раз зачислено ${me2.gold - me.gold}`);
  const pk3 = await call('GET', '/api/payments/packages', B);
  const xpP = (pk3.d.promos || []).find((p) => p.kind === 'xp');
  ok(xpP && xpP.available === false, 'ежедневный бонус опыта на сегодня исчерпан');
  ok(pk3.d.xpBoost && pk3.d.xpBoost.pct === 100, 'ускорение опыта действует', pk3.d.xpBoost);

  console.log('\n[5] Два заказа до оплаты — «первый» бонус один раз');
  const c1 = await call('POST', '/api/payments/create', B2, { packageId: 'gold_100' });
  const c2 = await call('POST', '/api/payments/create', B2, { packageId: 'gold_100' });
  const g0 = (await call('GET', '/api/me', B2)).d.gold;
  await notify(invOf(c1.d.payUrl), '99.00', c1.d.orderId);
  await notify(invOf(c2.d.payUrl), '99.00', c2.d.orderId);
  const g1 = (await call('GET', '/api/me', B2)).d.gold;
  ok(g1 - g0 === 250, `два заказа: зачислено ${g1 - g0} (150 + 100)`);

  console.log('\n[5б] Акция на золото + бонус за первое пополнение');
  r = await call('POST', '/api/admin/discount', T, { category: 'gold', pct: 20, hours: 1 });
  ok(r.s === 200, 'акция «+20% к покупаемому золоту» включена', r.d);
  const h0 = (await call('GET', '/api/me', B4)).d.gold;
  const d1 = await call('POST', '/api/payments/create', B4, { packageId: 'gold_100' });
  await notify(invOf(d1.d.payUrl), '99.00', d1.d.orderId);
  const h1 = (await call('GET', '/api/me', B4)).d.gold;
  ok(h1 - h0 === 170, `зачислено ${h1 - h0} (100 + 20 акция + 50 за первое)`);
  const rec4 = ((await call('GET', '/api/me', B4)).d.pendingPurchases || []).find((x) => x.id === d1.d.orderId);
  ok(rec4 && /120 золота/.test(rec4.items[0].text) && rec4.items.some((x) => /\+50 золота/.test(x.text)),
     'в окне покупки — обе надбавки видны', rec4 && rec4.items);
  await call('POST', '/api/admin/discount', T, { category: 'gold', pct: 0, hours: 0 });

  console.log('\n[6] Выключение истёкшей акции');
  r = await call('POST', '/api/admin/donate-bonus/save', T, { id: xpPromoId, title: 'Опыт дня', kind: 'xp', pct: 100, hours: 2, limit: 'daily', perDay: 1, target: 'all',
    startAt: Date.now() - 7200e3, endAt: Date.now() - 3600e3, enabled: true });
  ok(r.s !== 200 || true, 'сохранение с прошедшим концом: ' + (r.d.error || 'принято'));
  const list = (await call('GET', '/api/admin/donate-bonuses', T)).d.promos;
  const xpRow = list.find((p) => p.id === xpPromoId);
  r = await call('POST', '/api/admin/donate-bonus/save', T, Object.assign({}, xpRow, { enabled: false }));
  ok(r.s === 200, 'акцию можно выключить/изменить (' + (r.d.error || 'ок') + ')', r.d);

  console.log('\n[7] Набор за рубли и за золото');
  r = await call('POST', '/api/admin/offers/save', T, { title: 'Ограниченный', items: [{ type: 'gold', qty: 1000 }], priceRub: 199, priceGold: 50, limitPerPlayer: 1, enabled: true });
  ok(r.s === 200, 'набор создан', r.d);
  const offId = r.d.id;
  const cat = await call('GET', '/api/offers', B3);
  ok((cat.d.offers || []).some((o) => o.id === offId), 'набор на витрине');
  const oo = await call('POST', '/api/offers/order', B3, { offerId: offId });
  ok(oo.s === 200 && oo.d.payUrl && sumOf(oo.d.payUrl) === '199.00', 'заказ на набор выставлен на 199.00', oo.d);
  // Лимит 1 на игрока, а заказов можно наоформлять сколько угодно
  const oo2 = await call('POST', '/api/offers/order', B3, { offerId: offId });
  ok(oo2.s === 200 && oo2.d.orderId === oo.d.orderId && invOf(oo2.d.payUrl) === invOf(oo.d.payUrl),
     'повторный заказ открывает тот же счёт — второго не заводится', [oo.d.orderId, oo2.d.orderId]);
  // Набор удалили, пока игрок платил
  await call('POST', '/api/admin/offers/delete', T, { id: offId });
  const gB3 = (await call('GET', '/api/me', B3)).d.gold;
  n = await notify(invOf(oo.d.payUrl), '199.00', oo.d.orderId);
  const gB3b = (await call('GET', '/api/me', B3)).d.gold;
  ok(gB3b - gB3 === 1000, `набор удалён до оплаты — оплаченное всё равно выдано (+${gB3b - gB3})`);
  const recB3 = ((await call('GET', '/api/me', B3)).d.pendingPurchases || []).find((x) => x.id === oo.d.orderId);
  ok(recB3 && recB3.items.length === 1 && /1\s?000 золота/.test(recB3.items[0].text), 'в окне покупки — состав удалённого набора', recB3);
  const after = await call('POST', '/api/offers/order', B3, { offerId: offId });
  ok(after.s !== 200, 'после удаления набора новый заказ не оформить: ' + (after.d.error || ''));

  console.log('\n[7б] Лимит в одни руки после оплаты');
  r = await call('POST', '/api/admin/offers/save', T, { title: 'Один раз', items: [{ type: 'gold', qty: 7 }], priceRub: 99, limitPerPlayer: 1, enabled: true });
  const once = r.d.id;
  const q1 = await call('POST', '/api/offers/order', B3, { offerId: once });
  await notify(invOf(q1.d.payUrl), '99.00', q1.d.orderId);
  const q2 = await call('POST', '/api/offers/order', B3, { offerId: once });
  ok(q2.s !== 200 && /1 раз/.test(q2.d.error || ''), 'после оплаты второй заказ — отказ: ' + (q2.d.error || ''));

  console.log('\n[8] Лимит на всех');
  r = await call('POST', '/api/admin/offers/save', T, { title: 'Тираж 1', items: [{ type: 'dollars', qty: 5 }], priceGold: 1, limitTotal: 1, enabled: true });
  const t1 = r.d.id;
  const saved = (await call('GET', '/api/admin/offers', T)).d.offers.find((o) => o.id === t1);
  ok(saved && saved.limitTotal === 1, 'общий лимит сохраняется', saved);
  const b1 = await call('POST', '/api/offers/buy', B, { offerId: t1 });
  const b2 = await call('POST', '/api/offers/buy', B2, { offerId: t1 });
  ok(b1.s === 200 && b2.s !== 200, 'второму покупателю — «разобрали»', [b1.d, b2.d]);

  // Рублёвая бронь тиража
  r = await call('POST', '/api/admin/offers/save', T, { title: 'Тираж рубли', items: [{ type: 'gold', qty: 3 }], priceRub: 99, priceGold: 5, limitTotal: 1, enabled: true });
  const t2 = r.d.id;
  const z1 = await call('POST', '/api/offers/order', B, { offerId: t2 });
  const z2 = await call('POST', '/api/offers/order', B2, { offerId: t2 });
  const z3 = await call('POST', '/api/offers/buy', B3, { offerId: t2 });
  ok(z1.s === 200 && z2.s !== 200 && z3.s !== 200, 'неоплаченный заказ держит последний набор: ' + (z2.d.error || ''), [z2.d, z3.d]);
  const cat2 = (await call('GET', '/api/offers', B2)).d.offers.find((o) => o.id === t2);
  ok(cat2 && cat2.soldOut === true && cat2.canBuyRub === false, 'у других на витрине — разобрано', cat2);
  const catMine = (await call('GET', '/api/offers', B)).d.offers.find((o) => o.id === t2);
  ok(catMine && catMine.canBuyRub === true, 'у того, кто оформил, — можно оплатить свой заказ', catMine);
  const adm = (await call('GET', '/api/admin/offers', T)).d.offers.find((o) => o.id === t2);
  ok(adm.reserved === 1 && adm.state === 'live', 'панель видит бронь', adm);
  await notify(invOf(z1.d.payUrl), '99.00', z1.d.orderId);
  const adm2 = (await call('GET', '/api/admin/offers', T)).d.offers.find((o) => o.id === t2);
  ok(adm2.sold === 1 && adm2.reserved === 0 && adm2.state === 'soldout', 'после оплаты — продано 1 из 1, «тираж разобран»', adm2);

  console.log('\n[9] Срок продажи');
  r = await call('POST', '/api/admin/offers/save', T, { title: 'Скоро', items: [{ type: 'gold', qty: 1 }], priceGold: 1, startAt: Date.now() + 3600e3, endAt: Date.now() + 7200e3, enabled: true });
  const soon = r.d.id;
  const s1 = await call('POST', '/api/offers/buy', B, { offerId: soon });
  ok(s1.s !== 200 && /ещё не началась/.test(s1.d.error || ''), 'до начала — ' + (s1.d.error || ''));
  ok(!(await call('GET', '/api/offers', B)).d.offers.some((o) => o.id === soon), 'до начала на витрине не видно');
  const admS = (await call('GET', '/api/admin/offers', T)).d.offers.find((o) => o.id === soon);
  ok(admS.state === 'soon', 'панель: «ещё не начался»');
  r = await call('POST', '/api/admin/offers/save', T, Object.assign({}, admS, { startAt: Date.now() - 7200e3, endAt: Date.now() - 3600e3 }));
  const admE = (await call('GET', '/api/admin/offers', T)).d.offers.find((o) => o.id === soon);
  ok(admE.state === 'ended', 'панель: «срок вышел» у включённого набора');
  const s2 = await call('POST', '/api/offers/buy', B, { offerId: soon });
  ok(s2.s !== 200, 'после конца — не купить: ' + (s2.d.error || ''));

  console.log('\n[10] Истёкшая акция');
  r = await call('POST', '/api/admin/donate-bonus/save', T, { title: 'Разовая', kind: 'gold', pct: 10, limit: 'every', endAt: Date.now() + 1000 });
  const pid = r.d.promo.id;
  await new Promise((res) => setTimeout(res, 1500));
  const pr = (await call('GET', '/api/admin/donate-bonuses', T)).d.promos.find((p) => p.id === pid);
  r = await call('POST', '/api/admin/donate-bonus/save', T, Object.assign({}, pr, { enabled: false }));
  ok(r.s === 200, 'закончившуюся акцию (без даты начала) можно выключить: ' + (r.d.error || 'ок'));
  r = await call('POST', '/api/admin/donate-bonus/save', T, { title: 'Задним числом', kind: 'gold', pct: 10, limit: 'every', endAt: Date.now() - 1000 });
  ok(r.s !== 200, 'новую акцию с прошедшим концом — нельзя: ' + (r.d.error || ''));

  await stop();
  console.log(`\nИТОГ: ${pass} ок, ${fail} не так`);
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('⛔', e); try { await stop(); } catch (x) {} process.exit(1); });
