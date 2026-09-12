// ===================================================================
// src/services/payments.ts — покупки за рубли через ЮKassa.
//
// Как устроено:
//   1. Игрок жмёт «Купить» — создаётся заказ (pending), за ним платёж в
//      ЮKassa, и игрок уходит на страницу оплаты (СБП, карта, T-Pay,
//      SberPay — что включено в магазине).
//   2. ЮKassa присылает уведомление на /api/payments/yookassa. Телу
//      уведомления НЕ верим: статус, сумму и номер заказа берём запросом
//      в ЮKassa по id платежа. Подделанное уведомление ничего не начислит.
//   3. Вернувшись в игру, клиент сам просит сверить заказ
//      (/api/payments/check) — на случай, если уведомление задержалось.
//   4. Зачисление — confirmPayment, и только из статуса pending: повторное
//      уведомление и сверка второй раз ничего не дадут.
//   5. После зачисления игрок видит окно покупки, а в почту приходит
//      квитанция от «Система». Кнопка «Забрать» в окне только закрывает
//      его: покупка УЖЕ на счету (см. ackPurchase).
//
// Для разбора проблем с оплатой заказ хранит всё, что о платеже знает
// ЮKassa (способ, банк, карта без полного номера, суммы, коды), откуда
// платил покупатель (адрес, устройство) и историю уведомлений. Смотрит
// это только владелец — раздел «Платежи» в панели.
//
// Пока ключей магазина нет в .env, оплата выключена: заказ создаётся без
// платежа, как было до интеграции.
//
// Хранение: коллекция 'payments' = { [orderId]: PaymentOrder }
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import brand = require('../core/brand');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

// Каталог пакетов золота. База — 100 золота за 99 ₽, дальше «цена + 10»:
// 500 за 490, 1000 за 990 и так до 10 000 за 9 990. Сверху — надбавка за
// объём, шаг +5% на ступень. В поле gold золото уже С надбавкой, и
// процент честный: 525 = 500 + 5%. Округлять до «красивых» чисел нельзя —
// тогда заявленный процент перестанет совпадать с фактом, а это оферта.
//
// Эти цены опубликованы в public/payments.html (п. 2.6). Тест legal-docs
// сверяет таблицу построчно и пересчитывает каждый процент.
const PACKAGES = [
  { id: 'gold_100',   gold: 100,   priceRub: 99,   label: '100 золота' },
  { id: 'gold_525',   gold: 525,   priceRub: 490,  label: '525 золота',   bonus: '+5%' },
  { id: 'gold_1100',  gold: 1100,  priceRub: 990,  label: '1100 золота',  bonus: '+10%' },
  { id: 'gold_2875',  gold: 2875,  priceRub: 2490, label: '2875 золота',  bonus: '+15%' },
  { id: 'gold_6000',  gold: 6000,  priceRub: 4990, label: '6000 золота',  bonus: '+20%' },
  { id: 'gold_9375',  gold: 9375,  priceRub: 7490, label: '9375 золота',  bonus: '+25%' },
  { id: 'gold_13000', gold: 13000, priceRub: 9990, label: '13000 золота', bonus: '+30%' },
];

// Предел одной покупки за деньги — 9 990 ₽. Записан в оферте (Правила
// платежей, п. 2.7 и 6.6) и держится здесь: конструктор наборов не даст
// выставить набор дороже. Уже оформленные заказы старых пакетов не
// ломаются — золото и цена хранятся в самом заказе.
const MAX_PRICE_RUB = 9990;

// Неоплаченных заказов за час — не больше этого. Каждый заказ — запрос в
// ЮKassa; без предела один человек с кнопкой «Купить» устроил бы
// платёжному сервису нагрузку от нашего имени.
const PENDING_PER_HOUR = 10;
// Сверку игрок может дёргать часто — в ЮKassa ходим не чаще раза в 5 с
const CHECK_COOLDOWN_MS = 5000;
// Сколько окон непросмотренных покупок держим в очереди у игрока
const UNSEEN_MAX = 10;
// Сколько уведомлений ЮKassa помним на заказ
const KEEP_EVENTS = 30;

const GOLD_ICON = '/img/icons/gold.webp';
const GOLD_IMAGE = '/img/tabs/bank_gold.webp';
const OFFER_IMAGE = '/img/menu/bank.webp';

// Способы оплаты на выбор в игре. type — как способ называет API ЮKassa.
// Логотипы — только официальные файлы брендов (брендбук НСПК прямо требует
// оригиналы, перерисовывать чужие знаки нельзя). Они лежат в
// public/img/pay/<id>.svg|png|webp; пока файла нет, на плашке пишется
// название — лучше честная надпись, чем самодельный логотип.
const METHODS = [
  { id: 'sbp',     type: 'sbp',          name: 'Система быстрых платежей (СБП)', hint: 'Оплатите через приложение своего банка' },
  { id: 'sberpay', type: 'sberbank',     name: 'SberPay', hint: 'Оплата в приложении СберБанк Онлайн' },
  { id: 'tpay',    type: 'tinkoff_bank', name: 'T-Pay',   hint: 'Оплата в приложении Т-Банка' },
];

