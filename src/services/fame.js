// ===================================================================
// src/services/fame.js — Зал славы
//
// РАЗДЕЛ «ЗА ВСЁ ВРЕМЯ»: накопленные счётчики, не учитывают adminGrant
// РАЗДЕЛ «СЕГОДНЯ»: разница между текущими значениями и снапшотом
// на начало дня. Снапшот снимается при смене даты МСК.
//
// Ресурсы от администратора НЕ учитываются — они пишут напрямую в
// user.earsCurrent/tokens/dollars, минуя battle/buildings счётчики.
// ===================================================================

const db     = require('../core/db');
const player = require('./player');

// ── 7 категорий ───────────────────────────────────────────────────
const CATEGORIES = [
  {
    id: 'level',
    name: '⭐ Восхождение',
    desc: 'Наивысший уровень генерала',
    allTimeVal: (p) => p.level,
    dailyVal:   (p) => p.level,  // уровень — абсолютный, смысл дельты небольшой
    fmt: 'number',
  },
  {
    id: 'ears',
    name: '👂 Коллекционер ушей',
    desc: 'Больше всех отрезал ушей при фаталити',
    allTimeVal: (p) => p.ears || 0,
    dailyKey:   'ears',
    fmt: 'number',
  },
  {
    id: 'mercy',
    name: '🕊️ Рыцарь милосердия',
    desc: 'Больше всего жетонов помилования',
    allTimeVal: (p) => p.tokens || 0,
    dailyKey:   'tokens',
    fmt: 'number',
  },
  {
    id: 'battles',
    name: '⚔️ Вечный воин',
    desc: 'Суммарно боёв (победы + поражения) за день',
    allTimeVal: (p) => (p.battle?.wins || 0) + (p.battle?.losses || 0),
    dailyKey:   'battles',
    fmt: 'number',
  },
  {
    id: 'loot',
    name: '💰 Военная добыча',
    desc: 'Заработано в боях',
    allTimeVal: (p) => p.counters?.battleLoot || 0,
    dailyKey:   'battleLoot',
    fmt: 'money',
  },
  {
    id: 'buildings',
    name: '🏗️ Великий строитель',
    desc: 'Всего построено зданий',
    allTimeVal: (p) => p.counters?.buildingsBuilt || 0,
    dailyKey:   'buildingsBuilt',
    fmt: 'number',
  },
  {
    id: 'alliance',
    name: '🤝 Полководец армий',
    desc: 'Самый большой альянс',
    allTimeVal: (p) => { const a = player.allianceOf(p); return a ? a.members.length : 0; },
    dailyVal:   (p) => { const a = player.allianceOf(p); return a ? a.members.length : 0; },
    fmt: 'number',
  },
];

// ── МСК-дата (UTC+3) в формате YYYY-MM-DD ─────────────────────────
function mskDateKey() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function dailyStore() {
  return db.load('dailyFame', { snapshotDate: null, snapshot: {} });
}

// ── Снапшот: текущие значения всех игроков на начало дня ──────────
function ensureSnapshot() {
  const store = dailyStore();
  const today = mskDateKey();
  if (store.snapshotDate === today) return store; // уже свежий

  // Новый день — снимаем снапшот текущих значений
  const all = player.users();
  const snap = {};
  for (const p of Object.values(all)) {
    snap[p.id] = {
      ears:          p.ears           || 0,
      tokens:        p.tokens         || 0,
      battles:       (p.battle?.wins  || 0) + (p.battle?.losses || 0),
      battleLoot:    p.counters?.battleLoot     || 0,
      buildingsBuilt:p.counters?.buildingsBuilt || 0,
    };
  }
  store.snapshotDate = today;
  store.snapshot     = snap;
  db.save('dailyFame');
  return store;
}

// ── Дневное значение одного игрока ────────────────────────────────
function getDailyVal(cat, p, snap) {
  // Если у категории есть специальная функция для ежедневного значения
  if (cat.dailyVal) return cat.dailyVal(p);
  // Иначе вычисляем дельту по ключу
  const key  = cat.dailyKey;
  const cur  = cat.allTimeVal(p);
  const prev = snap && snap[p.id] ? (snap[p.id][key] || 0) : 0;
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
    id: cat.id, name: cat.name, desc: cat.desc, fmt: cat.fmt,
    top: buildTop(p => getDailyVal(cat, p, snap)),
  }));

  return {
    allTime,
    daily,
    snapshotDate: store.snapshotDate,
    nextResetMsk: '23:59',
  };
}

// ── Сброс дневного снапшота (вызывается из server.js каждые 30 сек) ─
// При смене даты МСК ensureSnapshot() автоматически обновит снапшот
// при следующем обращении к fame(). Здесь принудительно сбрасываем
// дату в 23:59 МСК чтобы следующий вызов создал новый снапшот.
function resetDailyIfNeeded() {
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const h = now.getUTCHours(), m = now.getUTCMinutes();
  if (h === 23 && m === 59) {
    const store = dailyStore();
    const today = mskDateKey();
    if (store.snapshotDate === today) {
      // Помечаем как устаревший — при следующем запросе создастся новый
      store.snapshotDate = null;
      db.save('dailyFame');
    }
  }
}

module.exports = { fame, resetDailyIfNeeded };
