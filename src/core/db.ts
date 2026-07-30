// ===================================================================
// src/core/db.ts — гибридная база данных
//
// Если задана переменная окружения MONGODB_URI — все данные хранятся
// в MongoDB (постоянно, переживает перезапуски и переезды хостинга).
// Если переменная не задана — используются локальные JSON-файлы в /data
// (как раньше). Это удобно для разработки и для дымового теста: ничего
// не нужно поднимать дополнительно.
//
// Игроки (коллекция "users") хранятся В MONGO КАЖДЫЙ ОТДЕЛЬНЫМ ДОКУМЕНТОМ
// (один документ = один игрок), чтобы не упереться в лимит размера
// документа MongoDB (16 МБ) при большом числе игроков. Остальные
// коллекции (sessions, world, market, mail, ...) — один документ на
// коллекцию, как и раньше в JSON.
//
// ВАЖНО: интерфейс load()/save() остался СИНХРОННЫМ — все игровые
// сервисы (player, battle и т.д.) не нужно переписывать. Запись
// в реальную базу происходит асинхронно «под капотом» через debounce.
// ===================================================================

import fs = require('fs');
import path = require('path');

// Папка данных — относительно корня проекта (откуда запущен node),
// а не относительно расположения файла. Иначе при запуске из dist/
// путь уехал бы в dist/data вместо ./data.
const DATA_DIR = path.join(process.cwd(), 'data');

// Кэш коллекций в памяти (как и раньше) — отсюда всё читается синхронно.
// Коллекции разнородны (объекты игроков, мир, рынок...), поэтому any.
const store: Record<string, any> = {};
const dirty = new Set<string>();
const dirtyUsers = new Set<string>();   // id игроков для точечного сохранения
let allUsersDirty = false;               // флаг «сохранить всех игроков»
let saveTimer: NodeJS.Timeout | null = null;

// Режим работы: 'json' (по умолчанию) или 'mongo'
let mode: 'json' | 'mongo' | 'sqlite' = 'json';
// mongodb-пакет грузится динамически и опционален, поэтому типы any
let mongoClient: any = null;
let usersColl: any = null; // коллекция игроков: один документ = один игрок
let collColl: any = null;  // коллекция «прочих» данных: один документ = одна коллекция
let logsColl: any = null;  // аудит-лог: отдельная capped-коллекция, один документ = одна запись
let periodicTimer: NodeJS.Timeout | null = null;

let sqlite: any = null;          // модуль SQLite-хранилища (если выбран драйвер)
let backupTimer: any = null;
let lockFile = '';

// ═══ ЗАЩИТА ОТ ВТОРОГО ПРОЦЕССА ═══════════════════════════════════
// Сервер держит всю базу в памяти и сохраняет коллекции целиком. Если
// запустить два процесса на одних данных, каждый работает со своей копией
// в памяти: первый сохраняет устаревшее состояние поверх изменений
// второго. save('users') пишет ВСЕХ игроков, поэтому одним сохранением
// можно откатить прогресс всей базы — именно так теряются данные, когда
// в pm2 случайно остаётся дубль процесса.
// Поэтому при старте ставим замок с PID. Если процесс из замка ещё жив —
// отказываемся запускаться и объясняем, что делать.
function acquireLock(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    lockFile = path.join(dir, '.db-lock');
    if (fs.existsSync(lockFile)) {
      const raw = fs.readFileSync(lockFile, 'utf8').trim();
      const oldPid = Number(String(raw).split(/\s+/)[0]);
      if (oldPid && oldPid !== process.pid && isAlive(oldPid)) {
        throw new Error(
          `База уже используется процессом PID ${oldPid}.\n` +
          `Два процесса на одной базе затирают данные друг друга — запуск прерван.\n` +
          `Проверьте: pm2 list — и оставьте ОДИН процесс игры (pm2 delete <лишний>; pm2 save).\n` +
          `Если процесс ${oldPid} уже мёртв, удалите файл замка: ${lockFile}`
        );
      }
      // Замок остался от упавшего процесса — забираем себе
    }
    fs.writeFileSync(lockFile, `${process.pid} ${new Date().toISOString()}\n`);
  } catch (e: any) {
    if (String(e.message).includes('База уже используется')) throw e;
    // Не смогли поставить замок по другой причине (права и т.п.) — не
    // блокируем запуск игры из-за этого, но предупреждаем в логе
    console.warn('⚠️  Не удалось поставить замок базы:', e.message);
    lockFile = '';
  }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }     // сигнал 0 не убивает, только проверяет
  catch (e: any) { return e && e.code === 'EPERM'; }  // EPERM = процесс есть, но чужой
}

