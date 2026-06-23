// ===================================================================
// src/services/legion.js — Легион (клан): казна, постройки, войны,
//   боевые вызовы, клановая валюта, боевые постройки, технологии,
//   арсенал, магазин.
// ===================================================================

const config = require('../../config/gameConfig');
const db     = require('../core/db');
const u      = require('../core/utils');
const player = require('./player');
const social = require('./social');
const notif  = require('./notifications');

// ---------- Хелперы доступа к данным ----------
function legions()   { return db.load('legions', {}); }
function legionOf(user) { return user.legionId ? legions()[user.legionId] || null : null; }

// Убедиться, что у легиона есть все новые поля
function ensureLegionFields(l) {
  if (!l.reserves)           l.reserves = 0;
  if (!l.battleBuildings)    l.battleBuildings = {};
  if (!l.techs)              l.techs = {};
  if (!l.techQueue)          l.techQueue = null;
  if (!l.arsenal)            l.arsenal = {};
  if (!l.ratingPoints)       l.ratingPoints = 0;
  if (!l.pendingChallenge)   l.pendingChallenge = null;
  if (!l.activeBattle)       l.activeBattle = null;
  if (!l.battleHistory)      l.battleHistory = [];
  if (!l.treasuryEars)       l.treasuryEars   = 0;
  if (!l.treasuryTokens)     l.treasuryTokens = 0;
  if (!l.memberRanks)        l.memberRanks = {};
  if (!l.battleStats)        l.battleStats = { wins: 0, losses: 0 };
  if (!l.chat)               l.chat = [];
  const lb = require('./legionBattle');
  lb.ensureLegionGlory(l);
  return l;
}

// ---------- Цена следующего уровня (старые постройки, $) ----------
function nextBuildingPrice(building, level) {
  return Math.round(building.price * Math.pow(config.LEGION.BUILDING_PRICE_GROWTH, level));
}

// ---------- Цена постройки/улучшения боевой постройки ($) ----------
function battleBuildingCost(b, currentLevel) {
  // currentLevel=0 → строим первый раз (dollarCost)
  // currentLevel>0 → улучшаем (dollarCost × priceGrowth^currentLevel)
  const growth = b.priceGrowth || 2;
  const dollars = Math.round(b.dollarCost * Math.pow(growth, currentLevel));

  let ears = 0, tokens = 0;
  // Уши/жетоны требуются только при улучшении (currentLevel > 0)
  if (currentLevel > 0) {
    if (b.resource === 'ear' || b.resource === 'both') {
      ears = Math.round(b.earBase * Math.pow(b.earGrowth, currentLevel - 1));
    }
    if (b.resource === 'token' || b.resource === 'both') {
      tokens = Math.round(b.tokenBase * Math.pow(b.tokenGrowth, currentLevel - 1));
    }
  }
  return { dollars, ears, tokens };
}

// ---------- Время изучения технологии (мс) ----------
function techDurationMs(tech, level) {
  const days = tech.levels[level - 1].daysBase;
  return Math.round(days * 24 * 3600 * 1000);
}

// ===================================================================
// СУММАРНАЯ БОЕВАЯ МОЩЬ ЛЕГИОНА (для старых кланвойн)
// ===================================================================
function legionWarPower(legion) {
  const users = player.users();
  let total = 0;
  for (const memberId of legion.members) {
    const m = users[memberId];
    if (!m) continue;
    player.refresh(m);
    total += player.buildArmy(m, 'atk').power + player.buildArmy(m, 'def').power;
  }
  const wallLvl = (legion.buildings || {})['wall'] || 0;
  total *= 1 + wallLvl * 0.06;
  return Math.round(total);
}