function logoFor(id: string): string {
  const path = require('path');
  const fsm = require('fs');
  for (const ext of ['svg', 'png', 'webp']) {
    const rel = `/img/pay/${id}.${ext}`;
    try { if (fsm.existsSync(path.join(__dirname, '../../../public', rel))) return rel; } catch (e) {}
  }
  return '';
}

function methodsView() {
  return METHODS.map((m) => ({ id: m.id, name: m.name, hint: m.hint, logo: logoFor(m.id) }));
}

type ReceiptLine = { text: string; icon: string | null };
type Buyer = { ip: string; device: string; ua: string; fp: string; did: string; at: number };

interface PaymentOrder {
  id: string;
  userId: string;
  packageId: string;
  offerId?: string;        // заказ на набор «Спецпредложений», а не на пакет золота
  title?: string;
  gold: number;
  priceRub: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  createdAt: number;
  paidAt?: number;
  provider?: string;       // 'yookassa'
  providerRef?: string;    // id платежа в ЮKassa
  method?: string;         // способ, выбранный в игре: sbp / sberpay / tpay
  promos?: any[];          // бонусы к покупке, обещанные на момент заказа
  promoApplied?: any[];    // что из них начислено при оплате
  payUrl?: string;         // страница оплаты
  creditedGold?: number;   // сколько золота зачислено на самом деле (с акцией и VIP)
  // Что куплено — снимок на момент оплаты: для окна покупки и квитанции
  receipt?: { lines: ReceiptLine[]; image: string };
  cancelReason?: string;
  checkedAt?: number;
  refundedRub?: number;
  refundIds?: string[];
  // ── Для разбора ──
  buyer?: Buyer;           // откуда нажали «Купить»
  yk?: any;                // последний ответ ЮKassa о платеже целиком
  ykSyncedAt?: number;
  events?: Array<{ at: number; event: string; ip: string; status: string }>;
  refunds?: any[];         // ответы ЮKassa о возвратах
}

function store(): Record<string, PaymentOrder> {
  return db.load<Record<string, PaymentOrder>>('payments', {});
}

function yk() { return require('./yookassa'); }

// Условия бонусов к покупке — в заказ в момент его создания: что игрок
// видел до оплаты, то и получит (services/donateBonus.ts)
function promoSnapshot(user: User, order: PaymentOrder): any[] {
  try { return require('./donateBonus').snapshot(user, order); } catch (e) { return []; }
}

// Адрес игры для возврата со страницы оплаты — тот же, что в письмах
function appUrl(): string {
  let base = '';
  try { base = require('./email').APP_URL || ''; } catch (e) { base = ''; }
  return String(base).replace(/\/+$/, '');
}

const num = (v: number) => Number(v || 0).toLocaleString('ru-RU');

