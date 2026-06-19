// ===================================================================
// src/core/staticCache.js — кеш статики в памяти + сжатие + ETag
//
// Цель: радикально снизить исходящий трафик.
// Делается ОДИН РАЗ при старте сервера:
//   1. Все файлы из /public читаются в память.
//   2. Считается sha256-хеш содержимого (первые 10 символов).
//   3. Для CSS/JS — генерируется «фингерпринтованное» имя:
//        /js/app.js → /js/app.<хеш>.js
//      Такие ссылки можно отдавать с Cache-Control: immutable на год —
//      браузер вообще не будет ходить за ними повторно. При изменении
//      файла хеш меняется → URL меняется → автоматически качает новое.
//   4. HTML-файлы (index.html, admin.html) переписываются: ссылки на
//      /js/*.js и /css/*.css заменяются на их фингерпринтованные
//      варианты. Сами HTML отдаются без хеша в имени, но с ETag.
//   5. Для текстовых типов рядом с raw-буфером кладутся gzip- и
//      brotli-версии (сжимается один раз, отдаётся миллион раз).
//
// Также экспортирует helper compressBody() для сжатия JSON-ответов API
// на лету (с теми же gzip/brotli по Accept-Encoding).
// ===================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// Типы содержимого
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.txt':   'text/plain; charset=utf-8',
  '.map':   'application/json; charset=utf-8',
};

// Какие типы сжимать (gzip/brotli). Картинки и шрифты уже сжаты.
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.map']);

// Какие типы хешируем в имя файла. HTML не хешируем — на него ссылаются
// по корневому URL «/», менять URL нельзя.
const HASHABLE = new Set(['.css', '.js']);

// Минимальный размер для сжатия API-ответов: всё, что меньше — отдаём как есть.
// Под порогом профит от сжатия меньше, чем расход CPU и накладные заголовки.
const COMPRESS_MIN_BYTES = 1024;

const byPath = new Map();        // '/css/style.css' -> entry
const byHashedPath = new Map();  // '/css/style.<hash>.css' -> entry (та же ссылка)

function walk(dir, base = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base + '/' + name;
    let st;
    try { st = fs.statSync(full); } catch (e) { continue; }
    if (st.isDirectory()) {
      out.push(...walk(full, rel));
    } else if (st.isFile()) {
      out.push({ rel, full, ext: path.extname(name).toLowerCase() });
    }
  }
  return out;
}

function hashOf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

// brotli даёт ~20% лучше gzip для текста, но дороже по CPU.
// Делаем при старте — поэтому ставим максимальное качество.
function compressEntry(entry, ext) {
  if (!COMPRESSIBLE.has(ext) || !entry.buffer || entry.buffer.length < 200) return;
  try {
    entry.br = zlib.brotliCompressSync(entry.buffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    });
  } catch (e) { /* нет brotli — игнор */ }
  try {
    entry.gzip = zlib.gzipSync(entry.buffer, { level: 9 });
  } catch (e) { /* почти невозможно */ }
}

function makeEntry(buffer, ext) {
  return {
    buffer,
    etag: '"' + hashOf(buffer) + '"',
    contentType: MIME[ext] || 'application/octet-stream',
    ext,
    gzip: null,
    br: null,
    hashed: false,        // true, если для этого файла существует /a/b/file.<hash>.ext
    hashedUrl: null,      // фактический URL с хешем
  };
}

// Замена ссылок в HTML на фингерпринтованные URL.
// Ловим формы: src="/path/to/file.js", href='/path/to/style.css'
// и без кавычек тоже на всякий случай: src=/path/file.js
const HTML_LINK_RE = /\b(?:src|href)\s*=\s*(?:"([^"]+\.(?:css|js))"|'([^']+\.(?:css|js))'|([^\s>]+\.(?:css|js)))/gi;

function rewriteHtmlLinks(html) {
  return html.replace(HTML_LINK_RE, (full, q1, q2, q3) => {
    const url = q1 || q2 || q3;
    if (!url || !url.startsWith('/')) return full;
    const e = byPath.get(url);
    if (!e || !e.hashedUrl) return full;
    // Сохраняем оригинальную форму атрибута (с такими же кавычками)
    return full.replace(url, e.hashedUrl);
  });
}

