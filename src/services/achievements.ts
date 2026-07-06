// ===================================================================
// src/services/achievements.ts — система достижений
// У каждой цели 5 этапов. Награды выдаются автоматически, как только
// счётчик игрока проходит очередной порог.
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import notifications = require('./notifications');
import type { User, Notices } from '../types';

// Увеличить счётчик и сразу проверить пороги
function bump(user: User, counter: string, delta: number, notices?: Notices): void {
  if (delta) (user.counters as any)[counter] = ((user.counters as any)[counter] || 0) + delta;
  check(user, notices);
}

// Полная проверка всех достижений (дёшево, вызывается после действий)
function check(user: User, notices?: Notices): void {
  for (const a of config.ACHIEVEMENTS) {
    // Особый случай: «Ветеран» смотрит на уровень напрямую
    const value = a.counter === 'level' ? user.level : ((user.counters as any)[a.counter] || 0);
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
      notifications.push(user.id, 'achievement', `Достижение: ${a.name}`, { text });
      // Разблокирован новый титул за эту ступень
      const titleName = ((a as any).titles || [])[s - 1];
      if (titleName && notices) notices.push(`🏅 Разблокирован титул «${titleName}»! Выберите его в разделе «Титулы».`);
    }
    if (stage > claimed) user.achStages[a.id] = stage;
  }
}

// Список достижений с прогрессом для экрана «Достижения»
function list(user: User) {
  return {
    achievements: config.ACHIEVEMENTS.map((a: any) => {
      const value = a.counter === 'level' ? user.level : ((user.counters as any)[a.counter] || 0);
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

export = { bump, check, list };
