// ===================================================================
// src/services/globalBuffs.js — глобальные бонусы от администратора
// Бонус активируется через админ-панель на N часов и действует на ВСЕХ
// игроков. Например +50% к опыту в выходные.
// ===================================================================

const db = require('../core/db');

const KEYS = {
  xp: { label: 'Бонус опыта (для всех)' },
};

function state() { return db.load('globalBuffs', {}); }

// Активный бонус по ключу (xp / atk / def / loot ...). Возвращает множитель
// или 1 если бонуса нет/он истёк.
function multiplier(key) {
  const s = state()[key];
  if (!s || !s.expiresAt || s.expiresAt < Date.now()) return 1;
  return 1 + (s.pct / 100);
}

// Установить бонус: pct% на hours часов. pct=0 или hours=0 — снять.
function set(key, pct, hours) {
  if (!KEYS[key]) throw new Error('Неизвестный глобальный бонус: ' + key);
  const s = state();
  if (!pct || !hours) {
    delete s[key];
  } else {
    s[key] = {
      pct: Number(pct) || 0,
      expiresAt: Date.now() + hours * 3600 * 1000,
    };
  }
  db.save('globalBuffs');
}

// Все активные бонусы для отображения в UI
function listActive() {
  const s = state();
  const now = Date.now();
  return Object.entries(s)
    .filter(([k, v]) => v && v.expiresAt > now)
    .map(([k, v]) => ({
      key: k,
      label: (KEYS[k] || {}).label || k,
      pct: v.pct,
      hoursLeft: Math.max(0, Math.round((v.expiresAt - now) / 3600000)),
      expiresAt: v.expiresAt,
    }));
}

module.exports = { multiplier, set, listActive, KEYS };
