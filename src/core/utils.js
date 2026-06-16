// ===================================================================
// src/core/utils.js — мелкие помощники, нужные по всему проекту
// ===================================================================

const crypto = require('crypto');

// Класс ошибки, которую роутер превращает в JSON-ответ { error: ... }
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Случайная hex-строка нужной длины (для id и токенов)
function uid(len = 16) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

// Целое случайное число в диапазоне [min, max] включительно
function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Случайный элемент массива
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Перемешивание массива на месте (Фишер–Йетс)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Зажать число в границы
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Безопасно привести значение к целому числу
function toInt(v, def = 0) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : def;
}

// Хэш пароля: scrypt + соль (без внешних библиотек)
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

// Форматирование числа с разделителями для текстов уведомлений
function fmt(n) {
  return Math.round(n).toLocaleString('ru-RU');
}

module.exports = { ApiError, uid, rnd, pick, shuffle, clamp, toInt, hashPassword, fmt };
