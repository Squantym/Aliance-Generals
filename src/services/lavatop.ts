// ===================================================================
// src/services/lavatop.ts — Lava Top: оплата зарубежной картой.
//
// ЗАЧЕМ. Робокасса принимает рубли и российские карты. Игроки из-за
// рубежа платить ею не могут. Lava Top берёт USD и EUR (Unlimint,
// PayPal) — она стоит рядом с Робокассой, а не вместо неё.
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ РОБОКАССЫ (и почему код не общий):
//  • Ссылку на оплату не собираем сами: её ВЫДАЁТ Lava в ответ на
//    запрос «создать контракт». Значит, здесь есть поход в сеть, и
//    игрок ждёт ответа — в отличие от Робокассы, где ссылка считается
//    на месте.
//  • Платим не за произвольную сумму, а за ТОВАР из каталога Lava:
//    у каждой цены свой offerId. Поэтому пакет золота и каждый набор
//    нужно связать с товаром — связка живёт в коллекции 'lavaOffers',
//    её задаёт владелец в панели (список товаров подтягивается по
//    ключу, руками ничего вписывать не надо).
//  • Об оплате Lava сообщает вебхуком. Своего номера заказа в нём нет:
//    есть contractId — тот самый, что она вернула при создании. По нему
//    и находим заказ.
//  • Подписи у вебхука нет. Lava шлёт то, что владелец задал в кабинете:
//    ключ (заголовок X-Api-Key) или логин и пароль (Authorization: Basic).
//    Сравниваем с LAVATOP_WEBHOOK_KEY — без совпадения уведомление не
//    рассматриваем вовсе.
//
// Ключи — только из окружения, читаются при каждом вызове (как у
// Робокассы: их вписывают в .env на живом сервере). В ответы, журнал и
// текст ошибок ключи не попадают.
//
//   LAVATOP_API_KEY      — ключ API из кабинета lava.top
//   LAVATOP_WEBHOOK_KEY  — ключ вебхука или «логин:пароль» (см. verifyWebhook)
//   LAVATOP_CURRENCY     — валюта по умолчанию: USD (или EUR)
//   LAVATOP_API_URL      — адрес API, по умолчанию https://gate.lava.top
//
// Транспорт подменяемый: тесты ходят в поддельную Lava, а не в сеть.
// ===================================================================

const TIMEOUT_MS = 20000;
const CURRENCIES = ['USD', 'EUR', 'RUB'];

type Resp = { status: number; text: string };
type Transport = (url: string, init: any) => Promise<Resp>;

function env(name: string): string { return String(process.env[name] || '').trim(); }

function apiUrl(): string { return env('LAVATOP_API_URL') || 'https://gate.lava.top'; }

function currency(): string {
  const c = env('LAVATOP_CURRENCY').toUpperCase();
  return CURRENCIES.indexOf(c) >= 0 ? c : 'USD';
}

function configured(): boolean { return !!env('LAVATOP_API_KEY'); }

// Почему не настроено — для панели и диагностики. Только имена настроек.
function problem(): string {
  if (!env('LAVATOP_API_KEY')) return 'не задан LAVATOP_API_KEY';
  if (!env('LAVATOP_WEBHOOK_KEY')) {
    return 'не задан LAVATOP_WEBHOOK_KEY — без него уведомления об оплате принимать нельзя';
  }
  return '';
}

// Готова ли касса принимать оплату: мало ключа API — без ключа вебхука
// оплату никто не подтвердит, и деньги уйдут в никуда.
function ready(): boolean { return configured() && !problem(); }

let transport: Transport = async (url, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
    return { status: r.status, text: await r.text() };
  } finally { clearTimeout(timer); }
};
function setTransport(fn: Transport | null): void {
  transport = fn || transport;
}

