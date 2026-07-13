// ===================================================================
// src/services/trophies.ts — трофеи с прокачкой во времени
// Прокачка не моментальная: 60 минут на 1 уровень. Можно ускорить за
// 50 золота (мгновенно). За раз можно прокачивать несколько трофеев
// параллельно — у каждого свой таймер.
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import discounts = require('./discounts');
import type { User, Notices } from '../types';

function levelOf(user: User, id: string): number { return (user.trophies && user.trophies[id]) || 0; }

// Базовая стоимость прокачки и со скидкой (учитываем флаг expensive)
function baseNextCost(level: number, def: any): number {
  return config.trophyUpgradeCost(level, !!(def && def.expensive), def && def.costMul);
}
function nextCost(level: number, def: any): number {
  return discounts.applyTo('trophy', baseNextCost(level, def));
}

// Активный процесс прокачки конкретного трофея (или null)
function activeFor(user: User, id: string): any {
  if (!(user as any).trophyQueue) (user as any).trophyQueue = [];
  return (user as any).trophyQueue.find((p: any) => p.id === id) || null;
}

// Текущий процентный бонус трофея (используется в applyTo)
function bonusOf(user: User, id: string): number {
  const def = config.TROPHIES.find((t) => t.id === id);
  if (!def) return 0;
  return levelOf(user, id) * def.perLvl;
}

// Снижение цены по категории (для лечения, банка и т.п.)
function discountPct(user: User, applyKey: string): number {
  let pct = 0;
  for (const def of config.TROPHIES) {
    if (def.apply === applyKey) pct += levelOf(user, def.id) * def.perLvl;
  }
  return pct;
}

// Завершение готовых процессов прокачки (вызывается из player.refresh)
function checkCompleted(user: User): void {
  if (!(user as any).trophyQueue || (user as any).trophyQueue.length === 0) return;
  const now = Date.now();
  const remaining: any[] = [];
  for (const proc of (user as any).trophyQueue) {
    if (proc.finishesAt <= now) {
      // Применяем уровень
      if (!user.trophies) user.trophies = {};
      user.trophies[proc.id] = (user.trophies[proc.id] || 0) + 1;
    } else {
      remaining.push(proc);
    }
  }
  (user as any).trophyQueue = remaining;
}

// Уровень разведывательного трофея (для features.spyOn)
function spyLevel(user: User): number { return levelOf(user, 'satellite'); }
// Уровень трофея взлома банков («Медвежатник») и мин («Растяжка»)
function bankHackLevel(user: User): number { return levelOf(user, 'safecracker'); }
function mineLevel(user: User): number { return levelOf(user, 'tripwire'); }

// Человекочитаемое описание, что рассекречивает спутник-шпион на данном уровне
function spyUnlockText(lvl: number): string {
  const r = config.spyReveal(lvl);
  if (lvl <= 0) return 'нужна прокачка';
  const parts: string[] = [];
  parts.push(`техника ${Math.round(r.units * 100)}%`);
  if (r.buildings != null) parts.push(`постройки ${Math.round(r.buildings * 100)}%`);
  if (r.secrets != null)   parts.push(`секретки ${Math.round(r.secrets * 100)}%`);
  if (r.live) parts.push('live 3 дня');
  return parts.join(', ');
}

// Текст для трофея «Медвежатник»: шанс окна / шанс успеха / % кражи
function bankHackText(lvl: number): string {
  const off = config.BANK_HACK.offerChancePct(lvl).toFixed(1).replace(/\.0$/, '');
  const succ = config.BANK_HACK.successChancePct[Math.max(0, Math.min(10, lvl))];
  const loot = config.BANK_HACK.lootPct[Math.max(0, Math.min(10, lvl))];
  return `окно ${off}%, успех ${succ}%, кража ${loot}%`;
}

// Текст для трофея «Растяжка»: шанс срабатывания мины / % урона техникой
function mineText(lvl: number): string {
  const trig = config.MINES.triggerChancePct[Math.max(0, Math.min(10, lvl))];
  const dmg = config.MINES.techLossPct[Math.max(0, Math.min(10, lvl))];
  return `срабатывание ${trig}%, урон техникой ${dmg}%`;
}