// ===================================================================
// VIEW — полная информация о легионе игрока
// ===================================================================
function view(user) {
  const l = legionOf(user);
  if (!l) return { mine: null };
  ensureLegionFields(l);

  const isLeader = l.leaderId === user.id;

  // Старые постройки
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

  // Боевые постройки
  const battleBuildings = config.LEGION_BATTLE_BUILDINGS.map((b) => {
    const lvl = (l.battleBuildings || {})[b.id] || 0;
    const cost = lvl < b.maxLevel ? battleBuildingCost(b, lvl) : null;
    return {
      id: b.id, name: b.name, desc: b.desc, level: lvl,
      maxLevel: b.maxLevel, apply: b.apply, perLvl: b.perLvl,
      bonusNow: lvl * b.perLvl, resource: b.resource,
      bonusNext: lvl < b.maxLevel ? (lvl + 1) * b.perLvl : null,
      nextCost: cost,
    };
  });

  // Технологии
  const techs = config.LEGION_TECHS.map((t) => {
    const lvl = (l.techs || {})[t.id] || 0;
    const nextLevelData = lvl < t.maxLevel ? t.levels[lvl] : null;
    const inQueue = l.techQueue && l.techQueue.techId === t.id;
    const queueFinishAt = inQueue ? l.techQueue.finishAt : null;
    const canLearn = nextLevelData && (l.gloryEarned || 0) >= (nextLevelData.gloryReq || 0) && !l.techQueue;
    return {
      id: t.id, name: t.name, desc: t.desc, branch: t.branch,
      level: lvl, maxLevel: t.maxLevel, bonusPerLvl: t.bonusPerLvl, bonusUnit: t.bonusUnit,
      bonusNow: lvl * t.bonusPerLvl, apply: t.apply,
      nextLevelData, inQueue, queueFinishAt, canLearn: isLeader && canLearn,
    };
  });

  // Текущая война (старая система)
  let warInfo = null;
  if (l.war) {
    const enemy = legions()[l.war.enemyId];
    const secLeft = Math.max(0, Math.floor((l.war.battleAt - Date.now()) / 1000));
    warInfo = {
      role: l.war.role,
      enemyName: enemy ? enemy.name : '—',
      enemyId: l.war.enemyId,
      secondsLeft: secLeft,
      myPower: legionWarPower(l),
      enemyPower: enemy ? legionWarPower(enemy) : 0,
    };
  }

  // Вызов на бой (новая система)
  let challengeInfo = null;
  if (l.pendingChallenge) {
    const ch = l.pendingChallenge;
    const msLeft = ch.expiresAt - Date.now();
    if (msLeft > 0) {
      const enemyLegion = legions()[ch.enemyId];
      challengeInfo = {
        role: ch.role, // 'challenger' | 'challenged'
        enemyId: ch.enemyId,
        enemyName: enemyLegion ? enemyLegion.name : '—',
        secondsLeft: Math.floor(msLeft / 1000),
        expiresAt: ch.expiresAt,
        canAccept: isLeader && ch.role === 'challenged',
      };
    } else {
      // Истёкший вызов — чистим
      l.pendingChallenge = null;
      db.save('legions');
    }
  }

  // Активный бой
  let activeBattleInfo = null;
  if (l.activeBattle) {
    activeBattleInfo = {
      enemyId: l.activeBattle.enemyId,
      startedAt: l.activeBattle.startedAt,
      phase: l.activeBattle.phase,
    };
  }

  // Арсенал
  const arsenal = config.LEGION_SHOP_ITEMS.map((item) => ({
    ...item,
    count: (l.arsenal || {})[item.id] || 0,
  }));

  // Список целей
  const recent = (l.warHistory || []).filter(h => Date.now() - h.at < config.LEGION.WAR_COOLDOWN_HOURS * 3600000);
  const cooldownIds = new Set(recent.map(h => h.enemyId));
  const targets = Object.values(legions())
    .filter(x => x.id !== l.id && !cooldownIds.has(x.id) && !x.war)
    .map(x => ({ id: x.id, name: x.name, members: x.members.length }))
    .sort((a, b) => b.members - a.members)
    .slice(0, 20);

  return {
    mine: {
      id: l.id, name: l.name, leaderId: l.leaderId, isLeader,
      members: l.members.length,
      treasury: l.treasury || 0,
      reserves: l.reserves,
      treasuryEars:   l.treasuryEars   || 0,
      treasuryTokens: l.treasuryTokens || 0,
      ratingPoints: l.ratingPoints,
      gloryPoints:  l.gloryPoints  || 0,
      gloryEarned:  l.gloryEarned  || 0,
      legionLevel:  l.legionLevel  || 1,
      gloryNextLevel: require('./legionBattle').GLORY_THRESHOLDS[Math.min((l.legionLevel||1), require('./legionBattle').GLORY_THRESHOLDS.length-1)] || null,
      buildings,
      battleBuildings,
      techs,
      techQueue: l.techQueue,
      arsenal,
      war: warInfo,
      challenge: challengeInfo,
      activeBattle: activeBattleInfo,
      canDeclareWar: !l.war && isLeader,
      canChallenge: isLeader && !l.pendingChallenge && !l.activeBattle,
      myRank: getMemberRank(l, user.id),
      myRankName: config.LEGION.RANKS[getMemberRank(l, user.id)],
      memberLimit: memberLimit(l),
      battleStats: l.battleStats || { wins: 0, losses: 0 },
      targets,
      battleHistory: (l.battleHistory || []).slice(-10).reverse(),
      membersWithRanks: (() => {
        const users = player.users();
        return (l.members || []).map(id => {
          const u2 = users[id];
          const rank = getMemberRank(l, id);
          return u2 ? { id: u2.id, name: u2.name, flag: player.flag(u2), level: u2.level, rank, rankName: config.LEGION.RANKS[rank] } : null;
        }).filter(Boolean).sort((a, b) => b.rank - a.rank || b.level - a.level);
      })(),
    },
  };
}

// ===================================================================
// КАЗНА: пополнение
// ===================================================================
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

