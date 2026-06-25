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

// ---------- ПОЧТА ----------
// Письмо от системы или другого игрока. fromId=null означает «Генштаб».
function mailTo(targetUser: User, fromName: string, subject: string, text: string, fromId: string | null = null): void {
  const box = mailboxOf(targetUser.id);
  box.push({
    id: u.uid(10), fromId, fromName,
    subject: String(subject || '(без темы)').slice(0, 80),
    text: String(text || '').slice(0, config.MAIL.MAX_LEN),
    at: Date.now(), read: false,
  });
  if (box.length > config.MAIL.KEEP) box.splice(0, box.length - config.MAIL.KEEP);
  db.save('mail');
}

function systemMail(targetUser: User, subject: string, text: string): void {
  mailTo(targetUser, 'Генштаб', subject, text, null);
}

function unread(user: User): number {
  return mailboxOf(user.id).filter((m) => !m.read).length;
}

function inbox(user: User) {
  return {
    messages: mailboxOf(user.id)
      .slice()
      .reverse()
      .map((m) => ({ id: m.id, fromName: m.fromName, subject: m.subject, at: m.at, read: m.read })),
  };
}

function readMail(user: User, mailId: string) {
  const m = mailboxOf(user.id).find((x) => x.id === mailId);
  if (!m) throw new u.ApiError('Письмо не найдено');
  m.read = true;
  db.save('mail');
  return { mail: m };
}

function sendMail(user: User, toName: string, subject: string, text: string) {
  const target = player.findByName(toName);
  if (!target) throw new u.ApiError('Игрок с таким именем не найден');
  if (target.id === user.id) throw new u.ApiError('Письмо самому себе? Лучше веди дневник.');
  if (!String(text || '').trim()) throw new u.ApiError('Пустое письмо');
  mailTo(target, user.name, subject, text, user.id);
}

// ---------- ЗАЛ СЛАВЫ ----------
// Топ-10 игроков в нескольких категориях
// Зал славы — вынесен в отдельный модуль
const fameMod: any = require('./fame');
const fame = fameMod.fame;

export = { chatGet, chatPost, mailTo, systemMail, unread, inbox, readMail, sendMail, fame };
