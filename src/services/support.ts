// ===================================================================
// src/services/support.ts — служба поддержки (обращения игроков)
// Игрок создаёт тикет (тема + описание), видит историю с вкладками
// (открытые / закрытые). Администратор отвечает и закрывает тикеты.
// Хранение: коллекция 'support' = { [ticketId]: Ticket }
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

interface TicketMessage {
  from: 'user' | 'admin';
  authorName: string;
  text: string;
  at: number;
}
interface Ticket {
  id: string;
  userId: string;
  userName: string;
  category: string;   // тема обращения (id из CATEGORIES)
  subject: string;
  status: 'open' | 'answered' | 'closed';
  messages: TicketMessage[];
  createdAt: number;
  updatedAt: number;
}

// Темы обращений. Единый источник — используется и на бэке (валидация,
// фильтр в админке), и на фронте (выпадающий список, подразделы админки).
const CATEGORIES = [
  { id: 'suggestion', label: 'Предложения по игре', icon: '💡' },
  { id: 'complaint',  label: 'Жалобы',              icon: '⚠️' },
  { id: 'bug',        label: 'Ошибки или баги',     icon: '🐞' },
  { id: 'help',       label: 'Помощь',              icon: '❓' },
  { id: 'cheater',    label: 'Читеры / нарушители', icon: '🚫' },
  { id: 'other',      label: 'Другое',              icon: '💬' },
];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
function normCategory(cat: any): string {
  const c = String(cat || '').trim();
  return CATEGORY_IDS.includes(c) ? c : 'other';
}

const MAX_SUBJECT = 80;
const MAX_TEXT = 2000;
const MAX_OPEN_PER_USER = 5;   // не больше 5 открытых тикетов одновременно

function store(): Record<string, Ticket> {
  return db.load<Record<string, Ticket>>('support', {});
}

// ── Игрок: создать обращение ──────────────────────────────────────
function createTicket(user: User, category: string, subject: string, text: string, notices: Notices) {
  const cat = normCategory(category);
  const subj = String(subject || '').trim().slice(0, MAX_SUBJECT);
  const body = String(text || '').trim().slice(0, MAX_TEXT);
  if (!subj) throw new u.ApiError('Укажите тему обращения');
  if (body.length < 5) throw new u.ApiError('Опишите проблему подробнее (минимум 5 символов)');

  const all = store();
  const openCount = Object.values(all).filter(
    (t) => t.userId === user.id && t.status !== 'closed'
  ).length;
  if (openCount >= MAX_OPEN_PER_USER) {
    throw new u.ApiError(`У вас уже ${MAX_OPEN_PER_USER} открытых обращений. Дождитесь ответа.`);
  }

  const now = Date.now();
  const ticket: Ticket = {
    id: u.uid(12),
    userId: user.id,
    userName: user.name,
    category: cat,
    subject: subj,
    status: 'open',
    messages: [{ from: 'user', authorName: user.name, text: body, at: now }],
    createdAt: now,
    updatedAt: now,
  };
  all[ticket.id] = ticket;
  db.save('support');
  notices.push('✅ Обращение отправлено. Ответ придёт в этом же разделе.');
  return { id: ticket.id };
}

// ── Игрок: добавить сообщение в свой тикет ────────────────────────
function replyTicket(user: User, ticketId: string, text: string, notices: Notices) {
  const all = store();
  const t = all[ticketId];
  if (!t || t.userId !== user.id) throw new u.ApiError('Обращение не найдено');
  if (t.status === 'closed') throw new u.ApiError('Это обращение закрыто. Создайте новое.');
  const body = String(text || '').trim().slice(0, MAX_TEXT);
  if (body.length < 1) throw new u.ApiError('Введите сообщение');
  t.messages.push({ from: 'user', authorName: user.name, text: body, at: Date.now() });
  t.status = 'open';   // снова ждёт ответа админа
  t.updatedAt = Date.now();
  db.save('support');
  notices.push('✅ Сообщение добавлено в обращение.');
  return { ok: true };
}