// ===================================================================
// ОБМЕН ДОЛЛАРОВ НА КЛАНМАРКИ (Резервные марки)
// 1 000 $ = 1 РЕЗ. Обменивает из личного кошелька в казну легиона.
// ===================================================================
function exchangeToReserves(user, dollars, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  ensureLegionFields(l);
  const amt = u.toInt(dollars, 0);
  if (amt <= 0) throw new u.ApiError('Укажите сумму обмена');
  if (amt % config.LEGION.RESERVE_EXCHANGE_RATE !== 0) {
    throw new u.ApiError(`Сумма должна быть кратна ${u.fmt(config.LEGION.RESERVE_EXCHANGE_RATE)} (1 РЕЗ)`);
  }
  if (user.dollars < amt) throw new u.ApiError('Не хватает долларов');
  const km = amt / config.LEGION.RESERVE_EXCHANGE_RATE;
  user.dollars -= amt;
  l.reserves += km;
  db.save('legions');
  notices.push(`💱 Обменяно: $${u.fmt(amt)} → ${u.fmt(km)} РЕЗ. В казне легиона: ${u.fmt(l.reserves)} РЕЗ.`);
  return { reserves: l.reserves };
}

// ===================================================================
// СТАРЫЕ ПОСТРОЙКИ ($ из казны)
// ===================================================================
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

  const users = player.users();
  for (const memberId of l.members) {
    if (memberId !== user.id) {
      const m = users[memberId];
      if (m) social.systemMail(m, 'Развитие легиона',
        `Лидер «${l.name}» прокачал «${b.name}» до уровня ${lvl + 1}.`);
    }
  }
  return { buildingId: b.id, level: l.buildings[b.id] };
}

// ===================================================================
// БОЕВЫЕ ПОСТРОЙКИ (РЕЗ + уши/жетоны из казначейства)
// ===================================================================
function buildBattle(user, buildingId, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  if (l.leaderId !== user.id) throw new u.ApiError('Строить может только лидер легиона');
  ensureLegionFields(l);

  const b = config.LEGION_BATTLE_BUILDING_BY_ID[buildingId];
  if (!b) throw new u.ApiError('Неизвестная боевая постройка');
  const lvl = (l.battleBuildings || {})[b.id] || 0;
  if (lvl >= b.maxLevel) throw new u.ApiError('Достигнут максимальный уровень');

  const cost = battleBuildingCost(b, lvl);

  if ((l.treasury || 0) < cost.dollars) {
    throw new u.ApiError(`Не хватает денег в казне (нужно $${u.fmt(cost.dollars)}, есть $${u.fmt(l.treasury || 0)})`);
  }
  if (cost.ears > 0 && (l.treasuryEars || 0) < cost.ears) {
    throw new u.ApiError(`В казначействе не хватает ушей (нужно ${cost.ears}, есть ${l.treasuryEars || 0})`);
  }
  if (cost.tokens > 0 && (l.treasuryTokens || 0) < cost.tokens) {
    throw new u.ApiError(`В казначействе не хватает жетонов (нужно ${cost.tokens}, есть ${l.treasuryTokens || 0})`);
  }

  l.treasury = (l.treasury || 0) - cost.dollars;
  if (cost.ears > 0)   l.treasuryEars   -= cost.ears;
  if (cost.tokens > 0) l.treasuryTokens -= cost.tokens;

  l.battleBuildings[b.id] = lvl + 1;
  db.save('legions');

  const newLvl = lvl + 1;
  const verb = lvl === 0 ? 'Построена' : `Улучшена до ур. ${newLvl}`;
  notices.push(`🏗 «${b.name}» ${verb}! Бонус: ${newLvl * b.perLvl}%.`);

  const users = player.users();
  for (const memberId of l.members) {
    if (memberId !== user.id) {
      const m = users[memberId];
      if (m) notif.push(m.id, 'legion_build', `🏗 «${b.name}» ${verb} в легионе`, { buildingName: b.name, level: newLvl });
    }
  }
  return { buildingId: b.id, level: newLvl };
}


