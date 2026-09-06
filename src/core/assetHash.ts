// ===================================================================
// src/core/assetHash.ts — хэширование статических файлов (cache busting)
//
// Проблема: браузер кеширует CSS/JS на сутки (см. cacheControlFor в
// http.ts). Если просто обновить содержимое файла — игрок с уже
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

import fs = require('fs');
import crypto = require('crypto');
import path = require('path');

const PUBLIC_DIR = path.join(process.cwd(), 'public');

interface HashEntry {
  hash: string;
  mtimeMs: number;
}
const cache = new Map<string, HashEntry>(); // relPath -> { hash, mtimeMs }

// Короткий (8 символов) хэш md5 от содержимого файла. Возвращает null,
// если файл не найден (тогда подставлять версию в URL не нужно).
function hashOf(relPath: string): string | null {
  const filePath = path.join(PUBLIC_DIR, relPath);
  let stat: fs.Stats;
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
function versioned(relPath: string): string {
  const h = hashOf(relPath);
  return h ? `${relPath}?v=${h}` : relPath;
}

// ── Хэши экранов, подгружаемых по требованию ──────────────────────
//
// Экраны (public/js/screens/*.js) грузятся не тегом в HTML, а из кода:
// App._loadScreen подставляет версию сам. Раньше он брал ОДНУ версию —
// хэш app.js — и подставлял её всем экранам сразу. Из-за этого правка в
// market.js не доходила до игроков, если сам app.js не менялся: адрес
// /js/screens/market.js?v=<хэш app.js> оставался прежним, а такие адреса
// отдаются как immutable на год.
//
// Проверено по истории: за пять последних выпусков market.js менялся
// трижды, app.js — ни разу. То есть игроки, открывшие игру до них,
// остались бы на старом экране до следующего года.
//
// Поэтому отдаём странице карту «имя экрана → его собственный хэш».
function screenMap(): Record<string, string> {
  const out: Record<string, string> = {};
  const dir = path.join(PUBLIC_DIR, 'js', 'screens');
  let names: string[];
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  for (const n of names) {
    if (!n.endsWith('.js')) continue;
    const h = hashOf('/js/screens/' + n);
    if (h) out[n.slice(0, -3)] = h;
  }
  return out;
}

export = { versioned, hashOf, screenMap };
