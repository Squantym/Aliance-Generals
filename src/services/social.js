// ===================================================================
// src/services/social.js — общий чат, почта (личные сообщения), зал славы
// ===================================================================

const config = require('../../config/gameConfig');
const db = require('../core/db');
const u = require('../core/utils');
const player = require('./player');

function world() {
  const w = db.load('world', { chat: [], auctions: [], seq: 1 });
  if (!w.chat) w.chat = [];
  if (!w.auctions) w.auctions = [];
  if (!w.seq) w.seq = 1;
  return w;
}

function mailboxOf(userId) {
  const boxes = db.load('mail', {});
  if (!boxes[userId]) boxes[userId] = [];
  return boxes[userId];
}

// ---------- ЧАТ ----------
function chatGet(afterId) {
  const after = u.toInt(afterId, 0);
  return { messages: world().chat.filter((m) => m.id > after) };
}

function chatPost(user, text) {
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
function mailTo(targetUser, fromName, subject, text, fromId = null) {
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

function systemMail(targetUser, subject, text) {
  mailTo(targetUser, 'Генштаб', subject, text, null);
}

function unread(user) {
  return mailboxOf(user.id).filter((m) => !m.read).length;
}

function inbox(user) {
  return {
    messages: mailboxOf(user.id)
      .slice()
      .reverse()
      .map((m) => ({ id: m.id, fromName: m.fromName, subject: m.subject, at: m.at, read: m.read })),
  };
}

function readMail(user, mailId) {
  const m = mailboxOf(user.id).find((x) => x.id === mailId);
  if (!m) throw new u.ApiError('Письмо не найдено');
  m.read = true;
  db.save('mail');
  return { mail: m };
}

function sendMail(user, toName, subject, text) {
  const target = player.findByName(toName);
  if (!target) throw new u.ApiError('Игрок с таким именем не найден');
  if (target.id === user.id) throw new u.ApiError('Письмо самому себе? Лучше веди дневник.');
  if (!String(text || '').trim()) throw new u.ApiError('Пустое письмо');
  mailTo(target, user.name, subject, text, user.id);
}

// ---------- ЗАЛ СЛАВЫ ----------
// Топ-10 игроков в нескольких категориях
// Зал славы — вынесен в отдельный модуль
const { fame } = require('./fame');

module.exports = { chatGet, chatPost, mailTo, systemMail, unread, inbox, readMail, sendMail, fame };
