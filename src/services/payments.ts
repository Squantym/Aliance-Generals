// ===================================================================
// src/services/payments.ts — покупки за рубли через Робокассу.
//
// Как устроено:
//   1. Игрок жмёт «Купить» — создаётся заказ (pending) с числовым номером
//      счёта, и игрок уходит на страницу Робокассы. Способ оплаты он
//      выбирает ТАМ: карты, в том числе иностранные, СБП, SberPay, T-Pay —
//      всё, что включено в магазине.
//   2. Робокасса присылает уведомление на /api/payments/robokassa/result,
//      подписанное паролем №2. Подпись, номер заказа и сумма проверяются;
//      при любом расхождении ничего не начисляется.
//   3. Вернувшись в игру, клиент сам просит сверить заказ
//      (/api/payments/check) — сервер спрашивает статус у Робокассы, на
//      случай если уведомление задержалось.
//   4. Зачисление — confirmPayment, и только из статуса pending: повторное
//      уведомление и сверка второй раз ничего не дадут.
//   5. После зачисления игрок видит окно покупки, а в почту приходит
//      квитанция от «Система». Кнопка «Забрать» в окне только закрывает
//      его: покупка УЖЕ на счету (см. ackPurchase).
//
// До перехода на Робокассу оплата шла через ЮKassa. Старые заказы
// остались в базе как есть и видны в разделе «Платежи»; сверять их больше
// не с чем — ЮKassa отключена.
//
// Для разбора проблем с оплатой заказ хранит всё, что о платеже сообщила
// Робокасса (способ, сумма, комиссия, состояние), откуда платил
// покупатель (адрес, устройство) и историю уведомлений. Смотрит это
// только владелец — раздел «Платежи» в панели.
//
// Пока ключей магазина нет в .env, оплата выключена: заказ создаётся без
// платежа, как было до интеграции.
//
// Хранение: коллекция 'payments' = { [orderId]: PaymentOrder };
// последний выданный номер счёта — meta.robokassaInvSeq.
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

// Неоплаченных заказов за час — не больше этого. Без предела один
// человек с кнопкой «Купить» наплодил бы сотни пустых счетов.
const PENDING_PER_HOUR = 10;
// Сверку игрок может дёргать часто — в Робокассу ходим не чаще раза в 5 с
const CHECK_COOLDOWN_MS = 5000;
// Сколько окон непросмотренных покупок держим в очереди у игрока
const UNSEEN_MAX = 10;
// Сколько уведомлений помним на заказ
const KEEP_EVENTS = 30;

const GOLD_ICON = '/img/icons/gold.webp';
const GOLD_IMAGE = '/img/tabs/bank_gold.webp';
const OFFER_IMAGE = '/img/menu/bank.webp';

// Что принимаем — показывается игроку до перехода к оплате. Сам выбор
// способа делается на странице Робокассы: её список всегда совпадает с
// тем, что включено в магазине, а наш — разошёлся бы при первой же
// правке настроек. Иностранные карты владелец просил держать на виду:
// для игроков из-за рубежа это единственный способ заплатить.
const PAY_NOTE = 'Оплата на защищённой странице Робокассы: банковские карты, '
  + 'в том числе выпущенные за рубежом, СБП, SberPay, T-Pay и другие способы. '
  + 'Данные карты игра не получает.';

// Номер счёта для Робокассы — целое число, уникальное для магазина.
// Счётчик растёт в meta и не откатывается. ROBOKASSA_INV_BASE разводит
// миры: тестовый и боевой могут работать на одном магазине, и номера у
// них не должны совпасть — иначе Робокасса отклонит второй счёт.
const INV_MAX = 2147483647;
function nextInvId(): number {
  const meta = db.load<Record<string, any>>('meta', {});
  const base = Math.max(1, u.toInt(process.env.ROBOKASSA_INV_BASE, 1000));
  const cur = Math.max(u.toInt(meta.robokassaInvSeq, 0), base - 1);
  const next = cur + 1;
  if (next > INV_MAX) throw new u.ApiError('Номера счетов закончились — сообщите администрации');
  meta.robokassaInvSeq = next;
  db.save('meta');
  return next;
}

type ReceiptLine = { text: string; icon: string | null };
type Buyer = { ip: string; device: string; ua: string; fp: string; did: string; at: number };

