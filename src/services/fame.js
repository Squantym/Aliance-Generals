// ===================================================================
// src/services/fame.js — Зал славы
//
// Архитектура:
//   - «За всё время» = текущие накопленные счётчики игроков
//   - «Сегодня» = текущее_значение − снапшот_начала_дня
//
// Снапшот хранится в dailyFame.json / MongoDB коллекции 'dailyFame'.
// Он создаётся ОДИН РАЗ при смене даты МСК (не при каждом запросе).
//
// ВАЖНО о порядке операций:
//   1. Сервер запускается → снапшота нет → создаём НЕМЕДЛЕННО
//      (это значит что в день первого запуска «сегодня» = всё время)
//   2. В 23:59 МСК снапшот сбрасывается
//   3. При следующем запросе создаётся новый снапшот (= конец дня)
//   4. С этого момента дельта = то что наиграно за новый день
// ===================================================================

const db     = require('../core/db');
const player = require('./player');

// ── Геттеры для ОБОИХ направлений: снапшот и текущее ─────────────
// Каждый геттер принимает игрока и возвращает число.
// Один и тот же геттер = сравниваем одно и то же поле.
const GETTERS = {
  ears:          (p) => p.ears          || 0,
  tokens:        (p) => p.tokens        || 0,
  battles:       (p) => (p.battle && p.battle.wins  || 0)
                      + (p.battle && p.battle.losses || 0),
  battleLoot:    (p) => (p.counters && p.counters.battleLoot)     || 0,
  buildingsBuilt:(p) => (p.counters && p.counters.buildingsBuilt) || 0,
};

// ── 7 категорий ───────────────────────────────────────────────────
const CATEGORIES = [
  {
    id: 'level',
    name: '⭐ Восхождение',
    desc: 'Наивысший уровень генерала',
    getter: null,           // null = абсолютное значение (нет дельты)
    absGetter: (p) => p.level,
    fmt: 'number',
  },
  {
    id: 'ears',
    name: '👂 Коллекционер ушей',
    desc: 'Отрезано ушей при фаталити',
    getter: 'ears',
    absGetter: null,
    fmt: 'number',
  },
  {
    id: 'mercy',
    name: '🕊️ Рыцарь милосердия',
    desc: 'Жетонов помилования получено',
    getter: 'tokens',
    absGetter: null,
    fmt: 'number',
  },
  {
    id: 'battles',
    name: '⚔️ Вечный воин',
    desc: 'Суммарно боёв (победы + поражения)',
    getter: 'battles',
    absGetter: null,
    fmt: 'number',
  },
  {
    id: 'loot',
    name: '💰 Военная добыча',
    desc: 'Заработано в боях',
    getter: 'battleLoot',
    absGetter: null,
    fmt: 'money',
  },
  {
    id: 'buildings',
    name: '🏗️ Великий строитель',
    desc: 'Построено зданий',
    getter: 'buildingsBuilt',
    absGetter: null,
    fmt: 'number',
  },
  {
    id: 'alliance',
    name: '🤝 Полководец армий',
    desc: 'Размер альянса',
    getter: null,           // абсолютное — альянс не «растёт за день»
    absGetter: (p) => { const a = player.allianceOf(p); return a ? a.members.length : 0; },
    fmt: 'number',
  },
];

// ── МСК-дата в формате YYYY-MM-DD ─────────────────────────────────
function mskDateKey() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// ── Создать снапшот из ТЕКУЩИХ данных игроков ─────────────────────
// Вызывается только при смене дня — сохраняет «базу» для расчёта дельты.
function buildSnapshot() {
  const all = player.users();
  const snap = {};
  for (const p of Object.values(all)) {
    snap[p.id] = {};
    for (const [key, fn] of Object.entries(GETTERS)) {
      snap[p.id][key] = fn(p);
    }
  }
  return snap;
}

// ── Получить снапшот из хранилища ─────────────────────────────────
function loadSnap() {
  return db.load('dailyFame', {});
}

function saveSnap(snapshotDate, snapshot) {
  const store = db.load('dailyFame', {});
  store.snapshotDate = snapshotDate;
  store.snapshot     = snapshot;
  db.save('dailyFame');
}

// ── Проверка: нужно ли обновить снапшот ───────────────────────────
function ensureSnapshotUpToDate() {
  const today = mskDateKey();
  const stored = loadSnap();

  if (stored && stored.snapshotDate === today && stored.snapshot) {
    // Снапшот уже актуален для сегодня
    return stored.snapshot;
  }

  // Создаём новый снапшот
  const snap = buildSnapshot();
  saveSnap(today, snap);
  return snap;
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
  const snap = ensureSnapshotUpToDate();

  // «За всё время»
  const allTime = CATEGORIES.map(cat => {
    const fn = cat.absGetter || ((p) => GETTERS[cat.getter](p));
    return {
      id: cat.id, name: cat.name,
      desc: cat.desc,
      fmt: cat.fmt,
      top: buildTop(fn),
    };
  });

  // «За сегодня»
  const daily = CATEGORIES.map(cat => {
    let valFn;
    if (!cat.getter) {
      // Абсолютная категория — показываем как есть
      valFn = cat.absGetter;
    } else {
      // Дельта: текущее − снапшот начала дня
      const key = cat.getter;
      const curFn = GETTERS[key];
      valFn = (p) => {
        const cur  = curFn(p);
        const prev = snap && snap[p.id] ? (snap[p.id][key] || 0) : 0;
        return Math.max(0, cur - prev);
      };
    }
    return {
      id: cat.id, name: cat.name,
      desc: cat.getter ? cat.desc + ' — за сегодня' : cat.desc,
      fmt: cat.fmt,
      top: buildTop(valFn),
    };
  });

  const stored = loadSnap();
  return {
    allTime,
    daily,
    snapshotDate: stored ? stored.snapshotDate : null,
    nextResetMsk: '23:59',
  };
}

// ── Сброс в 23:59 МСК (вызывается из server.js каждые 30 сек) ────
function resetDailyIfNeeded() {
  const now = new Date(Date.now() + 3 * 3600 * 1000); // UTC+3
  const h = now.getUTCHours(), m = now.getUTCMinutes();
  if (h === 23 && m === 59) {
    const stored = loadSnap();
    const today  = mskDateKey();
    if (stored && stored.snapshotDate === today) {
      // Сбрасываем дату — при следующем fame() создастся новый снапшот
      const store = db.load('dailyFame', {});
      store.snapshotDate = null;
      store.snapshot     = {};
      db.save('dailyFame');
    }
  }
}

// ── Принудительный сброс (admin-эндпоинт для тестирования) ────────
function forceResetSnapshot() {
  const store = db.load('dailyFame', {});
  store.snapshotDate = null;
  store.snapshot     = {};
  db.save('dailyFame');
}

module.exports = { fame, resetDailyIfNeeded, forceResetSnapshot };
