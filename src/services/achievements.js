// ===================================================================
// src/services/achievements.js — система достижений
// У каждой цели 5 этапов. Награды выдаются автоматически, как только
// счётчик игрока проходит очередной порог.
// ===================================================================

const config = require('../../config/gameConfig');
const u = require('../core/utils');
const player = require('./player');
const social = require('./social');

// Увеличить счётчик и сразу проверить пороги
function bump(user, counter, delta, notices) {
  if (delta) user.counters[counter] = (user.counters[counter] || 0) + delta;
  check(user, notices);
}

// Полная проверка всех достижений (дёшево, вызывается после действий)
function check(user, notices) {
  for (const a of config.ACHIEVEMENTS) {
    // Особый случай: «Ветеран» смотрит на уровень напрямую
    const value = a.counter === 'level' ? user.level : (user.counters[a.counter] || 0);
    let stage = 0;
    for (const threshold of a.steps) if (value >= threshold) stage++;
    const claimed = user.achStages[a.id] || 0;
    // Выдаём награды за все новые этапы по очереди
    for (let s = claimed + 1; s <= stage; s++) {
      const dollars = config.ACH_DOLLARS[s - 1];
      const gold = config.ACH_GOLD[s - 1];
      player.addMoney(user, dollars, true);
      if (gold) player.addGold(user, gold);
      const text = `🏆 Достижение «${a.name}» — этап ${s}/5! Награда: $${u.fmt(dollars)}${gold ? ` и 🪙 ${gold}` : ''}`;
      if (notices) notices.push(text);
      social.systemMail(user, `Достижение: ${a.name}`, text);
    }
    if (stage > claimed) user.achStages[a.id] = stage;
  }
}

// Список достижений с прогрессом для экрана «Достижения»
function list(user) {
  return {
    achievements: config.ACHIEVEMENTS.map((a) => {
      const value = a.counter === 'level' ? user.level : (user.counters[a.counter] || 0);
      const stage = user.achStages[a.id] || 0;
      const next = stage < 5 ? a.steps[stage] : null;
      return {
        id: a.id, name: a.name, desc: a.desc,
        value, stage, steps: a.steps, next,
        progress: next ? Math.min(1, value / next) : 1,
      };
    }),
  };
}

module.exports = { bump, check, list };
