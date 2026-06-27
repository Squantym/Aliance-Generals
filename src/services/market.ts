// ===================================================================
// src/services/market.ts — «Чёрный рынок»
// 1) Допинг (баффы себе) и падлянки (дебаффы другим игрокам).
// 2) Контейнеры 5 уровней с секретными разработками (шанс 50–200%).
//    Полный комплект из 9 разных разработок даёт «Абсолют» бесплатно.
// 3) Аукцион: аренда уникальных командиров на 24 часа за золото.
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import social = require('./social');
import discounts = require('./discounts');
import type { User, Notices } from '../types';

// Цена в золоте у предмета рынка с учётом скидки
function marketGold(item: any): number { return discounts.applyTo('market', item.gold); }
function containerGold(c: any): number { return discounts.applyTo('container', c.gold); }

function world(): any {
  const w = db.load('world', { chat: [], auctions: [], seq: 1 });
  if (!w.auctions) w.auctions = [];
  return w;
}

// ---------- Допинг и падлянки ----------
function itemsList() {
  const withDiscount = (i) => ({ ...i, gold: marketGold(i), baseGold: i.gold });
  return {
    buffs: config.MARKET_ITEMS.filter((i) => i.kind === 'buff' || i.kind.startsWith('refill')).map(withDiscount),
    debuffs: config.MARKET_ITEMS.filter((i) => i.kind === 'debuff').map(withDiscount),
    discount: discounts.info('market'),
  };
}

// Накладывает эффект. Если эффект ТАКОГО ЖЕ типа уже есть — НЕ суммирует,
// а обновляет (значение + таймер), т.е. повторная покупка просто продлевает.
// by — игрок, наложивший эффект (для подлянок, чтобы жертва видела автора).
function pushEffect(target: User, item: any, by?: User): void {
  const expiresAt = Date.now() + (item.durMin || 0) * 60 * 1000;
  const existing = target.effects.find((e) => e.type === item.effect.type);
  if (existing) {
    // Обновляем существующий эффект того же типа (без суммирования)
    existing.value = item.effect.value;
    existing.expiresAt = expiresAt;
    existing.name = item.name;
    if (by) { existing.byId = by.id; existing.byName = by.name; existing.hostile = true; }
    return;
  }
  target.effects.push({
    id: item.id, name: item.name,
    type: item.effect.type, value: item.effect.value,
    expiresAt,
    byId: by ? by.id : undefined,
    byName: by ? by.name : undefined,
    hostile: by ? true : false,
  });
}

