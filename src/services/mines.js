// ===================================================================
// src/services/mines.js — раздел «Шахты» в Производстве
//
// Механика:
//   1. Игрок строит шахту: платит доллары + 1 сутки строительства.
//      У шахты сразу определяется случайный изначальный запас золота
//      (20-50, по диапазонам с разными шансами).
//   2. Игрок выбирает время спуска (10-90 минут, шаг 10) и отправляет
//      шахтёров. Результат известен только по истечении времени.
//   3. Суммарно в календарные сутки (UTC) — не больше 90 минут спуска
//      на одну шахту.
//   4. По итогам спуска: 30-40% шанс не найти золото (пусто). Если
//      нашли — открывается возможность «добыть» 20% от ПЕРВОНАЧАЛЬНОГО
//      запаса шахты; добыча занимает 5 минут.
//   5. Отдельно (независимо от находки) — 20% шанс нападения
//      террористов: у игрока 10 минут чтобы отреагировать (устранить
//      угрозу), иначе спуск считается испорченным (без находки).
//   6. Когда весь запас золота исчерпан — шахта обрушивается. Через
//      сутки на этом же участке можно строить новую шахту.
// ===================================================================

const config = require('../../config/gameConfig');
const u = require('../core/utils');
const db = require('../core/db');
const discounts = require('./discounts');

const M = config.MINE;

function mines(user) {
  if (!user.mines) user.mines = [];
  return user.mines;
}

// Текущий "номер шахты" игрока (для расчёта цены — каждая следующая дороже)
function nextMineCost(user) {
  // Цена считается по числу шахт, когда-либо построенных (включая
  // обрушившиеся) — чтобы нельзя было обойти удвоение постройкой/сносом
  const built = user.minesBuiltTotal || 0;
  const base = Math.round(M.FIRST_PRICE_GOLD * Math.pow(M.PRICE_MULT, built));
  return discounts.applyTo('mine', base);
}

function nextMineDollars(user) {
  // Цена в долларах растёт мягко с уровнем игрока
  const base = Math.round(M.BUILD_DOLLARS_BASE * Math.pow(1.08, Math.max(0, user.level - 1)));
  return discounts.applyTo('mine', base);
}

// Случайный изначальный запас золота по диапазонам с шансами
function rollInitialGold() {
  const roll = Math.random();
  let acc = 0;
  for (const r of M.GOLD_RANGES) {
    acc += r.chance;
    if (roll <= acc) return u.rnd(r.min, r.max);
  }
  return u.rnd(M.GOLD_RANGES[0].min, M.GOLD_RANGES[0].max);
}

// Сегодняшний UTC-день (для лимита 90 минут/сутки)
function todayUtcKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function ensureDailyMinutes(mine) {
  const today = todayUtcKey();
  if (mine.dailyKey !== today) {
    mine.dailyKey = today;
    mine.minutesUsedToday = 0;
  }
}

// Публичное представление одной шахты для UI
function mineView(mine) {
  ensureDailyMinutes(mine);
  const now = Date.now();
  return {
    id: mine.id,
    status: mine.status, // 'building' | 'idle' | 'descending' | 'collapsed'
    goldTotal: mine.goldTotal,
    goldLeft: mine.goldLeft,
    buildFinishesAt: mine.status === 'building' ? mine.buildFinishesAt : null,
    buildRemainingSec: mine.status === 'building' ? Math.max(0, Math.ceil((mine.buildFinishesAt - now) / 1000)) : 0,
    minutesUsedToday: mine.minutesUsedToday,
    minutesLeftToday: Math.max(0, M.DAILY_LIMIT_MINUTES - mine.minutesUsedToday),
    descent: mine.status === 'descending' ? {
      finishesAt: mine.descentFinishesAt,
      remainingSec: Math.max(0, Math.ceil((mine.descentFinishesAt - now) / 1000)),
      minutes: mine.descentMinutes,
      terroristAttack: !!mine.terroristAttack,
      terroristDeadline: mine.terroristDeadline || null,
      terroristRemainingSec: mine.terroristAttack
        ? Math.max(0, Math.ceil((mine.terroristDeadline - now) / 1000)) : 0,
      terroristResolved: !!mine.terroristResolved,
    } : null,
    pendingResult: mine.pendingResult || null, // 'found' | 'empty' | 'ruined' (после завершения спуска, до показа)
    goldReady: mine.status === 'extracting' ? {
      readyAt: mine.extractReadyAt,
      remainingSec: Math.max(0, Math.ceil((mine.extractReadyAt - now) / 1000)),
      amount: mine.extractAmount,
    } : null,
    collapsedAt: mine.status === 'collapsed' ? mine.collapsedAt : null,
    rebuildReadyAt: mine.status === 'collapsed' ? mine.collapsedAt + M.COLLAPSE_REBUILD_MS : null,
  };
}