// ===================================================================
// ТЕХНОЛОГИИ: начать изучение
// ===================================================================
function startTech(user, techId, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  if (l.leaderId !== user.id) throw new u.ApiError('Изучать технологии может только лидер');
  ensureLegionFields(l);

  if (l.techQueue) throw new u.ApiError('Уже идёт изучение технологии');

  const tech = config.LEGION_TECH_BY_ID[techId];
  if (!tech) throw new u.ApiError('Неизвестная технология');

  const lvl = (l.techs || {})[techId] || 0;
  if (lvl >= tech.maxLevel) throw new u.ApiError('Технология уже на максимальном уровне');

  const levelData = tech.levels[lvl];

  // Требования рейтинга
  if ((l.gloryEarned || 0) < (levelData.gloryReq || 0)) {
    throw new u.ApiError(`Нужно ${levelData.gloryReq} ⭐ славы легиона (есть ${l.gloryEarned || 0})`);
  }
  // РЕЗ
  if (l.reserves < levelData.priceReserves) {
    throw new u.ApiError(`Не хватает РЕЗ (нужно ${u.fmt(levelData.priceReserves)}, есть ${u.fmt(l.reserves)})`);
  }
  // Уши лидера
  if ((user.earsCurrent || 0) < levelData.earReq) {
    throw new u.ApiError(`Не хватает ушей (нужно ${levelData.earReq}, есть ${user.earsCurrent || 0})`);
  }

  // Списываем
  l.reserves -= levelData.priceReserves;
  user.earsCurrent -= levelData.earReq;

  const durationMs = techDurationMs(tech, lvl + 1);
  l.techQueue = {
    techId,
    targetLevel: lvl + 1,
    startedAt: Date.now(),
    finishAt: Date.now() + durationMs,
  };
  db.save('legions');

  const days = (durationMs / 86400000).toFixed(1);
  notices.push(`🔬 Изучение «${tech.name}» ур. ${lvl + 1} начато! Завершится через ${days} дн.`);
  return { techId, targetLevel: lvl + 1, finishAt: l.techQueue.finishAt };
}

// ===================================================================
// ТЕХНОЛОГИИ: получить завершённое изучение (тик)
// ===================================================================
function resolveTechQueue() {
  const all = legions();
  let changed = false;
  for (const l of Object.values(all)) {
    if (!l.techQueue) continue;
    if (Date.now() < l.techQueue.finishAt) continue;
    // Исследование завершено
    const q = l.techQueue;
    l.techs = l.techs || {};
    l.techs[q.techId] = q.targetLevel;
    l.techQueue = null;
    changed = true;

    const tech = config.LEGION_TECH_BY_ID[q.techId];
    const users = player.users();
    for (const memberId of l.members) {
      const m = users[memberId];
      if (m) {
        notif.push(m.id, 'legion_tech',
          `🔬 Технология завершена: «${tech ? tech.name : q.techId}» ур. ${q.targetLevel}`,
          { techId: q.techId, level: q.targetLevel });
      }
    }
  }
  if (changed) db.save('legions');
}

// ===================================================================
// МАГАЗИН: лидер покупает предметы в арсенал
// ===================================================================
// КАЗНАЧЕЙСТВО: лидер или любой участник вносит уши/жетоны в казну клана
// ===================================================================
function depositResources(user, ears, tokens, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  ensureLegionFields(l);
  ears   = u.toInt(ears, 0);
  tokens = u.toInt(tokens, 0);
  if (ears <= 0 && tokens <= 0) throw new u.ApiError('Укажите количество ушей или жетонов');
  if (ears   > 0 && (user.earsCurrent || 0) < ears)   throw new u.ApiError(`Не хватает ушей (нужно ${ears}, есть ${user.earsCurrent || 0})`);
  if (tokens > 0 && (user.tokens || 0)      < tokens) throw new u.ApiError(`Не хватает жетонов (нужно ${tokens}, есть ${user.tokens || 0})`);
  if (ears   > 0) { user.earsCurrent -= ears;   l.treasuryEars   += ears; }
  if (tokens > 0) { user.tokens = (user.tokens||0) - tokens; l.treasuryTokens += tokens; }
  db.save('legions');
  const parts = [];
  if (ears   > 0) parts.push(`${ears} 👂`);
  if (tokens > 0) parts.push(`${tokens} 🎖`);
  notices.push(`✅ Внесено в казначейство: ${parts.join(' + ')}`);
  return { treasuryEars: l.treasuryEars, treasuryTokens: l.treasuryTokens };
}

// ===================================================================
// МАГАЗИН: лидер покупает предметы — ресурсы списываются из казначейства клана
// ===================================================================
function shopBuy(user, itemId, qty, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  if (l.leaderId !== user.id) throw new u.ApiError('Покупать в магазин может только лидер');
  ensureLegionFields(l);

  const item = config.LEGION_SHOP_ITEM_BY_ID[itemId];
  if (!item) throw new u.ApiError('Неизвестный предмет');

  qty = u.toInt(qty, 1);
  if (qty < 1) throw new u.ApiError('Количество должно быть ≥ 1');

  const totalEars   = (item.earCost   || 0) * qty;
  const totalTokens = (item.tokenCost || 0) * qty;

  // Ресурсы берутся из казначейства клана, не из личного кармана
  if (totalEars > 0 && (l.treasuryEars || 0) < totalEars) {
    throw new u.ApiError(`В казначействе не хватает ушей (нужно ${totalEars}, есть ${l.treasuryEars || 0})`);
  }
  if (totalTokens > 0 && (l.treasuryTokens || 0) < totalTokens) {
    throw new u.ApiError(`В казначействе не хватает жетонов (нужно ${totalTokens}, есть ${l.treasuryTokens || 0})`);
  }

  if (totalEars   > 0) l.treasuryEars   -= totalEars;
  if (totalTokens > 0) l.treasuryTokens -= totalTokens;

  l.arsenal[itemId] = (l.arsenal[itemId] || 0) + qty;
  db.save('legions');

  const costStr = totalEars > 0 ? `${totalEars} 👂 из казны` : `${totalTokens} 🎖 из казны`;
  notices.push(`🛒 Куплено: ${item.name} ×${qty} за ${costStr} → арсенал легиона.`);
  return { itemId, count: l.arsenal[itemId], treasuryEars: l.treasuryEars, treasuryTokens: l.treasuryTokens };
}