function buyItem(user: User, itemId: string, targetName: string, notices: Notices) {
  const item = config.MARKET_ITEM_BY_ID[itemId];
  if (!item) throw new u.ApiError('Такого товара нет на рынке');
  const price = marketGold(item);
  if (user.gold < price) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${price})`);
  require('./dailyQuests').bump(user, 'marketBought', 1);

  if (item.kind === 'debuff') {
    // Падлянка применяется к другому игроку по имени
    const target = player.findByName(targetName);
    if (!target) throw new u.ApiError('Жертва с таким именем не найдена');
    if (target.id === user.id) throw new u.ApiError('Падлянка самому себе? Оригинально, но нет.');
    user.gold -= price;
    pushEffect(target, item, user);
    social.mailTo(target, 'Чёрный рынок', 'Диверсия!',
      `Игрок ${user.name} устроил вам «${item.name}»: ${item.desc}`, user.id);
    notices.push(`😈 «${item.name}» применена к игроку ${target.name}.`);
    return { applied: target.name };
  }

  user.gold -= price;
  const mx = player.maxima(user);
  switch (item.kind) {
    case 'refill_energy':
      user.res.en.cur = mx.en;
      notices.push('⚡ Энергия полностью восстановлена.');
      break;
    case 'refill_health':
      user.res.hp.cur = mx.hp;
      notices.push('❤ Здоровье полностью восстановлено.');
      break;
    case 'refill_ammo':
      user.res.am.cur = mx.am;
      notices.push('🎯 Боеприпасы полностью восстановлены.');
      break;
    default: // обычный бафф на время
      pushEffect(user, item);
      notices.push(`💉 «${item.name}» действует ${(item.durMin || 0) / 60} ч.`);
  }
  return { ok: true };
}

// ---------- Контейнеры с секретными разработками ----------
function containersView(user: User) {
  // Для каждой разработки отдаём базу + актуальные значения (с учётом уровня
  // и бонуса от сверхсекретных), чтобы игрок видел реальную силу.
  const collection = config.SECRET_DEVS.map((d) => ({
    id: d.id, name: d.name,
    count: user.secretDevs[d.id] || 0,
    atkBase: d.atk, defBase: d.def,
    atkNow: config.secretAtk(user, d),
    defNow: config.secretDef(user, d),
  }));
  return {
    containers: config.CONTAINERS.map((c) => ({ ...c, gold: containerGold(c), baseGold: c.gold })),
    collection,
    superSecret: {
      id: config.SUPER_DEV.id,
      name: config.SUPER_DEV.name,
      count: user.superSecret,
      atkBase: config.SUPER_DEV.atk, defBase: config.SUPER_DEV.def,
      atkNow: config.secretAtk(user, config.SUPER_DEV),
      defNow: config.secretDef(user, config.SUPER_DEV),
    },
    // Сводная информация о бонусах для подсказки в UI
    levelBonusPct: user.level > 50 ? (user.level - 50) : 0,
    superBonusPct: (user.superSecret || 0) * 0.5,
    discount: discounts.info('container'),
  };
}

function openContainer(user: User, tier: number | string, notices: Notices, qty?: number) {
  const c = config.CONTAINERS.find((x) => x.tier === u.toInt(tier));
  if (!c) throw new u.ApiError('Такого контейнера не существует');
  qty = u.clamp(u.toInt(qty, 1), 1, 5);
  if (![1, 3, 5].includes(qty)) throw new u.ApiError('Можно открыть только 1, 3 или 5 контейнеров за раз');

  const unitPrice = containerGold(c);
  const totalPrice = unitPrice * qty;
  if (user.gold < totalPrice) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${totalPrice} за ${qty} шт.)`);
  require('./dailyQuests').bump(user, 'marketBought', 1);
  user.gold -= totalPrice;

  // Открываем qty контейнеров подряд, суммируя выпавшее
  const droppedAll: string[] = [];
  const droppedCount: Record<string, number> = {};
  for (let n = 0; n < qty; n++) {
    // Шанс 150% = 1 гарантированная разработка + 50% на вторую
    let drops = Math.floor(c.chance / 100);
    if (Math.random() * 100 < c.chance % 100) drops++;
    for (let i = 0; i < drops; i++) {
      const dev = u.pick(config.SECRET_DEVS);
      user.secretDevs[dev.id] = (user.secretDevs[dev.id] || 0) + 1;
      droppedAll.push(dev.name);
      droppedCount[dev.name] = (droppedCount[dev.name] || 0) + 1;
    }
  }

  if (droppedAll.length === 0) {
    notices.push(`📦 Открыто ${qty} контейнер(ов) — пусто. На войне бывает и так.`);
  } else {
    notices.push(`📦 Открыто ${qty} контейнер(ов). Выпало: ${droppedAll.join(', ')}!`);
  }

  // Проверяем, не собрался ли полный комплект из 9 разработок
  player.syncSuper(user, notices);

  // Сохраняем в историю открытий (последние 10)
  const historyEntry = {
    id: u.uid(8), tier: c.tier, tierName: c.name, qty,
    spent: totalPrice, dropped: droppedCount, at: Date.now(),
  };
  if (!user.containerHistory) user.containerHistory = [];
  user.containerHistory.unshift(historyEntry);
  if (user.containerHistory.length > 10) user.containerHistory.length = 10;

  return { drops: droppedAll, droppedCount, qty, spent: totalPrice, history: historyEntry };
}

// ---------- Аукцион командиров ----------
// Время окончания текущего аукциона: ближайшие 23:59:59 по Москве (UTC+3).
// Эффекты начинают действовать в 00:00 (сразу после закрытия).
function auctionEndMsk(now: number): number {
  const MSK_OFFSET = 3 * 3600 * 1000;
  const mskNow = new Date(now + MSK_OFFSET);
  // Конец текущих МСК-суток: 23:59:59.999
  const endMsk = Date.UTC(
    mskNow.getUTCFullYear(), mskNow.getUTCMonth(), mskNow.getUTCDate(),
    23, 59, 59, 999
  );
  // Переводим обратно в реальное (серверное UTC) время
  return endMsk - MSK_OFFSET;
}

function makeLotFor(commander: any, now: number): any {
  return {
    id: u.uid(10),
    commanderId: commander.id,
    minBid: config.AUCTION.MIN_BID,
    best: null, // { userId, name, amount }
    endsAt: auctionEndMsk(now),
  };
}

function makeLot(now: number): any {
  return makeLotFor(u.pick(config.COMMANDERS), now);
}

