// ===================================================================
// src/services/legionBattle.ts — Бой легионов
//
// Жизненный цикл:
//   challenge (10 мин) → prep (10 мин, готовность + роль + направление)
//   → active (1 час, живой бой) → done
//
// Победа:
//   • Досрочно — если все противники на всех направлениях выбыли
//   • По истечению 1 часа — по очкам активности (activity score)
//
// Уровни легиона:
//   За победу: +1..2 очка славы (gloryEarned — только накопительно)
//   За поражение: −1..2 очков славы (gloryPoints может уйти в минус)
//   Уровень растёт только от gloryEarned.
//   Пороги: 50 / 100 / 170 / 250 / 500 / 1000
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import trophies = require('./trophies');
import notif = require('./notifications');
import type { User, Notices, Battle, Combatant } from '../types';

// ───────────────────────────────────────────────────────────────────
// Константы
// ───────────────────────────────────────────────────────────────────
const DIRECTIONS = 5;
const DIR_NAMES  = ['Гъадакьи', 'Улабахе', 'Бекъдахе', 'Асали', 'Кӏаречӏ'];
const MAX_PER_DIR = 5;
const PREP_MS     = 10 * 60 * 1000;   // 10 мин подготовки
const BATTLE_MS   = 60 * 60 * 1000;   // 1 час бой
const MOVE_CD_MS  = 30 * 1000;        // кулдаун смены направления
const ACTION_CD_BASE_SEC = 3.5;       // база паузы между действиями (сек)
const ITEM_CD_MS  = 10 * 1000;        // кулдаун предмета
const DONE_GRACE_MS = 10 * 60 * 1000; // сколько после боя ещё отдаём его итоги клиенту
const GUARD_SEC   = 15;               // прикрытие 15 сек

// Очки активности за действия
const ACTIVITY: Record<string, number> = {
  attack_hit:    3,   // нанёс урон
  kill:         10,   // убил противника
  heal_done:     2,   // вылечил союзника
  guard_done:    2,   // прикрыл союзника
  item_used:     1,   // применил предмет
  damage_taken: -1,   // получил урон (штраф)
};

// Уровни легиона: порог gloryEarned для каждого уровня
const GLORY_THRESHOLDS = [0, 50, 100, 170, 250, 500, 1000];

// Роли
const ROLES: Record<string, any> = {
  assault:  { label: 'Штурмовик',  atkMul: 1.20, defMul: 1.00, dmgReduce: 0.00 },
  guardian: { label: 'Защитник',   atkMul: 0.80, defMul: 1.20, dmgReduce: 0.20 },
  medic:    { label: 'Медик',      atkMul: 0.70, defMul: 0.70, dmgReduce: 0.00 },
};

// ───────────────────────────────────────────────────────────────────
// Хелперы
// ───────────────────────────────────────────────────────────────────
function legions(): Record<string, any> { return db.load('legions', {}); }
function battles(): Record<string, Battle> { return db.load('battles', {}); }
function allUsers(): Record<string, User> { return player.users(); }
function now(): number { return Date.now(); }

// Получить единый объект боя по ссылке из легиона игрока.
// Возвращает { battle, legion } или { battle: null }.
function resolveBattle(user: User): { battle: Battle | null; legion: any } {
  const l = legions()[user.legionId as string];
  if (!l || !l.activeBattle || !l.activeBattle.battleId) return { battle: null, legion: l };
  const battle = battles()[l.activeBattle.battleId];
  return { battle: battle || null, legion: l };
}

// Сохранить единый бой в коллекцию battles.
function saveBattle(battle: Battle | null): void {
  if (!battle) return;
  const all = battles();
  all[battle.id] = battle;
  db.save('battles');
}

function ensureLegionGlory(l: any): void {
  if (l.gloryPoints  === undefined) l.gloryPoints  = 0;  // текущий баланс (может уменьшаться)
  if (l.gloryEarned  === undefined) l.gloryEarned  = 0;  // только накопленные (для уровня)
  if (l.legionLevel  === undefined) l.legionLevel  = 1;
}

function calcLegionLevel(gloryEarned: number): number {
  let lvl = 1;
  for (let i = 1; i < GLORY_THRESHOLDS.length; i++) {
    if (gloryEarned >= GLORY_THRESHOLDS[i]) lvl = i + 1;
    else break;
  }
  return Math.min(lvl, GLORY_THRESHOLDS.length);
}

function addGlory(l: any, delta: number): any {
  ensureLegionGlory(l);
  l.gloryPoints = Math.max(0, (l.gloryPoints || 0) + delta);
  if (delta > 0) {
    l.gloryEarned = (l.gloryEarned || 0) + delta;
    const newLevel = calcLegionLevel(l.gloryEarned);
    if (newLevel > (l.legionLevel || 1)) {
      l.legionLevel = newLevel;
      return { levelUp: true, newLevel };
    }
  }
  return { levelUp: false };
}

function findCombatant(battle: Battle, userId: string): Combatant | undefined {
  return battle.combatants[userId] || null;
}

function log(battle: Battle, text: string, kind: string): void {
  battle.log = battle.log || [];
  battle.log.push({ t: now(), text, kind: kind || 'info' });
  if (battle.log.length > 300) battle.log = battle.log.slice(-300);
}

function addActivity(battle: Battle, userId: string, type: string, amount?: number): void {
  battle.activity = battle.activity || {};
  battle.activity[userId] = (battle.activity[userId] || 0) + (amount || ACTIVITY[type] || 0);
}

// ───────────────────────────────────────────────────────────────────
// Урон: щит, иммунитет, отражение, прикрытие
// ───────────────────────────────────────────────────────────────────

// ── Бонусы БОЕВЫХ построек легиона ────────────────────────────────
// Раньше эти постройки не влияли на бой вообще: warcmd/fortress читались
// только в мёртвом коде автобоя, а speedlab/medcorps/intel/supply не
// читались нигде. Теперь всё подключено здесь.
function bbLevel(legionId: string | null | undefined, id: string): number {
  if (!legionId) return 0;
  const l = legions()[legionId];
  if (!l || !l.battleBuildings) return 0;
  return l.battleBuildings[id] || 0;
}

// Множитель атаки/защиты от построек: +5% за уровень
function bbPowerMul(legionId: string | null | undefined, kind: 'atk' | 'def'): number {
  const id = kind === 'atk' ? 'warcmd' : 'fortress';
  const def = config.LEGION_BATTLE_BUILDING_BY_ID[id];
  return 1 + bbLevel(legionId, id) * ((def && def.perLvl) || 5) / 100;
}

// Пауза между действиями: база 3.5 сек, «Лаборатория быстродействия»
// снимает по 0.5 сек за уровень → 1 сек на 5-м уровне.
function actionCdMs(legionId: string | null | undefined): number {
  const def = config.LEGION_BATTLE_BUILDING_BY_ID['speedlab'];
  const perLvl = (def && def.perLvl) || 0.5;
  const lvl = bbLevel(legionId, 'speedlab');
  const sec = Math.max(1, ACTION_CD_BASE_SEC - lvl * perLvl);
  return Math.round(sec * 1000);
}

function applyDamage(battle: Battle, targetId: string, rawDmg: number, sourceId: string): any {
  const c = battle.combatants[targetId];
  if (!c || c.hp <= 0) return { actual: 0, shieldAbsorbed: 0, hitId: targetId };

  // Прикрытие защитником: урон уходит на него. Возвращаем guardedBy, чтобы
  // вызывающий код honestly написал в лог, КТО принял удар на себя, и начислил
  // статистику получения урона правильному бойцу.
  const guardianId = (battle.guardLinks || {})[targetId];
  if (guardianId) {
    const g = battle.combatants[guardianId];
    if (g && g.hp > 0 && now() < ((battle.guardExpiry || {})[guardianId] || 0)) {
      const res = applyDamage(battle, guardianId, rawDmg, sourceId);
      // Отдельно копим урон, принятый ИМЕННО за прикрытие союзника —
      // по нему считается «лучший защитник» боя.
      g.stats = g.stats || ({} as any);
      g.stats.guardedDmg = (g.stats.guardedDmg || 0) + (res.actual || 0);
      return { ...res, guardedBy: g.name, guardedFor: c.name };
    } else {
      delete (battle.guardLinks || {})[targetId];
    }
  }

  // Иммунитет (купол)
  const immune = (c.statusEffects || []).find(e => e.type === 'immunity' && e.expiresAt > now());
  if (immune) {
    log(battle, `🔵 ${c.name} под куполом — урон поглощён`, 'info');
    return { actual: 0, shieldAbsorbed: 0, immune: true, hitId: targetId };
  }

  // Отражающий щит
  const refIdx = (c.statusEffects || []).findIndex(e => e.type === 'reflect' && e.expiresAt > now());
  if (refIdx !== -1) {
    c.statusEffects.splice(refIdx, 1);
    const enemies = Object.values(battle.combatants).filter(x =>
      x.side !== c.side && x.alive && x.direction === c.direction);
    if (enemies.length > 0) {
      const victim = enemies[Math.floor(Math.random() * enemies.length)];
      log(battle, `🪞 ${c.name} отразил удар → ${victim.name}`, 'info');
      const res = applyDamage(battle, victim.userId, rawDmg, sourceId);
      return { ...res, reflectedBy: c.name };
    }
    return { actual: 0, shieldAbsorbed: 0, hitId: targetId };
  }

  // Защитник (guardian) больше НЕ имеет щита — только HP (+ пассивное
  // снижение урона роли). Весь урон идёт напрямую в HP.
  const dmg = rawDmg;
  const shieldAbsorbed = 0;

  const actual = Math.min(dmg, c.hp);
  c.hp = Math.max(0, c.hp - dmg);

  // Очки активности — штраф за получение урона
  if (actual > 0) addActivity(battle, targetId, 'damage_taken');

  return { actual, shieldAbsorbed, hitId: targetId };
}

