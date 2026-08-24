// ===================================================================
// src/services/email.ts — отправка писем (подтверждение почты, сброс пароля)
//
// Используется HTTP API сервиса resend.com (бесплатный тариф:
// 3000 писем/мес, 100/день). Никаких npm-зависимостей — через fetch().
//
// Переменные окружения:
//   RESEND_API_KEY — ключ API (resend.com → API Keys)
//   EMAIL_FROM     — адрес отправителя, например
//                    "Альянс Генералов <noreply@ваш-домен>". Тестовый
//                    onboarding@resend.dev шлёт ТОЛЬКО на почту владельца
//                    аккаунта Resend — реальным игрокам письма не дойдут!
//   APP_URL        — публичный адрес игры (для ссылок в письме)
//
// РЕЖИМ РАЗРАБОТКИ: если RESEND_API_KEY не задан, письмо не отправляется,
// ссылка выводится в консоль, а auth.register считает почту подтверждённой.
// ===================================================================

// ── Какой сервис отправляет письма ────────────────────────────────
// Основной — Unisender Go: российский, и это принципиально. Письма с
// зарубежных серверов mail.ru и Яндекс часто кладут в спам, а у нашей
// аудитории почта в основном там. Игрок не получил бы письмо, не смог
// войти и просто ушёл бы — причём молча.
//
// Resend оставлен запасным: если ключа Unisender нет, а ключ Resend
// есть, работает он. Так переход не ломает уже настроенные серверы.
import brand = require('../core/brand');

const UNISENDER_API_KEY = process.env.UNISENDER_API_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

// Unisender Go разводит клиентов по нескольким площадкам (go1, go2, …) с
// одинаковым API, но РАЗНЫМИ базами пользователей. Ключ, выданный на
// одной, на другой не опознаётся: сервер разбирает ключ, достаёт из него
// внутренний номер владельца и не находит такого у себя. Наружу это
// выглядит как «User with id '…' not found» — то есть как поломка
// аккаунта, хотя аккаунт цел и стучимся мы просто не в ту дверь.
//
// Поэтому по умолчанию берём УНИВЕРСАЛЬНЫЙ адрес: он сам направляет
// запрос на площадку владельца ключа. Раньше здесь был прибит go1, и
// любой аккаунт с go2 получал стопроцентный отказ на все письма.
const UNISENDER_URL = process.env.UNISENDER_URL
  || 'https://goapi.unisender.ru/ru/transactional/api/v1/email/send.json';

const EMAIL_FROM = process.env.EMAIL_FROM || `${brand.GAME_NAME_EN} <onboarding@resend.dev>`;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Какой сервис используем на самом деле
const provider: 'unisender' | 'resend' | 'none' =
  UNISENDER_API_KEY ? 'unisender' : (RESEND_API_KEY ? 'resend' : 'none');

// true, если настроена реальная отправка почты
const isConfigured = provider !== 'none';
// Признак «тестового» отправителя resend.dev — шлёт только владельцу аккаунта
const usingTestSender = /resend\.dev/i.test(EMAIL_FROM);

// Разбираем «Имя <адрес>» — Unisender требует имя и адрес отдельно
function splitFrom(raw: string): { name: string; email: string } {
  const m = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(String(raw || ''));
  if (m) return { name: m[1].replace(/^["']|["']$/g, '') || brand.GAME_NAME_EN, email: m[2] };
  return { name: brand.GAME_NAME_EN, email: String(raw || '').trim() };
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]));
}

