// ===================================================================
// src/services/robokassa.ts — Робокасса: подписи, ссылка на оплату,
// проверка уведомлений и запрос статуса.
//
// Как это устроено у Робокассы (и чем отличается от ЮKassa):
//   • Платёж не «создаётся» запросом. Мы сами собираем ссылку на её
//     страницу оплаты и подписываем её паролем №1. Игрок уходит по
//     ссылке и сам выбирает способ — там же и иностранные карты.
//   • Об оплате Робокасса сообщает на Result URL и подписывает
//     уведомление паролем №2. Ответ ей — строго текст «OK<номер>».
//   • Статус заказа можно спросить сами (OpStateExt), подпись тоже
//     паролем №2. Этим сверяется заказ, когда уведомление задержалось.
//
// Ключи — только из окружения, читаются при каждом вызове: их вписывают
// в .env на живом сервере, и после pm2 restart --update-env они должны
// подхватиться без правки кода. В ответы, журнал и текст ошибок ни логин
// магазина с паролями, ни подписи не попадают.
//
//   ROBOKASSA_LOGIN        — идентификатор магазина
//   ROBOKASSA_PASS1/PASS2  — пароли №1 и №2 (боевые)
//   ROBOKASSA_TEST=1       — тестовый режим: IsTest=1 и тестовые пароли
//   ROBOKASSA_TEST_PASS1/2 — тестовые пароли
//   ROBOKASSA_HASH         — алгоритм подписи, как в настройках магазина
//                            (md5 по умолчанию; sha1, sha256, sha384, sha512)
//   ROBOKASSA_INV_BASE     — с какого номера начинать счета: у каждого
//                            мира свой диапазон, чтобы номера не пересеклись
//   ROBOKASSA_RECEIPT=1    — передавать состав для фискального чека
//   ROBOKASSA_SNO / _TAX   — система налогообложения и ставка для чека
//
// Транспорт подменяемый: тесты ходят в поддельную Робокассу, а не в сеть.
// ===================================================================

import crypto = require('crypto');

const PAY_URL = String(process.env.ROBOKASSA_PAY_URL || 'https://auth.robokassa.ru/Merchant/Index.aspx');
const STATE_URL = String(process.env.ROBOKASSA_STATE_URL
  || 'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt');
const TIMEOUT_MS = 15000;

// Алгоритмы, которые предлагает кабинет Робокассы и умеет Node без
// дополнительных библиотек. RIPEMD160 в свежих сборках OpenSSL выключен —
// его не берём: подпись, которую сервер не может посчитать, хуже, чем
// честный отказ при запуске.
const HASHES = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'];

type Resp = { status: number; text: string };
type Transport = (url: string) => Promise<Resp>;

function env(name: string): string { return String(process.env[name] || '').trim(); }

function isTest(): boolean { return env('ROBOKASSA_TEST') === '1'; }

function creds() {
  const test = isTest();
  return {
    login: env('ROBOKASSA_LOGIN'),
    pass1: test ? env('ROBOKASSA_TEST_PASS1') : env('ROBOKASSA_PASS1'),
    pass2: test ? env('ROBOKASSA_TEST_PASS2') : env('ROBOKASSA_PASS2'),
    test,
  };
}

function hashName(): string {
  const h = (env('ROBOKASSA_HASH') || 'md5').toLowerCase();
  return HASHES.indexOf(h) >= 0 ? h : '';
}

function configured(): boolean {
  const c = creds();
  return !!(c.login && c.pass1 && c.pass2 && hashName());
}

// Почему не настроено — для диагностики и панели. Только имена настроек,
// никаких значений.
function problem(): string {
  const c = creds();
  if (!c.login) return 'не задан ROBOKASSA_LOGIN';
  if (!c.pass1 || !c.pass2) {
    return c.test ? 'не заданы ROBOKASSA_TEST_PASS1 / ROBOKASSA_TEST_PASS2'
                  : 'не заданы ROBOKASSA_PASS1 / ROBOKASSA_PASS2';
  }
  if (!hashName()) return `ROBOKASSA_HASH: неизвестный алгоритм (доступны: ${HASHES.join(', ')})`;
  return '';
}

function hash(s: string): string {
  return crypto.createHash(hashName() || 'md5').update(s, 'utf8').digest('hex');
}