// ───────────────────────────────────────────────────────────────────
// Расчёт урона между двумя бойцами
// ───────────────────────────────────────────────────────────────────
function calcDamage(attacker: Combatant, defender: Combatant, aUser: User, dUser: User, opts?: { allowDodge?: boolean }): any {
  // Бонусы боевых построек легиона идут в МОЩЬ: «Штаб наступления» — в атаку,
  // «Бастион» — в защиту (+5% за уровень). Мощь затем проходит через пороговую
  // формулу урона, поэтому прирост урона не линеен множителю.
  const aAtk = player.totalPower(aUser, 'atk').power * attacker.roleMul.atk
    * bbPowerMul(aUser.legionId, 'atk');
  const dDef = player.totalPower(dUser, 'def').power * defender.roleMul.def
    * bbPowerMul(dUser.legionId, 'def');

  // УВОРОТ защищающегося — как в обычном бою: 0.5% за ловкость, потолок 50%,
  // допинг «Призрак» добавляет сверх лимита (итого максимум 70%).
  // Уворот обнуляет урон целиком.
  const allowDodge = !opts || opts.allowDodge !== false;
  if (allowDodge) {
    const dodgeChance = Math.min(config.BATTLE.DODGE_MAX, dUser.skills.agility * config.BATTLE.DODGE_PER_AGILITY)
      + (player.effMul(dUser, 'dodge_bonus') - 1);
    if (Math.random() < dodgeChance) return { dmg: 0, crit: false, dodged: true };
  }

  const ratio = dDef / Math.max(1, aAtk);
  let dmg;
  if (ratio >= 1.5)                       dmg = u.rnd(5, 12);   // min 5-12 для слишком сильного
  else if (ratio >= 1.2)                  dmg = u.rnd(10, 20);
  else if (ratio >= 0.9 && ratio <= 1.1)  dmg = u.rnd(20, 40);
  else {
    const dom = Math.min(1, (0.9 - ratio) / 0.9);
    dmg = Math.round(25 + dom * 20 + Math.random() * 5);
  }
  dmg = u.clamp(dmg, 5, 45); // минимум 5 всегда

  // Бонус урановых боеприпасов
  const boost = (attacker.statusEffects || []).find(e => e.type === 'dmg_boost' && e.expiresAt > now());
  if (boost) dmg = Math.round(dmg * (1 + (boost as any).bonus / 100));

  // Крит (допинг «Ястреб» добавляет сверх лимита 50%)
  const critChance = Math.min(0.50, 0.05 + aUser.skills.cruelty * 0.005) + (player.effMul(aUser, 'crit_bonus') - 1);
  const crit = Math.random() < critChance;
  if (crit) {
    // Как в обычном бою: база ×2, плюс трофей «Лицензия на убийство»
    // (на максимуме +200% → итог ×6 от базового урона). Раньше трофей
    // здесь не учитывался вовсе — крит упирался в 45×2 = 90.
    const critTrophyBonus = trophies.critPower(aUser);   // 0..2.0
    dmg = Math.round(dmg * config.BATTLE.CRIT_MULT * (1 + critTrophyBonus));
  }
  dmg = u.clamp(dmg, 1, 200);

  // Снижение урона для защитника
  dmg = Math.round(dmg * (1 - defender.roleMul.dmgReduce));

  return { dmg, crit, dodged: false };
}

// ───────────────────────────────────────────────────────────────────
// Регистрация игрока + выбор роли (фаза prep)
// ───────────────────────────────────────────────────────────────────
function joinBattle(user: User, roleId: string, notices: Notices) {
  player.refresh(user);
  const { battle, legion: l } = resolveBattle(user);
  if (!battle) throw new u.ApiError('Нет активного боя легиона');

  if (battle.phase !== 'prep') throw new u.ApiError('Фаза подготовки завершена');
  if (now() > battle.prepEndsAt) throw new u.ApiError('Время подготовки истекло');
  if (!ROLES[roleId]) throw new u.ApiError('Неизвестная роль');

  const role = ROLES[roleId];
  const side = l.id === battle.legionA ? 'A' : 'B';
  const mx   = player.maxima(user);

  // Если уже в бою — позволяем сменить роль (пока не нажал «Готов»)
  const existing = battle.combatants[user.id];
  if (existing && existing.ready) {
    throw new u.ApiError('Вы уже отметились «Готов». Сначала нажмите «Не готов», чтобы сменить роль.');
  }

  battle.combatants[user.id] = {
    userId: user.id,
    name: user.name,
    side,
    role: roleId as any,
    roleMul: { atk: role.atkMul, def: role.defMul, dmgReduce: role.dmgReduce },
    hp: Math.floor(user.res.hp.cur),
    maxHp: mx.hp,
    direction: null,
    ready: false,          // НЕ готов по умолчанию — нужно нажать «Готов»
    readyAt: 0,
    lastActionAt: 0,
    lastMoveAt: 0,
    lastItemAt: 0,
    gear: ((battle.gear || {})[user.id]) || [],
    statusEffects: [],
    alive: true,
    stats: { dmgDealt: 0, dmgTaken: 0, healed: 0, kills: 0, guards: 0, guardedDmg: 0, itemsUsed: 0 },
  };

  log(battle, `${user.name} выбрал роль «${role.label}»`, 'prep');
  saveBattle(battle);
  notices.push(`Роль выбрана: ${role.label}. Нажмите «Готов» и выберите направление.`);
  return { ok: true, role: roleId };
}

// ───────────────────────────────────────────────────────────────────
// Переключение готовности «Готов» / «Не готов»
// ───────────────────────────────────────────────────────────────────
function setReady(user: User, ready: boolean, notices: Notices) {
  player.refresh(user);
  const { battle } = resolveBattle(user);
  if (!battle) throw new u.ApiError('Нет активного боя');
  if (battle.phase !== 'prep') throw new u.ApiError('Фаза подготовки завершена');
  if (now() > battle.prepEndsAt) throw new u.ApiError('Время подготовки истекло');

  const c = battle.combatants[user.id];
  if (!c) throw new u.ApiError('Сначала выберите роль');

  c.ready = !!ready;
  c.readyAt = ready ? now() : 0;
  log(battle, `${user.name} ${ready ? 'готов ✅' : 'не готов'}`, 'prep');
  saveBattle(battle);
  notices.push(ready ? '✅ Вы готовы к бою!' : 'Вы отметились «Не готов».');
  return { ready: c.ready };
}

// ───────────────────────────────────────────────────────────────────
// Выбор / смена направления
// ───────────────────────────────────────────────────────────────────
function chooseDirection(user: User, dir: number | string, notices: Notices) {
  const { battle } = resolveBattle(user);
  if (!battle) throw new u.ApiError('Нет активного боя');
  if (battle.phase !== 'active' && battle.phase !== 'prep') throw new u.ApiError('Нельзя выбрать направление сейчас');

  const c = findCombatant(battle, user.id);
  if (!c) throw new u.ApiError('Вы не зарегистрированы в бою');

  // В фазе подготовки направление можно выбрать только если нажат «Готов»
  if (battle.phase === 'prep' && !c.ready) {
    throw new u.ApiError('Сначала нажмите «Готов», затем выбирайте направление');
  }

  const d = u.toInt(dir, 0);
  if (d < 1 || d > DIRECTIONS) throw new u.ApiError(`Направление 1–${DIRECTIONS}`);

  // Кулдаун смены (только в активной фазе)
  if (battle.phase === 'active' && c.direction !== null && c.direction !== d) {
    const cdLeft = Math.ceil((c.lastMoveAt + MOVE_CD_MS - now()) / 1000);
    if (cdLeft > 0) throw new u.ApiError(`Смена направления: ещё ${cdLeft} сек`);
  }

  // Лимит мест
  if (c.direction !== d) {
    const count = Object.values(battle.combatants)
      .filter(x => x.side === c.side && x.direction === d && x.alive).length;
    if (count >= MAX_PER_DIR) throw new u.ApiError(`${DIR_NAMES[d-1]} заполнено (макс. ${MAX_PER_DIR})`);
  }

  const wasDir = c.direction;
  c.direction = d;
  if (battle.phase === 'active' && wasDir !== null && wasDir !== d) {
    c.lastMoveAt = now();
    log(battle, `${user.name}: ${DIR_NAMES[wasDir-1]} → ${DIR_NAMES[d-1]}`, 'move');
  } else {
    log(battle, `${user.name} занял «${DIR_NAMES[d-1]}»`, 'move');
  }
  saveBattle(battle);
  notices.push(`📍 Вы на «${DIR_NAMES[d-1]}».`);
  return { direction: d, dirName: DIR_NAMES[d-1] };
}

