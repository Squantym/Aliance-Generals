// ===================================================================
// src/services/legion.js — клан-функционал легиона:
//   - Казна (любой участник может донатить $)
//   - Клановые постройки (лидер строит из казны)
//   - Войны легион-на-легион (объявление, авторасчёт через час)
// Базовая логика участия (создать/вступить/покинуть) — в groups.js.
// ===================================================================

const config = require('../../config/gameConfig');
const db = require('../core/db');
const u = require('../core/utils');
const player = require('./player');
const social = require('./social');

function legions() { return db.load('legions', {}); }
function legionOf(user) { return user.legionId ? legions()[user.legionId] || null : null; }

// Цена следующего уровня клановой постройки
function nextBuildingPrice(building, level) {
  return Math.round(building.price * Math.pow(config.LEGION.BUILDING_PRICE_GROWTH, level));
}

// Суммарная боевая мощь легиона для кланвойн
//   Складываем атаку и защиту армий всех участников + бонус «Фортификации»
function legionWarPower(legion) {
  const users = player.users();
  let total = 0;
  for (const memberId of legion.members) {
    const m = users[memberId];
    if (!m) continue;
    player.refresh(m);
    const atk = player.buildArmy(m, 'atk').power;
    const def = player.buildArmy(m, 'def').power;
    total += atk + def;
  }
  // Бонус Фортификаций (war_def): +6% за уровень
  const wallLvl = (legion.buildings || {})['wall'] || 0;
  total *= 1 + wallLvl * 0.06;
  return Math.round(total);
}

// Просмотр легиона: пользовательский вид с расширенной инфой
function view(user) {
  const l = legionOf(user);
  if (!l) return { mine: null };

  // Подготовим список построек с актуальными ценами
  const buildings = config.LEGION_BUILDINGS.map((b) => {
    const lvl = (l.buildings || {})[b.id] || 0;
    return {
      id: b.id, name: b.name, desc: b.desc, level: lvl,
      maxLevel: config.LEGION.MAX_BUILDING_LEVEL,
      bonusNow: lvl * b.perLvl,
      bonusNext: lvl < config.LEGION.MAX_BUILDING_LEVEL ? (lvl + 1) * b.perLvl : null,
      nextPrice: lvl < config.LEGION.MAX_BUILDING_LEVEL ? nextBuildingPrice(b, lvl) : null,
    };
  });

  // Текущая война, если есть
  let warInfo = null;
  if (l.war) {
    const enemy = legions()[l.war.enemyId];
    const secLeft = Math.max(0, Math.floor((l.war.battleAt - Date.now()) / 1000));
    warInfo = {
      role: l.war.role,                          // 'attacker' | 'defender'
      enemyName: enemy ? enemy.name : '—',
      enemyId: l.war.enemyId,
      secondsLeft: secLeft,
      myPower: legionWarPower(l),
      enemyPower: enemy ? legionWarPower(enemy) : 0,
    };
  }

  // Список потенциальных целей: другие легионы вне cooldown
  const recent = (l.warHistory || []).filter((h) => Date.now() - h.at < config.LEGION.WAR_COOLDOWN_HOURS * 3600 * 1000);
  const cooldownIds = new Set(recent.map((h) => h.enemyId));
  const targets = Object.values(legions())
    .filter((x) => x.id !== l.id && !cooldownIds.has(x.id) && !x.war)
    .map((x) => ({ id: x.id, name: x.name, members: x.members.length }))
    .sort((a, b) => b.members - a.members)
    .slice(0, 20);

  return {
    mine: {
      id: l.id, name: l.name, leaderId: l.leaderId, isLeader: l.leaderId === user.id,
      members: l.members.length,
      treasury: l.treasury || 0,
      buildings,
      war: warInfo,
      canDeclareWar: !l.war && l.leaderId === user.id,
      targets,
    },
  };
}

// Любой участник вносит деньги в казну
function deposit(user, amount, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  amount = u.toInt(amount, 0);
  if (amount <= 0) throw new u.ApiError('Сумма должна быть положительной');
  if (user.dollars < amount) throw new u.ApiError('Не хватает денег');
  user.dollars -= amount;
  l.treasury = (l.treasury || 0) + amount;
  db.save('legions');
  notices.push(`Внесено в казну легиона: $${u.fmt(amount)}.`);
  return { treasury: l.treasury };
}

// Лидер прокачивает клановую постройку из казны
function build(user, buildingId, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  if (l.leaderId !== user.id) throw new u.ApiError('Строить может только лидер легиона');
  const b = config.LEGION_BUILDING_BY_ID[buildingId];
  if (!b) throw new u.ApiError('Неизвестная постройка');
  const lvl = (l.buildings || {})[b.id] || 0;
  if (lvl >= config.LEGION.MAX_BUILDING_LEVEL) throw new u.ApiError('Достигнут максимальный уровень');
  const cost = nextBuildingPrice(b, lvl);
  if ((l.treasury || 0) < cost) throw new u.ApiError(`В казне не хватает (нужно $${u.fmt(cost)})`);
  l.treasury -= cost;
  l.buildings = l.buildings || {};
  l.buildings[b.id] = lvl + 1;
  db.save('legions');
  notices.push(`🏛 «${b.name}» прокачана до ур. ${lvl + 1}!`);

  // Уведомление всем участникам
  const users = player.users();
  for (const memberId of l.members) {
    if (memberId !== user.id) {
      const m = users[memberId];
      if (m) social.systemMail(m, 'Развитие легиона',
        `Лидер «${l.name}» прокачал «${b.name}» до уровня ${lvl + 1}. Теперь бонус: +${(lvl + 1) * b.perLvl}%.`);
    }
  }
  return { buildingId: b.id, level: l.buildings[b.id] };
}

