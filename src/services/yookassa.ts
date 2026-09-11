// ===================================================================
// src/services/yookassa.ts — клиент API ЮKassa (v3).
//
// Ключи — только из окружения: YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.
// В базе и в ответах игры их нет, в текст ошибок они не попадают:
// ошибка собирается из кода ответа и описания ЮKassa, заголовки запроса
// не печатаются никогда.
//
// Транспорт подменяемый: тесты ходят в поддельную ЮKassa, а не в сеть.
// ===================================================================

const API_URL = String(process.env.YOOKASSA_API_URL || 'https://api.yookassa.ru/v3').replace(/\/+$/, '');
// Игрок ждёт ответа на нажатие «Купить» — висеть минуту нельзя
const TIMEOUT_MS = 15000;

type Resp = { status: number; json: any };
type Transport = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Resp>;

// Читаем при каждом вызове, а не при загрузке модуля: ключи вписывают в
// .env на живом сервере, и после pm2 restart --update-env они должны
// подхватиться без правки кода
function creds() {
  return {
    shopId: String(process.env.YOOKASSA_SHOP_ID || '').trim(),
    secret: String(process.env.YOOKASSA_SECRET_KEY || '').trim(),
  };
}

function configured(): boolean {
  const c = creds();
  return !!(c.shopId && c.secret);
}

const netTransport: Transport = async (url, init) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: ctl.signal });
    let json: any = null;
    try { json = await r.json(); } catch (e) { json = null; }
    return { status: r.status, json };
  } finally {
    clearTimeout(timer);
  }
};

let transport: Transport = netTransport;
function setTransport(fn: Transport | null) { transport = fn || netTransport; }

async function call(method: string, path: string, body?: any, idempotenceKey?: string): Promise<any> {
  if (!configured()) throw new Error('ключи магазина ЮKassa не заданы');
  const c = creds();
  const headers: Record<string, string> = {
    Authorization: 'Basic ' + Buffer.from(`${c.shopId}:${c.secret}`).toString('base64'),
    'Content-Type': 'application/json',
  };
  if (idempotenceKey) headers['Idempotence-Key'] = idempotenceKey;
  const r = await transport(API_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r || r.status >= 400 || !r.json) {
    const d = r && r.json ? String(r.json.description || r.json.code || '').slice(0, 200) : '';
    throw new Error(`ЮKassa ответила ${r ? r.status : 'пустотой'}${d ? ': ' + d : ''}`);
  }
  return r.json;
}

// Платёж со списанием сразу (capture): игровой товар выдаётся моментально,
// держать деньги в холде незачем.
// Idempotence-Key — номер заказа: повтор запроса после обрыва связи не
// создаст второй платёж по тому же заказу.
function createPayment(o: { orderId: string; amountRub: number; description: string; returnUrl: string }) {
  return call('POST', '/payments', {
    amount: { value: Number(o.amountRub).toFixed(2), currency: 'RUB' },
    capture: true,
    confirmation: { type: 'redirect', return_url: o.returnUrl },
    description: String(o.description || '').slice(0, 128),
    metadata: { orderId: o.orderId },
  }, 'order-' + o.orderId);
}

function getPayment(id: string) { return call('GET', '/payments/' + encodeURIComponent(id)); }
function getRefund(id: string) { return call('GET', '/refunds/' + encodeURIComponent(id)); }

export = { configured, createPayment, getPayment, getRefund, setTransport, API_URL };
