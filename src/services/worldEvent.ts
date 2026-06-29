// ===================================================================
// src/services/worldEvent.ts — мировое PvE-событие (босс).
// Админ запускает событие, задавая имя, HP, защиту и награду.
// Все игроки совместно атакуют босса своей армией; урон копится.
// Когда HP падает до 0 — событие завершается, участники получают награду.
// Хранение: коллекция 'world_event' = { active, name, hp, maxHp, def,
//   rewardGold, rewardTokens, contributors: {uid: damage}, startedAt }
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import config = require('../../config/gameConfig');
import player = require('./player');
import type { User, Notices } from '../types';

function store(): any {
  return db.load('world_event', { active: false });
}
function users(): Record<string, User> { return player.users(); }

// ── Текущее состояние события (для игроков) ──────────────────────
function view(user: User) {
  const e = store();
  activateIfDue(e);
  // Запланированное, но ещё не начавшееся событие — показываем таймер
  if (!e.active && e.startsAt && e.startsAt > Date.now() && e.name && e.hp > 0) {
    return {
      active: false,
      scheduled: true,
      name: e.name,
      startsInSec: Math.max(0, Math.round((e.startsAt - Date.now()) / 1000)),
    };
  }
  if (!e.active) return { active: false, scheduled: false };
  const myDamage = (e.contributors || {})[user.id] || 0;
  const day = new Date().toISOString().slice(0, 10);
  const attackedToday = (e.lastAttack || {})[user.id] === day;
  return {
    active: true,
    name: e.name,
    hp: Math.max(0, e.hp),
    maxHp: e.maxHp,
    hpPct: Math.max(0, Math.round((e.hp / e.maxHp) * 100)),
    def: e.def,
    rewardGold: e.rewardGold,
    rewardTokens: e.rewardTokens,
    dropMin: e.dropMin, dropMax: e.dropMax, dropChance: e.dropChance,
    myDamage,
    contributorsCount: Object.keys(e.contributors || {}).length,
    canAttack: !attackedToday,   // одна атака в день на игрока
  };
}

// ── Игрок атакует босса ──────────────────────────────────────────
function attack(user: User, notices: Notices) {
  const e = store();
  activateIfDue(e);
  if (!e.active) throw new u.ApiError('Сейчас нет активного события');
  const day = new Date().toISOString().slice(0, 10);
  if (!e.lastAttack) e.lastAttack = {};
  if (e.lastAttack[user.id] === day) {
    throw new u.ApiError('Вы уже атаковали босса сегодня. Возвращайтесь завтра!');
  }
  // Урон = боевая мощь армии игрока минус защита босса (минимум 1)
  const atkPow = player.totalPower(user, 'atk');
  const myPower = (atkPow && atkPow.power) || 0;
  const dmg = Math.max(1, Math.round(myPower * (1 - Math.min(0.9, e.def / (e.def + myPower + 1)))));

  e.hp = Math.max(0, e.hp - dmg);
  if (!e.contributors) e.contributors = {};
  e.contributors[user.id] = (e.contributors[user.id] || 0) + dmg;
  e.lastAttack[user.id] = day;

  // Награда золотом за атаку: с шансом dropChance выпадает [dropMin..dropMax]
  let goldDrop = 0;
  const chance = (e.dropChance != null ? e.dropChance : 50);
  if (u.rnd(1, 100) <= chance) {
    goldDrop = u.rnd(e.dropMin != null ? e.dropMin : 5, e.dropMax != null ? e.dropMax : 15);
    if (goldDrop > 0) player.addGold(user, goldDrop);
  }

  let finished = false;
  if (e.hp <= 0) {
    finished = true;
    finishEvent(e, notices, user);
  }
  db.save('world_event');
  const dropMsg = goldDrop > 0 ? ` Выпало 🪙 ${goldDrop}!` : '';
  notices.push(`💥 Вы нанесли боссу «${e.name}» ${u.fmt(dmg)} урона!${dropMsg}${finished ? ' Босс повержен!' : ''}`);
  return { ...view(user), dealtDamage: dmg, goldDrop, finished };
}

