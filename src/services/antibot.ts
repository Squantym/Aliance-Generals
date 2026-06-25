// ===================================================================
// src/services/antibot.ts — мягкая защита от скриптов/кликеров/ботов
//
// ФИЛОСОФИЯ: не ограничивать живых игроков, а выявлять автоматизацию
// по поведенческим признакам. Люди действуют с естественной вариацией
// интервалов; скрипты — с машинной регулярностью или нечеловеческой
// скоростью. Мы НЕ блокируем сразу, а накапливаем «подозрительность»
// и при высоком уровне просим подтвердить, что игрок — человек
// (лёгкая проверка), либо вводим мягкую задержку.
//
// Признаки автоматизации:
//   1. Слишком стабильные интервалы между действиями (низкая дисперсия)
//   2. Нечеловечески быстрые действия (< MIN_HUMAN_MS подряд много раз)
//   3. Идеально круглые интервалы (ровно N мс снова и снова)
//   4. Активность без перерывов очень долго (24/7 паттерн)
//
// Все данные хранятся в user.behavior (не светится игроку).
// ===================================================================

import type { User, BehaviorProfile } from '../types';

const MIN_HUMAN_MS    = 350;   // быстрее этого человек кликать почти не может
const SAMPLE_SIZE     = 20;    // сколько последних интервалов анализируем
const SUSPICION_MAX   = 100;   // потолок подозрительности
const VERIFY_THRESHOLD = 60;   // выше — просим проверку «я не робот»
const DECAY_PER_HOUR  = 15;    // подозрительность спадает со временем

// Инициализация поля поведения у игрока
function ensure(user: User): BehaviorProfile {
  if (!user.behavior) {
    user.behavior = {
      lastActionAt: 0,
      intervals: [],      // последние интервалы между действиями (мс)
      suspicion: 0,       // 0..100
      lastDecayAt: Date.now(),
      verifyRequired: false,
      flagged: 0,         // сколько раз срабатывала проверка
    };
  }
  return user.behavior as BehaviorProfile;
}

// Спад подозрительности со временем (люди делают паузы)
function applyDecay(b: BehaviorProfile): void {
  const now = Date.now();
  const hours = (now - (b.lastDecayAt || now)) / 3600000;
  if (hours > 0) {
    b.suspicion = Math.max(0, b.suspicion - hours * DECAY_PER_HOUR);
    b.lastDecayAt = now;
  }
}

// Дисперсия интервалов (низкая = машинная регулярность)
function coeffOfVariation(arr: number[]): number {
  if (arr.length < 5) return 1; // мало данных — считаем человеком
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  if (mean === 0) return 0;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance) / mean; // коэффициент вариации
}

// Доля «идеально круглых» интервалов (бот часто шлёт ровно каждые N мс)
function roundRatio(arr: number[]): number {
  if (arr.length < 5) return 0;
  // Считаем сколько интервалов кратны 100мс с точностью ±15мс
  let round = 0;
  for (const x of arr) {
    const mod = x % 1000;
    if (mod < 30 || mod > 970) round++;
  }
  return round / arr.length;
}

// Зафиксировать действие игрока. Вызывается перед чувствительными
// действиями (атака, покупка, открытие контейнера, восстановление).
// Возвращает { ok: true } либо { ok: false, reason, verifyRequired }.
function track(user: User, actionType: string) {
  const b = ensure(user);
  applyDecay(b);

  const now = Date.now();
  const interval = b.lastActionAt ? now - b.lastActionAt : null;
  b.lastActionAt = now;

  if (interval !== null && interval < 120000) { // учитываем только «сессионные» интервалы < 2 мин
    b.intervals.push(interval);
    if (b.intervals.length > SAMPLE_SIZE) b.intervals.shift();
  }

  // Анализируем паттерн
  let delta = 0;

  // 1. Нечеловечески быстро
  if (interval !== null && interval < MIN_HUMAN_MS) {
    delta += 12;
  }

  // 2. Машинная регулярность (низкая вариация)
  const cv = coeffOfVariation(b.intervals);
  if (cv < 0.08 && b.intervals.length >= 10) {
    delta += 20; // почти идентичные интервалы — явный скрипт
  } else if (cv < 0.15 && b.intervals.length >= 10) {
    delta += 8;
  }

  // 3. Круглые интервалы
  if (roundRatio(b.intervals) > 0.7 && b.intervals.length >= 10) {
    delta += 10;
  }

  // Накопление/снижение подозрительности
  if (delta > 0) {
    b.suspicion = Math.min(SUSPICION_MAX, b.suspicion + delta);
  } else {
    // Естественное действие — слегка снижаем
    b.suspicion = Math.max(0, b.suspicion - 1);
  }

  // Решение: капча отключена по требованию. Подозрительность по-прежнему
  // копится (для логов и админ-мониторинга), но действие НЕ блокируется
  // и капча «я не робот» не показывается. Если в будущем понадобится
  // вернуть мягкую защиту — достаточно раскомментировать блок ниже.
  // if (b.suspicion >= VERIFY_THRESHOLD) {
  //   b.verifyRequired = true;
  //   b.flagged = (b.flagged || 0) + 1;
  //   return { ok: false, reason: 'verify', verifyRequired: true, suspicion: Math.round(b.suspicion) };
  // }
  b.verifyRequired = false;

  return { ok: true, suspicion: Math.round(b.suspicion) };
}

// Игрок прошёл проверку «я не робот» — сбрасываем подозрительность
function passVerification(user: User) {
  const b = ensure(user);
  b.suspicion = 0;
  b.verifyRequired = false;
  b.intervals = [];
  b.lastDecayAt = Date.now();
  return { ok: true };
}

// Нужна ли проверка прямо сейчас (для фронтенда).
// Капча отключена — всегда false. Отслеживание поведения продолжается.
function needsVerification(user: User): boolean {
  ensure(user);
  return false;
}

export = { track, passVerification, needsVerification, ensure };
