// ===================================================================
// src/services/saboteurs.ts — раздел «Диверсанты» (чёрный рынок)
//
// 6 видов войск-диверсантов. У каждого (кроме смертников) — НАЛИЧИЕ
// (сколько куплено всего) и ЛИЧНЫЙ ЛИМИТ (сколько из них РАБОТАЕТ
// одновременно). Наличие может превышать лимит — излишек лежит в
// запасе и не даёт эффекта, пока лимит не подняли апгрейдом.
//
// Работающие диверсанты (min(наличие, лимит)) снижают МОЩЬ своего типа
// техники у ПРОТИВНИКА на 0.1% за штуку — действует в ОБЕ стороны боя
// (и когда владелец атакует, и когда его атакуют):
//   наземные  → мощь наземной техники противника
//   морские   → мощь морской техники противника
//   воздушные → мощь воздушной техники противника
//   секретные → мощь секретных разработок противника
//   построечные → мощь оборонительных построек противника
//   смертники — НЕ снижают мощь; дают шанс избежать взрыва мины
//               (жертвуешь смертником вместо мини-игры с проводами)
//
// Расход (уничтожение):
//   - обычные (назем/мор/возд): понемногу в обычных боях (у атакующего
//     заметно чаще, чем у защищающегося), крупно — при подрыве мины
//     (10-50 шт.) и ракетном ударе (до 200 шт. при 100% мощности,
//     у ЦЕЛИ удара).
//   - секретные/построечные: гибнут ТОЛЬКО «за компанию» с обычными —
//     на каждые 5 уничтоженных обычных 1 секретный И 1 построечный
//     (накопительно, см. saboteurRareLossAccum), поэтому крайне редки.
//   - смертники: расходуются только при подрыве на мине (жертва).
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import db = require('../core/db');
import type { User, Notices } from '../types';

const S = config.SABOTEURS;
type RegularType = 'ground' | 'sea' | 'air';
type LimitedType = RegularType | 'secret' | 'building';
const REGULAR_TYPES: RegularType[] = ['ground', 'sea', 'air'];
const LIMITED_TYPES: LimitedType[] = ['ground', 'sea', 'air', 'secret', 'building'];

const RU_NAME: Record<string, string> = {
  ground: 'Наземные диверсанты', sea: 'Морские диверсанты', air: 'Воздушные диверсанты',
  secret: 'Секретные диверсанты', building: 'Диверсанты по постройкам', suicide: 'Смертники',
};

function cfgOf(type: LimitedType) {
  return (S as any)[type === 'ground' || type === 'sea' || type === 'air' ? 'regular' : type];
}

// Гарантируем поля диверсантов у игрока (старые аккаунты без них)
function ensure(user: User): void {
  if (!user.saboteurs) {
    user.saboteurs = { ground: 0, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 };
  }
  if (!user.saboteurLimits) {
    user.saboteurLimits = {
      ground: S.regular.startLimit, sea: S.regular.startLimit, air: S.regular.startLimit,
      secret: S.secret.startLimit, building: S.building.startLimit,
    };
  }
  if (typeof user.saboteurRareLossAccum !== 'number') user.saboteurRareLossAccum = 0;
}

// Сколько из данного вида реально РАБОТАЕТ (не больше лимита)
function active(user: User, type: LimitedType): number {
  ensure(user);
  return Math.min(user.saboteurs![type], user.saboteurLimits![type]);
}

// Дебафф, который НАНОСИТ владелец `user` своим диверсантами противнику.
// Возвращает {ground, air, sea, secret, building} — доли 0..1, передаются
// как debuffs в player.totalPower() ПРОТИВНИКА этого игрока.
function debuffsFor(user: User): { ground: number; air: number; sea: number; secret: number; building: number } {
  ensure(user);
  const pct = (t: LimitedType) => active(user, t) * S.effectPctPerUnit / 100;
  return {
    ground: pct('ground'), air: pct('air'), sea: pct('sea'),
    secret: pct('secret'), building: pct('building'),
  };
}

// ── Цены ────────────────────────────────────────────────────────────
// Цена ОДНОЙ пачки (10 шт.) — доллары (масштаб по уровню) [+ золото для
// секретных/построечных].
function packPrice(user: User, type: LimitedType): { dollars: number; gold: number } {
  const cfg = cfgOf(type);
  const dollars = Math.round(config.minUnitPriceAtLevel(user.level) * cfg.packDollarUnits);
  return { dollars, gold: cfg.packGoldExtra || 0 };
}

