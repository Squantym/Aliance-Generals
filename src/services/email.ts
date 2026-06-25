// ===================================================================
// src/services/email.ts — отправка писем подтверждения почты
//
// Используется HTTP API сервиса resend.com (бесплатный тариф:
// 3000 писем/мес, 100/день). Никаких npm-зависимостей не требуется —
// запрос идёт через встроенный в Node.js fetch().
//
// Переменные окружения:
//   RESEND_API_KEY — ключ API (получить бесплатно на resend.com)
//   EMAIL_FROM     — адрес отправителя, например
//                    "Генералы <onboarding@resend.dev>"
//   APP_URL        — публичный адрес игры (для ссылки в письме),
//                    например "https://generals.example.com"
//
// РЕЖИМ РАЗРАБОТКИ: если RESEND_API_KEY не задан, письмо не
// отправляется. Вместо этого ссылка для подтверждения выводится
// в консоль сервера, а вызывающий код (auth.register) сразу считает
// почту подтверждённой — это нужно, чтобы локальная разработка и
// дымовой тест работали без настройки почты.
// ===================================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Генералы <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Экранирование для вставки имени игрока в HTML-письмо
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]));
}

// true, если настроена реальная отправка почты
const isConfigured = !!RESEND_API_KEY;

// Отправить письмо со ссылкой подтверждения. Возвращает { sent: bool, link }
async function sendVerificationEmail(toEmail: string, name: string, token: string): Promise<{ sent: boolean; link: string }> {
  const link = `${APP_URL}/#verify/${token}`;

  if (!isConfigured) {
    console.log('📧 [DEV] Отправка почты не настроена (нет RESEND_API_KEY).');
    console.log(`📧 [DEV] Ссылка подтверждения для «${name}» <${toEmail}>: ${link}`);
    return { sent: false, link };
  }

  const subject = 'Подтверждение почты — Генералы';
  const html = `
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

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [toEmail], subject, html }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Ошибка отправки письма:', res.status, text);
      return { sent: false, link };
    }
    return { sent: true, link };
  } catch (e: any) {
    console.error('Ошибка отправки письма:', e.message);
    return { sent: false, link };
  }
}

export = { sendVerificationEmail, isConfigured };
