// ═══════════════════════════════════════════════════════════════════
// SQLITE-ХРАНИЛИЩЕ — замена облачной MongoDB
//
// Зачем: своя база на своём VDS, без облака, паролей и утечек.
// Один файл data/generals.db — его можно скопировать, унести, поднять
// где угодно. Плюс то, чего не было ни в JSON-, ни в mongo-режиме:
//   • ТРАНЗАКЦИИ: один flush = одна транзакция. Либо записалось всё,
//     либо ничего. Раньше падение процесса посреди записи оставляло
//     часть игроков сохранённой, а часть — нет.
//   • WAL: при жёстком падении (kill -9, отключение питания) база
//     восстанавливается из журнала, а не превращается в мусор.
//   • БЭКАПЫ на ходу: VACUUM INTO делает целостную копию, не останавливая
//     игру. С ротацией по числу копий.
//   • СНАПШОТЫ коллекций: снимок перед рискованной операцией (сброс
//     недели, миграция). Именно этого не хватило, когда обнулились
//     сезонные очки — откатывать было нечего.
//   • SQL: рейтинги, поиск и статистика запросом с индексом, вместо
//     перебора всех игроков в памяти.
//
// Формат хранения намеренно документный: одна строка = один игрок или
// одна коллекция, тело — JSON. Так весь существующий код (40+ файлов,
// работающих с обычными объектами) не требует переписывания, а SQL при
// этом доступен через json_extract и индексы по выражениям.
// ═══════════════════════════════════════════════════════════════════

import fs = require('fs');
import path = require('path');

type Row = { id: string; data: string };

let db: any = null;
let dbPath = '';
let backupDir = '';
let driverKind = '';

// ── Выбор драйвера ────────────────────────────────────────────────
// better-sqlite3 быстрее, но это НАТИВНЫЙ модуль: на сервере без
// build-essential/python3 он не собирается, и — что хуже — обрушивает
// весь `npm install`, то есть игра не поднимается вообще. Поэтому он
// объявлен необязательной зависимостью, а при его отсутствии берётся
// SQLite, встроенный в Node 22+. Формат файла базы у них одинаковый:
// переключение драйвера ничего не меняет в данных.
function makeDriver(file: string): any {
  // Порядок выбора:
  //  1) better-sqlite3 — если установлен. У него СТАБИЛЬНЫЙ API, поэтому
  //     на живом проде он предпочтительнее. Это необязательная зависимость:
  //     не собрался — просто идём дальше, npm install не ломается.
  //  2) встроенный node:sqlite (Node 22.5+) — не требует компиляции и
  //     работает всегда, но в Node 22 помечен экспериментальным: его API
  //     может измениться при обновлении Node (в Node 24 уже стабилен).
  // Формат файла базы у обоих одинаковый — драйвер можно менять в любой
  // момент, данные от этого не зависят.
  try {
    const Database = require('better-sqlite3');
    const h = new Database(file);
    return {
      kind: 'better-sqlite3',
      exec: (sql: string) => h.exec(sql),
      prepare: (sql: string) => h.prepare(sql),
      pragma: (expr: string) => h.pragma(expr, { simple: true }),
      transaction: (fn: () => void) => h.transaction(fn),
      close: () => h.close(),
    };
  } catch (eNative: any) {
    // Нативного нет — пробуем встроенный
    const [maj, min] = process.versions.node.split('.').map(Number);
    if (maj > 22 || (maj === 22 && min >= 5)) {
      try {
        const { DatabaseSync } = require('node:sqlite');
        return builtinDriver(new DatabaseSync(file));
      } catch (eBuiltin: any) { /* ниже общее сообщение */ }
    }
    // Ни нативного, ни встроенного. Объясняем ЧТО делать, а не
    // выбрасываем «Cannot find module».
    const e = eNative;
    throw new Error(
      `Не найден драйвер SQLite. Node ${process.versions.node}: встроенный модуль появился в 22.5, ` +
      `нативный better-sqlite3 не установлен (${String(e.message).slice(0, 80)}).\n` +
      `Решение: либо обновить Node до 22 LTS (тогда драйвер не нужен вообще), ` +
      `либо установить нативный: npm i better-sqlite3@^11 (нужны build-essential и python3).`
    );
  }
}

