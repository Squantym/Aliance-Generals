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

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Генералы <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// true, если настроена реальная отправка почты
const isConfigured = !!RESEND_API_KEY;
// Признак «тестового» отправителя resend.dev — шлёт только владельцу аккаунта
const usingTestSender = /resend\.dev/i.test(EMAIL_FROM);

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]));
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
  const r = await sendViaResend(toEmail, 'Подтверждение почты — Генералы', verifyHtml(name, link));
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
  const r = await sendViaResend(toEmail, 'Восстановление пароля — Генералы', resetHtml(name, link));
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
  const r = await sendViaResend(to, 'Проверка почты — Генералы', html);
  return { sent: r.sent, status: r.status, error: r.error, from: EMAIL_FROM, configured: true };
}

export = { sendVerificationEmail, sendPasswordResetEmail, isConfigured, status, sendTest };
