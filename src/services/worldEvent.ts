// ===================================================================
// src/services/worldEvent.ts — мировое PvE-событие (босс).
// Админ запускает босса (имя, HP, пул золота, шанс/диапазон выпадения,
// награда за килл, награды топ-3). У босса НЕТ брони.
// Игроки бьют босса СКОЛЬКО УГОДНО раз (лимит — боеприпасы и здоровье,
// как в обычном бою). Урон = как в обычном бою (мин-макс + крит + трофей).
// За каждую атаку с шансом может выпасть золото из общего пула; пул
// истощается, остаток после смерти босса обнуляется.
// После смерти/остановки — показывается финальная статистика (урон +
// число атак по каждому) до запуска следующего события.
// Хранение: коллекция 'world_event'.
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import config = require('../../config/gameConfig');
import player = require('./player');
import type { User, Notices } from '../types';

const B = config.BATTLE;

function store(): any {
  return db.load('world_event', { active: false });
}
function users(): Record<string, User> { return player.users(); }

// Базовый урон по боссу — та же пороговая формула, что и в обычном бою,
// но у босса НЕТ защиты (def=0), поэтому атакующий всегда в доминировании.
function resolveDamage(atk: number, def: number): number {
  const ratio = def / Math.max(1, atk);
  let dealt;
  // Потолок обычного урона — 30 (как в обычном бою). Крит ×2 = 60, трофей до 180.
  if (ratio >= 1.5) dealt = u.rnd(1, 4);
  else if (ratio >= 1.2) dealt = u.rnd(4, 10);
  else if (ratio >= 0.9 && ratio <= 1.1) dealt = u.rnd(8, 18);
  else {
    const dominance = Math.min(1, (0.9 - ratio) / 0.9);
    dealt = Math.round(18 + dominance * 9 + Math.random() * 3);
  }
  return u.clamp(Math.round(dealt), 1, 30);
}

// Урон игрока по боссу с учётом крита и трофея (как в обычном бою)
function playerDamage(user: User): { dmg: number; crit: boolean } {
  const aPow = (player.totalPower(user, 'atk') || {}).power || 0;
  // У босса брони нет → def=0 → доминирование, базовый урон в верхней зоне
  const base = resolveDamage(aPow, 0);
  const critBase = Math.min(B.CRIT_MAX_CHANCE, B.CRIT_BASE + user.skills.cruelty * B.CRIT_PER_CRUELTY);
  const critChance = critBase + player.effMul(user, 'crit_bonus') - 1;
  const crit = Math.random() < critChance;
  let dmg = base;
  if (crit) {
    let critTrophyBonus = 0;
    try { critTrophyBonus = require('./trophies').critPower(user); } catch (e) {}
    dmg = Math.round(base * B.CRIT_MULT * (1 + critTrophyBonus));
  }
  return { dmg, crit };
}

// ── Текущее состояние события (для игроков) ──────────────────────
function view(user: User) {
  const e = store();
  activateIfDue(e);

  // Запланированное событие — таймер до старта
  if (!e.active && e.startsAt && e.startsAt > Date.now() && e.name && e.hp > 0) {
    return { active: false, scheduled: true, name: e.name,
      startsInSec: Math.max(0, Math.round((e.startsAt - Date.now()) / 1000)) };
  }

  // Нет активного события — показываем итоги прошлого (если есть)
  if (!e.active) {
    if (e.lastResult) return { active: false, scheduled: false, lastResult: e.lastResult };
    return { active: false, scheduled: false };
  }

  const myDamage = (e.contributors || {})[user.id] || 0;
  const myAttacks = (e.attacks || {})[user.id] || 0;
  return {
    active: true,
    name: e.name,
    hp: Math.max(0, e.hp),
    maxHp: e.maxHp,
    hpPct: Math.max(0, Math.round((e.hp / e.maxHp) * 100)),
    goldPoolLeft: e.goldPool,
    dropMin: e.dropMin, dropMax: e.dropMax, dropChance: e.dropChance,
    killReward: e.killReward,
    top3: [e.reward1, e.reward2, e.reward3],
    myDamage, myAttacks,
    contributorsCount: Object.keys(e.contributors || {}).length,
  };
}