// Пользовательские параметры Shp_* входят в подпись, отсортированные по
// имени, в виде «:Shp_имя=значение» ПОСЛЕ пароля. Порядок сортировки —
// обычное сравнение строк, как у Робокассы.
function shpTail(shp: Record<string, string>): string {
  return Object.keys(shp || {})
    .filter((k) => /^shp_/i.test(k))
    .sort()
    .map((k) => `:${k}=${shp[k]}`)
    .join('');
}

// Сравнение подписей без утечки по времени и без учёта регистра:
// Робокасса присылает шестнадцатеричную строку в верхнем регистре.
function sameSig(a: string, b: string): boolean {
  const x = Buffer.from(String(a || '').toLowerCase());
  const y = Buffer.from(String(b || '').toLowerCase());
  if (x.length !== y.length || !x.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// Сумма в том виде, в каком уходит в ссылку и в подпись. Строка должна
// совпадать символ в символ — «99» и «99.00» дают разные подписи.
function outSum(rub: number): string {
  return (Math.round(Number(rub) * 100) / 100).toFixed(2);
}

// Состав для фискального чека (54-ФЗ). Передаётся, только если магазин
// выдаёт чеки через Робокассу. Для самозанятого чек формирует «Мой налог»,
// и тогда этот параметр не нужен вовсе.
function receiptJson(o: { description: string; amountRub: number }): string {
  const sno = env('ROBOKASSA_SNO');
  const r: any = {
    items: [{
      name: String(o.description || '').slice(0, 128),
      quantity: 1,
      sum: Number(outSum(o.amountRub)),
      payment_method: 'full_payment',
      payment_object: 'service',
      tax: env('ROBOKASSA_TAX') || 'none',
    }],
  };
  if (sno) r.sno = sno;
  return JSON.stringify(r);
}

// Ссылка на оплату. invId — целое число (так требует Робокасса), номер
// нашего заказа едет отдельным Shp-параметром и входит в подпись.
function payUrl(o: {
  invId: number; amountRub: number; description: string; orderId: string;
  email?: string; culture?: string;
}): string {
  if (!configured()) throw new Error('Робокасса не настроена: ' + problem());
  const c = creds();
  const sum = outSum(o.amountRub);
  const shp: Record<string, string> = { Shp_order: String(o.orderId) };
  const withReceipt = env('ROBOKASSA_RECEIPT') === '1';
  const receipt = withReceipt ? receiptJson(o) : '';
  // Состав чека, если он есть, стоит в подписи между номером счёта и паролем
  const base = withReceipt
    ? `${c.login}:${sum}:${o.invId}:${receipt}:${c.pass1}`
    : `${c.login}:${sum}:${o.invId}:${c.pass1}`;
  const params = new URLSearchParams();
  params.set('MerchantLogin', c.login);
  params.set('OutSum', sum);
  params.set('InvId', String(o.invId));
  params.set('Description', String(o.description || '').slice(0, 100));
  params.set('SignatureValue', hash(base + shpTail(shp)));
  params.set('Culture', o.culture === 'en' ? 'en' : 'ru');
  params.set('Encoding', 'utf-8');
  if (o.email) params.set('Email', String(o.email).slice(0, 100));
  if (withReceipt) params.set('Receipt', receipt);
  if (c.test) params.set('IsTest', '1');
  params.set('Shp_order', shp.Shp_order);
  // Способ оплаты НЕ навязываем: игрок выбирает на странице Робокассы.
  // Там же иностранные карты — любой заранее выбранный способ их бы скрыл.
  return `${PAY_URL}?${params.toString()}`;
}

// Проверка уведомления об оплате (Result URL). Подпись — паролем №2.
// Сумму берём из запроса КАК ЕСТЬ: Робокасса присылает «99.000000», и
// подпись считается именно от этой строки.
//
// Тестовой подписи на боевом сервере не верим: тестовые пароли знает
// каждый, кто открыл кабинет, а золото за тестовый платёж — настоящее.
function verifyResult(q: Record<string, any>): { ok: boolean; invId: number; outSum: string; orderId: string; why: string } {
  const bad = (why: string) => ({ ok: false, invId: 0, outSum: '', orderId: '', why });
  if (!configured()) return bad('Робокасса не настроена');
  const c = creds();
  const sum = String(q.OutSum || q.out_summ || '');
  const inv = String(q.InvId || q.inv_id || '');
  const sig = String(q.SignatureValue || q.crc || '');
  if (!sum || !/^\d+$/.test(inv) || !sig) return bad('в уведомлении нет суммы, номера или подписи');
  const shp: Record<string, string> = {};
  for (const k of Object.keys(q || {})) if (/^shp_/i.test(k)) shp[k] = String(q[k]);
  const want = hash(`${sum}:${inv}:${c.pass2}${shpTail(shp)}`);
  if (!sameSig(sig, want)) return bad('подпись не совпала');
  return { ok: true, invId: Number(inv), outSum: sum, orderId: String(shp.Shp_order || ''), why: '' };
}

// Подпись возврата игрока со страницы оплаты (Success URL) — паролем №1.
// Зачислять по ней нельзя: это браузер игрока, а не сервер Робокассы.
// Нужна только чтобы понять, какой заказ открыть.
function verifySuccess(q: Record<string, any>): boolean {
  if (!configured()) return false;
  const c = creds();
  const sum = String(q.OutSum || '');
  const inv = String(q.InvId || '');
  const sig = String(q.SignatureValue || '');
  if (!sum || !inv || !sig) return false;
  const shp: Record<string, string> = {};
  for (const k of Object.keys(q || {})) if (/^shp_/i.test(k)) shp[k] = String(q[k]);
  return sameSig(sig, hash(`${sum}:${inv}:${c.pass1}${shpTail(shp)}`));
}

const netTransport: Transport = async (url) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: 'GET', signal: ctl.signal });
    return { status: r.status, text: await r.text() };
  } finally {
    clearTimeout(timer);
  }
};
let transport: Transport = netTransport;
function setTransport(fn: Transport | null) { transport = fn || netTransport; }

