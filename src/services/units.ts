// ===================================================================
// src/services/units.ts — раздел «Техника»
// Три типа: наземная (баланс), воздушная (атака), морская (защита).
// Новая единица открывается каждые 3 уровня. Китай покупает на 5% дешевле.
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import ach = require('./achievements');
import tutorial = require('./tutorial');
import discounts = require('./discounts');
import type { User, Notices } from '../types';

// Цена с учётом бонуса страны (Китай −5%) и активной скидки администратора
// Базовая цена со страновым модификатором, без скидки администратора
function basePriceFor(user: User, cu: any): number {
  const country = config.COUNTRY_BY_ID[user.country];
  const mult = (country && country.mod.unitCost) || 1;
  return Math.round(cu.price * mult);
}
function priceFor(user: User, cu: any): number {
  return discounts.applyTo('unit', basePriceFor(user, cu));
}

// Каталог: показываем открытую технику и «превью» ближайших трёх уровней
function list(user: User) {
  const items = config.UNITS
    .filter((cu) => cu.unlock <= user.level + 3)
    .map((cu) => {
      const m = user.units[cu.id] || {};
      // Для отображения статов берём множитель самого высокого имеющегося mk
      const highestMk = (m[2] || 0) > 0 ? 2 : ((m[1] || 0) > 0 ? 1 : 0);
      const mult = config.MK_MULT[highestMk];
      const total = (m[0] || 0) + (m[1] || 0) + (m[2] || 0);
      return {
        id: cu.id, type: cu.type, typeName: config.UNIT_TYPE_NAMES[cu.type],
        name: cu.name, unlock: cu.unlock, locked: cu.unlock > user.level,
        attack: Math.round(cu.attack * mult), defense: Math.round(cu.defense * mult),
        baseAttack: cu.attack, baseDefense: cu.defense,
        mk: highestMk, upkeep: cu.upkeep,
        basePrice: basePriceFor(user, cu),
        price: priceFor(user, cu),
        owned: total,
        ownedMk: { 0: m[0] || 0, 1: m[1] || 0, 2: m[2] || 0 },
      };
    });
  return {
    items,
    upkeepPerHour: player.totalUpkeep(user),
    discount: discounts.info('unit'),
  };
}

// Покупка qty единиц техники — всегда попадают в Mk0
function buy(user: User, unitId: string, qty: number, notices: Notices) {
  const cu = config.UNIT_BY_ID[unitId];
  if (!cu) throw new u.ApiError('Такой техники не существует');
  if (user.level < cu.unlock) throw new u.ApiError(`Откроется на ${cu.unlock} уровне`);
  qty = u.clamp(u.toInt(qty, 1), 1, 1000000);
  const cost = priceFor(user, cu) * qty;
  if (user.dollars < cost) throw new u.ApiError(`Не хватает денег (нужно $${u.fmt(cost)})`);
  user.dollars -= cost;
  const m = player.ensureUnit(user, unitId);
  m[0] += qty;
  ach.bump(user, 'unitsBought', qty, notices);
  require('./dailyQuests').bump(user, 'unitsBought', qty);
  tutorial.notify(user, 'buy_unit', notices);
  return { unitId, owned: player.unitTotalCount(user, unitId), spent: cost };
}

// Продажа за 50% цены — забираем сначала Mk0, потом Mk1, потом Mk2
function sell(user: User, unitId: string, qty: number) {
  const cu = config.UNIT_BY_ID[unitId];
  if (!cu) throw new u.ApiError('Такой техники не существует');
  qty = u.clamp(u.toInt(qty, 1), 1, 1000000);
  const total = player.unitTotalCount(user, unitId);
  if (total < qty) throw new u.ApiError('У вас нет столько единиц');
  const m = user.units[unitId];
  let left = qty;
  for (let mk = 0; mk <= 2 && left > 0; mk++) {
    const take = Math.min(m[mk] || 0, left);
    m[mk] -= take;
    left -= take;
  }
  const refund = Math.floor(priceFor(user, cu) * 0.5) * qty;
  if (player.unitTotalCount(user, unitId) <= 0) delete user.units[unitId];
  player.addMoney(user, refund, false);
  return { unitId, owned: user.units[unitId] || 0, refund };
}

export = { list, buy, sell };
