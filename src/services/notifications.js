// ===================================================================
// src/services/notifications.js — уведомления (колокольчик)
// Отдельно от личной почты. Сюда падают системные события: кто-то
// атаковал, ракетный удар, приглашение в альянс и т.п. Содержат
// структурированные данные (kind, payload) для подробного отображения,
// в отличие от почты, где только текст.
// ===================================================================

const db = require('../core/db');
const u = require('../core/utils');

const MAX_PER_USER = 100; // храним последние 100 уведомлений на игрока

function boxOf(userId) {
  const boxes = db.load('notifications', {});
  if (!boxes[userId]) boxes[userId] = [];
  return boxes[userId];
}

// kind: 'attack_lost' | 'attack_won' | 'rocket_hit' | 'fatality' | 'alliance_invite' | ...
// payload: произвольные структурированные данные для конкретного типа уведомления
function push(targetUserId, kind, title, payload) {
  const box = boxOf(targetUserId);
  box.push({
    id: u.uid(10), kind, title,
    payload: payload || {},
    at: Date.now(), read: false,
  });
  if (box.length > MAX_PER_USER) box.splice(0, box.length - MAX_PER_USER);
  db.save('notifications');
}

function unreadCount(user) {
  return boxOf(user.id).filter((n) => !n.read).length;
}

function list(user) {
  return {
    notifications: boxOf(user.id)
      .slice()
      .reverse()
      .map((n) => ({ id: n.id, kind: n.kind, title: n.title, payload: n.payload, at: n.at, read: n.read })),
  };
}

function markRead(user, notifId) {
  const n = boxOf(user.id).find((x) => x.id === notifId);
  if (!n) return;
  n.read = true;
  db.save('notifications');
}

function markAllRead(user) {
  for (const n of boxOf(user.id)) n.read = true;
  db.save('notifications');
}

module.exports = { push, unreadCount, list, markRead, markAllRead };
