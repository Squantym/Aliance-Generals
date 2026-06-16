// ===================================================================
// src/services/buildings.js — раздел «Постройки»
// Доходные дают $/час (выплата раз в 60 минут), оборонительные —
// очки защиты, которые снижают потери и грабёж при налётах.
// Цена каждой следующей копии растёт (доходные ×1.04, оборонительные ×1.05).
// ===================================================================

const config = require('../../config/gameConfig');
const u = require('../core/utils');
const player = require('./player');
const ach = require('./achievements');
const tutorial = require('./tutorial');
const discounts = require('./discounts');

// Базовая стоимость покупки qty копий (без скидки администратора)
function baseCostFor(b, owned, qty) {
  const growth = config.BUILDING_PRICE_GROWTH[b.kind];
  let total = 0;
  for (let i = 0; i < qty; i++) {
    total += Math.round(b.price * Math.pow(growth, owned + i));
  }
  return Math.round(total);
}
// Итоговая цена с учётом скидки администратора и страны игрока
function costFor(user, b, owned, qty) {
  let base = baseCostFor(b, owned, qty);
  const country = config.COUNTRY_BY_ID[user.country];
  if (country && country.mod.buildingCost) base = Math.round(base * country.mod.buildingCost);
  return discounts.applyTo('building', base);
}

function viewOne(user, b) {
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

function list(user) {
  const now = Date.now();
  return {
    income: config.INCOME_BUILDINGS.filter((b) => b.unlock <= user.level + 10).map((b) => viewOne(user, { ...b, kind: 'income' })),
    defense: config.DEFENSE_BUILDINGS.filter((b) => b.unlock <= user.level + 10).map((b) => viewOne(user, { ...b, kind: 'defense' })),
    totals: {
      incomePerHour: player.totalIncome(user),
      upkeepPerHour: player.totalUpkeep(user),
      defensePoints: player.buildingDef(user),
      nextPayoutSec: Math.max(0, Math.ceil((user.lastIncomeAt + config.INCOME_PERIOD_MS - now) / 1000)),
    },
    discount: discounts.info('building'),
  };
}

function build(user, buildingId, qty, notices) {
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
  if (b.kind === 'income') tutorial.notify(user, 'build_income', notices); // задание «Тыл решает»
  return { buildingId, owned: user.buildings[buildingId], spent: cost };
}

module.exports = { list, build, costFor };