// Достаём значение тега из XML-ответа. Ответ маленький и плоский —
// тащить ради него разборщик XML незачем.
function tag(xml: string, path: string[]): string {
  let cur = xml;
  for (const t of path) {
    const m = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`).exec(cur);
    if (!m) return '';
    cur = m[1];
  }
  return cur.trim();
}

// Что Робокасса знает о счёте. Коды состояния:
//    5 — только создан, 10 — отменён (не оплачен), 50 — деньги получены,
//   идёт зачисление, 60 — возврат, 80 — приостановлен, 100 — оплачен.
const STATE_NAMES: Record<string, string> = {
  '5': 'создан, не оплачен', '10': 'отменён', '50': 'оплачен, идёт зачисление',
  '60': 'возвращён покупателю', '80': 'приостановлен', '100': 'оплачен',
};

async function opState(invId: number) {
  if (!configured()) throw new Error('Робокасса не настроена: ' + problem());
  const c = creds();
  const params = new URLSearchParams();
  params.set('MerchantLogin', c.login);
  params.set('InvoiceID', String(invId));
  params.set('Signature', hash(`${c.login}:${invId}:${c.pass2}`));
  if (c.test) params.set('IsTest', '1');
  const r = await transport(`${STATE_URL}?${params.toString()}`);
  if (!r || r.status >= 400 || !r.text) {
    throw new Error(`Робокасса ответила ${r ? r.status : 'пустотой'}`);
  }
  const xml = r.text;
  const resultCode = tag(xml, ['Result', 'Code']);
  // Код результата не ноль — запрос не принят (неверная подпись, нет
  // такого счёта). Описание Робокассы не содержит секретов — отдаём его.
  if (resultCode && resultCode !== '0') {
    const d = tag(xml, ['Result', 'Description']).slice(0, 200);
    const e: any = new Error(`Робокасса: ${d || 'код ' + resultCode}`);
    e.rkCode = resultCode;
    throw e;
  }
  const state = tag(xml, ['State', 'Code']);
  return {
    invId,
    state,
    stateName: STATE_NAMES[state] || (state ? 'код ' + state : 'нет данных'),
    stateAt: tag(xml, ['State', 'StateDate']),
    outSum: tag(xml, ['Info', 'OutSum']),
    incSum: tag(xml, ['Info', 'IncSum']),
    incCurr: tag(xml, ['Info', 'IncCurrLabel']),
    incAccount: tag(xml, ['Info', 'IncAccount']),
    method: tag(xml, ['Info', 'PaymentMethod', 'Code']),
    methodName: tag(xml, ['Info', 'PaymentMethod', 'Description']),
    outCurr: tag(xml, ['Info', 'OutCurrLabel']),
    rate: tag(xml, ['Info', 'Rate']),
    paid: state === '100',
    cancelled: state === '10',
    refunded: state === '60',
  };
}

export = {
  configured, problem, isTest, payUrl, verifyResult, verifySuccess, opState,
  setTransport, outSum, STATE_NAMES, PAY_URL,
};
