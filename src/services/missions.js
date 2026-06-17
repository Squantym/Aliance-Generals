// ===================================================================
// src/services/missions.js — военные конфликты со спецоперациями
// 10 конфликтов в мире, каждый = 7-10 спецопераций, у каждой 3 шага.
// Шаги:
//   - Требуют энергии и времени (5-60 минут)
//   - Имеют требования: сила армии, уровень
//   - Дают небольшой опыт (3..340) и немного денег
//   - Можно ускорить шаг за 20 золота
// Награда за КОНФЛИКТ (7-10 СП + золото) выдаётся единоразово при
// первом полном прохождении. Повтор — без бонуса.
//
// Хранение прогресса у пользователя:
//   user.missionProgress = {
//     [conflictId]: {
//       completed: number,      // сколько раз пройден весь конфликт
//       firstReward: boolean,    // выданы ли единоразовые SP + золото
//       ops: { [opIdx]: { stepIdx: 0|1|2|3 } }  // шагов выполнено в опе
//     }
//   }
//   user.missionQueue = [{ id, confId, opIdx, stepIdx, finishesAt, xp, money }]
// ===================================================================

const config = require('../../config/gameConfig');
const u = require('../core/utils');
const player = require('./player');
const ach = require('./achievements');
const tutorial = require('./tutorial');

// Прогресс по конкретному конфликту
function progress(user, confId) {
  if (!user.missionProgress) user.missionProgress = {};
  if (!user.missionProgress[confId]) {
    user.missionProgress[confId] = { completed: 0, firstReward: false, ops: {} };
  }
  return user.missionProgress[confId];
}

// Сколько шагов выполнено в операции (0..3)
function stepsDone(user, confId, opIdx) {
  const p = progress(user, confId);
  return p.ops[opIdx] || 0;
}

// Сколько операций полностью пройдено (3 шага из 3)
function opsCompleted(user, conflict) {
  let n = 0;
  for (let i = 0; i < conflict.ops; i++) {
    if (stepsDone(user, conflict.id, i) >= 3) n++;
  }
  return n;
}

// Проверка требований шага
function meetsRequirements(user, step) {
  if (user.level < step.require.level) return { ok: false, reason: `Нужен уровень ${step.require.level}` };
  const atkPower = player.buildArmy(user, 'atk').power;
  if (atkPower < step.require.power) {
    return { ok: false, reason: `Нужна мощь атаки от ${u.fmt(step.require.power)} (у вас ${u.fmt(atkPower)})` };
  }
  return { ok: true };
}

// Проверка ресурсов и активного слота
function checkCanStart(user, conflict, op, step) {
  if (user.level < conflict.minLevel) throw new u.ApiError(`Конфликт откроется на ${conflict.minLevel} уровне`);
  if (!user.missionQueue) user.missionQueue = [];
  if (user.missionQueue.length > 0) {
    const active = user.missionQueue[0];
    throw new u.ApiError(`Сейчас выполняется другой шаг (${active.confId})`);
  }
  // Текущий шаг должен идти строго по порядку
  const done = stepsDone(user, conflict.id, op.idx);
  if (done !== step.idx) {
    throw new u.ApiError(`Сначала выполните предыдущие шаги операции (выполнено ${done}/3)`);
  }
  const en = user.res.en.cur;
  if (en < step.energy) throw new u.ApiError(`Нужно ⚡ ${step.energy} энергии (у вас ${en})`);
  const req = meetsRequirements(user, step);
  if (!req.ok) throw new u.ApiError(req.reason);
}

// Завершение готовых шагов (вызывается из player.refresh ленивым способом)
function checkCompleted(user, notices) {
  if (!user.missionQueue) user.missionQueue = [];
  const now = Date.now();
  const remaining = [];
  for (const proc of user.missionQueue) {
    if (proc.finishesAt <= now) {
      // Засчитываем шаг
      const p = progress(user, proc.confId);
      p.ops[proc.opIdx] = (p.ops[proc.opIdx] || 0) + 1;
      // Счётчик для ежедневного задания
      require('./dailyQuests').bump(user, 'missionStages', 1);
      // Награда за шаг
      player.addXp(user, proc.xp, notices || []);
      player.addMoney(user, proc.money, false);
      // Проверка завершения всего конфликта
      const conf = config.CONFLICT_BY_ID[proc.confId];
      const done = opsCompleted(user, conf);
      if (done >= conf.ops) {
        p.completed++;
        if (!p.firstReward) {
          p.firstReward = true;
          user.skillPoints += conf.spReward;
          user.gold += conf.goldReward;
          if (notices) {
            notices.push(`🏆 Конфликт «${conf.name}» полностью пройден! Награда: +${conf.spReward} очков навыков и 🪙 ${conf.goldReward}.`);
          }
        } else if (notices) {
          notices.push(`✅ Конфликт «${conf.name}» снова пройден (без повторной награды).`);
        }
        // Обнуляем прогресс для повторного прохождения
        p.ops = {};
        ach.bump(user, 'missionStages', conf.ops * 3, notices || []);
      }
    } else {
      remaining.push(proc);
    }
  }
  user.missionQueue = remaining;
}

