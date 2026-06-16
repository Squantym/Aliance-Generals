// ===================================================================
// src/services/auditLog.js — журнал действий игроков
// Каждое POST-действие (купил, атаковал, прокачал и т.д.) и ключевые
// события авторизации (регистрация, вход, подтверждение почты)
// записываются сюда. Хранится через общий db.js — значит, попадает
// либо в JSON-файл, либо в MongoDB вместе со всем остальным.
//
// Чтобы журнал не рос бесконечно, общее число записей ограничено
// MAX_ENTRIES: самые старые записи отбрасываются.
// ===================================================================

const db = require('../core/db');

const MAX_ENTRIES = 5000;

function logs() { return db.load('actionLogs', []); }

// Убираем пароль из тела запроса перед записью в журнал — на всякий случай
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const { password, ...rest } = body;
  return rest;
}

// Записать одно действие в журнал
//   entry: { userId, userName, path, params?, body? }
function record(entry) {
  const arr = logs();
  arr.push({
    at: Date.now(),
    userId: entry.userId || null,
    userName: entry.userName || '',
    path: entry.path,
    params: entry.params && Object.keys(entry.params).length ? entry.params : undefined,
    body: entry.body ? sanitizeBody(entry.body) : undefined,
  });
  if (arr.length > MAX_ENTRIES) arr.splice(0, arr.length - MAX_ENTRIES);
  db.save('actionLogs');
}

// Последние записи по всем игрокам (для общего журнала в админке)
function listAll(limit) {
  const arr = logs();
  const n = Math.min(limit || 200, arr.length);
  return arr.slice(arr.length - n).reverse();
}

// Последние записи конкретного игрока
function listForUser(userId, limit) {
  const arr = logs().filter((e) => e.userId === userId);
  const n = Math.min(limit || 200, arr.length);
  return arr.slice(arr.length - n).reverse();
}

module.exports = { record, listAll, listForUser, sanitizeBody };