// Загрузить всю статику в память. Вызывается один раз при старте сервера.
function init() {
  byPath.clear();
  byHashedPath.clear();

  const files = walk(PUBLIC_DIR);

  // PASS 1: всё кроме HTML — даём хеши для CSS/JS
  for (const f of files) {
    if (f.ext === '.html') continue;
    let buf;
    try { buf = fs.readFileSync(f.full); } catch (e) { continue; }
    const entry = makeEntry(buf, f.ext);
    compressEntry(entry, f.ext);
    byPath.set(f.rel, entry);

    if (HASHABLE.has(f.ext)) {
      const hash = hashOf(buf);
      // file.ext → file.<hash>.ext (хеш ВПЛЕТАЕТСЯ в имя, а не в query —
      // некоторые CDN/прокси игнорируют query при кешировании)
      const hashedUrl = f.rel.replace(/(\.[a-z0-9]+)$/i, `.${hash}$1`);
      entry.hashed = true;
      entry.hashedUrl = hashedUrl;
      byHashedPath.set(hashedUrl, entry);
    }
  }

  // PASS 2: HTML — переписываем ссылки на фингерпринтованные URL,
  // потом сжимаем итоговый текст.
  for (const f of files) {
    if (f.ext !== '.html') continue;
    let raw;
    try { raw = fs.readFileSync(f.full, 'utf8'); } catch (e) { continue; }
    const rewritten = rewriteHtmlLinks(raw);
    const buf = Buffer.from(rewritten, 'utf8');
    const entry = makeEntry(buf, f.ext);
    compressEntry(entry, f.ext);
    byPath.set(f.rel, entry);
  }

  // Краткая сводка для лога
  let total = 0, gz = 0, br = 0, hashed = 0;
  for (const e of byPath.values()) {
    total += e.buffer.length;
    if (e.gzip) gz += e.gzip.length;
    if (e.br)   br += e.br.length;
    if (e.hashed) hashed++;
  }
  return {
    files: byPath.size,
    hashed,
    rawBytes: total,
    gzipBytes: gz,
    brBytes: br,
  };
}

// Поиск файла по URL-пути. Возвращает { entry, hashed } | null.
function lookup(urlPath) {
  if (byHashedPath.has(urlPath)) {
    return { entry: byHashedPath.get(urlPath), hashed: true };
  }
  if (byPath.has(urlPath)) {
    return { entry: byPath.get(urlPath), hashed: false };
  }
  return null;
}

// Выбор кодировки по Accept-Encoding. Возвращает 'br' | 'gzip' | null.
function pickEncoding(acceptEncoding) {
  const ae = String(acceptEncoding || '').toLowerCase();
  if (!ae) return null;
  // Простой парсер: проверяем приоритет br > gzip
  // (не учитываем q-значения, в реальной жизни этого хватает)
  const hasBr = /\bbr\b/.test(ae);
  const hasGz = /\bgzip\b/.test(ae);
  if (hasBr) return 'br';
  if (hasGz) return 'gzip';
  return null;
}

// ---------- Сжатие произвольного тела (для API-ответов) ----------
// Возвращает { body: Buffer|string, encoding: 'br'|'gzip'|null }
// body всегда — то, что писать в res.end(). encoding === null значит «без сжатия».
function compressBody(rawString, acceptEncoding) {
  // Маленькие ответы не сжимаем
  if (!rawString || rawString.length < COMPRESS_MIN_BYTES) {
    return { body: rawString, encoding: null };
  }
  const enc = pickEncoding(acceptEncoding);
  if (!enc) return { body: rawString, encoding: null };
  const src = Buffer.isBuffer(rawString) ? rawString : Buffer.from(rawString, 'utf8');
  try {
    if (enc === 'br') {
      // Качество 4 — хороший компромисс CPU/ratio для on-the-fly
      const out = zlib.brotliCompressSync(src, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
      });
      return { body: out, encoding: 'br' };
    }
    return { body: zlib.gzipSync(src, { level: 6 }), encoding: 'gzip' };
  } catch (e) {
    return { body: rawString, encoding: null };
  }
}

module.exports = {
  init, lookup, pickEncoding, compressBody, PUBLIC_DIR,
  // для тестов/диагностики
  _byPath: byPath,
  _byHashedPath: byHashedPath,
};
