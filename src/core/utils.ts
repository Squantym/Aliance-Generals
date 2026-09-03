// ===================================================================
// src/core/utils.ts — мелкие помощники, нужные по всему проекту
//
// Стиль модулей: CommonJS (export =), как и весь проект. Полная
// совместимость с существующими .js файлами, которые делают
// `const u = require('../core/utils')`. Типы сохраняются для .ts.
// ===================================================================

import crypto = require('crypto');
import util = require('util');

// Класс ошибки, которую роутер превращает в JSON-ответ { error: ... }
class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// Случайная hex-строка нужной длины (для id и токенов)
function uid(len = 16): string {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

// Целое случайное число в диапазоне [min, max] включительно
function rnd(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Случайный элемент массива
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Перемешивание массива на месте (Фишер–Йетс)
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Зажать число в границы
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Безопасно привести значение к целому числу
function toInt(v: unknown, def = 0): number {
  // Пустая строка / пробелы / null / undefined — это «нет значения»,
  // возвращаем дефолт. Иначе Number('') === 0 молча съедал бы дефолт
  // (из-за этого пустые поля админ-форм превращались в 0).
  if (v == null || (typeof v === 'string' && v.trim() === '')) return def;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : def;
}

// ═══ ХЭШИРОВАНИЕ ПАРОЛЯ ═════════════════════════════════════════════
// scrypt намеренно медленный (~45 мс) — это защита от перебора. Но у нас
// ОДИН процесс Node на всю игру, и синхронный scryptSync останавливал
// событийный цикл целиком: пока считается хэш одного входа, ВСЕ остальные
// игроки ждут. На замерах волна из 200 входов занимала 8.1 с, и случайный
// игрок в этот момент ждал ответа до 1.9 с.
//
// Асинхронный crypto.scrypt считает то же самое, но в пуле потоков libuv:
// событийный цикл остаётся свободным и продолжает обслуживать бои, покупки
// и всё остальное. Стоимость одного хэша та же — меняется только то, что
// он больше никого не блокирует.
//
// Формат хэша не изменился (scrypt, 32 байта, та же соль) — старые пароли
// проверяются как раньше, миграция базы не нужна.
const scryptAsync = util.promisify(crypto.scrypt) as (
  password: string, salt: string, keylen: number
) => Promise<Buffer>;

async function hashPassword(password: string | number, salt: string): Promise<string> {
  const buf = await scryptAsync(String(password), salt, 32);
  return buf.toString('hex');
}

// Проверка пароля в КОНСТАНТНОЕ время (защита от тайминг-атак на сравнение
// хэшей). Обычный `a !== b` по строкам завершается на первом различии, и по
// времени ответа теоретически можно восстанавливать хэш побайтно. Сам scrypt
// медленный, но сравнение результата должно быть постоянным.
async function verifyPassword(password: string | number, salt: string, expectedHex: string): Promise<boolean> {
  let exp: Buffer;
  try { exp = Buffer.from(String(expectedHex || ''), 'hex'); } catch (e) { return false; }
  const got = await scryptAsync(String(password), salt, 32);
  if (exp.length !== got.length) return false; // разной длины — точно не совпадает
  return crypto.timingSafeEqual(got, exp);
}

// Синхронные версии — ТОЛЬКО для служебных скриптов (tools/, миграции),
// где нет событийного цикла, который можно заблокировать. В коде сервера
// использовать нельзя: остановят игру для всех игроков.
function hashPasswordSync(password: string | number, salt: string): string {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function verifyPasswordSync(password: string | number, salt: string, expectedHex: string): boolean {
  const got = crypto.scryptSync(String(password), salt, 32);
  let exp: Buffer;
  try { exp = Buffer.from(String(expectedHex || ''), 'hex'); } catch (e) { return false; }
  if (exp.length !== got.length) return false;
  return crypto.timingSafeEqual(got, exp);
}

// Форматирование числа с разделителями для текстов уведомлений
function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

// ── Игровые сутки ─────────────────────────────────────────────────
//
// Сутки в игре считаются от МОСКОВСКОЙ полуночи, а не от полуночи
// сервера. Это не мелочь: считай мы от времени машины, «новые за
// сегодня» и сброс дневных заданий скакали бы при переезде сервера или
// смене часового пояса, причём молча — цифры остались бы правдоподобными.
//
// Сдвиг задан числом, а не через часовой пояс системы, намеренно: в
// России переход на летнее время отменён, и +3 постоянны. Брать зону из
// окружения значило бы поставить игровые сутки в зависимость от
// настройки, которую никто не заметит.
//
// Правило живёт ЗДЕСЬ, потому что порознь оно уже разъехалось: тот же
// сдвиг был выписан числом в десяти файлах, и mailQuota его не получил —
// суточный лимит писем сбрасывался в 03:00 по Москве, тогда как всё
// остальное в игре — в полночь.
const MSK_OFFSET_MS = 3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

// Начало московских суток, в которые попадает момент ts (в миллисекундах)
function dayStart(ts?: number): number {
  const t = typeof ts === 'number' ? ts : Date.now();
  return Math.floor((t + MSK_OFFSET_MS) / DAY_MS) * DAY_MS - MSK_OFFSET_MS;
}

// Ключ московских суток вида «2026-09-03». Именно он лежит в счётчиках
// дневных заданий, лимитов и статистики.
function dayKey(ts?: number): string {
  const t = typeof ts === 'number' ? ts : Date.now();
  return new Date(t + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

// Ключ месяца «2026-09» — по тем же московским суткам.
function monthKey(ts?: number): string {
  return dayKey(ts).slice(0, 7);
}

// ── Годится ли адрес, чтобы считать его адресом ЧЕЛОВЕКА ──────────
//
// Отбрасываем loopback и приватные диапазоны. Нужно это в двух разных
// смыслах, и оба сходятся к одному правилу:
//
//  1. При разборе X-Forwarded-For (core/http.ts). Если прокси добавил
//     себя в цепочку, первым может оказаться внутренний адрес, а нужен
//     внешний — тот, с которого пришёл человек.
//
//  2. При поиске мультоводов (services/access.ts). Пока nginx не
//     передаёт настоящий адрес, сервер видит 127.0.0.1 у ВСЕХ, и в
//     сводку это попадало как «36 аккаунтов с одного адреса» — готовый
//     список для бана невиновных. Проверка обязана молчать, когда ей
//     нечего сказать.
//
// Правило ОДНО и живёт здесь. Раньше эти пятнадцать строк были
// записаны дважды, слово в слово: добавь кто-нибудь новый приватный
// диапазон в одном месте — второе молча осталось бы со старым.
function isPublicIp(ip: string): boolean {
  const v = String(ip || '').trim().replace(/^::ffff:/, '');
  if (!v || v === 'unknown') return false;
  if (v === '::1' || v.startsWith('127.')) return false;   // loopback
  if (/^10\./.test(v)) return false;
  if (/^192\.168\./.test(v)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return false;
  if (/^169\.254\./.test(v)) return false;                 // link-local
  if (/^f[cd]/i.test(v)) return false;                     // приватные IPv6
  return true;
}

export = {
  ApiError, uid, rnd, pick, shuffle, clamp, toInt, fmt, isPublicIp,
  MSK_OFFSET_MS, dayStart, dayKey, monthKey,
  hashPassword, verifyPassword,               // асинхронные — для кода сервера
  hashPasswordSync, verifyPasswordSync,       // синхронные — только для tools/
};
