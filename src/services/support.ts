// ===================================================================
// src/services/support.ts — служба поддержки (обращения игроков)
// Игрок создаёт тикет (тема + описание), видит историю с вкладками
// (открытые / закрытые). Администратор отвечает и закрывает тикеты.
// Хранение: коллекция 'support' = { [ticketId]: Ticket }
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
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
  subject: string;
  status: 'open' | 'answered' | 'closed';
  messages: TicketMessage[];
  createdAt: number;
  updatedAt: number;
}

const MAX_SUBJECT = 80;
const MAX_TEXT = 2000;
const MAX_OPEN_PER_USER = 5;   // не больше 5 открытых тикетов одновременно

function store(): Record<string, Ticket> {
  return db.load<Record<string, Ticket>>('support', {});
}

// ── Игрок: создать обращение ──────────────────────────────────────
function createTicket(user: User, subject: string, text: string, notices: Notices) {
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
      subject: t.subject,
      status: t.status,
      messages: t.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      lastFrom: t.messages.length ? t.messages[t.messages.length - 1].from : 'user',
    }));
  return {
    open: mine.filter((t) => t.status !== 'closed'),
    closed: mine.filter((t) => t.status === 'closed'),
  };
}

// ── Админ: список всех тикетов (с фильтром по статусу) ─────────────
function adminList(query: any) {
  const all = store();
  const filter = (query && query.status) || 'open';  // open | answered | closed | all
  let list = Object.values(all);
  if (filter !== 'all') {
    if (filter === 'open') list = list.filter((t) => t.status !== 'closed');
    else list = list.filter((t) => t.status === filter);
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    tickets: list.map((t) => ({
      id: t.id,
      userId: t.userId,
      userName: t.userName,
      subject: t.subject,
      status: t.status,
      messages: t.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    counts: {
      open: Object.values(all).filter((t) => t.status === 'open').length,
      answered: Object.values(all).filter((t) => t.status === 'answered').length,
      closed: Object.values(all).filter((t) => t.status === 'closed').length,
    },
  };
}

// ── Админ: ответить на тикет ──────────────────────────────────────
function adminReply(adminUser: User, ticketId: string, text: string, close: boolean, notices: Notices) {
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

export = { createTicket, replyTicket, myTickets, adminList, adminReply };
