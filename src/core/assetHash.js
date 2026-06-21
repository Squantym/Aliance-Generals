// ===================================================================
// src/core/assetHash.js — хэширование статических файлов (cache busting)
//
// Проблема: браузер кеширует CSS/JS на сутки (см. cacheControlFor в
// http.js). Если просто обновить содержимое файла — игрок с уже
// закешированной версией не увидит изменений, пока кеш сам не истечёт.
//
// Решение: вычисляем короткий хэш от РЕАЛЬНОГО содержимого каждого
// файла и подставляем его как query-параметр в HTML (?v=хэш). Если
// файл не менялся — хэш тот же, кеш работает как обычно (экономит
// трафик). Если файл изменился — хэш другой, браузер видит «новый»
// URL и скачивает свежую версию НЕМЕДЛЕННО, игнорируя старый кеш.
//
// Хэш вычисляется один раз при первом запросе к файлу и кешируется в
// памяти процесса — повторные обращения не трогают диск.
// ===================================================================

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const cache = new Map(); // relPath -> { hash, mtimeMs }

// Короткий (8 символов) хэш md5 от содержимого файла. Возвращает null,
// если файл не найден (тогда подставлять версию в URL не нужно).
function hashOf(relPath) {
  const filePath = path.join(PUBLIC_DIR, relPath);
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    return null;
  }
  const cached = cache.get(relPath);
  // Пересчитываем хэш только если файл реально изменился (по mtime) —
  // это экономит время на каждый запрос, а не на каждое изменение файла.
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.hash;

  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
  cache.set(relPath, { hash, mtimeMs: stat.mtimeMs });
  return hash;
}

// Добавляет ?v=хэш к пути файла. Если файл не найден — возвращает путь
// как есть (без версии), чтобы не ломать страницу.
function versioned(relPath) {
  const h = hashOf(relPath);
  return h ? `${relPath}?v=${h}` : relPath;
}

module.exports = { versioned, hashOf };