// ===================================================================
// АРСЕНАЛ: участник берёт предмет в боевой пояс
// ===================================================================
function gearPick(user, itemId, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  ensureLegionFields(l);

  if (!l.activeBattle) throw new u.ApiError('Нет активного боя легиона');

  const item = config.LEGION_SHOP_ITEM_BY_ID[itemId];
  if (!item) throw new u.ApiError('Неизвестный предмет');
  if ((l.arsenal[itemId] || 0) <= 0) throw new u.ApiError('Предмет закончился в арсенале');

  // Максимум слотов на бойца
  const extraSlots = (l.battleBuildings['gear_slots'] || 0);
  const maxSlots = config.LEGION.GEAR_SLOTS_DEFAULT + extraSlots;

  const userGear = l.activeBattle.gear || {};
  const myGear = userGear[user.id] || [];
  if (myGear.length >= maxSlots) {
    throw new u.ApiError(`Боевой пояс заполнен (максимум ${maxSlots} предметов)`);
  }

  myGear.push(itemId);
  userGear[user.id] = myGear;
  l.activeBattle.gear = userGear;
  l.arsenal[itemId]--;
  db.save('legions');

  notices.push(`🎒 ${item.name} добавлен в боевой пояс (${myGear.length}/${maxSlots}).`);
  return { itemId, gear: myGear, slots: maxSlots };
}

// ===================================================================
// ВЫЗОВ НА БОЙ
// Лидер бросает вызов другому легиону в любое время.
// ===================================================================
function challengeLegion(user, enemyId, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  if (l.leaderId !== user.id) throw new u.ApiError('Вызвать на бой может только лидер');
  ensureLegionFields(l);

  if (l.pendingChallenge || l.activeBattle) {
    throw new u.ApiError('У вас уже есть активный вызов или идёт бой');
  }

  const all = legions();
  const enemy = all[enemyId];
  if (!enemy) throw new u.ApiError('Легион не найден');
  if (enemy.id === l.id) throw new u.ApiError('Нельзя вызвать самих себя');
  ensureLegionFields(enemy);
  if (enemy.pendingChallenge || enemy.activeBattle) {
    throw new u.ApiError('Этот легион уже занят в бою или ожидает вызова');
  }

  const expiresAt = Date.now() + config.LEGION.CHALLENGE_ACCEPT_MS;

  // Записываем вызов на обе стороны
  l.pendingChallenge = { role: 'challenger', enemyId: enemy.id, expiresAt };
  enemy.pendingChallenge = { role: 'challenged', enemyId: l.id, expiresAt };
  db.save('legions');

  // Уведомление лидеру противника
  const enemyLeader = player.users()[enemy.leaderId];
  if (enemyLeader) {
    notif.push(enemy.leaderId, 'legion_challenge',
      `⚔️ Легион «${l.name}» вызывает вас на бой!`,
      { challengerName: l.name, challengerId: l.id, expiresAt });
  }

  notices.push(`⚔️ Вызов отправлен легиону «${enemy.name}»! Ожидаем ответа 5 минут.`);
  return { expiresAt };
}

// ===================================================================
// ПРИНЯТИЕ ВЫЗОВА
// ===================================================================
function acceptChallenge(user, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  if (l.leaderId !== user.id) throw new u.ApiError('Принять вызов может только лидер');
  ensureLegionFields(l);

  if (!l.pendingChallenge || l.pendingChallenge.role !== 'challenged') {
    throw new u.ApiError('Нет входящего вызова на бой');
  }
  if (Date.now() > l.pendingChallenge.expiresAt) {
    l.pendingChallenge = null;
    db.save('legions');
    throw new u.ApiError('Время вызова истекло');
  }
  // (принять вызов можно в любое время)

  const all = legions();
  const challenger = all[l.pendingChallenge.enemyId];
  if (!challenger) throw new u.ApiError('Легион-вызывающий не найден');
  ensureLegionFields(challenger);

  const lb = require('./legionBattle');
  const battleId = u.uid(12);
  const prepEndsAt = Date.now() + lb.PREP_MS;

  // legionA = вызывающий (challenger), legionB = принявший вызов
  const battleObj = {
    id: battleId,
    legionA: challenger.id,
    legionB: l.id,
    startedAt: Date.now(),
    prepEndsAt,
    phase: 'prep',   // prep → active → done
    combatants: {},
    gear: {},
    guardLinks: {},
    guardExpiry: {},
    log: [],
  };

  challenger.activeBattle = { ...battleObj, enemyId: l.id };
  l.activeBattle          = { ...battleObj, enemyId: challenger.id };
  challenger.pendingChallenge = null;
  l.pendingChallenge          = null;
  db.save('legions');

  const users = player.users();
  const announce = (legion, msg) => {
    for (const memberId of legion.members) {
      const m = users[memberId];
      if (m) notif.push(m.id, 'legion_battle_start', msg,
        { enemyName: legion.id === challenger.id ? l.name : challenger.name, prepEndsAt });
    }
  };
  announce(challenger, `⚔️ Бой принят! «${l.name}» принял вызов. 10 минут на подготовку!`);
  announce(l,          `⚔️ Вы приняли вызов «${challenger.name}»! 10 минут на подготовку!`);

  notices.push(`✅ Вызов принят! 10 минут — зайдите во вкладку «Война» легиона и нажмите «Готов».`);
  return { battleId, prepEndsAt };
}

