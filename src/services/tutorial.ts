// ===================================================================
// src/services/tutorial.ts — сюжетное обучение «Курс молодого бойца»
// Сервисы сообщают сюда о событиях (атака, покупка техники и т.д.),
// а этот модуль двигает игрока по цепочке заданий и выдаёт награды.
// Финал: +100 золота из «спецрезерва Генштаба».
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import notifications = require('./notifications');
import type { User, Notices } from '../types';

// event — кодовое имя события: attack, buy_unit, mission_step,
// build_income, chat, quest_done, ally_join, market_buff,
// market_container, skill_spent (см. config.TUTORIAL)
//
// amount — сколько засчитать за один вызов. Покупка сразу тридцати
// машин — это тридцать, а не одна: иначе задание «купи 30 единиц»
// требовало бы тридцати отдельных нажатий.
function notify(user: User, event: string, notices: Notices, amount?: number): void {
  // Проверка «поле вообще есть» обязательна: обучение появилось позже
  // самой игры, и у аккаунтов, заведённых до него или служебными
  // скриптами, его нет. Обращение к user.tutorial.done роняло ВЕСЬ бой
  // уже ПОСЛЕ того, как обе стороны изменены — техника списана, добыча
  // начислена, — а игрок получал «внутреннюю ошибку сервера».
  if (!user.tutorial || user.tutorial.done) return;
  const quest: any = config.TUTORIAL[user.tutorial.step];
  if (!quest || quest.event !== event) return; // событие не из текущего задания

  // Копим прогресс, пока не наберётся нужное количество
  const need = Math.max(1, Number(quest.need) || 1);
  const add = quest.amount ? Math.max(1, Math.floor(Number(amount) || 1)) : 1;
  const done = Math.min(need, (Number((user.tutorial as any).progress) || 0) + add);
  if (done < need) {
    (user.tutorial as any).progress = done;
    db.markUser(user.id);
    return;
  }
  (user.tutorial as any).progress = 0;

  // Награда за выполненное задание
  player.addMoney(user, quest.dollars, true);
  player.addXp(user, quest.xp, notices);
  if ((quest as any).gold) player.addGold(user, (quest as any).gold, 'tutorial'); // разовое золото на этом шаге
  user.tutorial.step++;
  const goldNote = (quest as any).gold ? ` и 🪙 ${(quest as any).gold}` : '';
  notices.push(`📜 Задание Майора «${quest.title}» выполнено! Награда: $${u.fmt(quest.dollars)}, ${quest.xp} опыта${goldNote}.`);

  // Все задания пройдены — финал сюжета и донатная награда
  if (user.tutorial.step >= config.TUTORIAL.length) {
    user.tutorial.done = true;
    player.addGold(user, config.TUTORIAL_FINAL_GOLD, 'tutorial');
    notices.push(`🏅 Курс молодого бойца пройден! +🪙 ${config.TUTORIAL_FINAL_GOLD} золота из спецрезерва Генштаба.`);
    notifications.push(user.id, 'story_epilogue', 'Спецрезерв Генштаба', { text: config.STORY_EPILOGUE });
  }
}

export = { notify };