// Обёртка над встроенным в Node модулем: у него нет методов pragma() и
// transaction(), которые есть у нативного драйвера — добавляем их сами.
function builtinDriver(h: any): any {
  return {
    kind: 'node:sqlite',
    exec: (sql: string) => h.exec(sql),
    prepare: (sql: string) => h.prepare(sql),
    pragma: (expr: string) => {
      if (expr.includes('=')) { h.exec(`PRAGMA ${expr}`); return null; }
      const row: any = h.prepare(`PRAGMA ${expr}`).get();
      return row ? Object.values(row)[0] : null;
    },
    // Транзакция вручную, с откатом при ошибке
    transaction: (fn: () => void) => () => {
      h.exec('BEGIN');
      try { fn(); h.exec('COMMIT'); }
      catch (err) { try { h.exec('ROLLBACK'); } catch (e2) {} throw err; }
    },
    close: () => h.close(),
  };
}

// ---------- Инициализация ----------
function open(dataDir: string, fileName = 'generals.db'): any {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, fileName);
  backupDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  db = makeDriver(dbPath);
  driverKind = db.kind;

  // WAL — читатели не блокируют писателя, и база переживает жёсткое падение.
  db.pragma('journal_mode = WAL');
  // NORMAL: fsync на контрольных точках, а не на каждой транзакции.
  // Для игры это правильный баланс: потерять можно только последние
  // миллисекунды при отказе ОС, а не при падении процесса.
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // Ждать до 5 секунд, если файл занят другим процессом (например,
  // запущенным скриптом бэкапа), а не падать сразу.
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id         TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collections (
      id         TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- Аудит действий: одна строка на событие, старые вытесняются по лимиту
    CREATE TABLE IF NOT EXISTS action_logs (
      seq     INTEGER PRIMARY KEY AUTOINCREMENT,
      at      INTEGER NOT NULL,
      user_id TEXT,
      data    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_user ON action_logs(user_id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_at   ON action_logs(at DESC);
    -- Снимки коллекций: страховка перед рискованными операциями
    CREATE TABLE IF NOT EXISTS snapshots (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      at         INTEGER NOT NULL,
      label      TEXT NOT NULL,
      collection TEXT NOT NULL,
      data       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snap ON snapshots(collection, at DESC);
  `);

  // Индексы по полям внутри JSON — то, чего не было раньше: рейтинг и
  // фильтры считаются базой, а не перебором объектов в памяти.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_players_level
      ON players(json_extract(data, '$.level') DESC);
    CREATE INDEX IF NOT EXISTS idx_players_name
      ON players(json_extract(data, '$.name'));
    CREATE INDEX IF NOT EXISTS idx_players_seen
      ON players(json_extract(data, '$.lastSeen') DESC);
    CREATE INDEX IF NOT EXISTS idx_players_bot
      ON players(json_extract(data, '$.isBot'));
  `);

  return db;
}

function isOpen(): boolean { return !!db; }
function driver(): string { return driverKind; }
function file(): string { return dbPath; }

// ---------- Чтение при старте ----------
function loadAllPlayers(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const r of db.prepare('SELECT id, data FROM players').all() as Row[]) {
    try { out[r.id] = { ...JSON.parse(r.data), id: r.id }; } catch (e) {}
  }
  return out;
}

function loadAllCollections(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const r of db.prepare('SELECT id, data FROM collections').all() as Row[]) {
    try { out[r.id] = JSON.parse(r.data); } catch (e) {}
  }
  return out;
}

