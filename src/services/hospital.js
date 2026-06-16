// ===================================================================
// src/services/hospital.js — полевой госпиталь
// За доллары мгновенно восстанавливает всё здоровье до максимума.
// Цена растёт с уровнем по формуле 5000 × L^1.8.
// ===================================================================

const config = require('../../config/gameConfig');
const u = require('../core/utils');
const player = require('./player');

// Цена лечения для текущего игрока (с учётом скидки на трофей «Полевой госпиталь»)
function priceFor(user) {
  let price = config.hospitalPrice(user.level);
  // Трофей «Полевой госпиталь» снижает цену лечения (если есть)
  const discountPct = player.trophyDiscountPct ? player.trophyDiscountPct(user, 'hospital') : 0;
  price = Math.floor(price * (1 - discountPct / 100));
  return Math.max(1, price);
}

function view(user) {
  const max = player.maxima(user);
  return {
    hp: user.res.hp.cur,
    maxHp: max.hp,
    fullHeal: priceFor(user),
    baseFullHeal: config.hospitalPrice(user.level),
    dollars: user.dollars,
  };
}

function heal(user, notices) {
  const max = player.maxima(user);
  if (user.res.hp.cur >= max.hp) {
    throw new u.ApiError('Вы и так в полном здравии, лечение не требуется');
  }
  const price = priceFor(user);
  if (user.dollars < price) {
    throw new u.ApiError(`Лечение стоит $${u.fmt(price)} — не хватает денег`);
  }
  user.dollars -= price;
  user.res.hp.cur = max.hp;
  user.res.hp.t = Date.now();
  notices.push(`🏥 Здоровье восстановлено. Лечение обошлось в $${u.fmt(price)}.`);
  return { hp: user.res.hp.cur, maxHp: max.hp, spent: price };
}

module.exports = { view, heal };
