// ===================================================================
// src/services/buildings.ts — раздел «Постройки»
// Доходные дают $/час (выплата раз в 60 минут), оборонительные —
// очки защиты, которые снижают потери и грабёж при налётах.
// Цена каждой следующей копии растёт (доходные ×1.04, оборонительные ×1.05).
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import ach = require('./achievements');
import tutorial = require('./tutorial');
import discounts = require('./discounts');
import type { User, Notices } from '../types';

// Базовая стоимость покупки qty копий (без скидки администратора)
function baseCostFor(b: any, owned: number, qty: number): number {
  const growth = config.BUILDING_PRICE_GROWTH[b.kind];
  let total = 0;
  for (let i = 0; i < qty; i++) {
    total += Math.round(b.price * Math.pow(growth, owned + i));
  }
  return Math.round(total);
}
// Итоговая цена с учётом скидки администратора и страны игрока
function costFor(user: User, b: any, owned: number, qty: number): number {
  let base = baseCostFor(b, owned, qty);
  const country = config.COUNTRY_BY_ID[user.country];
  if (country && country.mod.buildingCost) base = Math.round(base * country.mod.buildingCost);
  return discounts.applyTo('building', base);
}

function viewOne(user: User, b: any) {
  const owned = user.buildings[b.id] || 0;
  return {
    id: b.id, name: b.name, kind: b.kind,
    income: b.income || 0, def: b.def || 0,
    unlock: b.unlock, locked: b.unlock > user.level,
    owned,
    baseNextPrice: baseCostFor(b, owned, 1),
    nextPrice: costFor(user, b, owned, 1),
  };
}

function list(user: User) {
  const now = Date.now();
  // Фильтр витрины: показываем открытые + те, что откроются в ближайшие 10 ур.
  // Но если так ничего не попадает (все постройки ещё далеко по уровню) —
  // показываем хотя бы ближайшую открывающуюся, чтобы игрок видел, с какого
  // уровня раздел станет доступен (иначе вкладка пустая).
  const visibleFilter = (arr: any[]) => {
    let vis = arr.filter((b) => b.unlock <= user.level + 10);
    if (vis.length === 0 && arr.length > 0) {
      // ближайшая по уровню заблокированная
      const next = arr.slice().sort((a, b) => a.unlock - b.unlock)[0];
      vis = [next];
    }
    return vis;
  };
  return {
    income: visibleFilter(config.INCOME_BUILDINGS).map((b) => viewOne(user, { ...b, kind: 'income' })),
    defense: visibleFilter(config.DEFENSE_BUILDINGS).map((b) => viewOne(user, { ...b, kind: 'defense' })),
    totals: {
      incomePerHour: player.totalIncome(user),
      upkeepPerHour: player.totalUpkeep(user),
      defensePoints: player.buildingDef(user),
      nextPayoutSec: Math.max(0, Math.ceil((user.lastIncomeAt + config.INCOME_PERIOD_MS - now) / 1000)),
    },
    discount: discounts.info('building'),
  };
}

function build(user: User, buildingId: string, qty: number, notices: Notices) {
  const b = config.BUILDING_BY_ID[buildingId];
  if (!b) throw new u.ApiError('Такой постройки не существует');
  if (user.level < b.unlock) throw new u.ApiError(`Откроется на ${b.unlock} уровне`);
  qty = u.clamp(u.toInt(qty, 1), 1, 100000);
  const owned = user.buildings[buildingId] || 0;
  const cost = costFor(user, b, owned, qty);
  if (user.dollars < cost) throw new u.ApiError(`Не хватает денег (нужно $${u.fmt(cost)})`);
  user.dollars -= cost;
  user.buildings[buildingId] = owned + qty;
  ach.bump(user, 'buildingsBuilt', qty, notices);
  require('./dailyQuests').bump(user, 'buildingsBuilt', qty);
  if (b.kind === 'income') tutorial.notify(user, 'build_income', notices); // задание «Тыл решает»
  return { buildingId, owned: user.buildings[buildingId], spent: cost };
}

export = { list, build, costFor };