// ── Игрок атакует босса (сколько угодно раз, лимит — как в бою) ───
function attack(user: User, notices: Notices) {
  const e = store();
  activateIfDue(e);
  if (!e.active) throw new u.ApiError('Сейчас нет активного события');

  // Ограничения как в обычном бою: кулдаун, боеприпасы, здоровье
  const nowMs = Date.now();
  const ATTACK_CD_MS = 1000;
  if ((user as any).lastAttackAt && nowMs - (user as any).lastAttackAt < ATTACK_CD_MS) {
    throw new u.ApiError('Слишком быстро! Между атаками нужна 1 секунда.');
  }
  player.refresh(user);
  if (user.res.am.cur < 1) throw new u.ApiError('Нет боеприпасов. Они восстанавливаются со временем.');
  if (user.res.hp.cur < config.PLAYER.MIN_HP_TO_FIGHT) {
    throw new u.ApiError(`Здоровье ниже ${config.PLAYER.MIN_HP_TO_FIGHT} — сначала подлечитесь.`);
  }

  // Тратим боеприпас и фиксируем кулдаун
  user.res.am.cur -= 1;
  (user as any).lastAttackAt = nowMs;

  // Урон по боссу (как в обычном бою, с критом/трофеем)
  const { dmg, crit } = playerDamage(user);
  e.hp = Math.max(0, e.hp - dmg);
  if (!e.contributors) e.contributors = {};
  if (!e.attacks) e.attacks = {};
  e.contributors[user.id] = (e.contributors[user.id] || 0) + dmg;
  e.attacks[user.id] = (e.attacks[user.id] || 0) + 1;
  // Сохраняем имя для итоговой статистики
  if (!e.names) e.names = {};
  e.names[user.id] = user.name;

  // Золото за атаку: с шансом dropChance выпадает [dropMin..dropMax] из пула
  let goldDrop = 0;
  const chance = e.dropChance != null ? e.dropChance : 2;
  if (e.goldPool > 0 && u.rnd(1, 100) <= chance) {
    goldDrop = u.rnd(e.dropMin != null ? e.dropMin : 5, e.dropMax != null ? e.dropMax : 10);
    goldDrop = Math.min(goldDrop, e.goldPool);  // не больше остатка пула
    if (goldDrop > 0) { player.addGold(user, goldDrop); e.goldPool -= goldDrop; }
  }

  let finished = false;
  let killReward = 0;
  if (e.hp <= 0) {
    finished = true;
    killReward = e.killReward || 0;
    // Награда за последний удар (килл) — этому игроку
    if (killReward > 0) player.addGold(user, killReward);
    finishEvent(e, user);
  }

  db.save('world_event');
  db.save('users');
  const dropMsg = goldDrop > 0 ? ` Выпало 🪙 ${goldDrop}!` : '';
  const killMsg = finished && killReward > 0 ? ` 🏆 Вы добили босса и получили 🪙 ${killReward}!` : '';
  notices.push(`💥 Урон боссу «${e.name}»: ${u.fmt(dmg)}${crit ? ' 🔥КРИТ' : ''}!${dropMsg}${finished ? ' Босс повержен!' : ''}${killMsg}`);
  return { ...view(user), dealtDamage: dmg, crit, goldDrop, finished, killReward };
}

// ── Завершение события: награды топ-3 + сохранение статистики ─────
function finishEvent(e: any, killer: User): void {
  const all = users();
  // Рейтинг участников по урону
  const ranking = Object.keys(e.contributors || {})
    .map((uid) => ({
      id: uid,
      name: (e.names && e.names[uid]) || (all[uid] ? all[uid].name : '???'),
      damage: e.contributors[uid] || 0,
      attacks: (e.attacks && e.attacks[uid]) || 0,
    }))
    .sort((a, b) => b.damage - a.damage);

  // Награды топ-3 (заданы админом)
  const rewards = [e.reward1 || 0, e.reward2 || 0, e.reward3 || 0];
  for (let i = 0; i < Math.min(3, ranking.length); i++) {
    const p = all[ranking[i].id];
    if (!p || rewards[i] <= 0) continue;
    player.addGold(p, rewards[i]);
    try {
      require('./notifications').push(p.id, 'world_event_top',
        `🏆 Событие «${e.name}» завершено! Вы заняли ${i + 1} место по урону. Награда: 🪙 ${rewards[i]}`, {});
    } catch (err) {}
  }
  // Уведомим убийцу отдельно (награда за килл уже начислена в attack)
  try {
    require('./notifications').push(killer.id, 'world_event_kill',
      `⚔️ Вы нанесли последний удар боссу «${e.name}»!`, {});
  } catch (err) {}

  db.save('users');

  // Сохраняем итог для показа до следующего события
  e.active = false;
  e.finishedAt = Date.now();
  e.goldPool = 0;  // остаток пула сгорает
  e.lastResult = {
    name: e.name,
    finishedAt: e.finishedAt,
    killerName: killer.name,
    ranking: ranking.slice(0, 20),  // топ-20 для таблицы
    rewards,
  };
}