// Отправка через Unisender Go.
// Формат ответа у него свой: HTTP 200 приходит и при частичном отказе,
// поэтому обязательно смотрим failed_emails в теле — иначе сбой
// выглядел бы успехом, и мы не узнали бы, что письма не доходят.
// Можно ли просить «письмо без отписки». Право на это выдаётся отдельно
// (флаг allow_skip_unsubscribe у аккаунта), и на бесплатном тарифе его
// обычно нет. Запрашивать разрешение хорошо: письмо о подтверждении
// почты — служебное, ссылка «отписаться» в нём вредна (игрок отпишется —
// и не получит ни сброса пароля, ни подтверждения). Но если права нет,
// сервис отклоняет письмо ЦЕЛИКОМ, и лучше отправить со ссылкой
// отписки, чем не отправить совсем.
//
// Поэтому: пробуем с флагом, а на отказ именно по нему — повторяем без
// него и запоминаем. Один лишний запрос за весь запуск, дальше сразу
// правильно. UNISENDER_SKIP_UNSUBSCRIBE=0 выключает попытку заранее.
let skipUnsubscribeAllowed = String(process.env.UNISENDER_SKIP_UNSUBSCRIBE || '1') !== '0';

function isSkipUnsubscribeRefusal(msg: string): boolean {
  return /skip_unsubscribe/i.test(msg) || /allow_skip_unsubscribe/i.test(msg);
}

async function unisenderRequest(to: string, subject: string, html: string, withSkip: boolean) {
  const from = splitFrom(EMAIL_FROM);
  const message: any = {
    recipients: [{ email: to }],
    body: { html },
    subject,
    from_email: from.email,
    from_name: from.name,
  };
  if (withSkip) message.skip_unsubscribe = 1;

  const res = await fetch(UNISENDER_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': UNISENDER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });
  const bodyText = await res.text().catch(() => '');
  let parsed: any = {};
  try { parsed = JSON.parse(bodyText); } catch (e) {}
  return { res, bodyText, parsed };
}

async function sendViaUnisender(to: string, subject: string, html: string):
  Promise<{ sent: boolean; status: number; error: string; id?: string }> {
  try {
    let { res, bodyText, parsed } = await unisenderRequest(to, subject, html, skipUnsubscribeAllowed);

    // Отказ именно из-за «без отписки» — повторяем обычным письмом.
    // Иначе владелец видел бы загадочное «письмо не ушло» и чинил бы
    // домен, ключ и площадку, хотя дело в праве на один флаг.
    if (skipUnsubscribeAllowed) {
      const reason = String(parsed.message || parsed.error || bodyText || '');
      if ((!res.ok || parsed.status === 'error') && isSkipUnsubscribeRefusal(reason)) {
        console.warn('📧 Unisender: у аккаунта нет права на письма без ссылки отписки — '
          + 'шлём обычным письмом. Чтобы убрать отписку из служебных писем, '
          + 'попросите поддержку включить allow_skip_unsubscribe.');
        skipUnsubscribeAllowed = false;
        ({ res, bodyText, parsed } = await unisenderRequest(to, subject, html, false));
      }
    }

    if (!res.ok || parsed.status === 'error') {
      const reason = parsed.message || parsed.error || bodyText || `HTTP ${res.status}`;
      console.error(`📧 Unisender отклонил письмо для <${to}>: HTTP ${res.status} — ${reason}`);
      return { sent: false, status: res.status, error: String(reason) };
    }
    // Адрес мог быть отклонён поимённо при общем «успехе»
    const failed = parsed.failed_emails || {};
    if (failed && failed[to]) {
      console.error(`📧 Unisender не принял адрес <${to}>: ${failed[to]}`);
      return { sent: false, status: res.status, error: String(failed[to]) };
    }
    const id = (parsed.job_id || (parsed.emails && parsed.emails[0])) || undefined;
    return { sent: true, status: res.status, error: '', id };
  } catch (e: any) {
    console.error('📧 Сетевая ошибка отправки письма (Unisender):', e.message);
    return { sent: false, status: 0, error: e.message || 'network error' };
  }
}

// Низкоуровневая отправка через Resend. Возвращает подробный результат,
// чтобы вызывающий код и диагностика видели РЕАЛЬНУЮ причину сбоя.
async function sendViaResend(to: string, subject: string, html: string):
  Promise<{ sent: boolean; status: number; error: string; id?: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
    });
    const bodyText = await res.text().catch(() => '');
    if (!res.ok) {
      console.error(`📧 Resend отклонил письмо для <${to}>: HTTP ${res.status} — ${bodyText}`);
      return { sent: false, status: res.status, error: bodyText || `HTTP ${res.status}` };
    }
    let id: string | undefined;
    try { id = JSON.parse(bodyText).id; } catch (e) {}
    return { sent: true, status: res.status, error: '', id };
  } catch (e: any) {
    console.error('📧 Сетевая ошибка отправки письма:', e.message);
    return { sent: false, status: 0, error: e.message || 'network error' };
  }
}