// Номер следующего шага апгрейда лимита (1-based): сколько шагов по +10
// уже сделано от startLimit до текущего лимита, +1.
function nextUpgradeStep(user: User, type: LimitedType): number {
  ensure(user);
  const cfg = cfgOf(type);
  const done = Math.round((user.saboteurLimits![type] - cfg.startLimit) / 10);
  return done + 1;
}

function nextUpgradeCost(user: User, type: LimitedType): number | null {
  ensure(user);
  const cfg = cfgOf(type);
  if (user.saboteurLimits![type] >= cfg.maxLimit) return null; // уже максимум
  return S.upgradeCost(cfg.upgradeStepGold, nextUpgradeStep(user, type));
}

// ── Вид экрана «Диверсанты» ──────────────────────────────────────────
function view(user: User) {
  ensure(user);
  const regularAndSpecial = LIMITED_TYPES.map((type) => {
    const cfg = cfgOf(type);
    const price = packPrice(user, type);
    const nextCost = nextUpgradeCost(user, type);
    return {
      id: type, name: RU_NAME[type],
      count: user.saboteurs![type], limit: user.saboteurLimits![type], maxLimit: cfg.maxLimit,
      active: active(user, type),
      packSize: S.packSize, packPriceDollars: price.dollars, packPriceGold: price.gold,
      upgradeCost: nextCost, atMaxLimit: nextCost === null,
      effectPct: Math.round(active(user, type) * S.effectPctPerUnit * 10) / 10,
    };
  });
  return {
    types: regularAndSpecial,
    suicide: {
      id: 'suicide', name: RU_NAME.suicide,
      count: user.saboteurs!.suicide, limit: S.suicide.fixedLimit, maxLimit: S.suicide.fixedLimit,
      priceGold: S.suicide.priceGold,
    },
  };
}