interface PaymentOrder {
  id: string;
  userId: string;
  packageId: string;
  offerId?: string;        // заказ на набор «Спецпредложений», а не на пакет золота
  offerItems?: any[];      // состав набора на момент заказа — его и выдаём
  title?: string;
  gold: number;
  priceRub: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  createdAt: number;
  paidAt?: number;
  provider?: string;       // 'robokassa' | 'lavatop' (у старых — 'yookassa')
  charged?: { amount: number; currency: string };  // сколько и в какой валюте спишет касса (Lava: USD/EUR)
  providerRef?: string;    // номер счёта в Робокассе (у старых — id платежа ЮKassa)
  invId?: number;          // номер счёта в Робокассе числом
  method?: string;         // у старых заказов — способ, выбранный в игре
  promos?: any[];          // бонусы к покупке, обещанные на момент заказа
  // Чек «Мой налог». Самозанятый пробивает его руками (ЮKassa перестала
  // передавать чеки за самозанятых 29.12.2025), а ссылку на чек обязан
  // передать покупателю — вот она и живёт в заказе.
  taxReceipt?: { url: string; at: number; byName: string; letterId: string };
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
  rk?: any;                // последнее, что Робокасса сообщила о счёте
  rkSyncedAt?: number;
  rkTest?: boolean;        // счёт выставлен в тестовом режиме
  // Поля из уведомления об оплате (без подписи): комиссия, способ, почта
  rkResult?: Record<string, string>;
  yk?: any;                // старые заказы: последний ответ ЮKassa
  ykSyncedAt?: number;
  events?: Array<{ at: number; event: string; ip: string; status: string }>;
  refunds?: any[];         // старые заказы: ответы ЮKassa о возвратах
}

function store(): Record<string, PaymentOrder> {
  return db.load<Record<string, PaymentOrder>>('payments', {});
}

function rk() { return require('./robokassa'); }
function lava() { return require('./lavatop'); }

// ── Lava Top: какой товар каталога отвечает нашему пакету или набору ──
// Ключ: id пакета золота ('gold_525') или 'offer:<id набора>'. Значение —
// цена из каталога Lava. Заводит связку владелец в панели; без связки
// кнопка зарубежной оплаты у этого товара просто не показывается.
type LavaLink = { offerId: string; title: string; amount: number; currency: string; at: number };
function lavaStore(): Record<string, LavaLink> {
  return db.load<Record<string, LavaLink>>('lavaOffers', {});
}
function lavaKeyOf(o: { offerId?: string; packageId: string }): string {
  return o.offerId ? 'offer:' + o.offerId : String(o.packageId || '');
}
function lavaLink(key: string): LavaLink | null {
  return lavaStore()[String(key || '')] || null;
}
// Готова ли зарубежная оплата этого товара: ключи на месте И товар связан
function lavaReady(key: string): boolean {
  try { return lava().ready() && !!lavaLink(key); } catch (e) { return false; }
}

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

// Копия ответа платёжного сервиса для хранения. Полного номера карты в
// нём нет, поэтому храним целиком: при разборе спора нужна каждая
// мелочь, а заранее угадать, какая именно, нельзя.
function snap(obj: any): any {
  if (!obj) return null;
  try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return null; }
}

// Что из уведомления Робокассы стоит сохранить. Подпись и пароли — нет:
// подпись одноразовая и для разбора бесполезна, а хранить её значит
// держать в базе то, из чего подбирается пароль №2.
const RESULT_KEEP = ['OutSum', 'InvId', 'Fee', 'EMail', 'PaymentMethod', 'IncCurrLabel', 'IsTest', 'Shp_order'];
function resultSnap(q: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of RESULT_KEEP) if (q && q[k] !== undefined) out[k] = String(q[k]).slice(0, 120);
  return out;
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
  const on = rk().configured();
  let promos: any[] = [], xpBoost: any = null;
  if (user) {
    try { promos = require('./donateBonus').forPlayer(user); } catch (e) { promos = []; }
    try { xpBoost = require('./donateBonus').xpBoostView(user); } catch (e) { xpBoost = null; }
  }
  // Зарубежная карта (Lava Top): у каждого пакета своя связка с товаром
  // в каталоге Lava, поэтому и доступность считается по каждому пакету
  let lavaOn = false, lavaCur = 'USD';
  try { lavaOn = lava().ready(); lavaCur = lava().currency(); } catch (e) { lavaOn = false; }
  const withLava = PACKAGES.map((p) => {
    const link = lavaOn ? lavaLink(p.id) : null;
    return Object.assign({}, p, link
      ? { lava: { amount: link.amount, currency: link.currency } }
      : {});
  });
  return {
    packages: withLava, enabled: on, note: on ? '' : 'Платёжная система скоро будет доступна.',
    lava: { enabled: lavaOn && withLava.some((p: any) => p.lava), currency: lavaCur },
    // Выбора способа в игре нет — он на странице Робокассы (см. PAY_NOTE)
    methods: [],
    payNote: on ? PAY_NOTE : '',
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

// Создать заказ. Счёт в Робокассе выставляет pay() — отдельным шагом,
// потому что заказ на набор приходит из offers.ts готовым.
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

  if (!rk().configured()) notices.push('🛒 Заказ создан. Онлайн-оплата появится после подключения платёжной системы.');
  return { orderId: order.id, status: order.status, payUrl: null as string | null };
}

