// ═══════════════════════════════════════════════════════════════════
// src/services/groupUpgrades.ts — Улучшения групповых боёв
//
// Восемь навыков, по 50 уровней каждый. Уровни разбиты на пять
// ступеней по десять, и каждая ступень открывается своим рангом:
//   Новички (1000) → уровни 1–10
//   Опытные (2000) → 11–20
//   Продвинутые (3000) → 21–30
//   Спецотряд (4000) → 31–40
//   Элита (5000) → 41–50
//
// Ранг «Салаги» улучшений не даёт — с него начинают все.
//
// Правило перехода: пока навык не выкачан до конца текущей ступени,
// следующая для него закрыта, даже если ранг уже позволяет. Иначе
// игрок распылил бы очки по верхам, а смысл ступеней исчез.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

// ---------- Базовые характеристики бойца ----------
// От них считаются все прибавки. Проценты — доли: 0.2 это 20%.
const BASE = {
  hp: 1500,
  energy: 1000,
  ammo: 70,
  critChance: 0.20,
  dodgeChance: 0.20,
  healCritChance: 0.20,     // базовый шанс критического лечения
};

// Критический удар и критическое лечение усиливают втрое-впятеро,
// как на арене. Разброс случайный при каждом срабатывании.
const CRIT_MIN = 3;
const CRIT_MAX = 5;
function critMult(): number {
  return CRIT_MIN + Math.random() * (CRIT_MAX - CRIT_MIN);
}

// ---------- Навыки ----------
// step — прибавка за один уровень. Для процентных навыков это доли,
// для боеприпасов — штуки.
const SKILLS = [
  { id: 'crit',     name: 'Критический шанс',   icon: '💥', step: 0.01, kind: 'pct',
    desc: 'Шанс нанести удвоенный урон' },
  { id: 'dodge',    name: 'Уворот',             icon: '💨', step: 0.01, kind: 'pct',
    desc: 'Шанс полностью избежать удара' },
  { id: 'reward',   name: 'Увеличение награды', icon: '🪙', step: 0.01, kind: 'pct',
    desc: 'Больше жетонов за бой' },
  { id: 'healCrit', name: 'Крит. шанс лечения', icon: '💚', step: 0.01, kind: 'pct',
    desc: 'Шанс вылечить вдвое больше' },
  { id: 'armor',    name: 'Снижение урона',     icon: '🛡', step: 0.007, kind: 'pct',
    desc: 'Весь входящий урон слабее' },
  { id: 'hp',       name: 'Увеличение HP',      icon: '❤', step: 0.02, kind: 'pct',
    desc: 'Больше запас здоровья в бою' },
  { id: 'energy',   name: 'Увеличение энергии', icon: '⚡', step: 0.03, kind: 'pct',
    desc: 'Больше энергии на лечение и прикрытие' },
  { id: 'ammo',     name: 'Боеприпасы',         icon: '🎯', step: 3, kind: 'flat',
    desc: 'Больше патронов на бой' },
];
const SKILL_IDS = SKILLS.map((s) => s.id);

const LEVELS_PER_TIER = 10;
const MAX_LEVEL = 50;

// Ступени привязаны к рангам групповых боёв
// Цвет ступени — им красятся названия навыков и цифры прибавок, чтобы
// с одного взгляда было видно, на каком уровне что прокачано.
const TIERS = [
  { rank: 'rookie',   name: 'Новички',     need: 1000, from: 1,  to: 10, color: '#ffffff' },
  { rank: 'skilled',  name: 'Опытные',     need: 2000, from: 11, to: 20, color: '#5fbf4a' },
  { rank: 'advanced', name: 'Продвинутые', need: 3000, from: 21, to: 30, color: '#4a9fe0' },
  { rank: 'special',  name: 'Спецотряд',   need: 4000, from: 31, to: 40, color: '#a978d4' },
  { rank: 'elite',    name: 'Элита',       need: 5000, from: 41, to: 50, color: '#e05555' },
];

// ---------- Цена ----------
// Заданы четыре опорные точки: 1-й уровень, 10-й, 41-й и 50-й.
// Между ними цена растёт плавно внутри каждой ступени. Опорные
// значения ступеней подобраны так, чтобы цена НИКОГДА не падала при
// переходе на следующую ступень — иначе выгоднее было бы копить.
//
// Валюта улучшений — «боевые очки», отдельный ресурс групповых боёв.
// Не путать с жетонами милосердия: те давно есть в игре и тратятся
// здесь как второй ресурс, наравне с ушами.
const CURRENCY_NAME = 'Боевые очки';
const CURRENCY_ICON = '🎗';

