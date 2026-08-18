// ===================================================================
// src/services/totp.ts — второй фактор для сотрудников
//
// ЗАЧЕМ. Пароль сотрудника — единственная преграда между посторонним и
// полным доступом к игре: выдача ресурсов, бан, обнуление, база. В этом
// проекте один пароль уже утекал (MongoDB), и это не редкость, а
// нормальный ход событий: пароли повторяют, забывают в переписке,
// теряют вместе с телефоном. Второй фактор превращает «узнал пароль»
// в «узнал пароль И держит в руках телефон сотрудника».
//
// ПОЧЕМУ СВОЙ КОД, А НЕ БИБЛИОТЕКА. Весь алгоритм — это HMAC-SHA1 от
// счётчика времени плюс усечение по RFC 4226/6238, тридцать строк на
// node:crypto. Тянуть ради этого зависимость с её обновлениями,
// уязвимостями и рисками подмены пакета — плохая сделка.
//
// СОВМЕСТИМОСТЬ. Обычный TOTP: 6 цифр, шаг 30 секунд, SHA-1 — то, что
// умеют Google Authenticator, Authy, Яндекс.Ключ, 1Password и прочие.
// Ничего специфичного для проекта здесь нет и быть не должно: сотрудник
// пользуется тем приложением, которое у него уже стоит.
// ===================================================================

import crypto = require('crypto');

const DIGITS = 6;
const STEP_SEC = 30;
// Допуск на расхождение часов: ±1 шаг. Больше брать нельзя — каждый
// лишний шаг увеличивает окно, в котором подсмотренный код ещё годен.
const DRIFT_STEPS = 1;

// ── Base32 (RFC 4648) — в этом виде ключ читают приложения ─────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── Собственно TOTP ───────────────────────────────────────────────
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // Счётчик 64-битный; старшие 32 бита нулевые до 2106 года.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16)
            | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

function codeAt(secretB32: string, atMs?: number): string {
  const counter = Math.floor((atMs === undefined ? Date.now() : atMs) / 1000 / STEP_SEC);
  return hotp(base32Decode(secretB32), counter);
}

// Проверка кода с допуском на расхождение часов.
// Сравнение — ПОСТОЯННОГО ВРЕМЕНИ: обычное === для секретов утекает
// информацию через время сравнения. Здесь это скорее принцип, чем
// практическая угроза, но принцип дешёвый.
function verify(secretB32: string, code: string, atMs?: number): boolean {
  const given = String(code || '').replace(/\D/g, '');
  if (given.length !== DIGITS) return false;
  const now = atMs === undefined ? Date.now() : atMs;
  for (let d = -DRIFT_STEPS; d <= DRIFT_STEPS; d++) {
    const expected = codeAt(secretB32, now + d * STEP_SEC * 1000);
    const a = Buffer.from(expected), b = Buffer.from(given);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

// Новый секрет: 20 случайных байт — размер, рекомендованный RFC 4226.
function newSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

// Ссылка для QR-кода. Приложение читает её и заводит запись само.
// issuer виден в списке кодов — без него у сотрудника с несколькими
// играми будет три записи «Комдив» без подписи.
function otpauthUrl(secretB32: string, accountName: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = [
    'secret=' + secretB32,
    'issuer=' + encodeURIComponent(issuer),
    'algorithm=SHA1', 'digits=' + DIGITS, 'period=' + STEP_SEC,
  ].join('&');
  return `otpauth://totp/${label}?${params}`;
}

// ── Коды восстановления ───────────────────────────────────────────
// Телефон теряют, ломают и меняют. Без запасного пути потеря телефона
// означала бы потерю доступа к собственной игре — и владелец, вместо
// того чтобы включить защиту, просто её не включит.
//
// Храним ХЕШИ, а не сами коды: база с копиями уезжает наружу, и список
// одноразовых паролей в ней сводил бы весь второй фактор на нет.
function newRecoveryCodes(count = 8): { plain: string[]; hashed: string[] } {
  const plain: string[] = [];
  for (let i = 0; i < count; i++) {
    // 10 символов группами по 5 — читаемо и достаточно на один раз.
    const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10);
    plain.push(raw.slice(0, 5) + '-' + raw.slice(5));
  }
  return { plain, hashed: plain.map(hashRecovery) };
}

function hashRecovery(code: string): string {
  const norm = String(code || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  return crypto.createHash('sha256').update(norm).digest('hex');
}

// Проверяет код восстановления и ВЫЧЁРКИВАЕТ его из списка: одноразовый
// код, оставшийся годным, — это просто второй пароль.
function useRecovery(hashedList: string[], code: string): { ok: boolean; left: string[] } {
  const want = hashRecovery(code);
  const idx = (hashedList || []).indexOf(want);
  if (idx < 0) return { ok: false, left: hashedList || [] };
  const left = (hashedList || []).slice();
  left.splice(idx, 1);
  return { ok: true, left };
}

export = {
  newSecret, codeAt, verify, otpauthUrl,
  newRecoveryCodes, hashRecovery, useRecovery,
  base32Encode, base32Decode,
  DIGITS, STEP_SEC, DRIFT_STEPS,
};