// Полное представление для экрана: список шахт + цена следующей
function view(user) {
  refreshAll(user);
  return {
    mines: mines(user).map(mineView),
    // Цена для НОВОЙ шахты (нового участка)
    nextMineCostGold: nextMineCost(user),
    nextMineDollars: nextMineDollars(user),
    // Цена восстановления УЖЕ КУПЛЕННОГО участка после обвала — только доллары
    rebuildDollars: nextMineDollars(user),
    minutesOptions: stepRange(M.DESCENT_MIN_MINUTES, M.DESCENT_MAX_MINUTES, M.DESCENT_STEP_MINUTES),
    unlockLevel: config.PRODUCTION_UNLOCK_LEVEL,
  };
}

function stepRange(min, max, step) {
  const out = [];
  for (let v = min; v <= max; v += step) out.push(v);
  return out;
}

// ---------- Построить НОВУЮ шахту (новый участок) ----------
// Стоит золото + игровые деньги. Уже купленные слоты восстанавливаются
// дешевле — через rebuild(), который тратит ТОЛЬКО доллары.
function build(user, notices) {
  if (user.level < config.PRODUCTION_UNLOCK_LEVEL) {
    throw new u.ApiError(`Шахты доступны с ${config.PRODUCTION_UNLOCK_LEVEL} уровня`);
  }
  const goldCost = nextMineCost(user);
  const dollarCost = nextMineDollars(user);
  if (user.gold < goldCost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${goldCost})`);
  if (user.dollars < dollarCost) throw new u.ApiError(`Не хватает денег (нужно $${u.fmt(dollarCost)})`);

  user.gold -= goldCost;
  user.dollars -= dollarCost;
  user.minesBuiltTotal = (user.minesBuiltTotal || 0) + 1;

  const goldTotal = rollInitialGold();
  const mine = {
    id: u.uid(10),
    status: 'building',
    buildFinishesAt: Date.now() + M.BUILD_TIME_MS,
    goldTotal, goldLeft: goldTotal,
    dailyKey: todayUtcKey(),
    minutesUsedToday: 0,
  };
  mines(user).push(mine);
  notices.push(`⛏ Заложен новый участок шахты. Строительство займёт 24 часа. Запас золота определится после завершения постройки.`);
  return mineView(mine);
}

// ---------- Восстановить ОБВАЛИВШУЮСЯ шахту (тот же участок) ----------
// Уже купленный слот стоит только игровые деньги, золото второй раз
// не требуется. Цена в долларах та же, что и для новой шахты — это
// «расчистка завалов и пересборка вышки», 24 часа стройки.
function rebuild(user, mineId, notices) {
  if (user.level < config.PRODUCTION_UNLOCK_LEVEL) {
    throw new u.ApiError(`Шахты доступны с ${config.PRODUCTION_UNLOCK_LEVEL} уровня`);
  }
  const mine = mines(user).find((m) => m.id === mineId);
  if (!mine) throw new u.ApiError('Шахта не найдена');
  if (mine.status !== 'collapsed') throw new u.ApiError('Восстанавливать можно только обрушенный участок');
  const ready = (mine.collapsedAt || 0) + M.COLLAPSE_REBUILD_MS;
  if (Date.now() < ready) {
    throw new u.ApiError(`Участок ещё не расчищен — осталось ${UI_fmtSec(ready - Date.now())}`);
  }

  const dollarCost = nextMineDollars(user);
  if (user.dollars < dollarCost) {
    throw new u.ApiError(`Не хватает денег (нужно $${u.fmt(dollarCost)})`);
  }
  user.dollars -= dollarCost;

  const goldTotal = rollInitialGold();
  // Сбрасываем все поля участка кроме id — это та же шахта, новый цикл
  mine.status = 'building';
  mine.buildFinishesAt = Date.now() + M.BUILD_TIME_MS;
  mine.goldTotal = goldTotal;
  mine.goldLeft = goldTotal;
  mine.dailyKey = todayUtcKey();
  mine.minutesUsedToday = 0;
  mine.descentMinutes = 0;
  mine.descentFinishesAt = 0;
  mine.terroristAttack = false;
  mine.terroristResolved = false;
  mine.terroristRollDone = false;
  mine.terroristDeadline = 0;
  mine.pendingResult = null;
  mine.extractAmount = 0;
  mine.extractReadyAt = 0;
  delete mine.collapsedAt;

  notices.push(`⛏ Участок начали восстанавливать. Строительство займёт 24 часа. Запас золота определится после завершения.`);
  return mineView(mine);
}

// Маленький локальный форматтер секунд — чтобы не тащить зависимости
function UI_fmtSec(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} сек`;
  if (s < 3600) return `${Math.floor(s/60)} мин`;
  return `${Math.floor(s/3600)} ч ${Math.floor((s%3600)/60)} мин`;
}

