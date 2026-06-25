// ===================================================================
// src/services/silos.ts — раздел «Ракетные шахты» в Производстве
//
// Механика:
//   1. Игрок строит ракетную шахту: платит золото (300, потом ×2 за
//      каждую следующую). После постройки внутри появляется ракета с
//      двумя пустыми шкалами:
//        - ГОТОВНОСТЬ заполняется ЭНЕРГИЕЙ игрока (нужно 3000 энергии
//          на полную шкалу). Без полной готовности — запуск невозможен.
//        - МОЩНОСТЬ заполняется БОЕПРИПАСАМИ игрока (нужно 1000 на
//          полную шкалу). Определяет урон при запуске (макс. 3000).
//   2. Постройка шахты/пересборка ракеты занимает 24 часа, можно
//      ускорить за золото (цена линейно падает по мере приближения
//      готовности — от 1000 до 0).
//   3. Запуск ракеты — ПО ДРУГОМУ ИГРОКУ (выбор цели в окне запуска).
//      Урон зависит от текущей мощности (не обязательно 100%).
//      Урон разрушает постройки цели случайным образом (любые —
//      доходные и защитные) и уничтожает 100-300 единиц её техники
//      (60-70% слабой + 20-30% мощной, пропорционально мощности).
//   4. После запуска шахта остаётся, ракета внутри пересобирается
//      24 часа (шкалы снова пустые).
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import notifications = require('./notifications');
import discounts = require('./discounts');
import type { User, Notices } from '../types';

const S = config.SILO;

function silos(user: User): any[] {
  if (!user.silos) user.silos = [];
  return user.silos;
}

function nextSiloCost(user: User): number {
  const built = user.silosBuiltTotal || 0;
  const base = Math.round(S.FIRST_PRICE_GOLD * Math.pow(S.PRICE_MULT, built));
  return discounts.applyTo('silo', base);
}

// Новая «пустая» ракета (после постройки шахты или после запуска)
function freshRocket(): any {
  return {
    readyEnergy: 0,   // накопленная энергия (0..READY_ENERGY_NEEDED)
    powerAmmo: 0,     // накопленные боеприпасы (0..POWER_AMMO_NEEDED)
    buildFinishesAt: Date.now() + S.BUILD_TIME_MS,
  };
}

// Цена ускорения постройки — линейно падает по мере приближения готовности
function boostCost(rocket: any): number {
  const now = Date.now();
  const totalMs = S.BUILD_TIME_MS;
  const remainingMs = Math.max(0, rocket.buildFinishesAt - now);
  const fracRemaining = remainingMs / totalMs; // 1.0 в начале, 0 в конце
  return Math.round(S.BOOST_GOLD * fracRemaining);
}

function siloView(silo: any) {
  const now = Date.now();
  const r = silo.rocket;
  const building = r.buildFinishesAt > now;
  return {
    id: silo.id,
    building,
    buildRemainingSec: building ? Math.max(0, Math.ceil((r.buildFinishesAt - now) / 1000)) : 0,
    boostCostGold: building ? boostCost(r) : 0,
    readyPct: building ? 0 : Math.round((r.readyEnergy / S.READY_ENERGY_NEEDED) * 100),
    powerPct: building ? 0 : Math.round((r.powerAmmo / S.POWER_AMMO_NEEDED) * 100),
    readyEnergy: r.readyEnergy, readyNeeded: S.READY_ENERGY_NEEDED,
    powerAmmo: r.powerAmmo, powerNeeded: S.POWER_AMMO_NEEDED,
    canLaunch: !building && r.readyEnergy >= S.READY_ENERGY_NEEDED,
    estimatedDamage: Math.round(S.MAX_DAMAGE * Math.min(1, r.powerAmmo / S.POWER_AMMO_NEEDED)),
  };
}

function view(user: User) {
  return {
    silos: silos(user).map(siloView),
    nextSiloCostGold: nextSiloCost(user),
    unlockLevel: config.PRODUCTION_UNLOCK_LEVEL,
  };
}

// ---------- Построить новую ракетную шахту ----------
function build(user: User, notices: Notices) {
  if (user.level < config.PRODUCTION_UNLOCK_LEVEL) {
    throw new u.ApiError(`Ракетные шахты доступны с ${config.PRODUCTION_UNLOCK_LEVEL} уровня`);
  }
  const cost = nextSiloCost(user);
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  user.gold -= cost;
  user.silosBuiltTotal = (user.silosBuiltTotal || 0) + 1;

  const silo = { id: u.uid(10), rocket: freshRocket() };
  silos(user).push(silo);
  notices.push(`🚀 Заложена новая ракетная шахта. Постройка займёт 24 часа.`);
  return siloView(silo);
}

