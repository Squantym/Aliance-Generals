// ===================================================================
// src/services/notifications.ts — уведомления (колокольчик)
// Отдельно от личной почты. Сюда падают системные события: кто-то
// атаковал, ракетный удар, приглашение в альянс и т.п. Содержат
// структурированные данные (kind, payload) для подробного отображения,
// в отличие от почты, где только текст.
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');

const MAX_PER_USER = 100; // храним последние 100 уведомлений на игрока

interface Notification {
  id: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>;
  at: number;
  read: boolean;
}

// Минимально нужные поля игрока для этого модуля
interface UserLike { id: string; }

function boxOf(userId: string): Notification[] {
  const boxes = db.load<Record<string, Notification[]>>('notifications', {});
  if (!boxes[userId]) boxes[userId] = [];
  return boxes[userId];
}

// kind: 'attack_lost' | 'attack_won' | 'rocket_hit' | 'fatality' | ...
// payload: произвольные структурированные данные конкретного типа
function push(targetUserId: string, kind: string, title: string, payload?: Record<string, unknown>): void {
  const box = boxOf(targetUserId);
  box.push({
    id: u.uid(10), kind, title,
    payload: payload || {},
    at: Date.now(), read: false,
  });
  if (box.length > MAX_PER_USER) box.splice(0, box.length - MAX_PER_USER);
  db.save('notifications');

  // Дублируем важные события push-уведомлением на телефон (если игрок
  // подписан). Внутри — фильтр по типу события; ошибки глушатся, чтобы
  // проблемы с push-сервисом не ломали игровое действие.
  try { require('./push').onNotification(targetUserId, kind, title, payload || {}); } catch (e) {}
}

function unreadCount(user: UserLike): number {
  return boxOf(user.id).filter((n) => !n.read).length;
}

function list(user: UserLike) {
  return {
    notifications: boxOf(user.id)
      .slice()
      .reverse()
      .map((n) => ({ id: n.id, kind: n.kind, title: n.title, payload: n.payload, at: n.at, read: n.read })),
  };
}

function markRead(user: UserLike, notifId: string): void {
  const n = boxOf(user.id).find((x) => x.id === notifId);
  if (!n) return;
  n.read = true;
  db.save('notifications');
}

function markAllRead(user: UserLike): void {
  for (const n of boxOf(user.id)) n.read = true;
  db.save('notifications');
}

export = { push, unreadCount, list, markRead, markAllRead };
