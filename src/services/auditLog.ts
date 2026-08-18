// ===================================================================
// src/services/auditLog.ts — журнал действий игроков.
// Каждое POST-действие пишется отдельной записью (append-only).
// В своей базе — таблица logs: одна вставка на действие, записи старше
// недели упаковываются в сжатые суточные блоки. В json-режиме — массив
// в кэше с мягким капом.
// РАНЬШЕ (в облачной базе) весь массив до 20 000 записей переписывался
// на КАЖДОЕ действие — это и был источник терабайтного трафика.
// ===================================================================

import db = require('../core/db');

interface RecordInput {
  userId?: string | null;
  userName?: string;
  path: string;
  desc?: string | null;
  params?: Record<string, unknown> | null;
  body?: Record<string, unknown> | null;
  // Объект игрока — из него снимается срез счёта (balanceOf).
  // Сам объект в журнал НЕ пишется: там пароль, соль и весь прогресс.
  user?: any;
}

// ═══ ВЫРЕЗАНИЕ СЕКРЕТОВ ИЗ ТЕЛА ЗАПРОСА ══════════════════════════════
// Раньше здесь снималось ОДНО поле `password`, и только на верхнем уровне.
// Этого не хватало: маршрут смены пароля игроком передаёт oldPassword,
// newPassword и newPassword2 — все три уходили в журнал ОТКРЫТЫМ ТЕКСТОМ,
// лежали 90 дней и попадали в каждую копию базы и в вывоз наружу.
// Проверено воспроизведением, а не вычитано в коде.
//
// Поэтому теперь:
//   • список секретных имён, а не одно поле;
//   • сверка по нормализованному имени (без регистра и разделителей),
//     чтобы newPassword, new_password и NewPassword2 попадали под одно
//     правило и новое написание не создавало новую дыру;
//   • обход ВГЛУБЬ: секрет во вложенном объекте — та же утечка;
//   • правило срабатывает на любое имя, СОДЕРЖАЩЕЕ «password», «token»,
//     «secret» и подобное. Пропустить новое поле теперь труднее, чем
//     поймать, — защита работает на опережение, а не по факту.
const SECRET_PARTS = [
  'password', 'passwd', 'pass', 'passhash', 'salt',
  'token', 'secret', 'apikey', 'privatekey', 'otp', 'recoverycode',
];
const REDACTED = '[скрыто]';
const MAX_DEPTH = 6;   // страховка от абсурдно глубоких и циклических тел

function isSecretName(key: string): boolean {
  const norm = String(key).toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
  return SECRET_PARTS.some((p) => norm.includes(p));
}

function sanitizeBody(body: any, depth = 0): any {
  if (!body || typeof body !== 'object' || depth > MAX_DEPTH) return body;
  if (Array.isArray(body)) return body.map((v) => sanitizeBody(v, depth + 1));
  const out: any = {};
  for (const key of Object.keys(body)) {
    // Значение затираем, а САМО ПОЛЕ оставляем: по журналу должно быть
    // видно, что пароль в запросе был, иначе непонятно, что произошло
    out[key] = isSecretName(key) ? REDACTED : sanitizeBody(body[key], depth + 1);
  }
  return out;
}

// ═══ СРЕЗ СЧЁТА НА МОМЕНТ ДЕЙСТВИЯ ═════════════════════════════════
// Журнал отвечал только на вопрос «что игрок сделал». На вопрос «что у
// него БЫЛО» ответа не было вообще: между копиями базы (раз в 6 часов)
// баланс восстановить не по чему. Теперь к каждой записи прикладываем
// срез счёта — журнал превращается в ленту состояния с точностью до
// одного действия, и после сбоя видно, с чего начинать возврат.
//
// Ключи короткие: поле пишется в КАЖДУЮ запись, и «dollars» вместо «d»
// на трёхмесячной истории стоило бы лишних гигабайт.
function balanceOf(user: any): any {
  if (!user) return undefined;
  let units = 0;
  const um = user.units || {};
  for (const k in um) {
    const m = um[k];
    if (m) units += (m[0] || 0) + (m[1] || 0) + (m[2] || 0);
  }
  let builds = 0;
  const bm = user.buildings || {};
  for (const k in bm) builds += bm[k] || 0;
  return {
    d: Math.round(user.dollars || 0),
    g: Math.round(user.gold || 0),
    lv: user.level || 0,
    xp: Math.round(user.exp || 0),
    u: units,
    b: builds,
  };
}

// Развернуть срез в понятные имена — для админки
function expandBalance(bal: any): any {
  if (!bal) return null;
  return {
    dollars: bal.d || 0, gold: bal.g || 0, level: bal.lv || 0,
    exp: bal.xp || 0, units: bal.u || 0, buildings: bal.b || 0,
  };
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
    bal: entry.user ? balanceOf(entry.user) : undefined,
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

export = { record, listAll, listForUser, sanitizeBody, balanceOf, expandBalance };
