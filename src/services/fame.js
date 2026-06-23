// ===================================================================
// src/services/fame.js — Зал славы
//
// РАЗДЕЛ «ЗА ВСЁ ВРЕМЯ»: накопленные счётчики игроков
// РАЗДЕЛ «СЕГОДНЯ»: разница (текущее − снапшот начала дня)
//
// Как работает снапшот:
//   - При первом запросе за новый день снапшот СОХРАНЯЕТСЯ как база
//     (значения на начало дня = то что было до сегодняшних действий)
//   - В течение дня «сегодня» = текущее − снапшот
//   - В 23:59 МСК снапшот сбрасывается → следующий запрос
//     создаст новый снапшот для нового дня
//
// КЛЮЧЕВОЙ ПРИНЦИП:
//   Снапшот создаётся один раз в начале дня и не меняется до следующего.
//   Дельта = текущее_значение − значение_в_снапшоте.
// ===================================================================

const db     = require('../core/db');
const player = require('./player');

// ── Геттеры текущих значений по ключу ─────────────────────────────
// Все эти функции возвращают одно число для конкретного игрока.
// dailyKey — имя поля в снапшоте И имя функции в curVal.
const CUR_VAL = {
  ears:          (p) => p.ears           || 0,
  tokens:        (p) => p.tokens         || 0,
  battles:       (p) => (p.battle?.wins  || 0) + (p.battle?.losses || 0),
  battleLoot:    (p) => p.counters?.battleLoot     || 0,
  buildingsBuilt:(p) => p.counters?.buildingsBuilt || 0,
};

// ── 7 категорий ───────────────────────────────────────────────────
const CATEGORIES = [
  {
    id: 'level',
    name: '⭐ Восхождение',
    desc: 'Наивысший уровень генерала',
    allTimeVal: (p) => p.level,
    // Уровень — абсолютное значение, одинаково для «за всё время» и «сегодня»
    dailyKey: null,
    fmt: 'number',
  },
  {
    id: 'ears',
    name: '👂 Коллекционер ушей',
    desc: 'Больше всех отрезал ушей при фаталити',
    allTimeVal: (p) => p.ears || 0,
    dailyKey: 'ears',
    fmt: 'number',
  },
  {
    id: 'mercy',
    name: '🕊️ Рыцарь милосердия',
    desc: 'Больше всего жетонов помилования',
    allTimeVal: (p) => p.tokens || 0,
    dailyKey: 'tokens',
    fmt: 'number',
  },
  {
    id: 'battles',
    name: '⚔️ Вечный воин',
    desc: 'Суммарно боёв (победы + поражения)',
    allTimeVal: (p) => (p.battle?.wins || 0) + (p.battle?.losses || 0),
    dailyKey: 'battles',
    fmt: 'number',
  },
  {
    id: 'loot',
    name: '💰 Военная добыча',
    desc: 'Заработано в боях',
    allTimeVal: (p) => p.counters?.battleLoot || 0,
    dailyKey: 'battleLoot',
    fmt: 'money',
  },
  {
    id: 'buildings',
    name: '🏗️ Великий строитель',
    desc: 'Всего построено зданий',
    allTimeVal: (p) => p.counters?.buildingsBuilt || 0,
    dailyKey: 'buildingsBuilt',
    fmt: 'number',
  },
  {
    id: 'alliance',
    name: '🤝 Полководец армий',
    desc: 'Самый большой альянс',
    allTimeVal: (p) => { const a = player.allianceOf(p); return a ? a.members.length : 0; },
    // Размер альянса — абсолютное значение, дельта за день не осмыслена
    dailyKey: null,
    fmt: 'number',
  },
];

// ── МСК-дата в формате YYYY-MM-DD ─────────────────────────────────
function mskDateKey() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function dailyStore() {
  return db.load('dailyFame', { snapshotDate: null, snapshot: {} });
}

// ── Создать снапшот на начало дня ─────────────────────────────────
// Вызывается ТОЛЬКО один раз при смене даты МСК.
// Сохраняет текущие значения всех игроков как «базу» для расчёта дельты.
function takeSnapshot() {
  const all  = player.users();
  const snap = {};
  for (const p of Object.values(all)) {
    snap[p.id] = {};
    for (const [key, fn] of Object.entries(CUR_VAL)) {
      snap[p.id][key] = fn(p);
    }
  }
  return snap;
}

// ── Проверить/создать снапшот для текущего дня ────────────────────
function ensureSnapshot() {
  const store = dailyStore();
  const today = mskDateKey();

  if (store.snapshotDate === today) {
    // Снапшот уже есть для сегодня — возвращаем как есть
    return store;
  }

  // Новый день — создаём снапшот и сохраняем
  store.snapshotDate = today;
  store.snapshot     = takeSnapshot();
  db.save('dailyFame');
  return store;
}

// ── Дневное значение одного игрока ────────────────────────────────
function getDailyVal(cat, p, snap) {
  // Если у категории нет dailyKey — показываем абсолютное значение
  if (!cat.dailyKey) return cat.allTimeVal(p);

  // Текущее значение по тому же геттеру что и снапшот
  const curFn = CUR_VAL[cat.dailyKey];
  if (!curFn) return cat.allTimeVal(p);

  const cur  = curFn(p);
  const prev = snap && snap[p.id] ? (snap[p.id][cat.dailyKey] || 0) : 0;

  // Дельта: сколько прибавилось за день
  return Math.max(0, cur - prev);
}

// ── Топ-10 по значению ────────────────────────────────────────────
function buildTop(valFn) {
  return Object.values(player.users())
    .map((p) => ({
      id: p.id, name: p.name, flag: player.flag(p), level: p.level,
      value: valFn(p),
    }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

// ── Основная функция ───────────────────────────────────────────────
function fame() {
  const store = ensureSnapshot();
  const snap  = store.snapshot || {};

  const allTime = CATEGORIES.map(cat => ({
    id: cat.id, name: cat.name, desc: cat.desc, fmt: cat.fmt,
    top: buildTop(p => cat.allTimeVal(p)),
  }));

  const daily = CATEGORIES.map(cat => ({
    id: cat.id,
    name: cat.name,
    // Для абсолютных категорий уточняем описание
    desc: cat.dailyKey
      ? cat.desc + ' — за сегодня'
      : cat.desc,
    fmt: cat.fmt,
    top: buildTop(p => getDailyVal(cat, p, snap)),
  }));

  return {
    allTime,
    daily,
    snapshotDate: store.snapshotDate,
    nextResetMsk: '23:59',
  };
}

// ── Сброс в 23:59 МСК ─────────────────────────────────────────────
// Сбрасываем дату снапшота → при следующем fame() создастся новый.
// Новый снапшот = значения игроков на начало нового дня.
function resetDailyIfNeeded() {
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const h = now.getUTCHours(), m = now.getUTCMinutes();
  if (h === 23 && m === 59) {
    const store = dailyStore();
    const today = mskDateKey();
    if (store.snapshotDate === today) {
      store.snapshotDate = null; // сбросить → следующий запрос создаст новый
      db.save('dailyFame');
    }
  }
}

// ── Принудительный сброс снапшота (для тестирования через API) ────
function forceResetSnapshot() {
  const store = dailyStore();
  store.snapshotDate = null;
  store.snapshot = {};
  db.save('dailyFame');
}

module.exports = { fame, resetDailyIfNeeded, forceResetSnapshot };
