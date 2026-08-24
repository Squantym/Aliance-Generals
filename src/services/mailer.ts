// ═══════════════════════════════════════════════════════════════════
// src/services/mailer.ts — шаблоны писем и рассылка
//
// Зачем отдельный модуль: раньше текст письма был вшит в код (email.ts),
// и любая правка «Привет, боец» требовала правки исходников, сборки и
// перезапуска сервера. Теперь текст живёт в базе и меняется из панели,
// а код только подставляет значения.
//
// Три шаблона:
//   verify — подтверждение почты при регистрации;
//   reset  — восстановление пароля;
//   news   — новостная рассылка (шлётся вручную из панели).
//
// Подстановки в тексте пишутся фигурными скобками: {{имя}}, {{ссылка}},
// {{игра}}, {{сайт}}. Именно по-русски: шаблон правит владелец игры, а
// не программист, и {{name}} рядом с русским текстом читается хуже.
//
// Что НЕ настраивается из панели: адрес отправителя и ключ сервиса —
// они в переменных окружения. Это граница безопасности: тот, кто получил
// доступ к панели, не должен уметь слать письма от чужого имени.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import email = require('./email');
import type { Notices } from '../types';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const GAME_NAME = 'Генералы';

// ── Заводские шаблоны ──────────────────────────────────────────────
// Они же — то, что уходит игрокам, пока владелец ничего не менял.
// Кнопка «Вернуть заводской» возвращает ровно этот текст.
const DEFAULTS: Record<string, { name: string; subject: string; html: string; vars: string[]; about: string }> = {
  verify: {
    name: 'Подтверждение почты',
    about: 'Уходит сразу после регистрации. Без перехода по ссылке игрок не сможет войти.',
    vars: ['{{имя}}', '{{ссылка}}', '{{игра}}', '{{сайт}}'],
    subject: 'Подтверждение почты — {{игра}}',
    html: `<h2 style="color:#2e5b1f">Привет, {{имя}}!</h2>
<p>Чтобы активировать аккаунт в игре «{{игра}}», подтвердите почту по кнопке ниже:</p>
<p style="margin:24px 0">
  <a href="{{ссылка}}" style="display:inline-block;padding:12px 24px;background:#d9a546;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold">Подтвердить почту</a>
</p>
<p style="color:#666;font-size:13px">Если кнопка не работает, откройте ссылку:<br><a href="{{ссылка}}">{{ссылка}}</a></p>
<p style="color:#999;font-size:12px;margin-top:24px">Если вы не регистрировались — просто не отвечайте на это письмо.</p>`,
  },
  reset: {
    name: 'Восстановление пароля',
    about: 'Уходит по кнопке «Забыли пароль». Ссылка действует ограниченное время.',
    vars: ['{{имя}}', '{{ссылка}}', '{{игра}}', '{{сайт}}'],
    subject: 'Восстановление пароля — {{игра}}',
    html: `<h2 style="color:#2e5b1f">Привет, {{имя}}!</h2>
<p>Вы запросили смену пароля в игре «{{игра}}». Нажмите кнопку, чтобы задать новый:</p>
<p style="margin:24px 0">
  <a href="{{ссылка}}" style="display:inline-block;padding:12px 24px;background:#d9a546;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold">Задать новый пароль</a>
</p>
<p style="color:#666;font-size:13px">Если кнопка не работает, откройте ссылку:<br><a href="{{ссылка}}">{{ссылка}}</a></p>
<p style="color:#999;font-size:12px;margin-top:24px">Если вы не запрашивали смену — просто не отвечайте: пароль останется прежним.</p>`,
  },
  news: {
    name: 'Новостная рассылка',
    about: 'Ничего не отправляет сама по себе — только когда вы нажмёте «Разослать».',
    vars: ['{{имя}}', '{{игра}}', '{{сайт}}'],
    subject: 'Новости игры {{игра}}',
    html: `<h2 style="color:#2e5b1f">Привет, {{имя}}!</h2>
<p>Здесь текст новости. Его можно менять целиком — это обычная разметка письма.</p>
<p style="margin:24px 0">
  <a href="{{сайт}}" style="display:inline-block;padding:12px 24px;background:#d9a546;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold">Играть</a>
</p>`,
  },
};