// ───────────────────────────────────────────────────────────────────
// Атака (все роли могут атаковать, но с разными мультипликаторами)
// ───────────────────────────────────────────────────────────────────
function attack(user: User, targetUserId: string, notices: Notices) {
  player.refresh(user);
  const { battle } = resolveBattle(user);
  if (!battle) throw new u.ApiError('Нет активного боя');
  if (battle.phase !== 'active') throw new u.ApiError('Бой ещё не начался');

  const c = findCombatant(battle, user.id);
  if (!c || !c.alive || c.hp <= 0) throw new u.ApiError('Вы выбыли из боя');
  if (c.direction === null) throw new u.ApiError('Сначала выберите направление');

  const cdLeft = Math.ceil((c.lastActionAt + actionCdMs(user.legionId) - now()) / 1000);
  if (cdLeft > 0) throw new u.ApiError(`Подождите ещё ${cdLeft} сек`);

  const stunned = (c.statusEffects || []).find(e => e.type === 'stun' && e.expiresAt > now());
  if (stunned) throw new u.ApiError(`Оглушены ещё ${Math.ceil((stunned.expiresAt - now()) / 1000)} сек`);

  // Расход боеприпасов: 1 удар = 1 боеприпас (привязка к текущим ресурсам)
  if (Math.floor(user.res.am.cur) < 1) {
    throw new u.ApiError('Нет боеприпасов! Пополните запас вне боя.');
  }

  const tc = findCombatant(battle, targetUserId);
  if (!tc || !tc.alive || tc.hp <= 0) throw new u.ApiError('Цель уже выбыла');
  if (tc.side === c.side) throw new u.ApiError('Нельзя атаковать союзника');
  if (tc.direction !== c.direction) throw new u.ApiError('Цель на другом направлении');

  const users = allUsers();
  const targetUser = users[targetUserId];
  if (!targetUser) throw new u.ApiError('Игрок не найден');

  const { dmg, crit, dodged } = calcDamage(c, tc, user, targetUser);
  const res = applyDamage(battle, targetUserId, dmg, user.id);
  const { actual, guardedBy } = res;
  // Урон мог уйти не в цель: её прикрыл защитник или сработало отражение.
  // Статистику и гибель считаем по тому, кто РЕАЛЬНО получил удар.
  const hit = battle.combatants[res.hitId] || tc;

  // Списываем 1 боеприпас
  user.res.am.cur = Math.max(0, user.res.am.cur - 1);

  c.lastActionAt = now();
  c.stats.dmgDealt += actual;
  hit.stats.dmgTaken += actual;

  addActivity(battle, user.id, 'attack_hit');

  let msg = dodged
    ? `⚔️ ${user.name} → ${tc.name} [${DIR_NAMES[(c.direction || 1)-1]}]: 🌀 ПРОМАХ — ${tc.name} увернулся!`
    : `⚔️ ${user.name} → ${tc.name} [${DIR_NAMES[(c.direction || 1)-1]}]: ${actual} урона`;
  if (crit) msg += ' 💥 КРИТ!';
  // Честно показываем перенаправление урона на защитника
  if (!dodged && guardedBy) msg += ` 🛡️ ${guardedBy} прикрыл ${res.guardedFor} — урон принял на себя!`;

  if (hit.hp <= 0 && hit.alive) {
    hit.alive = false;
    c.stats.kills++;
    addActivity(battle, user.id, 'kill');
    msg += ` 💀 ${hit.name} ВЫБЫЛ!`;
    const deadUser = users[hit.userId];
    if (deadUser) deadUser.res.hp.cur = 1;
  }

  log(battle, msg, crit ? 'crit' : 'attack');
  checkBattleEnd(battle, legions(), users);
  saveBattle(battle);

  notices.push(msg);
  return { dmg: actual, crit, targetHp: tc.hp, targetAlive: tc.alive, ammoLeft: Math.floor(user.res.am.cur) };
}

// ───────────────────────────────────────────────────────────────────
// Лечение (только медик)
// ───────────────────────────────────────────────────────────────────
function heal(user: User, targetUserId: string, notices: Notices) {
  player.refresh(user);
  const { battle } = resolveBattle(user);
  if (!battle) throw new u.ApiError('Нет активного боя');
  if (battle.phase !== 'active') throw new u.ApiError('Бой ещё не начался');

  const c = findCombatant(battle, user.id);
  if (!c || !c.alive) throw new u.ApiError('Вы выбыли');
  if (c.role !== 'medic') throw new u.ApiError('Только медики могут лечить');
  if (c.direction === null) throw new u.ApiError('Сначала выберите направление');

  const cdLeft = Math.ceil((c.lastActionAt + actionCdMs(user.legionId) - now()) / 1000);
  if (cdLeft > 0) throw new u.ApiError(`Подождите ещё ${cdLeft} сек`);

  const stunned = (c.statusEffects || []).find(e => e.type === 'stun' && e.expiresAt > now());
  if (stunned) throw new u.ApiError(`Оглушены ещё ${Math.ceil((stunned.expiresAt - now()) / 1000)} сек`);

  const enCost = u.rnd(20, 30);
  if (user.res.en.cur < enCost) throw new u.ApiError(`Нужно энергии: ${enCost}, есть ${Math.floor(user.res.en.cur)}`);

  const tc = findCombatant(battle, targetUserId);
  if (!tc || !tc.alive) throw new u.ApiError('Цель выбыла');
  if (tc.side !== c.side) throw new u.ApiError('Нельзя лечить врага');
  if (tc.direction !== c.direction) throw new u.ApiError('Цель на другом направлении');

  const blocked = (tc.statusEffects || []).find(e => e.type === 'no_heal' && e.expiresAt > now());
  if (blocked) throw new u.ApiError(`Лечение цели заблокировано (${Math.ceil((blocked.expiresAt - now()) / 1000)} сек)`);

  // Шанс крит-лечения даёт СВОЙ трофей «Орден «Красный крест»» (база 5%,
  // максимум 50%). Раньше он ошибочно зависел от ловкости — стата уворота.
  const critHeal = Math.random() < trophies.critHealChance(user);
  const healAmt = critHeal ? u.rnd(100, 330) : u.rnd(20, 40);

  const before = tc.hp;
  tc.hp = Math.min(tc.maxHp, tc.hp + healAmt);
  const actual = tc.hp - before;

  user.res.en.cur = Math.max(0, user.res.en.cur - enCost);
  c.lastActionAt = now();
  c.stats.healed += actual;

  addActivity(battle, user.id, 'heal_done');

  const targetUser = allUsers()[targetUserId];
  if (targetUser) {
    targetUser.res.hp.cur = Math.min(player.maxima(targetUser).hp, targetUser.res.hp.cur + actual);
  }

  const msg = `💊 ${user.name} → ${tc.name}: +${actual} HP${critHeal ? ' ✨ КРИТ!' : ''}`;
  log(battle, msg, critHeal ? 'crit' : 'heal');
  saveBattle(battle);

  notices.push(msg);
  return { healed: actual, critHeal, targetHp: tc.hp, enLeft: Math.floor(user.res.en.cur) };
}

// ───────────────────────────────────────────────────────────────────
// Прикрытие (только защитник)
// ───────────────────────────────────────────────────────────────────
function guard(user: User, targetUserId: string, notices: Notices) {
  player.refresh(user);
  const { battle } = resolveBattle(user);
  if (!battle) throw new u.ApiError('Нет активного боя');
  if (battle.phase !== 'active') throw new u.ApiError('Бой ещё не начался');

  const c = findCombatant(battle, user.id);
  if (!c || !c.alive) throw new u.ApiError('Вы выбыли');
  if (c.role !== 'guardian') throw new u.ApiError('Только защитники могут прикрывать');
  if (targetUserId === user.id) throw new u.ApiError('Нельзя прикрывать себя');

  const cdLeft = Math.ceil((c.lastActionAt + actionCdMs(user.legionId) - now()) / 1000);
  if (cdLeft > 0) throw new u.ApiError(`Подождите ещё ${cdLeft} сек`);

  const tc = findCombatant(battle, targetUserId);
  if (!tc || !tc.alive) throw new u.ApiError('Цель выбыла');
  if (tc.side !== c.side) throw new u.ApiError('Нельзя прикрывать врага');
  if (tc.direction !== c.direction) throw new u.ApiError('Цель на другом направлении');

  battle.guardLinks  = battle.guardLinks  || {};
  battle.guardExpiry = battle.guardExpiry || {};

  // Снимаем старое прикрытие этого защитника
  for (const [k, v] of Object.entries(battle.guardLinks)) {
    if (v === user.id) delete battle.guardLinks[k];
  }
  battle.guardLinks[targetUserId]   = user.id;
  battle.guardExpiry[user.id] = now() + GUARD_SEC * 1000;
  c.lastActionAt = now();
  c.stats.guards++;

  addActivity(battle, user.id, 'guard_done');

  const msg = `🛡️ ${user.name} прикрывает ${tc.name} на ${GUARD_SEC} сек`;
  log(battle, msg, 'guard');
  saveBattle(battle);

  notices.push(msg);
  return { guardedUntil: battle.guardExpiry[user.id] };
}