const TIER_COST = [
  { curFrom: 500,    curTo: 5000,   resFrom: 5,   resTo: 30 },   // 1–10
  { curFrom: 6000,   curTo: 15000,  resFrom: 32,  resTo: 50 },   // 11–20
  { curFrom: 17000,  curTo: 30000,  resFrom: 52,  resTo: 70 },   // 21–30
  { curFrom: 33000,  curTo: 45000,  resFrom: 72,  resTo: 95 },   // 31–40
  { curFrom: 50000,  curTo: 300000, resFrom: 100, resTo: 300 },  // 41–50
];

function tierOfLevel(level: number): number {
  return u.clamp(Math.ceil(level / LEVELS_PER_TIER) - 1, 0, TIERS.length - 1);
}

// Цена ПОВЫШЕНИЯ до указанного уровня (1 — первое улучшение)
function costOf(level: number): { amount: number; ears: number; tokens: number } {
  const lvl = u.clamp(Math.round(level), 1, MAX_LEVEL);
  const t = tierOfLevel(lvl);
  const c = TIER_COST[t];
  const stepInTier = (lvl - 1) % LEVELS_PER_TIER;          // 0..9
  const k = stepInTier / (LEVELS_PER_TIER - 1);            // 0..1
  // Плавный рост внутри ступени
  const amount = Math.round(c.curFrom + (c.curTo - c.curFrom) * k);
  const res = Math.round(c.resFrom + (c.resTo - c.resFrom) * k);
  // amount — боевые очки, ears — уши, tokens — жетоны милосердия
  return { amount, ears: res, tokens: res };
}

// ---------- Уровни игрока ----------
function levelsOf(user: any): Record<string, number> {
  if (!user.gbUpgrades) user.gbUpgrades = {};
  for (const id of SKILL_IDS) if (typeof user.gbUpgrades[id] !== 'number') user.gbUpgrades[id] = 0;
  return user.gbUpgrades;
}

function ratingOf(user: any): number {
  try {
    const s = db.load<any>('groupBattle', {});
    const rec = (s.ratings || {})[user.id];
    return rec ? rec.points : 0;
  } catch (e) { return 0; }
}

// До какого уровня игрок может качать навык при своём рейтинге
function levelCapFor(points: number): number {
  let cap = 0;
  for (const t of TIERS) if (points >= t.need) cap = t.to;
  return cap;
}

// ---------- Итоговые характеристики бойца ----------
// Используются боем: сюда стекаются все прибавки.
function statsFor(user: any) {
  const lv = levelsOf(user);
  const get = (id: string) => {
    const def = SKILLS.find((s) => s.id === id)!;
    return (lv[id] || 0) * def.step;
  };
  // Доли округляем до сотых долей процента: сложение дробей даёт
  // хвосты вроде 0.30000000000000004, и сравнение значений ломается
  const pct = (v: number) => Math.round(v * 10000) / 10000;
  return {
    hp: Math.round(BASE.hp * (1 + get('hp'))),
    energy: Math.round(BASE.energy * (1 + get('energy'))),
    ammo: Math.round(BASE.ammo + get('ammo')),
    critChance: pct(Math.min(0.95, BASE.critChance + get('crit'))),
    dodgeChance: pct(Math.min(0.75, BASE.dodgeChance + get('dodge'))),
    healCritChance: pct(Math.min(0.95, BASE.healCritChance + get('healCrit'))),
    damageReduce: pct(Math.min(0.60, get('armor'))),
    rewardBonus: pct(get('reward')),
    critMin: CRIT_MIN,
    critMax: CRIT_MAX,
  };
}