// ── Завершение события: раздача наград всем участникам ────────────
function finishEvent(e: any, notices: Notices, _byUser: User): void {
  const all = users();
  const contributors = Object.keys(e.contributors || {});
  for (const uid of contributors) {
    const p = all[uid];
    if (!p) continue;
    player.addGold(p, e.rewardGold);
    if (e.rewardTokens) p.tokens = (p.tokens || 0) + e.rewardTokens;
    try {
      require('./notifications').push(uid, 'world_event_win',
        `🏆 Босс «${e.name}» повержен! Награда: 🪙 ${e.rewardGold}${e.rewardTokens ? `, 🎖 ${e.rewardTokens}` : ''}`, {});
    } catch (err) {}
  }
  db.save('users');
  e.active = false;
  e.finishedAt = Date.now();
}

// ── АДМИН: запустить событие ──────────────────────────────────────
function adminStart(adminUser: User, body: any, notices: Notices) {
  const e = store();
  if (e.active || (e.startsAt && e.startsAt > Date.now())) {
    throw new u.ApiError('Событие уже активно или запланировано. Сначала остановите текущее.');
  }
  const name = String(body.name || config.WORLD_EVENT.defaultName).slice(0, 60);
  const hp = Math.max(1, u.toInt(body.hp, 100000));
  const def = Math.max(0, u.toInt(body.def, 1000));
  const rewardGold = Math.max(0, u.toInt(body.rewardGold, 50));
  const rewardTokens = Math.max(0, u.toInt(body.rewardTokens, 0));
  // Награда золотом за КАЖДУЮ атаку: падает с шансом dropChance в диапазоне [dropMin, dropMax]
  const dropMin = Math.max(0, u.toInt(body.dropMin, 5));
  const dropMax = Math.max(dropMin, u.toInt(body.dropMax, 15));
  const dropChance = Math.min(100, Math.max(0, u.toInt(body.dropChance, 50))); // 0..100%
  // Отложенный старт: задержка в минутах (0 = сразу)
  const delayMin = Math.max(0, u.toInt(body.delayMin, 0));
  const now = Date.now();
  const startsAt = now + delayMin * 60 * 1000;

  const ne = {
    active: delayMin === 0,        // если задержки нет — активно сразу
    startsAt,                       // когда событие стартует
    name, hp, maxHp: hp, def,
    rewardGold, rewardTokens,
    dropMin, dropMax, dropChance,
    contributors: {}, lastAttack: {},
    startedAt: now,
  };
  const col = store();
  Object.keys(col).forEach((k) => delete col[k]);
  Object.assign(col, ne);
  db.save('world_event');
  if (delayMin > 0) {
    notices.push(`🐉 Событие «${name}» запланировано — старт через ${delayMin} мин. Игроки видят таймер во вкладке «Война».`);
  } else {
    notices.push(`🐉 Событие «${name}» запущено! HP ${u.fmt(hp)}, защита ${def}.`);
  }
  return view(adminUser);
}

// Активирует отложенное событие, если время пришло
function activateIfDue(e: any): void {
  if (!e.active && e.startsAt && Date.now() >= e.startsAt && e.hp > 0 && e.name) {
    e.active = true;
    db.save('world_event');
  }
}

// ── АДМИН: принудительно остановить событие ──────────────────────
function adminStop(adminUser: User, notices: Notices) {
  const e = store();
  if (!e.active && !(e.startsAt && e.startsAt > Date.now())) {
    throw new u.ApiError('Нет активного или запланированного события');
  }
  e.active = false;
  e.startsAt = 0;
  e.finishedAt = Date.now();
  db.save('world_event');
  notices.push('🛑 Событие остановлено/отменено без награды.');
  return { active: false };
}

export = { view, attack, adminStart, adminStop };