// Заказ на набор из «Спецпредложений». Отличается от пакета золота
// только тем, что выдаётся при подтверждении: сам набор знает, что в
// нём лежит (offers.grantPaid).
function createOfferOrder(user: User, offer: { id: string; title: string; priceRub: number; items?: any[] }, notices: Notices) {
  assertNotFlooding(user);
  const order: PaymentOrder = {
    id: u.uid(16),
    userId: user.id,
    packageId: 'offer:' + offer.id,
    offerId: offer.id,
    offerItems: Array.isArray(offer.items) ? JSON.parse(JSON.stringify(offer.items)) : undefined,
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
  if (!rk().configured()) notices.push(`🛒 Заказ на «${offer.title}» создан. Онлайн-оплата появится после подключения платёжной системы.`);
  return { orderId: order.id, status: order.status, payUrl: null as string | null };
}

// Счёт в Робокассе по уже созданному заказу. Без ключей — ничего не
// делает, заказ остаётся как есть. meta — откуда нажали «Купить»: адрес
// и устройство записываются в заказ в любом случае.
//
// Запроса в сеть здесь нет: ссылку на оплату мы собираем и подписываем
// сами. Поэтому и «платёжный сервис не ответил» на этом шаге не бывает —
// недоступность Робокассы игрок увидит уже на её странице.
async function pay(user: User, created: { orderId: string; status: string; payUrl: string | null }, notices: Notices, meta?: any) {
  const order = store()[created.orderId];
  if (!order || order.userId !== user.id) throw new u.ApiError('Заказ не найден');
  const buyer = buyerOf(meta);
  if (buyer) { order.buyer = buyer; db.save('payments'); }
  if (!rk().configured()) return created;
  // Описание видит покупатель на странице оплаты и в выписке —
  // там должно быть понятно, за что платили
  const description = order.offerId
    ? `Игровой набор «${order.title || 'Спецпредложение'}» — «${brand.GAME_NAME}»`
    : `${order.gold} золота — игровая валюта «${brand.GAME_NAME}»`;
  try {
    const invId = order.invId || nextInvId();
    const url = rk().payUrl({
      invId,
      amountRub: order.priceRub,
      description,
      // Строка чека в «Мой налог»: что именно продано
      itemName: order.offerId
        ? `Игровой набор ${order.title || ''} игры ${brand.GAME_NAME}`
        : `Игровая валюта ${order.gold} золота игры ${brand.GAME_NAME}`,
      orderId: order.id,
      email: String((user as any).email || ''),
    });
    order.provider = 'robokassa';
    order.invId = invId;
    order.providerRef = String(invId);
    order.payUrl = url;
    order.rkTest = rk().isTest();
    db.save('payments');
    return { orderId: order.id, status: order.status, payUrl: url };
  } catch (e: any) {
    order.status = 'failed';
    db.save('payments');
    console.error(`⚠️  Робокасса: счёт по заказу ${order.id} не выставлен — ${e && e.message}`);
    throw new u.ApiError('Оплата временно недоступна. Деньги не списаны — попробуйте через минуту.');
  }
}

// Счёт в Lava Top по уже созданному заказу — для оплаты зарубежной картой.
// В отличие от Робокассы, ссылку выдаёт САМА Lava, поэтому здесь есть
// поход в сеть и он может не ответить: тогда заказ остаётся неоплаченным,
// а игрок видит понятный отказ.
async function payLava(user: User, created: { orderId: string }, notices: Notices, meta?: any) {
  const order = store()[created.orderId];
  if (!order || order.userId !== user.id) throw new u.ApiError('Заказ не найден');
  const buyer = buyerOf(meta);
  if (buyer) { order.buyer = buyer; db.save('payments'); }
  const key = lavaKeyOf(order);
  const link = lavaLink(key);
  if (!lava().ready() || !link) {
    throw new u.ApiError('Оплата зарубежной картой сейчас недоступна. Попробуйте оплату картой РФ.');
  }
  let inv: any;
  try {
    inv = await lava().createInvoice({
      email: String((user as any).email || ''),
      offerId: link.offerId,
    });
  } catch (e: any) {
    order.status = 'failed';
    db.save('payments');
    console.error(`⚠️  Lava Top: счёт по заказу ${order.id} не выставлен — ${e && e.message}`);
    throw new u.ApiError('Оплата временно недоступна. Деньги не списаны — попробуйте через минуту.');
  }
  if (!inv.paymentUrl) {
    order.status = 'failed';
    db.save('payments');
    throw new u.ApiError('Касса не вернула ссылку на оплату. Деньги не списаны.');
  }
  order.provider = 'lavatop';
  order.providerRef = inv.id;
  order.payUrl = inv.paymentUrl;
  order.charged = { amount: inv.amount, currency: inv.currency };
  db.save('payments');
  return { orderId: order.id, status: order.status, payUrl: inv.paymentUrl };
}

// ── Уведомление об оплате от Lava Top ─────────────────────────────
// Подписи у Lava нет: она шлёт ключ, заданный в её кабинете. Поэтому
// порядок такой: сначала ключ, потом contractId (его мы получили при
// создании счёта), потом сумма и валюта. Ответ — простым текстом: тело
// ответа Lava не разбирает, ей важен код 200.
function handleLavaWebhook(body: any, headers: any, meta?: any): any {
  const http = require('../core/http');
  if (!lava().verifyWebhook(headers || {})) {
    console.error('⛔ Lava Top: уведомление с чужим ключом отклонено');
    auditLog.record({
      userId: 'system', userName: 'system', path: '/system/payment-forged',
      desc: '⛔ Отклонено уведомление Lava Top: неверный ключ',
      body: { ip: String((meta && meta.ip) || '') },
    });
    return http.textReply('bad key', 401);
  }
  const contractId = String((body && body.contractId) || '');
  const order = Object.values(store()).find((o) => o.provider === 'lavatop' && o.providerRef === contractId);
  if (!order) {
    console.error(`⛔ Lava Top: контракт ${contractId || '—'} не найден среди заказов`);
    return http.textReply('unknown order', 400);
  }
  logEvent(order, 'lava:' + String((body && body.eventType) || ''), meta, order.status);
  if (!lava().isPaid(body)) {
    // Отказ или возврат: заказ не трогаем, но событие в нём остаётся
    return http.textReply('ok');
  }
  if (order.status !== 'pending') return http.textReply('ok');   // повтор — уже учтено
  // Сумма и валюта — те же, что Lava назвала при создании счёта
  const want = order.charged || { amount: 0, currency: '' };
  const gotAmount = Math.round(Number((body && body.amount) || 0) * 100);
  const gotCur = String((body && body.currency) || '');
  if (want.amount && (gotAmount !== Math.round(want.amount * 100) || gotCur !== want.currency)) {
    console.error(`⛔ Lava Top: оплата ${gotAmount / 100} ${gotCur} не совпала с заказом ${order.id}`);
    auditLog.record({
      userId: order.userId, userName: '', path: '/system/payment-mismatch',
      desc: `⛔ Оплата Lava не совпала с заказом ${order.id}: ${gotAmount / 100} ${gotCur} вместо ${want.amount} ${want.currency} — не зачислено`,
      body: { orderId: order.id, contractId },
    });
    return http.textReply('bad sum', 400);
  }
  confirmPayment(order.id);
  return http.textReply('ok');
}

// ── Панель: связка товаров Lava ───────────────────────────────────
// Список товаров тянем из каталога Lava по ключу — владельцу остаётся
// выбрать нужный из списка, а не переписывать длинные идентификаторы.
function lavaState(actor: User) {
  assertOwner(actor);
  const map = lavaStore();
  const offers = require('./offers').adminList(actor).offers as any[];
  const rows = PACKAGES.map((p) => ({
    key: p.id, kind: 'Пакет золота', title: `${p.label} — ${p.priceRub} ₽`, link: map[p.id] || null,
  })).concat(offers.filter((o) => o.priceRub > 0).map((o) => ({
    key: 'offer:' + o.id, kind: 'Набор', title: `${o.title} — ${o.priceRub} ₽`, link: map['offer:' + o.id] || null,
  })));
  let state: any = { configured: false, ready: false, problem: 'модуль не загрузился', currency: 'USD', apiUrl: '' };
  try {
    const L = lava();
    state = { configured: L.configured(), ready: L.ready(), problem: L.problem(), currency: L.currency(), apiUrl: L.apiUrl() };
  } catch (e) {}
  return Object.assign(state, { rows, webhookUrl: appUrl() + '/api/payments/lavatop/webhook' });
}

async function lavaProducts(actor: User) {
  assertOwner(actor);
  try {
    return { products: await lava().products() };
  } catch (e: any) {
    throw new u.ApiError('Lava Top не отдала список товаров: ' + (e && e.message));
  }
}

function lavaMap(actor: User, body: any, notices: Notices) {
  assertOwner(actor);
  const key = String((body && body.key) || '').trim();
  if (!key) throw new u.ApiError('Не указан товар игры');
  const all = lavaStore();
  const offerId = String((body && body.offerId) || '').trim();
  if (!offerId) {
    delete all[key];
    db.save('lavaOffers');
    notices.push('🌍 Связка с Lava Top снята — зарубежная оплата этого товара выключена.');
    return { ok: true, link: null };
  }
  all[key] = {
    offerId,
    title: String((body && body.title) || '').slice(0, 120),
    amount: Math.max(0, Number((body && body.amount) || 0)),
    currency: String((body && body.currency) || 'USD').toUpperCase().slice(0, 3),
    at: Date.now(),
  };
  db.save('lavaOffers');
  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/admin/lavatop/map',
    body: { key, offerId, amount: all[key].amount, currency: all[key].currency },
  });
  notices.push(`🌍 Связано с Lava Top: ${all[key].title || offerId} (${all[key].amount} ${all[key].currency})`);
  return { ok: true, link: all[key] };
}