// Единая точка отправки: выбор сервиса решается здесь и только здесь.
// Иначе при добавлении второго сервиса пришлось бы править каждое место
// вызова, и одно из них рано или поздно забыли бы.
async function sendMail(to: string, subject: string, html: string):
  Promise<{ sent: boolean; status: number; error: string; id?: string }> {
  if (provider === 'unisender') return sendViaUnisender(to, subject, html);
  if (provider === 'resend') return sendViaResend(to, subject, html);
  return { sent: false, status: 0, error: 'Отправка писем не настроена' };
}

function verifyHtml(name: string, link: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; color: #222;">
      <h2 style="color:#2e5b1f">Привет, ${escapeHtml(name)}!</h2>
      <p>Чтобы активировать аккаунт в игре «${brand.GAME_NAME}», подтвердите свою почту по кнопке ниже:</p>
      <p style="margin: 24px 0;">
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#d9a546;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;">
          Подтвердить почту
        </a>
      </p>
      <p style="color:#666;font-size:13px">Если кнопка не работает, перейдите по ссылке:<br>
        <a href="${link}">${link}</a></p>
      <p style="color:#999;font-size:12px;margin-top:24px">Если вы не регистрировались в игре «${brand.GAME_NAME}» — просто проигнорируйте это письмо.</p>
    </div>`;
}

function resetHtml(name: string, link: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; color: #222;">
      <h2 style="color:#2e5b1f">Привет, ${escapeHtml(name)}!</h2>
      <p>Вы запросили сброс пароля в игре «${brand.GAME_NAME}». Нажмите кнопку, чтобы задать новый пароль:</p>
      <p style="margin: 24px 0;">
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#d9a546;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;">
          Сбросить пароль
        </a>
      </p>
      <p style="color:#666;font-size:13px">Если кнопка не работает, перейдите по ссылке:<br>
        <a href="${link}">${link}</a></p>
      <p style="color:#999;font-size:12px;margin-top:24px">Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо, ваш пароль не изменится.</p>
    </div>`;
}

// Шаблон письма из панели. mailer подключается через require ВНУТРИ
// функции, а не импортом сверху: mailer сам зависит от email, и на
// верхнем уровне это дало бы круговую зависимость — один из модулей
// оказался бы наполовину пустым в момент загрузки.
//
// Если с шаблоном что-то не так (нет базы, битая запись), отправляем
// заводской текст. Письмо подтверждения важнее аккуратности: без него
// человек просто не войдёт в игру.
function tpl(id: string, name: string, link: string, code?: string): { subject: string; html: string } {
  try {
    return require('./mailer').render(id, { имя: name, ссылка: link, код: code || '' });
  } catch (e: any) {
    console.error('📧 Шаблон письма недоступен, беру заводской:', e && e.message);
    const html = id === 'reset' ? resetHtml(name, link) : verifyHtml(name, link);
    const subject = id === 'reset' ? `Восстановление пароля — ${brand.GAME_NAME}` : `Подтверждение почты — ${brand.GAME_NAME}`;
    return { subject, html };
  }
}