// ── Покупка пачки (10 шт.) — ground/sea/air/secret/building ─────────
function buyPack(user: User, type: LimitedType, packs: number, notices: Notices) {
  ensure(user);
  if (!LIMITED_TYPES.includes(type)) throw new u.ApiError('Неизвестный вид диверсантов');
  const n = Math.max(1, Math.min(20, Math.floor(packs) || 1)); // разумный потолок за раз
  const price = packPrice(user, type);
  const totalDollars = price.dollars * n;
  const totalGold = price.gold * n;
  if (user.dollars < totalDollars) throw new u.ApiError(`Не хватает денег (нужно $${u.fmt(totalDollars)})`);
  if (user.gold < totalGold) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${totalGold})`);
  user.dollars -= totalDollars;
  user.gold -= totalGold;
  user.saboteurs![type] += n * S.packSize;
  db.save('users');
  notices.push(`🥷 Куплено ${RU_NAME[type].toLowerCase()}: ${n * S.packSize} шт. (за $${u.fmt(totalDollars)}${totalGold ? ` + 🪙 ${totalGold}` : ''}). В наличии: ${user.saboteurs![type]} (работает: ${active(user, type)}/${user.saboteurLimits![type]}).`);
  return view(user);
}

// ── Покупка смертников (по 1 шт., только золото) ─────────────────────
function buySuicide(user: User, qty: number, notices: Notices) {
  ensure(user);
  const room = S.suicide.fixedLimit - user.saboteurs!.suicide;
  if (room <= 0) throw new u.ApiError(`Уже максимум смертников (${S.suicide.fixedLimit})`);
  const n = Math.max(1, Math.min(room, Math.floor(qty) || 1));
  const cost = n * S.suicide.priceGold;
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  user.gold -= cost;
  user.saboteurs!.suicide += n;
  db.save('users');
  notices.push(`💀 Куплено смертников: ${n} (за 🪙 ${cost}). В наличии: ${user.saboteurs!.suicide}/${S.suicide.fixedLimit}.`);
  return view(user);
}

// ── Апгрейд лимита на +10 (только золото) ────────────────────────────
function upgradeLimit(user: User, type: LimitedType, notices: Notices) {
  ensure(user);
  if (!LIMITED_TYPES.includes(type)) throw new u.ApiError('Неизвестный вид диверсантов');
  const cfg = cfgOf(type);
  const cost = nextUpgradeCost(user, type);
  if (cost === null) throw new u.ApiError(`Лимит уже максимальный (${cfg.maxLimit})`);
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  user.gold -= cost;
  user.saboteurLimits![type] = Math.min(cfg.maxLimit, user.saboteurLimits![type] + 10);
  db.save('users');
  notices.push(`📈 Лимит «${RU_NAME[type]}» повышен до ${user.saboteurLimits![type]} (за 🪙 ${cost}).`);
  return view(user);
}

// ── Уничтожение ОБЫЧНЫХ диверсантов (правило 5:1 каскадом) ──────────
// Списывает `count` штук случайным образом среди наземных/морских/
// воздушных, что реально есть у игрока. Возвращает подробности для
// уведомлений (сколько какого вида уничтожено).
function destroyRegular(user: User, count: number, notices: Notices | null): Record<string, number> {
  ensure(user);
  const lost: Record<string, number> = {};
  let left = Math.max(0, Math.floor(count));
  // Пул типов, у которых реально есть диверсанты (не обязательно активные —
  // взрыв/ракета не разбирают, работает диверсант или лежит в запасе)
  let pool = REGULAR_TYPES.filter((t) => user.saboteurs![t] > 0);
  while (left > 0 && pool.length > 0) {
    const t = pool[Math.floor(Math.random() * pool.length)];
    const take = Math.min(user.saboteurs![t], 1 + Math.floor(Math.random() * Math.min(3, left)));
    user.saboteurs![t] -= take;
    lost[t] = (lost[t] || 0) + take;
    left -= take;
    pool = REGULAR_TYPES.filter((t2) => user.saboteurs![t2] > 0);
  }
  const totalLost = Object.values(lost).reduce((s, n) => s + n, 0);

  // Правило 5:1: накопительно считаем уничтоженных обычных; при каждом
  // пересечении кратного 5 гибнет 1 секретный И 1 построечный (если есть)
  if (totalLost > 0) {
    const before = user.saboteurRareLossAccum || 0;
    const afterAccum = before + totalLost;
    const rareEvents = Math.floor(afterAccum / S.rareLossRatio) - Math.floor(before / S.rareLossRatio);
    user.saboteurRareLossAccum = afterAccum;
    if (rareEvents > 0) {
      const secretLost = Math.min(user.saboteurs!.secret, rareEvents);
      const buildingLost = Math.min(user.saboteurs!.building, rareEvents);
      if (secretLost > 0) { user.saboteurs!.secret -= secretLost; lost.secret = secretLost; }
      if (buildingLost > 0) { user.saboteurs!.building -= buildingLost; lost.building = buildingLost; }
    }
  }

  if (Object.keys(lost).length && notices) {
    const parts = Object.entries(lost).map(([t, n]) => `${RU_NAME[t].toLowerCase()} ×${n}`);
    notices.push(`🥷 Погибло диверсантов: ${parts.join(', ')}.`);
  }
  db.save('users');
  return lost;
}

// ── Расход в обычном бою (вызывается из battle.ts) ───────────────────
// role: 'attacker' — заметно чаще, 'defender' — гораздо реже.
function battleAttrition(user: User, role: 'attacker' | 'defender'): void {
  ensure(user);
  const chance = role === 'attacker' ? S.battleLossChanceAttacker : S.battleLossChanceDefender;
  if (Math.random() < chance) destroyRegular(user, 1, null);
}

// ── Уничтожение при подрыве мины (у нападающего, наступившего) ──────
function mineDestroy(user: User, notices: Notices): Record<string, number> {
  const count = S.mineDestroyMin + Math.floor(Math.random() * (S.mineDestroyMax - S.mineDestroyMin + 1));
  return destroyRegular(user, count, notices);
}

// ── Уничтожение при ракетном ударе (у ЦЕЛИ, масштаб от мощности) ────
function rocketDestroy(target: User, powerFrac: number, notices: Notices): Record<string, number> {
  const count = Math.round(S.rocketDestroyMax * Math.max(0, Math.min(1, powerFrac)));
  if (count <= 0) return {};
  return destroyRegular(target, count, notices);
}

export = {
  ensure, view, active, debuffsFor, buyPack, buySuicide, upgradeLimit,
  destroyRegular, battleAttrition, mineDestroy, rocketDestroy,
  packPrice, nextUpgradeCost,
};