function releaseLock(): void {
  if (!lockFile) return;
  try {
    const raw = fs.readFileSync(lockFile, 'utf8').trim();
    if (Number(String(raw).split(/\s+/)[0]) === process.pid) fs.unlinkSync(lockFile);
  } catch (e) {}
  lockFile = '';
}

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function fileOf(name: string): string {
  return path.join(DATA_DIR, `${name}.json`);
}

// ---------- Инициализация ----------
// Вызывается один раз при старте сервера (до app.listen). Если задан
// MONGODB_URI — подключается и предзагружает все коллекции в кэш.
// При ошибке подключения — откатывается на локальные файлы, чтобы
// сервер всё равно запустился (а не упал из-за временной сети).
async function init(): Promise<void> {
  // ── SQLite: своя база на своём сервере ────────────────────────────
  // Включается DB_DRIVER=sqlite. Проверяется ПЕРВЫМ: если выбран этот
  // драйвер, к облаку не подключаемся вообще, даже когда MONGODB_URI
  // остался в окружении (удобно на время переезда — переменную можно
  // не удалять, а просто переключить драйвер обратно при откате).
  if (String(process.env.DB_DRIVER || '').toLowerCase() === 'sqlite') {
    try {
      sqlite = require('./sqliteStore');
      const dir = process.env.SQLITE_DIR || path.join(process.cwd(), 'data');
      acquireLock(dir);                         // один процесс на базу
      sqlite.open(dir, process.env.SQLITE_FILE || 'generals.db');
      store.users = sqlite.loadAllPlayers();
      const colls = sqlite.loadAllCollections();
      for (const k of Object.keys(colls)) store[k] = colls[k];
      mode = 'sqlite';
      const st = sqlite.stats();
      console.log(`💾 База данных: SQLite (${st.file}). Игроков: ${st.players}, прочих коллекций: ${st.collections}, журнал: ${st.walMode}, целостность: ${st.integrity}.`);
      startPeriodicFlush();
      startPeriodicBackup();
      return;
    } catch (e: any) {
      console.error('⚠️  Не удалось открыть SQLite, падаю в JSON-режим:', e.message);
      sqlite = null;
      mode = 'json';
      return;
    }
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    mode = 'json';
    acquireLock(DATA_DIR);                      // один процесс на файлы базы
    console.log('💾 База данных: локальные JSON-файлы (папка /data)');
    return;
  }
  try {
    const { MongoClient } = require('mongodb');

    // На Render SSL-стек OpenSSL конфликтует с сертификатами Atlas.
    // Решение: tlsInsecure:true — шифрование остаётся, но не проверяем
    // подлинность сертификата сервера (стандартная практика для PaaS).
    const tryConnect = async (opts: any) => {
      const client = new MongoClient(uri, opts);
      await client.connect();
      return client;
    };

    // Попытка 1: стандартное подключение
    try {
      mongoClient = await tryConnect({ serverSelectionTimeoutMS: 10000 });
    } catch (e1: any) {
      console.warn('Попытка 1 (стандарт):', String(e1.message).slice(0, 100));
      // Попытка 2: явный TLS без строгой проверки сертификата
      mongoClient = await tryConnect({
        serverSelectionTimeoutMS: 10000,
        tlsInsecure: true,
      });
    }
    await mongoClient.connect();
    const dbName = process.env.MONGODB_DB || 'generals';
    const database = mongoClient.db(dbName);
    usersColl = database.collection('users');
    collColl = database.collection('collections');

    // Аудит-лог: отдельная capped-коллекция (FIFO, авто-вытеснение старых
    // записей). Одна запись = один документ → вставка стоит ~200 байт вместо
    // перезаписи всего массива при каждом действии (это и был источник
    // терабайтного трафика к Atlas).
    try {
      await database.createCollection('actionLogs', { capped: true, size: 64 * 1024 * 1024, max: 50000 });
    } catch (e) { /* уже существует — ок */ }
    logsColl = database.collection('actionLogs');
    try { await logsColl.createIndex({ userId: 1, at: -1 }); } catch (e) {}

    // Предзагрузка игроков: каждый — отдельный документ
    const userDocs = await usersColl.find({}).toArray();
    const usersObj: Record<string, any> = {};
    for (const doc of userDocs) {
      const { _id, ...rest } = doc;
      usersObj[_id] = { ...rest, id: _id };
    }
    store.users = usersObj;

    // Предзагрузка остальных коллекций: один документ = одна коллекция
    const collDocs = await collColl.find({}).toArray();
    for (const doc of collDocs) {
      store[doc._id] = doc.data;
    }

    mode = 'mongo';
    console.log(`💾 База данных: MongoDB (${dbName}). Игроков загружено: ${userDocs.length}, прочих коллекций: ${collDocs.length}.`);
    startPeriodicFlush();
  } catch (e: any) {
    console.error('⚠️  Не удалось подключиться к MongoDB, использую локальные JSON-файлы:', e.message);
    mongoClient = null;
    mode = 'json';
  }
}

