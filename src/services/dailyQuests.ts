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
import db = require('../core/db');
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
      accepted: {},     // id задания -> { at, base } — принятое задание и точка отсчёта
      claimed: {},      // id задания -> true, если награда уже получена
      bonusClaimed: false,
    };
  }
  if (!(user as any).daily.counters) (user as any).daily.counters = {};
  if (!(user as any).daily.claimed) (user as any).daily.claimed = {};
  if (!(user as any).daily.accepted) (user as any).daily.accepted = {};
  return (user as any).daily;
}

// Увеличить счётчик задания (вызывается из боя, покупки и т.п.)
//   key: 'attacks' | 'wins' | 'missionStages' | 'unitsBought' | ...
// Счётчики, которые уже увеличиваются через achievements.bump в местах
// вызова (бой, стройка, покупка техники, спецоперации). Для них здесь
// ведётся только дневной учёт, иначе выйдет двойной счёт.
const COUNTED_ELSEWHERE = new Set([
  'attacks', 'wins', 'fatalities', 'earsCut',
  'buildingsBuilt', 'unitsBought', 'missionStages',
]);

function bump(user: User, key: string, amount?: number): void {
  const d = ensureDaily(user);
  d.counters[key] = (d.counters[key] || 0) + (amount || 1);
  // Накопительные счётчики игрока: по ним считаются КОНТРАКТЫ и достижения.
  // Раньше bump писал только в дневные счётчики, поэтому контракты на
  // события без отдельного кода (покупки на чёрном рынке, клуб, диверсанты)
  // никогда не выполнялись — прогресс оставался нулевым.
  //
  // ВАЖНО: боевые счётчики уже увеличиваются через achievements.bump рядом
  // с вызовом этой функции. Дублировать их здесь нельзя — прогресс пошёл бы
  // вдвое быстрее. Поэтому ведём список тех, у кого своя точка учёта.
  if (!COUNTED_ELSEWHERE.has(key)) {
    if (!(user as any).counters) (user as any).counters = {};
    const c: any = (user as any).counters;
    c[key] = (c[key] || 0) + (amount || 1);
  }
  // Недельные поручения ведут собственные счётчики: они живут до
  // понедельника и не обнуляются вместе с дневными
  const w = ensureWeekly(user);
  w.counters[key] = (w.counters[key] || 0) + (amount || 1);
}

// ═══ НЕДЕЛЬНЫЕ ПОРУЧЕНИЯ ══════════════════════════════════════════
// Структура та же, что у дневных, но со своим сбросом (понедельник, UTC)
// и своим пулом уникальных заданий с повышенными лимитами и наградами.
function ensureWeekly(user: User): any {
  const week = config.weekUtcKey();
  // ═══ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ (v53) ═════════════════════════════
  // Недельные поручения ЖИЛИ в user.weekly — но это поле уже занято
  // НЕДЕЛЬНЫМ СЕЗОНОМ (seasons.ts: { weekId, ears, wins, loot... }).
  // Два модуля перетирали объект друг друга: любое действие игрока
  // (bump) стирало его сезонные очки, а сезонный хук — прогресс
  // поручений. Из-за этого у активных игроков счёт сезона обнулился.
  // Поручения переезжают в СОБСТВЕННОЕ поле weeklyQuests.
  // ────────────────────────────────────────────────────────────────
  // Миграция: если в user.weekly остался формат поручений (есть week/
  // counters, нет сезонного weekId) — переносим его в weeklyQuests и
  // освобождаем поле: сезон пересоздаст свой объект сам (ensureWeek).
  const legacy = (user as any).weekly;
  if (legacy && legacy.week && legacy.counters && !legacy.weekId) {
    // Переносим только если своего поля ещё нет; но чужое поле ОСВОБОЖДАЕМ
    // в любом случае — иначе у игрока, который не воюет (сезонные хуки не
    // приходят), мусорный формат висел бы в user.weekly бесконечно, и в
    // топах сезона он показывался бы нулём
    if (!(user as any).weeklyQuests) (user as any).weeklyQuests = legacy;
    (user as any).weekly = null;
  }
  if (!(user as any).weeklyQuests || (user as any).weeklyQuests.week !== week) {
    (user as any).weeklyQuests = { week, counters: {}, accepted: {}, claimed: {}, bonusClaimed: false };
  }
  const w = (user as any).weeklyQuests;
  if (!w.counters) w.counters = {};
  if (!w.accepted) w.accepted = {};
  if (!w.claimed) w.claimed = {};
  return w;
}