// ───────────────────────────────────────────────────────────────────
// Применение предмета
// ───────────────────────────────────────────────────────────────────
function useItem(user: User, itemId: string, targetUserId: string, notices: Notices) {
  player.refresh(user);
  const { battle } = resolveBattle(user);
  if (!battle) throw new u.ApiError('Нет активного боя');
  if (battle.phase !== 'active') throw new u.ApiError('Бой ещё не начался');

  const c = findCombatant(battle, user.id);
  if (!c || !c.alive) throw new u.ApiError('Вы выбыли');

  const itemCdLeft = Math.ceil(((c.lastItemAt || 0) + ITEM_CD_MS - now()) / 1000);
  if (itemCdLeft > 0) throw new u.ApiError(`Предмет: подождите ещё ${itemCdLeft} сек`);

  const gearIdx = c.gear.indexOf(itemId);
  if (gearIdx === -1) throw new u.ApiError('Этого предмета нет в поясе');

  const item = config.LEGION_SHOP_ITEM_BY_ID[itemId];
  if (!item) throw new u.ApiError('Неизвестный предмет');

  const tc = targetUserId ? findCombatant(battle, targetUserId) : null;
  let resultMsg = '';

  const ieff: any = item.effect;
  switch (ieff.type) {
    case 'no_heal':
      if (!tc) throw new u.ApiError('Укажите цель');
      if (tc.side === c.side) throw new u.ApiError('Только на врагов');
      tc.statusEffects = tc.statusEffects || [];
      tc.statusEffects.push({ type: 'no_heal', expiresAt: now() + ieff.duration * 1000 });
      resultMsg = `💨 ${user.name}: Газовая шашка → ${tc.name}! Лечение заблокировано ${ieff.duration} сек`;
      break;

    case 'stun':
      if (!tc) throw new u.ApiError('Укажите цель');
      if (tc.side === c.side) throw new u.ApiError('Только на врагов');
      tc.statusEffects = tc.statusEffects || [];
      tc.statusEffects.push({ type: 'stun', expiresAt: now() + ieff.duration * 1000 });
      resultMsg = `💥 ${user.name}: Светошумовая → ${tc.name}! Оглушён ${ieff.duration} сек`;
      break;

    case 'damage_pct': {
      if (!tc) throw new u.ApiError('Укажите цель');
      if (tc.side === c.side) throw new u.ApiError('Только на врагов');
      const tUser = allUsers()[targetUserId];
      // Урон гранаты считается от ОБЫЧНОГО урона игрока по этой цели —
      // то есть уже с учётом брони (защиты) противника, — и умножается
      // на множитель предмета. Если у цели сильная броня и обычный удар
      // слабый, граната тоже будет слабее. crit при этом не применяем
      // (это разовый предмет, а не серия атак).
      const base = calcDamage(c, tc, user, tUser, { allowDodge: false });
      const mult = ieff.pct / 100;            // pct=1000 → ×10
      const dmg = Math.round(base.dmg * mult);
      const gres = applyDamage(battle, targetUserId, dmg, user.id);
      const actual = gres.actual;
      const ghit = battle.combatants[gres.hitId] || tc;
      c.stats.dmgDealt += actual;
      ghit.stats.dmgTaken += actual;
      resultMsg = `🔴 ${user.name}: Граната → ${tc.name}: ${actual} урона!`;
      if (gres.guardedBy) resultMsg += ` 🛡️ ${gres.guardedBy} прикрыл ${gres.guardedFor} — урон принял на себя!`;
      if (ghit.hp <= 0 && ghit.alive) {
        ghit.alive = false; c.stats.kills++; addActivity(battle, user.id, 'kill');
        resultMsg += ` 💀 ${ghit.name} ВЫБЫЛ!`;
      }
      break;
    }

    case 'dot_aoe': {
      if (c.direction === null) throw new u.ApiError('Выберите направление');
      const enemies = Object.values(battle.combatants).filter(x =>
        x.side !== c.side && x.direction === c.direction && x.alive);
      for (const en of enemies) {
        en.statusEffects = en.statusEffects || [];
        en.statusEffects.push({
          type: 'dot', tickPct: ieff.tickPct,
          tickInterval: ieff.tickInterval * 1000,
          expiresAt: now() + ieff.duration * 1000,
          nextTickAt: now() + ieff.tickInterval * 1000,
          sourceId: user.id,
        });
      }
      resultMsg = `🔥 ${user.name}: Напалм! ${enemies.length} врагов горят`;
      break;
    }

    case 'dmg_boost':
      c.statusEffects = c.statusEffects || [];
      c.statusEffects.push({ type: 'dmg_boost', bonus: ieff.bonus, expiresAt: now() + ieff.duration * 1000 });
      resultMsg = `☢️ ${user.name}: Урановые боеприпасы! +${ieff.bonus}% урона ${ieff.duration} сек`;
      break;

    case 'aoe_true_dmg': {
      if (c.direction === null) throw new u.ApiError('Выберите направление');
      const enemies = Object.values(battle.combatants).filter(x =>
        x.side !== c.side && x.direction === c.direction && x.alive);
      const msgs: any[] = [];
      for (const en of enemies) {
        const pct = u.rnd(ieff.minPct, ieff.maxPct);
        const dmg = Math.round(en.hp * pct / 100);
        en.hp = Math.max(0, en.hp - dmg);
        c.stats.dmgDealt += dmg;
        en.stats.dmgTaken += dmg;
        if (en.hp <= 0) { en.alive = false; c.stats.kills++; addActivity(battle, user.id, 'kill'); }
        msgs.push(`${en.name} −${dmg}`);
      }
      resultMsg = `💣 ${user.name}: Водородная бомба! ${msgs.join(', ')}`;
      break;
    }

    case 'heal_pct': {
      const healTarget = tc || c;
      if (healTarget.side !== c.side) throw new u.ApiError('Только на союзников');
      const blocked = (healTarget.statusEffects || []).find(e => e.type === 'no_heal' && e.expiresAt > now());
      if (blocked) throw new u.ApiError('Лечение цели заблокировано');
      const pct = u.rnd(ieff.minPct, ieff.maxPct);
      const healAmt = Math.round(healTarget.maxHp * pct / 100);
      const before = healTarget.hp;
      healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + healAmt);
      const actual = healTarget.hp - before;
      c.stats.healed += actual;
      const healedUser = allUsers()[healTarget.userId];
      if (healedUser) healedUser.res.hp.cur = Math.min(player.maxima(healedUser).hp, healedUser.res.hp.cur + actual);
      resultMsg = `🩹 ${user.name}: Аптечка → ${healTarget.name}: +${actual} HP (${pct}%)`;
      break;
    }

    case 'immunity':
      c.statusEffects = c.statusEffects || [];
      c.statusEffects.push({ type: 'immunity', expiresAt: now() + ieff.duration * 1000 });
      resultMsg = `🔵 ${user.name}: Защитный купол! Иммунитет ${ieff.duration} сек`;
      break;

    case 'reflect':
      if (c.direction === null) throw new u.ApiError('Выберите направление');
      c.statusEffects = c.statusEffects || [];
      c.statusEffects.push({ type: 'reflect', expiresAt: now() + 10 * 60 * 1000 });
      resultMsg = `🪞 ${user.name}: Отражающий щит активирован!`;
      break;

    default:
      throw new u.ApiError('Неизвестный эффект предмета');
  }

  c.gear.splice(gearIdx, 1);
  // Синхронизируем «staging»-пояс (battle.gear), который читают некоторые
  // виды, иначе использованный предмет продолжает висеть в поясе у игрока.
  if (battle.gear && battle.gear[user.id]) battle.gear[user.id] = c.gear.slice();
  c.lastItemAt = now();
  c.stats.itemsUsed++;
  addActivity(battle, user.id, 'item_used');

  log(battle, resultMsg, 'item');
  checkBattleEnd(battle, legions(), allUsers());
  saveBattle(battle);

  notices.push(resultMsg);
  return { ok: true, gearLeft: c.gear };
}