// ===================================================================
// ОТКЛОНИТЬ ВЫЗОВ
// ===================================================================
function declineChallenge(user, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  if (l.leaderId !== user.id) throw new u.ApiError('Только лидер может отклонять вызов');
  ensureLegionFields(l);

  if (!l.pendingChallenge) throw new u.ApiError('Нет активного вызова');

  const all = legions();
  const other = all[l.pendingChallenge.enemyId];
  if (other) {
    ensureLegionFields(other);
    other.pendingChallenge = null;
  }
  l.pendingChallenge = null;
  db.save('legions');

  notices.push('🚫 Вызов отклонён.');
  return { ok: true };
}

// ===================================================================
// ЗАВЕРШИТЬ БОЙ ЛЕГИОНА (вызывается тикером или вручную)
// Упрощённый расчёт: суммарная мощь + бонусы боевых построек.
// ===================================================================
function resolveActiveBattle(l, all, users) {
  if (!l.activeBattle || l.activeBattle.phase === 'done') return;
  const enemy = all[l.activeBattle.enemyId];
  if (!enemy) { l.activeBattle = null; return; }

  // Мощь с учётом боевых построек легиона
  function battlePower(legion) {
    let pow = legionWarPower(legion);
    const atkBonus = ((legion.battleBuildings || {})['warcmd'] || 0) * 0.05;
    const defBonus = ((legion.battleBuildings || {})['fortress'] || 0) * 0.05;
    return pow * (1 + atkBonus) * (1 + defBonus);
  }

  const myPow  = battlePower(l)    * (0.9 + Math.random() * 0.2);
  const enPow  = battlePower(enemy) * (0.9 + Math.random() * 0.2);
  const myWin  = myPow >= enPow;

  const winner = myWin ? l : enemy;
  const loser  = myWin ? enemy : l;

  const loot = Math.floor((loser.reserves || 0) * 0.20); // 20% кланмарок победителю
  loser.reserves  = Math.max(0, (loser.reserves || 0) - loot);
  winner.reserves = (winner.reserves || 0) + loot + config.LEGION.BATTLE_LOOT_RESERVES;

  // Очки рейтинга
  winner.ratingPoints = (winner.ratingPoints || 0) + 10;
  loser.ratingPoints  = Math.max(0, (loser.ratingPoints || 0) - 3);

  const now = Date.now();
  const histEntry = (won, enemyId, lootVal) => ({ at: now, enemyId, won, loot: lootVal });
  l.battleHistory     = (l.battleHistory || []).concat(histEntry(myWin, enemy.id, myWin ? loot : -loot)).slice(-20);
  enemy.battleHistory = (enemy.battleHistory || []).concat(histEntry(!myWin, l.id, !myWin ? loot : -loot)).slice(-20);

  const msgW = `🏆 ПОБЕДА в бою легионов! Захвачено ${u.fmt(loot)} РЕЗ + ${config.LEGION.BATTLE_LOOT_RESERVES} РЕЗ.`;
  const msgL = `💀 ПОРАЖЕНИЕ в бою легионов. Потеряно ${u.fmt(loot)} РЕЗ.`;

  for (const memberId of winner.members) {
    const m = users[memberId];
    if (m) {
      player.addXp(m, config.LEGION.BATTLE_XP_WIN, []);
      notif.push(m.id, 'legion_battle_result', msgW, { won: true });
    }
  }
  for (const memberId of loser.members) {
    const m = users[memberId];
    if (m) {
      player.addXp(m, config.LEGION.BATTLE_XP_LOSS, []);
      notif.push(m.id, 'legion_battle_result', msgL, { won: false });
    }
  }

  l.activeBattle    = null;
  enemy.activeBattle = null;
}

