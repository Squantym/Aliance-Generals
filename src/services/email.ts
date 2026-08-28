// ===================================================================
// src/services/email.ts — отправка писем игрокам
//
// Сервис российский, и это принципиально: письма с зарубежных серверов
// mail.ru и Яндекс кладут в спам заметно охотнее, а почта у нашей
// аудитории в основном там. Игрок не получил бы код, не смог бы войти и
// ушёл бы — причём молча, ни на что не пожаловавшись.
//
//   SMTP.BZ — единственный сервис отправки. Бесплатный тариф бессрочный.
//
// Отправка устроена ЦЕПОЧКОЙ, хотя сервис сейчас один: не развилка
// if/else, а список. Понадобится запасной — он добавляется одной
// строкой в CHAIN и одной функцией sendViaXxx, без переделки вызовов.
// Пока сервис один, он же и точка отказа: кончится тариф или случится
// сбой — регистрация встанет целиком. Панель об этом честно говорит.
//
// Никаких npm-зависимостей — обычный fetch().
//
// Переменные окружения:
//   SMTPBZ_API_KEY — ключ SMTP.BZ
//   EMAIL_FROM     — отправитель: "Aliance Generals <noreply@домен>"
//   APP_URL        — публичный адрес игры (для ссылок в письмах)
//
// РЕЖИМ РАЗРАБОТКИ: если ключа нет, письма не отправляются, код и
// ссылка выводятся в консоль, а почта считается подтверждённой — иначе
// на локальной машине нельзя было бы зарегистрироваться вообще.
// ===================================================================
import brand = require('../core/brand');
import quota = require('./mailQuota');
import maildns = require('./maildns');

const SMTPBZ_API_KEY = process.env.SMTPBZ_API_KEY || '';
const SMTPBZ_URL = process.env.SMTPBZ_URL || 'https://api.smtp.bz/v1/smtp/send';

const EMAIL_FROM = process.env.EMAIL_FROM || `${brand.GAME_NAME_EN} <noreply@localhost>`;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Порядок отправки: сначала основной, при отказе — следующий.
// Пустой список означает режим разработки.
type ProviderId = 'smtpbz';
const CHAIN: ProviderId[] = [
  ...(SMTPBZ_API_KEY ? ['smtpbz' as ProviderId] : []),
];
const PROVIDER_NAMES: Record<string, string> = {
  smtpbz: 'SMTP.BZ',
  none: 'не настроен',
};

const provider: ProviderId | 'none' = CHAIN[0] || 'none';
const isConfigured = CHAIN.length > 0;
// Отправитель без своего домена: письма игрокам с такого адреса не дойдут
const usingTestSender = /@localhost|@example\./i.test(EMAIL_FROM);

// Разбираем «Имя <адрес>» — сервис требует имя и адрес отдельными полями
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