// Сверка заказа с Робокассой. Решение принимается ТОЛЬКО по её ответу:
// счёт оплачен и сумма совпадает с заказом до копейки. Любое расхождение
// — не зачисляем и поднимаем тревогу в журнале.
async function syncOrder(order: PaymentOrder): Promise<string> {
  if (order.provider !== 'robokassa' || !order.invId || order.status !== 'pending') return order.status;
  let st: any;
  try {
    st = await rk().opState(order.invId);
  } catch (e: any) {
    // Код 3 — «счёт не найден»: игрок ещё не открывал страницу оплаты.
    // Это не ошибка и не отказ — заказ просто ждёт.
    if (e && e.rkCode === '3') return order.status;
    throw e;
  }
  order.rk = snap(st);
  order.rkSyncedAt = Date.now();
  db.save('payments');
  if (st.paid) {
    const amountOk = Math.round(Number(st.outSum) * 100) === Math.round(order.priceRub * 100);
    if (amountOk) {
      confirmPayment(order.id);
    } else {
      console.error(`⛔ Робокасса: счёт ${order.invId} оплачен на ${st.outSum} ₽ вместо ${order.priceRub} — не зачислено`);
      auditLog.record({
        userId: order.userId, userName: '', path: '/system/payment-mismatch',
        desc: `⛔ Оплата не совпала с заказом ${order.id}: другая сумма (${st.outSum} ₽ вместо ${order.priceRub}) — не зачислено`,
        body: { orderId: order.id, invId: order.invId },
      });
    }
  } else if (st.cancelled) {
    order.status = 'cancelled';
    order.cancelReason = 'счёт отменён в Робокассе';
    db.save('payments');
  }
  return order.status;
}

