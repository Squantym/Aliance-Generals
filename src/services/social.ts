// ===================================================================
// src/services/social.ts — общий чат, почта (личные сообщения), зал славы
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import type { User, Notices } from '../types';

function world(): any {
  const w = db.load('world', { chat: [], auctions: [], seq: 1 });
  if (!w.chat) w.chat = [];
  if (!w.auctions) w.auctions = [];
  if (!w.seq) w.seq = 1;
  return w;
}

function mailboxOf(userId: string): any[] {
  const boxes = db.load('mail', {});
  if (!boxes[userId]) boxes[userId] = [];
  return boxes[userId];
}

// ---------- ЧАТ ----------
function chatGet(afterId?: number | string) {
  const after = u.toInt(afterId, 0);
  return { messages: world().chat.filter((m) => m.id > after) };
}

function chatPost(user: User, text: string) {
  text = String(text || '').trim().slice(0, config.CHAT.MAX_LEN);
  if (!text) throw new u.ApiError('Пустое сообщение');
  const now = Date.now();
  // Простейшая защита от спама: не чаще одного сообщения в 3 секунды
  if (user.lastChatAt && now - user.lastChatAt < config.CHAT.RATE_MS) {
    throw new u.ApiError('Не так быстро, боец! Подожди пару секунд.');
  }
  user.lastChatAt = now;
  const w = world();
  w.chat.push({ id: w.seq++, uid: user.id, name: user.name, flag: player.flag(user), level: user.level, text, at: now });
  // Храним только последние N сообщений
  if (w.chat.length > config.CHAT.KEEP) w.chat.splice(0, w.chat.length - config.CHAT.KEEP);
}

// ---------- ПОЧТА (только письма между игроками, треды по собеседнику) ----------
// Каждое письмо кладётся ОБЕИМ сторонам: получателю (dir:'in') и
// отправителю (dir:'out', уже прочитано — сам же написал). Это даёт
// полноценную историю переписки с каждым конкретным игроком.
// Системные события (приглашения, ачивки, аукцион и т.п.) сюда больше
// НЕ попадают — для них есть notifications.ts (колокольчик).
function pushMailEntry(userId: string, entry: any): void {
  const box = mailboxOf(userId);
  box.push(entry);
  if (box.length > config.MAIL.KEEP) box.splice(0, box.length - config.MAIL.KEEP);
}

// Письмо ТОЛЬКО от реального игрока — сохраняем копию и отправителю
// (dir:'out'), чтобы у обоих была полная история переписки.
function mailBetween(fromUser: User, toUser: User, subject: string, text: string): void {
  const at = Date.now();
  const s = String(subject || '(без темы)').slice(0, 80);
  const t = String(text || '').slice(0, config.MAIL.MAX_LEN);
  pushMailEntry(toUser.id, { id: u.uid(10), dir: 'in', otherId: fromUser.id, otherName: fromUser.name, subject: s, text: t, at, read: false });
  pushMailEntry(fromUser.id, { id: u.uid(10), dir: 'out', otherId: toUser.id, otherName: toUser.name, subject: s, text: t, at, read: true });
  db.save('mail');
}

// Непрочитанные — только входящие письма от РЕАЛЬНЫХ игроков (otherId
// задан). Старые системные записи (otherId=null, до перехода на
// notifications.ts) в счётчик и в список ниже не попадают.
function unread(user: User): number {
  return mailboxOf(user.id).filter((m) => !m.read && m.dir !== 'out' && m.otherId).length;
}

// Список ТРЕДОВ (переписок) — сгруппировано по собеседнику, последнее
// сообщение сверху. Легаси-записи без otherId (старые системные письма)
// отфильтровываются — это и убирает уведомления из почты «задним числом».
function inbox(user: User) {
  const box = mailboxOf(user.id).filter((m) => m.otherId); // только реальные переписки
  const threads = new Map<string, any>();
  for (const m of box) {
    let th = threads.get(m.otherId);
    if (!th) { th = { otherId: m.otherId, otherName: m.otherName, lastAt: 0, unread: 0, messages: [] }; threads.set(m.otherId, th); }
    th.messages.push({ id: m.id, dir: m.dir, subject: m.subject, text: m.text, at: m.at, read: m.read });
    if (m.at > th.lastAt) { th.lastAt = m.at; th.otherName = m.otherName; } // имя берём из последнего сообщения (могло смениться)
    if (m.dir !== 'out' && !m.read) th.unread++;
  }
  const list = Array.from(threads.values());
  list.forEach((th) => th.messages.sort((a: any, b: any) => a.at - b.at));
  list.sort((a, b) => b.lastAt - a.lastAt);
  return { threads: list };
}

// Открыть переписку с конкретным собеседником — помечает ВСЕ его
// входящие письма прочитанными и возвращает полную историю.
function readThread(user: User, otherId: string) {
  const box = mailboxOf(user.id);
  const messages = box.filter((m) => m.otherId === otherId);
  if (!messages.length) throw new u.ApiError('Переписка не найдена');
  let changed = false;
  for (const m of messages) { if (m.dir !== 'out' && !m.read) { m.read = true; changed = true; } }
  if (changed) db.save('mail');
  messages.sort((a, b) => a.at - b.at);
  return {
    otherId, otherName: messages[messages.length - 1].otherName,
    messages: messages.map((m) => ({ id: m.id, dir: m.dir, subject: m.subject, text: m.text, at: m.at })),
  };
}

function sendMail(user: User, toName: string, subject: string, text: string) {
  const target = player.findByName(toName);
  if (!target) throw new u.ApiError('Игрок с таким именем не найден');
  if (target.id === user.id) throw new u.ApiError('Письмо самому себе? Лучше веди дневник.');
  if (!String(text || '').trim()) throw new u.ApiError('Пустое письмо');
  mailBetween(user, target, subject, text);
}

// ---------- ЗАЛ СЛАВЫ ----------
// Топ-10 игроков в нескольких категориях
// Зал славы — вынесен в отдельный модуль
const fameMod: any = require('./fame');
const fame = fameMod.fame;

function markAllRead(user: User) {
  const box = mailboxOf(user.id);
  let n = 0;
  for (const m of box) { if (m.dir !== 'out' && !m.read) { m.read = true; n++; } }
  if (n > 0) db.save('mail');
  return { marked: n };
}

export = { chatGet, chatPost, unread, inbox, readThread, markAllRead, sendMail, fame };