// ---------- Чтение ----------
// Возвращает коллекцию из кэша. Если коллекции нет ни в кэше, ни на
// диске/в базе — создаёт её со значением def (например, {} или []).
function load<T = any>(name: string, def?: T): T {
  // null считаем «сброшенным» — позволяет переинициализировать коллекцию
  if (store[name] !== undefined && store[name] !== null) return store[name];

  if (mode === 'mongo') {
    store[name] = (def !== undefined ? def : {});
    return store[name];
  }

  // Режим json: читаем файл с диска
  ensureDir();
  try {
    const parsed = JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
    store[name] = (parsed !== null ? parsed : (def !== undefined ? def : {}));
  } catch (e) {
    store[name] = (def !== undefined ? def : {});
  }
  return store[name];
}

// ---------- Запись (отложенная) ----------
// Помечает коллекцию «грязной» и планирует сохранение через 400 мс.
// Несколько вызовов save() подряд склеиваются в одну запись.
//
// ВАЖНО про users: вызов save('users') помечает «сохранить ВСЕХ игроков».
// Это дорого при большом числе игроков. Для точечного сохранения одного
// игрока используйте markUser(id) — он запишет только одного.
function save(name: string): void {
  if (store[name] === undefined) return;
  if (name === 'users') {
    // Полное сохранение всех игроков нужно редко (миграции, массовые
    // изменения). Обычные действия должны звать markUser(id).
    allUsersDirty = true;
    scheduleFlush();
    return;
  }
  dirty.add(name);
  scheduleFlush();
}

// ═══ УДАЛЕНИЕ ИГРОКА ИЗ БАЗЫ ════════════════════════════════════════
// КРИТИЧНО: flushUsers умеет только replaceOne по существующим id, то есть
// НИКОГДА не удаляет документы. Раньше admin.deleteAccount делал только
// `delete players[id]` — в JSON-режиме этого хватало (файл перезаписывается
// целиком), а в mongo документ оставался в базе, и после рестарта процесса
// db.load() поднимал удалённого игрока обратно. Отсюда «воскресшие»
// аккаунты и одинаковые позывные на нескольких местах в рейтинге: игрок
// освобождал имя, регистрировался заново, и в базе оказывались два
// документа с разными _id и одним именем.
function dropUser(id: string): void {
  if (mode === 'sqlite') {
    const players = store.users || {};
    delete players[id];
    dirtyUsers.delete(id);
    try { sqlite.deletePlayer(id); } catch (e) { console.error('SQLite: не удалось удалить игрока', id, e); }
    return;
  }
  if (!id) return;
  const usersObj = store.users || {};
  delete usersObj[id];
  dirtyUsers.delete(id);
  if (mode === 'mongo' && usersColl) {
    usersColl.deleteOne({ _id: id }).catch((e: any) => {
      console.error('❌ Не удалось удалить документ игрока из mongo:', id, e && e.message);
    });
  } else {
    allUsersDirty = true;
    scheduleFlush();
  }
}

