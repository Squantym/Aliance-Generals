// ===================================================================
// src/services/sanctions.js — «Санкции» (контракты на игрока)
//
// Игрок с 50+ уровнем может объявить санкции на любого ДРУГОГО
// живого игрока, указав сумму награды из своего кармана (escrow).
// Цель попадает в список санкций (вкладка доступна с 50 ур.).
// Любой игрок, атаковавший цель ИЗ ВКЛАДКИ «Санкции» и добивший
// её (HP ≤ порога лазарета), получает награду.
//
// Принципы:
//   • Деньги списываются с заказчика сразу при объявлении (escrow).
//   • На одного игрока могут висеть несколько контрактов от разных
//     заказчиков — каждый со своей наградой.
//   • Контракты живут TTL=7 суток (см. SANCTION_TTL_MS). По истечении
//     деньги возвращаются заказчику.
//   • Заказчик не может выполнить свой контракт (нельзя «сам себе»).
//   • Заказчик может в любой момент отменить — деньги вернутся.
//   • Цель не может стать заказчиком против самой себя.
//   • Боты в системе не участвуют (только живые игроки).
//   • При выплате награды отправляется уведомление и заказчику,
//     и исполнителю, и цели.
//   • Выплата срабатывает ТОЛЬКО при атаке с флагом isSanctionAttack
//     (вкладка «Санкции»). Атака из «Войны» даёт обычный грабёж.
//   • Заказчик может бить свою цель во «Войне», но награду санкций
//     не получит — только обычный loot.
//   • Цель должна быть добита (HP ≤ MIN_HP_TO_FIGHT).
// ===================================================================

const config = require('../../config/gameConfig');
const db     = require('../core/db');
const u      = require('../core/utils');
const player = require('./player');
const social = require('./social');
const notif  = (() => { try { return require('./notifications'); } catch (e) { return null; } })();

const MIN_REWARD = 100_000;           // минимум $100K на голову
const MAX_REWARD = 10_000_000_000;    // макс. $10 млрд — лимит чтобы не было багов
const SANCTION_TTL_MS = 7 * 24 * 3600 * 1000;
const ACCESS_LEVEL = 50;            // вкладка и объявление — с 50 уровня

function store() { return db.load('sanctions', { list: [] }); }
function all()   { return store().list; }

// Только живые игроки (не боты, не сам игрок)
function ensureLiveTarget(targetId, selfId) {
  if (!targetId || typeof targetId !== 'string') throw new u.ApiError('Неверная цель');
  if (String(targetId).startsWith('bot_')) throw new u.ApiError('Нельзя объявлять санкции на ботов');
  if (targetId === selfId) throw new u.ApiError('Нельзя объявить санкции на самого себя');
  const t = player.users()[targetId];
  if (!t) throw new u.ApiError('Игрок не найден');
  return t;
}

function notify(userId, msg, payload) {
  if (notif && typeof notif.push === 'function') {
    notif.push(userId, 'sanction', msg, payload || {});
  }
}

// Удалить просроченные контракты, вернув деньги заказчикам.
// Вызывается лениво при list()/declare() и из фонового тика.
function prune() {
  const s = store();
  const now = Date.now();
  const users = player.users();
  const survivors = [];
  for (const c of (s.list || [])) {
    if ((c.expiresAt || 0) <= now) {
      const sponsor = users[c.sponsorId];
      const victim  = users[c.targetId];
      if (sponsor) {
        player.addMoney(sponsor, c.reward, false);
        notify(c.sponsorId,
          `⏳ Контракт на ${victim ? victim.name : c.targetName} истёк. Возвращено $${u.fmt(c.reward)}.`,
          { kind: 'expired', reward: c.reward });
      }
    } else {
      survivors.push(c);
    }
  }
  if (survivors.length !== (s.list || []).length) {
    s.list = survivors;
    db.save('sanctions');
  }
}

// ---------- VIEW: список целей с активными контрактами ----------
// Группируем по targetId, суммируем награды. Видна каждому игроку.
function hasActiveContract(targetId) {
  return all().some(c => c.targetId === targetId);
}