// ===================================================================
// СТАРАЯ СИСТЕМА ВОЙН (автоматическая, через час)
// ===================================================================
function resolveWars() {
  const now = Date.now();
  const all  = legions();
  const users = player.users();

  // Старые войны
  const processed = new Set();
  for (const l of Object.values(all)) {
    if (!l.war || processed.has(l.id)) continue;
    if (l.war.role !== 'attacker') continue;
    if (l.war.battleAt > now) continue;

    const enemy = all[l.war.enemyId];
    if (!enemy) { l.war = null; continue; }
    processed.add(l.id);
    processed.add(enemy.id);

    const aPow = legionWarPower(l)    * (0.9 + Math.random() * 0.2);
    const dPow = legionWarPower(enemy) * (0.9 + Math.random() * 0.2);
    const aWin = aPow >= dPow;

    const winner = aWin ? l : enemy;
    const loser  = aWin ? enemy : l;
    const loot = Math.floor((loser.treasury || 0) * config.LEGION.WAR_LOOT_PCT);
    loser.treasury  = (loser.treasury  || 0) - loot;
    winner.treasury = (winner.treasury || 0) + loot;

    const notify = (legion, msg, xp) => {
      for (const memberId of legion.members) {
        const m = users[memberId];
        if (!m) continue;
        if (xp > 0) player.addXp(m, xp, []);
        social.systemMail(m, 'Итог кланвойны', msg);
      }
    };
    notify(winner, `Победа! «${winner.name}» разгромил «${loser.name}». Трофеи: $${u.fmt(loot)} в казну.`, config.LEGION.WAR_XP_WIN);
    notify(loser,  `Поражение. «${loser.name}» уступил «${winner.name}». Утрачено: $${u.fmt(loot)}.`, config.LEGION.WAR_XP_LOSS);

    const h = { at: now, enemyId: enemy.id, won: aWin, loot: aWin ? loot : -loot };
    l.warHistory     = (l.warHistory     || []).concat(h).slice(-20);
    enemy.warHistory = (enemy.warHistory || []).concat({ ...h, enemyId: l.id, won: !aWin, loot: aWin ? -loot : loot }).slice(-20);
    l.war = null; enemy.war = null;
  }

  // Новые бои легиона: тик через legionBattle
  const lb = require('./legionBattle');
  const processedBattle = new Set();
  for (const l of Object.values(all)) {
    if (!l.activeBattle || processedBattle.has(l.id)) continue;
    if (l.activeBattle.phase === 'done') { l.activeBattle = null; continue; }

    processedBattle.add(l.id);
    const enemyId = l.activeBattle.enemyId;
    if (enemyId) processedBattle.add(enemyId);

    ensureLegionFields(l);

    // Фаза prep → active по таймеру
    lb.startActivePhaseTick(l, all, users);

    // Тик DoT-эффектов в активном бою
    if (l.activeBattle && l.activeBattle.phase === 'active') {
      lb.tickEffects(l.activeBattle);
    }
  }

  // Истёкшие вызовы — чистим
  for (const l of Object.values(all)) {
    if (l.pendingChallenge && Date.now() > l.pendingChallenge.expiresAt) {
      l.pendingChallenge = null;
    }
  }

  // Завершённые изучения технологий
  resolveTechQueue();

  db.save('legions');
}

// ===================================================================
// ОБЪЯВЛЕНИЕ СТАРОЙ ВОЙНЫ
// ===================================================================
function declareWar(user, enemyId, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  if (l.leaderId !== user.id) throw new u.ApiError('Объявлять войну может только лидер');
  if (l.war) throw new u.ApiError('У легиона уже идёт война');
  const enemy = legions()[enemyId];
  if (!enemy) throw new u.ApiError('Легион-цель не найден');
  if (enemy.id === l.id) throw new u.ApiError('Нельзя воевать с самим собой');
  if (enemy.war) throw new u.ApiError('Цель уже занята в войне');

  const recent = (l.warHistory || []).find(h =>
    h.enemyId === enemy.id && Date.now() - h.at < config.LEGION.WAR_COOLDOWN_HOURS * 3600000);
  if (recent) throw new u.ApiError('Цель в перерыве после прошлой битвы');

  const battleAt = Date.now() + config.LEGION.WAR_PREPARE_HOURS * 3600000;
  l.war = { enemyId: enemy.id, role: 'attacker', battleAt };
  enemy.war = { enemyId: l.id, role: 'defender', battleAt };
  db.save('legions');
  notices.push(`⚔ Война объявлена! Битва через ${config.LEGION.WAR_PREPARE_HOURS} ч.`);

  const users = player.users();
  const announce = (legion, msg) => {
    for (const memberId of legion.members) {
      const m = users[memberId];
      if (m) social.systemMail(m, 'Кланвойна!', msg);
    }
  };
  announce(l, `Ваш легион объявил войну «${enemy.name}». Битва через ${config.LEGION.WAR_PREPARE_HOURS} ч.`);
  announce(enemy, `«${l.name}» объявил вам войну! Битва через ${config.LEGION.WAR_PREPARE_HOURS} ч.`);
  return { battleAt };
}