// Письмо подтверждения почты. Возвращает { sent, link, status, error }.
async function sendVerificationEmail(toEmail: string, name: string, token: string, code?: string):
  Promise<{ sent: boolean; link: string; status?: number; error?: string }> {
  const link = `${APP_URL}/#verify/${token}`;
  if (!isConfigured) {
    console.log('📧 [DEV] Почта не настроена — письмо не отправлено.');
    console.log(`📧 [DEV] Код подтверждения для «${name}» <${toEmail}>: ${code || '—'}`);
    console.log(`📧 [DEV] Ссылка подтверждения: ${link}`);
    return { sent: false, link };
  }
  // Тема и текст берутся из шаблона, который владелец правит в панели
  // («Почта» → «Шаблоны писем»). Заводской текст лежит там же, в
  // mailer.DEFAULTS, и совпадает с прежним вшитым.
  const t = tpl('verify', name, link, code);
  const r = await sendMail(toEmail, t.subject, t.html);
  if (!r.sent) console.error(`📧 Не удалось отправить подтверждение <${toEmail}>. Ссылка вручную: ${link}`);
  return { sent: r.sent, link, status: r.status, error: r.error };
}

// Приветственное письмо — уходит само после подтверждения почты.
// Отправку НЕ ждём на месте вызова: если сервис почты тормозит, игрок не
// должен стоять у окна регистрации. Не дошло — не беда, аккаунт активен.
async function sendWelcomeEmail(toEmail: string, name: string):
  Promise<{ sent: boolean; error?: string }> {
  if (!isConfigured) return { sent: false, error: 'почта не настроена' };
  try {
    const t = tpl('welcome', name, APP_URL);
    const r = await sendMail(toEmail, t.subject, t.html);
    if (!r.sent) console.error(`📧 Приветственное письмо не ушло <${toEmail}>: ${r.error}`);
    return { sent: r.sent, error: r.error };
  } catch (e: any) {
    console.error('📧 Приветственное письмо: сбой', e && e.message);
    return { sent: false, error: e && e.message };
  }
}

// Письмо восстановления пароля. Возвращает { sent, link, status, error }.
async function sendPasswordResetEmail(toEmail: string, name: string, token: string):
  Promise<{ sent: boolean; link: string; status?: number; error?: string }> {
  const link = `${APP_URL}/#reset/${token}`;
  if (!isConfigured) {
    console.log('📧 [DEV] Почта не настроена (нет RESEND_API_KEY).');
    console.log(`📧 [DEV] Ссылка сброса пароля для «${name}» <${toEmail}>: ${link}`);
    return { sent: false, link };
  }
  const t = tpl('reset', name, link);
  const r = await sendMail(toEmail, t.subject, t.html);
  if (!r.sent) console.error(`📧 Не удалось отправить сброс пароля <${toEmail}>. Ссылка вручную: ${link}`);
  return { sent: r.sent, link, status: r.status, error: r.error };
}

// ── Диагностика (для админки) ──────────────────────────────────────
// Текущее состояние конфигурации почты (без раскрытия самого ключа)
function status() {
  return {
    configured: isConfigured,
    from: EMAIL_FROM,
    appUrl: APP_URL,
    usingTestSender,               // true = onboarding@resend.dev (шлёт только владельцу)
    provider,
    // Маскируем именно ТОТ ключ, который работает: раньше показывался
    // только Resend, и при живом Unisender поле выглядело пустым — как
    // будто почта не настроена.
    keyMasked: (() => {
      const k = provider === 'unisender' ? UNISENDER_API_KEY : RESEND_API_KEY;
      return k ? k.slice(0, 5) + '…' + k.slice(-3) : null;
    })(),
    // Подсказки о вероятной проблеме
    hint: !isConfigured
      ? 'Ключ почтового сервиса не задан: UNISENDER_API_KEY (основной) или '
        + 'RESEND_API_KEY (запасной). Письма не отправляются, у новых игроков '
        + 'почта подтверждается сама — иначе они не смогли бы войти.'
      : (usingTestSender
        ? 'EMAIL_FROM = resend.dev: письма дойдут ТОЛЬКО на почту владельца аккаунта Resend. Подключите свой домен.'
        : 'Конфигурация выглядит рабочей. Проверьте тест-отправкой и папку «Спам».'),
  };
}

