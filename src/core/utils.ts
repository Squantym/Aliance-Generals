// ===================================================================
// src/core/utils.ts — мелкие помощники, нужные по всему проекту
//
// Стиль модулей: CommonJS (export =), как и весь проект. Полная
// совместимость с существующими .js файлами, которые делают
// `const u = require('../core/utils')`. Типы сохраняются для .ts.
// ===================================================================

import crypto = require('crypto');

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
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : def;
}

// Хэш пароля: scrypt + соль (без внешних библиотек)
function hashPassword(password: string | number, salt: string): string {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

// Форматирование числа с разделителями для текстов уведомлений
function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

export = { ApiError, uid, rnd, pick, shuffle, clamp, toInt, hashPassword, fmt };
