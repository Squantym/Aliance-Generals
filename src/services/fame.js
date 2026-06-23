// ===================================================================
// src/services/fame.js — Зал славы
//
// Два раздела:
//   1. «За сегодня» — ежедневная статистика, сбрасывается в 23:59 МСК
//      Хранится в dailyFame: { snapshotDate, players: {id: {...}} }
//   2. «За всё время» — вечная статистика по накопленным счётчикам
//
// ВАЖНО: ресурсы, выданные администратором через /api/admin/grant или
// /api/admin/grant-all, НЕ учитываются — они не проходят через
// addBattleLoot/addMoney(earned=true)/buildingsBuilt в battle/buildings.
// ===================================================================

const db    = require('../core/db');
const player = require('./player');

// ── 7 категорий ───────────────────────────────────────────────────
const CATEGORIES = [
  {
    id: 'level',
    name: '⭐ Восхождение',
    desc: 'Наивысший уровень генерала',
    val: (p) => p.level,
    fmt: 'number',
  },
  {
    id: 'ears',
    name: '👂 Коллекционер ушей',
    desc: 'Больше всех отрезал ушей при фаталити',
    val: (p) => p.ears || 0,
    fmt: 'number',
  },
  {
    id: 'mercy',
    name: '🕊️ Рыцарь милосердия',
    desc: 'Больше всего жетонов помилования',
    val: (p) => p.tokens || 0,
    fmt: 'number',
  },
  {
    id: 'battles',
    name: '⚔️ Вечный воин',
    desc: 'Суммарно боёв (победы + поражения)',
    val: (p) => (p.battle?.wins || 0) + (p.battle?.losses || 0),
    fmt: 'number',
  },
  {
    id: 'loot',
    name: '💰 Военная добыча',
    desc: 'Заработано в боях',
    val: (p) => p.counters?.battleLoot || 0,
    fmt: 'money',
  },
  {
    id: 'buildings',
    name: '🏗️ Великий строитель',
    desc: 'Всего построено зданий',
    val: (p) => p.counters?.buildingsBuilt || 0,
    fmt: 'number',
  },
  {
    id: 'alliance',
    name: '🤝 Полководец армий',
    desc: 'Самый большой альянс',
    val: (p) => { const a = player.allianceOf(p); return a ? a.members.length : 0; },
    fmt: 'number',
  },
];

// ── МСК-дата (UTC+3) в формате YYYY-MM-DD ─────────────────────────
function mskDateKey() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// ── Получить или создать ежедневный снапшот ────────────────────────
function dailyData() {
  return db.load('dailyFame', { snapshotDate: null, snapshot: null, todayStart: null });
}

// ── Снять снапшот начала дня (вызывается при смене даты МСК) ──────
// Сохраняем значения счётчиков каждого игрока на начало дня.
// Дневной прирост = текущее − значение на начало дня.
function takeSnapshot() {
  const dd = dailyData();
  const today = mskDateKey();
  if (dd.snapshotDate === today) return; // уже снято сегодня

  const all = player.users();
  const snapshot = {};
  for (const p of Object.values(all)) {
    snapshot[p.id] = {
      ears:      p.ears           || 0,
      tokens:    p.tokens         || 0,
      wins:      p.battle?.wins   || 0,
      losses:    p.battle?.losses || 0,
      battleLoot:p.counters?.battleLoot    || 0,
      buildings: p.counters?.buildingsBuilt|| 0,
      allianceSize: (() => { const a = player.allianceOf(p); return a ? a.members.length : 0; })(),
    };
  }
  dd.snapshotDate = today;
  dd.snapshot     = snapshot;
  dd.todayStart   = Date.now();
  db.save('dailyFame');
}

// ── Дневной прирост одного игрока ─────────────────────────────────
function dailyVal(p, catId, snap) {
  const s = snap && snap[p.id];
  switch (catId) {
    case 'level':    return p.level;  // уровень не прирастает за день как число, показываем абсолютный
    case 'ears':     return (p.ears || 0)           - (s?.ears      || 0);
    case 'mercy':    return (p.tokens || 0)          - (s?.tokens    || 0);
    case 'battles':  return ((p.battle?.wins||0)+(p.battle?.losses||0)) - ((s?.wins||0)+(s?.losses||0));
    case 'loot':     return (p.counters?.battleLoot||0) - (s?.battleLoot||0);
    case 'buildings':return (p.counters?.buildingsBuilt||0) - (s?.buildings||0);
    case 'alliance': {
      const a = player.allianceOf(p);
      return (a ? a.members.length : 0) - (s?.allianceSize||0);
    }
    default: return 0;
  }
}

// ── Топ-10 по категории ────────────────────────────────────────────
function top10(catId, valueGetter) {
  return Object.values(player.users())
    .map((p) => ({
      id: p.id, name: p.name, flag: player.flag(p), level: p.level,
      value: valueGetter(p),
    }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

// ── Основная функция ───────────────────────────────────────────────
function fame() {
  takeSnapshot(); // проверяем нужно ли снять снапшот

  const dd = dailyData();
  const snap = dd.snapshot || {};

  const allTime = CATEGORIES.map(cat => ({
    id: cat.id, name: cat.name, desc: cat.desc, fmt: cat.fmt,
    top: top10(cat.id, cat.val),
  }));

  const daily = CATEGORIES.map(cat => ({
    id: cat.id, name: cat.name, desc: cat.desc, fmt: cat.fmt,
    top: top10(cat.id, (p) => dailyVal(p, cat.id, snap)),
  }));

  return {
    allTime,
    daily,
    snapshotDate: dd.snapshotDate,
    nextResetMsk: '23:59',
  };
}

// ── Сброс дневной статистики (вызывается из server.js в 23:59 МСК) ─
function resetDailyIfNeeded() {
  const now = new Date(Date.now() + 3 * 3600 * 1000); // UTC+3
  const h = now.getUTCHours(), m = now.getUTCMinutes();
  // Сброс в окне 23:59–23:59:59 МСК
  if (h === 23 && m === 59) {
    const dd = dailyData();
    const today = mskDateKey();
    if (dd.snapshotDate !== today) {
      takeSnapshot(); // снять снапшот если ещё не снят
    } else {
      // Принудительно обнулить дату чтобы следующий тик взял новый снапшот
      const tomorrow = new Date(Date.now() + 3 * 3600 * 1000 + 60 * 1000);
      const nextKey = tomorrow.toISOString().slice(0, 10);
      if (nextKey !== today) {
        dd.snapshotDate = null; // сбрасываем — следующий вызов takeSnapshot() сделает новый
        db.save('dailyFame');
      }
    }
  }
}

module.exports = { fame, takeSnapshot, resetDailyIfNeeded };
