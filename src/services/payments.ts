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
  payUrl?: string;         // страница оплаты
  creditedGold?: number;   // сколько золота зачислено на самом деле (с акцией и VIP)
  cancelReason?: string;
  checkedAt?: number;
  refundedRub?: number;
  refundIds?: string[];
}

function store(): Record<string, PaymentOrder> {
  return db.load<Record<string, PaymentOrder>>('payments', {});
}

function yk() { return require('./yookassa'); }

// Адрес игры для возврата со страницы оплаты — тот же, что в письмах
function appUrl(): string {
  let base = '';
  try { base = require('./email').APP_URL || ''; } catch (e) { base = ''; }
  return String(base).replace(/\/+$/, '');
}

// Каталог пакетов (для витрины)
function packages() {
  const on = yk().configured();
  return {
    packages: PACKAGES, enabled: on, note: on ? '' : 'Платёжная система скоро будет доступна.',
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
  const all = store();
  all[order.id] = order;
  db.save('payments');
  if (!yk().configured()) notices.push(`🛒 Заказ на «${offer.title}» создан. Онлайн-оплата появится после подключения платёжной системы.`);
  return { orderId: order.id, status: order.status, payUrl: null as string | null };
}

// Платёж в ЮKassa по уже созданному заказу. Без ключей — ничего не
// делает, заказ остаётся как есть.
async function pay(user: User, created: { orderId: string; status: string; payUrl: string | null }, notices: Notices) {
  if (!yk().configured()) return created;
  const order = store()[created.orderId];
  if (!order || order.userId !== user.id) throw new u.ApiError('Заказ не найден');
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
    });
    const ref = String((p && p.id) || '');
    const url = String((p && p.confirmation && p.confirmation.confirmation_url) || '');
    if (!ref || !url) throw new Error('в ответе нет id платежа или ссылки на оплату');
    order.provider = 'yookassa';
    order.providerRef = ref;
    order.payUrl = url;
    db.save('payments');
    return { orderId: order.id, status: order.status, payUrl: url };
  } catch (e: any) {
    order.status = 'failed';
    db.save('payments');
    console.error(`⚠️  ЮKassa: платёж по заказу ${order.id} не создан — ${e && e.message}`);
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

// Уведомление от ЮKassa. Платёж, которого нет среди наших заказов, не
// проверяем вовсе: иначе любой мог бы заставить сервер слать запросы в
// ЮKassa, подсовывая выдуманные номера.
// Ошибка связи с ЮKassa пробрасывается наружу — маршрут ответит 500, и
// ЮKassa повторит уведомление сама.
async function handleNotification(body: any) {
  const event = String((body && body.event) || '');
  const obj = body && body.object;
  if (!obj || typeof obj.id !== 'string') return { ok: true };
  const all = Object.values(store());

  if (event.indexOf('refund.') === 0) {
    const order = all.find((o) => !!o.providerRef && o.providerRef === obj.payment_id);
    if (!order) return { ok: true };
    const r = await yk().getRefund(obj.id);
    const ids = order.refundIds || (order.refundIds = []);
    if (r && r.status === 'succeeded' && r.payment_id === order.providerRef && ids.indexOf(r.id) === -1) {
      const rub = Number(r.amount && r.amount.value) || 0;
      ids.push(r.id);
      order.refundedRub = Math.round(((order.refundedRub || 0) + rub) * 100) / 100;
      db.save('payments');
      const who: any = require('./player').users()[order.userId];
      // Золото автоматически не списываем: возврат бывает частичным, а часть
      // покупки игрок мог уже потратить — решение за владельцем
      auditLog.record({
        userId: order.userId, userName: (who && who.name) || '', path: '/system/payment-refund',
        desc: `💸 Возврат ${rub} ₽ по заказу ${order.id}. Золото и набор автоматически не списаны — решите вручную`,
        body: { orderId: order.id, refundRub: rub },
      });
    }
    return { ok: true };
  }

  const order = all.find((o) => !!o.providerRef && o.providerRef === obj.id);
  if (!order) return { ok: true };
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
    const notices: string[] = [];
    let given: string[] = [];
    try { given = require('./offers').grantPaid(user, order.offerId, notices); } catch (e) {}
    order.status = 'paid';
    order.paidAt = Date.now();
    db.save('payments');
    db.markUser(user.id);
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
  // Купленным помечается ВЕСЬ зачисленный объём, включая бонус акции и
  // VIP: игрок заплатил за пакет, а бонус — часть того, что ему обещали
  // при оплате. Делить его на «оплаченную» и «подарочную» части значило
  // бы при возврате оставлять человеку кусок, который без покупки ему бы
  // не достался.
  require('./player').addGold(user, credited, 'purchase', true);
  order.creditedGold = credited;
  // Реферальный процент: 10% от купленного золота — пригласившему
  try { require('./features').onReferralPurchase(user, credited); } catch (e) {}
  order.status = 'paid';
  order.paidAt = Date.now();
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

export = {
  packages, createOrder, createOfferOrder, pay, checkOrder, handleNotification,
  myOrders, confirmPayment, MAX_PRICE_RUB,
};
