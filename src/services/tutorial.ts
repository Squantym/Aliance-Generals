// ===================================================================
// src/services/tutorial.ts — сюжетное обучение «Курс молодого бойца»
// Сервисы сообщают сюда о событиях (атака, покупка техники и т.д.),
// а этот модуль двигает игрока по цепочке заданий и выдаёт награды.
// Финал: +100 золота из «спецрезерва Генштаба».
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import notifications = require('./notifications');
import type { User, Notices } from '../types';

// event — кодовое имя события: attack, buy_unit, mission_step,
// build_income, skill_spent (см. config.TUTORIAL)
function notify(user: User, event: string, notices: Notices): void {
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
    notifications.push(user.id, 'story_epilogue', 'Спецрезерв Генштаба', { text: config.STORY_EPILOGUE });
  }
}

export = { notify };