// ───────────────────────────────────────────────────────────────────
// Тик DoT-эффектов (вызывается из resolveWars каждые 30 сек)
// ───────────────────────────────────────────────────────────────────
function tickEffects(battle: Battle): void {
  const t = now();
  for (const c of Object.values(battle.combatants)) {
    if (!c.alive) continue;
    c.statusEffects = (c.statusEffects || []).filter(e => e.expiresAt > t);
    for (const e of c.statusEffects as any[]) {
      if (e.type === 'dot' && e.nextTickAt && t >= e.nextTickAt) {
        const dmg = Math.round(c.hp * e.tickPct / 100);
        c.hp = Math.max(0, c.hp - dmg);
        c.stats.dmgTaken += dmg;
        if (c.hp <= 0) c.alive = false;
        e.nextTickAt += e.tickInterval;
        log(battle, `🔥 Напалм: ${c.name} −${dmg} HP`, 'dot');
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// Итоги: подсчёт очков активности и формирование статистики
// ───────────────────────────────────────────────────────────────────
function calcActivityScores(battle: Battle): any {
  const scores = { A: 0, B: 0 };
  const details = {};

  for (const c of Object.values(battle.combatants)) {
    const personal = (battle.activity || {})[c.userId] || 0;
    // Дополнительные очки из stats
    const fromStats =
      c.stats.dmgDealt * 0.01 +   // 0.01 очка за каждую единицу урона
      c.stats.healed   * 0.01 +   // аналогично лечение
      c.stats.kills    * 5;       // 5 доп. очков за убийство

    const total = Math.round(personal + fromStats);
    details[c.userId] = { name: c.name, side: c.side, role: c.role, score: total, stats: c.stats };
    scores[c.side] = (scores[c.side] || 0) + total;
  }

  return { scores, details };
}

function buildFinalReport(battle: Battle, winningSide: string): any {
  const { scores, details } = calcActivityScores(battle);
  const combatants: any[] = Object.values(details);

  // Метрика «лучшего» для каждой роли — по РЕАЛЬНО сделанному:
  //   медик    — сколько HP суммарно вылечил союзникам
  //   защитник — сколько урона принял на себя, прикрывая союзников
  //   боец     — сколько урона нанёс
  const roleMetric = (x: any): number => {
    if (x.role === 'medic')    return x.stats.healed     || 0;
    if (x.role === 'guardian') return x.stats.guardedDmg || 0;
    return x.stats.dmgDealt || 0;
  };
  const byRole = (role: string) => (combatants as any[])
    .filter(x => x.role === role)
    .sort((a, b) => roleMetric(b) - roleMetric(a));

  const topMedic    = byRole('medic')[0]    || null;
  const topGuardian = byRole('guardian')[0] || null;
  const topAssault  = byRole('assault')[0]  || null;

  // ── Топы среди ВСЕХ участников (видны всем) ──
  const sortedByDmg  = [...combatants].sort((a, b) => b.stats.dmgDealt - a.stats.dmgDealt);
  const sortedByHeal = [...combatants].sort((a, b) => b.stats.healed   - a.stats.healed);
  const sortedByDef  = [...combatants].sort((a, b) => (b.stats.guards||0) - (a.stats.guards||0));
  const topItem = (x: any, val: number) => x ? { name: x.name, side: x.side, value: val } : null;
  const tops = {
    damage:  topItem(sortedByDmg[0],  sortedByDmg[0]  ? sortedByDmg[0].stats.dmgDealt : 0),
    healing: topItem(sortedByHeal[0], sortedByHeal[0] ? sortedByHeal[0].stats.healed  : 0),
    defense: topItem(sortedByDef[0],  sortedByDef[0]  ? (sortedByDef[0].stats.guards||0) : 0),
  };

  // ── Топ-3 по каждой характеристике (для послебоевого экрана) ──
  const mkTop3 = (arr: any[], valFn: (x: any) => number) =>
    arr.filter(x => valFn(x) > 0).slice(0, 3).map(x => ({ name: x.name, side: x.side, value: valFn(x) }));
  const sortedByKills = [...combatants].sort((a, b) => (b.stats.kills || 0) - (a.stats.kills || 0));
  const top3 = {
    damage:  mkTop3(sortedByDmg,   x => x.stats.dmgDealt || 0),
    healing: mkTop3(sortedByHeal,  x => x.stats.healed   || 0),
    defense: mkTop3(sortedByDef,   x => x.stats.guards   || 0),
    kills:   mkTop3(sortedByKills, x => x.stats.kills    || 0),
  };

  // ── «Лучшие боя» по одному на каждую роль, ОТДЕЛЬНО для каждой стороны.
  // Игроку показываем только его сторону: данные врага недоступны.
  const roleLabel: Record<string, string> = { assault: 'Лучший боец', guardian: 'Лучший защитник', medic: 'Лучший медик' };
  const roleUnit: Record<string, string>  = { assault: 'урона', guardian: 'урона принял', medic: 'HP вылечил' };
  const bestBySide = (side: string) => ['assault', 'guardian', 'medic'].map((role) => {
    const best = (combatants as any[])
      .filter(x => x.role === role && x.side === side)
      .sort((a, b) => roleMetric(b) - roleMetric(a))[0];
    if (!best || roleMetric(best) <= 0) return null;
    return { role, label: roleLabel[role], unit: roleUnit[role], name: best.name, value: roleMetric(best) };
  }).filter(Boolean);
  const bestPerRole = { A: bestBySide('A'), B: bestBySide('B') };

  // ── Сводка по кланам (обе стороны): участники и суммарные показатели ──
  const sideSummary = (side: string) => {
    const members = combatants.filter(x => x.side === side);
    return {
      side,
      name: side === 'A' ? battle.legionAName : battle.legionBName,
      memberCount: members.length,
      totalDamage:  members.reduce((s, x) => s + (x.stats.dmgDealt || 0), 0),
      totalHealed:  members.reduce((s, x) => s + (x.stats.healed   || 0), 0),
      totalKills:   members.reduce((s, x) => s + (x.stats.kills    || 0), 0),
      members: members.map(x => ({
        name: x.name, role: x.role,
        dmgDealt: x.stats.dmgDealt || 0, healed: x.stats.healed || 0,
        guards: x.stats.guards || 0, guardedDmg: x.stats.guardedDmg || 0, kills: x.stats.kills || 0,
      })),
    };
  };

  return {
    winningSide,
    activityScores: scores,
    playerDetails: details,
    topMedic,
    topGuardian,
    topAssault,
    tops,
    top3,
    bestPerRole,
    clanResults: { A: sideSummary('A'), B: sideSummary('B') },
  };
}

// ───────────────────────────────────────────────────────────────────
// Проверка и завершение боя
// ───────────────────────────────────────────────────────────────────
function checkBattleEnd(battle: Battle, all: any, users: any): void {
  if (battle.phase !== 'active') return;

  const aliveA = Object.values(battle.combatants).filter(c => c.side === 'A' && c.alive).length;
  const aliveB = Object.values(battle.combatants).filter(c => c.side === 'B' && c.alive).length;

  if (aliveA === 0 || aliveB === 0) {
    finalizeBattle(battle, all, users, aliveA > 0 ? 'A' : 'B', 'elimination');
  }
}

function finalizeBattle(battle: Battle, all: any, users: any, winningSide: string, reason: string): void {
  battle.phase = 'done';
  battle.finishedAt = now();
  battle.winningSide = winningSide as any;
  battle.finishReason = reason || 'time';

  const legionA = all[battle.legionA];
  const legionB = all[battle.legionB];
  if (!legionA || !legionB) { saveBattle(battle); return; }

  const winner = winningSide === 'A' ? legionA : legionB;
  const loser  = winningSide === 'A' ? legionB : legionA;

  // Слава
  const gloryGain = u.rnd(1, 2);
  const gloryLoss = u.rnd(1, 2);
  const wResult = addGlory(winner, +gloryGain);
  addGlory(loser,  -gloryLoss);

  // Статистика побед/поражений
  winner.battleStats = winner.battleStats || { wins: 0, losses: 0 };
  loser.battleStats  = loser.battleStats  || { wins: 0, losses: 0 };
  winner.battleStats.wins   = (winner.battleStats.wins   || 0) + 1;
  loser.battleStats.losses  = (loser.battleStats.losses  || 0) + 1;

  // Экономика (валюта «Резервы»)
  const loot = Math.floor((loser.reserves || 0) * 0.20);
  loser.reserves  = Math.max(0, (loser.reserves || 0) - loot);
  winner.reserves = (winner.reserves || 0) + loot + (config.LEGION.BATTLE_LOOT_RESERVES || 0);
  winner.ratingPoints = (winner.ratingPoints || 0) + 10;
  loser.ratingPoints  = Math.max(0, (loser.ratingPoints || 0) - 3);

  const report = buildFinalReport(battle, winningSide);
  battle.finalReport = report;

  // XP и уведомления (только тем кто реально в бою)
  for (const c of Object.values(battle.combatants)) {
    const u2 = users[c.userId];
    if (!u2) continue;
    const won = c.side === winningSide;
    player.addXp(u2, won ? config.LEGION.BATTLE_XP_WIN : config.LEGION.BATTLE_XP_LOSS, []);
    notif.push(c.userId, 'legion_battle_result',
      won
        ? `🏆 Победа легиона! +${gloryGain} ⭐ ${wResult.levelUp ? '🎉 Новый уровень легиона!' : ''}`
        : `💀 Поражение легиона. −${gloryLoss} ⭐`,
      { won, loot: won ? loot : -loot, report });
  }

  // Отвязываем бой от обоих легионов
  legionA.activeBattle = null;
  legionB.activeBattle = null;
  // Подробная история: имя врага, что получили/потеряли, суммарный урон сторон, дата
  const crA = report.clanResults ? report.clanResults.A : null;
  const crB = report.clanResults ? report.clanResults.B : null;
  const histA = {
    at: now(), enemyId: loser.id === legionA.id ? legionB.id : loser.id,
    enemyName: legionB.name, myName: legionA.name,
    won: winner === legionA, loot, gloryGain, gloryLoss,
    // «Лучшие» своей стороны — для окна «Подробнее» в истории
    best: (report.bestPerRole || {}).A || [],
    myDamage: crA ? crA.totalDamage : 0, enemyDamage: crB ? crB.totalDamage : 0,
    myParticipants: crA ? crA.memberCount : 0, enemyParticipants: crB ? crB.memberCount : 0,
  };
  const histB = {
    at: now(), enemyId: legionA.id, enemyName: legionA.name, myName: legionB.name,
    won: winner === legionB, loot, gloryGain, gloryLoss,
    best: (report.bestPerRole || {}).B || [],
    myDamage: crB ? crB.totalDamage : 0, enemyDamage: crA ? crA.totalDamage : 0,
    myParticipants: crB ? crB.memberCount : 0, enemyParticipants: crA ? crA.memberCount : 0,
  };
  legionA.battleHistory = (legionA.battleHistory || []).concat(histA).slice(-20);
  legionB.battleHistory = (legionB.battleHistory || []).concat(histB).slice(-20);

  // Сохраняем и бой (завершённый), и легионы
  saveBattle(battle);
  db.save('legions');
}

// ───────────────────────────────────────────────────────────────────
// Единый тик всех боёв (вызывается из resolveWars каждые 30 сек)
// Проходит по коллекции battles, двигает фазы prep→active→done.
// ───────────────────────────────────────────────────────────────────
// Продвинуть ОДИН бой по времени: prep→active по таймеру и завершение
// активной фазы по истечении времени. НЕ трогает DoT-эффекты (они тикают
// на 30-сек цикле фонового тика, чтобы урон не ускорялся от частых опросов).
// Возвращает true, если фаза изменилась (нужно сохранить).
// Вызывается и из общего тика, и ЛЕНИВО из battleState — чтобы фаза менялась
// сразу при опросе клиента, а не ждала до 30 сек фонового тика (из-за этого
// после 00:00 бой «не пускал» и висел чёрный экран).
function advancePhase(battle: Battle, all: any, users: any): boolean {
  if (!battle || battle.phase === 'done') return false;

  // Завершение по истечении активной фазы
  if (battle.phase === 'active' && now() >= (battle.activeEndsAt || 0)) {
    const { scores } = calcActivityScores(battle);
    const winningSide = (scores.A || 0) >= (scores.B || 0) ? 'A' : 'B';
    finalizeBattle(battle, all, users, winningSide, 'time');
    return true;
  }

  // Фаза prep → active по таймеру
  if (battle.phase === 'prep' && now() >= battle.prepEndsAt) {
    // Игрок, выбравший роль, считается подготовившимся. Если он не нажал
    // «Готов» или не выбрал направление — проставляем автоматически.
    for (const [uid, c] of Object.entries(battle.combatants)) {
      if (!c.direction) {
        const counts = [1, 2, 3].map((d) => ({
          d, n: Object.values(battle.combatants).filter((x) => x.side === c.side && x.direction === d).length,
        }));
        counts.sort((a, b) => a.n - b.n);
        c.direction = counts[0].d as any;
      }
      if (!c.ready) { c.ready = true; c.readyAt = now(); }
    }

    const sideA = Object.values(battle.combatants).filter(c => c.side === 'A');
    const sideB = Object.values(battle.combatants).filter(c => c.side === 'B');
    if (sideA.length === 0 || sideB.length === 0) {
      const winner = sideA.length > 0 ? 'A' : 'B';
      finalizeBattle(battle, all, users, winner, 'no_show');
      return true;
    }

    battle.phase = 'active';
    battle.activeStartAt = now();
    battle.activeEndsAt  = now() + BATTLE_MS;

    for (const c of Object.values(battle.combatants)) {
      notif.push(c.userId, 'legion_battle_active',
        `⚔️ Бой начался! Атакуйте врагов на «${DIR_NAMES[(c.direction || 1)-1]}».`,
        { activeEndsAt: battle.activeEndsAt });
    }
    return true;
  }

  return false;
}

function tickAllBattles(all: any, users: any): void {
  const allBattles = battles();
  let changed = false;

  for (const battle of Object.values(allBattles)) {
    if (!battle || battle.phase === 'done') continue;

    // Переходы фаз по времени (prep→active, завершение active)
    if (advancePhase(battle, all, users)) { changed = true; continue; }

    // DoT-эффекты в активном бою — только на фоновом 30-сек цикле
    if (battle.phase === 'active') {
      tickEffects(battle);
      changed = true;
    }
  }

  if (changed) db.save('battles');
}

// ───────────────────────────────────────────────────────────────────
// Состояние боя для клиента
// ───────────────────────────────────────────────────────────────────
// Недавно завершённый бой этого игрока (в течение грейс-периода) — чтобы
// показать послебоевой экран даже после того, как activeBattle обнулён.
function findRecentDoneBattle(user: User): Battle | null {
  const all = battles();
  let best: Battle | null = null;
  for (const b of Object.values(all)) {
    if (!b || b.phase !== 'done') continue;
    if (!b.combatants || !b.combatants[user.id]) continue;
    if (now() - (b.finishedAt || 0) > DONE_GRACE_MS) continue;
    if (!best || (b.finishedAt || 0) > (best.finishedAt || 0)) best = b;
  }
  return best;
}

// Компактный послебоевой вид: сторона игрока, победитель, его боец (со
// статистикой) и полный отчёт (топы, сводки кланов).
function doneStateView(battle: Battle, user: User): any {
  const c = battle.combatants[user.id];
  const mySide = c ? c.side : (battle.legionA === (user.legionId || '') ? 'A' : 'B');
  return {
    id: battle.id,
    phase: 'done',
    mySide,
    winningSide: battle.winningSide || null,
    finishReason: battle.finishReason || null,
    me: c ? serializeCombatant(c, now(), true) : null,
    finalReport: reportForSide(battle.finalReport, mySide),
  };
}


// ── РАЗВЕДЫВАТЕЛЬНЫЙ ЦЕНТР: что видно о противнике в подготовке ────
// Уровни накопительные:
//   0 — ничего (даже факт захода в бой)
//   1 — список зашедших в бой
//   2 — + направления и роли (иконками, без имён)
//   3 — + примерные характеристики (с бонусами построек легиона)
//   4 — + взятые предметы арсенала
//   5 — + постройки вражеского легиона
// Всё это действует ТОЛЬКО в фазе подготовки: в активном бою и так все
// друг друга видят.
const ROLE_ICONS: Record<string, string> = { assault: '🎯', guardian: '🛡️', medic: '➕' };

// Округление «примерных» характеристик до 2 значащих цифр
function approxNum(x: number): number {
  if (!x) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 1);
  return Math.round(x / mag) * mag;
}

function prepEnemyView(c: Combatant, intel: number, users: any, battle: Battle): any {
  const v: any = { userId: c.userId, side: c.side, alive: c.alive };
  if (intel >= 1) {
    v.name = c.name;
    // Раз уж разведка показывает, кто зашёл в бой — показываем и онлайн:
    // это часть той же информации «кто реально будет драться».
    try {
      const usr = users[c.userId];
      v.online = !!usr && Date.now() - (usr.lastSeen || 0) < 5 * 60 * 1000;
    } catch (e) { v.online = false; }
  }
  if (intel >= 2) {
    v.role = c.role;
    v.roleIcon = ROLE_ICONS[c.role] || '❔';
    v.roleName = (ROLES[c.role] || {}).label || '';
    v.direction = c.direction;
    v.dirName = c.direction ? DIR_NAMES[c.direction - 1] : null;
  }
  if (intel >= 3) {
    try {
      const eu = users[c.userId];
      if (eu) {
        const st = prepStats(eu, c);
        v.stats = {
          atk: approxNum(st.atk), def: approxNum(st.def),
          critPct: st.critPct, dodgePct: st.dodgePct,
          hp: c.hp, maxHp: c.maxHp,
        };
      }
    } catch (e) {}
  }
  if (intel >= 4) {
    v.gear = ((battle.gear && battle.gear[c.userId]) || c.gear || []).map((id: string) => {
      const item = config.LEGION_SHOP_ITEM_BY_ID[id];
      return { itemId: id, name: item ? item.name : id };
    });
  }
  return v;
}


// Отчёт, каким его видит КОНКРЕТНЫЙ игрок: данные противника скрыты —
// союзники получают информацию только о своей стороне (урон и состав
// вражеского легиона недоступны). Общий исход боя виден всем.
function reportForSide(report: any, mySide: string): any {
  if (!report) return null;
  const enemySide = mySide === 'A' ? 'B' : 'A';
  const cr = report.clanResults || {};
  const mine = cr[mySide] || null;
  const foe = cr[enemySide] || null;
  return {
    winningSide: report.winningSide,
    activityScores: report.activityScores,
    // Свои игроки — целиком; вражеские — только имя легиона и число бойцов
    clanResults: {
      [mySide]: mine,
      [enemySide]: foe ? { side: foe.side, name: foe.name, memberCount: foe.memberCount, hidden: true } : null,
    },
    // «Лучшие» — только среди своих
    bestPerRole: (report.bestPerRole || {})[mySide] || [],
    playerDetails: report.playerDetails,
  };
}

function battleState(user: User): any {
  const { battle, legion: l } = resolveBattle(user);

  // Активного боя нет — но, возможно, бой только что завершился. В finalizeBattle
  // связь activeBattle обнуляется, поэтому resolveBattle возвращает null. Чтобы
  // клиент показал итоги (а не завис/выкинул на главную), ищем недавно
  // завершённый бой этого игрока и отдаём его послебоевой вид.
  if (!battle) {
    const done = findRecentDoneBattle(user);
    if (done) return { battle: doneStateView(done, user) };
    return { battle: null };
  }

  // ЛЕНИВЫЙ переход фазы: не ждём фоновый 30-сек тик. Как только клиент
  // опросил состояние после истечения таймера подготовки — сразу переводим
  // prep→active (или завершаем истёкшую активную фазу). Иначе после 00:00
  // клиент до 30 сек видел «застывший» экран.
  if (advancePhase(battle, legions(), allUsers())) db.save('battles');

  // Бой мог завершиться прямо в advancePhase (истекло время) — отдаём итоги.
  if (battle.phase === 'done') return { battle: doneStateView(battle, user) };

  // Сборку полного DTO оборачиваем в try/catch: если из-за неожиданных данных
  // (битый combatant, отсутствующее поле и т.п.) построение упадёт, эндпоинт
  // НЕ должен отдавать 500 — иначе клиент ловит сбой и показывает экран
  // «переподключения» на всю фазу подготовки. Вместо этого отдаём минимально
  // достаточный безопасный DTO: фаза + таймер + мой боец, чтобы окно боя
  // открылось и показало подготовку, а не зависло.
  try {
    return { battle: buildBattleDTO(user, battle, l) };
  } catch (e) {
    console.error('battleState: сбой сборки DTO боя', (e as any) && (e as any).stack ? (e as any).stack : e);
    const t = now();
    const meRaw = battle.combatants[user.id] || null;
    return {
      battle: {
        id: battle.id,
        phase: battle.phase,
        prepEndsAt: battle.prepEndsAt,
        prepSecsLeft: Math.max(0, Math.floor(((battle.prepEndsAt || 0) - t) / 1000)),
        activeEndsAt: battle.activeEndsAt || null,
        timeLeft: battle.phase === 'active' ? Math.max(0, Math.floor(((battle.activeEndsAt || 0) - t) / 1000)) : null,
        me: meRaw ? { userId: meRaw.userId, name: meRaw.name, role: meRaw.role,
          roleName: (ROLES[meRaw.role] && ROLES[meRaw.role].label) || meRaw.role,
          hp: meRaw.hp, maxHp: meRaw.maxHp, ready: meRaw.ready, direction: meRaw.direction,
          alive: meRaw.alive } : null,
        mySide: l.id === battle.legionA ? 'A' : 'B',
        cooldowns: null, directions: [], allCombatants: [], dirNames: DIR_NAMES,
        log: [], liveScores: null, finalReport: null,
        myGear: [], maxSlots: config.LEGION.GEAR_SLOTS_DEFAULT, arsenal: [],
        teamChat: [], globalChat: [],
        degraded: true,   // флаг: DTO собран в аварийном режиме
      },
    };
  }
}

// Полная сборка DTO активного/подготовительного боя (вынесена из battleState,
// чтобы её можно было безопасно обернуть в try/catch выше).
function buildBattleDTO(user: User, battle: Battle, l: any): any {
  const mySide = l.id === battle.legionA ? 'A' : 'B';
  const me = battle.combatants[user.id] || null;
  const t  = now();

  // Уровень разведки своего легиона (гейтит данные о враге в подготовке)
  const isPrep = battle.phase === 'prep';
  const intel = bbLevel(user.legionId, 'intel');
  const allUsersMap = allUsers();

  const directions: any[] = [];
  for (let d = 1; d <= DIRECTIONS; d++) {
    const allies  = Object.values(battle.combatants).filter(c => c.side === mySide && c.direction === d);
    const enemies = Object.values(battle.combatants).filter(c => c.side !== mySide && c.direction === d);
    // В подготовке позиции врага видны только с «Разведцентра» ур.2+
    const enemyView = isPrep
      ? (intel >= 2 ? enemies.map(c => prepEnemyView(c, intel, allUsersMap, battle)) : [])
      : enemies.map(c => serializeCombatant(c, t, false));
    directions.push({
      dir: d,
      name: DIR_NAMES[d-1],
      allies:  allies.map(c  => serializeCombatant(c, t, c.userId === user.id)),
      enemies: enemyView,
      allySlots: MAX_PER_DIR - allies.filter(c => c.alive).length,
    });
  }

  const allCombatants = Object.values(battle.combatants)
    // В подготовке без «Разведцентра» врагов не видно вообще — узнаем только
    // когда начнётся бой. Ур.1 открывает список зашедших.
    .filter(c => !isPrep || c.side === mySide || intel >= 1)
    .map(c => {
    let online = false;
    try { const usr = player.users()[c.userId]; if (usr) online = Date.now() - (usr.lastSeen || 0) < 5 * 60 * 1000; } catch (e) {}
    // Врагу в подготовке отдаём только то, что разрешено уровнем разведки
    if (isPrep && c.side !== mySide) {
      const v: any = prepEnemyView(c, intel, allUsersMap, battle);
      v.online = online;
      return v;
    }
    return {
      userId: c.userId, name: c.name, side: c.side, role: c.role,
      ready: c.ready, hp: c.hp, maxHp: c.maxHp, direction: c.direction,
      alive: c.alive, dirName: c.direction ? DIR_NAMES[(c.direction || 1)-1] : null, online,
    };
  });

  const myCDs = me ? {
    action: Math.max(0, Math.ceil((me.lastActionAt + actionCdMs(user.legionId) - t) / 1000)),
    move:   Math.max(0, Math.ceil((me.lastMoveAt   + MOVE_CD_MS   - t) / 1000)),
    item:   Math.max(0, Math.ceil(((me.lastItemAt||0) + ITEM_CD_MS  - t) / 1000)),
  } : null;

  const timeLeft = battle.phase === 'active'
    ? Math.max(0, Math.floor(((battle.activeEndsAt || 0) - t) / 1000))
    : null;

  // Текущие очки активности
  let liveScores = null;
  if (battle.phase === 'active') {
    const { scores } = calcActivityScores(battle);
    liveScores = scores;
  }

  // Боевой пояс игрока и доступный арсенал легиона (для взятия предметов
  // как в фазе подготовки, так и для отображения слотов в бою).
  const config = require('../../config/gameConfig');
  const extraSlots = (l.battleBuildings && l.battleBuildings['gear_slots']) || 0;
  const maxSlots = config.LEGION.GEAR_SLOTS_DEFAULT + extraSlots;
  // В активном бою источник истины — пояс бойца (combatant.gear), т.к. он
  // расходуется при использовании предметов; battle.gear — «staging» подготовки.
  const myGear = (battle.phase === 'active' && me && me.gear)
    ? me.gear
    : ((battle.gear && battle.gear[user.id]) || (me ? me.gear : []) || []);
  // Список предметов, которые ещё можно взять из арсенала легиона
  const arsenal = Object.entries(l.arsenal || {})
    .filter(([, qty]) => (qty as number) > 0)
    .map(([itemId, qty]) => {
      const item = config.LEGION_SHOP_ITEM_BY_ID[itemId];
      return item ? { itemId, name: item.name, qty: qty as number, desc: item.desc || '' } : null;
    })
    .filter(Boolean);

  return {
    id: battle.id,
    phase: battle.phase,
    prepEndsAt: battle.prepEndsAt,
    prepSecsLeft: Math.max(0, Math.floor((battle.prepEndsAt - t) / 1000)),
    activeEndsAt: battle.activeEndsAt,
    timeLeft,
    finishReason: battle.finishReason || null,
    winningSide: battle.winningSide || null,
    me: me ? serializeCombatant(me, t, true) : null,
    myStats: (() => { try { return (battle.phase === 'prep' && me) ? prepStats(user, me) : null; } catch (e) { return null; } })(),
    mySide,
    cooldowns: myCDs,
    directions,
    allCombatants,
    dirNames: DIR_NAMES,
    // Разведка: уровень своего «Разведцентра» и что он открыл
    intelLevel: intel,
    intelActive: isPrep,
    enemyLegionName: (legions()[mySide === 'A' ? battle.legionB : battle.legionA] || {}).name || null,
    enemyBuildings: (isPrep && intel >= 5) ? (() => {
      const el = legions()[mySide === 'A' ? battle.legionB : battle.legionA];
      if (!el) return null;
      return config.LEGION_BATTLE_BUILDINGS.map((b: any) => ({
        id: b.id, name: b.name, maxLevel: b.maxLevel,
        level: (el.battleBuildings || {})[b.id] || 0,
      }));
    })() : null,
    log: (battle.log || []).slice(-40),
    liveScores,
    finalReport: reportForSide(battle.finalReport, mySide),
    // Боевой пояс и арсенал для UI слотов
    myGear,
    maxSlots,
    arsenal,
    // Чат боя: командный (своя сторона) и общий (все участники)
    teamChat: (battle.teamChat && battle.teamChat[mySide]) || [],
    globalChat: battle.globalChat || [],
  };
}

function serializeCombatant(c: Combatant, t: number, isSelf: boolean): any {
  const fx = (type) => (c.statusEffects || []).filter(e => e.type === type && e.expiresAt > t);
  // Боеприпасы и энергия берём из ресурсов игрока (для ряда ресурсов в бою)
  let ammo: number | null = null, energy: number | null = null;
  let online = false;
  try {
    const usr = player.users()[c.userId];
    if (usr && usr.res) { ammo = Math.floor(usr.res.am.cur); energy = Math.floor(usr.res.en.cur); }
    // Онлайн — активность за последние 5 минут (как в списке целей и профиле).
    // В легион-бою ботов нет, все бойцы — реальные игроки.
    if (usr) online = Date.now() - (usr.lastSeen || 0) < 5 * 60 * 1000;
  } catch (e) {}
  return {
    userId: c.userId, name: c.name,
    role: c.role, roleName: ROLES[c.role] ? ROLES[c.role].label : c.role,
    hp: c.hp, maxHp: c.maxHp,
    // Снаряды и энергию видит ТОЛЬКО сам игрок — противник и союзники не знают
    // твой боезапас/энергию (это стратегическая информация). HP остаётся видимым:
    // без него нельзя целиться и понимать прогресс боя.
    ammo: isSelf ? ammo : null, energy: isSelf ? energy : null, online,
    alive: c.alive, ready: c.ready, direction: c.direction,
    dirName: c.direction ? DIR_NAMES[(c.direction || 1)-1] : null,
    stunned:    fx('stun').length    > 0 ? Math.ceil((fx('stun')[0].expiresAt    - t) / 1000) : 0,
    noHeal:     fx('no_heal').length > 0 ? Math.ceil((fx('no_heal')[0].expiresAt - t) / 1000) : 0,
    onFire:     fx('dot').length     > 0,
    dmgBoost:   fx('dmg_boost').length > 0 ? fx('dmg_boost')[0].bonus : 0,
    immune:     fx('immunity').length  > 0 ? Math.ceil((fx('immunity')[0].expiresAt - t) / 1000) : 0,
    reflecting: fx('reflect').length   > 0,
    gear:       isSelf ? (c.gear || []) : undefined,
    stats:      isSelf ? c.stats : undefined,
  };
}

// ── Характеристики игрока для фазы подготовки (с бонусами построек легиона) ──
// atk/def берутся из totalPower (в нём уже учтены клановые постройки легиона),
// крит — от жестокости, уворот — от ловкости, плюс бонусы допинга/наёмников.
function prepStats(user: User, c?: Combatant): any {
  player.refresh(user);
  const roleAtk = c ? c.roleMul.atk : 1;
  const roleDef = c ? c.roleMul.def : 1;
  const atk = Math.round(player.totalPower(user, 'atk').power * roleAtk);
  const def = Math.round(player.totalPower(user, 'def').power * roleDef);
  const critPct  = Math.round((Math.min(0.50, 0.05 + user.skills.cruelty * 0.005) + (player.effMul(user, 'crit_bonus') - 1)) * 1000) / 10;
  const dodgePct = Math.round((Math.min(config.BATTLE.DODGE_MAX, user.skills.agility * config.BATTLE.DODGE_PER_AGILITY) + (player.effMul(user, 'dodge_bonus') - 1)) * 1000) / 10;
  // Шанс крит-лечения — только для медика (у остальных ролей лечения нет)
  const critHealPct = Math.round(trophies.critHealChance(user) * 1000) / 10;
  const mx = player.maxima(user);
  return {
    atk, def, critPct, dodgePct, critHealPct,
    hp: Math.floor(user.res.hp.cur),  maxHp: Math.floor(mx.hp),
    energy: Math.floor(user.res.en.cur), maxEnergy: Math.floor(mx.en),
    ammo: Math.floor(user.res.am.cur), maxAmmo: Math.floor(mx.am),
    // Цена восстановления каждого ресурса по отдельности = цена
    // соответствующего допинга на чёрном рынке.
    costs: restoreCosts(),
  };
}

// Цены восстановления по ресурсам: аптечка / энергетик / цинк боеприпасов
function restoreCosts(): { hp: number; energy: number; ammo: number } {
  const byId: any = config.MARKET_ITEM_BY_ID;
  const g = (id: string) => (byId[id] ? byId[id].gold : 0);
  return { hp: g('medkit'), energy: g('energy'), ammo: g('ammo') };
}

// Восстановить ОДИН ресурс до максимума за цену соответствующего допинга.
// kind: 'hp' | 'energy' | 'ammo'. Только в фазе подготовки.
function restoreForBattle(user: User, kind: string, notices: Notices) {
  const { battle } = resolveBattle(user);
  if (!battle) throw new u.ApiError('Нет активного боя');
  if (battle.phase !== 'prep') throw new u.ApiError('Восстановить можно только во время подготовки');
  player.refresh(user);

  const costs = restoreCosts();
  const mx = player.maxima(user);
  const MAP: Record<string, { res: any; max: number; cost: number; label: string }> = {
    hp:     { res: user.res.hp, max: mx.hp, cost: costs.hp,     label: '❤️ Здоровье' },
    energy: { res: user.res.en, max: mx.en, cost: costs.energy, label: '⚡ Энергия' },
    ammo:   { res: user.res.am, max: mx.am, cost: costs.ammo,   label: '🔫 Боеприпасы' },
  };
  const item = MAP[String(kind)];
  if (!item) throw new u.ApiError('Неизвестный ресурс');
  if (Math.floor(item.res.cur) >= Math.floor(item.max)) throw new u.ApiError('Этот ресурс уже полный');
  if ((user.gold || 0) < item.cost) throw new u.ApiError(`Нужно ${item.cost} золота`);

  user.gold -= item.cost;
  item.res.cur = item.max;
  item.res.t = now();
  if (kind === 'hp') {
    const c = battle.combatants[user.id];
    if (c) c.hp = c.maxHp;
  }
  db.save('users'); db.save('battles');
  notices.push(`${item.label} восстановлено за 🪙 ${item.cost}.`);
  return { ok: true, cost: item.cost, kind };
}

// ── Выйти из боя (добровольно) ────────────────────────────────────
function leaveBattle(user: User, notices: Notices) {
  const { battle } = resolveBattle(user);
  if (!battle) throw new u.ApiError('Нет активного боя');
  const c = battle.combatants[user.id];
  if (!c) throw new u.ApiError('Вы не участник боя');

  // Убираем участника — его статистика не учитывается в итогах
  delete battle.combatants[user.id];
  log(battle, `🚪 ${user.name} покинул бой`, 'info');

  // Проверяем не закончился ли бой
  if (battle.phase === 'active') {
    const aliveA = Object.values(battle.combatants).filter(c2 => c2.side === 'A' && c2.alive).length;
    const aliveB = Object.values(battle.combatants).filter(c2 => c2.side === 'B' && c2.alive).length;
    if (aliveA === 0 || aliveB === 0) {
      finalizeBattle(battle, legions(), allUsers(), aliveA > 0 ? 'A' : 'B', 'elimination');
    }
  }

  saveBattle(battle);
  notices.push('🚪 Вы покинули бой. Ваша статистика не сохранена.');
  return { ok: true };
}

// Отправить сообщение в чат боя. scope: 'team' (своя сторона) | 'global' (все).
function sendChat(user: User, scope: string, text: string, notices: Notices) {
  const { battle } = resolveBattle(user);
  if (!battle) throw new u.ApiError('Нет активного боя');
  const c = findCombatant(battle, user.id);
  if (!c) throw new u.ApiError('Вы не участник боя');
  const clean = String(text || '').trim().slice(0, 200);
  if (!clean) return { ok: true };
  const msg = { userId: user.id, name: user.name, text: clean, at: Date.now() };
  if (scope === 'global') {
    if (!battle.globalChat) battle.globalChat = [];
    battle.globalChat.push(msg);
    if (battle.globalChat.length > 100) battle.globalChat = battle.globalChat.slice(-100);
  } else {
    const side = c.side;
    if (!battle.teamChat) battle.teamChat = {};
    if (!battle.teamChat[side]) battle.teamChat[side] = [];
    battle.teamChat[side].push(msg);
    if (battle.teamChat[side].length > 100) battle.teamChat[side] = battle.teamChat[side].slice(-100);
  }
  db.save('battles');
  return { ok: true };
}

export = {
  joinBattle, setReady, chooseDirection, attack, heal, guard, useItem, leaveBattle, restoreForBattle,
  battleState, tickEffects, tickAllBattles, sendChat,
  ROLES, DIRECTIONS, DIR_NAMES, MAX_PER_DIR, PREP_MS, BATTLE_MS,
  ensureLegionGlory, addGlory, calcLegionLevel, GLORY_THRESHOLDS,
};
