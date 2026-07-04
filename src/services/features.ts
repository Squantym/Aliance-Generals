// ===================================================================
// src/services/features.ts — набор новых систем:
//   • Ежедневный вход (login streak)
//   • Титулы (разблокировка + выбор активного)
//   • Контракты от NPC (ежедневные задания)
//   • Косметика профиля (рамки/фоны)
//   • Реферальная система
//   • Шпионаж/разведка
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import config = require('../../config/gameConfig');
import player = require('./player');
import trophies = require('./trophies');
import type { User, Notices } from '../types';

function today(): string {
  // День по МСК (UTC+3): новый день наступает в 00:00 МСК
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function users(): Record<string, User> { return player.users(); }

// ===================================================================
// 1. ЕЖЕДНЕВНЫЙ ВХОД (STREAK) — награда выдаётся АВТОМАТИЧЕСКИ при
// первом заходе в новый день (00:00 МСК). Серия до 7 дней, пропуск
// сбрасывает на день 1, после 7-го дня отсчёт начинается заново.
// ===================================================================

// Вызывается при каждом обращении игрока (из mePayload). Если сегодня
// награда ещё не выдана — начисляет её и возвращает данные для тоста.
function claimDailyIfDue(user: User, notices?: Notices): any | null {
  const day = today();
  if (user.lastLoginDay === day) return null; // уже получено сегодня

  // Определяем серию: если вчера заходил — продолжаем, иначе сброс на 1.
  // После 7-го дня серия сбрасывается и начинается заново с 1.
  const yesterday = new Date(Date.now() + 3 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
  let streak;
  if (user.lastLoginDay === yesterday) {
    streak = (user.loginStreak || 0) + 1;
    if (streak > 7) streak = 1; // после недельного джекпота — заново
  } else {
    streak = 1; // пропуск дня или первый вход — начинаем заново
  }
  user.loginStreak = streak;
  user.lastLoginDay = day;

  const rewards = config.LOGIN_STREAK.rewards;
  const r = rewards[streak - 1];

  if (r.dollars) player.addMoney(user, r.dollars, false);
  if (r.gold) player.addGold(user, r.gold);
  db.save('users');

  const parts: string[] = [];
  if (r.dollars) parts.push(`$ ${u.fmt(r.dollars)}`);
  if (r.gold) parts.push(`🪙 ${r.gold}`);
  const msg = `📅 День ${streak}/7! Награда за вход: ${parts.join(', ')}.${streak === 7 ? ' 🎉 Недельный джекпот!' : ''}`;
  if (notices) notices.push(msg);
  try { checkTitles(user, notices || { push: () => {} } as any); } catch (e) {}
  return { streak, reward: r, message: msg };
}

// Данные для отображения прогресса серии (профиль/уведомление)
function loginStreakView(user: User) {
  const day = today();
  const claimedToday = user.lastLoginDay === day;
  const streak = user.loginStreak || 0;
  return {
    streak, claimedToday,
    allRewards: config.LOGIN_STREAK.rewards,
  };
}

// ===================================================================
// 2. ТИТУЛЫ (привязаны к достижениям)
// Каждое достижение даёт за каждую из 5 ступеней свой титул. Игрок
// выбирает любой РАЗБЛОКИРОВАННЫЙ титул для отображения в профиле.
// titleId формат: "{achId}:{stepIndex}" (например "wins:0").
// ===================================================================

// Достигнутая ступень достижения (0..5)
function achStage(user: User, achId: string): number {
  return (user.achStages || {})[achId] || 0;
}

// Проверка титулов после прогресса (вызывается из achievements.check).
// Сами титулы вычисляются из achStages, отдельно хранить не нужно —
// но шлём уведомление о новом титуле.
function checkTitles(user: User, notices: Notices): void {
  // Титулы выводятся из achStages напрямую, дополнительного состояния нет.
  // Эта функция оставлена для совместимости (вызовы из боя и т.д.).
}

function titlesView(user: User) {
  const list: any[] = [];
  for (const a of config.ACHIEVEMENTS) {
    const stage = achStage(user, a.id);
    const names = (a as any).titles || [];
    for (let i = 0; i < a.steps.length; i++) {
      list.push({
        id: a.id + ':' + i,
        name: names[i] || `${a.name} ${i + 1}`,
        achName: a.name,
        step: i + 1,
        target: a.steps[i],
        unlocked: stage >= (i + 1),
      });
    }
  }
  return {
    active: user.activeTitle || null,
    list,
  };
}

function setTitle(user: User, titleId: string, notices: Notices) {
  if (titleId === '' || titleId === null) {
    user.activeTitle = null;
    db.save('users');
    return titlesView(user);
  }
  // Проверяем, что титул разблокирован
  const [achId, stepStr] = String(titleId).split(':');
  const step = parseInt(stepStr, 10);
  const a = config.ACHIEVEMENTS.find((x: any) => x.id === achId);
  if (!a || isNaN(step)) throw new u.ApiError('Неизвестный титул');
  if (achStage(user, achId) < (step + 1)) {
    throw new u.ApiError('Этот титул ещё не разблокирован');
  }
  user.activeTitle = titleId;
  db.save('users');
  return titlesView(user);
}

// Получить отображаемое имя активного титула (для профиля/mePayload)
function activeTitleName(user: User): string | null {
  if (!user.activeTitle) return null;
  const [achId, stepStr] = String(user.activeTitle).split(':');
  const step = parseInt(stepStr, 10);
  const a = config.ACHIEVEMENTS.find((x: any) => x.id === achId);
  if (!a || isNaN(step)) return null;
  return ((a as any).titles || [])[step] || null;
}

// ===================================================================
// 3. КОНТРАКТЫ ОТ NPC (ежедневные задания)
// ===================================================================
function rollContracts(user: User): void {
  const day = today();
  if (user.contractsDay === day && user.contracts && user.contracts.length) return;
  // Новый набор на сегодня
  const pool = u.shuffle(config.CONTRACTS_POOL.slice()).slice(0, config.CONTRACTS_PER_DAY);
  user.contracts = pool.map((c: any) => {
    const tier = u.rnd(0, c.targets.length - 1);
    return { id: c.id + '_' + tier, progress: 0, claimed: false,
      baseCounter: snapshotCounter(user, c.counter) } as any;
  });
  user.contractsDay = day;
  db.save('users');
}

function snapshotCounter(user: User, counter: string): number {
  return (user.counters as any)[counter] || 0;
}

function contractsView(user: User) {
  rollContracts(user);
  return {
    contracts: (user.contracts || []).map((ct: any) => {
      const [baseId, tierStr] = ct.id.split(/_(\d+)$/);
      const tier = parseInt(tierStr || '0', 10);
      const def = config.CONTRACTS_POOL.find((c: any) => c.id === baseId);
      if (!def) return null;
      const target = def.targets[tier];
      const current = Math.max(0, snapshotCounter(user, def.counter) - (ct.baseCounter || 0));
      const done = current >= target;
      return {
        id: ct.id, name: def.name,
        desc: def.desc.replace('{n}', String(target)),
        current: Math.min(current, target), target,
        reward: def.rewardGold[tier],
        done, claimed: !!ct.claimed,
      };
    }).filter(Boolean),
  };
}

function claimContract(user: User, contractId: string, notices: Notices) {
  rollContracts(user);
  const ct: any = (user.contracts || []).find((x: any) => x.id === contractId);
  if (!ct) throw new u.ApiError('Контракт не найден');
  if (ct.claimed) throw new u.ApiError('Награда уже получена');
  const [baseId, tierStr] = contractId.split(/_(\d+)$/);
  const tier = parseInt(tierStr || '0', 10);
  const def = config.CONTRACTS_POOL.find((c: any) => c.id === baseId);
  if (!def) throw new u.ApiError('Контракт не найден');
  const target = def.targets[tier];
  const current = Math.max(0, snapshotCounter(user, def.counter) - (ct.baseCounter || 0));
  if (current < target) throw new u.ApiError('Контракт ещё не выполнен');

  const reward = def.rewardGold[tier];
  player.addGold(user, reward);
  ct.claimed = true;
  db.save('users');
  notices.push(`📋 Контракт «${def.name}» выполнен! +🪙 ${reward}`);
  return contractsView(user);
}

// ===================================================================
// 4. КОСМЕТИКА ПРОФИЛЯ
// ===================================================================
function cosmeticsView(user: User) {
  if (!user.ownedCosmetics) user.ownedCosmetics = [];
  return {
    owned: user.ownedCosmetics,
    activeFrame: user.profileFrame || null,
    activeBg: user.profileBg || null,
    items: config.COSMETICS.map((c: any) => ({
      ...c, owned: user.ownedCosmetics!.includes(c.id),
    })),
  };
}

function buyCosmetic(user: User, cosmeticId: string, notices: Notices) {
  const item = config.COSMETIC_BY_ID[cosmeticId];
  if (!item) throw new u.ApiError('Предмет не найден');
  if (!user.ownedCosmetics) user.ownedCosmetics = [];
  if (user.ownedCosmetics.includes(cosmeticId)) throw new u.ApiError('Уже куплено');
  if (user.gold < item.priceGold) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${item.priceGold})`);
  user.gold -= item.priceGold;
  user.ownedCosmetics.push(cosmeticId);
  db.save('users');
  notices.push(`🎨 Куплено: «${item.name}»! Наденьте в настройках профиля.`);
  return cosmeticsView(user);
}

function equipCosmetic(user: User, cosmeticId: string, notices: Notices) {
  if (!user.ownedCosmetics) user.ownedCosmetics = [];
  if (cosmeticId === '' || cosmeticId === null) {
    // снять всё — определим по отсутствию
    return cosmeticsView(user);
  }
  const item = config.COSMETIC_BY_ID[cosmeticId];
  if (!item || !user.ownedCosmetics.includes(cosmeticId)) throw new u.ApiError('Предмет не куплен');
  if (item.type === 'frame') user.profileFrame = cosmeticId;
  else if (item.type === 'bg') user.profileBg = cosmeticId;
  db.save('users');
  return cosmeticsView(user);
}

function unequipCosmetic(user: User, type: string) {
  if (type === 'frame') user.profileFrame = '';
  else if (type === 'bg') user.profileBg = '';
  db.save('users');
  return cosmeticsView(user);
}

// ===================================================================
// 5. РЕФЕРАЛЬНАЯ СИСТЕМА
// ===================================================================
function ensureRefCode(user: User): string {
  if (!user.refCode) {
    user.refCode = (user.name.slice(0, 4).toUpperCase().replace(/[^A-ZА-Я0-9]/gi, '') || 'GEN') + u.uid(4).toUpperCase();
    db.save('users');
  }
  return user.refCode;
}

function referralView(user: User) {
  const code = ensureRefCode(user);
  return {
    code,
    refCount: user.refCount || 0,
    refEarnings: user.refEarnings || 0,
    referredBy: user.referredBy || null,
    canApply: !user.referredBy && user.level < 50,
    level50Reward: config.REFERRAL.level50Reward,
    level50Tokens: config.REFERRAL.level50Tokens,
    inviteeGold: config.REFERRAL.inviteeGold,
    purchaseSharePct: config.REFERRAL.purchaseSharePct,
  };
}

// Применить код при регистрации/первом входе
function applyReferral(user: User, code: string, notices: Notices) {
  if (user.referredBy) throw new u.ApiError('Вы уже использовали реферальный код');
  if (user.refRewarded) throw new u.ApiError('Реферальный код уже применён');
  const c = String(code || '').trim().toUpperCase();
  if (!c) throw new u.ApiError('Введите код');
  const inviter = Object.values(users()).find((p) => (p.refCode || '').toUpperCase() === c);
  if (!inviter) throw new u.ApiError('Код не найден');
  if (inviter.id === user.id) throw new u.ApiError('Нельзя пригласить самого себя');
  if (user.level >= 50) throw new u.ApiError('Код можно ввести только до 50 уровня');

  user.referredBy = inviter.id;
  user.refRewarded = true;
  // Новичок получает золото сразу. Пригласивший — НЕ сразу:
  //  • награду за достижение другом 50 уровня (см. onReferralLevelUp)
  //  • 10% от золота, купленного другом (см. onReferralPurchase)
  player.addGold(user, config.REFERRAL.inviteeGold);

  inviter.refCount = (inviter.refCount || 0) + 1;
  db.save('users');
  try {
    require('./notifications').push(inviter.id, 'referral_joined',
      `🤝 Игрок ${user.name} вошёл по вашему коду! Награда придёт, когда он достигнет 50 уровня, плюс вы будете получать 10% от его покупок золота.`, {});
  } catch (e) {}
  notices.push(`🎁 Код принят! Вам +🪙 ${config.REFERRAL.inviteeGold}.`);
  return referralView(user);
}

// Вызывается при повышении уровня игрока. Если он достиг 50 и пришёл по
// реферальной ссылке — пригласивший получает разовую награду.
function onReferralLevelUp(user: User): void {
  if (!user.referredBy || user.refLevel50Paid) return;
  if (user.level < 50) return;
  const inviter = users()[user.referredBy];
  if (!inviter) return;
  user.refLevel50Paid = true;
  player.addGold(inviter, config.REFERRAL.level50Reward);
  inviter.tokens = (inviter.tokens || 0) + config.REFERRAL.level50Tokens;
  db.save('users');
  try {
    require('./notifications').push(inviter.id, 'referral_level50',
      `🎉 Ваш друг ${user.name} достиг 50 уровня! Награда: 🪙 ${config.REFERRAL.level50Reward}, 🎖 ${config.REFERRAL.level50Tokens}`, {});
  } catch (e) {}
}

// Вызывается, когда реферал ПОКУПАЕТ золото (реальная покупка). Пригласивший
// получает 10% от суммы купленного золота.
function onReferralPurchase(user: User, goldBought: number): void {
  if (!user.referredBy || goldBought <= 0) return;
  const inviter = users()[user.referredBy];
  if (!inviter) return;
  const share = Math.floor(goldBought * config.REFERRAL.purchaseSharePct / 100);
  if (share <= 0) return;
  player.addGold(inviter, share);
  inviter.refEarnings = (inviter.refEarnings || 0) + share;
  db.save('users');
  try {
    require('./notifications').push(inviter.id, 'referral_purchase',
      `💰 Ваш реферал ${user.name} купил золото — вам начислено 🪙 ${share} (10%).`, {});
  } catch (e) {}
}

// ===================================================================
// 6. ШПИОНАЖ / РАЗВЕДКА
// ===================================================================
// Зашумление числа: при точности acc<1 показываем случайное значение из
// диапазона ±(1−acc) вокруг истинного (например, точность 50% → ±50%).
// Значение фиксируется в снапшоте, поэтому цель не может «усреднить» его.
function fuzz(trueVal: number, acc: number): number {
  if (!(trueVal > 0)) return 0;
  const e = 1 - acc;
  if (e <= 0) return trueVal;               // точность 100% → точное число
  const factor = 1 + (Math.random() * 2 - 1) * e; // ∈ [1−e, 1+e]
  return Math.max(0, Math.round(trueVal * factor));
}

// Сборка разведотчёта по цели с учётом точностей reveal (по уровню трофея).
// at/liveUntil — метки времени (для live-режима переносятся из исходного отчёта).
function buildSpyReport(target: User, reveal: ReturnType<typeof config.spyReveal>,
                        trophyLvl: number, at: number, liveUntil: number | null) {
  // --- Техника (рассекречивается с 1 ур., точность reveal.units) ---
  const units: any[] = [];
  const unitsByType: Record<string, number> = { ground: 0, air: 0, sea: 0 };
  let unitsTotal = 0;
  for (const [unitId, mkMap] of Object.entries(target.units || {})) {
    const cu = config.UNIT_BY_ID[unitId];
    if (!cu) continue;
    for (let mk = 0; mk <= 2; mk++) {
      const real = (mkMap && (mkMap as any)[mk]) || 0;
      if (real <= 0) continue;
      const count = fuzz(real, reveal.units);
      if (count <= 0) continue;
      units.push({
        id: unitId, unitType: cu.type, mk,
        name: cu.name + (mk ? ` Mk${mk}` : ''),
        type: config.UNIT_TYPE_NAMES[cu.type],
        attack: Math.round(cu.attack * config.MK_MULT[mk]),
        defense: Math.round(cu.defense * config.MK_MULT[mk]),
        count,
      });
      unitsTotal += count;
      if (unitsByType[cu.type] != null) unitsByType[cu.type] += count;
    }
  }

  // --- Постройки (доходные + защитные, рассекречиваются с 5 ур.) ---
  let buildings: any[] | null = null;
  if (reveal.buildings != null) {
    buildings = Object.entries(target.buildings || {}).map(([id, cnt]) => {
      const b = config.BUILDING_BY_ID[id];
      const real = (cnt as number) || 0;
      if (!b || real <= 0) return null;
      const count = fuzz(real, reveal.buildings as number);
      if (count <= 0) return null;
      return { id, name: b.name, count, kind: b.kind, income: b.income || 0, def: b.def || 0 };
    }).filter(Boolean);
  }

  // --- Секретные разработки (рассекречиваются с 8 ур.) ---
  let secretDevs: any[] | null = null;
  let superDevInfo: any = null;
  if (reveal.secrets != null) {
    secretDevs = config.SECRET_DEVS.map((d) => {
      const real = (target.secretDevs || {})[d.id] || 0;
      if (real <= 0) return null;
      const count = fuzz(real, reveal.secrets as number);
      if (count <= 0) return null;
      return { id: d.id, name: d.name, count, attack: d.atk, defense: d.def };
    }).filter(Boolean);
    if ((target.superSecret || 0) > 0) {
      const count = fuzz(target.superSecret, reveal.secrets as number);
      if (count > 0) superDevInfo = {
        id: config.SUPER_DEV.id, name: config.SUPER_DEV.name,
        count, attack: config.SUPER_DEV.atk, defense: config.SUPER_DEV.def,
      };
    }
  }

  return {
    targetId: target.id, targetName: target.name, targetLevel: target.level,
    hp: target.res.hp.cur, earsCurrent: target.earsCurrent,
    trophyLvl,
    units, unitsTotal, unitsByType,
    buildings, secretDevs, superDevInfo,
    accUnits:  Math.round(reveal.units * 100),
    accBuild:  reveal.buildings != null ? Math.round(reveal.buildings * 100) : null,
    accSecret: reveal.secrets != null ? Math.round(reveal.secrets * 100) : null,
    live: !!reveal.live, at, liveUntil,
  };
}

function spyOn(user: User, targetId: string, notices: Notices) {
  const day = today();
  if (user.lastSpyDay !== day) { user.lastSpyDay = day; user.spyCount = 0; }
  const free = config.SPY.freePerDay;
  const used = user.spyCount || 0;

  const target = users()[targetId];
  if (!target) throw new u.ApiError('Цель не найдена');
  if (target.id === user.id) throw new u.ApiError('Незачем шпионить за собой');

  if (used >= free) {
    if (user.gold < config.SPY.extraCostGold) {
      throw new u.ApiError(`Бесплатная разведка на сегодня исчерпана (${free}/день). Доп. разведка: 🪙 ${config.SPY.extraCostGold}`);
    }
    user.gold -= config.SPY.extraCostGold;
  }
  user.spyCount = used + 1;

  player.refresh(target);
  const lvl = trophies.spyLevel(user);        // уровень трофея «Спутник-шпион»
  const reveal = config.spyReveal(lvl);
  const now = Date.now();
  const liveUntil = reveal.live ? now + config.SPY_LIVE_MS : null;

  // Сохраняем отчёт — игрок увидит ЭТИ данные в профиле цели, пока не
  // разведает заново (для 10 ур. — live-режим, актуален 3 дня).
  if (!user.spyReports) user.spyReports = {};
  user.spyReports[targetId] = buildSpyReport(target, reveal, lvl, now, liveUntil);
  db.save('users');

  notices.push(reveal.live
    ? `🛰 Спутник-шпион ведёт цель «${target.name}» в реальном времени (3 дня).`
    : `🔭 Разведка по «${target.name}» проведена — данные в профиле.`);
  return {
    ok: true, fresh: true,
    spyLeft: Math.max(0, free - user.spyCount),
    trophyLvl: lvl, live: reveal.live,
  };
}

// Получить разведданные по цели для профиля (или null, если не раскрыто).
// Для live-отчётов (10 ур.): пока не истекли 3 дня — пересобираем по
// АКТУАЛЬНЫМ данным цели; после истечения — удаляем и снова скрываем.
function spyReport(user: User, targetId: string) {
  const rep: any = (user.spyReports || {})[targetId];
  if (!rep) return null;
  if (rep.live && rep.liveUntil) {
    if (Date.now() >= rep.liveUntil) {
      delete user.spyReports![targetId];
      db.save('users');
      return null;
    }
    const target = users()[targetId];
    if (!target) return null;
    player.refresh(target);
    const reveal = config.spyReveal(rep.trophyLvl);
    return buildSpyReport(target, reveal, rep.trophyLvl, rep.at, rep.liveUntil);
  }
  return rep;
}

// ===================================================================
// 7. РЕЙТИНГОВЫЕ СЕЗОНЫ
// ===================================================================
function seasonStore(): any {
  return db.load('season', { id: 's1', startedAt: Date.now(), endsAt: 0 });
}

// Текущий сезон + топ игроков по сезонному рейтингу
function seasonView(user: User) {
  const s = seasonStore();
  const all = Object.values(users()).filter((p) => !p.isBot);
  const ranked = all
    .map((p) => ({ id: p.id, name: p.name, flag: player.flag(p), rating: p.seasonRating || 0 }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 20);
  const myRank = all
    .map((p) => ({ id: p.id, rating: p.seasonRating || 0 }))
    .sort((a, b) => b.rating - a.rating)
    .findIndex((p) => p.id === user.id) + 1;
  return {
    seasonId: s.id,
    myRating: user.seasonRating || 0,
    myRank: myRank || null,
    top: ranked,
  };
}

// Начисление сезонного рейтинга (вызывать при победе в бою)
function addSeasonRating(user: User, amount: number): void {
  const s = seasonStore();
  // Если игрок из прошлого сезона — обнуляем
  if (user.seasonId !== s.id) {
    user.seasonId = s.id;
    user.seasonRating = 0;
  }
  user.seasonRating = (user.seasonRating || 0) + amount;
}

// АДМИН: завершить сезон, наградить топ-3 и обнулить рейтинги
function adminEndSeason(adminUser: User, body: any, notices: Notices) {
  const s = seasonStore();
  const all = Object.values(users()).filter((p) => !p.isBot);
  const ranked = all
    .map((p) => ({ p, rating: p.seasonRating || 0 }))
    .sort((a, b) => b.rating - a.rating);

  const rewards = [
    { gold: u.toInt(body.gold1, 1000), tokens: u.toInt(body.tokens1, 5) },
    { gold: u.toInt(body.gold2, 500), tokens: u.toInt(body.tokens2, 3) },
    { gold: u.toInt(body.gold3, 250), tokens: u.toInt(body.tokens3, 1) },
  ];
  const winners: string[] = [];
  for (let i = 0; i < Math.min(3, ranked.length); i++) {
    const { p } = ranked[i];
    if ((ranked[i].rating || 0) <= 0) break;
    player.addGold(p, rewards[i].gold);
    p.tokens = (p.tokens || 0) + rewards[i].tokens;
    winners.push(`${i + 1}. ${p.name} (🪙 ${rewards[i].gold}, 🎖 ${rewards[i].tokens})`);
    try {
      require('./notifications').push(p.id, 'season_reward',
        `🏆 Сезон завершён! Вы заняли ${i + 1} место. Награда: 🪙 ${rewards[i].gold}, 🎖 ${rewards[i].tokens}`, {});
    } catch (e) {}
  }
  // Новый сезон + обнуление рейтингов
  const newId = 's' + (parseInt((s.id || 's1').slice(1), 10) + 1);
  for (const p of all) { p.seasonRating = 0; p.seasonId = newId; }
  const col = seasonStore();
  col.id = newId; col.startedAt = Date.now();
  db.save('season');
  db.save('users');
  notices.push(`🏁 Сезон завершён. Победители: ${winners.join('; ') || 'нет'}. Начат новый сезон.`);
  return { winners, newSeason: newId };
}

export = {
  loginStreakView, claimDailyIfDue,
  checkTitles, titlesView, setTitle, activeTitleName,
  contractsView, claimContract, rollContracts,
  cosmeticsView, buyCosmetic, equipCosmetic, unequipCosmetic,
  referralView, applyReferral, ensureRefCode, onReferralLevelUp, onReferralPurchase,
  spyOn, spyReport,
  seasonView, addSeasonRating, adminEndSeason,
};
