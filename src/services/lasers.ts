// ===================================================================
// src/services/lasers.ts — раздел «Лазеры» (ПВО против ракет)
//
// Лазер сбивает летящие ракеты. Покупается за золото (1-й — 300, ×2 каждый
// следующий), строится 24 ч. Заряжается энергией (готовность) и боеприпасами
// (точность) из текущих запасов игрока. Выстрел возможен только при энергии
// на 100%; шанс сбить = доля заполнения боеприпасов (50% → 50%). После
// выстрела заряд обнуляется и лазер уходит на охлаждение 24 ч. Перехватывать
// можно ЛЮБЫЕ чужие летящие ракеты (по себе или по другим).
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import db = require('../core/db');
import discounts = require('./discounts');
import player = require('./player');
import notifications = require('./notifications');
import type { User, Notices } from '../types';

const L = config.LASER;

function lasers(user: User): any[] {
  if (!user.lasers) user.lasers = [];
  return user.lasers;
}
function rockets(): Record<string, any> { return db.load('rockets', {}); }

function nextLaserCost(user: User): number {
  const built = (user as any).lasersBuiltTotal || 0;
  const base = Math.round(L.FIRST_PRICE_GOLD * Math.pow(L.PRICE_MULT, built));
  return discounts.applyTo('laser', base);
}

function freshLaser(): any {
  return { id: u.uid(10), phase: 'building', readyAt: Date.now() + L.BUILD_TIME_MS, waitTotalMs: L.BUILD_TIME_MS, readyEnergy: 0, powerAmmo: 0 };
}

// Цена ускорения постройки/охлаждения — линейно падает к остатку времени.
function boostCost(laser: any): number {
  const remaining = Math.max(0, laser.readyAt - Date.now());
  const frac = remaining / (laser.waitTotalMs || L.BUILD_TIME_MS);
  return Math.round(L.BOOST_GOLD * frac);
}

function laserView(laser: any) {
  const now = Date.now();
  const busy = laser.readyAt > now; // строится или охлаждается
  return {
    id: laser.id,
    phase: busy ? laser.phase : 'ready',            // building | cooling | ready
    busy,
    busyRemainingSec: busy ? Math.max(0, Math.ceil((laser.readyAt - now) / 1000)) : 0,
    boostCostGold: busy ? boostCost(laser) : 0,
    readyEnergy: laser.readyEnergy, readyNeeded: L.READY_ENERGY_NEEDED,
    powerAmmo: laser.powerAmmo, powerNeeded: L.POWER_AMMO_NEEDED,
    readyPct: busy ? 0 : Math.round((laser.readyEnergy / L.READY_ENERGY_NEEDED) * 100),
    powerPct: busy ? 0 : Math.round((laser.powerAmmo / L.POWER_AMMO_NEEDED) * 100),
    interceptChancePct: Math.round((laser.powerAmmo / L.POWER_AMMO_NEEDED) * 100),
    canFire: !busy && laser.readyEnergy >= L.READY_ENERGY_NEEDED,
  };
}

// Список ЧУЖИХ летящих ракет, которые можно перехватить (по себе или другим).
function interceptables(user: User) {
  const now = Date.now();
  const out: any[] = [];
  const all = rockets();
  for (const id of Object.keys(all)) {
    const rk = all[id];
    if (rk.resolved || rk.intercepted) continue;
    if (rk.impactAt <= now) continue;          // уже долетает — обработается тиком
    if (rk.attackerId === user.id) continue;   // свои пуски не показываем
    out.push({
      id: rk.id,
      attackerName: rk.attackerName,
      targetName: rk.targetName,
      isMe: rk.targetId === user.id,
      powerPct: Math.round(rk.powerFrac * 100),
      impactRemainingSec: Math.max(0, Math.ceil((rk.impactAt - now) / 1000)),
    });
  }
  // Сначала те, что летят по мне; затем по времени до попадания
  out.sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0) || a.impactRemainingSec - b.impactRemainingSec);
  return out;
}

function view(user: User) {
  require('./silos').resolveInFlight(); // долёт ракет (ленивое обновление)
  return {
    lasers: lasers(user).map(laserView),
    nextLaserCostGold: nextLaserCost(user),
    unlockLevel: config.PRODUCTION_UNLOCK_LEVEL,
    inFlight: interceptables(user),
  };
}

// ---------- Купить лазер ----------
function buyLaser(user: User, notices: Notices) {
  if (user.level < config.PRODUCTION_UNLOCK_LEVEL) throw new u.ApiError(`Лазеры доступны с ${config.PRODUCTION_UNLOCK_LEVEL} уровня`);
  const cost = nextLaserCost(user);
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  user.gold -= cost;
  (user as any).lasersBuiltTotal = ((user as any).lasersBuiltTotal || 0) + 1;
  const laser = freshLaser();
  lasers(user).push(laser);
  db.save('users');
  const h = Math.round(L.BUILD_TIME_MS / 3600000);
  notices.push(`🔦 Лазер куплен за 🪙 ${cost}. Постройка займёт ${h} ч, затем заряжайте его.`);
  return laserView(laser);
}

