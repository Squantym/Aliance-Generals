// ===================================================================
// src/services/discounts.ts — глобальные скидки и бонусы от админа
// Хранятся в коллекции 'discounts' одним объектом:
//   { unit: {pct:20, expires:1234}, building: {...}, ... }
// Категории (ключи) — см. CATEGORIES ниже.
// Скидки уменьшают цену; бонус «gold» увеличивает количество золота
// при покупке (когда вкладка покупки золота будет добавлена).
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');

// Категории скидок: id → человекочитаемое название
const CATEGORIES: Record<string, string> = {
  unit:        'Покупка техники',
  building:    'Постройки (доходные и оборонительные)',
  modernize:   'Производство (модернизация Mk1/Mk2)',
  workshop:    'Покупка цехов производства',
  market:      'Чёрный рынок: допинг и падлянки',
  container:   'Контейнеры контрабанды',
  trophy:      'Прокачка трофеев',
  alliance:    'Создание альянса',
  legion:      'Создание легиона',
  gold:        'Бонус к покупаемому золоту',
  mine:        'Шахты (золотодобыча)',
  silo:        'Ракетные шахты',
};

function store(): Record<string, any> { return db.load('discounts', {}); }

// Активные скидки на сейчас: ТОЛЬКО те, что уже наступили (startAt <= now)
// и ещё не истекли (expires > now). Запланированные на будущее скидки
// сюда не попадают — applyTo() их не учитывает, пока не наступит время.
function getActive(): Record<string, { pct: number; expires: number }> {
  const now = Date.now();
  const all = store();
  const out: Record<string, { pct: number; expires: number }> = {};
  for (const cat of Object.keys(CATEGORIES)) {
    const d = all[cat];
    if (d && d.expires > now && d.pct > 0 && (d.startAt || 0) <= now) {
      out[cat] = { pct: d.pct, expires: d.expires };
    }
  }
  return out;
}

// Текущая скидка по категории — число в процентах (0..99) либо 0
function pctOf(category: string): number {
  const a = getActive();
  return a[category] ? a[category].pct : 0;
}

// Применить скидку к цене. price * (1 - pct/100), округление вниз до целого
function applyTo(category: string, price: number): number {
  const pct = pctOf(category);
  if (pct <= 0) return Math.round(price);
  return Math.max(0, Math.floor(price * (1 - pct / 100)));
}

// Множитель бонуса (для категории gold — увеличивает покупаемое золото)
function bonusMul(category: string): number {
  return 1 + pctOf(category) / 100;
}

// Установить скидку: pct% на durationHours часов, с возможностью отложенного
// старта через delayHours (по умолчанию 0 — начинается сразу).
// pct=0 или duration<=0 — снять скидку немедленно.
function set(category: string, pct: number, durationHours: number, delayHours?: number) {
  if (!CATEGORIES[category]) throw new u.ApiError('Неизвестная категория скидки');
  pct = Math.max(0, Math.min(99, u.toInt(pct, 0)));
  const hours = Math.max(0, Number(durationHours) || 0);
  const delay = Math.max(0, Number(delayHours) || 0);
  const all = store();
  if (pct === 0 || hours === 0) {
    delete all[category];
  } else {
    const startAt = Date.now() + Math.round(delay * 3600 * 1000);
    all[category] = { pct, startAt, expires: startAt + Math.round(hours * 3600 * 1000) };
  }
  db.save('discounts');
  return all[category] || null;
}

// Получить список всех категорий для админки (для формы выбора)
function categories() {
  return Object.entries(CATEGORIES).map(([id, name]) => ({ id, name }));
}

// Все запланированные/активные скидки (включая ещё не наступившие) — для
// отображения в админке полного расписания
function allScheduled() {
  const now = Date.now();
  const all = store();
  return Object.entries(all)
    .filter(([cat, d]) => d && d.expires > now)
    .map(([cat, d]) => ({
      category: cat, label: CATEGORIES[cat] || cat,
      pct: d.pct, startAt: d.startAt || 0, expires: d.expires,
      pending: (d.startAt || 0) > now,
    }));
}

// Информация об активной скидке для отображения в UI (или null)
function info(category: string) {
  const a = getActive();
  if (!a[category]) return null;
  return {
    pct: a[category].pct,
    expiresAt: a[category].expires,
    label: CATEGORIES[category] || category,
  };
}

export = { getActive, info, pctOf, applyTo, bonusMul, set, categories, allScheduled, CATEGORIES };