// ---------- Витрина ----------
function view(user: User) {
  const lv = levelsOf(user);
  const points = ratingOf(user);
  const cap = levelCapFor(points);
  const stats = statsFor(user);

  return {
    base: BASE,
    critMin: CRIT_MIN,
    critMax: CRIT_MAX,
    myPoints: points,
    levelCap: cap,
    maxLevel: MAX_LEVEL,
    currencyName: CURRENCY_NAME,
    currencyIcon: CURRENCY_ICON,
    wallet: {
      points: (user as any).battlePoints || 0,
      ears: (user as any).ears || 0,
      tokens: (user as any).tokens || 0,
    },
    stats,
    tiers: TIERS.map((t) => ({
      ...t,
      unlocked: points >= t.need,
      left: Math.max(0, t.need - points),
    })),
    // Навыки, разложенные по ступеням: на каждой — свои десять уровней.
    // Так игрок видит, что именно откроется дальше, а не сплошной
    // список из пятидесяти.
    tierSkills: TIERS.map((t, ti) => ({
      ...t,
      unlocked: points >= t.need,
      left: Math.max(0, t.need - points),
      skills: SKILLS.map((sk) => {
        const level = lv[sk.id] || 0;
        // Сколько уровней этой ступени уже взято
        const inTier = u.clamp(level - (t.from - 1), 0, LEVELS_PER_TIER);
        const prevDone = level >= t.from - 1;          // предыдущая ступень выкачана
        const next = level + 1;
        const isCurrent = next >= t.from && next <= t.to;
        const atMaxTier = inTier >= LEVELS_PER_TIER;
        const cost = (isCurrent && level < MAX_LEVEL) ? costOf(next) : null;
        const value = sk.kind === 'flat' ? level * sk.step : level * sk.step * 100;
        // Что даст ступень целиком, если выкачать её до конца
        const tierValue = sk.kind === 'flat' ? t.to * sk.step : t.to * sk.step * 100;
        return {
          id: sk.id, name: sk.name, icon: sk.icon, desc: sk.desc, kind: sk.kind,
          step: sk.kind === 'flat' ? sk.step : sk.step * 100,
          level, inTier, tierMax: LEVELS_PER_TIER,
          atMaxTier, isCurrent,
          value: Math.round(value * 10) / 10,
          tierValue: Math.round(tierValue * 10) / 10,
          nextCost: cost,
          canUpgrade: !!cost && points >= t.need && prevDone && affordable(user, cost),
          blockedByRank: isCurrent && points < t.need,
          blockedByPrev: isCurrent && !prevDone,
        };
      }),
    })),
    skills: SKILLS.map((s) => {
      const level = lv[s.id] || 0;
      const next = level + 1;
      const canByCap = next <= cap;
      const atMax = level >= MAX_LEVEL;
      const cost = atMax ? null : costOf(next);
      // Текущее значение навыка — для показа «что даёт»
      const value = s.kind === 'flat' ? level * s.step : level * s.step * 100;
      return {
        id: s.id, name: s.name, icon: s.icon, desc: s.desc, kind: s.kind,
        step: s.kind === 'flat' ? s.step : s.step * 100,
        level, maxLevel: MAX_LEVEL, atMax,
        value: Math.round(value * 10) / 10,
        tier: tierOfLevel(next) ,
        nextCost: cost,
        canUpgrade: !atMax && canByCap && affordable(user, cost),
        blockedByRank: !atMax && !canByCap,
        // Какой ранг нужен для следующего уровня
        needTier: !atMax && !canByCap ? TIERS[tierOfLevel(next)] : null,
      };
    }),
  };
}

function affordable(user: any, cost: any): boolean {
  if (!cost) return false;
  return (user.battlePoints || 0) >= cost.amount
    && (user.ears || 0) >= cost.ears
    && (user.tokens || 0) >= cost.tokens;
}

// ---------- Улучшение ----------
function upgrade(user: User, skillId: string, notices: Notices) {
  const def = SKILLS.find((s) => s.id === String(skillId || ''));
  if (!def) throw new u.ApiError('Неизвестный навык');

  const lv = levelsOf(user);
  const level = lv[def.id] || 0;
  if (level >= MAX_LEVEL) throw new u.ApiError('Навык уже прокачан до предела');

  const next = level + 1;
  const points = ratingOf(user);
  const cap = levelCapFor(points);
  if (next > cap) {
    const need = TIERS[tierOfLevel(next)];
    throw new u.ApiError(
      `Уровень ${next} открывается на ранге «${need.name}» — нужно ${need.need} очков рейтинга`
    );
  }

  const cost = costOf(next);
  if (((user as any).battlePoints || 0) < cost.amount) {
    throw new u.ApiError(`Не хватает боевых очков: нужно ${CURRENCY_ICON} ${u.fmt(cost.amount)}`);
  }
  if (((user as any).ears || 0) < cost.ears) throw new u.ApiError(`Не хватает ушей: нужно ${cost.ears}`);
  if (((user as any).tokens || 0) < cost.tokens) {
    throw new u.ApiError(`Не хватает жетонов милосердия: нужно ${cost.tokens}`);
  }

  // Списываем
  (user as any).battlePoints -= cost.amount;
  (user as any).ears -= cost.ears;
  (user as any).tokens -= cost.tokens;
  lv[def.id] = next;

  db.markUser(user.id);
  db.markUser(user.id);
  auditLog.record({
    userId: user.id, userName: user.name, path: '/api/group/upgrade',
    body: { skill: def.id, level: next, cost },
  });

  const shown = def.kind === 'flat'
    ? `+${next * def.step}`
    : `+${Math.round(next * def.step * 1000) / 10}%`;
  notices.push(`${def.icon} «${def.name}» улучшен до ${next} уровня (${shown})`);
  return view(user);
}

export = {
  view, upgrade, statsFor, costOf, levelsOf, levelCapFor, tierOfLevel, critMult,
  SKILLS, SKILL_IDS, TIERS, TIER_COST, BASE, MAX_LEVEL, LEVELS_PER_TIER,
  CRIT_MIN, CRIT_MAX, CURRENCY_NAME, CURRENCY_ICON,
};