// Список трофеев для UI
function list(user: User) {
  return {
    maxLevel: config.TROPHY_MAX_LEVEL,
    boostGoldCost: config.TROPHY_BOOST_GOLD,
    discount: discounts.info('trophy'),
    trophies: config.TROPHIES.map((t) => {
      const level = levelOf(user, t.id);
      const active = activeFor(user, t.id);
      const targetLevel = level + 1;
      const trainMin = config.trophyTrainMinutes(targetLevel, (t as any).timeMul);
      const secLeft = active ? Math.max(0, Math.floor((active.finishesAt - Date.now()) / 1000)) : 0;
      const isSpy = !!(t as any).spy;
      const isBankHack = !!(t as any).bankHack;
      const isMine = !!(t as any).mine;
      const isTextTrophy = isSpy || isBankHack || isMine;
      const textFor = (lvl: number) => isSpy ? spyUnlockText(lvl) : isBankHack ? bankHackText(lvl) : mineText(lvl);
      return {
        id: t.id, name: t.name, desc: t.desc, level, flavor: !!t.flavor, expensive: !!t.expensive,
        spy: isSpy, bankHack: isBankHack, mine: isMine,
        // Для «текстовых» трофеев (спутник/медвежатник/растяжка) процентного
        // бонуса нет — вместо него человекочитаемое описание разблокировки.
        bonusNow:  isTextTrophy ? textFor(level) : level * t.perLvl,
        bonusNext: isTextTrophy
          ? (level < config.TROPHY_MAX_LEVEL ? textFor(targetLevel) : null)
          : (level < config.TROPHY_MAX_LEVEL ? targetLevel * t.perLvl : null),
        baseNextCost: level < config.TROPHY_MAX_LEVEL ? baseNextCost(level, t) : null,
        nextCost:     level < config.TROPHY_MAX_LEVEL ? nextCost(level, t) : null,
        trainMinutes: level < config.TROPHY_MAX_LEVEL ? trainMin : null,
        boostGold: level < config.TROPHY_MAX_LEVEL ? config.trophyBoostGold(targetLevel, (t as any).timeMul) : null,
        training: !!active,
        secondsLeft: secLeft,
        totalSec: active ? Math.round((active.finishesAt - active.startedAt) / 1000) : 0,
      };
    }),
  };
}

// Запустить прокачку трофея: списываем золото, ставим в очередь
function startUpgrade(user: User, id: string, notices: Notices) {
  const def = config.TROPHIES.find((t) => t.id === id);
  if (!def) throw new u.ApiError('Такого трофея не существует');
  const level = levelOf(user, id);
  if (level >= config.TROPHY_MAX_LEVEL) throw new u.ApiError('Трофей уже максимального уровня');
  if (activeFor(user, id)) throw new u.ApiError('Этот трофей уже прокачивается');
  const cost = nextCost(level, def);
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  user.gold -= cost;
  if (!(user as any).trophyQueue) (user as any).trophyQueue = [];
  const now = Date.now();
  const targetLevel = level + 1;
  const minutes = config.trophyTrainMinutes(targetLevel, (def as any).timeMul);
  (user as any).trophyQueue.push({
    id, level: targetLevel,
    startedAt: now,
    finishesAt: now + minutes * 60 * 1000,
  });
  notices.push(`📦 «${def.name}» взят в прокачку: готово через ${formatMinutes(minutes)}.`);
  return { id, level: targetLevel };
}

// Форматирование минут в "Xч Yм" или "Xсуток Yч" для удобного чтения
function formatMinutes(min: number): string {
  if (min < 60) return `${min} мин`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} ч ${min % 60} мин`;
  const days = Math.floor(min / (24 * 60));
  const hours = Math.floor((min % (24 * 60)) / 60);
  return `${days} сут ${hours} ч`;
}

// Ускорить прокачку: 10 золота за каждый час полной длительности, завершаем мгновенно
function boostUpgrade(user: User, id: string, notices: Notices) {
  const proc = activeFor(user, id);
  if (!proc) throw new u.ApiError('Этот трофей сейчас не прокачивается');
  const def = config.TROPHIES.find((t) => t.id === id);
  const cost = config.trophyBoostGold(proc.level, def ? (def as any).timeMul : undefined);
  if (user.gold < cost) throw new u.ApiError(`Нужно ${cost} золота`);
  user.gold -= cost;
  proc.finishesAt = Date.now();
  notices.push('⚡ Прокачка трофея ускорена!');
  return { ok: true, cost };
}

// Совокупный множитель: +N% к атаке от трофея medal (доли единицы)
function atkBonus(user: User): number {
  const def = config.TROPHIES.find((t) => t.id === 'medal');
  return (levelOf(user, 'medal') * (def ? def.perLvl : 0)) / 100;
}
// +N% к защите от shield
function defBonus(user: User): number {
  const def = config.TROPHIES.find((t) => t.id === 'shield');
  return (levelOf(user, 'shield') * (def ? def.perLvl : 0)) / 100;
}
// Дополнительная сила крита от license: пример +50% к множителю крита на ур.10
function critPower(user: User): number {
  const def = config.TROPHIES.find((t) => t.id === 'license');
  return (levelOf(user, 'license') * (def ? def.perLvl : 0)) / 100;
}
// Множитель энергии на миссиях от radar (меньше = выгоднее)
function missionEnergyMul(user: User): number {
  const def = config.TROPHIES.find((t) => t.id === 'radar');
  const pct = levelOf(user, 'radar') * (def ? def.perLvl : 0);
  return Math.max(0.5, 1 - pct / 100); // максимум −50%
}

export = {
  list, startUpgrade, boostUpgrade, bonusOf, discountPct, checkCompleted,
  atkBonus, defBonus, critPower, missionEnergyMul, spyLevel, bankHackLevel, mineLevel,
};
