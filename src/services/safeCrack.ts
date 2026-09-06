// ═══════════════════════════════════════════════════════════════════
// src/services/safeCrack.ts — «Сейф штаба»: ОДИН код на весь мир
//
// Раньше сейф был личной головоломкой: свой код, восемь попыток, вскрыл
// — получил. Играть это было можно, но замер показал, что решается
// всегда: 4000 партий из 4000 при осмысленном переборе.
//
// Теперь сейф общий. Код один на всех, ломают его сообща, и каждая
// попытка ЛЮБОГО игрока навсегда открывает те цифры, что оказались на
// своих местах. Наверху висит общая маска — она только заполняется и
// никогда не сбрасывается до вскрытия.
//
//     код     3 4 1 2 7 4
//     попытка 1 4 1 6 9 0   → совпали позиции 2 и 3
//     маска   * 4 1 * * *
//
// Что здесь важно и почему сделано именно так:
//
//  1. МАСКА НАКАПЛИВАЕТСЯ. Открытая цифра больше не закрывается, даже
//     если следующая попытка мимо. Иначе прогресс мира зависел бы от
//     того, кто ходил последним, и толпа топталась бы на месте.
//
//  2. ТАЙМЕР ЛИЧНЫЙ, БЛОКИРОВКА ОБЩАЯ. Между попытками у игрока минута
//     — без неё сейф вскрывается перебором за секунды, и от игры
//     остаётся цикл запросов. А после вскрытия сейф закрыт для ВСЕХ:
//     иначе следующий код тут же начали бы ломать те же люди, и пауза
//     не значила бы ничего.
//
//  3. ИСТОРИЯ АНОНИМНА. Видно введённое число и метку игрока, но не
//     позывной. Метка выводится из id игрока И ИЗ КОДА, поэтому в
//     следующем взломе тот же человек получит другую — по истории
//     нельзя следить за конкретным игроком из раунда в раунд.
//
//  4. ПОДСКАЗКА ПРО «НЕ НА СВОЁМ МЕСТЕ» — ЛИЧНАЯ. Сколько цифр угадано
//     не на своей позиции, видит только тот, кто ходил. Общей её делать
//     нельзя: вместе с общей маской это выдало бы код почти сразу.
//
//  5. В КОДЕ БЫВАЮТ ПОВТОРЫ (до SAFE_MAX_REPEAT одинаковых цифр).
//     Из-за них подсчёт «есть, но не там» обязан идти по мультимножеству
//     остатков, а не по «цифра встречается в коде» — иначе одна цифра в
//     попытке засчитывалась бы дважды.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import config = require('../../config/gameConfig');
import type { User } from '../types';

const C = config.CLUB;

type Attempt = { guess: string; tag: string; at: number; bulls: number };
type Crack = {
  code: string;
  mask: string;              // '*' там, где цифра ещё не открыта
  attempts: number;          // сколько попыток сделано по этому коду
  crackers: number;          // сколько разных игроков участвовало
  seen: Record<string, 1>;   // кто уже пробовал (для счётчика участников)
  history: Attempt[];        // последние SAFE_HISTORY попыток, новые первыми
  openedAt: number;
  lockedUntil: number;       // до этого момента сейф закрыт для всех
  last?: { name: string; at: number; attempts: number };
};

function store(): { cur?: Crack } {
  return db.load<{ cur?: Crack }>('safecrack', {});
}

// ── Генератор кода ────────────────────────────────────────────────
// Цифры могут повторяться, но не больше SAFE_MAX_REPEAT раз. Пул
// пересобирается на каждом знаке, поэтому ограничение соблюдается по
// построению, а не проверкой постфактум с перегенерацией.
function genCode(len: number, maxRepeat: number): string {
  const used: Record<string, number> = {};
  let out = '';
  for (let i = 0; i < len; i++) {
    const pool = '0123456789'.split('').filter((d) => (used[d] || 0) < maxRepeat);
    const d = u.pick(pool);
    used[d] = (used[d] || 0) + 1;
    out += d;
  }
  return out;
}

// Анонимная метка. Зависит и от игрока, и от кода: в следующем взломе у
// того же человека будет другая, и слежка по истории не работает.
const TAG_LETTERS = 'АБВГДЕЖЗИКЛМНПРСТУФХЦЧШЭЮЯ';
function tagFor(userId: string, code: string): string {
  let h = 0;
  const src = String(userId) + '|' + code;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0;
  return TAG_LETTERS[h % TAG_LETTERS.length] + String(h % 100).padStart(2, '0');
}

function fresh(): Crack {
  return {
    code: genCode(C.SAFE_DIGITS, C.SAFE_MAX_REPEAT),
    mask: '*'.repeat(C.SAFE_DIGITS),
    attempts: 0,
    crackers: 0,
    seen: {},
    history: [],
    openedAt: Date.now(),
    lockedUntil: 0,
  };
}

// Текущий сейф. Новый код заводится только когда прошла общая пауза —
// иначе игроки увидели бы свежую пустую маску, продолжая быть
// заблокированными, и это читалось бы как поломка.
function crack(): Crack {
  const s = store();
  if (!s.cur) { s.cur = fresh(); db.save('safecrack'); return s.cur; }
  if (s.cur.lockedUntil && Date.now() >= s.cur.lockedUntil) {
    const prev = s.cur.last;
    s.cur = fresh();
    s.cur.last = prev;        // итог прошлого взлома остаётся на виду
    db.save('safecrack');
  }
  return s.cur;
}