// ---------- Ускорить постройку/охлаждение за золото ----------
function boost(user: User, laserId: string, notices: Notices) {
  const laser = lasers(user).find((x) => x.id === laserId);
  if (!laser) throw new u.ApiError('Лазер не найден');
  if (laser.readyAt <= Date.now()) throw new u.ApiError('Лазер уже готов');
  const cost = boostCost(laser);
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  user.gold -= cost;
  laser.readyAt = Date.now();
  db.save('users');
  notices.push(`⚡ ${laser.phase === 'cooling' ? 'Охлаждение' : 'Постройка'} ускорено за 🪙 ${cost}. Лазер готов.`);
  return laserView(laser);
}

// ---------- Залить энергию (готовность) ----------
function fuelReady(user: User, laserId: string, amount: number, notices: Notices) {
  const laser = lasers(user).find((x) => x.id === laserId);
  if (!laser) throw new u.ApiError('Лазер не найден');
  if (laser.readyAt > Date.now()) throw new u.ApiError(laser.phase === 'cooling' ? 'Лазер остывает' : 'Лазер ещё строится');
  amount = u.toInt(amount);
  if (amount <= 0) throw new u.ApiError('Укажите количество энергии');
  if (user.res.en.cur < amount) throw new u.ApiError('Не хватает энергии');
  const room = L.READY_ENERGY_NEEDED - laser.readyEnergy;
  const used = Math.min(amount, room);
  if (used <= 0) throw new u.ApiError('Готовность уже полная');
  user.res.en.cur -= used;
  laser.readyEnergy += used;
  db.save('users');
  notices.push(`🔋 Готовность лазера: ${laser.readyEnergy} / ${L.READY_ENERGY_NEEDED} (+${used})`);
  return laserView(laser);
}

// ---------- Залить боеприпасы (точность) ----------
function fuelPower(user: User, laserId: string, amount: number, notices: Notices) {
  const laser = lasers(user).find((x) => x.id === laserId);
  if (!laser) throw new u.ApiError('Лазер не найден');
  if (laser.readyAt > Date.now()) throw new u.ApiError(laser.phase === 'cooling' ? 'Лазер остывает' : 'Лазер ещё строится');
  amount = u.toInt(amount);
  if (amount <= 0) throw new u.ApiError('Укажите количество боеприпасов');
  if (user.res.am.cur < amount) throw new u.ApiError('Не хватает боеприпасов');
  const room = L.POWER_AMMO_NEEDED - laser.powerAmmo;
  const used = Math.min(amount, room);
  if (used <= 0) throw new u.ApiError('Точность уже максимальная');
  user.res.am.cur -= used;
  laser.powerAmmo += used;
  db.save('users');
  notices.push(`🎯 Точность лазера: ${Math.round((laser.powerAmmo / L.POWER_AMMO_NEEDED) * 100)}% (+${used} боеприпасов)`);
  return laserView(laser);
}

// ---------- Выстрел лазером по летящей ракете ----------
function intercept(user: User, laserId: string, rocketId: string, notices: Notices) {
  require('./silos').resolveInFlight();
  const laser = lasers(user).find((x) => x.id === laserId);
  if (!laser) throw new u.ApiError('Лазер не найден');
  if (laser.readyAt > Date.now()) throw new u.ApiError(laser.phase === 'cooling' ? 'Лазер остывает' : 'Лазер ещё строится');
  if (laser.readyEnergy < L.READY_ENERGY_NEEDED) throw new u.ApiError('Готовность не заполнена — выстрел невозможен');

  const all = rockets();
  const rk = all[rocketId];
  if (!rk || rk.resolved || rk.intercepted) throw new u.ApiError('Эта ракета уже недоступна');
  if (rk.impactAt <= Date.now()) throw new u.ApiError('Ракета уже долетает — сбить не успеть');
  if (rk.attackerId === user.id) throw new u.ApiError('Нельзя сбивать собственную ракету');

  const chance = laser.powerAmmo / L.POWER_AMMO_NEEDED; // доля заполнения боеприпасов
  const chancePct = Math.round(chance * 100);
  const hit = Math.random() < chance;

  // Тратим заряд и отправляем лазер на охлаждение (независимо от результата)
  laser.readyEnergy = 0;
  laser.powerAmmo = 0;
  laser.phase = 'cooling';
  laser.waitTotalMs = L.COOLDOWN_MS;
  laser.readyAt = Date.now() + L.COOLDOWN_MS;

  if (hit) {
    rk.intercepted = true; rk.interceptedBy = user.id; rk.resolved = true; rk.resolvedAt = Date.now();
    db.save('rockets');
    // Уведомляем цель (спасена) и атакующего (ракету сбили)
    notifications.push(rk.targetId, 'rocket_intercepted', `🛡 Ракету, летевшую в вас, сбил ${user.name}!`, { by: user.name, attackerName: rk.attackerName });
    notifications.push(rk.attackerId, 'rocket_shot_down', `🔦 Вашу ракету по «${rk.targetName}» сбил лазер (${user.name}).`, { by: user.name, targetName: rk.targetName });
    notices.push(`🎯 Прямое попадание (${chancePct}%)! Ракета${rk.targetId === user.id ? ', летевшая в вас,' : ` по «${rk.targetName}»`} уничтожена. Лазер на охлаждении.`);
  } else {
    db.save('rockets');
    notices.push(`💨 Промах (шанс был ${chancePct}%). Ракета летит дальше — её ещё можно сбить другим лазером. Лазер на охлаждении.`);
  }
  db.save('users');
  return { hit, chancePct, laser: laserView(laser) };
}

export = { view, buyLaser, boost, fuelReady, fuelPower, intercept };
