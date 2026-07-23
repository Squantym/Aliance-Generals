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

// Активные поручения на сегодня (9 из 20, детерминированно по дню)
function activeQuestIds(user: User): string[] {
  const d = ensureDaily(user);
  return config.pickDailyQuests(d.day);
}

// Список активных поручений с прогрессом и данными заказчика — для UI
function list(user: User) {
  const d = ensureDaily(user);
  const ids = config.pickDailyQuests(d.day);
  const quests = ids.map((id) => {
    const q = config.DAILY_QUEST_BY_ID[id];
    const target = config.dailyQuestTarget(q.base, q.diff, user.level);
    const progress = d.counters[q.counter] || 0;
    const done = progress >= target;
    const rw = config.dailyQuestReward(q.diff, user.level);
    const ch = config.DAILY_CHARS[q.char] || { name: 'Штаб', role: '', icon: '📌' };
    return {
      id: q.id, name: q.name, icon: q.icon, flavor: q.flavor, route: q.route || null,
      char: q.char, charName: ch.name, charRole: ch.role, charIcon: ch.icon, charIntro: (ch as any).intro || '',
      diff: q.diff, difficulty: q.diff >= 2.4 ? 'hard' : (q.diff >= 1.6 ? 'medium' : 'easy'),
      target, progress: Math.min(progress, target),
      done, claimed: !!d.claimed[q.id],
      reward: { xp: rw.xp, dollars: rw.dollars },
    };
  });
  const doneCount = quests.filter((q) => q.done).length;
  return {
    quests,
    allDone: doneCount === quests.length,
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

// Забрать награду за конкретное поручение (только из активных сегодня)
function claim(user: User, questId: string, notices: Notices) {
  const d = ensureDaily(user);
  if (!config.pickDailyQuests(d.day).includes(questId)) throw new u.ApiError('Это поручение сегодня недоступно');
  const quest = config.DAILY_QUEST_BY_ID[questId];
  if (!quest) throw new u.ApiError('Поручение не найдено');
  if (d.claimed[questId]) throw new u.ApiError('Награда за это поручение уже получена');
  const target = config.dailyQuestTarget(quest.base, quest.diff, user.level);
  const progress = d.counters[quest.counter] || 0;
  if (progress < target) throw new u.ApiError('Поручение ещё не выполнено');
  d.claimed[questId] = true;
  const reward = config.dailyQuestReward(quest.diff, user.level);
  player.addMoney(user, reward.dollars, true);
  player.addXp(user, reward.xp, notices);
  const ch = config.DAILY_CHARS[quest.char];
  notices.push(`🎁 ${ch ? ch.name + ': ' : ''}награда за «${quest.name}»: +${reward.xp} XP, +$${u.fmt(reward.dollars)}`);
  return reward;
}

// Забрать бонус за выполнение ВСЕХ активных поручений дня (золото)
function claimBonus(user: User, notices: Notices) {
  const d = ensureDaily(user);
  if (d.bonusClaimed) throw new u.ApiError('Бонус уже получен сегодня');
  const ids = config.pickDailyQuests(d.day);
  const allDone = ids.every((id) => {
    const q = config.DAILY_QUEST_BY_ID[id];
    return (d.counters[q.counter] || 0) >= config.dailyQuestTarget(q.base, q.diff, user.level);
  });
  if (!allDone) throw new u.ApiError('Выполните все поручения дня, чтобы получить бонус');
  d.bonusClaimed = true;
  const bonus = config.dailyAllBonusGold(user.level);
  player.addGold(user, bonus);
  notices.push(`🎉 Все поручения дня выполнены! Бонус: 🪙 ${bonus}`);
  return { gold: bonus };
}

export = { bump, list, claim, claimBonus, ensureDaily };
