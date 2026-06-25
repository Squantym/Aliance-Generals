// ===================================================================
// src/core/compress.ts — сжатие ответов и кэш статики
//
// Зачем: текстовые файлы (JS/CSS/HTML/JSON) сжимаются brotli/gzip на
// 70–85%. Это главный способ экономии трафика. Плюс мы кешируем уже
// сжатые версии статики в памяти, чтобы не жать один и тот же файл
// на каждый запрос (жмём один раз, отдаём тысячам игроков).
//
// Алгоритм выбора:
//   - Если браузер поддерживает brotli (br) — отдаём brotli (лучше жмёт)
//   - Иначе gzip (поддерживают все браузеры)
//   - Иначе (очень старый клиент) — без сжатия
//
// Картинки (webp/png/jpg) повторно НЕ сжимаются — они уже сжаты, от
// brotli/gzip они только увеличатся. Для них работает кэш заголовков.
// ===================================================================

import zlib = require('zlib');

type Encoding = 'br' | 'gzip' | null;

interface CacheEntry {
  buf: Buffer;
  etag: string;
  mtimeMs: number;
}

// Типы, которые имеет смысл сжимать (текстовые/структурированные).
const COMPRESSIBLE = new Set<string>([
  'text/html', 'text/css', 'text/plain',
  'application/javascript', 'application/json',
  'image/svg+xml',
]);

// Минимальный размер для сжатия. Очень маленькие ответы сжимать
// бессмысленно — накладные расходы заголовков съедают выигрыш.
const MIN_SIZE = 256;

// Настройки качества. Для статики (кешируется) используем максимум,
// для динамики (API) — баланс скорости и степени сжатия.
const BROTLI_STATIC = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,         // максимум
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: 0,
  },
};
const BROTLI_DYNAMIC = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 5,          // быстрее для API
  },
};
const GZIP_STATIC = { level: 9 };
const GZIP_DYNAMIC = { level: 6 };

// Определяем какой алгоритм поддерживает клиент.
function pickEncoding(acceptEncoding: string | undefined): Encoding {
  const ae = String(acceptEncoding || '').toLowerCase();
  if (ae.includes('br')) return 'br';
  if (ae.includes('gzip')) return 'gzip';
  return null;
}

// Сжать буфер выбранным алгоритмом.
function compress(buf: Buffer, encoding: Encoding, isStatic: boolean): Buffer {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buf, isStatic ? BROTLI_STATIC : BROTLI_DYNAMIC);
  }
  if (encoding === 'gzip') {
    return zlib.gzipSync(buf, isStatic ? GZIP_STATIC : GZIP_DYNAMIC);
  }
  return buf;
}

// Стоит ли сжимать этот content-type?
function shouldCompress(contentType: string | undefined, size: number): boolean {
  if (size < MIN_SIZE) return false;
  const base = String(contentType || '').split(';')[0].trim();
  return COMPRESSIBLE.has(base);
}

// ── Кэш сжатой статики в памяти ───────────────────────────────────
// Ключ: relPath + '|' + encoding. Значение: { buf, etag, mtimeMs }
// Жмём файл один раз, держим в памяти все варианты (br/gzip/raw).
const staticCache = new Map<string, CacheEntry>();

function cacheKey(relPath: string, encoding: Encoding | 'raw'): string {
  return relPath + '|' + (encoding || 'raw');
}

function getCached(relPath: string, encoding: Encoding | 'raw', mtimeMs: number): CacheEntry | null {
  const entry = staticCache.get(cacheKey(relPath, encoding));
  if (entry && entry.mtimeMs === mtimeMs) return entry;
  return null;
}

function setCached(relPath: string, encoding: Encoding | 'raw', mtimeMs: number, buf: Buffer, etag: string): void {
  staticCache.set(cacheKey(relPath, encoding), { buf, etag, mtimeMs });
}

export = {
  pickEncoding, compress, shouldCompress,
  getCached, setCached,
  COMPRESSIBLE,
};
