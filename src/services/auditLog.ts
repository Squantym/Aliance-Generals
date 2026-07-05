// ===================================================================
// src/services/auditLog.ts — журнал действий игроков.
// Каждое POST-действие пишется отдельной записью (append-only).
// В mongo — capped-коллекция actionLogs (FIFO авто-вытеснение, дешёвая
// вставка одного документа). В json — массив в кэше с мягким капом.
// РАНЬШЕ весь массив (до 20 000 записей) переписывался в Atlas на КАЖДОЕ
// действие — это и был источник терабайтного исходящего трафика.
// ===================================================================

import db = require('../core/db');

interface RecordInput {
  userId?: string | null;
  userName?: string;
  path: string;
  desc?: string | null;
  params?: Record<string, unknown> | null;
  body?: Record<string, unknown> | null;
}

// Убираем пароль из тела запроса перед записью
function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const { password, ...rest } = body;
  return rest;
}

// Записать действие (append-only). desc — готовое человекочитаемое описание.
function record(entry: RecordInput): void {
  db.appendLog({
    at: Date.now(),
    userId: entry.userId || null,
    userName: entry.userName || '',
    path: entry.path,
    desc: entry.desc || null,
    params: entry.params && Object.keys(entry.params).length ? entry.params : undefined,
    body: entry.body ? sanitizeBody(entry.body) : undefined,
  });
}

// Последние записи по всем игрокам (async — читает из БД)
async function listAll(limit?: number): Promise<any[]> {
  return db.tailLogs(limit || 200);
}

// Последние записи конкретного игрока
async function listForUser(userId: string, limit?: number): Promise<any[]> {
  return db.tailLogs(limit || 200, userId);
}

export = { record, listAll, listForUser, sanitizeBody };