// ---------- Ускорить постройку/пересборку за золото ----------
function boost(user: User, siloId: string, notices: Notices) {
  const silo = silos(user).find((s) => s.id === siloId);
  if (!silo) throw new u.ApiError('Шахта не найдена');
  const r = silo.rocket;
  if (r.buildFinishesAt <= Date.now()) throw new u.ApiError('Ракета уже готова к заправке');
  const cost = boostCost(r);
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  user.gold -= cost;
  r.buildFinishesAt = Date.now();
  notices.push(`⚡ Постройка ускорена за 🪙 ${cost}. Ракета готова к заправке.`);
  return siloView(silo);
}

// ---------- Залить энергию в шкалу готовности ----------
function fuelReady(user: User, siloId: string, amount: number, notices: Notices) {
  const silo = silos(user).find((s) => s.id === siloId);
  if (!silo) throw new u.ApiError('Шахта не найдена');
  const r = silo.rocket;
  if (r.buildFinishesAt > Date.now()) throw new u.ApiError('Шахта ещё строится');
  amount = u.toInt(amount);
  if (amount <= 0) throw new u.ApiError('Укажите количество энергии');
  const mx = player.maxima(user);
  if (user.res.en.cur < amount) throw new u.ApiError('Не хватает энергии');
  const room = S.READY_ENERGY_NEEDED - r.readyEnergy;
  const used = Math.min(amount, room);
  if (used <= 0) throw new u.ApiError('Шкала готовности уже полная');
  user.res.en.cur -= used;
  r.readyEnergy += used;
  notices.push(`🔋 Готовность ракеты: ${r.readyEnergy} / ${S.READY_ENERGY_NEEDED} (+${used} энергии)`);
  return siloView(silo);
}

// ---------- Залить боеприпасы в шкалу мощности ----------
function fuelPower(user: User, siloId: string, amount: number, notices: Notices) {
  const silo = silos(user).find((s) => s.id === siloId);
  if (!silo) throw new u.ApiError('Шахта не найдена');
  const r = silo.rocket;
  if (r.buildFinishesAt > Date.now()) throw new u.ApiError('Шахта ещё строится');
  amount = u.toInt(amount);
  if (amount <= 0) throw new u.ApiError('Укажите количество боеприпасов');
  if (user.res.am.cur < amount) throw new u.ApiError('Не хватает боеприпасов');
  const room = S.POWER_AMMO_NEEDED - r.powerAmmo;
  const used = Math.min(amount, room);
  if (used <= 0) throw new u.ApiError('Шкала мощности уже полная');
  user.res.am.cur -= used;
  r.powerAmmo += used;
  notices.push(`💪 Мощность ракеты: ${r.powerAmmo} / ${S.POWER_AMMO_NEEDED} (+${used} боеприпасов)`);
  return siloView(silo);
}