function weeklyProgress(w: any, quest: any): number {
  const acc = w.accepted[quest.id];
  if (!acc) return 0;
  return Math.max(0, (w.counters[quest.counter] || 0) - (acc.base || 0));
}

function daysUntilWeeklyReset(): number {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7;               // 0 = понедельник
  const nextMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 7));
  return Math.ceil((nextMonday.getTime() - now.getTime()) / (24 * 3600000));
}

function weeklyList(user: User) {
  const w = ensureWeekly(user);
  const ids = config.pickWeeklyQuests(w.week);
  const quests = ids.map((id: string) => {
    const q = config.WEEKLY_QUEST_BY_ID[id];
    const target = config.weeklyQuestTarget(q.base, q.diff, user.level, q.counter, q.fixedTarget);
    const accepted = !!w.accepted[q.id];
    const progress = weeklyProgress(w, q);
    const done = accepted && progress >= target;
    const rw = config.weeklyQuestReward(q.diff, user.level, q);
    const ch = config.DAILY_CHARS[q.char] || { name: 'Штаб', role: '', icon: '📌' };
    return {
      id: q.id, name: q.name, icon: q.icon, flavor: q.flavor, route: q.route || null,
      char: q.char, charName: ch.name, charRole: ch.role, charIcon: ch.icon, charIntro: (ch as any).intro || '',
      diff: q.diff, difficulty: q.diff >= 2.4 ? 'hard' : (q.diff >= 1.6 ? 'medium' : 'easy'),
      target, progress: Math.min(progress, target),
      accepted, done, claimed: !!w.claimed[q.id],
      reward: { xp: rw.xp, dollars: rw.dollars, gold: rw.gold || 0 },
      item: q.item ? { id: q.item, name: config.smuggleItemName(q.item), gold: config.smuggleItemGold(q.item) } : null,
    };
  });
  const doneCount = quests.filter((q: any) => q.done).length;
  return {
    quests, weekly: true,
    allDone: doneCount === quests.length, doneCount, total: quests.length,
    bonusGold: config.weeklyAllBonusGold(user.level),
    bonusClaimed: !!w.bonusClaimed,
    resetInDays: daysUntilWeeklyReset(),
  };
}

function weeklyAccept(user: User, questId: string, notices: Notices) {
  const w = ensureWeekly(user);
  if (!config.pickWeeklyQuests(w.week).includes(questId)) throw new u.ApiError('Это недельное поручение недоступно');
  const quest = config.WEEKLY_QUEST_BY_ID[questId];
  if (!quest) throw new u.ApiError('Поручение не найдено');
  if (w.accepted[questId]) throw new u.ApiError('Поручение уже принято');
  if (w.claimed[questId]) throw new u.ApiError('Это поручение уже выполнено на этой неделе');
  w.accepted[questId] = { at: Date.now(), base: w.counters[quest.counter] || 0 };
  const ch = config.DAILY_CHARS[quest.char];
  notices.push(`📋 ${ch ? ch.name + ': ' : ''}недельное поручение «${quest.name}» принято.`);
  return { accepted: true, questId };
}

