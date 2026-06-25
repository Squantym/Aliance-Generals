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
let mode: 'json' | 'mongo' = 'json';
// mongodb-пакет грузится динамически и опционален, поэтому типы any
let mongoClient: any = null;
let usersColl: any = null; // коллекция игроков: один документ = один игрок
let collColl: any = null;  // коллекция «прочих» данных: один документ = одна коллекция

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
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    mode = 'json';
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
    if (name !== 'users') save(name);
  });
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
  init, load, save, markUser, saveAll, flushAllNow, DATA_DIR,
  get mode() { return mode; },
};
