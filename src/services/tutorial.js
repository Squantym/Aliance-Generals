// ===================================================================
// src/services/tutorial.js — сюжетное обучение «Курс молодого бойца»
// Сервисы сообщают сюда о событиях (атака, покупка техники и т.д.),
// а этот модуль двигает игрока по цепочке заданий и выдаёт награды.
// Финал: +100 золота из «спецрезерва Генштаба».
// ===================================================================

const config = require('../../config/gameConfig');
const u = require('../core/utils');
const player = require('./player');
const social = require('./social');

// event — кодовое имя события: attack, buy_unit, mission_step,
// build_income, skill_spent (см. config.TUTORIAL)
function notify(user, event, notices) {
  if (user.tutorial.done) return;
  const quest = config.TUTORIAL[user.tutorial.step];
  if (!quest || quest.event !== event) return; // событие не из текущего задания

  // Награда за выполненное задание
  player.addMoney(user, quest.dollars, true);
  player.addXp(user, quest.xp, notices);
  user.tutorial.step++;
  notices.push(`📜 Задание Майора «${quest.title}» выполнено! Награда: $${u.fmt(quest.dollars)} и ${quest.xp} опыта.`);

  // Все задания пройдены — финал сюжета и донатная награда
  if (user.tutorial.step >= config.TUTORIAL.length) {
    user.tutorial.done = true;
    player.addGold(user, config.TUTORIAL_FINAL_GOLD);
    notices.push(`🏅 Курс молодого бойца пройден! +🪙 ${config.TUTORIAL_FINAL_GOLD} золота из спецрезерва Генштаба.`);
    social.systemMail(user, 'Спецрезерв Генштаба', config.STORY_EPILOGUE);
  }
}

module.exports = { notify };