// Список конфликтов для UI
function list(user) {
  return {
    conflicts: config.CONFLICTS.map((conf, i) => {
      const locked = user.level < conf.minLevel;
      const p = progress(user, conf.id);
      const doneOps = opsCompleted(user, conf);
      return {
        id: conf.id, name: conf.name,
        minLevel: conf.minLevel,
        locked,
        opsTotal: conf.ops,
        opsDone: doneOps,
        completed: p.completed,
        firstReward: p.firstReward,
        spReward: conf.spReward,
        goldReward: conf.goldReward,
        rewardAvailable: !p.firstReward,
      };
    }),
    active: (user.missionQueue && user.missionQueue[0])
      ? activeView(user.missionQueue[0])
      : null,
    boostGoldCost: config.MISSION_STEP.BOOST_GOLD_COST,
  };
}

function activeView(proc) {
  const secLeft = Math.max(0, Math.floor((proc.finishesAt - Date.now()) / 1000));
  const conf = config.CONFLICT_BY_ID[proc.confId];
  const op = conf.operations[proc.opIdx];
  const step = op.steps[proc.stepIdx];
  return {
    id: proc.id, confId: proc.confId, confName: conf.name,
    opIdx: proc.opIdx, opName: op.name,
    stepIdx: proc.stepIdx, stepName: step.name,
    totalSec: step.timeMin * 60,
    secondsLeft: secLeft,
    canBoost: secLeft > 0,
  };
}

// Детальная карта конфликта: его 7-10 спецопераций и шаги
function detail(user, confId) {
  const conf = config.CONFLICT_BY_ID[confId];
  if (!conf) throw new u.ApiError('Конфликт не найден');
  return {
    id: conf.id, name: conf.name,
    minLevel: conf.minLevel,
    locked: user.level < conf.minLevel,
    spReward: conf.spReward, goldReward: conf.goldReward,
    rewardAvailable: !progress(user, conf.id).firstReward,
    operations: conf.operations.map((op) => ({
      idx: op.idx, id: op.id, name: op.name,
      stepsDone: stepsDone(user, conf.id, op.idx),
      steps: op.steps.map((s) => ({
        idx: s.idx, name: s.name,
        energy: s.energy, timeMin: s.timeMin,
        xp: s.xp, money: s.money,
        require: s.require,
      })),
    })),
    activeStep: (user.missionQueue && user.missionQueue[0] && user.missionQueue[0].confId === conf.id)
      ? activeView(user.missionQueue[0]) : null,
    boostGoldCost: config.MISSION_STEP.BOOST_GOLD_COST,
  };
}

// Запустить шаг (опе=opIdx, шаг=stepIdx)
function startStep(user, confId, opIdx, stepIdx, notices) {
  const conf = config.CONFLICT_BY_ID[confId];
  if (!conf) throw new u.ApiError('Конфликт не найден');
  const op = conf.operations[opIdx];
  if (!op) throw new u.ApiError('Спецоперация не найдена');
  const step = op.steps[stepIdx];
  if (!step) throw new u.ApiError('Шаг не найден');

  checkCanStart(user, conf, op, step);

  // Расход энергии (с учётом «Радара» — modulates через trophies.missionEnergyMul)
  const trophies = require('./trophies');
  const finalEnergy = Math.max(1, Math.round(step.energy * trophies.missionEnergyMul(user)));
  if (user.res.en.cur < finalEnergy) throw new u.ApiError(`Нужно ⚡ ${finalEnergy} энергии`);
  user.res.en.cur -= finalEnergy;

  // Постановка в очередь
  const now = Date.now();
  const proc = {
    id: u.uid(8),
    confId, opIdx, stepIdx,
    energy: finalEnergy,
    xp: step.xp,
    money: step.money,
    startedAt: now,
    finishesAt: now + step.timeMin * 60 * 1000,
  };
  if (!user.missionQueue) user.missionQueue = [];
  user.missionQueue.push(proc);
  notices.push(`📋 «${conf.name}» / «${op.name}» / ${step.name}: запущено, готово через ${step.timeMin} мин.`);
  tutorial.notify(user, 'mission_step', notices); // для туториала
  return { processId: proc.id };
}

// Ускорить активный шаг за золото
function boostStep(user, processId, notices) {
  if (!user.missionQueue) user.missionQueue = [];
  const proc = user.missionQueue.find((p) => p.id === processId);
  if (!proc) throw new u.ApiError('Активный шаг не найден');
  if (proc.finishesAt <= Date.now()) throw new u.ApiError('Шаг уже завершён');
  const cost = config.MISSION_STEP.BOOST_GOLD_COST;
  if (user.gold < cost) throw new u.ApiError(`Нужно ${cost} золота`);
  user.gold -= cost;
  proc.finishesAt = Date.now();
  notices.push('⚡ Шаг операции ускорен!');
  return { ok: true };
}

module.exports = { list, detail, startStep, boostStep, checkCompleted };
