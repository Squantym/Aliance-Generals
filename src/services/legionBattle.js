// ===================================================================
// src/services/legionBattle.js — Бой легионов
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

const config = require('../../config/gameConfig');
const db     = require('../core/db');
const u      = require('../core/utils');
const player = require('./player');
const notif  = require('./notifications');

// ───────────────────────────────────────────────────────────────────
// Константы
// ───────────────────────────────────────────────────────────────────
const DIRECTIONS = 5;
const DIR_NAMES  = ['Северный фронт', 'Восточный рубеж', 'Западный плацдарм', 'Южный редут', 'Центральная высота'];
const MAX_PER_DIR = 5;
const PREP_MS     = 10 * 60 * 1000;   // 10 мин подготовки
const BATTLE_MS   = 60 * 60 * 1000;   // 1 час бой
const MOVE_CD_MS  = 30 * 1000;        // кулдаун смены направления
const ACTION_CD_MS = 3 * 1000;        // кулдаун действия
const ITEM_CD_MS  = 10 * 1000;        // кулдаун предмета
const GUARD_SEC   = 15;               // прикрытие 15 сек

// Очки активности за действия
const ACTIVITY = {
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
const ROLES = {
  assault:  { label: 'Штурмовик',  atkMul: 1.20, defMul: 1.00, dmgReduce: 0.00 },
  guardian: { label: 'Защитник',   atkMul: 0.80, defMul: 1.20, dmgReduce: 0.20 },
  medic:    { label: 'Медик',      atkMul: 0.70, defMul: 0.70, dmgReduce: 0.00 },
};

// ───────────────────────────────────────────────────────────────────
// Хелперы
// ───────────────────────────────────────────────────────────────────
function legions()  { return db.load('legions', {}); }
function allUsers() { return player.users(); }
function now()      { return Date.now(); }

function ensureLegionGlory(l) {
  if (l.gloryPoints  === undefined) l.gloryPoints  = 0;  // текущий баланс (может уменьшаться)
  if (l.gloryEarned  === undefined) l.gloryEarned  = 0;  // только накопленные (для уровня)
  if (l.legionLevel  === undefined) l.legionLevel  = 1;
}

function calcLegionLevel(gloryEarned) {
  let lvl = 1;
  for (let i = 1; i < GLORY_THRESHOLDS.length; i++) {
    if (gloryEarned >= GLORY_THRESHOLDS[i]) lvl = i + 1;
    else break;
  }
  return Math.min(lvl, GLORY_THRESHOLDS.length);
}

function addGlory(l, delta) {
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

function findCombatant(battle, userId) {
  return battle.combatants[userId] || null;
}

function log(battle, text, kind) {
  battle.log = battle.log || [];
  battle.log.push({ t: now(), text, kind: kind || 'info' });
  if (battle.log.length > 300) battle.log = battle.log.slice(-300);
}

function addActivity(battle, userId, type, amount) {
  battle.activity = battle.activity || {};
  battle.activity[userId] = (battle.activity[userId] || 0) + (amount || ACTIVITY[type] || 0);
}

// ───────────────────────────────────────────────────────────────────
// Урон: щит, иммунитет, отражение, прикрытие
// ───────────────────────────────────────────────────────────────────
function applyDamage(battle, targetId, rawDmg, sourceId) {
  const c = battle.combatants[targetId];
  if (!c || c.hp <= 0) return { actual: 0, shieldAbsorbed: 0 };

  // Прикрытие защитником
  const guardianId = (battle.guardLinks || {})[targetId];
  if (guardianId) {
    const g = battle.combatants[guardianId];
    if (g && g.hp > 0 && now() < ((battle.guardExpiry || {})[guardianId] || 0)) {
      return applyDamage(battle, guardianId, rawDmg, sourceId);
    } else {
      delete (battle.guardLinks || {})[targetId];
    }
  }

  // Иммунитет (купол)
  const immune = (c.statusEffects || []).find(e => e.type === 'immunity' && e.expiresAt > now());
  if (immune) {
    log(battle, `🔵 ${c.name} под куполом — урон поглощён`, 'info');
    return { actual: 0, shieldAbsorbed: 0, immune: true };
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
      return applyDamage(battle, victim.userId, rawDmg, sourceId);
    }
    return { actual: 0, shieldAbsorbed: 0 };
  }

  let dmg = rawDmg;
  let shieldAbsorbed = 0;

  // Щит защитника
  if (c.role === 'guardian' && (c.shield || 0) > 0) {
    const absorbed = Math.min(c.shield, dmg);
    c.shield -= absorbed;
    dmg -= absorbed;
    shieldAbsorbed = absorbed;
  }

  const actual = Math.min(dmg, c.hp);
  c.hp = Math.max(0, c.hp - dmg);

  // Очки активности — штраф за получение урона
  if (actual > 0) addActivity(battle, targetId, 'damage_taken');

  return { actual, shieldAbsorbed };
}

// ───────────────────────────────────────────────────────────────────
// Расчёт урона между двумя бойцами
// ───────────────────────────────────────────────────────────────────
function calcDamage(attacker, defender, aUser, dUser) {
  const aAtk = player.totalPower(aUser, 'atk').power * attacker.roleMul.atk;
  const dDef = player.totalPower(dUser, 'def').power * defender.roleMul.def;

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
  if (boost) dmg = Math.round(dmg * (1 + boost.bonus / 100));

  // Крит
  const critChance = Math.min(0.50, 0.05 + aUser.skills.cruelty * 0.005);
  const crit = Math.random() < critChance;
  if (crit) dmg = Math.round(dmg * 2.0);
  dmg = u.clamp(dmg, 1, 200);

  // Снижение урона для защитника
  dmg = Math.round(dmg * (1 - defender.roleMul.dmgReduce));

  return { dmg, crit };
}

// ───────────────────────────────────────────────────────────────────
// Регистрация игрока + выбор роли (фаза prep)
// ───────────────────────────────────────────────────────────────────
function joinBattle(user, roleId, notices) {
  player.refresh(user);
  const l = legions()[user.legionId];
  if (!l || !l.activeBattle) throw new u.ApiError('Нет активного боя легиона');
  const battle = l.activeBattle;

  if (battle.phase !== 'prep') throw new u.ApiError('Фаза подготовки завершена');
  if (now() > battle.prepEndsAt) throw new u.ApiError('Время подготовки истекло');
  if (!ROLES[roleId]) throw new u.ApiError('Неизвестная роль');

  const role = ROLES[roleId];
  const side = l.id === battle.legionA ? 'A' : 'B';
  const mx   = player.maxima(user);
  const shieldVal = roleId === 'guardian' ? user.res.en.cur : 0;

  battle.combatants[user.id] = {
    userId: user.id,
    name: user.name,
    side,
    role: roleId,
    roleMul: { atk: role.atkMul, def: role.defMul, dmgReduce: role.dmgReduce },
    hp: user.res.hp.cur,
    maxHp: mx.hp,
    shield: shieldVal,
    direction: null,
    ready: true,
    readyAt: now(),
    lastActionAt: 0,
    lastMoveAt: 0,
    lastItemAt: 0,
    gear: ((battle.gear || {})[user.id]) || [],
    statusEffects: [],
    alive: true,
    // Статистика для итогов
    stats: { dmgDealt: 0, dmgTaken: 0, healed: 0, kills: 0, guards: 0, itemsUsed: 0 },
  };

  log(battle, `${user.name} готов (${role.label})`, 'prep');
  db.save('legions');
  notices.push(`✅ Вы в составе! Роль: ${role.label}. Выберите направление во вкладке «Война».`);
  return { ok: true, role: roleId };
}

// ───────────────────────────────────────────────────────────────────
// Выбор / смена направления
// ───────────────────────────────────────────────────────────────────
function chooseDirection(user, dir, notices) {
  const l = legions()[user.legionId];
  if (!l || !l.activeBattle) throw new u.ApiError('Нет активного боя');
  const battle = l.activeBattle;
  if (battle.phase !== 'active' && battle.phase !== 'prep') throw new u.ApiError('Нельзя выбрать направление сейчас');

  const c = findCombatant(battle, user.id);
  if (!c) throw new u.ApiError('Вы не зарегистрированы в бою');

  const d = u.toInt(dir, 0);
  if (d < 1 || d > DIRECTIONS) throw new u.ApiError(`Направление 1–${DIRECTIONS}`);

  // Кулдаун смены
  if (c.direction !== null && c.direction !== d) {
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
  if (wasDir !== null && wasDir !== d) {
    c.lastMoveAt = now();
    log(battle, `${user.name}: ${DIR_NAMES[wasDir-1]} → ${DIR_NAMES[d-1]}`, 'move');
  } else {
    log(battle, `${user.name} занял «${DIR_NAMES[d-1]}»`, 'move');
  }
  db.save('legions');
  notices.push(`📍 Вы на «${DIR_NAMES[d-1]}».`);
  return { direction: d, dirName: DIR_NAMES[d-1] };
}

// ───────────────────────────────────────────────────────────────────
// Атака (все роли могут атаковать, но с разными мультипликаторами)
// ───────────────────────────────────────────────────────────────────
function attack(user, targetUserId, notices) {
  player.refresh(user);
  const l = legions()[user.legionId];
  if (!l || !l.activeBattle) throw new u.ApiError('Нет активного боя');
  const battle = l.activeBattle;
  if (battle.phase !== 'active') throw new u.ApiError('Бой ещё не начался');

  const c = findCombatant(battle, user.id);
  if (!c || !c.alive || c.hp <= 0) throw new u.ApiError('Вы выбыли из боя');
  if (c.direction === null) throw new u.ApiError('Сначала выберите направление');

  const cdLeft = Math.ceil((c.lastActionAt + ACTION_CD_MS - now()) / 1000);
  if (cdLeft > 0) throw new u.ApiError(`Подождите ещё ${cdLeft} сек`);

  const stunned = (c.statusEffects || []).find(e => e.type === 'stun' && e.expiresAt > now());
  if (stunned) throw new u.ApiError(`Оглушены ещё ${Math.ceil((stunned.expiresAt - now()) / 1000)} сек`);

  const tc = findCombatant(battle, targetUserId);
  if (!tc || !tc.alive || tc.hp <= 0) throw new u.ApiError('Цель уже выбыла');
  if (tc.side === c.side) throw new u.ApiError('Нельзя атаковать союзника');
  if (tc.direction !== c.direction) throw new u.ApiError('Цель на другом направлении');

  const users = allUsers();
  const targetUser = users[targetUserId];
  if (!targetUser) throw new u.ApiError('Игрок не найден');

  const { dmg, crit } = calcDamage(c, tc, user, targetUser);
  const { actual, shieldAbsorbed } = applyDamage(battle, targetUserId, dmg, user.id);

  c.lastActionAt = now();
  c.stats.dmgDealt += actual;
  tc.stats.dmgTaken += actual;

  // Очки активности атакующему
  addActivity(battle, user.id, 'attack_hit');

  let msg = `⚔️ ${user.name} → ${tc.name} [${DIR_NAMES[c.direction-1]}]: ${actual} урона`;
  if (shieldAbsorbed > 0) msg += ` (щит −${shieldAbsorbed})`;
  if (crit) msg += ' 💥 КРИТ!';

  if (tc.hp <= 0) {
    tc.alive = false;
    c.stats.kills++;
    addActivity(battle, user.id, 'kill');
    msg += ` 💀 ${tc.name} ВЫБЫЛ!`;
    // Оставляем 1 HP в профиле
    const deadUser = users[targetUserId];
    if (deadUser) deadUser.res.hp.cur = 1;
  }

  log(battle, msg, crit ? 'crit' : 'attack');
  checkBattleEnd(battle, l, legions(), users);
  db.save('legions');

  notices.push(msg);
  return { dmg: actual, crit, targetHp: tc.hp, targetAlive: tc.alive };
}

// ───────────────────────────────────────────────────────────────────
// Лечение (только медик)
// ───────────────────────────────────────────────────────────────────
function heal(user, targetUserId, notices) {
  player.refresh(user);
  const l = legions()[user.legionId];
  if (!l || !l.activeBattle) throw new u.ApiError('Нет активного боя');
  const battle = l.activeBattle;
  if (battle.phase !== 'active') throw new u.ApiError('Бой ещё не начался');

  const c = findCombatant(battle, user.id);
  if (!c || !c.alive) throw new u.ApiError('Вы выбыли');
  if (c.role !== 'medic') throw new u.ApiError('Только медики могут лечить');
  if (c.direction === null) throw new u.ApiError('Сначала выберите направление');

  const cdLeft = Math.ceil((c.lastActionAt + ACTION_CD_MS - now()) / 1000);
  if (cdLeft > 0) throw new u.ApiError(`Подождите ещё ${cdLeft} сек`);

  const stunned = (c.statusEffects || []).find(e => e.type === 'stun' && e.expiresAt > now());
  if (stunned) throw new u.ApiError(`Оглушены ещё ${Math.ceil((stunned.expiresAt - now()) / 1000)} сек`);

  const enCost = u.rnd(20, 30);
  if (user.res.en.cur < enCost) throw new u.ApiError(`Нужно энергии: ${enCost}, есть ${Math.floor(user.res.en.cur)}`);

  const tc = findCombatant(battle, targetUserId);
  if (!tc || !tc.alive) throw new u.ApiError('Цель выбыла');
  if (tc.side !== c.side) throw new u.ApiError('Нельзя лечить врага');
  if (tc.direction !== c.direction) throw new u.ApiError('Цель на другом направлении');

  // Блок лечения
  const blocked = (tc.statusEffects || []).find(e => e.type === 'no_heal' && e.expiresAt > now());
  if (blocked) throw new u.ApiError(`Лечение цели заблокировано (${Math.ceil((blocked.expiresAt - now()) / 1000)} сек)`);

  const critHealChance = Math.min(0.50, user.skills.agility * 0.005 * 0.5);
  const critHeal = Math.random() < critHealChance;
  const healAmt = critHeal ? u.rnd(100, 330) : u.rnd(20, 40);

  const before = tc.hp;
  tc.hp = Math.min(tc.maxHp, tc.hp + healAmt);
  const actual = tc.hp - before;

  user.res.en.cur = Math.max(0, user.res.en.cur - enCost);
  c.lastActionAt = now();
  c.stats.healed += actual;

  addActivity(battle, user.id, 'heal_done');

  // Синхронизируем HP цели в профиле
  const targetUser = allUsers()[targetUserId];
  if (targetUser) {
    targetUser.res.hp.cur = Math.min(player.maxima(targetUser).hp, targetUser.res.hp.cur + actual);
  }

  const msg = `💊 ${user.name} → ${tc.name}: +${actual} HP${critHeal ? ' ✨ КРИТ!' : ''}`;
  log(battle, msg, critHeal ? 'crit' : 'heal');
  db.save('legions');

  notices.push(msg);
  return { healed: actual, critHeal, targetHp: tc.hp, enLeft: user.res.en.cur };
}

// ───────────────────────────────────────────────────────────────────
// Прикрытие (только защитник)
// ───────────────────────────────────────────────────────────────────
function guard(user, targetUserId, notices) {
  player.refresh(user);
  const l = legions()[user.legionId];
  if (!l || !l.activeBattle) throw new u.ApiError('Нет активного боя');
  const battle = l.activeBattle;
  if (battle.phase !== 'active') throw new u.ApiError('Бой ещё не начался');

  const c = findCombatant(battle, user.id);
  if (!c || !c.alive) throw new u.ApiError('Вы выбыли');
  if (c.role !== 'guardian') throw new u.ApiError('Только защитники могут прикрывать');
  if (targetUserId === user.id) throw new u.ApiError('Нельзя прикрывать себя');

  const cdLeft = Math.ceil((c.lastActionAt + ACTION_CD_MS - now()) / 1000);
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
  db.save('legions');

  notices.push(msg);
  return { guardedUntil: battle.guardExpiry[user.id] };
}

// ───────────────────────────────────────────────────────────────────
// Применение предмета
// ───────────────────────────────────────────────────────────────────
function useItem(user, itemId, targetUserId, notices) {
  player.refresh(user);
  const l = legions()[user.legionId];
  if (!l || !l.activeBattle) throw new u.ApiError('Нет активного боя');
  const battle = l.activeBattle;
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

  switch (item.effect.type) {
    case 'no_heal':
      if (!tc) throw new u.ApiError('Укажите цель');
      if (tc.side === c.side) throw new u.ApiError('Только на врагов');
      tc.statusEffects = tc.statusEffects || [];
      tc.statusEffects.push({ type: 'no_heal', expiresAt: now() + item.effect.duration * 1000 });
      resultMsg = `💨 ${user.name}: Газовая шашка → ${tc.name}! Лечение заблокировано ${item.effect.duration} сек`;
      break;

    case 'stun':
      if (!tc) throw new u.ApiError('Укажите цель');
      if (tc.side === c.side) throw new u.ApiError('Только на врагов');
      tc.statusEffects = tc.statusEffects || [];
      tc.statusEffects.push({ type: 'stun', expiresAt: now() + item.effect.duration * 1000 });
      resultMsg = `💥 ${user.name}: Светошумовая → ${tc.name}! Оглушён ${item.effect.duration} сек`;
      break;

    case 'damage_pct': {
      if (!tc) throw new u.ApiError('Укажите цель');
      if (tc.side === c.side) throw new u.ApiError('Только на врагов');
      const tUser = allUsers()[targetUserId];
      const basePow = player.totalPower(user, 'atk').power;
      const dmg = Math.round(basePow * item.effect.pct / 100);
      const { actual } = applyDamage(battle, targetUserId, dmg, user.id);
      c.stats.dmgDealt += actual;
      if (tc.hp <= 0) { tc.alive = false; c.stats.kills++; addActivity(battle, user.id, 'kill'); }
      resultMsg = `🔴 ${user.name}: Граната → ${tc.name}: ${actual} урона!`;
      break;
    }

    case 'dot_aoe': {
      if (c.direction === null) throw new u.ApiError('Выберите направление');
      const enemies = Object.values(battle.combatants).filter(x =>
        x.side !== c.side && x.direction === c.direction && x.alive);
      for (const en of enemies) {
        en.statusEffects = en.statusEffects || [];
        en.statusEffects.push({
          type: 'dot', tickPct: item.effect.tickPct,
          tickInterval: item.effect.tickInterval * 1000,
          expiresAt: now() + item.effect.duration * 1000,
          nextTickAt: now() + item.effect.tickInterval * 1000,
          sourceId: user.id,
        });
      }
      resultMsg = `🔥 ${user.name}: Напалм! ${enemies.length} врагов горят`;
      break;
    }

    case 'dmg_boost':
      c.statusEffects = c.statusEffects || [];
      c.statusEffects.push({ type: 'dmg_boost', bonus: item.effect.bonus, expiresAt: now() + item.effect.duration * 1000 });
      resultMsg = `☢️ ${user.name}: Урановые боеприпасы! +${item.effect.bonus}% урона ${item.effect.duration} сек`;
      break;

    case 'aoe_true_dmg': {
      if (c.direction === null) throw new u.ApiError('Выберите направление');
      const enemies = Object.values(battle.combatants).filter(x =>
        x.side !== c.side && x.direction === c.direction && x.alive);
      const msgs = [];
      for (const en of enemies) {
        const pct = u.rnd(item.effect.minPct, item.effect.maxPct);
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
      const pct = u.rnd(item.effect.minPct, item.effect.maxPct);
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
      c.statusEffects.push({ type: 'immunity', expiresAt: now() + item.effect.duration * 1000 });
      resultMsg = `🔵 ${user.name}: Защитный купол! Иммунитет ${item.effect.duration} сек`;
      break;

    case 'restore_shield':
      if (c.role !== 'guardian') throw new u.ApiError('Только для Защитника');
      const maxShield = user.res.en.cur;
      const pct2 = u.rnd(item.effect.minPct, item.effect.maxPct);
      const restored = Math.round(maxShield * pct2 / 100);
      c.shield = Math.min(maxShield, (c.shield || 0) + restored);
      resultMsg = `🦺 ${user.name}: Бронеплиты! Щит +${restored} (${pct2}%)`;
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
  c.lastItemAt = now();
  c.stats.itemsUsed++;
  addActivity(battle, user.id, 'item_used');

  log(battle, resultMsg, 'item');
  checkBattleEnd(battle, l, legions(), allUsers());
  db.save('legions');

  notices.push(resultMsg);
  return { ok: true, gearLeft: c.gear };
}

// ───────────────────────────────────────────────────────────────────
// Тик DoT-эффектов (вызывается из resolveWars каждые 30 сек)
// ───────────────────────────────────────────────────────────────────
function tickEffects(battle) {
  const t = now();
  for (const c of Object.values(battle.combatants)) {
    if (!c.alive) continue;
    c.statusEffects = (c.statusEffects || []).filter(e => e.expiresAt > t);
    for (const e of c.statusEffects) {
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
function calcActivityScores(battle) {
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

function buildFinalReport(battle, winningSide) {
  const { scores, details } = calcActivityScores(battle);
  const combatants = Object.values(details);

  // Топ по ролям (из обоих кланов)
  const byRole = (role) => combatants
    .filter(x => x.role === role)
    .sort((a, b) => {
      if (role === 'medic')    return b.stats.healed   - a.stats.healed;
      if (role === 'guardian') return b.stats.guards   - a.stats.guards;
      return b.stats.dmgDealt - a.stats.dmgDealt;
    });

  const topMedic    = byRole('medic')[0]    || null;
  const topGuardian = byRole('guardian')[0] || null;
  const topAssault  = byRole('assault')[0]  || null;

  return {
    winningSide,
    activityScores: scores,
    playerDetails: details,
    topMedic,
    topGuardian,
    topAssault,
  };
}

// ───────────────────────────────────────────────────────────────────
// Проверка и завершение боя
// ───────────────────────────────────────────────────────────────────
function checkBattleEnd(battle, l, all, users) {
  if (battle.phase !== 'active') return;

  const aliveA = Object.values(battle.combatants).filter(c => c.side === 'A' && c.alive).length;
  const aliveB = Object.values(battle.combatants).filter(c => c.side === 'B' && c.alive).length;

  if (aliveA === 0 || aliveB === 0) {
    finalizeBattle(battle, l, all, users, aliveA > 0 ? 'A' : 'B', 'elimination');
  }
}

function finalizeBattle(battle, l, all, users, winningSide, reason) {
  battle.phase = 'done';
  battle.finishedAt = now();
  battle.winningSide = winningSide;
  battle.finishReason = reason || 'time';

  // Определяем легионы A и B
  const legionA = all[battle.legionA];
  const legionB = all[battle.legionB];
  if (!legionA || !legionB) return;

  const winner = winningSide === 'A' ? legionA : legionB;
  const loser  = winningSide === 'A' ? legionB : legionA;

  // Слава
  const gloryGain = u.rnd(1, 2);
  const gloryLoss = u.rnd(1, 2);
  const wResult = addGlory(winner, +gloryGain);
  addGlory(loser,  -gloryLoss);

  // Экономика
  const loot = Math.floor((loser.kmarks || 0) * 0.20);
  loser.kmarks  = Math.max(0, (loser.kmarks || 0) - loot);
  winner.kmarks = (winner.kmarks || 0) + loot + config.LEGION.BATTLE_LOOT_KMARKS;
  winner.ratingPoints = (winner.ratingPoints || 0) + 10;
  loser.ratingPoints  = Math.max(0, (loser.ratingPoints || 0) - 3);

  // Итоговый отчёт
  const report = buildFinalReport(battle, winningSide);
  battle.finalReport = report;

  // XP и уведомления
  for (const c of Object.values(battle.combatants)) {
    const u2 = users[c.userId];
    if (!u2) continue;
    const won = c.side === winningSide;
    player.addXp(u2, won ? config.LEGION.BATTLE_XP_WIN : config.LEGION.BATTLE_XP_LOSS, []);
    const lootText = won
      ? `+${u.fmt(loot)} РЕЗ из казны врага + бонус ${u.fmt(config.LEGION.BATTLE_LOOT_RESERVES || 0)} РЕЗ`
      : `−${u.fmt(loot)} РЕЗ из казны`;
    notif.push(c.userId, 'legion_battle_result',
      won
        ? `🏆 Победа легиона! +${gloryGain} ⭐, ${lootText}. ${wResult.levelUp ? '🎉 Новый уровень легиона!' : ''}`
        : `💀 Поражение легиона. −${gloryLoss} ⭐, ${lootText}.`,
      { won, loot: won ? loot : -loot, report });
  }

  // Очищаем бой из обоих легионов
  legionA.activeBattle = null;
  legionB.activeBattle = null;
  // Сохраняем историю
  const hist = { at: now(), enemyId: loser.id, won: winner === legionA, loot, gloryGain, gloryLoss };
  legionA.battleHistory = (legionA.battleHistory || []).concat(hist).slice(-20);
  legionB.battleHistory = (legionB.battleHistory || []).concat({ ...hist, enemyId: legionA.id, won: winner === legionB }).slice(-20);
}

// ───────────────────────────────────────────────────────────────────
// Тик: prep → active, таймер 1 час, завершение по времени
// ───────────────────────────────────────────────────────────────────
function startActivePhaseTick(l, all, users) {
  const battle = l.activeBattle;
  if (!battle) return;

  // Завершаем по истечении 1 часа
  if (battle.phase === 'active' && now() >= battle.activeEndsAt) {
    // Победа по очкам активности
    const { scores } = calcActivityScores(battle);
    const winningSide = (scores.A || 0) >= (scores.B || 0) ? 'A' : 'B';
    finalizeBattle(battle, l, all, users, winningSide, 'time');
    return;
  }

  if (battle.phase !== 'prep') return;
  if (now() < battle.prepEndsAt) return;

  // Убираем незарегистрированных / без направления
  for (const [uid, c] of Object.entries(battle.combatants)) {
    if (!c.direction) {
      delete battle.combatants[uid];
      const u2 = users[uid];
      if (u2) notif.push(uid, 'legion_battle_kicked', '⛔ Вы не выбрали направление — выбыли из боя легиона', {});
    }
  }

  const sideA = Object.values(battle.combatants).filter(c => c.side === 'A');
  const sideB = Object.values(battle.combatants).filter(c => c.side === 'B');

  if (sideA.length === 0 || sideB.length === 0) {
    const winner = sideA.length > 0 ? 'A' : 'B';
    finalizeBattle(battle, l, all, users, winner, 'no_show');
    return;
  }

  battle.phase = 'active';
  battle.activeStartAt = now();
  battle.activeEndsAt  = now() + BATTLE_MS;

  for (const c of Object.values(battle.combatants)) {
    notif.push(c.userId, 'legion_battle_active',
      `⚔️ Бой начался! Выбирайте цели на «${DIR_NAMES[c.direction-1]}».`, {
        activeEndsAt: battle.activeEndsAt,
      });
  }
}

// ───────────────────────────────────────────────────────────────────
// Состояние боя для клиента
// ───────────────────────────────────────────────────────────────────
function battleState(user) {
  const l = legions()[user.legionId];
  if (!l || !l.activeBattle) return { battle: null };
  const battle = l.activeBattle;

  const mySide = l.id === battle.legionA ? 'A' : 'B';
  const me = battle.combatants[user.id] || null;
  const t  = now();

  const directions = [];
  for (let d = 1; d <= DIRECTIONS; d++) {
    const allies  = Object.values(battle.combatants).filter(c => c.side === mySide && c.direction === d);
    const enemies = Object.values(battle.combatants).filter(c => c.side !== mySide && c.direction === d);
    directions.push({
      dir: d,
      name: DIR_NAMES[d-1],
      allies:  allies.map(c  => serializeCombatant(c, t, c.userId === user.id)),
      enemies: enemies.map(c => serializeCombatant(c, t, false)),
      allySlots: MAX_PER_DIR - allies.filter(c => c.alive).length,
    });
  }

  const allCombatants = Object.values(battle.combatants).map(c => ({
    userId: c.userId, name: c.name, side: c.side, role: c.role,
    ready: c.ready, hp: c.hp, maxHp: c.maxHp, direction: c.direction,
    alive: c.alive, dirName: c.direction ? DIR_NAMES[c.direction-1] : null,
  }));

  const myCDs = me ? {
    action: Math.max(0, Math.ceil((me.lastActionAt + ACTION_CD_MS - t) / 1000)),
    move:   Math.max(0, Math.ceil((me.lastMoveAt   + MOVE_CD_MS   - t) / 1000)),
    item:   Math.max(0, Math.ceil(((me.lastItemAt||0) + ITEM_CD_MS  - t) / 1000)),
  } : null;

  const timeLeft = battle.phase === 'active'
    ? Math.max(0, Math.floor((battle.activeEndsAt - t) / 1000))
    : null;

  // Текущие очки активности
  let liveScores = null;
  if (battle.phase === 'active') {
    const { scores } = calcActivityScores(battle);
    liveScores = scores;
  }

  return {
    battle: {
      id: battle.id,
      phase: battle.phase,
      prepEndsAt: battle.prepEndsAt,
      prepSecsLeft: Math.max(0, Math.floor((battle.prepEndsAt - t) / 1000)),
      activeEndsAt: battle.activeEndsAt,
      timeLeft,
      finishReason: battle.finishReason || null,
      winningSide: battle.winningSide || null,
      me: me ? serializeCombatant(me, t, true) : null,
      mySide,
      cooldowns: myCDs,
      directions,
      allCombatants,
      dirNames: DIR_NAMES,
      log: (battle.log || []).slice(-40),
      liveScores,
      finalReport: battle.finalReport || null,
    },
  };
}

function serializeCombatant(c, t, isSelf) {
  const fx = (type) => (c.statusEffects || []).filter(e => e.type === type && e.expiresAt > t);
  return {
    userId: c.userId, name: c.name,
    role: c.role, roleName: ROLES[c.role] ? ROLES[c.role].label : c.role,
    hp: c.hp, maxHp: c.maxHp, shield: c.shield || 0,
    alive: c.alive, ready: c.ready, direction: c.direction,
    dirName: c.direction ? DIR_NAMES[c.direction-1] : null,
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

// ── Выйти из боя (добровольно) ────────────────────────────────────
function leaveBattle(user, notices) {
  const l = legions()[user.legionId];
  if (!l || !l.activeBattle) throw new u.ApiError('Нет активного боя');
  const battle = l.activeBattle;
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
      const all = legions();
      const users = allUsers();
      finalizeBattle(battle, l, all, users, aliveA > 0 ? 'A' : 'B', 'elimination');
    }
  }

  db.save('legions');
  notices.push('🚪 Вы покинули бой. Ваша статистика не сохранена.');
  return { ok: true };
}

module.exports = {
  joinBattle, chooseDirection, attack, heal, guard, useItem, leaveBattle,
  battleState, tickEffects, startActivePhaseTick,
  ROLES, DIRECTIONS, DIR_NAMES, MAX_PER_DIR, PREP_MS, BATTLE_MS,
  ensureLegionGlory, addGlory, calcLegionLevel, GLORY_THRESHOLDS,
};