// Диагностика: игроки с одинаковыми позывными или email — следствие старой
// ошибки удаления. Возвращает группы, чтобы владелец решил, кого убрать.
function findDuplicateUsers(): any {
  const usersObj: Record<string, any> = store.users || {};
  const byName: Record<string, any[]> = {};
  const byEmail: Record<string, any[]> = {};
  for (const id of Object.keys(usersObj)) {
    const p = usersObj[id];
    if (!p || p.isBot) continue;
    const nameKey = String(p.name || '').trim().toLowerCase();
    const mailKey = String(p.email || '').trim().toLowerCase();
    const info = {
      id, name: p.name, email: p.email, level: p.level,
      createdAt: p.createdAt || 0, lastSeen: p.lastSeen || 0,
      ears: p.ears || 0,
      weeklyEars: (p.weekly && p.weekly.ears) || 0,
      hasSeasonWeekly: !!(p.weekly && p.weekly.weekId),
    };
    if (nameKey) (byName[nameKey] = byName[nameKey] || []).push(info);
    if (mailKey) (byEmail[mailKey] = byEmail[mailKey] || []).push(info);
  }
  const dupNames = Object.keys(byName).filter((k) => byName[k].length > 1).map((k) => ({ key: k, accounts: byName[k] }));
  const dupEmails = Object.keys(byEmail).filter((k) => byEmail[k].length > 1).map((k) => ({ key: k, accounts: byEmail[k] }));
  const usersArr: any[] = Object.values(usersObj);
  return {
    total: usersArr.length,
    dupNames, dupEmails,
    noSeasonWeekly: usersArr.filter((p: any) => p && !p.isBot && !(p.weekly && p.weekly.weekId)).length,
  };
}

// Точечно пометить одного игрока на сохранение (дёшево при 1000+ игроков).
function markUser(id: string): void {
  if (!id) return;
  dirtyUsers.add(id);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    flush().catch((e: any) => console.error('Ошибка фонового сохранения:', e.message));
  }, 400);
}

// Записать одну «прочую» коллекцию (не users) в backend
async function flushOne(name: string): Promise<void> {
  if (mode === 'sqlite') {
    sqlite.writeBatch([], [{ id: name, obj: store[name] }]);
    return;
  }
  if (mode === 'mongo') {
    await collColl.updateOne({ _id: name }, { $set: { data: store[name] } }, { upsert: true });
  } else {
    ensureDir();
    fs.writeFileSync(fileOf(name), JSON.stringify(store[name]));
  }
}

// Записать игроков. Если allUserIds=true — пишем всех (миграции),
// иначе только тех, кто помечен через markUser (обычный случай).
async function flushUsers(allUserIds: boolean): Promise<void> {
  const usersObj = store.users || {};
  if (mode === 'sqlite') {
    // Точечно: только те игроки, что менялись (или все — при миграциях).
    // Всё уходит одной транзакцией внутри writeBatch.
    const ids = allUserIds ? Object.keys(usersObj) : Array.from(dirtyUsers);
    if (!ids.length) return;
    sqlite.writeBatch(ids.filter((id) => usersObj[id]).map((id) => ({ id, obj: usersObj[id] })), []);
    return;
  }
  if (mode === 'mongo') {
    const ids = allUserIds ? Object.keys(usersObj) : Array.from(dirtyUsers);
    if (ids.length === 0) return;
    const ops = ids
      .filter((id) => usersObj[id])
      .map((id) => ({
        replaceOne: { filter: { _id: id }, replacement: { ...usersObj[id], _id: id }, upsert: true },
      }));
    if (ops.length) await usersColl.bulkWrite(ops, { ordered: false });
  } else {
    // JSON-режим: пишем весь файл (один файл на коллекцию). Дёшево до
    // ~неск. тысяч игроков; в проде всё равно используется mongo.
    ensureDir();
    fs.writeFileSync(fileOf('users'), JSON.stringify(usersObj));
  }
}