// ── Отправка через SMTP.BZ ─────────────────────────────────────────
// Их API принимает обычную форму, а ключ — заголовком Authorization.
// Тело письма и адрес получателя передаются полями формы, а не JSON.
//
// Ответ разбираем осторожно: у таких сервисов «200 OK» с телом
// {"success":false} — обычное дело, и принять это за успех означает
// потерять письмо молча. Поэтому успехом считаем только явное
// подтверждение, а всё остальное — отказ с текстом от сервиса.
async function sendViaSmtpBz(to: string, subject: string, html: string):
  Promise<{ sent: boolean; status: number; error: string; id?: string }> {
  const from = splitFrom(EMAIL_FROM);
  try {
    const form = new URLSearchParams();
    form.set('name', from.name);
    form.set('from', from.email);
    form.set('subject', subject);
    form.set('to', to);
    form.set('html', html);
    // Текстовая версия: почтовые клиенты без разметки покажут её, а
    // спам-фильтры письмо без текстовой части любят меньше.
    form.set('text', html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000));

    const res = await fetch(SMTPBZ_URL, {
      method: 'POST',
      headers: {
        Authorization: SMTPBZ_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const bodyText = await res.text().catch(() => '');
    let parsed: any = {};
    try { parsed = JSON.parse(bodyText); } catch (e) {}

    if (!res.ok) {
      const reason = parsed.message || parsed.error || bodyText || `HTTP ${res.status}`;
      console.error(`📧 SMTP.BZ отклонил письмо для <${to}>: HTTP ${res.status} — ${reason}`);
      return { sent: false, status: res.status, error: String(reason).slice(0, 300) };
    }
    // Явный отказ при 200 — так тоже бывает
    if (parsed && (parsed.success === false || parsed.status === 'error')) {
      const reason = parsed.message || parsed.error || bodyText;
      console.error(`📧 SMTP.BZ не принял письмо для <${to}>: ${reason}`);
      return { sent: false, status: res.status, error: String(reason).slice(0, 300) };
    }
    const id = parsed && (parsed.id || parsed.message_id || parsed.result) || undefined;
    return { sent: true, status: res.status, error: '', id: id ? String(id) : undefined };
  } catch (e: any) {
    console.error('📧 Сетевая ошибка отправки письма (SMTP.BZ):', e.message);
    return { sent: false, status: 0, error: e.message || 'network error' };
  }
}

// Кто чем отправляет. Таблица, а не развилка: добавится второй сервис —
// здесь появится одна строка, а sendMail не изменится вовсе.
type SendFn = (to: string, subject: string, html: string) =>
  Promise<{ sent: boolean; status: number; error: string; id?: string }>;
const SENDERS: Record<ProviderId, SendFn> = {
  smtpbz: sendViaSmtpBz,
};

// Единая точка отправки. Здесь три вещи, и все три обязаны быть именно
// здесь, а не у каждого вызова по отдельности:
//
//  1. ЛИМИТ. Бесплатный тариф — жёсткий потолок. Упереться в него
//     молча значит сломать регистрацию: игрок не получит код и не
//     поймёт, почему. Считаем сами и останавливаемся заранее.
//  2. ПЕРЕКЛЮЧЕНИЕ. Отказал сервис — пробуем следующий в цепочке, а не
//     хороним письмо. Сейчас сервис один, но порядок вызова уже готов.
//  3. УЧЁТ. Засчитываем только УШЕДШЕЕ письмо, и знаем, кто отправил.
//
// kind — вид письма: verify / reset / welcome / news / test. От него
// зависит, тратить ли неприкосновенный запас: рассылка не имеет права
// съесть остаток, нужный подтверждениям почты.
async function sendMail(to: string, subject: string, html: string, kind = 'test'):
  Promise<{ sent: boolean; status: number; error: string; id?: string; via?: string }> {
  if (!CHAIN.length) return { sent: false, status: 0, error: 'Отправка писем не настроена' };

  const allowed = quota.check(kind);
  if (!allowed.ok) {
    console.warn(`📧 Письмо «${kind}» не отправлено: ${allowed.reason}`);
    return { sent: false, status: 0, error: allowed.reason };
  }

  const errors: string[] = [];
  for (const p of CHAIN) {
    const r = await SENDERS[p](to, subject, html);
    if (r.sent) {
      quota.count(kind);
      if (p !== CHAIN[0]) {
        console.warn(`📧 Основной сервис отказал, письмо ушло через запасной (${PROVIDER_NAMES[p]}).`);
      }
      return { ...r, via: p };
    }
    errors.push(`${PROVIDER_NAMES[p]}: ${r.error}`);
  }
  // Не ушло нигде — отдаём ВСЕ причины: по одной непонятно, общая это
  // беда (домен, лимит) или сбой одного сервиса.
  return { sent: false, status: 0, error: errors.join(' | ').slice(0, 400) };
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
  const r = await sendMail(toEmail, t.subject, t.html, 'verify');
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
    const r = await sendMail(toEmail, t.subject, t.html, 'welcome');
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
    console.log('📧 [DEV] Почта не настроена — письмо не отправлено.');
    console.log(`📧 [DEV] Ссылка сброса пароля для «${name}» <${toEmail}>: ${link}`);
    return { sent: false, link };
  }
  const t = tpl('reset', name, link);
  const r = await sendMail(toEmail, t.subject, t.html, 'reset');
  if (!r.sent) console.error(`📧 Не удалось отправить сброс пароля <${toEmail}>. Ссылка вручную: ${link}`);
  return { sent: r.sent, link, status: r.status, error: r.error };
}

// ── Диагностика (для админки) ──────────────────────────────────────
// Текущее состояние почты — без раскрытия самих ключей.
function status() {
  return {
    configured: isConfigured,
    from: EMAIL_FROM,
    appUrl: APP_URL,
    usingTestSender,
    provider,
    providerName: PROVIDER_NAMES[provider] || provider,
    // Вся цепочка, а не только основной: владелец должен видеть, есть ли
    // вообще запасной вариант, — от этого зависит, чинить ли сегодня.
    chain: CHAIN.map((p) => ({ id: p, name: PROVIDER_NAMES[p] })),
    hasBackup: CHAIN.length > 1,
    keyMasked: SMTPBZ_API_KEY ? SMTPBZ_API_KEY.slice(0, 5) + '…' + SMTPBZ_API_KEY.slice(-3) : null,
    quota: quota.view(),
    hint: !isConfigured
      ? 'Ключ почтового сервиса не задан: SMTPBZ_API_KEY. Письма не отправляются, '
        + 'у новых игроков почта подтверждается сама — иначе они не смогли бы войти.'
      : (usingTestSender
        ? 'В EMAIL_FROM не ваш домен — письма игрокам не дойдут. Укажите адрес на подтверждённом домене.'
        // Сервис один — он же единственная точка отказа. Молчать об этом
        // нельзя: владелец должен узнать заранее, а не в день, когда
        // новые игроки перестанут получать коды.
        : 'Сервис отправки один. Кончится тариф или случится сбой — письма '
          + 'перестанут уходить совсем, и регистрация встанет.'),
  };
}

// Тестовая отправка на указанный адрес — возвращает реальный ответ сервиса
async function sendTest(toEmail: string):
  Promise<{ sent: boolean; status: number; error: string; from: string; configured: boolean; via?: string }> {
  const to = String(toEmail || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { sent: false, status: 0, error: 'Некорректный email', from: EMAIL_FROM, configured: isConfigured };
  }
  if (!isConfigured) {
    return { sent: false, status: 0, error: 'Ключ почтового сервиса не задан (режим разработки)', from: EMAIL_FROM, configured: false };
  }
  const html = `<div style="font-family:Arial,sans-serif"><h3>Проверка почты «${brand.GAME_NAME}»</h3>
    <p>Если вы видите это письмо — отправка настроена верно ✅</p></div>`;
  const r = await sendMail(to, `Проверка почты — ${brand.GAME_NAME}`, html, 'test');
  // via — какой сервис сработал. Нужен и в панели: при отказе
  // основного владелец должен видеть, что письмо спас запасной.
  return { sent: r.sent, status: r.status, error: r.error, from: EMAIL_FROM, configured: true, via: r.via };
}

// ── Диагностика домена ─────────────────────────────────────────────
// Что здесь проверяется и почему именно это. Когда письма «не доходят»,
// у владельца три подозреваемых: ключ, сервис и домен. Ключ и сервис
// отвечают сами — их ответ виден дословно при тестовой отправке. А вот
// домен молчит: записи не прописаны, сервис письмо принял, почтовик
// получателя выбросил — и никто ничего не сказал. Поэтому проверяем
// именно записи домена.
//
// Ничего не отправляется: лимит писем эта проверка не тратит.
async function diagnose(): Promise<any> {
  const from = splitFrom(EMAIL_FROM);
  const domain = (from.email.split('@')[1] || '').toLowerCase();

  if (!isConfigured) {
    return { ok: false, skipped: true, domain, checks: [], spfFix: '',
      verdict: 'Ключ SMTPBZ_API_KEY не задан — отправка выключена, проверять нечего.' };
  }
  if (usingTestSender || !domain) {
    return { ok: false, skipped: true, domain, checks: [], spfFix: '',
      verdict: 'В EMAIL_FROM не ваш домен, а служебный адрес. Укажите адрес на '
        + 'своём домене — иначе письма игрокам не дойдут ни при каких записях.' };
  }

  // Мусор в ключе виден до всякой сети: лишний пробел или кавычка ломают
  // заголовок, а глазом в редакторе это не заметно.
  const keyDirty = /\s|["']/.test(SMTPBZ_API_KEY);

  const rep = await maildns.checkDomain(domain);
  return {
    ok: rep.ok,
    skipped: false,
    domain,
    from: EMAIL_FROM,
    keyMasked: SMTPBZ_API_KEY.slice(0, 5) + '…' + SMTPBZ_API_KEY.slice(-3),
    keyLength: SMTPBZ_API_KEY.length,
    keyDirty,
    ns: rep.ns,
    panel: rep.panel,
    checks: rep.checks,
    spfFix: rep.spfFix,
    verdict: (keyDirty ? 'В ключе есть пробел или кавычка — уберите их в .env. ' : '') + rep.verdict,
  };
}

export = { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail, isConfigured, status, sendTest, usingTestSender, EMAIL_FROM, APP_URL, provider, PROVIDER_NAMES, CHAIN, sendMail, SMTPBZ_URL, diagnose, quota,};