// ── Быки и коровы с учётом повторов ───────────────────────────────
// Быки — цифра на своём месте. Коровы — цифра есть в коде, но не здесь,
// причём каждая цифра кода может быть «съедена» только один раз.
function score(guess: string, code: string): { bulls: number; cows: number } {
  let bulls = 0;
  const restCode: Record<string, number> = {};
  const restGuess: Record<string, number> = {};
  for (let i = 0; i < code.length; i++) {
    if (guess[i] === code[i]) { bulls++; continue; }
    restCode[code[i]] = (restCode[code[i]] || 0) + 1;
    restGuess[guess[i]] = (restGuess[guess[i]] || 0) + 1;
  }
  let cows = 0;
  for (const d of Object.keys(restGuess)) cows += Math.min(restGuess[d], restCode[d] || 0);
  return { bulls, cows };
}

// ── Что видно всем ────────────────────────────────────────────────
function view(user: User) {
  const c = crack();
  const locked = c.lockedUntil > Date.now();
  const mine = personalCdLeft(user);
  return {
    state: locked ? 'locked' : 'open',
    digits: C.SAFE_DIGITS,
    maxRepeat: C.SAFE_MAX_REPEAT,
    reward: C.SAFE_REWARD,
    // Главное число экрана: то, что мир уже вскрыл
    mask: c.mask,
    opened: c.mask.split('').filter((x) => x !== '*').length,
    attempts: c.attempts,
    crackers: c.crackers,
    // Последние попытки — число и анонимная метка, без позывных
    history: c.history.map((h) => ({ guess: h.guess, tag: h.tag, at: h.at })),
    lockedSec: locked ? Math.ceil((c.lockedUntil - Date.now()) / 1000) : 0,
    myCooldownSec: mine,
    tryCdSec: C.SAFE_TRY_CD_SEC,
    last: c.last || null,
  };
}

// Личный таймер живёт в объекте игрока: он у каждого свой, а сейф общий.
function personalCdLeft(user: User): number {
  const at = Number(((user as any).club || {}).safeNextAt || 0);
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

// ── Попытка ───────────────────────────────────────────────────────
// Возвращает результат ДЛЯ ИГРОКА. Золото начисляет club.ts: оно обязано
// пройти через суточный потолок, а единственная дверь к нему — payout().
function attempt(user: User, guessRaw: any): any {
  const c = crack();
  if (c.lockedUntil > Date.now()) {
    throw new u.ApiError(`Сейф заменили после вскрытия. Новый привезут через ${Math.ceil((c.lockedUntil - Date.now()) / 60000)} мин.`);
  }
  const left = personalCdLeft(user);
  if (left > 0) throw new u.ApiError(`Отмычки остывают — ещё ${left} с.`);

  const g = String(guessRaw || '').replace(/\D/g, '');
  if (g.length !== C.SAFE_DIGITS) throw new u.ApiError(`Введите ${C.SAFE_DIGITS} цифр`);

  // Таймер тратится ВСЕМ, что дошло до сравнения с кодом, и ставится ДО
  // самого сравнения: иначе ошибка ниже по коду вернула бы игроку
  // бесплатную попытку, и перебор снова стал бы возможен.
  //
  // Ввод неверной длины отвергнут выше и таймера НЕ стоит — намеренно.
  // До кода он не доходит и ничего о нём не сообщает, а минута
  // наказания за опечатку в шестизначном числе — это не защита, а
  // издевательство над тем, кто промахнулся по клавише.
  (user as any).club = (user as any).club || {};
  (user as any).club.safeNextAt = Date.now() + C.SAFE_TRY_CD_SEC * 1000;

  const { bulls, cows } = score(g, c.code);

  // Маска накапливается: открытая цифра остаётся открытой навсегда
  const mask = c.mask.split('');
  for (let i = 0; i < c.code.length; i++) if (g[i] === c.code[i]) mask[i] = c.code[i];
  c.mask = mask.join('');

  c.attempts++;
  if (!c.seen[user.id]) { c.seen[user.id] = 1; c.crackers++; }
  c.history.unshift({ guess: g, tag: tagFor(user.id, c.code), at: Date.now(), bulls });
  c.history = c.history.slice(0, C.SAFE_HISTORY);

  const won = bulls === C.SAFE_DIGITS;
  if (won) {
    c.last = { name: user.name, at: Date.now(), attempts: c.attempts };
    c.lockedUntil = Date.now() + C.SAFE_LOCK_MIN * 60 * 1000;
  }
  db.save('safecrack');
  db.markUser(user.id);

  return {
    result: won ? 'win' : 'miss',
    guess: g,
    bulls,
    cows,                       // личная подсказка: есть в коде, но не на месте
    mask: c.mask,
    attempts: c.attempts,
    reward: won ? C.SAFE_REWARD : 0,
    code: won ? c.code : null,
    lockMin: won ? C.SAFE_LOCK_MIN : 0,
  };
}

export = { view, attempt, score, genCode, tagFor };