// Лидер объявляет войну другому легиону
function declareWar(user, enemyId, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  if (l.leaderId !== user.id) throw new u.ApiError('Объявлять войну может только лидер');
  if (l.war) throw new u.ApiError('У легиона уже идёт война');
  const enemy = legions()[enemyId];
  if (!enemy) throw new u.ApiError('Легион-цель не найден');
  if (enemy.id === l.id) throw new u.ApiError('Нельзя воевать с самим собой');
  if (enemy.war) throw new u.ApiError('Цель уже занята в войне');

  // Cooldown между атаками на один легион
  const recent = (l.warHistory || []).find((h) =>
    h.enemyId === enemy.id && Date.now() - h.at < config.LEGION.WAR_COOLDOWN_HOURS * 3600 * 1000);
  if (recent) throw new u.ApiError('Цель в перерыве после прошлой битвы');

  const battleAt = Date.now() + config.LEGION.WAR_PREPARE_HOURS * 3600 * 1000;
  l.war = { enemyId: enemy.id, role: 'attacker', battleAt };
  enemy.war = { enemyId: l.id, role: 'defender', battleAt };
  db.save('legions');
  notices.push(`⚔ Война объявлена! Битва через ${config.LEGION.WAR_PREPARE_HOURS} ч.`);

  // Уведомления участникам
  const users = player.users();
  const announce = (legion, msg) => {
    for (const memberId of legion.members) {
      const m = users[memberId];
      if (m) social.systemMail(m, 'Кланвойна!', msg);
    }
  };
  announce(l, `Ваш легион «${l.name}» объявил войну легиону «${enemy.name}». Битва произойдёт автоматически через ${config.LEGION.WAR_PREPARE_HOURS} ч.`);
  announce(enemy, `Легион «${l.name}» объявил вам войну! Битва произойдёт автоматически через ${config.LEGION.WAR_PREPARE_HOURS} ч. Сплотитесь — оборона решит исход.`);

  return { battleAt };
}

// Разрешение войн: вызывается тикером раз в N секунд
function resolveWars() {
  const now = Date.now();
  const all = legions();
  // Чтобы не разрешать одну и ту же войну дважды (с обеих сторон),
  // пройдёмся по «атакующим»
  const processed = new Set();
  for (const l of Object.values(all)) {
    if (!l.war || processed.has(l.id)) continue;
    if (l.war.role !== 'attacker') continue;
    if (l.war.battleAt > now) continue;

    const enemy = all[l.war.enemyId];
    if (!enemy) { l.war = null; continue; }

    processed.add(l.id);
    processed.add(enemy.id);

    const aPow = legionWarPower(l);
    const dPow = legionWarPower(enemy);
    // Небольшая случайность ±10%
    const aRoll = aPow * (0.9 + Math.random() * 0.2);
    const dRoll = dPow * (0.9 + Math.random() * 0.2);
    const aWin = aRoll >= dRoll;

    const winner = aWin ? l : enemy;
    const loser  = aWin ? enemy : l;
    const loot = Math.floor((loser.treasury || 0) * config.LEGION.WAR_LOOT_PCT);
    loser.treasury = (loser.treasury || 0) - loot;
    winner.treasury = (winner.treasury || 0) + loot;

    // Опыт и почта всем участникам
    const users = player.users();
    const notify = (legion, msg, xp) => {
      for (const memberId of legion.members) {
        const m = users[memberId];
        if (!m) continue;
        if (xp > 0) player.addXp(m, xp, []);
        social.systemMail(m, 'Итог кланвойны', msg);
      }
    };
    const msgWin = `Победа! «${winner.name}» разгромил «${loser.name}». Трофеи: $${u.fmt(loot)} в казну.`;
    const msgLose = `Поражение. «${loser.name}» уступил «${winner.name}». Утрачено: $${u.fmt(loot)} из казны.`;
    notify(winner, msgWin, config.LEGION.WAR_XP_WIN);
    notify(loser,  msgLose, config.LEGION.WAR_XP_LOSS);

    // История + сброс войны
    const history = { at: now, enemyId: enemy.id, won: aWin, loot: aWin ? loot : -loot };
    l.warHistory = (l.warHistory || []).concat(history).slice(-20);
    enemy.warHistory = (enemy.warHistory || []).concat({ ...history, enemyId: l.id, won: !aWin, loot: aWin ? -loot : loot }).slice(-20);
    l.war = null;
    enemy.war = null;
  }
  db.save('legions');
}

module.exports = { view, deposit, build, declareWar, resolveWars };
