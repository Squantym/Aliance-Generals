// ===================================================================
// src/services/trophies.ts — трофеи с прокачкой во времени
// Прокачка не моментальная: 60 минут на 1 уровень. Можно ускорить за
// 50 золота (мгновенно). За раз можно прокачивать несколько трофеев
// параллельно — у каждого свой таймер.
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import discounts = require('./discounts');
import type { User, Notices } from '../types';

function levelOf(user: User, id: string): number { return (user.trophies && user.trophies[id]) || 0; }

// Уровень, который РАБОТАЕТ прямо сейчас. Трофей, отданный в прокачку,
// снят со стойки: пока идёт улучшение, он не даёт ничего. Иначе
// улучшение было бы бесплатным по времени — поставил и воюешь дальше
// с тем же бонусом.
function activeLevel(user: User, id: string): number {
  return activeFor(user, id) ? 0 : levelOf(user, id);
}

// Цена прокачки: уровни 1–4 — доллары, 5–7 — доллары и гербы/жетоны,
// 8–10 — золото (config.trophyPrice). Доллары зависят от уровня игрока.
// Скидка на трофеи действует на все валюты цены.
type TrophyCost = { dollars: number; ears: number; tokens: number; gold: number };
function baseNextCost(user: User, level: number, def: any): TrophyCost {
  return config.trophyPrice(def, level, user.level);
}
function nextCost(user: User, level: number, def: any): TrophyCost {
  const b = baseNextCost(user, level, def);
  const d = (x: number) => (x > 0 ? discounts.applyTo('trophy', x) : 0);
  return { dollars: d(b.dollars), ears: d(b.ears), tokens: d(b.tokens), gold: d(b.gold) };
}

// Цена ускорения запущенной прокачки. Одно место на кнопку и на списание:
// пока их было два, экран показывал одно число, а сервер брал другое.
function boostCostOf(proc: any, def: any): number {
  return config.trophyBoostGoldLeft(
    proc.level, def ? (def as any).timeMul : undefined, proc.startedAt, proc.finishesAt);
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
  return config.trophyValue(def, activeLevel(user, id));
}

// Снижение цены по категории (для лечения, банка и т.п.)
function discountPct(user: User, applyKey: string): number {
  let pct = 0;
  for (const def of config.TROPHIES) {
    if (def.apply === applyKey) pct += config.trophyValue(def, activeLevel(user, def.id));
  }
  return pct;
}

// Завершение готовых процессов прокачки (вызывается из player.refresh)
function checkCompleted(user: User): void {
  if (!(user as any).trophyQueue || (user as any).trophyQueue.length === 0) return;
  const now = Date.now();
  const remaining: any[] = [];
  for (const proc of (user as any).trophyQueue) {
    // VIP ускоряет и УЖЕ ЗАПУЩЕННЫЕ улучшения: подписка, купленная
    // посреди прокачки, должна действовать сразу, а не со следующего
    // раза. Пересчитываем один раз и помечаем, чтобы не сокращать
    // повторно при каждом обращении.
    if (!proc.vipCut) {
      try {
        const vipSrv = require('./vip');
        if (vipSrv.isVip(user)) {
          const leftMs = proc.finishesAt - now;
          if (leftMs > 0) {
            const cutMs = vipSrv.trophyUpgradeSeconds(user, Math.round(leftMs / 1000)) * 1000;
            proc.finishesAt = now + cutMs;
          }
          proc.vipCut = true;
          db.markUser(user.id);
        }
      } catch (e) {}
    }
    if (proc.finishesAt <= now) {
      // Применяем уровень
      if (!user.trophies) user.trophies = {};
      user.trophies[proc.id] = (user.trophies[proc.id] || 0) + 1;
      // Сколько уровней трофеев прокачано всего — условие приглашений
      // «прокачать в сумме 10 уровней». Считаем здесь, в точке, где
      // уровень действительно выдан, а не при запуске прокачки.
      if (!(user as any).counters) (user as any).counters = {};
      (user as any).counters.trophyLevels = (((user as any).counters.trophyLevels) || 0) + 1;
    } else {
      remaining.push(proc);
    }
  }
  (user as any).trophyQueue = remaining;
}

