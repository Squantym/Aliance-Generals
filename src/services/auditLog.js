// ===================================================================
// src/services/auditLog.js — журнал действий игроков
// Каждое POST-действие записывается с человекочитаемым описанием.
// Срок хранения: 30 дней. Если записей становится слишком много
// (> SOFT_LIMIT) — хранится только за последние 7 дней.
// ===================================================================

const db = require('../core/db');

const MAX_ENTRIES = 20000;          // жёсткий потолок (защита от разрастания)
const SOFT_LIMIT = 12000;           // если записей больше — режем срок до недели
const MONTH_MS = 30 * 24 * 3600 * 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;

function logs() { return db.load('actionLogs', []); }

// Убираем пароль из тела запроса перед записью
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const { password, ...rest } = body;
  return rest;
}

// Удаляем устаревшие записи. Срок зависит от объёма:
//   - обычно храним 30 дней
//   - если записей > SOFT_LIMIT, храним только 7 дней (экономим место)
function prune(arr) {
  const now = Date.now();
  const horizon = arr.length > SOFT_LIMIT ? WEEK_MS : MONTH_MS;
  let i = 0;
  while (i < arr.length && now - arr[i].at > horizon) i++;
  if (i > 0) arr.splice(0, i);
  // Жёсткий потолок на всякий случай
  if (arr.length > MAX_ENTRIES) arr.splice(0, arr.length - MAX_ENTRIES);
}

// Записать действие. entry может содержать desc — готовое человекочитаемое
// описание (например «Купил 5× Т-90 за $150 000»).
function record(entry) {
  const arr = logs();
  arr.push({
    at: Date.now(),
    userId: entry.userId || null,
    userName: entry.userName || '',
    path: entry.path,
    desc: entry.desc || null,
    params: entry.params && Object.keys(entry.params).length ? entry.params : undefined,
    body: entry.body ? sanitizeBody(entry.body) : undefined,
  });
  prune(arr);
  db.save('actionLogs');
}

// Последние записи по всем игрокам
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
