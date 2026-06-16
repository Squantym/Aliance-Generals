// ===================================================================
// src/services/production.js — раздел «Производство» (с 70 уровня)
// Цехи: каждый — один параллельный слот модернизации. За партию можно
// загнать до 100 единиц техники. Каждая единица модернизируется 10 минут.
// Модернизированная техника возвращается в свой Mk-уровень и слот цеха
// освобождается. Можно ускорить процесс за 100 золота (мгновенно завершить).
// Завершение процессов происходит в player.refresh() (ленивая обработка).
// ===================================================================

const config = require('../../config/gameConfig');
const u = require('../core/utils');
const player = require('./player');
const discounts = require('./discounts');

// Базовая цена цеха (без скидки)
function baseWorkshopPrice(user) {
  return config.WORKSHOP_BASE_GOLD * Math.pow(2, user.workshops);
}
// Цена следующего цеха со скидкой
function nextWorkshopPrice(user) {
  return discounts.applyTo('workshop', baseWorkshopPrice(user));
}

// Цена модернизации одной единицы техники в долларах (с учётом скидки)
function baseModernPricePerUnit(cu, toMk) {
  // cu.price × MK_COST_MULT[toMk] / делитель. Делитель 10 даёт:
  //   Mk1: 30% от цены техники, Mk2: 60% — за каждую единицу.
  return Math.round(cu.price * config.MK_COST_MULT[toMk] / config.MODERN.PRICE_DIVISOR);
}
function modernPricePerUnit(cu, toMk) {
  return discounts.applyTo('modernize', baseModernPricePerUnit(cu, toMk));
}

// Сколько цехов сейчас занято процессами
function slotsUsed(user) {
  return (user.modernQueue || []).length;
}

function checkUnlocked(user) {
  if (user.level < config.PRODUCTION_UNLOCK_LEVEL) {
    throw new u.ApiError(`Производство открывается на ${config.PRODUCTION_UNLOCK_LEVEL} уровне`);
  }
}

// Описание процесса для UI: имя, обратный отсчёт, флаг возможности ускорить
function processView(p) {
  const secLeft = Math.max(0, Math.floor((p.finishesAt - Date.now()) / 1000));
  return {
    id: p.id, unitId: p.unitId, unitName: p.unitName,
    qty: p.qty, fromMk: p.fromMk, toMk: p.toMk,
    startedAt: p.startedAt, finishesAt: p.finishesAt,
    secondsLeft: secLeft,
    canBoost: secLeft > 0,
    boostCost: config.MODERN.BOOST_GOLD_COST,
  };
}

// Полный вид экрана «Производство»
function view(user) {
  if (user.level < config.PRODUCTION_UNLOCK_LEVEL) {
    return {
      unlocked: false,
      unlockLevel: config.PRODUCTION_UNLOCK_LEVEL,
      level: user.level,
    };
  }

  // Кандидаты на модернизацию: те юниты, у которых есть техника на Mk0 или Mk1
  // (можно прокачать до Mk1 или Mk2 соответственно). Скрытые в очереди слоты
  // считаются уже занятыми, поэтому их юниты тоже отображаются.
  const candidates = [];
  for (const [unitId, mkMap] of Object.entries(user.units || {})) {
    const cu = config.UNIT_BY_ID[unitId];
    if (!cu) continue;
    for (let fromMk = 0; fromMk <= 1; fromMk++) {
      const have = (mkMap && mkMap[fromMk]) || 0;
      if (have <= 0) continue;
      const toMk = fromMk + 1;
      candidates.push({
        unitId, name: cu.name, type: config.UNIT_TYPE_NAMES[cu.type],
        fromMk, toMk,
        available: have,
        bonusBefore: Math.round((config.MK_MULT[fromMk] - 1) * 100),
        bonusAfter: Math.round((config.MK_MULT[toMk] - 1) * 100),
        basePricePerUnit: baseModernPricePerUnit(cu, toMk),
        pricePerUnit: modernPricePerUnit(cu, toMk),
        minutesPerUnit: config.MODERN.MINUTES_PER_UNIT_MK[toMk],
      });
    }
  }
  // Сортируем: сначала по типу, потом по unlock-уровню (мощные сверху)
  candidates.sort((a, b) => {
    const cuA = config.UNIT_BY_ID[a.unitId];
    const cuB = config.UNIT_BY_ID[b.unitId];
    return cuB.unlock - cuA.unlock;
  });

  return {
    unlocked: true,
    unlockLevel: config.PRODUCTION_UNLOCK_LEVEL,
    level: user.level,
    workshops: user.workshops,
    slotsUsed: slotsUsed(user),
    slotsFree: user.workshops - slotsUsed(user),
    baseNextWorkshopGold: baseWorkshopPrice(user),
    nextWorkshopGold: nextWorkshopPrice(user),
    queue: (user.modernQueue || []).map(processView),
    candidates,
    discountWorkshop: discounts.info('workshop'),
    discountModernize: discounts.info('modernize'),
    minutesPerUnitMk1: config.MODERN.MINUTES_PER_UNIT_MK[1],
    minutesPerUnitMk2: config.MODERN.MINUTES_PER_UNIT_MK[2],
    maxBatch: config.MODERN.MAX_BATCH,
    boostGoldCost: config.MODERN.BOOST_GOLD_COST,
  };
}