// Сбросить все «грязные» коллекции на диск/в базу
async function flush(): Promise<void> {
  saveTimer = null;
  const names = Array.from(dirty);
  dirty.clear();

  // Игроки — отдельной веткой (точечно или все)
  const needAllUsers = allUsersDirty;
  const hadDirtyUsers = dirtyUsers.size > 0 || needAllUsers;
  allUsersDirty = false;
  const userIds = Array.from(dirtyUsers);
  dirtyUsers.clear();

  for (const name of names) {
    try {
      await flushOne(name);
    } catch (e: any) {
      console.error(`Не удалось сохранить «${name}»:`, e.message);
      dirty.add(name);
      scheduleFlush();
    }
  }

  if (hadDirtyUsers) {
    try {
      await flushUsers(needAllUsers);
    } catch (e: any) {
      console.error('Не удалось сохранить игроков:', e.message);
      // Возвращаем id обратно в очередь
      if (needAllUsers) allUsersDirty = true;
      else userIds.forEach((id) => dirtyUsers.add(id));
      scheduleFlush();
    }
  }
}

// Пометить все «прочие» загруженные коллекции на сохранение.
// НЕ трогает users — игроки сохраняются точечно через markUser(id),
// чтобы не писать тысячи документов после каждого запроса.
function saveAll(): void {
  Object.keys(store).forEach((name) => {
    // users сохраняются точечно (markUser); actionLogs — append-only коллекция
    if (name !== 'users' && name !== 'actionLogs') save(name);
  });
}

// Периодическая подстраховка: раз в 30 с сбрасываем ИЗМЕНЁННЫЕ прочие
// коллекции. Раньше saveAll() звался после КАЖДОГО POST и переписывал все
// коллекции целиком в Atlas — это давало терабайты трафика. Теперь per-request
// saveAll убран; точечные save()/markUser() пишут сразу, а этот таймер — лишь
// страховка от мутаций без явного save (не чаще 2 раз/мин).
// ── Автобэкап: целостная копия файла базы по расписанию ───────────
// VACUUM INTO работает на живой базе, игру останавливать не нужно.
// Копии лежат в data/backups с ротацией; частота — BACKUP_HOURS
// (по умолчанию каждые 6 часов), число копий — BACKUP_KEEP.
function startPeriodicBackup(): void {
  if (mode !== 'sqlite' || backupTimer) return;
  const hours = Math.max(1, Number(process.env.BACKUP_HOURS || 6));
  const keep = Math.max(2, Number(process.env.BACKUP_KEEP || 14));
  backupTimer = setInterval(() => {
    try { console.log(`🗄  Бэкап базы: ${sqlite.backup('auto', keep)}`); }
    catch (e: any) { console.error('⚠️  Бэкап не удался:', e.message); }
  }, hours * 3600 * 1000);
  if (backupTimer.unref) backupTimer.unref();
}

// Копия базы прямо сейчас (админка, перед миграцией). Возвращает путь.
function backupNow(label = 'manual'): string | null {
  if (mode !== 'sqlite') return null;
  return sqlite.backup(label, Number(process.env.BACKUP_KEEP || 14));
}

// Снимок ОДНОЙ коллекции перед рискованной операцией. Дешевле полного
// бэкапа, поэтому вызывается автоматически — например, перед сбросом
// недельного сезона: если что-то пойдёт не так, метрики можно вернуть.
function snapshotCollection(name: string, label: string): boolean {
  if (mode !== 'sqlite' || store[name] === undefined) return false;
  try { sqlite.snapshot(name, store[name], label); return true; } catch (e) { return false; }
}

function snapshotsList(name?: string, limit = 20): any[] {
  if (mode !== 'sqlite') return [];
  try { return sqlite.snapshotList(name, limit); } catch (e) { return []; }
}

// Восстановить коллекцию из снимка. Игроков не трогает — только
// коллекции (сезон, мир, санкции), чтобы случайно не откатить прогресс.
function snapshotRestore(seq: number, name: string): boolean {
  if (mode !== 'sqlite' || name === 'users') return false;
  const data = sqlite.snapshotGet(seq);
  if (data === null) return false;
  store[name] = data;
  save(name);
  return true;
}