// Игрок вернулся со страницы оплаты — сверяем его заказ
async function checkOrder(user: User, orderId: string) {
  const order = store()[String(orderId || '')];
  if (!order || order.userId !== user.id) throw new u.ApiError('Заказ не найден');
  if (order.status !== 'pending' || order.provider !== 'robokassa' || !order.invId) {
    return { orderId: order.id, status: order.status, gold: order.creditedGold || 0 };
  }
  if (order.checkedAt && Date.now() - order.checkedAt < CHECK_COOLDOWN_MS) {
    return { orderId: order.id, status: order.status, gold: 0 };
  }
  order.checkedAt = Date.now();
  try {
    await syncOrder(order);
  } catch (e: any) {
    console.error(`⚠️  Робокасса: сверка заказа ${order.id} не удалась — ${e && e.message}`);
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

// ── Уведомление об оплате (Result URL) ────────────────────────────
// Ответ Робокассе — ТОЛЬКО текст «OK<номер счёта>»: любой другой ответ
// она считает отказом и повторяет уведомление. Поэтому и на уже
// зачисленный заказ отвечаем «OK» — иначе повторы шли бы сутками.
//
// Что проверяется, прежде чем зачислить:
//   • подпись паролем №2 — без неё уведомление подделано;
//   • номер счёта и наш номер заказа из Shp_order указывают на ОДИН
//     заказ — иначе чужая оплата зачислилась бы не тому;
//   • сумма совпадает с заказом до копейки.
function handleResult(q: Record<string, any>, meta?: any): any {
  const http = require('../core/http');
  const v = rk().verifyResult(q || {});
  if (!v.ok) {
    console.error(`⛔ Робокасса: отклонено уведомление — ${v.why}`);
    auditLog.record({
      userId: 'system', userName: 'system', path: '/system/payment-forged',
      desc: `⛔ Отклонено уведомление об оплате: ${v.why}`,
      body: { invId: String((q && q.InvId) || ''), ip: String((meta && meta.ip) || '') },
    });
    return http.textReply('bad sign', 400);
  }
  const order = Object.values(store()).find((o) => o.provider === 'robokassa' && o.invId === v.invId);
  if (!order || order.id !== v.orderId) {
    console.error(`⛔ Робокасса: счёт ${v.invId} не совпал с заказом ${v.orderId || '—'}`);
    auditLog.record({
      userId: order ? order.userId : 'system', userName: '', path: '/system/payment-mismatch',
      desc: `⛔ Уведомление об оплате счёта ${v.invId} не совпало с заказом — не зачислено`,
      body: { invId: v.invId, orderId: v.orderId },
    });
    return http.textReply('unknown order', 400);
  }
  order.rkResult = resultSnap(q);
  logEvent(order, 'result', meta, order.status);
  if (order.status !== 'pending') return http.textReply('OK' + v.invId);   // повтор — уже учтено
  const amountOk = Math.round(Number(v.outSum) * 100) === Math.round(order.priceRub * 100);
  if (!amountOk) {
    console.error(`⛔ Робокасса: счёт ${v.invId} оплачен на ${v.outSum} ₽ вместо ${order.priceRub}`);
    auditLog.record({
      userId: order.userId, userName: '', path: '/system/payment-mismatch',
      desc: `⛔ Оплата не совпала с заказом ${order.id}: ${v.outSum} ₽ вместо ${order.priceRub} — не зачислено`,
      body: { orderId: order.id, invId: v.invId },
    });
    return http.textReply('bad sum', 400);
  }
  confirmPayment(order.id);
  return http.textReply('OK' + v.invId);
}

// Игрок вернулся со страницы оплаты (Success URL или Fail URL). Здесь
// НИЧЕГО не зачисляется: это браузер игрока, а не сервер Робокассы.
// Только ведём в нужный раздел банка — там клиент сам сверит заказ.
function handleReturn(q: Record<string, any>, ok: boolean) {
  const http = require('../core/http');
  let tab = 'gold';
  const inv = u.toInt(q && q.InvId, 0);
  if (inv && (!ok || rk().verifySuccess(q || {}))) {
    const order = Object.values(store()).find((o) => o.provider === 'robokassa' && o.invId === inv);
    if (order && order.offerId) tab = 'offers';
  }
  return http.redirectReply(`/#bank/${tab}`);
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
      // Сверять есть смысл только заказ со счётом в Робокассе: старые
      // заказы ЮKassa сверять больше не с чем
      canCheck: o.status === 'pending' && o.provider === 'robokassa' && !!o.invId,
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
// Вызывается ТОЛЬКО по проверенному уведомлению Робокассы (handleResult)
// или после сверки с ней (syncOrder).
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
    try { lines = require('./offers').receiptItems(order.offerId, order.offerItems); } catch (e) {}
    const notices: string[] = [];
    let given: string[] = [];
    try {
      given = require('./offers').grantPaid(user, order.offerId, notices, order.offerItems);
    } catch (e: any) {
      // Деньги получены, а выдать нечего — это не молчаливый «оплачено»,
      // а тревога владельцу: покупку надо выдать или вернуть руками
      console.error(`⛔ Заказ ${order.id}: набор не выдан — ${e && e.message}`);
      auditLog.record({
        userId: order.userId, userName: user.name, path: '/system/payment-offer-failed',
        desc: `⛔ Оплачен набор «${order.title || order.offerId}», но выдать не удалось (${e && e.message}) — выдайте или верните вручную`,
        body: { orderId: order.id, offerId: order.offerId },
      });
    }
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

// Способ оплаты по данным Робокассы: из уведомления (способ и валюта,
// которой платил покупатель) и из сверки (название способа, счёт
// плательщика без полного номера).
function rkMethod(o: PaymentOrder) {
  const res = o.rkResult || {};
  const st = o.rk || {};
  const label = st.incCurr || res.IncCurrLabel || '';
  const name = st.methodName || res.PaymentMethod || label || (o.status === 'pending' ? 'ещё не выбран' : '—');
  const out: any = { type: st.method || res.PaymentMethod || '', name, title: label };
  if (st.incAccount) out.account = st.incAccount;
  // Иностранную карту Робокасса называет отдельным способом — владелец
  // просил видеть такие оплаты сразу
  if (/foreign|интернац|иностран/i.test(String(name) + ' ' + String(label))) out.foreign = true;
  return out;
}

function methodOf(o: PaymentOrder) {
  if (o.provider === 'robokassa') return rkMethod(o);
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
  return m.foreign ? `🌍 ${m.name}` : m.name;
}

function isTest(o: PaymentOrder): boolean {
  if (o.provider === 'robokassa') return !!o.rkTest || String((o.rkResult || {}).IsTest || '') === '1';
  return !!(o.yk && o.yk.test);
}

function adminList(actor: User, q: any) {
  assertOwner(actor);
  const query = String((q && q.q) || '').trim().toLowerCase();
  const status = String((q && q.status) || '');
  const test = String((q && q.test) || '');
  // «Только без чека» — рабочий список владельца: по каким настоящим
  // оплатам ещё не передан чек покупателю
  const noReceipt = String((q && q.noreceipt) || '') === '1';
  const limit = u.clamp(u.toInt(q && q.limit, 300), 1, 1000);
  const people: Record<string, any> = require('./player').users();
  const all = Object.values(store()).sort((a, b) => b.createdAt - a.createdAt);

  // needReceipt — сколько настоящих оплат ещё без чека «Мой налог».
  // Это и есть список дел: чек по закону передают покупателю.
  const totals = { paidRub: 0, paidCount: 0, refundedRub: 0, testCount: 0, pendingCount: 0, needReceipt: 0 };
  for (const o of all) {
    if (isTest(o)) { if (o.status === 'paid') totals.testCount++; continue; }
    if (o.status === 'paid') { totals.paidRub += o.priceRub; totals.paidCount++; if (!o.taxReceipt) totals.needReceipt++; }
    if (o.status === 'pending' && (o.invId || o.providerRef)) totals.pendingCount++;
    totals.refundedRub += o.refundedRub || 0;
  }

  const rows = all.filter((o) => {
    if (status === 'refunded') { if (!((o.refundedRub || 0) > 0)) return false; }
    else if (status && o.status !== status) return false;
    if (test === '1' && !isTest(o)) return false;
    if (test === '0' && isTest(o)) return false;
    if (noReceipt && (o.status !== 'paid' || isTest(o) || o.taxReceipt)) return false;
    if (query) {
      const p = people[o.userId];
      const card = o.yk && o.yk.payment_method && o.yk.payment_method.card;
      const acc = o.rk && o.rk.incAccount;
      const hay = [o.id, o.providerRef, p && p.name, o.title, orderTitle(o), card && card.last4, acc,
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
    taxReceipt: !!o.taxReceipt,
  }));
  return { rows, totals };
}

// Ссылка на чек «Мой налог» + письмо покупателю. Руками рассылать ссылки
// по игрокам — это забыть половину: здесь одно поле и одна кнопка.
function setTaxReceipt(actor: User, id: string, url: string, notices: Notices) {
  assertOwner(actor);
  const o = store()[String(id || '')];
  if (!o) throw new u.ApiError('Заказ не найден');
  if (o.status !== 'paid') throw new u.ApiError('Чек нужен только по оплаченному заказу');
  const link = String(url || '').trim();
  // Чек выдаёт ФНС, и ссылка у него всегда на nalog.ru. Проверка не
  // придирка: игроку уходит кликабельная ссылка, и опечатка в домене
  // превратит её в чужой сайт.
  if (!/^https:\/\/[a-z0-9.-]*nalog\.ru\/[^\s"<>]{3,280}$/i.test(link)) {
    throw new u.ApiError('Нужна ссылка на чек из «Мой налог» (https://…nalog.ru/…)');
  }
  const people: Record<string, any> = require('./player').users();
  const buyer = people[o.userId];
  if (!buyer) throw new u.ApiError('Покупатель не найден — аккаунт удалён');

  const when = new Date(o.paidAt || o.createdAt).toLocaleString('ru-RU',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let letterId = '';
  try {
    const letter = require('./rewards').grantReceipt(o.userId, {
      title: '🧾 Чек по вашей покупке',
      reason: `Покупка «${orderTitle(o)}» на ${o.priceRub} ₽ от ${when} (МСК).\n`
        + 'Чек сформирован в сервисе «Мой налог» ФНС России. Сохраните ссылку — по ней чек открывается в любой момент.',
      lines: [
        { text: `${orderTitle(o)} — ${o.priceRub} ₽`, icon: GOLD_ICON },
      ],
      link: { url: link, label: '🧾 Открыть чек' },
    });
    letterId = letter.id;
  } catch (e) {}
  o.taxReceipt = { url: link, at: Date.now(), byName: actor.name, letterId };
  db.save('payments');
  try {
    require('./notifications').push(o.userId, 'tax_receipt', '🧾 Чек по покупке',
      { text: `Чек по покупке «${orderTitle(o)}» на ${o.priceRub} ₽ пришёл в игровую почту.` });
  } catch (e) {}
  notices.push(`🧾 Чек отправлен игроку «${buyer.name}» по заказу на ${o.priceRub} ₽.`);
  return adminGet(actor, id);
}

function adminGet(actor: User, id: string) {
  assertOwner(actor);
  const o = store()[String(id || '')];
  if (!o) throw new u.ApiError('Заказ не найден');
  const people: Record<string, any> = require('./player').users();
  const isRk = o.provider === 'robokassa';
  const p = o.yk || {};
  const st = o.rk || {};
  const res = o.rkResult || {};
  // Деньги. У Робокассы комиссия приходит в уведомлении (Fee), а сумма,
  // списанная с покупателя, — в сверке (IncSum, в его валюте).
  const amount = isRk
    ? (Number(st.outSum || res.OutSum) || o.priceRub)
    : (p.amount ? Number(p.amount.value) : o.priceRub);
  const fee = isRk && res.Fee !== undefined && res.Fee !== '' ? Number(res.Fee) : null;
  const income = isRk
    ? (fee !== null ? Math.round((amount - fee) * 100) / 100 : null)
    : (p.income_amount ? Number(p.income_amount.value) : null);
  const ad = p.authorization_details || {};
  return {
    id: o.id, title: orderTitle(o), status: o.status, priceRub: o.priceRub,
    creditedGold: o.creditedGold || 0, createdAt: o.createdAt, paidAt: o.paidAt || 0,
    cancelReason: o.cancelReason || (p.cancellation_details && p.cancellation_details.reason) || '',
    cancelParty: (p.cancellation_details && p.cancellation_details.party) || '',
    refundedRub: o.refundedRub || 0,
    userId: o.userId, userName: (people[o.userId] && people[o.userId].name) || '',
    provider: o.provider || '', providerRef: o.providerRef || '',
    providerName: isRk ? 'Робокасса' : (o.provider === 'yookassa' ? 'ЮKassa (отключена)' : ''),
    invId: o.invId || 0,
    buyer: o.buyer || null,
    receiptLines: (o.receipt && o.receipt.lines) || [],
    events: o.events || [],
    method: methodOf(o),
    auth: {
      rrn: ad.rrn || '', authCode: ad.auth_code || '',
      threeDs: ad.three_d_secure ? (ad.three_d_secure.applied ? 'пройдена' : 'не применялась') : '',
    },
    money: {
      amount, currency: isRk ? 'RUB' : ((p.amount && p.amount.currency) || 'RUB'),
      income, commission: income !== null ? Math.round((amount - income) * 100) / 100 : null,
      refunded: isRk ? (o.refundedRub || 0) : (p.refunded_amount ? Number(p.refunded_amount.value) : 0),
      test: isTest(o),
      createdAt: isRk ? '' : (p.created_at || ''), capturedAt: isRk ? (st.stateAt || '') : (p.captured_at || ''),
      paid: isRk ? !!st.paid || o.status === 'paid' : !!p.paid,
      // Что платил покупатель в своей валюте — важно для иностранных карт
      incSum: isRk ? (st.incSum || '') : '',
      incCurr: isRk ? (st.incCurr || res.IncCurrLabel || '') : '',
      rate: isRk ? (st.rate || '') : '',
      providerStatus: isRk ? (st.stateName || '') : (p.status || ''),
      ykStatus: isRk ? (st.stateName || '') : (p.status || ''),
    },
    syncedAt: isRk ? (o.rkSyncedAt || 0) : (o.ykSyncedAt || 0),
    ykSyncedAt: isRk ? (o.rkSyncedAt || 0) : (o.ykSyncedAt || 0),
    refunds: (o.refunds || []).map((r: any) => ({
      id: r.id, status: r.status, amount: r.amount ? Number(r.amount.value) : 0,
      createdAt: r.created_at || '', description: r.description || '',
    })),
    promos: o.promoApplied || [],
    taxReceipt: o.taxReceipt || null,
    raw: isRk ? { state: o.rk || null, result: o.rkResult || null } : (o.yk || null),
    rawRefunds: o.refunds || [],
  };
}

// «Сверить с Робокассой»: свежее состояние счёта. Неоплаченный заказ
// сверяется обычным путём — если он оплачен, покупка зачислится.
// Возврат Робокасса отдельным уведомлением не присылает — его видно
// только здесь, по состоянию «возвращён».
async function adminRefresh(actor: User, id: string) {
  assertOwner(actor);
  const o = store()[String(id || '')];
  if (!o) throw new u.ApiError('Заказ не найден');
  if (o.provider === 'yookassa') {
    throw new u.ApiError('Заказ оформлен через ЮKassa — она отключена, сверять не с чем. Смотрите кабинет ЮKassa.');
  }
  if (o.provider !== 'robokassa' || !o.invId) {
    throw new u.ApiError('По этому заказу счёт в Робокассе не выставлялся — сверять нечего');
  }
  if (!rk().configured()) throw new u.ApiError('Робокасса не настроена на сервере: ' + rk().problem());
  try {
    if (o.status === 'pending') {
      await syncOrder(o);
    } else {
      const st = await rk().opState(o.invId);
      o.rk = snap(st);
      o.rkSyncedAt = Date.now();
      // Возврат: записываем один раз и зовём владельца решать, что делать
      // с уже выданным — автоматически золото не списываем
      if (st.refunded && !(o.refundedRub || 0)) {
        o.refundedRub = o.priceRub;
        const who: any = require('./player').users()[o.userId];
        auditLog.record({
          userId: o.userId, userName: (who && who.name) || '', path: '/system/payment-refund',
          desc: `💸 Возврат ${o.priceRub} ₽ по заказу ${o.id}. Золото и набор автоматически не списаны — решите вручную`,
          body: { orderId: o.id, refundRub: o.priceRub },
        });
      }
      db.save('payments');
    }
  } catch (e: any) {
    throw new u.ApiError('Робокасса не ответила: ' + String((e && e.message) || '').replace(/^Робокасса(: | ответила )/, ''));
  }
  return adminGet(actor, id);
}

// Состояние подключения — для раздела «Платежи». Только имена настроек и
// режим, никаких значений.
function providerState() {
  const r = rk();
  return {
    provider: 'Робокасса',
    configured: r.configured(),
    problem: r.problem(),
    test: r.isTest(),
    resultUrl: `${appUrl()}/api/payments/robokassa/result`,
    successUrl: `${appUrl()}/api/payments/robokassa/success`,
    failUrl: `${appUrl()}/api/payments/robokassa/fail`,
  };
}

export = {
  packages, createOrder, createOfferOrder, pay, payLava, checkOrder, handleResult, handleReturn,
  handleLavaWebhook, lavaState, lavaProducts, lavaMap, lavaReady, lavaKeyOf,
  myOrders, confirmPayment, pendingPurchases, ackPurchase,
  adminList, adminGet, adminRefresh, setTaxReceipt, providerState, MAX_PRICE_RUB, PAY_NOTE,
};