function list(user) {
  prune();
  if ((user.level || 1) < ACCESS_LEVEL) {
    return {
      locked: true,
      requiredLevel: ACCESS_LEVEL,
      targets: [],
      myAsSponsor: [],
      onMe: null,
      rules: {
        minReward: MIN_REWARD,
        maxReward: MAX_REWARD,
        ttlDays: 7,
        mustKill: true,
        accessLevel: ACCESS_LEVEL,
      },
    };
  }
  const users = player.users();
  const byTarget = new Map();
  for (const c of all()) {
    const t = users[c.targetId];
    if (!t) continue;
    const key = c.targetId;
    if (!byTarget.has(key)) {
      byTarget.set(key, {
        targetId: c.targetId,
        targetName: t.name,
        targetLevel: t.level,
        targetFlag: player.flag(t),
        targetHpPct: Math.round((t.res.hp.cur / player.maxima(t).hp) * 100),
        targetAlliance: (() => { const a = player.allianceOf(t); return a ? a.name : null; })(),
        totalReward: 0,
        contractsCount: 0,
        myContract: null,
        canHunt: t.id !== user.id, // нельзя добивать самого себя
      });
    }
    const e = byTarget.get(key);
    e.totalReward += c.reward;
    e.contractsCount++;
    if (c.sponsorId === user.id) {
      e.myContract = { reward: c.reward, expiresAt: c.expiresAt };
    }
  }
  const targets = Array.from(byTarget.values())
    .sort((a, b) => b.totalReward - a.totalReward);

  // Также — мои контракты в роли заказчика
  const myAsSponsor = all()
    .filter(c => c.sponsorId === user.id)
    .map(c => {
      const t = users[c.targetId];
      return {
        targetId: c.targetId,
        targetName: t ? t.name : c.targetName,
        targetFlag: t ? player.flag(t) : '',
        reward: c.reward,
        declaredAt: c.declaredAt,
        expiresAt: c.expiresAt,
      };
    })
    .sort((a, b) => a.expiresAt - b.expiresAt);

  // Активная санкция на меня (если меня заказали)
  const onMe = all().filter(c => c.targetId === user.id);
  const onMeTotal = onMe.reduce((s, c) => s + c.reward, 0);

  return {
    targets,
    myAsSponsor,
    onMe: onMe.length > 0 ? { count: onMe.length, totalReward: onMeTotal } : null,
    rules: {
      minReward: MIN_REWARD,
      maxReward: MAX_REWARD,
      ttlDays: Math.round(SANCTION_TTL_MS / 86400000),
      mustKill: true,
      accessLevel: ACCESS_LEVEL,
    },
  };
}

// ---------- DECLARE: объявить санкцию ----------
function declare(user, targetId, reward, notices) {
  if ((user.level || 1) < ACCESS_LEVEL) {
    throw new u.ApiError(`Санкции доступны с ${ACCESS_LEVEL} уровня`);
  }
  const target = ensureLiveTarget(targetId, user.id);
  reward = u.toInt(reward, 0);
  if (reward < MIN_REWARD) throw new u.ApiError(`Минимальная награда: $${u.fmt(MIN_REWARD)}`);
  if (reward > MAX_REWARD) throw new u.ApiError(`Максимальная награда: $${u.fmt(MAX_REWARD)}`);
  if (user.dollars < reward) throw new u.ApiError(`Не хватает денег: нужно $${u.fmt(reward)}`);

  // Один заказчик не может одновременно держать несколько контрактов
  // на одну и ту же жертву — это упрощает интерфейс и предотвращает
  // абуз «бесконечного продления».
  const s = store();
  const existing = (s.list || []).find(c => c.sponsorId === user.id && c.targetId === target.id);
  if (existing) {
    throw new u.ApiError('У вас уже есть активный контракт на эту цель. Отмените прежний, чтобы создать новый.');
  }

  user.dollars -= reward;
  const contract = {
    id: u.uid(12),
    sponsorId: user.id,
    sponsorName: user.name,
    targetId: target.id,
    targetName: target.name,
    reward,
    declaredAt: Date.now(),
    expiresAt: Date.now() + SANCTION_TTL_MS,
  };
  s.list = (s.list || []).concat(contract);
  db.save('sanctions');

  notify(target.id,
    `🎯 На вашу голову объявлены санкции! ${user.name} назначил награду $${u.fmt(reward)}. Будьте начеку.`,
    { kind: 'declared', reward, sponsorName: user.name });

  notices.push(`🎯 Санкция объявлена на ${target.name}. Награда: $${u.fmt(reward)} зарезервирована.`);
  return { contractId: contract.id, reward, expiresAt: contract.expiresAt };
}