// Уровень разведывательного трофея (для features.spyOn)
function spyLevel(user: User): number { return activeLevel(user, 'satellite'); }
// Уровень трофея взлома банков («Медвежатник») и мин («Растяжка»)
function bankHackLevel(user: User): number { return activeLevel(user, 'safecracker'); }
function mineLevel(user: User): number { return activeLevel(user, 'tripwire'); }

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
      // VIP (пункт 19): улучшение вдвое быстрее
      const trainMin = Math.max(1, Math.round(
        require('./vip').trophyUpgradeSeconds(user, config.trophyTrainMinutes(targetLevel, (t as any).timeMul) * 60) / 60));
      const secLeft = active ? Math.max(0, Math.floor((active.finishesAt - Date.now()) / 1000)) : 0;
      const isSpy = !!(t as any).spy;
      const isBankHack = !!(t as any).bankHack;
      const isMine = !!(t as any).mine;
      const isTextTrophy = isSpy || isBankHack || isMine;
      const textFor = (lvl: number) => isSpy ? spyUnlockText(lvl) : isBankHack ? bankHackText(lvl) : mineText(lvl);
      return {
        id: t.id, name: t.name, desc: t.desc, level, flavor: !!(t as any).flavor, expensive: !!t.expensive,
        spy: isSpy, bankHack: isBankHack, mine: isMine,
        // Для «текстовых» трофеев (спутник/медвежатник/растяжка) процентного
        // бонуса нет — вместо него человекочитаемое описание разблокировки.
        // Пока трофей в прокачке, он снят: показываем это числом, а не
        // только словом «прокачивается»
        bonusNow:  isTextTrophy ? textFor(active ? 0 : level) : config.trophyValue(t, active ? 0 : level),
        bonusNext: isTextTrophy
          ? (level < config.TROPHY_MAX_LEVEL ? textFor(targetLevel) : null)
          : (level < config.TROPHY_MAX_LEVEL ? config.trophyValue(t, targetLevel) : null),
        // Цена — объект по валютам: { dollars, ears, tokens, gold }
        baseNextCost: level < config.TROPHY_MAX_LEVEL ? baseNextCost(user, level, t) : null,
        nextCost:     level < config.TROPHY_MAX_LEVEL ? nextCost(user, level, t) : null,
        trainMinutes: level < config.TROPHY_MAX_LEVEL ? trainMin : null,
        // Пока прокачка идёт — цена за остаток (она уменьшается), до
        // запуска — полная: игрок должен видеть, во что обойдётся
        // ускорение, ещё до того как нажмёт «прокачать»
        boostGold: active
          ? boostCostOf(active, t)
          : (level < config.TROPHY_MAX_LEVEL ? config.trophyBoostGold(targetLevel, (t as any).timeMul) : null),
        training: !!active,
        // Занята ли «мастерская»: прокачка другого трофея закрывает кнопку
        busyWith: (() => { const q = ((user as any).trophyQueue || [])[0]; return q && q.id !== t.id ? q.id : ''; })(),
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
  // Только один трофей в работе: иначе богатый игрок ставил все сразу и
  // получал полный комплект за время одной прокачки.
  const busy = ((user as any).trophyQueue || [])[0];
  if (busy) {
    const bn = config.TROPHIES.find((t) => t.id === busy.id);
    const leftMin = Math.max(1, Math.round((busy.finishesAt - Date.now()) / 60000));
    throw new u.ApiError(`Сейчас прокачивается «${(bn && bn.name) || busy.id}» — осталось ${formatMinutes(leftMin)}. Одновременно улучшают только один трофей.`);
  }
  const cost = nextCost(user, level, def);
  // Сначала проверяем ВСЕ валюты, потом списываем: иначе при нехватке
  // второй валюты первая уходила бы впустую
  if ((user.dollars || 0) < cost.dollars) throw new u.ApiError(`Не хватает денег (нужно $${u.fmt(cost.dollars)})`);
  if (((user as any).ears || 0) < cost.ears) throw new u.ApiError(`Не хватает гербов (нужно ${cost.ears})`);
  if (((user as any).tokens || 0) < cost.tokens) throw new u.ApiError(`Не хватает жетонов перемирия (нужно ${cost.tokens})`);
  if ((user.gold || 0) < cost.gold) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost.gold})`);
  const pl = require('./player');
  if (cost.dollars > 0) pl.addMoney(user, -cost.dollars, false);
  if (cost.ears > 0) (user as any).ears -= cost.ears;
  if (cost.tokens > 0) (user as any).tokens -= cost.tokens;
  if (cost.gold > 0) pl.spendGold(user, cost.gold, 'trophy');
  if (!(user as any).trophyQueue) (user as any).trophyQueue = [];
  const now = Date.now();
  const targetLevel = level + 1;
  const minutes = Math.max(1, Math.round(
    require('./vip').trophyUpgradeSeconds(user, config.trophyTrainMinutes(targetLevel, (def as any).timeMul) * 60) / 60));
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

// Ускорить прокачку: платим за ОСТАТОК времени, завершаем мгновенно.
// Цена падает по ходу прокачки — см. config.trophyBoostGoldLeft.
function boostUpgrade(user: User, id: string, notices: Notices) {
  const proc = activeFor(user, id);
  if (!proc) throw new u.ApiError('Этот трофей сейчас не прокачивается');
  const def = config.TROPHIES.find((t) => t.id === id);
  const cost = boostCostOf(proc, def);
  if (user.gold < cost) throw new u.ApiError(`Нужно ${cost} золота`);
  require('./player').spendGold(user, cost, 'trophy');
  proc.finishesAt = Date.now();
  notices.push('⚡ Прокачка трофея ускорена!');
  return { ok: true, cost };
}

// Совокупный множитель: +N% к атаке от трофея medal (доли единицы)
function atkBonus(user: User): number {
  const def = config.TROPHIES.find((t) => t.id === 'medal');
  return config.trophyValue(def, activeLevel(user, 'medal')) / 100;
}
// +N% к защите от shield
function defBonus(user: User): number {
  const def = config.TROPHIES.find((t) => t.id === 'shield');
  return config.trophyValue(def, activeLevel(user, 'shield')) / 100;
}
// Дополнительная сила крита от license: +15% за уровень, на 10-м +200% (крит ×6)
function critPower(user: User): number {
  const def = config.TROPHIES.find((t) => t.id === 'license');
  return config.trophyValue(def, activeLevel(user, 'license')) / 100;
}
// Шанс КРИТИЧЕСКОГО ЛЕЧЕНИЯ медика в бою легиона. Собственный трофей
// «Орден «Красный крест»»: база 5% + 4.5% за уровень, на 10-м — 60%.
// (Раньше шанс брался от ловкости — стата уворота, что не имело смысла.)
function critHealChance(user: User): number {
  const def = config.TROPHIES.find((t) => t.id === 'red_cross');
  const pct = config.trophyValue(def, activeLevel(user, 'red_cross'));
  return Math.min(config.BATTLE.CRIT_HEAL_MAX, config.BATTLE.CRIT_HEAL_BASE + pct / 100);
}

// Множитель энергии на миссиях от radar (меньше = выгоднее)
function missionEnergyMul(user: User): number {
  const def = config.TROPHIES.find((t) => t.id === 'radar');
  const pct = config.trophyValue(def, activeLevel(user, 'radar'));
  return Math.max(0.4, 1 - pct / 100); // максимум −60% (10-й уровень)
}

export = {
  // levelOf наружу нужен подкреплениям: там он вызывался через
  // «есть ли такая функция», и молча возвращал 0 — трофей «Знамя
  // победы» не усиливал подкрепления вовсе.
  levelOf, activeLevel,
  list, startUpgrade, boostUpgrade, bonusOf, discountPct, checkCompleted,
  atkBonus, defBonus, critPower, critHealChance, missionEnergyMul, spyLevel, bankHackLevel, mineLevel,
};