// Тестовая отправка на указанный адрес — возвращает реальный ответ Resend
async function sendTest(toEmail: string):
  Promise<{ sent: boolean; status: number; error: string; from: string; configured: boolean }> {
  const to = String(toEmail || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { sent: false, status: 0, error: 'Некорректный email', from: EMAIL_FROM, configured: isConfigured };
  }
  if (!isConfigured) {
    return { sent: false, status: 0, error: 'RESEND_API_KEY не задан (dev-режим)', from: EMAIL_FROM, configured: false };
  }
  const html = `<div style="font-family:Arial,sans-serif"><h3>Проверка почты «${brand.GAME_NAME}»</h3>
    <p>Если вы видите это письмо — отправка настроена верно ✅</p></div>`;
  const r = await sendMail(to, `Проверка почты — ${brand.GAME_NAME}`, html);
  return { sent: r.sent, status: r.status, error: r.error, from: EMAIL_FROM, configured: true };
}

// ── Где живёт ключ Unisender ───────────────────────────────────────
// Unisender Go — это несколько независимых площадок с одинаковым API,
// но РАЗНЫМИ базами пользователей. Ключ, выданный на одной, на другой не
// опознаётся: сервер разбирает ключ, достаёт из него внутренний номер
// владельца и не находит такого у себя. Наружу это выглядит как
//   «User with id '8316838' not found»
// то есть как поломка аккаунта, хотя аккаунт цел — мы стучимся не в ту
// дверь. Без этой проверки владелец идёт в поддержку и ждёт ответа
// сутками, хотя чинится строчкой в .env.
//
// Проверяем СПРАВОЧНЫМИ методами: они только читают и лимит писем не
// тратят. Иначе диагностика съедала бы то, ради чего её запускают.
// Список площадок можно переопределить через UNISENDER_HOSTS (через
// запятую): если сервис заведёт третью, владельцу не придётся ждать
// правки кода. Этим же пользуется тест, подставляя свои сервера.
// Универсальный адрес идёт первым: он работает при любой площадке, и
// советовать в первую очередь нужно именно его. Остальные проверяем
// ради ответа на вопрос «а где вообще живёт аккаунт» — это видно в
// панели и помогает разговаривать с поддержкой предметно.
// UNISENDER_ANY_HOST переопределяется только тестом: настоящий
// универсальный адрес в проверках дёргать нельзя.
const UNISENDER_ANY = process.env.UNISENDER_ANY_HOST || 'https://goapi.unisender.ru';
const UNISENDER_HOSTS = (process.env.UNISENDER_HOSTS || '')
  ? String(process.env.UNISENDER_HOSTS).split(',').map((s) => s.trim()).filter(Boolean)
  : [UNISENDER_ANY, 'https://go1.unisender.ru', 'https://go2.unisender.ru'];
const PROBE_METHODS = [
  '/ru/transactional/api/v1/domain/list.json',
  '/ru/transactional/api/v1/template/list.json',
];

// Признак «это не наша площадка»: ключ разобран, владелец не найден.
function isUserNotFound(msg: string): boolean {
  return /user with id/i.test(msg) && /not found/i.test(msg);
}

type ProbeResult = {
  host: string;
  current: boolean;              // сюда игра шлёт письма сейчас
  recognized: boolean | null;    // true — ключ свой, false — чужой, null — непонятно
  message: string;
  domains?: Array<{ name: string; verified: boolean }>;
};