// ---------- Отправить шахтёров вниз ----------
function descend(user, mineId, minutes, notices) {
  const mine = mines(user).find((m) => m.id === mineId);
  if (!mine) throw new u.ApiError('Шахта не найдена');
  if (mine.status === 'building') throw new u.ApiError('Шахта ещё строится');
  if (mine.status === 'collapsed') throw new u.ApiError('Эта шахта обрушилась — дождитесь восстановления участка');
  if (mine.status === 'descending') throw new u.ApiError('Шахтёры уже работают');
  if (mine.status === 'extracting') throw new u.ApiError('Сначала заберите добытое золото');

  minutes = u.toInt(minutes);
  if (minutes < M.DESCENT_MIN_MINUTES || minutes > M.DESCENT_MAX_MINUTES || minutes % M.DESCENT_STEP_MINUTES !== 0) {
    throw new u.ApiError(`Время спуска: от ${M.DESCENT_MIN_MINUTES} до ${M.DESCENT_MAX_MINUTES} минут, шагом ${M.DESCENT_STEP_MINUTES}`);
  }

  ensureDailyMinutes(mine);
  if (mine.minutesUsedToday + minutes > M.DAILY_LIMIT_MINUTES) {
    throw new u.ApiError(`Превышен дневной лимит: доступно ещё ${M.DAILY_LIMIT_MINUTES - mine.minutesUsedToday} мин. сегодня`);
  }

  mine.status = 'descending';
  mine.descentMinutes = minutes;
  mine.descentFinishesAt = Date.now() + minutes * 60 * 1000;
  mine.minutesUsedToday += minutes;
  mine.terroristAttack = false;
  mine.terroristResolved = false;
  mine.pendingResult = null;

  notices.push(`⛏ Шахтёры спустились на ${minutes} минут. Результат станет известен по их возвращении.`);
  return mineView(mine);
}