// SQL для аналитики: топы и статистика без перебора всех игроков в памяти
function sql(query: string, params: any[] = []): any[] {
  if (mode !== 'sqlite') return [];
  try { return sqlite.query(query, params); }
  catch (e: any) { console.error('SQL ошибка:', e.message); return []; }
}

// Закрыть базу перед выходом: чекпойнт WAL + закрытие файла. Вызывается
// из shutdown, чтобы после остановки сервера база лежала одним файлом,
// пригодным для копирования.
function closeDb(): void {
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
  if (mode === 'sqlite' && sqlite) { try { sqlite.close(); } catch (e) {} }
  releaseLock();
}

// Список имеющихся копий базы — для админки
function backupsList(): any[] {
  if (mode !== 'sqlite') return [];
  try {
    const dir = path.join(process.env.SQLITE_DIR || path.join(process.cwd(), 'data'), 'backups');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.db') || f.endsWith('.db.gz'))
      .map((f) => { const st = fs.statSync(path.join(dir, f)); return { file: f, size: st.size, at: st.mtimeMs }; })
      .sort((a, b) => b.at - a.at)
      .slice(0, 40);
  } catch (e) { return []; }
}

function dbStats(): any {
  if (mode !== 'sqlite') return { driver: mode };
  return { driver: 'sqlite', ...sqlite.stats() };
}

function startPeriodicFlush(): void {
  if (periodicTimer) return;
  periodicTimer = setInterval(() => {
    try { saveAll(); } catch (e) {}
  }, 30000);
  if (periodicTimer.unref) periodicTimer.unref();
}

// ── Аудит-лог: append-only (одна запись = один документ) ───────────
// В mongo — вставка в capped-коллекцию (быстро, ~200 байт, авто-вытеснение).
// В json — дописываем в массив в кэше и лениво пишем файл (локальная разработка).
function appendLog(entry: any): void {
  if (mode === 'sqlite') { try { sqlite.appendLog(entry); } catch (e) {} return; }
  if (mode === 'mongo') {
    if (logsColl) logsColl.insertOne(entry).catch((e: any) => console.error('Ошибка записи лога:', e.message));
    return;
  }
  const arr = load<any[]>('actionLogs', []);
  arr.push(entry);
  if (arr.length > 20000) arr.splice(0, arr.length - 20000);
  save('actionLogs');
}

// Последние N записей лога (опционально по игроку). Async — читает из БД.
async function tailLogs(limit: number, userId?: string): Promise<any[]> {
  if (mode === 'sqlite') { try { return sqlite.tailLogs(limit, userId); } catch (e) { return []; } }
  const n = Math.max(1, Math.min(1000, limit || 200));
  if (mode === 'mongo') {
    if (!logsColl) return [];
    const q = userId ? { userId } : {};
    const docs = await logsColl.find(q).sort({ at: -1 }).limit(n).toArray();
    return docs.map((d: any) => { const { _id, ...rest } = d; return rest; });
  }
  const arr = load<any[]>('actionLogs', []) as any[];
  const filtered = userId ? arr.filter((e) => e.userId === userId) : arr;
  return filtered.slice(-n).reverse();
}

// Немедленное сохранение всего и аккуратное закрытие соединения —
// используется при остановке сервера (SIGINT/SIGTERM).
async function flushAllNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  dirty.clear();
  dirtyUsers.clear();
  allUsersDirty = false;
  for (const name of Object.keys(store)) {
    if (name === 'users') continue;
    try {
      await flushOne(name);
    } catch (e: any) {
      console.error(`Не удалось сохранить «${name}» при выходе:`, e.message);
    }
  }
  // Всех игроков — гарантированно при выходе
  try {
    await flushUsers(true);
  } catch (e: any) {
    console.error('Не удалось сохранить игроков при выходе:', e.message);
  }
  if (mongoClient) {
    await mongoClient.close();
  }
}

export = {
  init, load, save, markUser, saveAll, flushAllNow, appendLog, tailLogs, DATA_DIR,
  dropUser, findDuplicateUsers,
  // Своя база: защита данных и аналитика
  backupNow, backupsList, snapshotCollection, snapshotsList, snapshotRestore, sql, dbStats, closeDb,
  get mode() { return mode; },
};
