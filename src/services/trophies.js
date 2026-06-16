// ===================================================================
// src/services/trophies.js — трофеи с прокачкой во времени
// Прокачка не моментальная: 60 минут на 1 уровень. Можно ускорить за
// 50 золота (мгновенно). За раз можно прокачивать несколько трофеев
// параллельно — у каждого свой таймер.
// ===================================================================

const config = require('../../config/gameConfig');
const u = require('../core/utils');
const discounts = require('./discounts');

function levelOf(user, id) { return (user.trophies && user.trophies[id]) || 0; }

// Базовая стоимость прокачки и со скидкой (учитываем флаг expensive)
function baseNextCost(level, def) {
  return config.trophyUpgradeCost(level, !!(def && def.expensive));
}
function nextCost(level, def) {
  return discounts.applyTo('trophy', baseNextCost(level, def));
}

// Активный процесс прокачки конкретного трофея (или null)
function activeFor(user, id) {
  if (!user.trophyQueue) user.trophyQueue = [];
  return user.trophyQueue.find((p) => p.id === id) || null;
}

// Текущий процентный бонус трофея (используется в applyTo)
function bonusOf(user, id) {
  const def = config.TROPHIES.find((t) => t.id === id);
  if (!def) return 0;
  return levelOf(user, id) * def.perLvl;
}

// Снижение цены по категории (для лечения, банка и т.п.)
function discountPct(user, applyKey) {
  let pct = 0;
  for (const def of config.TROPHIES) {
    if (def.apply === applyKey) pct += levelOf(user, def.id) * def.perLvl;
  }
  return pct;
}

// Завершение готовых процессов прокачки (вызывается из player.refresh)
function checkCompleted(user) {
  if (!user.trophyQueue || user.trophyQueue.length === 0) return;
  const now = Date.now();
  const remaining = [];
  for (const proc of user.trophyQueue) {
    if (proc.finishesAt <= now) {
      // Применяем уровень
      if (!user.trophies) user.trophies = {};
      user.trophies[proc.id] = (user.trophies[proc.id] || 0) + 1;
    } else {
      remaining.push(proc);
    }
  }
  user.trophyQueue = remaining;
}

// Список трофеев для UI
function list(user) {
  return {
    maxLevel: config.TROPHY_MAX_LEVEL,
    boostGoldCost: config.TROPHY_BOOST_GOLD,
    discount: discounts.info('trophy'),
    trophies: config.TROPHIES.map((t) => {
      const level = levelOf(user, t.id);
      const active = activeFor(user, t.id);
      const targetLevel = level + 1;
      const trainMin = config.trophyTrainMinutes(targetLevel);
      const secLeft = active ? Math.max(0, Math.floor((active.finishesAt - Date.now()) / 1000)) : 0;
      return {
        id: t.id, name: t.name, desc: t.desc, level, flavor: !!t.flavor, expensive: !!t.expensive,
        bonusNow: level * t.perLvl,
        bonusNext: level < config.TROPHY_MAX_LEVEL ? targetLevel * t.perLvl : null,
        baseNextCost: level < config.TROPHY_MAX_LEVEL ? baseNextCost(level, t) : null,
        nextCost:     level < config.TROPHY_MAX_LEVEL ? nextCost(level, t) : null,
        trainMinutes: level < config.TROPHY_MAX_LEVEL ? trainMin : null,
        training: !!active,
        secondsLeft: secLeft,
        totalSec: active ? Math.round((active.finishesAt - active.startedAt) / 1000) : 0,
      };
    }),
  };
}

// Запустить прокачку трофея: списываем золото, ставим в очередь
function startUpgrade(user, id, notices) {
  const def = config.TROPHIES.find((t) => t.id === id);
  if (!def) throw new u.ApiError('Такого трофея не существует');
  const level = levelOf(user, id);
  if (level >= config.TROPHY_MAX_LEVEL) throw new u.ApiError('Трофей уже максимального уровня');
  if (activeFor(user, id)) throw new u.ApiError('Этот трофей уже прокачивается');
  const cost = nextCost(level, def);
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  user.gold -= cost;
  if (!user.trophyQueue) user.trophyQueue = [];
  const now = Date.now();
  const targetLevel = level + 1;
  const minutes = config.trophyTrainMinutes(targetLevel);
  user.trophyQueue.push({
    id, level: targetLevel,
    startedAt: now,
    finishesAt: now + minutes * 60 * 1000,
  });
  notices.push(`📦 «${def.name}» взят в прокачку: готово через ${formatMinutes(minutes)}.`);
  return { id, level: targetLevel };
}

// Форматирование минут в "Xч Yм" или "Xсуток Yч" для удобного чтения
function formatMinutes(min) {
  if (min < 60) return `${min} мин`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} ч ${min % 60} мин`;
  const days = Math.floor(min / (24 * 60));
  const hours = Math.floor((min % (24 * 60)) / 60);
  return `${days} сут ${hours} ч`;
}

// Ускорить прокачку: списываем 50 золота и завершаем мгновенно
function boostUpgrade(user, id, notices) {
  const proc = activeFor(user, id);
  if (!proc) throw new u.ApiError('Этот трофей сейчас не прокачивается');
  if (user.gold < config.TROPHY_BOOST_GOLD) throw new u.ApiError(`Нужно ${config.TROPHY_BOOST_GOLD} золота`);
  user.gold -= config.TROPHY_BOOST_GOLD;
  proc.finishesAt = Date.now();
  notices.push('⚡ Прокачка трофея ускорена!');
  return { ok: true };
}

// Совокупный множитель: +N% к атаке от трофея medal (доли единицы)
function atkBonus(user) {
  const def = config.TROPHIES.find((t) => t.id === 'medal');
  return (levelOf(user, 'medal') * (def ? def.perLvl : 0)) / 100;
}
// +N% к защите от shield
function defBonus(user) {
  const def = config.TROPHIES.find((t) => t.id === 'shield');
  return (levelOf(user, 'shield') * (def ? def.perLvl : 0)) / 100;
}
// Дополнительная сила крита от license: пример +50% к множителю крита на ур.10
function critPower(user) {
  const def = config.TROPHIES.find((t) => t.id === 'license');
  return (levelOf(user, 'license') * (def ? def.perLvl : 0)) / 100;
}
// Множитель энергии на миссиях от radar (меньше = выгоднее)
function missionEnergyMul(user) {
  const def = config.TROPHIES.find((t) => t.id === 'radar');
  const pct = levelOf(user, 'radar') * (def ? def.perLvl : 0);
  return Math.max(0.5, 1 - pct / 100); // максимум −50%
}

module.exports = {
  list, startUpgrade, boostUpgrade, bonusOf, discountPct, checkCompleted,
  atkBonus, defBonus, critPower, missionEnergyMul,
};