// ── АДМИН: запустить событие ──────────────────────────────────────
function adminStart(adminUser: User, body: any, notices: Notices) {
  const e = store();
  if (e.active || (e.startsAt && e.startsAt > Date.now())) {
    throw new u.ApiError('Событие уже активно или запланировано. Сначала остановите текущее.');
  }
  const name = String(body.name || config.WORLD_EVENT.defaultName).slice(0, 60);
  const hp = Math.max(1, u.toInt(body.hp, 100000));
  // Пул золота — общая сумма, которую можно «выбить» атаками
  const goldPool = Math.max(0, u.toInt(body.goldPool, 100000));
  const dropMin = Math.max(0, u.toInt(body.dropMin, 5));
  const dropMax = Math.max(dropMin, u.toInt(body.dropMax, 10));
  const dropChance = Math.min(100, Math.max(0, u.toInt(body.dropChance, 2)));
  // Награда за килл (последний удар) + награды топ-3 по урону
  const killReward = Math.max(0, u.toInt(body.killReward, 0));
  const reward1 = Math.max(0, u.toInt(body.reward1, 0));
  const reward2 = Math.max(0, u.toInt(body.reward2, 0));
  const reward3 = Math.max(0, u.toInt(body.reward3, 0));
  const delayMin = Math.max(0, u.toInt(body.delayMin, 0));
  const now = Date.now();

  const ne: any = {
    active: delayMin === 0,
    startsAt: now + delayMin * 60 * 1000,
    name, hp, maxHp: hp,
    goldPool, dropMin, dropMax, dropChance,
    killReward, reward1, reward2, reward3,
    contributors: {}, attacks: {}, names: {},
    startedAt: now,
    lastResult: null,
  };
  const col = store();
  Object.keys(col).forEach((k) => delete col[k]);
  Object.assign(col, ne);
  db.save('world_event');
  if (delayMin > 0) {
    notices.push(`🐉 Событие «${name}» запланировано — старт через ${delayMin} мин.`);
  } else {
    notices.push(`🐉 Событие «${name}» запущено! HP ${u.fmt(hp)}, пул золота 🪙 ${u.fmt(goldPool)}.`);
  }
  return view(adminUser);
}

function activateIfDue(e: any): void {
  if (!e.active && e.startsAt && Date.now() >= e.startsAt && e.hp > 0 && e.name && !e.lastResult) {
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
  // Сохраняем частичную статистику при досрочной остановке
  if (e.active && e.contributors && Object.keys(e.contributors).length > 0) {
    const all = users();
    const ranking = Object.keys(e.contributors)
      .map((uid) => ({
        id: uid,
        name: (e.names && e.names[uid]) || (all[uid] ? all[uid].name : '???'),
        damage: e.contributors[uid] || 0,
        attacks: (e.attacks && e.attacks[uid]) || 0,
      }))
      .sort((a, b) => b.damage - a.damage);
    e.lastResult = { name: e.name, finishedAt: Date.now(), killerName: null, ranking: ranking.slice(0, 20), rewards: [0, 0, 0], stopped: true };
  }
  e.active = false;
  e.startsAt = 0;
  e.goldPool = 0;
  e.finishedAt = Date.now();
  db.save('world_event');
  notices.push('🛑 Событие остановлено. Награды топ-3 и за килл не выданы.');
  return { active: false };
}

export = { view, attack, adminStart, adminStop };
