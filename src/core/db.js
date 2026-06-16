// ===================================================================
// src/core/db.js — гибридная база данных
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
// сервисы (player.js, battle.js и т.д.) не нужно переписывать. Запись
// в реальную базу происходит асинхронно «под капотом» через debounce.
// ===================================================================

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// Кэш коллекций в памяти (как и раньше) — отсюда всё читается синхронно
const store = {};
const dirty = new Set();
let saveTimer = null;

// Режим работы: 'json' (по умолчанию) или 'mongo'
let mode = 'json';
let mongoClient = null;
let usersColl = null; // коллекция игроков: один документ = один игрок
let collColl = null;  // коллекция «прочих» данных: один документ = одна коллекция

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function fileOf(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

// ---------- Инициализация ----------
// Вызывается один раз при старте сервера (до app.listen). Если задан
// MONGODB_URI — подключается и предзагружает все коллекции в кэш.
// При ошибке подключения — откатывается на локальные файлы, чтобы
// сервер всё равно запустился (а не упал из-за временной сети).
async function init() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    mode = 'json';
    console.log('💾 База данных: локальные JSON-файлы (папка /data)');
    return;
  }
  try {
    // require внутри функции: если пакет mongodb не установлен, но
    // MONGODB_URI и не задан — этот код вообще не выполнится.
    const { MongoClient } = require('mongodb');

    // Пробуем подключиться. На некоторых хостингах (Render и т.п.)
    // стандартные TLS-настройки могут давать SSL-ошибку из-за особенностей
    // OpenSSL. В этом случае пробуем с явным указанием tls=true.
    const tryConnect = async (opts) => {
      const client = new MongoClient(uri, opts);
      await client.connect();
      return client;
    };

    try {
      mongoClient = await tryConnect({ serverSelectionTimeoutMS: 8000 });
    } catch (firstErr) {
      console.warn('Первая попытка подключения к MongoDB не удалась:', firstErr.message);
      console.warn('Пробую с альтернативными TLS-настройками...');
      mongoClient = await tryConnect({
        serverSelectionTimeoutMS: 8000,
        tls: true,
        tlsAllowInvalidCertificates: true, // менее строгая проверка сертификата
      });
    }
    await mongoClient.connect();
    const dbName = process.env.MONGODB_DB || 'generals';
    const database = mongoClient.db(dbName);
    usersColl = database.collection('users');
    collColl = database.collection('collections');

    // Предзагрузка игроков: каждый — отдельный документ
    const userDocs = await usersColl.find({}).toArray();
    const usersObj = {};
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
  } catch (e) {
    console.error('⚠️  Не удалось подключиться к MongoDB, использую локальные JSON-файлы:', e.message);
    mongoClient = null;
    mode = 'json';
  }
}

// ---------- Чтение ----------
// Возвращает коллекцию из кэша. Если коллекции нет ни в кэше, ни на
// диске/в базе — создаёт её со значением def (например, {} или []).
function load(name, def) {
  if (store[name] !== undefined) return store[name];

  if (mode === 'mongo') {
    // В режиме mongo всё уже предзагружено в init(). Если коллекции
    // нет (новый проект/новая коллекция) — берём значение по умолчанию.
    store[name] = def;
    return store[name];
  }

  // Режим json: читаем файл с диска
  ensureDir();
  try {
    store[name] = JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
  } catch (e) {
    store[name] = def;
  }
  return store[name];
}

// ---------- Запись (отложенная) ----------
// Помечает коллекцию «грязной» и планирует сохранение через 400 мс.
// Несколько вызовов save() подряд склеиваются в одну запись.
function save(name) {
  if (store[name] === undefined) return;
  dirty.add(name);
  scheduleFlush();
}

function scheduleFlush() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    flush().catch((e) => console.error('Ошибка фонового сохранения:', e.message));
  }, 400);
}

// Записать одну коллекцию в текущий backend (mongo или файл)
async function flushOne(name) {
  if (mode === 'mongo') {
    if (name === 'users') {
      // Каждый игрок — отдельный документ. bulkWrite заменяет всех
      // изменившихся игроков за один сетевой запрос.
      const entries = Object.entries(store.users || {});
      if (entries.length === 0) return;
      const ops = entries.map(([id, u]) => ({
        replaceOne: { filter: { _id: id }, replacement: { ...u, _id: id }, upsert: true },
      }));
      await usersColl.bulkWrite(ops, { ordered: false });
    } else {
      await collColl.updateOne({ _id: name }, { $set: { data: store[name] } }, { upsert: true });
    }
  } else {
    ensureDir();
    fs.writeFileSync(fileOf(name), JSON.stringify(store[name]));
  }
}

// Сбросить все «грязные» коллекции на диск/в базу
async function flush() {
  saveTimer = null;
  const names = Array.from(dirty);
  dirty.clear();
  for (const name of names) {
    try {
      await flushOne(name);
    } catch (e) {
      console.error(`Не удалось сохранить «${name}»:`, e.message);
      dirty.add(name); // попробуем снова при следующем тике
      scheduleFlush();
    }
  }
}

// Пометить все загруженные коллекции на сохранение (вызывается после
// каждого запроса и фоновым тиком — лишний save() ничего не стоит,
// т.к. запись всё равно склеивается debounce'ом)
function saveAll() {
  Object.keys(store).forEach(save);
}

// Немедленное сохранение всего и аккуратное закрытие соединения —
// используется при остановке сервера (SIGINT/SIGTERM).
async function flushAllNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  dirty.clear();
  for (const name of Object.keys(store)) {
    try {
      await flushOne(name);
    } catch (e) {
      console.error(`Не удалось сохранить «${name}» при выходе:`, e.message);
    }
  }
  if (mongoClient) {
    await mongoClient.close();
  }
}

module.exports = {
  init, load, save, saveAll, flushAllNow, DATA_DIR,
  get mode() { return mode; },
};