async function call(method: string, path: string, body?: any): Promise<any> {
  if (!configured()) throw new Error('Lava Top не настроена: ' + problem());
  // Следующую страницу каталога Lava отдаёт ПОЛНЫМ адресом (nextPage)
  const url = /^https?:\/\//.test(path) ? path : apiUrl() + path;
  // Ключ API уходит только на адрес самой Lava: полный адрес приходит в
  // её же ответе, но если бы туда подложили чужой хост, ключ утёк бы
  if (url.indexOf(apiUrl()) !== 0) throw new Error('адрес страницы вне API Lava — отказ');
  const r = await transport(url, {
    method,
    headers: {
      'X-Api-Key': env('LAVATOP_API_KEY'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = JSON.parse(r.text); } catch (e) { data = null; }
  if (r.status < 200 || r.status >= 300) {
    // Текст ошибки Lava показываем владельцу, но не ключи: их в ответе нет,
    // а сам запрос мы не пересказываем
    const why = (data && (data.error || data.message || data.detail))
      || `ответ ${r.status}`;
    const e: any = new Error(String(why).slice(0, 200));
    e.status = r.status;
    throw e;
  }
  return data;
}

// ── Каталог ───────────────────────────────────────────────────────
// Товары владельца в Lava. Отдаём плоским списком «цена → что это»:
// панели нужно показать выпадающий список, а не дерево.
// Схема ответа (gate.lava.top/docs): { items: [{ type, data }], nextPage }.
// В ленте бывают и посты — берём только PRODUCT. Страницы идут по
// nextPage; ограничиваем их число, чтобы сбой на стороне Lava не
// превратился в бесконечный цикл запросов.
const MAX_PAGES = 20;
async function products(): Promise<Array<{ offerId: string; title: string; price: number; currency: string; prices: any[] }>> {
  const items: any[] = [];
  let next: string | null = '/api/v2/products?feedVisibility=ALL&contentCategories=PRODUCT';
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const data: any = await call('GET', next);
    const list: any[] = (data && data.items) || (Array.isArray(data) ? data : []);
    items.push(...list);
    next = (data && data.nextPage) ? String(data.nextPage) : null;
  }
  const out: Array<{ offerId: string; title: string; price: number; currency: string; prices: any[] }> = [];
  for (const it of items) {
    if (it && it.type && it.type !== 'PRODUCT') continue;
    const prod = (it && (it.data || it)) || {};
    const title = String(prod.title || prod.name || 'Без названия');
    for (const off of (prod.offers || [])) {
      const prices = (off.prices || []).map((p: any) => ({ amount: Number(p.amount) || 0, currency: String(p.currency || '') }));
      const mine = prices.find((p: any) => p.currency === currency()) || prices[0] || { amount: 0, currency: currency() };
      out.push({
        offerId: String(off.id || ''),
        title: off.name ? `${title} — ${off.name}` : title,
        price: mine.amount, currency: mine.currency, prices,
      });
    }
  }
  return out.filter((x) => x.offerId);
}

// ── Счёт ──────────────────────────────────────────────────────────
// Возвращает contractId (по нему потом придёт уведомление), ссылку на
// оплату и сумму, которую Lava реально спишет.
async function createInvoice(o: { email: string; offerId: string; currency?: string; returnUrl?: string }): Promise<{ id: string; paymentUrl: string; amount: number; currency: string; status: string }> {
  const cur = (o.currency || currency()).toUpperCase();
  const body: any = {
    email: String(o.email || ''),
    offerId: String(o.offerId || ''),
    currency: CURRENCIES.indexOf(cur) >= 0 ? cur : currency(),
  };
  // Куда вернуть игрока со страницы оплаты. Без этого он оставался на
  // сайте Lava и возвращался в игру руками — а окно покупки ждало его
  // уже в банке.
  if (o.returnUrl) {
    body.successful_return_url = o.returnUrl;
    body.failure_return_url = o.returnUrl;
    body.cancel_return_url = o.returnUrl;
  }
  const data = await call('POST', '/api/v3/invoice', body);
  const total = (data && data.amountTotal) || {};
  return {
    id: String((data && data.id) || ''),
    paymentUrl: String((data && data.paymentUrl) || ''),
    amount: Number(total.amount) || 0,
    currency: String(total.currency || cur),
    status: String((data && data.status) || 'new'),
  };
}

// Состояние контракта — если уведомление потерялось
async function invoice(id: string): Promise<any> {
  return call('GET', '/api/v1/invoices/' + encodeURIComponent(String(id || '')));
}

// ── Уведомление об оплате ─────────────────────────────────────────
// Подписи у Lava нет: она шлёт ключ, заданный владельцем в кабинете.
// Сравниваем посимвольно, но без утечки по времени — как и подписи
// Робокассы. Заголовки приходят в нижнем регистре (наш http.ts), но
// принимаем оба написания.
// В кабинете Lava у уведомлений два способа защиты (схемы
// ApiKeyWebhookAuth и BasicWebhookAuth в их документации):
//   • ключ API — приходит заголовком X-Api-Key;
//   • логин и пароль — заголовком Authorization: Basic base64(логин:пароль).
// LAVATOP_WEBHOOK_KEY хранит ключ либо «логин:пароль» — что выбрано в
// кабинете, то и сверяем.
function sameSecret(got: string, want: string): boolean {
  if (!got || got.length !== want.length) return false;
  const crypto = require('crypto');
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
function verifyWebhook(headers: Record<string, any>): boolean {
  const want = env('LAVATOP_WEBHOOK_KEY');
  if (!want) return false;
  const h = headers || {};
  const apiKey = String(h['x-api-key'] || h['X-Api-Key'] || '').trim();
  if (apiKey) return sameSecret(apiKey, want);
  const auth = String(h.authorization || h.Authorization || '').trim();
  const basic = /^Basic\s+(.+)$/i.exec(auth);
  if (basic) {
    let pair = '';
    try { pair = Buffer.from(basic[1], 'base64').toString('utf8'); } catch (e) { pair = ''; }
    return sameSecret(pair, want);
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  return bearer ? sameSecret(bearer[1].trim(), want) : false;
}

// Оплачено ли по телу уведомления. Событие и статус проверяем ОБА:
// у отказов тот же eventType, но другой статус.
function isPaid(body: any): boolean {
  const ev = String((body && body.eventType) || '');
  const st = String((body && body.status) || '');
  return ev === 'payment.success' && st === 'completed';
}

export = {
  configured, ready, problem, currency, products, createInvoice, invoice,
  verifyWebhook, isPaid, setTransport, apiUrl, CURRENCIES,
};