// ── Игрок: список своих тикетов (для вкладок open/closed) ─────────
function myTickets(user: User) {
  const all = store();
  const mine = Object.values(all)
    .filter((t) => t.userId === user.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((t) => ({
      id: t.id,
      category: t.category || 'other',
      categoryLabel: CATEGORY_LABEL[t.category || 'other'] || 'Другое',
      subject: t.subject,
      status: t.status,
      messages: t.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      lastFrom: t.messages.length ? t.messages[t.messages.length - 1].from : 'user',
    }));
  return {
    categories: CATEGORIES,
    open: mine.filter((t) => t.status !== 'closed'),
    closed: mine.filter((t) => t.status === 'closed'),
  };
}

// ── Админ: список всех тикетов (с фильтром по статусу) ─────────────
// Заявку берёт в работу один сотрудник — и дальше она принадлежит ему.
// Так двое не отвечают одному человеку одновременно и не читают чужую
// переписку: обращения нередко содержат личные обстоятельства.
// Владелец видит все заявки всегда — это его проект.
function canSeeTicket(t: any, viewer: any): boolean {
  const rolesSrv = require('./roles');
  if (rolesSrv.isOwner(viewer)) return true;          // владельцу видно всё
  if (!t.assignedTo) return true;                     // свободную видят все
  return t.assignedTo === viewer.id;                  // взятую — только тот, кто взял
}

function claim(actor: User, ticketId: string, notices: Notices) {
  const rolesSrv = require('./roles');
  if (!rolesSrv.canAccessZone(actor, 'support')) throw new u.ApiError('Недостаточно прав');
  const all = store();
  const t = all[ticketId];
  if (!t) throw new u.ApiError('Обращение не найдено');
  if ((t as any).assignedTo && (t as any).assignedTo !== actor.id) {
    throw new u.ApiError(`Обращение уже взял в работу: ${(t as any).assignedName || 'другой сотрудник'}`);
  }
  if ((t as any).assignedTo === actor.id) throw new u.ApiError('Обращение уже у вас в работе');
  (t as any).assignedTo = actor.id;
  (t as any).assignedName = actor.name;
  (t as any).assignedAt = Date.now();
  db.save('support');
  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/admin/support/claim',
    body: { ticketId, subject: t.subject },
  });
  notices.push(`📌 Обращение «${t.subject}» взято в работу`);
  return { ok: true, ticketId, assignedName: actor.name };
}

// Вернуть заявку в общую очередь. Свою может вернуть сам сотрудник,
// чужую — только владелец (например, если человек ушёл в отпуск).
function release(actor: User, ticketId: string, notices: Notices) {
  const rolesSrv = require('./roles');
  if (!rolesSrv.canAccessZone(actor, 'support')) throw new u.ApiError('Недостаточно прав');
  const all = store();
  const t = all[ticketId];
  if (!t) throw new u.ApiError('Обращение не найдено');
  if (!(t as any).assignedTo) throw new u.ApiError('Обращение и так свободно');
  if ((t as any).assignedTo !== actor.id && !rolesSrv.isOwner(actor)) {
    throw new u.ApiError('Вернуть в очередь чужое обращение может только владелец');
  }
  const was = (t as any).assignedName || '';
  (t as any).assignedTo = null;
  (t as any).assignedName = '';
  db.save('support');
  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/admin/support/release',
    body: { ticketId, subject: t.subject, was },
  });
  notices.push(`↩️ Обращение «${t.subject}» возвращено в общую очередь`);
  return { ok: true, ticketId };
}

