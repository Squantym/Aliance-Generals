// ===================================================================
// src/services/email.ts — отправка писем (подтверждение почты, сброс пароля)
//
// Используется HTTP API сервиса resend.com (бесплатный тариф:
// 3000 писем/мес, 100/день). Никаких npm-зависимостей — через fetch().
//
// Переменные окружения:
//   RESEND_API_KEY — ключ API (resend.com → API Keys)
//   EMAIL_FROM     — адрес отправителя, например
//                    "Генералы <noreply@ваш-домен>". Тестовый
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
const UNISENDER_API_KEY = process.env.UNISENDER_API_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

// Unisender Go разводит клиентов по площадкам: у российской и
// европейской разные адреса. По умолчанию российская.
const UNISENDER_URL = process.env.UNISENDER_URL
  || 'https://go1.unisender.ru/ru/transactional/api/v1/email/send.json';

const EMAIL_FROM = process.env.EMAIL_FROM || 'Генералы <onboarding@resend.dev>';
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
  if (m) return { name: m[1].replace(/^["']|["']$/g, '') || 'Генералы', email: m[2] };
  return { name: 'Генералы', email: String(raw || '').trim() };
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
async function sendViaUnisender(to: string, subject: string, html: string):
  Promise<{ sent: boolean; status: number; error: string; id?: string }> {
  const from = splitFrom(EMAIL_FROM);
  try {
    const res = await fetch(UNISENDER_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': UNISENDER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          recipients: [{ email: to }],
          body: { html },
          subject,
          from_email: from.email,
          from_name: from.name,
          // Отписка от служебных писем не нужна и мешает: без неё
          // письмо о подтверждении не превращается в рассылку
          skip_unsubscribe: 1,
        },
      }),
    });
    const bodyText = await res.text().catch(() => '');
    let parsed: any = {};
    try { parsed = JSON.parse(bodyText); } catch (e) {}

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
      <p>Чтобы активировать аккаунт в игре «Генералы», подтвердите свою почту по кнопке ниже:</p>
      <p style="margin: 24px 0;">
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#d9a546;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;">
          Подтвердить почту
        </a>
      </p>
      <p style="color:#666;font-size:13px">Если кнопка не работает, перейдите по ссылке:<br>
        <a href="${link}">${link}</a></p>
      <p style="color:#999;font-size:12px;margin-top:24px">Если вы не регистрировались в игре «Генералы» — просто проигнорируйте это письмо.</p>
    </div>`;
}

function resetHtml(name: string, link: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; color: #222;">
      <h2 style="color:#2e5b1f">Привет, ${escapeHtml(name)}!</h2>
      <p>Вы запросили сброс пароля в игре «Генералы». Нажмите кнопку, чтобы задать новый пароль:</p>
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

// Письмо подтверждения почты. Возвращает { sent, link, status, error }.
async function sendVerificationEmail(toEmail: string, name: string, token: string):
  Promise<{ sent: boolean; link: string; status?: number; error?: string }> {
  const link = `${APP_URL}/#verify/${token}`;
  if (!isConfigured) {
    console.log('📧 [DEV] Почта не настроена (нет RESEND_API_KEY).');
    console.log(`📧 [DEV] Ссылка подтверждения для «${name}» <${toEmail}>: ${link}`);
    return { sent: false, link };
  }
  const r = await sendMail(toEmail, 'Подтверждение почты — Генералы', verifyHtml(name, link));
  if (!r.sent) console.error(`📧 Не удалось отправить подтверждение <${toEmail}>. Ссылка вручную: ${link}`);
  return { sent: r.sent, link, status: r.status, error: r.error };
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
  const r = await sendMail(toEmail, 'Восстановление пароля — Генералы', resetHtml(name, link));
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
    keyMasked: RESEND_API_KEY ? RESEND_API_KEY.slice(0, 5) + '…' + RESEND_API_KEY.slice(-3) : null,
    // Подсказки о вероятной проблеме
    hint: !isConfigured
      ? 'RESEND_API_KEY не задан — письма не отправляются (dev-режим).'
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
  const html = `<div style="font-family:Arial,sans-serif"><h3>Проверка почты «Генералы»</h3>
    <p>Если вы видите это письмо — отправка настроена верно ✅</p></div>`;
  const r = await sendMail(to, 'Проверка почты — Генералы', html);
  return { sent: r.sent, status: r.status, error: r.error, from: EMAIL_FROM, configured: true };
}

export = { sendVerificationEmail, sendPasswordResetEmail, isConfigured, status, sendTest, usingTestSender, EMAIL_FROM, APP_URL, provider, sendMail, UNISENDER_URL,};