// ---------- Запуск ракеты по цели ----------
function launch(user: User, siloId: string, targetId: string, notices: Notices) {
  const silo = silos(user).find((s) => s.id === siloId);
  if (!silo) throw new u.ApiError('Шахта не найдена');
  const r = silo.rocket;
  if (r.buildFinishesAt > Date.now()) throw new u.ApiError('Шахта ещё строится');
  if (r.readyEnergy < S.READY_ENERGY_NEEDED) throw new u.ApiError('Шкала готовности не заполнена — запуск невозможен');
  if (targetId === user.id) throw new u.ApiError('Нельзя запустить ракету по себе');

  const target = player.users()[targetId];
  if (!target) throw new u.ApiError('Цель не найдена');
  player.refresh(target);

  // Урон пропорционален текущей мощности (не обязательно 100%)
  const powerFrac = Math.min(1, r.powerAmmo / S.POWER_AMMO_NEEDED);
  const damage = Math.round(S.MAX_DAMAGE * powerFrac);

  // ----- Разрушение построек цели (случайным образом, пока хватает урона) -----
  const buildingEntries: any[] = [];
  for (const [id, count] of Object.entries(target.buildings || {})) {
    const def = config.BUILDING_BY_ID[id];
    if (def && (count as number) > 0) {
      for (let i = 0; i < (count as number); i++) buildingEntries.push(id);
    }
  }
  u.shuffle(buildingEntries);
  let remainingDamage = damage;
  const destroyed = {};
  for (const id of buildingEntries) {
    const def = config.BUILDING_BY_ID[id];
    const hp = def.hp || 30;
    if (remainingDamage < hp) break;
    remainingDamage -= hp;
    target.buildings[id] = (target.buildings[id] || 1) - 1;
    if (target.buildings[id] <= 0) delete target.buildings[id];
    destroyed[def.name] = (destroyed[def.name] || 0) + 1;
  }

  // ----- Уничтожение техники цели (масштаб от мощности) -----
  const techLossTotal = Math.round((S.TECH_LOSS_MIN + (S.TECH_LOSS_MAX - S.TECH_LOSS_MIN) * powerFrac));
  const weakPct = S.TECH_LOSS_WEAK_PCT_MIN + Math.random() * (S.TECH_LOSS_WEAK_PCT_MAX - S.TECH_LOSS_WEAK_PCT_MIN);
  const strongPct = S.TECH_LOSS_STRONG_PCT_MIN + Math.random() * (S.TECH_LOSS_STRONG_PCT_MAX - S.TECH_LOSS_STRONG_PCT_MIN);

  // Собираем все юниты цели, сортируем по «слабости» (unlock level) —
  // слабые впереди, мощные сзади
  const unitPool: any[] = [];
  for (const [unitId, mkMapRaw] of Object.entries(target.units || {})) {
    const cu = config.UNIT_BY_ID[unitId];
    if (!cu) continue;
    for (let mk = 0; mk <= 2; mk++) {
      const cnt = (mkMapRaw && mkMapRaw[mk]) || 0;
      if (cnt > 0) unitPool.push({ unitId, mk, count: cnt, unlock: cu.unlock, name: cu.name + (mk ? ` Mk${mk}` : '') });
    }
  }
  unitPool.sort((a, b) => a.unlock - b.unlock); // слабые (низкий unlock) первыми

  const techLost = {};
  let toLoseWeak = Math.round(techLossTotal * weakPct);
  let toLoseStrong = Math.round(techLossTotal * strongPct);
  let toLoseMid = Math.max(0, techLossTotal - toLoseWeak - toLoseStrong);

  const applyLoss = (pool, amount) => {
    let left = amount;
    for (const e of pool) {
      if (left <= 0) break;
      const m = target.units[e.unitId];
      if (!m) continue;
      const have = m[e.mk] || 0;
      if (have <= 0) continue;
      const take = Math.min(have, left);
      m[e.mk] = have - take;
      left -= take;
      techLost[e.name] = (techLost[e.name] || 0) + take;
      if ((m[0] || 0) + (m[1] || 0) + (m[2] || 0) <= 0) delete target.units[e.unitId];
    }
    return left; // сколько не удалось списать (пул исчерпан)
  };

  const thirdLen = Math.ceil(unitPool.length / 3);
  const weakPool = unitPool.slice(0, thirdLen);
  const midPool = unitPool.slice(thirdLen, thirdLen * 2);
  const strongPool = unitPool.slice(thirdLen * 2);

  applyLoss(weakPool, toLoseWeak);
  applyLoss(midPool, toLoseMid);
  applyLoss(strongPool, toLoseStrong);

  // ----- Пересобираем ракету (шахта остаётся, ракета — заново 24ч) -----
  silo.rocket = freshRocket();

  // ----- Уведомления -----
  const destroyedList = Object.entries(destroyed).map(([n, c]) => `${n} ×${c}`).join(', ');
  const techLostList = Object.entries(techLost).map(([n, c]) => `${n} ×${c}`).join(', ');
  notices.push(
    `🚀 Ракета запущена по «${target.name}»! Урон: ${damage} (мощность ${Math.round(powerFrac * 100)}%).` +
    (destroyedList ? ` Разрушено построек: ${destroyedList}.` : ' Постройки уцелели.') +
    (techLostList ? ` Уничтожено техники: ${techLostList}.` : '')
  );
  notifications.push(target.id, 'rocket_hit', `🚀 ${user.name} нанёс по вам ракетный удар`, {
    attackerName: user.name, attackerId: user.id, attackerLevel: user.level,
    damage, powerPct: Math.round(powerFrac * 100),
    destroyedBuildingsText: destroyedList || null,
    techLostText: techLostList || null,
    at: Date.now(),
  });

  return {
    damage, powerPct: Math.round(powerFrac * 100),
    destroyedBuildings: destroyed, techLost,
    silo: siloView(silo),
  };
}

export = { view, build, boost, fuelReady, fuelPower, launch };