// ---------- Запись ----------
// Все записи одного flush идут ОДНОЙ транзакцией: при падении посреди
// сохранения база останется в том состоянии, что была до него.
function writeBatch(players: Array<{ id: string; obj: any }>, colls: Array<{ id: string; obj: any }>): void {
  const now = Date.now();
  const upPlayer = db.prepare(
    'INSERT INTO players (id, data, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  );
  const upColl = db.prepare(
    'INSERT INTO collections (id, data, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  );
  const tx = db.transaction(() => {
    for (const p of players) {
      if (!p.obj) continue;
      const { id, ...rest } = p.obj;
      upPlayer.run(p.id, JSON.stringify(rest), now);
    }
    for (const c of colls) {
      if (c.obj === undefined) continue;
      upColl.run(c.id, JSON.stringify(c.obj), now);
    }
  });
  tx();
}

// Удаление игрока — настоящее, из таблицы. В mongo-режиме запись шла
// через replaceOne и документы никогда не удалялись: удалённые аккаунты
// «воскресали» после рестарта, а их позывные дублировались в рейтинге.
function deletePlayer(id: string): boolean {
  const r = db.prepare('DELETE FROM players WHERE id = ?').run(id);
  return r.changes > 0;
}

// ---------- Аудит ----------
function appendLog(entry: any, keepMax = 50000): void {
  db.prepare('INSERT INTO action_logs (at, user_id, data) VALUES (?, ?, ?)')
    .run(entry.at || Date.now(), entry.userId || null, JSON.stringify(entry));
  // Вытеснение старых: держим не больше keepMax записей
  if (Math.random() < 0.01) {
    db.prepare(
      'DELETE FROM action_logs WHERE seq <= (SELECT MAX(seq) - ? FROM action_logs)'
    ).run(keepMax);
  }
}

function tailLogs(limit: number, userId?: string): any[] {
  const rows = userId
    ? db.prepare('SELECT data FROM action_logs WHERE user_id = ? ORDER BY seq DESC LIMIT ?').all(userId, limit)
    : db.prepare('SELECT data FROM action_logs ORDER BY seq DESC LIMIT ?').all(limit);
  return rows.map((r: any) => { try { return JSON.parse(r.data); } catch (e) { return null; } }).filter(Boolean);
}

// ---------- Защита данных ----------
// Целостная копия базы без остановки игры. Возвращает путь к файлу.
function backup(label = 'auto', keep = 14): string {
  // Метка времени с миллисекундами: VACUUM INTO падает, если файл уже
  // существует, а два бэкапа легко попадают в одну секунду (например,
  // ручной из админки совпал с автоматическим по расписанию). При
  // маловероятном совпадении и по миллисекундам добавляем счётчик.
  const iso = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  let target = path.join(backupDir, `generals-${label}-${iso}.db`);
  let n = 1;
  while (fs.existsSync(target)) {
    target = path.join(backupDir, `generals-${label}-${iso}-${n++}.db`);
  }
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  // Ротация: оставляем последние keep копий с этой меткой
  const mine = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(`generals-${label}-`) && f.endsWith('.db'))
    .sort();
  while (mine.length > keep) {
    const drop = mine.shift();
    if (drop) { try { fs.unlinkSync(path.join(backupDir, drop)); } catch (e) {} }
  }
  return target;
}

// Снимок одной коллекции — быстрая страховка перед рискованной операцией.
// Дешевле полного бэкапа, поэтому годится для автоматических вызовов
// (например, перед сбросом недельного сезона).
function snapshot(collection: string, obj: any, label: string): void {
  db.prepare('INSERT INTO snapshots (at, label, collection, data) VALUES (?, ?, ?, ?)')
    .run(Date.now(), label, collection, JSON.stringify(obj));
  // Держим по 40 последних снимков на коллекцию
  db.prepare(
    'DELETE FROM snapshots WHERE collection = ? AND seq NOT IN ' +
    '(SELECT seq FROM snapshots WHERE collection = ? ORDER BY seq DESC LIMIT 40)'
  ).run(collection, collection);
}

function snapshotList(collection?: string, limit = 20): any[] {
  const rows = collection
    ? db.prepare('SELECT seq, at, label, collection, length(data) AS size FROM snapshots WHERE collection = ? ORDER BY seq DESC LIMIT ?').all(collection, limit)
    : db.prepare('SELECT seq, at, label, collection, length(data) AS size FROM snapshots ORDER BY seq DESC LIMIT ?').all(limit);
  return rows as any[];
}

function snapshotGet(seq: number): any | null {
  const r = db.prepare('SELECT data FROM snapshots WHERE seq = ?').get(seq) as any;
  if (!r) return null;
  try { return JSON.parse(r.data); } catch (e) { return null; }
}

// ---------- SQL наружу ----------
// Для аналитики и админки: считать топы/статистику без загрузки всех
// игроков в память.
function query(sql: string, params: any[] = []): any[] {
  return db.prepare(sql).all(...params) as any[];
}

function stats(): any {
  const one = (sql: string) => (db.prepare(sql).get() as any) || {};
  const size = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  return {
    file: dbPath,
    sizeBytes: size,
    players: one('SELECT COUNT(*) AS n FROM players').n,
    bots: one("SELECT COUNT(*) AS n FROM players WHERE json_extract(data,'$.isBot') = 1").n,
    collections: one('SELECT COUNT(*) AS n FROM collections').n,
    logs: one('SELECT COUNT(*) AS n FROM action_logs').n,
    snapshots: one('SELECT COUNT(*) AS n FROM snapshots').n,
    driverKind,
    walMode: db.pragma('journal_mode'),
    integrity: db.pragma('integrity_check'),
  };
}

function close(): void {
  if (!db) return;
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
  try { db.close(); } catch (e) {}
  db = null;
}

export = {
  open, isOpen, file, close, driver,
  loadAllPlayers, loadAllCollections,
  writeBatch, deletePlayer,
  appendLog, tailLogs,
  backup, snapshot, snapshotList, snapshotGet,
  query, stats,
};
