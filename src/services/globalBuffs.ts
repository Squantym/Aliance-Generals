// ===================================================================
// src/services/globalBuffs.ts — глобальные бонусы от администратора
// Бонус активируется через админ-панель на N часов и действует на ВСЕХ
// игроков. Например +50% к опыту в выходные.
// ===================================================================

import db = require('../core/db');

interface BuffMeta { label: string; }
// startAt — отложенный старт: бонус записан, но включится позже
interface BuffState { pct: number; expiresAt: number; startAt?: number; }

const KEYS: Record<string, BuffMeta> = {
  xp: { label: 'Бонус опыта (для всех)' },
};

function state(): Record<string, BuffState> {
  return db.load<Record<string, BuffState>>('globalBuffs', {});
}

// Активный бонус по ключу (xp / atk / def / loot ...). Возвращает
// множитель или 1 если бонуса нет/он истёк.
function multiplier(key: string): number {
  const s = state()[key];
  if (!s || !s.expiresAt || s.expiresAt < Date.now()) return 1;
  // Запланированный на будущее бонус ещё не действует
  if (s.startAt && s.startAt > Date.now()) return 1;
  return 1 + (s.pct / 100);
}

// Установить бонус: pct% на hours часов ЛИБО до точной даты (when.endAt),
// с необязательным началом when.startAt. pct=0 и пустой срок — снять.
function set(key: string, pct: number, hours: number,
             when?: { startAt?: number; endAt?: number }): void {
  if (!KEYS[key]) throw new Error('Неизвестный глобальный бонус: ' + key);
  const s = state();
  const endAt = Math.max(0, Number(when && when.endAt) || 0);
  const startAt = Math.max(0, Number(when && when.startAt) || 0);
  if (endAt > 0 && endAt <= (startAt || Date.now())) {
    throw new Error('Окончание бонуса раньше его начала');
  }
  if (!pct || (!hours && !endAt)) {
    delete s[key];
  } else {
    s[key] = {
      pct: Number(pct) || 0,
      startAt: startAt || Date.now(),
      expiresAt: endAt || (Date.now() + hours * 3600 * 1000),
    };
  }
  db.save('globalBuffs');
}

// Все активные бонусы для отображения в UI
function listActive() {
  const s = state();
  const now = Date.now();
  return Object.entries(s)
    .filter(([, v]) => v && v.expiresAt > now)
    .map(([k, v]) => ({
      key: k,
      label: (KEYS[k] || {}).label || k,
      pct: v.pct,
      hoursLeft: Math.max(0, Math.round((v.expiresAt - now) / 3600000)),
      expiresAt: v.expiresAt,
      startAt: v.startAt || 0,
      pending: !!(v.startAt && v.startAt > now),
    }));
}

export = { multiplier, set, listActive, KEYS };