function adminList(query: any, viewer?: any) {
  const all = store();
  const statusFilter = (query && query.status) || 'open';    // open | answered | closed | all
  const catFilter = (query && query.category) || 'all';      // all | <id темы>
  let list = Object.values(all);
  // Скрываем чужие взятые обращения. Владелец видит всё.
  if (viewer) list = list.filter((t) => canSeeTicket(t, viewer));
  if (statusFilter !== 'all') {
    if (statusFilter === 'open') list = list.filter((t) => t.status !== 'closed');
    else list = list.filter((t) => t.status === statusFilter);
  }
  if (catFilter !== 'all') list = list.filter((t) => (t.category || 'other') === catFilter);
  list.sort((a, b) => b.updatedAt - a.updatedAt);

  // Счётчики открытых обращений по каждой теме — для подразделов админки
  const byCategory: Record<string, number> = {};
  for (const c of CATEGORY_IDS) byCategory[c] = 0;
  for (const t of Object.values(all)) {
    if (t.status !== 'closed') byCategory[t.category || 'other'] = (byCategory[t.category || 'other'] || 0) + 1;
  }

  // Помечаем, кто взял и своё ли это обращение
  const viewerId = viewer ? viewer.id : null;
  list = list.map((t: any) => ({
    ...t,
    assignedTo: t.assignedTo || null,
    assignedName: t.assignedName || '',
    mine: !!(viewerId && t.assignedTo === viewerId),
    free: !t.assignedTo,
  })) as any;

  return {
    categories: CATEGORIES,
    tickets: list.map((t) => ({
      id: t.id,
      userId: t.userId,
      userName: t.userName,
      category: t.category || 'other',
      categoryLabel: CATEGORY_LABEL[t.category || 'other'] || 'Другое',
      subject: t.subject,
      status: t.status,
      messages: t.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      // Кто взял обращение в работу — от этого зависит, кто его увидит
      assignedTo: (t as any).assignedTo || null,
      assignedName: (t as any).assignedName || '',
      mine: !!(viewer && (t as any).assignedTo === viewer.id),
      free: !(t as any).assignedTo,
    })),
    counts: {
      open: Object.values(all).filter((t) => t.status === 'open').length,
      answered: Object.values(all).filter((t) => t.status === 'answered').length,
      closed: Object.values(all).filter((t) => t.status === 'closed').length,
    },
    byCategory,
  };
}

// ── Админ: ответить на тикет ──────────────────────────────────────
function adminReply(adminUser: User, ticketId: string, text: string, close: boolean, notices: Notices) {
  // Отвечать может тот, за кем закреплено обращение. Свободное обращение
  // закрепляется автоматически при первом ответе — чтобы сотруднику не
  // приходилось нажимать «взять» отдельно.
  {
    const rolesSrv = require('./roles');
    const tt: any = store()[ticketId];
    if (tt) {
      if (tt.assignedTo && tt.assignedTo !== adminUser.id && !rolesSrv.isOwner(adminUser)) {
        throw new u.ApiError(`Обращение в работе у сотрудника: ${tt.assignedName || 'другой'}`);
      }
      if (!tt.assignedTo) {
        tt.assignedTo = adminUser.id;
        tt.assignedName = adminUser.name;
        tt.assignedAt = Date.now();
      }
    }
  }
  const all = store();
  const t = all[ticketId];
  if (!t) throw new u.ApiError('Обращение не найдено');
  const body = String(text || '').trim().slice(0, MAX_TEXT);
  if (body.length < 1 && !close) throw new u.ApiError('Введите ответ');
  if (body.length >= 1) {
    t.messages.push({ from: 'admin', authorName: adminUser.name || 'Поддержка', text: body, at: Date.now() });
  }
  t.status = close ? 'closed' : 'answered';
  t.updatedAt = Date.now();
  db.save('support');
  // Уведомляем игрока
  try {
    require('./notifications').push(t.userId, 'support_reply',
      `💬 Ответ службы поддержки по обращению «${t.subject}»`,
      { ticketId: t.id, closed: close });
  } catch (e) {}
  notices.push(close ? '✅ Ответ отправлен, обращение закрыто.' : '✅ Ответ отправлен игроку.');
  return { ok: true };
}

export = { createTicket, replyTicket, myTickets, adminList, adminReply, CATEGORIES, claim, release, canSeeTicket,};