function weeklyClaim(user: User, questId: string, notices: Notices) {
  const w = ensureWeekly(user);
  if (!config.pickWeeklyQuests(w.week).includes(questId)) throw new u.ApiError('Это недельное поручение недоступно');
  const quest = config.WEEKLY_QUEST_BY_ID[questId];
  if (!quest) throw new u.ApiError('Поручение не найдено');
  if (w.claimed[questId]) throw new u.ApiError('Награда за это поручение уже получена');
  if (!w.accepted[questId]) throw new u.ApiError('Сначала примите это поручение');
  const target = config.weeklyQuestTarget(quest.base, quest.diff, user.level, quest.counter, quest.fixedTarget);
  if (weeklyProgress(w, quest) < target) throw new u.ApiError('Поручение ещё не выполнено');
  w.claimed[questId] = true;
  const reward = config.weeklyQuestReward(quest.diff, user.level, quest);
  player.addMoney(user, reward.dollars, true);
  player.addXp(user, reward.xp, notices);
  if (reward.gold) player.addGold(user, reward.gold);
  const ch = config.DAILY_CHARS[quest.char];
  notices.push(`🎁 ${ch ? ch.name + ': ' : ''}награда за недельное «${quest.name}»: +${reward.xp} XP, +$${u.fmt(reward.dollars)}` +
    (reward.gold ? `, 🪙 ${reward.gold}` : ''));
  return reward;
}

function weeklyClaimBonus(user: User, notices: Notices) {
  const w = ensureWeekly(user);
  if (w.bonusClaimed) throw new u.ApiError('Недельный бонус уже получен');
  const ids = config.pickWeeklyQuests(w.week);
  const allDone = ids.every((id: string) => {
    const q = config.WEEKLY_QUEST_BY_ID[id];
    return !!w.accepted[id] && weeklyProgress(w, q) >= config.weeklyQuestTarget(q.base, q.diff, user.level, q.counter, q.fixedTarget);
  });
  if (!allDone) throw new u.ApiError('Примите и выполните все недельные поручения');
  w.bonusClaimed = true;
  const bonus = config.weeklyAllBonusGold(user.level);
  player.addGold(user, bonus);
  notices.push(`🎉 Все недельные поручения выполнены! Бонус: 🪙 ${bonus}`);
  return { gold: bonus };
}

// Активные поручения на сегодня (9 из 20, детерминированно по дню)
function activeQuestIds(user: User): string[] {
  const d = ensureDaily(user);
  const base = config.pickDailyQuests(d.day);
  // VIP-замены: подменяем идентификаторы в наборе на выбранные взамен.
  // Единая точка — иначе замена была бы видна в одном месте и не видна
  // в другом (приём, прогресс, сдача берут набор отсюда же).
  const rep = (d as any).replaced;
  if (!rep) return base;
  return base.map((id: string) => rep[id] || id);
}

// Прогресс задания. Считается ТОЛЬКО после принятия и отсчитывается от
// значения счётчика на момент принятия: общий счётчик (например «победы»)
// растёт всегда, но в зачёт идут лишь действия, сделанные после того, как
// игрок взял поручение. Не принято — прогресс нулевой.
function questProgress(d: any, quest: any): number {
  const acc = d.accepted[quest.id];
  if (!acc) return 0;
  const now = d.counters[quest.counter] || 0;
  return Math.max(0, now - (acc.base || 0));
}

// Принять поручение: фиксируем точку отсчёта прогресса
function accept(user: User, questId: string, notices: Notices) {
  const d = ensureDaily(user);
  if (!activeQuestIds(user).includes(questId)) throw new u.ApiError('Это поручение сегодня недоступно');
  const quest = config.DAILY_QUEST_BY_ID[questId];
  if (!quest) throw new u.ApiError('Поручение не найдено');
  if (d.accepted[questId]) throw new u.ApiError('Поручение уже принято');
  if (d.claimed[questId]) throw new u.ApiError('Это поручение уже выполнено сегодня');
  d.accepted[questId] = { at: Date.now(), base: d.counters[quest.counter] || 0 };
  const ch = config.DAILY_CHARS[quest.char];
  notices.push(`📋 ${ch ? ch.name + ': ' : ''}поручение «${quest.name}» принято. Прогресс пошёл.`);
  return { accepted: true, questId };
}

