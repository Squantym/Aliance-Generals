// ===================================================================
// src/services/dailyQuests.ts — система ежедневных заданий
// Каждое задание привязано к счётчику (attacks, wins, missionStages...)
// Эти счётчики ведутся в user.dailyCounters и обнуляются раз в сутки.
// За выполнение каждого задания — опыт и деньги (масштаб от уровня).
// За выполнение ВСЕХ заданий — бонус 100 золота.
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import type { User, Notices } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

// Возвращает «номер сегодняшнего дня» (UTC), используется для сброса
function todayUtcKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

// Гарантирует, что у игрока есть структура дневных счётчиков.
// Если день сменился — все счётчики обнуляются и награды снимаются.
function ensureDaily(user: User): any {
  const today = todayUtcKey();
  if (!(user as any).daily || (user as any).daily.day !== today) {
    (user as any).daily = {
      day: today,
      counters: {},
      claimed: {},      // id задания -> true, если награда уже получена
      bonusClaimed: false,
    };
  }
  if (!(user as any).daily.counters) (user as any).daily.counters = {};
  if (!(user as any).daily.claimed) (user as any).daily.claimed = {};
  return (user as any).daily;
}

// Увеличить счётчик задания (вызывается из боя, покупки и т.п.)
//   key: 'attacks' | 'wins' | 'missionStages' | 'unitsBought' | ...
function bump(user: User, key: string, amount?: number): void {
  const d = ensureDaily(user);
  d.counters[key] = (d.counters[key] || 0) + (amount || 1);
}

// Список заданий с прогрессом для UI
function list(user: User) {
  const d = ensureDaily(user);
  const reward = config.dailyQuestReward(user.level);
  const quests = config.DAILY_QUESTS.map((q) => {
    const target = config.dailyQuestTarget(q.target, user.level);
    const progress = d.counters[q.counter] || 0;
    const done = progress >= target;
    const claimed = !!d.claimed[q.id];
    return {
      id: q.id, name: q.name, icon: q.icon,
      target, progress: Math.min(progress, target),
      done, claimed,
    };
  });
  const doneCount = quests.filter((q) => q.done).length;
  const allDone = doneCount === quests.length;
  return {
    quests,
    reward,
    allDone,
    doneCount,
    total: quests.length,
    bonusGold: config.dailyAllBonusGold(user.level),
    bonusClaimed: !!d.bonusClaimed,
    resetInHours: hoursUntilReset(),
  };
}

function hoursUntilReset(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.ceil((tomorrow.getTime() - now.getTime()) / 3600000);
}

// Забрать награду за конкретное задание
function claim(user: User, questId: string, notices: Notices) {
  const d = ensureDaily(user);
  const quest = config.DAILY_QUESTS.find((q) => q.id === questId);
  if (!quest) throw new u.ApiError('Задание не найдено');
  if (d.claimed[questId]) throw new u.ApiError('Награда за это задание уже получена');
  const target = config.dailyQuestTarget(quest.target, user.level);
  const progress = d.counters[quest.counter] || 0;
  if (progress < target) throw new u.ApiError('Задание ещё не выполнено');
  d.claimed[questId] = true;
  const reward = config.dailyQuestReward(user.level);
  player.addMoney(user, reward.dollars, true);
  player.addXp(user, reward.xp, notices);
  notices.push(`🎁 Награда за «${quest.name}»: +${reward.xp} XP, +$${u.fmt(reward.dollars)}`);
  return reward;
}

// Забрать бонус за выполнение всех заданий (100 золота)
function claimBonus(user: User, notices: Notices) {
  const d = ensureDaily(user);
  if (d.bonusClaimed) throw new u.ApiError('Бонус уже получен сегодня');
  const allDone = config.DAILY_QUESTS.every((q) => (d.counters[q.counter] || 0) >= config.dailyQuestTarget(q.target, user.level));
  if (!allDone) throw new u.ApiError('Выполните все задания чтобы получить бонус');
  d.bonusClaimed = true;
  const bonus = config.dailyAllBonusGold(user.level);
  player.addGold(user, bonus);
  notices.push(`🎉 Все задания выполнены! Бонус: 🪙 ${bonus}`);
  return { gold: bonus };
}

export = { bump, list, claim, claimBonus, ensureDaily };