type Tpl = { subject: string; html: string; changedAt?: number; changedBy?: string };

function store(): Record<string, Tpl> {
  return db.load<Record<string, Tpl>>('mailTemplates', {});
}

// Шаблон с подстановкой заводского, если владелец его не менял
function tplOf(id: string): Tpl {
  const d = DEFAULTS[id];
  if (!d) throw new u.ApiError('Неизвестный шаблон письма');
  const saved = store()[id];
  return {
    subject: (saved && saved.subject) || d.subject,
    html: (saved && saved.html) || d.html,
    changedAt: (saved && saved.changedAt) || 0,
    changedBy: (saved && saved.changedBy) || '',
  };
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]));
}

// ── Чистка разметки письма ─────────────────────────────────────────
// Тексты правит владелец — человек доверенный, так что это не защита от
// него, а защита письма. Причины две:
//
//  1. Визуальный редактор в панели строит разметку сам, и браузеры любят
//     подсовывать своё: <font>, <meta>, style-теги из буфера обмена при
//     вставке текста из Word. Почтовые клиенты такое режут по-своему, и
//     письмо у половины игроков выглядит иначе, чем в панели.
//  2. Если текст письма когда-нибудь начнёт править не только владелец,
//     граница уже будет на месте, а не «добавим потом».
//
// Разрешаем ровно то, что переживает почтовые клиенты.
const ALLOWED_TAGS: Record<string, string[]> = {
  p: ['style'], div: ['style'], span: ['style'], br: [], hr: ['style'],
  b: ['style'], strong: ['style'], i: ['style'], em: ['style'], u: ['style'], s: ['style'],
  h1: ['style'], h2: ['style'], h3: ['style'],
  a: ['href', 'style', 'target', 'rel'],
  ul: ['style'], ol: ['style'], li: ['style'],
  blockquote: ['style'],
  img: ['src', 'alt', 'width', 'height', 'style'],
  table: ['style', 'width', 'cellpadding', 'cellspacing', 'border'],
  thead: ['style'], tbody: ['style'], tr: ['style'], td: ['style'], th: ['style'],
};

// Адрес в ссылке или картинке. Пропускаем http(s), почту и нашу
// подстановку — она стоит прямо в href у кнопки подтверждения.
function safeUrl(raw: string): string | null {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^\{\{[^{}]+\}\}$/.test(v)) return v;
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  return null;
}

