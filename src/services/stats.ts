// ═══════════════════════════════════════════════════════════════════
// src/services/stats.ts — расширенная статистика игрока (VIP, пункт 9)
//
// Игра считала лишь несколько общих счётчиков. Здесь копится подробная
// картина: сколько заработано и потеряно, откуда пришло золото, что
// куплено и потеряно по родам войск.
//
// Всё пишется в user.stats через одну функцию track(): так добавить
// новый источник — одна строка в месте события, а не правка структуры.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import type { User } from '../types';

// Источники золота — по ним строится разбивка в отчёте
const GOLD_SOURCES: Record<string, string> = {
  quest: 'Поручения',
  contract: 'Контракты',
  season: 'Сезоны',
  event: 'События',
  purchase: 'Покупки',
  admin: 'Выдано администрацией',
  referral: 'Приглашения',
  achievement: 'Достижения',
  login: 'Награда за вход',
  other: 'Прочее',
};

function box(user: any): any {
  if (!user.stats) {
    user.stats = {
      firstSeen: user.createdAt || Date.now(),
      playMs: 0,             // время в игре
      lastTickAt: 0,         // для подсчёта времени
      moneyEarned: 0, moneySpent: 0, moneyLost: 0,
      goldGot: {},           // по источникам
      goldSpent: {},         // по назначению
      unitsBought: {}, unitsLost: {},        // по родам войск
      sabBought: {}, sabLost: {},            // по типам диверсантов
    };
  }
  return user.stats;
}

// Единая точка учёта. kind — что произошло, key — уточнение
// (источник золота, род войск), amount — сколько.
function track(user: any, kind: string, key: string, amount: number): void {
  if (!user || !amount) return;
  const st = box(user);
  const n = Math.abs(Math.round(Number(amount) || 0));
  if (!n) return;
  switch (kind) {
    case 'moneyEarned': st.moneyEarned += n; break;
    case 'moneySpent':  st.moneySpent += n; break;
    case 'moneyLost':   st.moneyLost += n; break;
    case 'goldGot':     st.goldGot[key || 'other'] = (st.goldGot[key || 'other'] || 0) + n; break;
    case 'goldSpent':   st.goldSpent[key || 'other'] = (st.goldSpent[key || 'other'] || 0) + n; break;
    case 'unitsBought': st.unitsBought[key] = (st.unitsBought[key] || 0) + n; break;
    case 'unitsLost':   st.unitsLost[key] = (st.unitsLost[key] || 0) + n; break;
    case 'sabBought':   st.sabBought[key] = (st.sabBought[key] || 0) + n; break;
    case 'sabLost':     st.sabLost[key] = (st.sabLost[key] || 0) + n; break;
    default: return;
  }
  db.markUser(user.id);
}

// Время в игре. Считаем по обращениям к серверу: промежутки дольше
// 10 минут не засчитываем — человек просто ушёл, а не играл.
function tickPlayTime(user: any): void {
  const st = box(user);
  const now = Date.now();
  const last = st.lastTickAt || 0;
  const gap = now - last;
  if (last && gap > 0 && gap < 10 * 60 * 1000) st.playMs += gap;
  st.lastTickAt = now;
}

// ---------- Отчёт ----------
function report(user: any): any {
  const st = box(user);
  const now = Date.now();
  const sum = (o: any) => Object.values(o || {}).reduce((a: any, b: any) => a + b, 0) as number;

  const firstSeen = st.firstSeen || user.createdAt || now;
  const daysInService = Math.max(1, Math.floor((now - firstSeen) / 86400000));

  const named = (o: any, dict?: Record<string, string>) =>
    Object.entries(o || {})
      .map(([k, v]) => ({ id: k, label: (dict && dict[k]) || k, value: v as number }))
      .sort((a, b) => b.value - a.value);

  const UNIT_LABELS: Record<string, string> = { ground: 'Наземная', air: 'Воздушная', sea: 'Морская' };
  const SAB_LABELS: Record<string, string> = {
    ground: 'Наземные', sea: 'Морские', air: 'Воздушные',
    secret: 'Секретные', building: 'По постройкам', suicide: 'Смертники',
  };

  return {
    // Время
    hoursInGame: Math.round((st.playMs || 0) / 3600000 * 10) / 10,
    daysInService,
    firstSeen,

    // Деньги
    money: {
      earned: st.moneyEarned || 0,
      spent: st.moneySpent || 0,
      lost: st.moneyLost || 0,
      balance: (st.moneyEarned || 0) - (st.moneySpent || 0) - (st.moneyLost || 0),
      now: user.dollars || 0,
      bank: user.bank || 0,
    },

    // Золото по источникам и тратам
    gold: {
      total: sum(st.goldGot),
      spent: sum(st.goldSpent),
      now: user.gold || 0,
      bySource: named(st.goldGot, GOLD_SOURCES),
      bySpending: named(st.goldSpent),
    },

    // Техника и диверсанты
    units: {
      bought: sum(st.unitsBought),
      lost: sum(st.unitsLost),
      byTypeBought: named(st.unitsBought, UNIT_LABELS),
      byTypeLost: named(st.unitsLost, UNIT_LABELS),
    },
    saboteurs: {
      bought: sum(st.sabBought),
      lost: sum(st.sabLost),
      byTypeBought: named(st.sabBought, SAB_LABELS),
      byTypeLost: named(st.sabLost, SAB_LABELS),
    },

    // Бой — из общих счётчиков игры
    battle: {
      attacks: (user.counters || {}).attacks || 0,
      wins: (user.counters || {}).wins || 0,
      fatalities: (user.counters || {}).fatalities || 0,
      earsCut: (user.counters || {}).earsCut || 0,
      buildingsBuilt: (user.counters || {}).buildingsBuilt || 0,
      missionStages: (user.counters || {}).missionStages || 0,
    },
  };
}

export = { track, tickPlayTime, report, GOLD_SOURCES };
