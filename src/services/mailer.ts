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

// Готовое письмо: тема и разметка. Обёртку вокруг текста добавляем здесь,
// чтобы владелец правил только содержание и не следил за вёрсткой.
function render(id: string, vars: Record<string, string>): { subject: string; html: string } {
  const t = tplOf(id);
  const all = { игра: GAME_NAME, сайт: APP_URL, ...vars };
  return {
    subject: fill(t.subject, all),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#222;line-height:1.5">
${fill(t.html, all)}
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
  const h = String(html || '').trim();
  if (!s) throw new u.ApiError('Тема письма не может быть пустой');
  if (!h) throw new u.ApiError('Текст письма не может быть пустым');
  // Ссылка в письмах подтверждения и сброса — единственное, ради чего
  // письмо вообще отправляется. Шаблон без неё бесполезен, и молча
  // сохранять такой нельзя: игроки просто не смогут ни подтвердить
  // почту, ни сменить пароль, а узнаете вы об этом по жалобам.
  if ((id === 'verify' || id === 'reset') && !h.includes('{{ссылка}}')) {
    throw new u.ApiError('В этом письме обязательна подстановка {{ссылка}} — без неё игроку некуда переходить');
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
};
