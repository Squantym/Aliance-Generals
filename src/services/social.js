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
function fame() {
  const all = Object.values(player.users());
  const categories = [
    { id: 'rating', name: 'Рейтинг', val: (p) => player.rating(p) },
    { id: 'level', name: 'Уровень', val: (p) => p.level },
    { id: 'attack', name: 'Самый сильный', val: (p) => player.totalPower(p, 'atk').power },
    { id: 'wins', name: 'Победы', val: (p) => p.battle.wins },
    { id: 'attacks', name: 'Нападения', val: (p) => p.battle.attacks },
    { id: 'fatal', name: 'Фаталити', val: (p) => p.battle.fatalities },
    // Богатство = сколько ВСЕГО заработано (включая грабёж в боях), а не
    // текущий баланс — баланс легко спустить, а слава за награбленное остаётся
    { id: 'rich', name: 'Богатство (всего заработано)', val: (p) => p.counters.moneyEarned || 0 },
    // Размер армии: суммарное количество единиц техники в строю
    { id: 'army', name: 'Размер армии', val: (p) => player.unitCountTotal(p) },
    // Размер альянса (0, если не состоит)
    { id: 'alliance_size', name: 'Самый крупный альянс', val: (p) => { const a = player.allianceOf(p); return a ? a.members.length : 0; } },
    // Помилования: сколько раз игрок выбрал «жетон» вместо уха при фаталити
    { id: 'mercy', name: 'Милосердие (жетоны)', val: (p) => p.tokens || 0 },
    // Жестокость: сколько ушей отрезано
    { id: 'cruel', name: 'Жестокость (отрезано ушей)', val: (p) => p.ears || 0 },
    // Прокачка трофеев: сумма уровней всех трофеев
    { id: 'trophies', name: 'Коллекционер трофеев', val: (p) => Object.values(p.trophies || {}).reduce((s, v) => s + v, 0) },
  ];
  return {
    categories: categories.map((c) => ({
      id: c.id, name: c.name,
      top: all
        .map((p) => ({ id: p.id, name: p.name, flag: player.flag(p), level: p.level, value: c.val(p) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    })),
  };
}

module.exports = { chatGet, chatPost, mailTo, systemMail, unread, inbox, readMail, sendMail, fame };