// ---------- CANCEL: отменить свою санкцию ----------
// Только заказчик может отменить. Деньги возвращаются полностью.
function cancel(user, targetId, notices) {
  const s = store();
  const idx = (s.list || []).findIndex(
    c => c.sponsorId === user.id && c.targetId === targetId
  );
  if (idx < 0) throw new u.ApiError('У вас нет активного контракта на эту цель');
  const c = s.list[idx];
  s.list.splice(idx, 1);
  db.save('sanctions');

  player.addMoney(user, c.reward, false);
  notices.push(`🚫 Контракт отменён. Возвращено $${u.fmt(c.reward)}.`);
  return { refunded: c.reward };
}

// ---------- HOOK: вызывается из battle.attack после нанесения урона ----------
// Только при isSanctionAttack=true. Если HP жертвы ≤ порога лазарета —
// выплачиваем ВСЕ контракты на эту жертву исполнителю.
function checkAndPayout(attacker, victim, ctx) {
  if (!ctx || !ctx.isSanctionAttack) return null;
  if (!attacker || !victim) return null;
  if (attacker.id === victim.id) return null;

  const killThreshold = config.PLAYER.MIN_HP_TO_FIGHT;
  if ((victim.res.hp.cur || 0) > killThreshold) return null;

  const s = store();
  const matching = (s.list || []).filter(c => c.targetId === victim.id);
  if (matching.length === 0) return null;

  let totalPayout = 0;
  const breakdown = [];
  const users = player.users();
  for (const c of matching) {
    // Заказчик не получает награду за то, что сам же дотянул цель —
    // в этом случае контракт просто аннулируется и деньги к нему
    // вернутся (он же их и платил).
    if (c.sponsorId === attacker.id) {
      player.addMoney(attacker, c.reward, false);
      breakdown.push({ from: c.sponsorName, amount: c.reward, refunded: true });
      continue;
    }
    player.addMoney(attacker, c.reward, true);
    totalPayout += c.reward;
    breakdown.push({ from: c.sponsorName, amount: c.reward });

    const sponsor = users[c.sponsorId];
    if (sponsor) {
      notify(c.sponsorId,
        `✅ Контракт выполнен! ${attacker.name} добил ${victim.name}. Награда $${u.fmt(c.reward)} ушла исполнителю.`,
        { kind: 'paid', amount: c.reward, executorName: attacker.name, victimName: victim.name });
    }
  }

  // Удаляем все выплаченные контракты
  s.list = (s.list || []).filter(c => c.targetId !== victim.id);
  db.save('sanctions');

  notify(victim.id,
    `💀 Контракт на вашу голову выполнен. ${attacker.name} получил награду.`,
    { kind: 'victim', executorName: attacker.name });

  // Уведомления в почту/нотификации исполнителю
  notify(attacker.id,
    `💰 Вы выполнили контракт на ${victim.name}! Получено $${u.fmt(totalPayout)}.`,
    { kind: 'reward', amount: totalPayout, victimName: victim.name });

  return { totalPayout, contracts: matching.length, breakdown };
}

module.exports = { list, declare, cancel, checkAndPayout, prune, hasActiveContract, ACCESS_LEVEL };