// Применяет эффект выигранного наёмника победителю.
// Некоторые наёмники дают нестандартные эффекты (комбо, флаги).
function applyCommanderEffect(winner: User, commander: any, now: number): void {
  const expiresAt = now + config.AUCTION.RENT_HOURS * 3600 * 1000;
  const eff = commander.effect;
  const pushOne = (type: string, value: number) => {
    const ex = winner.effects.find((e) => e.type === type);
    if (ex) { ex.value = value; ex.expiresAt = expiresAt; ex.name = commander.name; }
    else winner.effects.push({ id: 'cmd_' + commander.id + '_' + type, name: commander.name, type, value, expiresAt });
  };
  if (eff.type === 'economy_combo') {
    // Содержание −100% и доход +100%
    pushOne('upkeep_pct', -100);
    pushOne('income_pct', 100);
  } else {
    // Обычные и флаговые эффекты (atk_pct, def_pct, invite_unlimited, fatality_immunity)
    pushOne(eff.type, eff.value);
  }
}

// Фоновый тик: закрываем лоты после 23:59:59 МСК, выдаём наёмников
// победителям (эффект действует с 00:00), создаём лоты на новые сутки.
function tick(): void {
  const w = world();
  const now = Date.now();
  const users = player.users();

  for (let i = w.auctions.length - 1; i >= 0; i--) {
    const lot = w.auctions[i];
    if (lot.endsAt > now) continue;
    const commander = config.COMMANDERS.find((c) => c.id === lot.commanderId);
    if (lot.best && commander) {
      const winner = users[lot.best.userId];
      if (winner) {
        applyCommanderEffect(winner, commander, now);
        social.systemMail(winner, 'Аукцион выигран!',
          `${commander.name} поступает в ваше распоряжение на ${config.AUCTION.RENT_HOURS} часа. ${commander.desc}.`);
      }
    }
    w.auctions.splice(i, 1);
  }
  while (w.auctions.length < config.AUCTION.LOTS) {
    // Берём наёмников, которых ещё нет на аукционе, чтобы все 5 были
    // уникальными (а не случайные повторы).
    const taken = new Set(w.auctions.map((l: any) => l.commanderId));
    const available = config.COMMANDERS.filter((c: any) => !taken.has(c.id));
    const commander = available.length ? available[0] : u.pick(config.COMMANDERS);
    w.auctions.push(makeLotFor(commander, now));
  }
  db.save('world');
}

function auctionView() {
  tick();
  const now = Date.now();
  return {
    lots: world().auctions.map((lot) => {
      const c = config.COMMANDERS.find((x: any) => x.id === lot.commanderId) || { name: '?', desc: '' };
      return {
        id: lot.id,
        commander: { name: c.name, desc: c.desc },
        minBid: lot.best ? lot.best.amount + config.AUCTION.BID_STEP : lot.minBid,
        best: lot.best ? { name: lot.best.name, amount: lot.best.amount } : null,
        endsInSec: Math.max(0, Math.ceil((lot.endsAt - now) / 1000)),
      };
    }),
    rentHours: config.AUCTION.RENT_HOURS,
    minBid: config.AUCTION.MIN_BID,
    bidStep: config.AUCTION.BID_STEP,
  };
}

function bid(user: User, lotId: string, amount: number, notices: Notices) {
  tick();
  const w = world();
  const lot = w.auctions.find((l) => l.id === lotId);
  if (!lot) throw new u.ApiError('Лот уже закрыт. Обновите аукцион.');
  amount = u.toInt(amount);
  // Минимум: первая ставка — MIN_BID (500), далее +BID_STEP (50) к текущей
  const min = lot.best ? lot.best.amount + config.AUCTION.BID_STEP : lot.minBid;
  if (amount < min) throw new u.ApiError(`Минимальная ставка: 🪙 ${min}`);
  // Ставка должна быть кратна шагу относительно минимума
  if ((amount - lot.minBid) % config.AUCTION.BID_STEP !== 0) {
    throw new u.ApiError(`Ставка должна быть кратна шагу 🪙 ${config.AUCTION.BID_STEP} (например ${min}, ${min + config.AUCTION.BID_STEP})`);
  }
  if (user.gold < amount) throw new u.ApiError('Не хватает золота для ставки');
  if (lot.best && lot.best.userId === user.id) throw new u.ApiError('Ваша ставка и так лидирует');

  // Возвращаем золото предыдущему лидеру и уведомляем его
  if (lot.best) {
    const prev = player.users()[lot.best.userId];
    if (prev) {
      prev.gold += lot.best.amount;
      social.systemMail(prev, 'Аукцион: ставку перебили',
        `Вашу ставку 🪙 ${lot.best.amount} перебил ${user.name}. Золото возвращено.`);
    }
  }
  user.gold -= amount;
  lot.best = { userId: user.id, name: user.name, amount };
  db.save('world');
  notices.push(`🔨 Ставка 🪙 ${amount} принята. Вы — лидер лота!`);
  return { lotId, amount };
}

function containerHistory(user: User) {
  return { history: user.containerHistory || [] };
}

export = { itemsList, buyItem, containersView, openContainer, containerHistory, auctionView, bid, tick };