// ===================================================================
// ЛИМИТ УЧАСТНИКОВ
// ===================================================================
function memberLimit(l) {
  const barrLvl = (l.battleBuildings || {})['barracks'] || 0;
  return config.LEGION.BASE_MEMBER_LIMIT + barrLvl * config.LEGION.MEMBER_PER_BARRACKS_LEVEL;
}

// ===================================================================
// ЗВАНИЯ УЧАСТНИКОВ
// ===================================================================
function getMemberRank(l, userId) {
  if (l.leaderId === userId) return config.LEGION.RANK_GENERAL;
  return (l.memberRanks || {})[userId] || 0;
}

function setRank(user, targetId, rankIndex, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  ensureLegionFields(l);

  const myRank = getMemberRank(l, user.id);
  if (myRank < config.LEGION.RANK_VICE) throw new u.ApiError('Недостаточно прав для назначения звания');
  if (!l.members.includes(targetId)) throw new u.ApiError('Этого игрока нет в легионе');
  if (targetId === user.id) throw new u.ApiError('Нельзя изменить своё звание самостоятельно');

  const target = player.users()[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');

  rankIndex = u.toInt(rankIndex, 0);
  if (rankIndex < 0 || rankIndex >= config.LEGION.RANKS.length) throw new u.ApiError('Неизвестное звание');

  // Зам. генерала может назначать только до "Лидер отряда"
  if (myRank === config.LEGION.RANK_VICE && rankIndex >= config.LEGION.RANK_VICE) {
    throw new u.ApiError('Заместитель может назначать максимум «Лидер отряда»');
  }
  // Передача лидерства — только генерал
  if (rankIndex === config.LEGION.RANK_GENERAL) {
    if (myRank !== config.LEGION.RANK_GENERAL) throw new u.ApiError('Только Генерал может передать лидерство');
    l.leaderId = targetId;
    l.memberRanks[user.id] = config.LEGION.RANK_VICE;
    notices.push(`⭐ Лидерство передано игроку ${target.name}.`);
  }

  l.memberRanks[targetId] = rankIndex;
  db.save('legions');
  const rankName = config.LEGION.RANKS[rankIndex];
  notices.push(`✅ ${target.name} назначен: «${rankName}».`);
  return { targetId, rank: rankIndex, rankName };
}

// ===================================================================
// ЧАТ ЛЕГИОНА
// ===================================================================
function chatGet(user) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  ensureLegionFields(l);
  return { messages: (l.chat || []).slice(-100) };
}

function chatPost(user, text, notices) {
  const l = legionOf(user);
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  ensureLegionFields(l);
  text = String(text || '').trim().slice(0, 300);
  if (!text) throw new u.ApiError('Пустое сообщение');
  const msg = { userId: user.id, name: user.name, text, at: Date.now(), rank: getMemberRank(l, user.id) };
  l.chat = l.chat || [];
  l.chat.push(msg);
  if (l.chat.length > 200) l.chat = l.chat.slice(-200);
  db.save('legions');
  return { message: msg };
}

// ===================================================================
// ПУБЛИЧНЫЙ ПРОСМОТР ЛЕГИОНА (для посторонних)
// ===================================================================
function publicView(legionId) {
  const l = legions()[legionId];
  if (!l) throw new u.ApiError('Легион не найден');
  ensureLegionFields(l);
  const users = player.users();
  const members = (l.members || []).map(id => {
    const u2 = users[id];
    const rank = getMemberRank(l, id);
    return u2 ? { id: u2.id, name: u2.name, flag: player.flag(u2), level: u2.level, rank, rankName: config.LEGION.RANKS[rank] } : null;
  }).filter(Boolean).sort((a, b) => b.rank - a.rank || b.level - a.level);

  return {
    id: l.id, name: l.name,
    legionLevel: l.legionLevel || 1,
    gloryPoints: l.gloryPoints || 0,
    gloryEarned: l.gloryEarned || 0,
    battleStats: l.battleStats || { wins: 0, losses: 0 },
    members,
    memberCount: members.length,
  };
}

module.exports = {
  view, deposit, build, declareWar, resolveWars,
  exchangeToReserves, buildBattle, depositResources,
  startTech, resolveTechQueue,
  shopBuy, gearPick,
  challengeLegion, acceptChallenge, declineChallenge,
  setRank, chatGet, chatPost, publicView, memberLimit, getMemberRank,
  battleState:      (...a) => require('./legionBattle').battleState(...a),
  joinBattle:       (...a) => require('./legionBattle').joinBattle(...a),
  chooseDirection:  (...a) => require('./legionBattle').chooseDirection(...a),
  attack:           (...a) => require('./legionBattle').attack(...a),
  heal:             (...a) => require('./legionBattle').heal(...a),
  guard:            (...a) => require('./legionBattle').guard(...a),
  useItem:          (...a) => require('./legionBattle').useItem(...a),
};