// ---------- Устранить нападение террористов ----------
function fightTerrorists(user, mineId, notices) {
  const mine = mines(user).find((m) => m.id === mineId);
  if (!mine) throw new u.ApiError('Шахта не найдена');
  if (mine.status !== 'descending' || !mine.terroristAttack) {
    throw new u.ApiError('Нападения сейчас нет');
  }
  if (mine.terroristResolved) throw new u.ApiError('Уже отреагировали');
  if (Date.now() > mine.terroristDeadline) throw new u.ApiError('Время на реакцию истекло — шахтёры не дождались помощи');

  mine.terroristResolved = true;
  notices.push(`⚔ Террористы устранены! Шахтёры продолжают работу.`);
  return mineView(mine);
}

// ---------- Забрать добытое золото ----------
function collectGold(user, mineId, notices) {
  const mine = mines(user).find((m) => m.id === mineId);
  if (!mine) throw new u.ApiError('Шахта не найдена');
  if (mine.status !== 'extracting') throw new u.ApiError('Сейчас нечего забирать');
  if (Date.now() < mine.extractReadyAt) throw new u.ApiError('Золото ещё добывается');

  const amount = mine.extractAmount;
  user.gold += amount;
  mine.goldLeft -= amount;
  mine.status = 'idle';
  mine.extractAmount = 0;

  notices.push(`🪙 Добыто золото: +${amount}!`);

  if (mine.goldLeft <= 0) {
    mine.status = 'collapsed';
    mine.collapsedAt = Date.now();
    notices.push(`💥 Шахта исчерпана и обрушилась. Восстановление участка займёт 24 часа.`);
  }
  return mineView(mine);
}

// ---------- Фоновая проверка: завершение спуска, появление нападения,
//             автоматический провал при неотреагированном нападении ----------
function refreshAll(user) {
  const now = Date.now();
  for (const mine of mines(user)) {
    // Завершение постройки
    if (mine.status === 'building' && mine.buildFinishesAt <= now) {
      mine.status = 'idle';
    }

    // Во время спуска — может «появиться» нападение террористов в любой
    // момент окна (для простоты бросаем шанс один раз сразу при спуске,
    // на половине времени спуска — чтобы у игрока было время отреагировать
    // ДО завершения работы шахтёров)
    if (mine.status === 'descending' && !mine.terroristAttack && mine.terroristRollDone !== true) {
      const halfPoint = mine.descentFinishesAt - (mine.descentMinutes * 60 * 1000) / 2;
      if (now >= halfPoint) {
        mine.terroristRollDone = true;
        if (Math.random() < M.TERRORIST_ATTACK_CHANCE) {
          mine.terroristAttack = true;
          mine.terroristDeadline = now + M.TERRORIST_REACT_MS;
        }
      }
    }

    // Завершение спуска — выясняем результат
    if (mine.status === 'descending' && mine.descentFinishesAt <= now) {
      // Если было нападение и его не отбили вовремя — спуск испорчен
      const ruinedByTerrorists = mine.terroristAttack && !mine.terroristResolved;

      if (ruinedByTerrorists) {
        mine.status = 'idle';
        mine.pendingResult = 'ruined';
      } else {
        const notFoundChance = M.NOT_FOUND_CHANCE_MIN + Math.random() * (M.NOT_FOUND_CHANCE_MAX - M.NOT_FOUND_CHANCE_MIN);
        const found = Math.random() >= notFoundChance;
        if (found) {
          const amount = Math.max(1, Math.round(mine.goldTotal * M.EXTRACT_PCT));
          mine.status = 'extracting';
          mine.extractAmount = Math.min(amount, mine.goldLeft);
          mine.extractReadyAt = now + M.GOLD_READY_DELAY_MS;
          mine.pendingResult = 'found';
        } else {
          mine.status = 'idle';
          mine.pendingResult = 'empty';
        }
      }
      // Сброс служебных полей спуска
      mine.terroristAttack = false;
      mine.terroristResolved = false;
      mine.terroristRollDone = false;
    }

    // Восстановление участка после обвала (статус остаётся 'collapsed',
    // фронт сам покажет когда можно строить — см. rebuildReadyAt в mineView)
  }
}

module.exports = { view, build, rebuild, descend, fightTerrorists, collectGold, refreshAll };
