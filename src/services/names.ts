// ═══════════════════════════════════════════════════════════════════
// src/services/names.ts — проверка позывных: формат, двойники, занятость
//
// Зачем отдельный модуль. Занятость позывного проверялась в пяти местах
// (регистрация, две смены позывного, новый персонаж, «Паспорт»), и везде
// простым сравнением без учёта регистра. Этим пользовались: «Генерал» с
// латинской «a» вместо русской — формально другое имя, а в чате и в
// рейтинге его не отличить от настоящего. Так делают двойников, чтобы
// выдавать себя за другого игрока или сотрудника.
//
// Правила теперь одни на всю игру:
//   • в одном позывном нельзя смешивать русские и латинские буквы;
//   • занятость сравнивается по «скелету» имени: регистр, похожие русские
//     и латинские буквы (а/a, о/o, р/p, с/c…), 0 и о, 1 и l, а также
//     пробелы, дефисы и подчёркивания не отличаются;
//   • тот же скелет сверяется с зарезервированными именами — иначе
//     «аdmin» с русской «а» проходил мимо запрета.
//
// Старые позывные, уже нарушающие правило, не трогаются: их сбрасывает
// модерация (services/nameReset.ts), если они мешают.
// ═══════════════════════════════════════════════════════════════════

import u = require('../core/utils');

const NAME_RE = /^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/;

// Похожие знаки — к одному виду. Список намеренно короткий: только то,
// что в игровом шрифте действительно не отличить. Слишком широкий список
// запрещал бы честные имена за «сходство», которого никто не видит.
const LOOKALIKE: Record<string, string> = {
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'з': '3', 'к': 'k', 'м': 'm', 'н': 'h',
  'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'ь': 'b', 'б': '6',
  '0': 'o', '1': 'l', 'i': 'l',
};

function skeleton(name: string): string {
  return String(name || '').toLowerCase().replace(/[\s_\-]+/g, '')
    .split('').map((ch) => LOOKALIKE[ch] || ch).join('');
}

function mixedScript(name: string): boolean {
  const s = String(name || '');
  return /[A-Za-z]/.test(s) && /[А-Яа-яЁё]/.test(s);
}

function users(): Record<string, any> { return require('./player').users(); }

// Кто уже носит такой же или неотличимый позывной
function findClash(name: string, exceptId?: string): any | null {
  const key = skeleton(name);
  if (!key) return null;
  for (const p of Object.values(users())) {
    if (!p || p.id === exceptId) continue;
    if (skeleton(p.name) === key) return p;
  }
  return null;
}

function isReserved(name: string): boolean {
  const key = skeleton(name);
  let reserved: Set<string> = new Set();
  try { reserved = require('./auth').RESERVED_NAMES; } catch (e) { reserved = new Set(); }
  for (const r of reserved) if (skeleton(r) === key) return true;
  return false;
}

// Формат, раскладка и запрещённые имена. Возвращает очищенный позывной.
function validate(raw: string): string {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name)) {
    throw new u.ApiError('Позывной: 3–16 символов. Разрешены буквы, цифры, пробел, дефис и подчёркивание');
  }
  if (mixedScript(name)) {
    throw new u.ApiError('В позывном нельзя смешивать русские и латинские буквы — так делают двойников чужих имён');
  }
  if (isReserved(name)) throw new u.ApiError('Это имя зарезервировано и недоступно');
  return name;
}

function assertFree(name: string, exceptId?: string): void {
  const other = findClash(name, exceptId);
  if (!other) return;
  if (String(other.name || '').toLowerCase() === String(name || '').toLowerCase()) {
    throw new u.ApiError('Такой позывной уже занят');
  }
  throw new u.ApiError(`Позывной слишком похож на уже занятый «${other.name}»`);
}

// Нейтральный позывной для сброса: general_ и пять цифр
function generate(): string {
  for (let i = 0; i < 60; i++) {
    const n = 'general_' + (10000 + Math.floor(Math.random() * 90000));
    if (!findClash(n)) return n;
  }
  // Пять цифр кончились — шесть, всё ещё в пределах 16 символов
  for (let i = 0; i < 60; i++) {
    const n = 'general_' + (100000 + Math.floor(Math.random() * 900000));
    if (!findClash(n)) return n;
  }
  throw new u.ApiError('Не удалось подобрать свободный позывной — попробуйте ещё раз');
}

export = { NAME_RE, skeleton, mixedScript, findClash, isReserved, validate, assertFree, generate };