function safeStyle(raw: string): string {
  // В письме нет скриптов, но старые почтовые клиенты понимали
  // expression() и url(javascript:) — вырезаем на всякий случай.
  return String(raw || '')
    .replace(/expression\s*\(/gi, '')
    .replace(/url\s*\(\s*['"]?\s*javascript:/gi, 'url(')
    .replace(/["<>]/g, '')
    .trim();
}

function sanitizeHtml(html: string): string {
  let out = String(html || '');
  // Блоки, которые вырезаем вместе с содержимым — их текст в письме не нужен
  out = out.replace(/<(script|style|iframe|object|embed|noscript|form|input|button|svg)\b[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<(script|style|iframe|object|embed|noscript|form|input|button|svg)\b[^>]*\/?>/gi, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  return out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_full, slash, rawName, rawAttrs) => {
    const name = String(rawName).toLowerCase();
    const allowed = ALLOWED_TAGS[name];
    // Незнакомый тег убираем, а текст внутри оставляем: письмо потеряет
    // оформление, но не содержание.
    if (!allowed) return '';
    if (slash) return `</${name}>`;

    const attrs: string[] = [];
    const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(rawAttrs || '')))) {
      const attr = m[1].toLowerCase();
      const val = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5] || '');
      if (!allowed.includes(attr)) continue;      // сюда же уходят все on*=
      if (attr === 'href' || attr === 'src') {
        const url = safeUrl(val);
        if (!url) continue;
        attrs.push(`${attr}="${url.replace(/"/g, '&quot;')}"`);
      } else if (attr === 'style') {
        const st = safeStyle(val);
        if (st) attrs.push(`style="${st}"`);
      } else {
        attrs.push(`${attr}="${escapeHtml(val)}"`);
      }
    }
    return `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  });
}

// Подстановка значений. Имя игрока экранируем: позывной проверяется при
// регистрации, но письмо — не то место, где стоит на это полагаться.
// Ссылку не экранируем: её собирает сервер, и внутри неё есть /#, которое
// экранирование сломает.
function fill(text: string, vars: Record<string, string>): string {
  let out = String(text || '');
  for (const [k, v] of Object.entries(vars)) {
    const safe = k === 'ссылка' ? String(v) : escapeHtml(String(v));
    out = out.split('{{' + k + '}}').join(safe);
  }
  return out;
}

// Что осталось в фигурных скобках после подстановки — то есть опечатка
// или выдуманная подстановка вроде {{Альянс Генералов}}.
function leftovers(text: string): string[] {
  const found = String(text || '').match(/\{\{[^{}]*\}\}/g) || [];
  return Array.from(new Set(found));
}

// Снимаем скобки с того, что подставить не удалось.
//
// Зачем вообще: двойные фигурные скобки — это ЕЩЁ И синтаксис самого
// Unisender. Нераспознанное {{…}} уезжает к нему, он видит свою
// подстановку с кириллицей внутри и отклоняет письмо целиком:
//   Invalid substitution format 'Альянс Генералов'
// То есть опечатка в шаблоне превращалась в наглухо несработавшую
// регистрацию, а причина была написана на языке чужого сервиса.
//
// Текст оставляем, скобки убираем: владелец, написавший
// «Подтверждение почты — {{Альянс Генералов}}», хотел увидеть в теме
// название игры. Он его и увидит, а письмо уйдёт.
function stripUnknownVars(text: string): string {
  return String(text || '').replace(/\{\{([^{}]*)\}\}/g, (_m, inner) => escapeHtml(String(inner).trim()));
}

// Готовое письмо: тема и разметка. Обёртку вокруг текста добавляем здесь,
// чтобы владелец правил только содержание и не следил за вёрсткой.
function render(id: string, vars: Record<string, string>): { subject: string; html: string } {
  const t = tplOf(id);
  const all = { игра: GAME_NAME, сайт: APP_URL, ...vars };
  // stripUnknownVars — последний рубеж: шаблон мог быть сохранён до того,
  // как появилась проверка при сохранении. Лучше отправить письмо с
  // текстом без скобок, чем не отправить совсем.
  return {
    subject: stripUnknownVars(fill(t.subject, all)),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#222;line-height:1.5">
${stripUnknownVars(fill(t.html, all))}
</div>`,
  };
}

// ── Панель: список шаблонов ────────────────────────────────────────
function list() {
  return {
    templates: Object.keys(DEFAULTS).map((id) => {
      const saved = store()[id];
      const t = tplOf(id);
      return {
        id,
        name: DEFAULTS[id].name,
        about: DEFAULTS[id].about,
        vars: DEFAULTS[id].vars,
        subject: t.subject,
        html: t.html,
        isDefault: !saved,
        changedAt: t.changedAt || 0,
        changedBy: t.changedBy || '',
      };
    }),
    mail: email.status(),
  };
}

function save(actorName: string, id: string, subject: string, html: string, notices: Notices) {
  if (!DEFAULTS[id]) throw new u.ApiError('Неизвестный шаблон письма');
  const s = String(subject || '').trim();
  // Чистим ДО проверок: визуальный редактор и вставка из Word тащат
  // мусорные теги, и проверять надо то, что реально ляжет в базу.
  const h = sanitizeHtml(String(html || '')).trim();
  if (!s) throw new u.ApiError('Тема письма не может быть пустой');
  if (!h) throw new u.ApiError('Текст письма не может быть пустым');
  // Ссылка в письмах подтверждения и сброса — единственное, ради чего
  // письмо вообще отправляется. Шаблон без неё бесполезен, и молча
  // сохранять такой нельзя: игроки просто не смогут ни подтвердить
  // почту, ни сменить пароль, а узнаете вы об этом по жалобам.
  if ((id === 'verify' || id === 'reset') && !h.includes('{{ссылка}}')) {
    throw new u.ApiError('В этом письме обязательна подстановка {{ссылка}} — без неё игроку некуда переходить');
  }
  // Выдуманная подстановка вроде {{Альянс Генералов}} — самая обидная
  // ошибка: сохранилась бы молча, а письмо отклонил бы уже почтовый
  // сервис, ответив про «invalid substitution format» — на своём языке
  // и про свои правила. Ловим здесь, пока владелец смотрит на поле.
  const bad = leftovers(fill(s + ' ' + h, {
    имя: '', ссылка: '', игра: '', сайт: '',
  }));
  if (bad.length) {
    throw new u.ApiError(
      `Неизвестная подстановка: ${bad.join(', ')}. `
      + `Доступны только ${DEFAULTS[id].vars.join(', ')} — остальное пишите обычным текстом, без фигурных скобок.`);
  }
  const all = store();
  all[id] = { subject: s, html: h, changedAt: Date.now(), changedBy: String(actorName || '') };
  db.save('mailTemplates');
  notices.push(`✉️ Шаблон «${DEFAULTS[id].name}» сохранён.`);
  return { ok: true, id };
}

function resetToDefault(id: string, notices: Notices) {
  if (!DEFAULTS[id]) throw new u.ApiError('Неизвестный шаблон письма');
  const all = store();
  delete all[id];
  db.save('mailTemplates');
  notices.push(`↩️ Шаблон «${DEFAULTS[id].name}» возвращён к заводскому.`);
  return { ok: true, id };
}

// Пробное письмо себе — единственный честный способ увидеть, как шаблон
// выглядит в почте. Предпросмотр в браузере врёт: почтовые клиенты режут
// разметку по-своему.
async function sendPreview(id: string, to: string, playerName: string) {
  if (!DEFAULTS[id]) throw new u.ApiError('Неизвестный шаблон письма');
  const addr = String(to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new u.ApiError('Укажите адрес, куда отправить образец');
  const r = render(id, { имя: playerName || 'Генерал', ссылка: `${APP_URL}/#пример-ссылки` });
  const res = await email.sendMail(addr, '[образец] ' + r.subject, r.html);
  if (!res.sent) throw new u.ApiError('Письмо не ушло: ' + (res.error || 'причина неизвестна'));
  return { ok: true, to: addr };
}

// ═══ РАССЫЛКА ══════════════════════════════════════════════════════
// Идёт в фоне: 2000 писем в одном запросе — это несколько минут, за
// которые панель отвалится по таймауту, а половина адресов останется
// без письма и никто не узнает какая.
//
// Состояние храним в базе: перезапуск сервера посреди рассылки не должен
// оставлять после себя загадку «дошло или нет».
type Job = {
  startedAt: number; finishedAt: number;
  subject: string;
  total: number; sent: number; failed: number;
  queue: Array<{ id: string; email: string; name: string }>;
  errors: Array<{ email: string; error: string }>;
  by: string;
  stopped?: boolean;
};

function job(): Job | null {
  const s = db.load<any>('broadcast', {});
  return s && s.startedAt ? s as Job : null;
}

const SEND_GAP_MS = 400;   // пауза между письмами: бесплатные тарифы не любят залпы

function tickSend(): void {
  const j = job();
  if (!j || j.finishedAt || j.stopped) return;
  const next = j.queue.shift();
  if (!next) {
    j.finishedAt = Date.now();
    db.save('broadcast');
    console.log(`✉️  Рассылка закончена: отправлено ${j.sent}, не дошло ${j.failed}`);
    return;
  }
  const r = render('news', { имя: next.name });
  email.sendMail(next.email, r.subject, r.html)
    .then((res: any) => {
      const cur = job();
      if (!cur) return;
      if (res.sent) cur.sent++;
      else {
        cur.failed++;
        if (cur.errors.length < 50) cur.errors.push({ email: next.email, error: res.error || 'ошибка' });
      }
      db.save('broadcast');
    })
    .catch(() => {
      const cur = job();
      if (cur) { cur.failed++; db.save('broadcast'); }
    })
    .finally(() => {
      const t = setTimeout(tickSend, SEND_GAP_MS);
      if (t.unref) t.unref();
    });
}

function broadcastStatus() {
  const j = job();
  if (!j) return { running: false, last: null };
  return {
    running: !j.finishedAt && !j.stopped,
    last: {
      startedAt: j.startedAt, finishedAt: j.finishedAt,
      subject: j.subject, total: j.total, sent: j.sent, failed: j.failed,
      left: j.queue.length, by: j.by, stopped: !!j.stopped,
      errors: j.errors.slice(0, 20),
    },
  };
}

// Кому уйдёт рассылка. Только подтверждённая почта: неподтверждённый
// адрес — это чаще всего опечатка, и письма на него бьют по репутации
// отправителя, из-за которой потом в спам уходят ВСЕ письма, включая
// подтверждения регистрации.
function recipients(allUsers: Record<string, any>) {
  return Object.values(allUsers)
    .filter((p: any) => p && !p.isBot && p.emailVerified && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email || '')))
    .map((p: any) => ({ id: p.id, email: String(p.email), name: String(p.name || 'Генерал') }));
}

function broadcastStart(actorName: string, allUsers: Record<string, any>, notices: Notices) {
  if (!email.isConfigured) throw new u.ApiError('Почта не настроена — отправлять нечем');
  const cur = job();
  if (cur && !cur.finishedAt && !cur.stopped) throw new u.ApiError('Рассылка уже идёт — дождитесь конца или остановите её');

  const list = recipients(allUsers);
  if (!list.length) throw new u.ApiError('Некому отправлять: нет игроков с подтверждённой почтой');

  const r = render('news', { имя: 'Генерал' });
  const s: any = db.load<any>('broadcast', {});
  s.startedAt = Date.now();
  s.finishedAt = 0;
  s.stopped = false;
  s.subject = r.subject;
  s.total = list.length;
  s.sent = 0; s.failed = 0;
  s.errors = [];
  s.queue = list;
  s.by = String(actorName || '');
  db.save('broadcast');

  const t = setTimeout(tickSend, 10);
  if (t.unref) t.unref();

  notices.push(`✉️ Рассылка запущена: получателей ${list.length}. Идёт в фоне, панель можно закрыть.`);
  return { total: list.length };
}

function broadcastStop(notices: Notices) {
  const j = job();
  if (!j || j.finishedAt) throw new u.ApiError('Рассылка не идёт');
  j.stopped = true;
  j.finishedAt = Date.now();
  const left = j.queue.length;
  j.queue = [];
  db.save('broadcast');
  notices.push(`⏹ Рассылка остановлена. Не отправлено: ${left}.`);
  return { stopped: true, left };
}

// Сколько получателей — нужно ДО запуска, чтобы владелец видел, во что
// обойдётся рассылка по лимитам почтового сервиса.
function audience(allUsers: Record<string, any>) {
  const all = Object.values(allUsers).filter((p: any) => p && !p.isBot);
  const list = recipients(allUsers);
  return {
    ready: list.length,
    total: all.length,
    unverified: all.filter((p: any) => !p.emailVerified).length,
    noEmail: all.filter((p: any) => !String(p.email || '').trim()).length,
  };
}

export = {
  DEFAULTS, render, list, save, resetToDefault, sendPreview,
  broadcastStart, broadcastStop, broadcastStatus, audience, recipients,
  leftovers, stripUnknownVars, sanitizeHtml,
};
