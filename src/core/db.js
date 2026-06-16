// ===================================================================
// src/core/db.js — простейшая база данных на JSON-файлах
// Каждая «коллекция» (users, world, mail, ...) — это один файл в /data.
// Чтение происходит один раз при старте, запись — отложенно (debounce),
// чтобы не дёргать диск на каждый чих.
// ===================================================================

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// Кэш коллекций в памяти и таймеры отложенной записи
const store = {};
const timers = {};

// Убеждаемся, что каталог данных существует
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileOf(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

// Загрузить коллекцию (или вернуть значение по умолчанию, если файла нет)
function load(name, def) {
  if (store[name] !== undefined) return store[name];
  ensureDir();
  try {
    store[name] = JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
  } catch (e) {
    store[name] = def;
  }
  return store[name];
}

// Записать коллекцию на диск с задержкой 400 мс (несколько подряд
// изменений склеиваются в одну запись)
function save(name) {
  if (store[name] === undefined) return;
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => {
    try {
      ensureDir();
      fs.writeFileSync(fileOf(name), JSON.stringify(store[name]));
    } catch (e) {
      console.error(`Не удалось сохранить ${name}:`, e.message);
    }
  }, 400);
}

// Пометить все загруженные коллекции на сохранение
function saveAll() {
  Object.keys(store).forEach(save);
}

// Немедленная синхронная запись всего (используется при выключении)
function saveAllSync() {
  ensureDir();
  for (const name of Object.keys(store)) {
    clearTimeout(timers[name]);
    try {
      fs.writeFileSync(fileOf(name), JSON.stringify(store[name]));
    } catch (e) {
      console.error(`Не удалось сохранить ${name}:`, e.message);
    }
  }
}

module.exports = { load, save, saveAll, saveAllSync, DATA_DIR };
