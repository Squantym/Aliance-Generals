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
import zlib = require('zlib');

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

  // ── Возврат освобождённого места ────────────────────────────────
  // SQLite после DELETE не отдаёт место обратно файловой системе: страницы
  // помечаются свободными и переиспользуются. Для журнала это плохо: после
  // упаковки трёхмесячного хвоста внутри базы освобождается сотни мегабайт,
  // а файл остаётся прежнего размера — и его в таком виде тащит с собой
  // каждая копия. Замерено: 427 МБ до, 110 МБ после сжатия.
  //
  // INCREMENTAL позволяет отдавать место порциями, без полной перезаписи
  // базы. Но переключить режим на уже созданной базе можно только через
  // VACUUM, поэтому один раз его и делаем — на старте, до app.listen,
  // когда игроков ещё нет. На 427 МБ это заняло 2,2 секунды.
  try {
    const mode = Number(db.pragma('auto_vacuum'));
    if (mode !== 2) {
      const before = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
      db.pragma('auto_vacuum = INCREMENTAL');
      db.exec('VACUUM');
      const after = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
      if (before > 50 * 1024 * 1024) {
        console.log(`🗜  База сжата: ${(before / 1048576).toFixed(0)} МБ → ${(after / 1048576).toFixed(0)} МБ ` +
                    '(режим возврата места включён, дальше это делается порциями на ходу).');
      }
    }
  } catch (e: any) {
    console.warn('⚠️  Не удалось включить возврат места в базе:', e.message);
  }

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

    -- УПАКОВАННЫЙ ЖУРНАЛ. Записи старше недели складываются сюда: один
    -- блок на «сутки + игрок», внутри — те же строки JSON, сжатые gzip.
    --
    -- Зачем: срок хранения журнала 3 месяца, и при 500 игроках это ~4 млн
    -- строк, то есть около 1,4 ГБ в файле базы. Хуже того, каждая копия
    -- базы тащит эти 1,4 ГБ с собой, и 14 хранимых копий съедают 20 ГБ —
    -- диск заполняется сам, без чьей-либо ошибки.
    -- Строки журнала однообразны и пачкой сжимаются примерно в 19 раз,
    -- поэтому те же 3 месяца занимают около 150 МБ. Срок не урезан.
    --
    -- Почему ключ «сутки + игрок», а не просто «сутки»: разбирательство
    -- почти всегда про ОДНОГО игрока. При упаковке только по суткам,
    -- чтобы достать его действия двухмесячной давности, пришлось бы
    -- распаковать все сутки целиком — десятки мегабайт на один экран.
    CREATE TABLE IF NOT EXISTS log_packs (
      day      TEXT NOT NULL,          -- сутки по МСК, «ГГГГ-ММ-ДД»
      user_id  TEXT NOT NULL,          -- '' для действий без входа
      n        INTEGER NOT NULL,       -- сколько строк внутри
      raw      INTEGER NOT NULL,       -- сколько занимали до сжатия
      data     BLOB NOT NULL,          -- gzip от строк, разделённых \\n
      PRIMARY KEY (day, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_packs_day ON log_packs(day);

    -- ИСТОРИЯ СОСТОЯНИЯ ИГРОКА. Полный объект игрока в gzip, срез во
    -- времени. Это ответ на вопрос «что было у игрока до сбоя».
    --
    -- Почему не хватало копий базы: они делаются раз в несколько часов,
    -- то есть восстановить можно было только состояние на момент копии —
    -- до шести часов игры пропадало. Журнал действий тут не спасает: в
    -- нём лежат ИТОГОВЫЕ числа (деньги, золото, уровень, опыт, сколько
    -- всего техники), но не СОСТАВ — какая именно техника, какие
    -- постройки, какие навыки. А возвращать игроку надо именно состав.
    --
    -- Почему это дёшево: прокачанный игрок — 2 957 байт JSON и 1 209
    -- байт в gzip. Срез раз в 5 минут и только при изменении обходится
    -- в единицы мегабайт в сутки даже на 500 игроках, тогда как полная
    -- копия базы весит сотни мегабайт из-за журнала.
    --
    -- label пустой у обычных срезов и заполнен у важных: перед админским
    -- действием. Срезы с label прореживание НЕ удаляет — именно они нужны,
    -- когда разбираются с ошибкой сотрудника.
    CREATE TABLE IF NOT EXISTS player_history (
      seq   INTEGER PRIMARY KEY AUTOINCREMENT,
      id    TEXT NOT NULL,
      at    INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL DEFAULT '',
      hash  TEXT NOT NULL,
      data  BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ph_player ON player_history(id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_ph_at ON player_history(at);
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

  // Срез состояния — здесь же, на уже происходящем сохранении: отдельного
  // обхода игроков нет. Сам решает, писать ли (не чаще раза в 5 минут и
  // только если объект изменился), поэтому вызывать можно свободно.
  // Вне транзакции намеренно: история — страховка, и её сбой не должен
  // откатывать сохранение самих игроков.
  for (const p of players) {
    if (!p.obj) continue;
    const { id, ...rest } = p.obj;
    savePlayerHistory(p.id, rest);
  }
}

// ═══ ИСТОРИЯ СОСТОЯНИЯ ИГРОКА ════════════════════════════════════════
// Пишется из writeBatch — то есть на том же сохранении, что уже
// происходит. Отдельного обхода игроков нет.

const HIST_MIN_GAP_MS = 5 * 60 * 1000;    // не чаще одного среза в 5 минут
const HIST_KEEP_MS = 90 * 24 * 3600 * 1000;
const HIST_FULL_MS = 48 * 3600 * 1000;    // 48 часов — всё подряд
const HIST_HOURLY_MS = 7 * 24 * 3600 * 1000;  // до недели — по одному в час

// Когда и что писали в последний раз. Держим в памяти, чтобы не читать
// базу на каждом сохранении: сравнение по отпечатку — единственный
// способ не плодить одинаковые срезы у игрока, который просто онлайн.
const histLast: Record<string, { at: number; hash: string }> = {};

function fingerprint(s: string): string {
  return require('crypto').createHash('sha1').update(s).digest('hex').slice(0, 16);
}

// Срез состояния игрока. Пишется, если:
//   • прошло не меньше HIST_MIN_GAP_MS с прошлого среза И объект изменился,
//   • ЛИБО указан label — важное событие пишем всегда, без задержки.
// Возвращает true, если запись состоялась.
// at указывается, только когда срез относится к ДРУГОМУ моменту, а не к
// «сейчас»: перенос истории из копии базы, засев данных в тестах. В
// обычной работе не передаётся.
function savePlayerHistory(id: string, obj: any, label = '', actor = '', at = 0): boolean {
  if (!id || !obj) return false;
  try {
    const json = JSON.stringify(obj);
    const hash = fingerprint(json + (at || ''));
    const now = at || Date.now();
    const prev = at ? null : histLast[id];
    if (!label && prev && (now - prev.at < HIST_MIN_GAP_MS || prev.hash === hash)) return false;
    db.prepare('INSERT INTO player_history (id, at, label, actor, hash, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, now, label, actor, hash, zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 6 }));
    // Кэш «когда писали в последний раз» обновляем только для срезов
    // «сейчас»: иначе перенос старой истории сбил бы задержку в 5 минут
    // и следующий настоящий срез не записался бы.
    if (!at) histLast[id] = { at: now, hash };
    return true;
  } catch (e) { return false; }
}

// Список срезов игрока — без тел, только когда и сколько весит
function playerHistoryList(id: string, limit = 200): any[] {
  try {
    return db.prepare(
      'SELECT seq, at, label, actor, length(data) AS size FROM player_history ' +
      'WHERE id = ? ORDER BY at DESC LIMIT ?'
    ).all(id, limit) as any[];
  } catch (e) { return []; }
}

// Один срез целиком
function playerHistoryGet(seq: number): any | null {
  try {
    const r: any = db.prepare('SELECT id, at, label, actor, data FROM player_history WHERE seq = ?').get(seq);
    if (!r) return null;
    const obj = JSON.parse(zlib.gunzipSync(r.data).toString('utf8'));
    return { seq, id: r.id, at: r.at, label: r.label, actor: r.actor, player: { ...obj, id: r.id } };
  } catch (e) { return null; }
}

// Ближайший срез НЕ ПОЗЖЕ указанного момента — «что было в 14:30».
function playerHistoryAt(id: string, at: number): any | null {
  try {
    const r: any = db.prepare(
      'SELECT seq FROM player_history WHERE id = ? AND at <= ? ORDER BY at DESC LIMIT 1'
    ).get(id, at);
    return r ? playerHistoryGet(r.seq) : null;
  } catch (e) { return null; }
}

// ── Прореживание ──────────────────────────────────────────────────
// Свежее нужно подробно, старое — обзорно. 48 часов держим всё подряд,
// до недели оставляем по одному срезу в час, дальше по одному в сутки,
// после 3 месяцев удаляем. Срезы с label (перед админскими действиями)
// не трогаем никогда: именно они нужны при разборе спорных случаев.
function thinPlayerHistory(): any {
  const now = Date.now();
  let removed = 0;
  try {
    const tx = db.transaction(() => {
      // Старше срока хранения — удалить полностью
      removed += db.prepare('DELETE FROM player_history WHERE at < ? AND label = \'\'')
        .run(now - HIST_KEEP_MS).changes || 0;
      // От 48 часов до недели — по одному в час
      removed += db.prepare(
        `DELETE FROM player_history WHERE label = '' AND at < ? AND at >= ?
           AND seq NOT IN (
             SELECT MAX(seq) FROM player_history WHERE label = '' AND at < ? AND at >= ?
              GROUP BY id, at / 3600000)`
      ).run(now - HIST_FULL_MS, now - HIST_HOURLY_MS,
            now - HIST_FULL_MS, now - HIST_HOURLY_MS).changes || 0;
      // Старше недели — по одному в сутки
      removed += db.prepare(
        `DELETE FROM player_history WHERE label = '' AND at < ? AND at >= ?
           AND seq NOT IN (
             SELECT MAX(seq) FROM player_history WHERE label = '' AND at < ? AND at >= ?
              GROUP BY id, at / 86400000)`
      ).run(now - HIST_HOURLY_MS, now - HIST_KEEP_MS,
            now - HIST_HOURLY_MS, now - HIST_KEEP_MS).changes || 0;
    });
    tx();
  } catch (e) {}
  return { removed };
}

function historyStats(): any {
  try {
    const r: any = db.prepare(
      'SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS players, COALESCE(SUM(length(data)),0) AS bytes, ' +
      'MIN(at) AS oldest, MAX(at) AS newest, ' +
      'SUM(CASE WHEN label <> \'\' THEN 1 ELSE 0 END) AS labelled FROM player_history'
    ).get();
    return {
      count: r ? r.n || 0 : 0,
      players: r ? r.players || 0 : 0,
      bytes: r ? r.bytes || 0 : 0,
      labelled: r ? r.labelled || 0 : 0,
      oldestAt: r ? r.oldest || 0 : 0,
      newestAt: r ? r.newest || 0 : 0,
      gapMinutes: Math.round(HIST_MIN_GAP_MS / 60000),
      keepDays: Math.round(HIST_KEEP_MS / 86400000),
    };
  } catch (e) {
    return { count: 0, players: 0, bytes: 0, labelled: 0, oldestAt: 0, newestAt: 0,
             gapMinutes: Math.round(HIST_MIN_GAP_MS / 60000), keepDays: Math.round(HIST_KEEP_MS / 86400000) };
  }
}

// Удаление игрока — настоящее, из таблицы. В mongo-режиме запись шла
// через replaceOne и документы никогда не удалялись: удалённые аккаунты
// «воскресали» после рестарта, а их позывные дублировались в рейтинге.
function deletePlayer(id: string): boolean {
  const r = db.prepare('DELETE FROM players WHERE id = ?').run(id);
  return r.changes > 0;
}

// ---------- Аудит ----------
// СРОК ХРАНЕНИЯ — 3 МЕСЯЦА, по времени, а не по числу записей.
// Раньше держали последние 50 000 строк: при активной игре это всего
// несколько дней, и разбирательство по жалобе недельной давности упиралось
// в пустоту. Теперь старое удаляется по дате, а сколько записей накопится —
// столько и лежит.
const LOG_KEEP_MS = 90 * 24 * 3600 * 1000;

// Чистку делаем не на каждой записи (это лишняя работа на горячем пути),
// а раз в час: за час лишнего накапливается пренебрежимо мало.
let lastLogPrune = 0;
const LOG_PRUNE_EVERY_MS = 3600 * 1000;

function appendLog(entry: any, keepMs = LOG_KEEP_MS): void {
  const now = Date.now();
  db.prepare('INSERT INTO action_logs (at, user_id, data) VALUES (?, ?, ?)')
    .run(entry.at || now, entry.userId || null, JSON.stringify(entry));
  if (now - lastLogPrune > LOG_PRUNE_EVERY_MS) {
    lastLogPrune = now;
    try { db.prepare('DELETE FROM action_logs WHERE at < ?').run(now - keepMs); } catch (e) {}
    // Упакованные блоки живут по тому же сроку. Чистим по ключу-дате:
    // строковое сравнение «ГГГГ-ММ-ДД» совпадает с хронологическим.
    try {
      db.prepare('DELETE FROM log_packs WHERE day < ?').run(logDayKey(now - keepMs));
    } catch (e) {}
  }
}

// ═══ УПАКОВКА СТАРОГО ЖУРНАЛА ════════════════════════════════════════
// Свежая неделя лежит обычными строками: по ней ходят чаще всего, и она
// должна быть индексированной и быстрой. Всё, что старше, ужимается в
// блоки «сутки + игрок» (см. комментарий к таблице log_packs).
const LOG_HOT_DAYS = 7;

// Сутки по МСК — как и везде в проекте, чтобы «день» не переключался
// посреди вечера по местному времени игроков.
function logDayKey(ts: number): string {
  return new Date(ts + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Упаковка порциями. Сжать разом двухмесячный хвост при 500 игроках —
// это миллионы строк и секунды работы в единственном потоке Node, то есть
// заметный для игроков затык. Поэтому за один вызов берём не больше
// maxPacks групп, а вызывается это из фонового тика — хвост рассасывается
// постепенно и незаметно.
// Отдать файловой системе часть освобождённых страниц. Порциями, чтобы
// не занимать единственный поток: 2000 страниц — это около 8 МБ.
function reclaimSpace(pages = 2000): number {
  try {
    const free = Number(db.pragma('freelist_count')) || 0;
    if (free < 500) return 0;                       // мелочь не трогаем
    db.exec(`PRAGMA incremental_vacuum(${Math.min(pages, free)})`);
    return free - (Number(db.pragma('freelist_count')) || 0);
  } catch (e) { return 0; }
}

// maxPacks по умолчанию небольшой намеренно. Замерено: одна группа
// «сутки + игрок» упаковывается ~16 мс, то есть 25 групп за вызов давали
// паузу до 750 мс — для единственного ядра это заметный затык. Догонять
// трёхмесячный хвост спешить некуда: при 500 игроках в сутки появляется
// около 180 новых групп, а тик идёт каждые 30 секунд.
function packOldLogs(maxPacks = 6): any {
  const cutoff = Date.now() - LOG_HOT_DAYS * 86400000;
  let packed = 0, rows = 0, raw = 0, gz = 0;
  try {
    // Какие группы «сутки + игрок» ещё не упакованы
    const groups: any[] = db.prepare(
      `SELECT user_id AS uid, COUNT(*) AS n, MIN(at) AS from_at, MAX(at) AS to_at
         FROM action_logs WHERE at < ?
        GROUP BY user_id, CAST((at + 10800000) / 86400000 AS INTEGER)
        ORDER BY from_at ASC LIMIT ?`
    ).all(cutoff, maxPacks) as any[];

    for (const g of groups) {
      const uid = g.uid || '';
      const day = logDayKey(g.from_at);
      // Границы этих суток по МСК — берём ровно те строки, что вошли в группу
      const dayStart = Math.floor((g.from_at + 10800000) / 86400000) * 86400000 - 10800000;
      const dayEnd = dayStart + 86400000;
      const sel = uid
        ? db.prepare('SELECT seq, data FROM action_logs WHERE at >= ? AND at < ? AND user_id = ? ORDER BY seq ASC')
            .all(dayStart, dayEnd, uid)
        : db.prepare('SELECT seq, data FROM action_logs WHERE at >= ? AND at < ? AND (user_id IS NULL OR user_id = \'\') ORDER BY seq ASC')
            .all(dayStart, dayEnd);
      if (!sel.length) continue;

      // Если блок за эти сутки уже есть (упаковка шла в два приёма —
      // например, процесс перезапустили посередине), дописываем к нему,
      // а не затираем: иначе часть журнала пропала бы молча.
      const prev: any = db.prepare('SELECT n, raw, data FROM log_packs WHERE day = ? AND user_id = ?').get(day, uid);
      let text = sel.map((r: any) => r.data).join('\n');
      let count = sel.length;
      let rawBytes = Buffer.byteLength(text);
      if (prev) {
        const old = zlib.gunzipSync(prev.data).toString('utf8');
        text = old + '\n' + text;
        count += prev.n;
        rawBytes += prev.raw;
      }
      const blob = zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 6 });

      const tx = db.transaction(() => {
        db.prepare('INSERT OR REPLACE INTO log_packs (day, user_id, n, raw, data) VALUES (?, ?, ?, ?, ?)')
          .run(day, uid, count, rawBytes, blob);
        // Удаляем ровно те строки, что вошли в блок — по seq, а не по
        // диапазону дат: за время упаковки могла добавиться новая запись
        const ids = sel.map((r: any) => r.seq);
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          db.prepare(`DELETE FROM action_logs WHERE seq IN (${chunk.map(() => '?').join(',')})`).run(...chunk);
        }
      });
      tx();

      packed++; rows += sel.length; raw += rawBytes; gz += blob.length;
    }
  } catch (e: any) {
    console.error('⚠️  Упаковка журнала не удалась:', e.message);
  }
  return { packed, rows, rawBytes: raw, gzBytes: gz,
           ratio: gz ? Math.round(raw / gz * 10) / 10 : 0 };
}

// Достать строки из упакованных блоков за период. Распаковываем только
// нужные сутки нужного игрока — в этом и смысл ключа «сутки + игрок».
function readPacked(from: number, to: number, userId?: string): any[] {
  const out: any[] = [];
  try {
    const fromDay = logDayKey(from), toDay = logDayKey(to);
    const rows: any[] = userId
      ? db.prepare('SELECT data FROM log_packs WHERE day >= ? AND day <= ? AND user_id = ? ORDER BY day DESC')
          .all(fromDay, toDay, userId) as any[]
      : db.prepare('SELECT data FROM log_packs WHERE day >= ? AND day <= ? ORDER BY day DESC').all(fromDay, toDay) as any[];
    for (const r of rows) {
      const text = zlib.gunzipSync(r.data).toString('utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const o = JSON.parse(line);
          if ((o.at || 0) >= from && (o.at || 0) <= to) out.push(o);
        } catch (e) {}
      }
    }
  } catch (e) {}
  return out;
}

// Сколько записей и за какой срок лежит в журнале — для админки.
// Считаем и «горячие» строки, и упакованные: для владельца это один
// журнал, деление на горячее и упакованное — деталь реализации.
function logStats(): any {
  const keepDays = Math.round(LOG_KEEP_MS / 86400000);
  try {
    const r: any = db.prepare(
      'SELECT COUNT(*) AS n, MIN(at) AS oldest, MAX(at) AS newest FROM action_logs'
    ).get();
    const p: any = db.prepare(
      'SELECT COUNT(*) AS packs, COALESCE(SUM(n),0) AS n, COALESCE(SUM(raw),0) AS raw, ' +
      'COALESCE(SUM(length(data)),0) AS gz, MIN(day) AS oldestDay FROM log_packs'
    ).get();
    const hot = r ? r.n || 0 : 0;
    const packedRows = p ? p.n || 0 : 0;
    // Самая старая запись может лежать в упакованном блоке
    let oldestAt = r ? r.oldest || 0 : 0;
    if (p && p.oldestDay) {
      const packOldest = Date.parse(p.oldestDay + 'T00:00:00Z') - 3 * 3600 * 1000;
      if (!oldestAt || packOldest < oldestAt) oldestAt = packOldest;
    }
    return {
      count: hot + packedRows,
      hot, packedRows,
      packs: p ? p.packs || 0 : 0,
      packedRaw: p ? p.raw || 0 : 0,
      packedGz: p ? p.gz || 0 : 0,
      packRatio: p && p.gz ? Math.round((p.raw / p.gz) * 10) / 10 : 0,
      hotDays: LOG_HOT_DAYS,
      oldestAt,
      newestAt: r ? r.newest || 0 : 0,
      keepDays,
    };
  } catch (e) {
    return { count: 0, hot: 0, packedRows: 0, packs: 0, packedRaw: 0, packedGz: 0,
             packRatio: 0, hotDays: LOG_HOT_DAYS, oldestAt: 0, newestAt: 0, keepDays };
  }
}

// Записи за период (для выгрузки и разбирательств). from/to — метки времени.
// Читает и «горячие» строки, и упакованные блоки: снаружи журнал един,
// и разбирательство по событию двухмесячной давности работает так же,
// как по вчерашнему.
function logsBetween(from: number, to: number, userId?: string, limit = 5000): any[] {
  const hot = userId
    ? db.prepare('SELECT data FROM action_logs WHERE at >= ? AND at <= ? AND user_id = ? ORDER BY seq DESC LIMIT ?')
        .all(from, to, userId, limit)
    : db.prepare('SELECT data FROM action_logs WHERE at >= ? AND at <= ? ORDER BY seq DESC LIMIT ?')
        .all(from, to, limit);
  const out = hot.map((r: any) => { try { return JSON.parse(r.data); } catch (e) { return null; } }).filter(Boolean);
  // Границу «горячей» недели здесь обрезать НЕЛЬЗЯ. Упаковка группирует
  // по суткам МСК, поэтому блок за день, попавший на границу, содержит и
  // записи новее её. Раньше чтение отбрасывало их по условию at <= границы,
  // а в горячих строках их уже не было — часть журнала становилась
  // невидимой (проверено: из 7500 действий игрока показывались 5000).
  // Запись всегда либо горячая, либо упакованная, поэтому дублей не будет,
  // а лишние блоки отсекает диапазон дней в самом запросе.
  if (out.length < limit) out.push(...readPacked(from, to, userId));
  out.sort((a: any, b: any) => (b.at || 0) - (a.at || 0));
  return out.slice(0, limit);
}

function tailLogs(limit: number, userId?: string): any[] {
  const hot = userId
    ? db.prepare('SELECT data FROM action_logs WHERE user_id = ? ORDER BY seq DESC LIMIT ?').all(userId, limit)
    : db.prepare('SELECT data FROM action_logs ORDER BY seq DESC LIMIT ?').all(limit);
  const out = hot.map((r: any) => { try { return JSON.parse(r.data); } catch (e) { return null; } }).filter(Boolean);
  // Горячих строк не хватило — добираем из упакованного. У малоактивного
  // игрока свежих действий может не быть вовсе, и без этого его карточка
  // выглядела бы пустой, хотя история за 3 месяца лежит на месте.
  if (out.length < limit) out.push(...readPacked(0, Date.now(), userId));
  // Сортировка по ВРЕМЕНИ, а не по seq. Пока журнал был одной таблицей,
  // порядок вставки совпадал с хронологией и seq DESC хватало. Теперь
  // список склеивается из горячих строк и распакованных блоков, и без
  // явной сортировки записи шли вперемешку.
  out.sort((a: any, b: any) => (b.at || 0) - (a.at || 0));
  return out.slice(0, limit);
}

// ═══ ЧТЕНИЕ ИГРОКА ИЗ КОПИИ БАЗЫ ════════════════════════════════════
// Главный вопрос после сбоя: «что у игрока было до него?». Раньше на него
// отвечали только через SSH и sqlite3 руками. Здесь открываем копию
// ТОЛЬКО НА ЧТЕНИЕ и достаём запись игрока — боевая база при этом не
// затрагивается вообще.
//
// Имя файла приходит из админки, поэтому проверяем его: берём только
// базовое имя и убеждаемся, что файл лежит именно в папке копий.
// Иначе параметром вида «../../etc/passwd» можно было бы прочитать
// что угодно на сервере.
function playerFromBackup(fileName: string, query: string): any {
  const safe = path.basename(String(fileName || ''));
  if (!safe || !/^[\w.\-]+\.db$/.test(safe)) throw new Error('Недопустимое имя копии');
  const full = path.join(backupDir, safe);
  if (!fs.existsSync(full)) throw new Error('Копия не найдена');

  const h = makeDriver(full);
  try {
    const q = String(query || '').trim().toLowerCase();
    if (!q) throw new Error('Укажите позывной или id игрока');
    // Сначала точное совпадение по id, затем поиск по позывному
    let row: any = h.prepare('SELECT id, data FROM players WHERE id = ?').get(q);
    if (!row) {
      const rows: any[] = h.prepare('SELECT id, data FROM players').all();
      row = rows.find((r) => {
        try { return String(JSON.parse(r.data).name || '').toLowerCase() === q; }
        catch (e) { return false; }
      });
    }
    if (!row) return null;
    // id лежит в колонке, а не внутри JSON — возвращаем его так же, как
    // это делает loadAllPlayers. Без этого вызывающий код не смог бы
    // сопоставить найденного в копии игрока с текущим.
    const obj = { ...JSON.parse(row.data), id: row.id };
    // Пароль и соль не отдаём даже владельцу: в админке им не место
    delete obj.passHash; delete obj.salt;
    delete obj.resetToken; delete obj.emailVerifyToken;
    return obj;
  } finally {
    try { h.close(); } catch (e) {}
  }
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

// ═══ ЛЁГКАЯ КОПИЯ: только игроки и коллекции, без журнала ═════════════
// Полная копия тащит с собой журнал, а он и есть основной вес базы: при
// 500 игроках это сотни мегабайт против пяти. Из-за этого частые полные
// копии невозможны, и точность восстановления упиралась в 6 часов.
//
// Но ценное — прогресс игроков — весит мало. Такую копию можно делать
// каждые 15 минут почти бесплатно, и именно она нужна в 99% разборов.
// Полные копии остаются для случая «потеряли базу целиком».
//
// Формат тот же SQLite: файл открывается как обычная база, и его читает
// уже существующий просмотрщик копий в панели.
function backupLight(label = 'light', keep = 192): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  let target = path.join(backupDir, `generals-${label}-${iso}.db`);
  let n = 1;
  while (fs.existsSync(target)) target = path.join(backupDir, `generals-${label}-${iso}-${n++}.db`);

  // Пишем через отдельное соединение к новому файлу: ATTACH к боевой базе
  // держал бы её заблокированной дольше, чем нужно.
  const out = makeDriver(target);
  try {
    out.exec(`
      CREATE TABLE players (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE collections (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
    `);
    const ins = out.prepare('INSERT INTO players (id, data, updated_at) VALUES (?, ?, ?)');
    const insC = out.prepare('INSERT INTO collections (id, data, updated_at) VALUES (?, ?, ?)');
    const players = db.prepare('SELECT id, data, updated_at FROM players').all() as any[];
    const colls = db.prepare('SELECT id, data, updated_at FROM collections').all() as any[];
    const tx = out.transaction(() => {
      for (const r of players) ins.run(r.id, r.data, r.updated_at);
      for (const r of colls) insC.run(r.id, r.data, r.updated_at);
    });
    tx();
  } finally {
    try { out.close(); } catch (e) {}
  }

  // Ротация по числу файлов этой метки: 192 копии по 15 минут = 48 часов
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
  appendLog, tailLogs, logStats, logsBetween, LOG_KEEP_MS, playerFromBackup,
  packOldLogs, readPacked, logDayKey, LOG_HOT_DAYS, reclaimSpace,
  savePlayerHistory, playerHistoryList, playerHistoryGet, playerHistoryAt,
  thinPlayerHistory, historyStats,
  backup, backupLight, snapshot, snapshotList, snapshotGet,
  query, stats,
};