async function probeHost(host: string): Promise<ProbeResult> {
  const current = UNISENDER_URL.startsWith(host);
  let lastMsg = '';
  for (const method of PROBE_METHODS) {
    try {
      const res = await fetch(host + method, {
        method: 'POST',
        headers: { 'X-API-KEY': UNISENDER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 50, offset: 0 }),
      });
      const text = await res.text().catch(() => '');
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch (e) {}
      const msg = String(parsed.message || parsed.error || text.slice(0, 200) || '');

      if (res.status === 200) {
        const list = Array.isArray(parsed.domains)
          ? parsed.domains.map((d: any) => ({
            name: String(d.domain || d.name || '?'),
            verified: !!(d.domain_verified || d.verified),
          }))
          : undefined;
        return { host, current, recognized: true, message: 'ключ признан', domains: list };
      }
      if (isUserNotFound(msg)) {
        return { host, current, recognized: false, message: msg };
      }
      // Ни успеха, ни «не найден» — возможно, метод переименован.
      // Пробуем следующий, иначе спутали бы «нет метода» с «нет ключа».
      lastMsg = msg;
    } catch (e: any) {
      return { host, current, recognized: null, message: 'сеть недоступна: ' + (e.message || '') };
    }
  }
  return { host, current, recognized: null, message: lastMsg || '(пустой ответ)' };
}

// Полная диагностика для панели. Ничего не отправляет.
async function diagnose(): Promise<any> {
  if (provider !== 'unisender') {
    return {
      ok: false,
      skipped: true,
      verdict: provider === 'resend'
        ? 'Сейчас работает запасной сервис (Resend) — проверять площадку Unisender нечего.'
        : 'Ключ почтового сервиса не задан, проверять нечего.',
      hosts: [],
    };
  }

  // Мусор в ключе виден до всякой сети: лишний пробел или кавычка
  // ломают заголовок, а глазом в редакторе это не заметно.
  const dirty = !/^[A-Za-z0-9]+$/.test(UNISENDER_API_KEY);

  const hosts = await Promise.all(UNISENDER_HOSTS.map(probeHost));
  const working = hosts.filter((h) => h.recognized === true);
  // Что советовать. Если нынешний адрес работает — не трогаем ничего.
  // Иначе universal-адрес предпочтительнее конкретной площадки: он
  // переживёт переезд аккаунта, а прибитая площадка — нет.
  const winner = working.find((h) => h.current)
    || working.find((h) => h.host === UNISENDER_ANY)
    || working[0]
    || null;

  let verdict = '';
  let fix = '';
  if (winner && winner.current) {
    verdict = 'Ключ признан тем адресом, куда игра и шлёт письма. Если письма не уходят — причина не в адресе сервиса.';
  } else if (winner) {
    const where = working.filter((h) => h.host !== UNISENDER_ANY).map((h) => h.host).join(', ');
    verdict = (winner.host === UNISENDER_ANY
      ? 'Игра стучится не туда, поэтому сервис отвечает «User with id … not found». '
        + 'Ниже — универсальный адрес: он сам направляет запрос на площадку вашего аккаунта'
        + (where ? ` (у вас это ${where})` : '') + '.'
      : `Ключ принадлежит площадке ${winner.host}, а игра стучится не туда — отсюда «User with id … not found».`);
    fix = `UNISENDER_URL=${winner.host}/ru/transactional/api/v1/email/send.json`;
  } else if (hosts.some((h) => h.recognized === false)) {
    verdict = 'Ключ не признан ни одной площадкой. Дело не в адресе, а в самом ключе: создайте новый в панели Unisender и проверьте, включён ли у него доступ к API.';
  } else {
    verdict = 'Ни одна площадка не ответила понятно — похоже на проблему с сетью сервера, а не с ключом.';
  }

  return {
    ok: !!(winner && winner.current),
    keyMasked: UNISENDER_API_KEY.slice(0, 5) + '…' + UNISENDER_API_KEY.slice(-3),
    keyLength: UNISENDER_API_KEY.length,
    keyDirty: dirty,
    currentUrl: UNISENDER_URL,
    hosts,
    verdict,
    fix,
  };
}

export = { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail, isConfigured, status, sendTest, usingTestSender, EMAIL_FROM, APP_URL, provider, sendMail, UNISENDER_URL, diagnose,};