// Время по Москве словами: «11.09.2026 15:47»
function mskTime(ts: number): string {
  const d = new Date((ts || Date.now()) + u.MSK_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function orderTitle(o: PaymentOrder): string {
  return o.offerId ? `Набор «${o.title || 'Спецпредложение'}»` : `${num(o.gold)} золота`;
}

// Копия ответа ЮKassa для хранения. Полного номера карты в нём нет —
// ЮKassa отдаёт только первые 6 и последние 4 цифры, — поэтому храним
// целиком: при разборе спора нужна каждая мелочь, а заранее угадать,
// какая именно, нельзя. Слишком большой ответ урезаем до главного.
function snap(obj: any): any {
  if (!obj) return null;
  let copy: any;
  try { copy = JSON.parse(JSON.stringify(obj)); } catch (e) { return null; }
  if (JSON.stringify(copy).length > 20000) {
    const keep = ['id', 'status', 'paid', 'test', 'amount', 'income_amount', 'refunded_amount', 'created_at',
      'captured_at', 'description', 'payment_method', 'authorization_details', 'cancellation_details', 'metadata'];
    const small: any = {};
    for (const k of keep) if (copy[k] !== undefined) small[k] = copy[k];
    return small;
  }
  return copy;
}

function buyerOf(meta: any): Buyer | undefined {
  if (!meta) return undefined;
  let device = '';
  try { device = require('./access').parseDevice(meta.ua || '', meta.hints).label; } catch (e) { device = ''; }
  return {
    ip: String(meta.ip || '').slice(0, 60),
    device: String(device || '').slice(0, 120),
    ua: String(meta.ua || '').slice(0, 300),
    fp: String(meta.fp || '').slice(0, 200),
    did: String(meta.did || '').slice(0, 64),
    at: Date.now(),
  };
}

// Каталог пакетов (для витрины)
function packages(user?: User) {
  const on = yk().configured();
  let promos: any[] = [], xpBoost: any = null;
  if (user) {
    try { promos = require('./donateBonus').forPlayer(user); } catch (e) { promos = []; }
    try { xpBoost = require('./donateBonus').xpBoostView(user); } catch (e) { xpBoost = null; }
  }
  return {
    packages: PACKAGES, enabled: on, note: on ? '' : 'Платёжная система скоро будет доступна.',
    methods: on ? methodsView() : [],
    promos, xpBoost,
    discount: require('./discounts').info('gold'),
  };
}

function assertNotFlooding(user: User) {
  const hourAgo = Date.now() - 3600 * 1000;
  const n = Object.values(store())
    .filter((o) => o.userId === user.id && o.status === 'pending' && o.createdAt > hourAgo).length;
  if (n >= PENDING_PER_HOUR) {
    throw new u.ApiError('Слишком много неоплаченных заказов за час. Оплатите начатый или попробуйте позже.');
  }
}

// Создать заказ. Платёж в ЮKassa создаёт pay() — отдельным шагом, потому
// что это запрос в сеть, а заказ на набор приходит из offers.ts готовым.
function createOrder(user: User, packageId: string, notices: Notices) {
  const pkg = PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw new u.ApiError('Пакет не найден');
  assertNotFlooding(user);

  const order: PaymentOrder = {
    id: u.uid(16),
    userId: user.id,
    packageId: pkg.id,
    gold: pkg.gold,
    priceRub: pkg.priceRub,
    status: 'pending',
    createdAt: Date.now(),
  };
  order.promos = promoSnapshot(user, order);
  const all = store();
  all[order.id] = order;
  db.save('payments');

  if (!yk().configured()) notices.push('🛒 Заказ создан. Онлайн-оплата появится после подключения платёжной системы.');
  return { orderId: order.id, status: order.status, payUrl: null as string | null };
}

// Заказ на набор из «Спецпредложений». Отличается от пакета золота
// только тем, что выдаётся при подтверждении: сам набор знает, что в
// нём лежит (offers.grantPaid).
function createOfferOrder(user: User, offer: { id: string; title: string; priceRub: number }, notices: Notices) {
  assertNotFlooding(user);
  const order: PaymentOrder = {
    id: u.uid(16),
    userId: user.id,
    packageId: 'offer:' + offer.id,
    offerId: offer.id,
    title: offer.title,
    gold: 0,
    priceRub: offer.priceRub,
    status: 'pending',
    createdAt: Date.now(),
  };
  order.promos = promoSnapshot(user, order);
  const all = store();
  all[order.id] = order;
  db.save('payments');
  if (!yk().configured()) notices.push(`🛒 Заказ на «${offer.title}» создан. Онлайн-оплата появится после подключения платёжной системы.`);
  return { orderId: order.id, status: order.status, payUrl: null as string | null };
}

// Платёж в ЮKassa по уже созданному заказу. Без ключей — ничего не
// делает, заказ остаётся как есть. meta — откуда нажали «Купить»: адрес
// и устройство записываются в заказ в любом случае.
async function pay(user: User, created: { orderId: string; status: string; payUrl: string | null }, notices: Notices, meta?: any) {
  const order = store()[created.orderId];
  if (!order || order.userId !== user.id) throw new u.ApiError('Заказ не найден');
  const buyer = buyerOf(meta);
  if (buyer) { order.buyer = buyer; db.save('payments'); }
  if (!yk().configured()) return created;
  const wanted = String((meta && meta.method) || '');
  const method = METHODS.find((m) => m.id === wanted) || null;
  if (wanted && !method) throw new u.ApiError('Выберите способ оплаты из предложенных');
  // Описание уходит в ЮKassa и в чек — там должно быть понятно, за что платили
  const description = order.offerId
    ? `Игровой набор «${order.title || 'Спецпредложение'}» — «${brand.GAME_NAME}»`
    : `${order.gold} золота — игровая валюта «${brand.GAME_NAME}»`;
  try {
    const p = await yk().createPayment({
      orderId: order.id,
      amountRub: order.priceRub,
      description,
      returnUrl: `${appUrl()}/#bank/${order.offerId ? 'offers' : 'gold'}`,
      methodType: method ? method.type : undefined,
    });
    const ref = String((p && p.id) || '');
    const url = String((p && p.confirmation && p.confirmation.confirmation_url) || '');
    if (!ref || !url) throw new Error('в ответе нет id платежа или ссылки на оплату');
    order.provider = 'yookassa';
    order.method = method ? method.id : '';
    order.providerRef = ref;
    order.payUrl = url;
    order.yk = snap(p);
    order.ykSyncedAt = Date.now();
    db.save('payments');
    return { orderId: order.id, status: order.status, payUrl: url };
  } catch (e: any) {
    order.status = 'failed';
    db.save('payments');
    console.error(`⚠️  ЮKassa: платёж по заказу ${order.id} не создан — ${e && e.message}`);
    // Способ не включён в магазине или временно недоступен — так и говорим,
    // иначе игрок решил бы, что сломана вся оплата
    if (method && /payment_method|payment method|method/i.test(String(e && e.message))) {
      throw new u.ApiError(`${method.name} сейчас недоступен — выберите другой способ оплаты. Деньги не списаны.`);
    }
    throw new u.ApiError('Платёжный сервис не ответил. Деньги не списаны — попробуйте через минуту.');
  }
}

// Сверка заказа с ЮKassa. Решение принимается ТОЛЬКО по ответу ЮKassa:
// платёж тот самый, оплачен, в рублях, на сумму заказа и с номером
// этого заказа в metadata. Любое расхождение — не зачисляем и поднимаем
// тревогу в журнале: такое бывает только при ошибке или подлоге.
async function syncOrder(order: PaymentOrder): Promise<string> {
  if (!order.providerRef || order.status !== 'pending') return order.status;
  const p = await yk().getPayment(order.providerRef);
  if (!p || p.id !== order.providerRef) return order.status;
  order.yk = snap(p);
  order.ykSyncedAt = Date.now();
  db.save('payments');
  const metaOk = !!(p.metadata && String(p.metadata.orderId) === order.id);
  const amountOk = !!(p.amount && p.amount.currency === 'RUB'
    && Math.round(Number(p.amount.value) * 100) === Math.round(order.priceRub * 100));

  if (p.status === 'succeeded' && p.paid === true) {
    if (metaOk && amountOk) {
      confirmPayment(order.id);
    } else {
      console.error(`⛔ ЮKassa: платёж ${p.id} не совпал с заказом ${order.id} (номер: ${metaOk}, сумма: ${amountOk}) — не зачислено`);
      auditLog.record({
        userId: order.userId, userName: '', path: '/system/payment-mismatch',
        desc: `⛔ Оплата не совпала с заказом ${order.id}: ${metaOk ? '' : 'чужой номер заказа '}${amountOk ? '' : 'другая сумма'} — не зачислено`,
        body: { orderId: order.id, paymentId: p.id },
      });
    }
  } else if (p.status === 'canceled') {
    order.status = 'cancelled';
    order.cancelReason = String((p.cancellation_details && p.cancellation_details.reason) || '').slice(0, 60);
    db.save('payments');
  }
  return order.status;
}

// Игрок вернулся со страницы оплаты — сверяем его заказ
async function checkOrder(user: User, orderId: string) {
  const order = store()[String(orderId || '')];
  if (!order || order.userId !== user.id) throw new u.ApiError('Заказ не найден');
  if (order.status !== 'pending' || !order.providerRef) {
    return { orderId: order.id, status: order.status, gold: order.creditedGold || 0 };
  }
  if (order.checkedAt && Date.now() - order.checkedAt < CHECK_COOLDOWN_MS) {
    return { orderId: order.id, status: order.status, gold: 0 };
  }
  order.checkedAt = Date.now();
  try {
    await syncOrder(order);
  } catch (e: any) {
    console.error(`⚠️  ЮKassa: сверка заказа ${order.id} не удалась — ${e && e.message}`);
    throw new u.ApiError('Не удалось сверить оплату. Если деньги списаны, покупка придёт автоматически.');
  }
  return { orderId: order.id, status: order.status, gold: order.creditedGold || 0 };
}

function logEvent(order: PaymentOrder, event: string, meta: any, status: string) {
  const list = order.events || (order.events = []);
  list.push({ at: Date.now(), event: String(event || '').slice(0, 40), ip: String((meta && meta.ip) || '').slice(0, 60), status: String(status || '').slice(0, 30) });
  while (list.length > KEEP_EVENTS) list.shift();
  db.save('payments');
}

// Уведомление от ЮKassa. Платёж, которого нет среди наших заказов, не
// проверяем вовсе: иначе любой мог бы заставить сервер слать запросы в
// ЮKassa, подсовывая выдуманные номера.
// Ошибка связи с ЮKassa пробрасывается наружу — маршрут ответит 500, и
// ЮKassa повторит уведомление сама.
async function handleNotification(body: any, meta?: any) {
  const event = String((body && body.event) || '');
  const obj = body && body.object;
  if (!obj || typeof obj.id !== 'string') return { ok: true };
  const all = Object.values(store());

  if (event.indexOf('refund.') === 0) {
    const order = all.find((o) => !!o.providerRef && o.providerRef === obj.payment_id);
    if (!order) return { ok: true };
    logEvent(order, event, meta, String(obj.status || ''));
    const r = await yk().getRefund(obj.id);
    if (r && r.payment_id === order.providerRef) {
      const list = order.refunds || (order.refunds = []);
      const i = list.findIndex((x: any) => x && x.id === r.id);
      if (i >= 0) list[i] = snap(r); else list.push(snap(r));
    }
    const ids = order.refundIds || (order.refundIds = []);
    if (r && r.status === 'succeeded' && r.payment_id === order.providerRef && ids.indexOf(r.id) === -1) {
      const rub = Number(r.amount && r.amount.value) || 0;
      ids.push(r.id);
      order.refundedRub = Math.round(((order.refundedRub || 0) + rub) * 100) / 100;
      const who: any = require('./player').users()[order.userId];
      // Золото автоматически не списываем: возврат бывает частичным, а часть
      // покупки игрок мог уже потратить — решение за владельцем
      auditLog.record({
        userId: order.userId, userName: (who && who.name) || '', path: '/system/payment-refund',
        desc: `💸 Возврат ${rub} ₽ по заказу ${order.id}. Золото и набор автоматически не списаны — решите вручную`,
        body: { orderId: order.id, refundRub: rub },
      });
    }
    db.save('payments');
    return { ok: true };
  }

  const order = all.find((o) => !!o.providerRef && o.providerRef === obj.id);
  if (!order) return { ok: true };
  logEvent(order, event, meta, String(obj.status || ''));
  await syncOrder(order);
  return { ok: true };
}

// История заказов игрока
function myOrders(user: User) {
  const all = store();
  const list = Object.values(all)
    .filter((o) => o.userId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((o) => ({
      id: o.id, gold: o.creditedGold || o.gold, priceRub: o.priceRub,
      title: o.title || null, offerId: o.offerId || null,
      status: o.status, createdAt: o.createdAt, paidAt: o.paidAt || null,
      // Сверять есть смысл только заказ с платежом в ЮKassa
      canCheck: o.status === 'pending' && !!o.providerRef,
      refundedRub: o.refundedRub || 0,
    }));
  return { orders: list };
}

// ── Окно покупки и квитанция ──────────────────────────────────────
// Покупка зачисляется СРАЗУ при оплате, а окно с кнопкой «Забрать» —
// квитанция, которая только закрывается. Если бы выдача ждала кнопку,
// игрок, закрывший вкладку после оплаты, остался бы без оплаченного
// товара, а сама кнопка стала бы местом, где пытаются получить покупку
// дважды. Очередь окон лежит у игрока на сервере: не закрыл — окно
// дождётся следующего входа, на любом устройстве.
function unseenBox(user: User): string[] {
  const box = (user as any).unseenPurchases;
  if (Array.isArray(box)) return box;
  return ((user as any).unseenPurchases = []);
}

function finishReceipt(order: PaymentOrder, user: User, lines: ReceiptLine[], image: string) {
  order.receipt = { lines, image };
  const box = unseenBox(user);
  if (box.indexOf(order.id) === -1) box.push(order.id);
  while (box.length > UNSEEN_MAX) box.shift();
  db.markUser(user.id);
  try {
    require('./rewards').grantReceipt(user.id, {
      title: `🧾 Покупка: ${orderTitle(order)}`,
      reason: [
        `Время покупки: ${mskTime(order.paidAt || Date.now())} (МСК)`,
        `Оплачено: ${num(order.priceRub)} ₽`,
        `Заказ № ${order.id}`,
        'Всё уже зачислено на ваш счёт.',
      ].join('\n'),
      lines,
    });
  } catch (e: any) {
    // Письмо — сопровождение, а не сама покупка: его сбой не должен
    // откатывать уже зачисленное
    console.error(`⚠️  Квитанция по заказу ${order.id} не отправлена — ${e && e.message}`);
  }
}

// Непросмотренные покупки — едут в /api/me, окно показывается над любым экраном
function pendingPurchases(user: User) {
  const box = (user as any).unseenPurchases;
  if (!Array.isArray(box) || !box.length) return [];
  const all = store();
  return box
    .map((id: string) => all[id])
    .filter((o: PaymentOrder | undefined) => !!o && o.userId === user.id && o.status === 'paid')
    .map((o: PaymentOrder) => ({
      id: o.id,
      title: orderTitle(o),
      priceRub: o.priceRub,
      paidAt: o.paidAt || 0,
      image: (o.receipt && o.receipt.image) || (o.offerId ? OFFER_IMAGE : GOLD_IMAGE),
      items: (o.receipt && o.receipt.lines) || [],
    }));
}

// «Забрать» в окне покупки. Ничего не начисляет — только убирает окно из
// очереди. Чужой номер, повтор, выдуманный номер — просто ничего не меняют.
function ackPurchase(user: User, orderId: string) {
  const box = (user as any).unseenPurchases;
  if (Array.isArray(box)) {
    const i = box.indexOf(String(orderId || ''));
    if (i >= 0) { box.splice(i, 1); db.markUser(user.id); }
  }
  return { ok: true, left: Array.isArray(box) ? box.length : 0 };
}

// Подтверждение оплаты: зачисляет золото или выдаёт набор.
// Вызывается ТОЛЬКО после сверки с ЮKassa (syncOrder).
function confirmPayment(orderId: string): { ok: boolean } {
  const all = store();
  const order = all[orderId];
  if (!order || order.status !== 'pending') return { ok: false };
  const players: Record<string, User> = require('./player').users();
  const user = players[order.userId];
  if (!user) return { ok: false };

  // Заказ на набор: содержимое выдаёт сам набор, золота в нём может не
  // быть вовсе. Дальше по коду — только пакеты золота.
  if (order.offerId) {
    // Состав снимаем ДО выдачи: он нужен для окна и квитанции, а набор
    // потом могут отредактировать или удалить
    let lines: ReceiptLine[] = [];
    try { lines = require('./offers').receiptItems(order.offerId); } catch (e) {}
    const notices: string[] = [];
    let given: string[] = [];
    try { given = require('./offers').grantPaid(user, order.offerId, notices); } catch (e) {}
    // Бонус к покупке (для набора это ускорение опыта) — по условиям заказа
    let promoOffer: any = { lines: [], applied: [] };
    try { promoOffer = require('./donateBonus').applyOnPaid(user, order); } catch (e) {}
    order.promoApplied = promoOffer.applied;
    lines = lines.concat(promoOffer.lines);
    order.status = 'paid';
    order.paidAt = Date.now();
    finishReceipt(order, user, lines, OFFER_IMAGE);
    db.save('payments');
    db.save('users');
    try {
      require('./notifications').push(order.userId, 'payment_done',
        `🎁 Набор «${order.title || 'Спецпредложение'}» получен: ${given.join(', ')}`, { orderId });
    } catch (e) {}
    return { ok: true };
  }

  // Начисляем с учётом акции и VIP: подписка добавляет свои 15% ПОВЕРХ
  // действующей акции (акция +50% и VIP +15% дают +65%)
  let credited = order.gold;
  try {
    const mul = require('./discounts').bonusMul('gold', user);
    credited = Math.round(order.gold * mul);
  } catch (e) {}
  // Купленным (goldPaid) помечается ВЕСЬ зачисленный объём, включая бонус
  // акции и VIP: игрок заплатил за пакет, а бонус — часть того, что ему
  // обещали при оплате. Делить его на «оплаченную» и «подарочную» части
  // значило бы при возврате оставлять человеку кусок, который без покупки
  // ему бы не достался.
  //
  // А вот ИСТОЧНИК разный: сам пакет — 'purchase', надбавка акции и VIP —
  // 'purchase_bonus'. В «Откуда золото» владельцу нужно видеть отдельно,
  // сколько игрок купил и сколько получил сверху бонусом: по одной общей
  // строке нельзя понять, во что обходятся акции.
  const extraFromSale = Math.max(0, credited - order.gold);
  require('./player').addGold(user, order.gold, 'purchase', true);
  if (extraFromSale > 0) require('./player').addGold(user, extraFromSale, 'purchase_bonus', true);
  // Реферальный процент: 10% от купленного золота — пригласившему. Считается
  // от пакета с акцией и VIP, но без бонуса к покупке ниже: тот — подарок
  // покупателю за условие акции, а не купленное золото
  try { require('./features').onReferralPurchase(user, credited); } catch (e) {}
  const goldLine = credited > order.gold
    ? `${num(credited)} золота (${num(order.gold)} + бонус ${num(credited - order.gold)})`
    : `${num(credited)} золота`;
  // Бонус к покупке (services/donateBonus.ts): золото сверху и ускорение опыта
  // по условиям, показанным до оплаты. Золото зачисляется как часть покупки —
  // так же, как акция и VIP выше.
  let promo: any = { goldExtra: 0, lines: [], applied: [] };
  try { promo = require('./donateBonus').applyOnPaid(user, order); } catch (e) {}
  // Бонус к покупке — тот же источник 'purchase_bonus', что и надбавка акции:
  // для владельца это одна и та же строка «получено бонусом»
  if (promo.goldExtra > 0) require('./player').addGold(user, promo.goldExtra, 'purchase_bonus', true);
  credited += promo.goldExtra;
  order.creditedGold = credited;
  order.promoApplied = promo.applied;
  order.status = 'paid';
  order.paidAt = Date.now();
  finishReceipt(order, user, ([{ text: goldLine, icon: GOLD_ICON }] as ReceiptLine[]).concat(promo.lines), GOLD_IMAGE);
  db.save('payments');
  db.save('users');
  try {
    // Пишем зачисленное, а не номинал пакета: с акцией или VIP игрок
    // получил больше, и уведомление не должно с этим спорить
    require('./notifications').push(order.userId, 'payment_done',
      `💎 Покупка успешна! Зачислено 🪙 ${credited}.`, { orderId });
  } catch (e) {}
  return { ok: true };
}

// ═══ РАЗДЕЛ «ПЛАТЕЖИ» ДЛЯ ВЛАДЕЛЬЦА ═════════════════════════════════
// Данные карт и банков покупателей — финансовые персональные данные.
// Их видит только владелец: раздать это администратору значит раздать
// доступ к тому, кто, чем и откуда платит.
const METHOD_NAMES: Record<string, string> = {
  bank_card: 'Банковская карта', sbp: 'СБП', yoo_money: 'ЮMoney', tinkoff_bank: 'T-Pay',
  sberbank: 'SberPay', mobile_balance: 'Баланс телефона', b2b_sberbank: 'СберБизнес',
  sber_loan: 'Кредит от Сбера', electronic_certificate: 'Электронный сертификат',
  installments: 'Заплатить по частям', alfabank: 'Альфа-Клик', qiwi: 'QIWI', webmoney: 'WebMoney', cash: 'Наличные',
};

function assertOwner(actor: User) {
  let owner = false;
  try { owner = require('./roles').isOwner(actor); } catch (e) { owner = false; }
  if (!owner) throw new u.ApiError('Раздел «Платежи» — только для владельца проекта');
}

function methodOf(o: PaymentOrder) {
  const pm = (o.yk && o.yk.payment_method) || null;
  if (!pm) return { type: '', name: o.provider ? 'ещё не выбран' : 'без платёжного сервиса', title: '' };
  const out: any = { type: pm.type || '', name: METHOD_NAMES[pm.type] || pm.type || '—', title: pm.title || '' };
  if (pm.card) {
    out.card = {
      first6: pm.card.first6 || '', last4: pm.card.last4 || '',
      type: pm.card.card_type || '', issuerName: pm.card.issuer_name || '',
      issuerCountry: pm.card.issuer_country || '',
      expiry: pm.card.expiry_month && pm.card.expiry_year ? `${pm.card.expiry_month}/${pm.card.expiry_year}` : '',
      product: (pm.card.card_product && (pm.card.card_product.name || pm.card.card_product.code)) || '',
      source: pm.card.source || '',
    };
  }
  if (pm.payer_bank_details) out.bank = [pm.payer_bank_details.bank_id, pm.payer_bank_details.bic ? 'БИК ' + pm.payer_bank_details.bic : ''].filter(Boolean).join(', ');
  if (pm.sbp_operation_id) out.sbpOperationId = pm.sbp_operation_id;
  if (pm.account_number) out.account = pm.account_number;
  if (pm.phone) out.phone = pm.phone;
  return out;
}

function methodShort(o: PaymentOrder): string {
  const m = methodOf(o);
  if (m.card && m.card.last4) return `${m.name} •••• ${m.card.last4}${m.card.issuerName ? ', ' + m.card.issuerName : ''}`;
  if (m.bank) return `${m.name}, ${m.bank}`;
  return m.name;
}

function isTest(o: PaymentOrder): boolean { return !!(o.yk && o.yk.test); }

function adminList(actor: User, q: any) {
  assertOwner(actor);
  const query = String((q && q.q) || '').trim().toLowerCase();
  const status = String((q && q.status) || '');
  const test = String((q && q.test) || '');
  const limit = u.clamp(u.toInt(q && q.limit, 300), 1, 1000);
  const people: Record<string, any> = require('./player').users();
  const all = Object.values(store()).sort((a, b) => b.createdAt - a.createdAt);

  const totals = { paidRub: 0, paidCount: 0, refundedRub: 0, testCount: 0, pendingCount: 0 };
  for (const o of all) {
    if (isTest(o)) { if (o.status === 'paid') totals.testCount++; continue; }
    if (o.status === 'paid') { totals.paidRub += o.priceRub; totals.paidCount++; }
    if (o.status === 'pending' && o.providerRef) totals.pendingCount++;
    totals.refundedRub += o.refundedRub || 0;
  }

  const rows = all.filter((o) => {
    if (status === 'refunded') { if (!((o.refundedRub || 0) > 0)) return false; }
    else if (status && o.status !== status) return false;
    if (test === '1' && !isTest(o)) return false;
    if (test === '0' && isTest(o)) return false;
    if (query) {
      const p = people[o.userId];
      const card = o.yk && o.yk.payment_method && o.yk.payment_method.card;
      const hay = [o.id, o.providerRef, p && p.name, o.title, orderTitle(o), card && card.last4,
        o.buyer && o.buyer.ip].map((x) => String(x || '').toLowerCase()).join(' ');
      if (hay.indexOf(query) === -1) return false;
    }
    return true;
  }).slice(0, limit).map((o) => ({
    id: o.id, createdAt: o.createdAt, paidAt: o.paidAt || 0,
    userId: o.userId, userName: (people[o.userId] && people[o.userId].name) || '',
    title: orderTitle(o), priceRub: o.priceRub, creditedGold: o.creditedGold || 0,
    status: o.status, refundedRub: o.refundedRub || 0, test: isTest(o),
    method: methodShort(o), buyerIp: (o.buyer && o.buyer.ip) || '',
  }));
  return { rows, totals };
}

function adminGet(actor: User, id: string) {
  assertOwner(actor);
  const o = store()[String(id || '')];
  if (!o) throw new u.ApiError('Заказ не найден');
  const people: Record<string, any> = require('./player').users();
  const p = o.yk || {};
  const amount = p.amount ? Number(p.amount.value) : o.priceRub;
  const income = p.income_amount ? Number(p.income_amount.value) : null;
  const ad = p.authorization_details || {};
  return {
    id: o.id, title: orderTitle(o), status: o.status, priceRub: o.priceRub,
    creditedGold: o.creditedGold || 0, createdAt: o.createdAt, paidAt: o.paidAt || 0,
    cancelReason: o.cancelReason || (p.cancellation_details && p.cancellation_details.reason) || '',
    cancelParty: (p.cancellation_details && p.cancellation_details.party) || '',
    refundedRub: o.refundedRub || 0,
    userId: o.userId, userName: (people[o.userId] && people[o.userId].name) || '',
    provider: o.provider || '', providerRef: o.providerRef || '',
    buyer: o.buyer || null,
    receiptLines: (o.receipt && o.receipt.lines) || [],
    events: o.events || [],
    method: methodOf(o),
    auth: {
      rrn: ad.rrn || '', authCode: ad.auth_code || '',
      threeDs: ad.three_d_secure ? (ad.three_d_secure.applied ? 'пройдена' : 'не применялась') : '',
    },
    money: {
      amount, currency: (p.amount && p.amount.currency) || 'RUB',
      income, commission: income !== null ? Math.round((amount - income) * 100) / 100 : null,
      refunded: p.refunded_amount ? Number(p.refunded_amount.value) : 0,
      test: !!p.test, createdAt: p.created_at || '', capturedAt: p.captured_at || '',
      paid: !!p.paid, ykStatus: p.status || '',
    },
    ykSyncedAt: o.ykSyncedAt || 0,
    refunds: (o.refunds || []).map((r: any) => ({
      id: r.id, status: r.status, amount: r.amount ? Number(r.amount.value) : 0,
      createdAt: r.created_at || '', description: r.description || '',
    })),
    promos: o.promoApplied || [],
    raw: o.yk || null,
    rawRefunds: o.refunds || [],
  };
}

// «Сверить с ЮKassa»: свежий ответ о платеже и его возвратах. Неоплаченный
// заказ сверяется обычным путём — если он оплачен, покупка зачислится.
async function adminRefresh(actor: User, id: string) {
  assertOwner(actor);
  const o = store()[String(id || '')];
  if (!o) throw new u.ApiError('Заказ не найден');
  if (!o.providerRef) throw new u.ApiError('По этому заказу платёж в ЮKassa не создавался — сверять нечего');
  if (!yk().configured()) throw new u.ApiError('Ключи ЮKassa не заданы на сервере');
  try {
    if (o.status === 'pending') await syncOrder(o);
    else {
      o.yk = snap(await yk().getPayment(o.providerRef));
      o.ykSyncedAt = Date.now();
    }
    const list = o.refunds || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].id) list[i] = snap(await yk().getRefund(list[i].id));
    }
    db.save('payments');
  } catch (e: any) {
    throw new u.ApiError('ЮKassa не ответила: ' + String((e && e.message) || '').replace(/^ЮKassa ответила /, ''));
  }
  return adminGet(actor, id);
}

export = {
  packages, createOrder, createOfferOrder, pay, checkOrder, handleNotification,
  myOrders, confirmPayment, pendingPurchases, ackPurchase,
  adminList, adminGet, adminRefresh, MAX_PRICE_RUB,
};