// Купить ещё один цех
function buyWorkshop(user, notices) {
  checkUnlocked(user);
  const price = nextWorkshopPrice(user);
  if (user.gold < price) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${price})`);
  user.gold -= price;
  user.workshops++;
  notices.push(`🏭 Построен цех №${user.workshops}. Свободных линий: ${user.workshops - slotsUsed(user)}.`);
  return { workshops: user.workshops };
}

// Запустить модернизацию партии: unitId, qty (1..100), fromMk (0 или 1)
function startModernization(user, body, notices) {
  checkUnlocked(user);
  if (slotsUsed(user) >= user.workshops) {
    throw new u.ApiError('Все цехи заняты — дождитесь окончания работ или постройте ещё цех');
  }
  const unitId = String(body.unitId || '');
  const qty = Math.max(1, Math.min(config.MODERN.MAX_BATCH, u.toInt(body.qty, 0)));
  const fromMk = u.clamp(u.toInt(body.fromMk, 0), 0, 1);
  const toMk = fromMk + 1;

  const cu = config.UNIT_BY_ID[unitId];
  if (!cu) throw new u.ApiError('Такой техники не существует');

  const m = user.units[unitId];
  const have = m ? (m[fromMk] || 0) : 0;
  if (have < qty) {
    throw new u.ApiError(`Недостаточно техники Mk${fromMk}: в наличии ${have}`);
  }

  // Списываем доллары: цена за единицу × qty (со скидкой)
  const totalPrice = modernPricePerUnit(cu, toMk) * qty;
  if (user.dollars < totalPrice) {
    throw new u.ApiError(`Не хватает денег: нужно $${u.fmt(totalPrice)}`);
  }
  user.dollars -= totalPrice;

  // Резервируем технику в процессе (вытаскиваем из mk-уровня)
  m[fromMk] -= qty;

  // Создаём процесс. Время зависит от целевого Mk-уровня и сокращается
  // на процент от трофея «Военинженер» (до −30%).
  const now = Date.now();
  const baseMin = config.MODERN.MINUTES_PER_UNIT_MK[toMk];
  const speedupPct = (() => {
    try { return require('./trophies').discountPct(user, 'modern_time'); }
    catch (e) { return 0; }
  })();
  const minutesPerUnit = Math.max(1, baseMin * (1 - speedupPct / 100));
  const durationMs = Math.round(qty * minutesPerUnit * 60 * 1000);
  const proc = {
    id: u.uid(8),
    unitId, unitName: cu.name,
    qty, fromMk, toMk,
    startedAt: now,
    finishesAt: now + durationMs,
  };
  if (!user.modernQueue) user.modernQueue = [];
  user.modernQueue.push(proc);

  const minutes = Math.ceil(durationMs / 60000);
  notices.push(`🏭 Запущена модернизация: ${qty} ед. «${cu.name}» до Mk${toMk}. Готово через ${minutes} мин.`);
  return { processId: proc.id, finishesAt: proc.finishesAt };
}

// Ускорить процесс за золото (мгновенное завершение)
function boostProcess(user, processId, notices) {
  if (!user.modernQueue) user.modernQueue = [];
  const proc = user.modernQueue.find((p) => p.id === processId);
  if (!proc) throw new u.ApiError('Процесс не найден');
  if (proc.finishesAt <= Date.now()) throw new u.ApiError('Процесс уже завершён');
  const cost = config.MODERN.BOOST_GOLD_COST;
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно ${cost})`);
  user.gold -= cost;
  proc.finishesAt = Date.now(); // refresh заберёт его при следующем запросе
  notices.push(`⚡ Модернизация «${proc.unitName}» ускорена! Партия готова.`);
  return { ok: true };
}

module.exports = { view, buyWorkshop, startModernization, boostProcess, nextWorkshopPrice };