// Список активных поручений с прогрессом и данными заказчика — для UI
function list(user: User) {
  const d = ensureDaily(user);
  const ids = activeQuestIds(user);
  const quests = ids.map((id) => {
    const q = config.DAILY_QUEST_BY_ID[id];
    const target = config.dailyQuestTarget(q.base, q.diff, user.level, q.counter, q.fixedTarget);
    const accepted = !!d.accepted[q.id];
    const progress = questProgress(d, q);
    const done = accepted && progress >= target;
    const rw = config.dailyQuestReward(q.diff, user.level, q);
    const ch = config.DAILY_CHARS[q.char] || { name: 'Штаб', role: '', icon: '📌' };
    return {
      id: q.id, name: q.name, icon: q.icon, flavor: q.flavor, route: q.route || null,
      char: q.char, charName: ch.name, charRole: ch.role, charIcon: ch.icon, charIntro: (ch as any).intro || '',
      diff: q.diff, difficulty: q.diff >= 2.4 ? 'hard' : (q.diff >= 1.6 ? 'medium' : 'easy'),
      target, progress: Math.min(progress, target),
      accepted, done, claimed: !!d.claimed[q.id],
      reward: { xp: rw.xp, dollars: rw.dollars, gold: rw.gold || 0 },
      item: q.item ? { id: q.item, name: config.smuggleItemName(q.item), gold: config.smuggleItemGold(q.item) } : null,
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
  if (!activeQuestIds(user).includes(questId)) throw new u.ApiError('Это поручение сегодня недоступно');
  const quest = config.DAILY_QUEST_BY_ID[questId];
  if (!quest) throw new u.ApiError('Поручение не найдено');
  if (d.claimed[questId]) throw new u.ApiError('Награда за это поручение уже получена');
  if (!d.accepted[questId]) throw new u.ApiError('Сначала примите это поручение');
  const target = config.dailyQuestTarget(quest.base, quest.diff, user.level, quest.counter, quest.fixedTarget);
  const progress = questProgress(d, quest);
  if (progress < target) throw new u.ApiError('Поручение ещё не выполнено');
  d.claimed[questId] = true;
  const reward = config.dailyQuestReward(quest.diff, user.level, quest);
  player.addMoney(user, reward.dollars, true);
  player.addXp(user, reward.xp, notices);
  if (reward.gold) player.addGold(user, reward.gold);   // контрабанда: возврат золота
  const ch = config.DAILY_CHARS[quest.char];
  notices.push(`🎁 ${ch ? ch.name + ': ' : ''}награда за «${quest.name}»: +${reward.xp} XP, +$${u.fmt(reward.dollars)}` +
    (reward.gold ? `, 🪙 ${reward.gold}` : ''));
  return reward;
}

// Забрать бонус за выполнение ВСЕХ активных поручений дня (золото)
// ── VIP: массовые действия (пункт 4) ──────────────────────────────
// Принять все доступные и сдать все выполненные одним нажатием.
// Ошибки по отдельным поручениям не прерывают остальные: если одно
// нельзя принять, это не повод не принимать другие.
function acceptAll(user: User, notices: Notices) {
  if (!require('./vip').isVip(user)) throw new u.ApiError('Доступно по VIP-подписке');
  const view = list(user);
  const wk = weeklyList(user);
  let n = 0;
  for (const q of view.quests || []) {
    if (q.accepted || q.claimed) continue;
    try { accept(user, q.id, []); n++; } catch (e) {}
  }
  for (const q of wk.quests || []) {
    if (q.accepted || q.claimed) continue;
    try { weeklyAccept(user, q.id, []); n++; } catch (e) {}
  }
  notices.push(n ? `📋 Принято поручений: ${n}` : 'Нечего принимать — все уже в работе');
  return list(user);
}

function claimAll(user: User, notices: Notices) {
  if (!require('./vip').isVip(user)) throw new u.ApiError('Доступно по VIP-подписке');
  const view = list(user);
  const wk = weeklyList(user);
  let n = 0;
  for (const q of view.quests || []) {
    if (!q.done || q.claimed) continue;
    try { claim(user, q.id, notices); n++; } catch (e) {}
  }
  for (const q of wk.quests || []) {
    if (!q.done || q.claimed) continue;
    try { weeklyClaim(user, q.id, notices); n++; } catch (e) {}
  }
  if (!n) notices.push('Нет выполненных поручений к сдаче');
  return list(user);
}

// ── VIP: замена поручений (пункт 8) ───────────────────────────────
// Меняет одно поручение на другое из набора. Две замены в сутки.
function reroll(user: User, questId: string, notices: Notices) {
  const vipSrv = require('./vip');
  if (!vipSrv.isVip(user)) throw new u.ApiError('Доступно по VIP-подписке');
  const d = ensureDaily(user);
  const ids: string[] = activeQuestIds(user);
  const idx = ids.indexOf(String(questId));
  if (idx < 0) throw new u.ApiError('Поручение не найдено');
  if (d.claimed && d.claimed[questId]) throw new u.ApiError('Это поручение уже сдано');

  // Ищем замену среди тех, которых сегодня нет
  // Замена не должна выдать то, что уже есть в наборе
  const pool = config.DAILY_QUESTS.filter((q: any) => !ids.includes(q.id));
  if (!pool.length) throw new u.ApiError('Заменить не на что — набор исчерпан');
  if (!vipSrv.spend(user, 'reroll')) {
    throw new u.ApiError('Замены на сегодня закончились — обновятся в полночь по Москве');
  }

  const pick = pool[Math.floor(Math.random() * pool.length)];
  // Ключом служит ИСХОДНЫЙ идентификатор из набора дня: если поручение
  // уже меняли, повторная замена перезаписывает ту же ячейку, а не
  // создаёт цепочку
  const baseIds = config.pickDailyQuests(d.day);
  const rep0 = (d as any).replaced || {};
  const originKey = baseIds.find((bid: string) => (rep0[bid] || bid) === questId) || questId;
  d.replaced = rep0;
  d.replaced[originKey] = pick.id;
  // Прогресс и приём старого поручения сбрасываем — иначе замена была бы
  // способом мгновенно получить награду за уже выполненное
  if (d.accepted) delete d.accepted[questId];
  db.markUser(user.id);
  db.markUser(user.id);
  notices.push(`🔄 Поручение заменено на «${pick.name}». Осталось замен: ${vipSrv.left(user, 'reroll')}`);
  return list(user);
}

function claimBonus(user: User, notices: Notices) {
  const d = ensureDaily(user);
  if (d.bonusClaimed) throw new u.ApiError('Бонус уже получен сегодня');
  const ids = activeQuestIds(user);
  const allDone = ids.every((id) => {
    const q = config.DAILY_QUEST_BY_ID[id];
    return !!d.accepted[id] && questProgress(d, q) >= config.dailyQuestTarget(q.base, q.diff, user.level, q.counter, q.fixedTarget);
  });
  if (!allDone) throw new u.ApiError('Примите и выполните все поручения дня, чтобы получить бонус');
  d.bonusClaimed = true;
  const bonus = config.dailyAllBonusGold(user.level);
  player.addGold(user, bonus);
  notices.push(`🎉 Все поручения дня выполнены! Бонус: 🪙 ${bonus}`);
  return { gold: bonus };
}

export = { bump, list, accept, claim, claimBonus, ensureDaily, questProgress,
  ensureWeekly, weeklyList, weeklyAccept, weeklyClaim, weeklyClaimBonus, acceptAll, claimAll, reroll,};
