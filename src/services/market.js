// ===================================================================
// src/services/market.js — «Чёрный рынок»
// 1) Допинг (баффы себе) и падлянки (дебаффы другим игрокам).
// 2) Контейнеры 5 уровней с секретными разработками (шанс 50–200%).
//    Полный комплект из 9 разных разработок даёт «Абсолют» бесплатно.
// 3) Аукцион: аренда уникальных командиров на 24 часа за золото.
// ===================================================================

const config = require('../../config/gameConfig');
const db = require('../core/db');
const u = require('../core/utils');
const player = require('./player');
const social = require('./social');
const discounts = require('./discounts');

// Цена в золоте у предмета рынка с учётом скидки
function marketGold(item) { return discounts.applyTo('market', item.gold); }
function containerGold(c) { return discounts.applyTo('container', c.gold); }

function world() {
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

function pushEffect(target, item) {
  target.effects.push({
    id: item.id, name: item.name,
    type: item.effect.type, value: item.effect.value,
    expiresAt: Date.now() + item.durMin * 60 * 1000,
  });
}

function buyItem(user, itemId, targetName, notices) {
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
    pushEffect(target, item);
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
      notices.push(`💉 «${item.name}» действует ${item.durMin / 60} ч.`);
  }
  return { ok: true };
}

// ---------- Контейнеры с секретными разработками ----------
function containersView(user) {
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

function openContainer(user, tier, notices) {
  const c = config.CONTAINERS.find((x) => x.tier === u.toInt(tier));
  if (!c) throw new u.ApiError('Такого контейнера не существует');
  const price = containerGold(c);
  if (user.gold < price) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${price})`);
  require('./dailyQuests').bump(user, 'marketBought', 1);
  user.gold -= price;

  // Шанс 150% = 1 гарантированная разработка + 50% на вторую
  let drops = Math.floor(c.chance / 100);
  if (Math.random() * 100 < c.chance % 100) drops++;

  const dropped = [];
  for (let i = 0; i < drops; i++) {
    const dev = u.pick(config.SECRET_DEVS);
    user.secretDevs[dev.id] = (user.secretDevs[dev.id] || 0) + 1;
    dropped.push(dev.name);
  }
  if (dropped.length === 0) {
    notices.push('📦 Контейнер оказался пуст. На войне бывает и так.');
  } else {
    notices.push(`📦 Из контейнера выпало: ${dropped.join(', ')}!`);
  }
  // Проверяем, не собрался ли полный комплект из 9 разработок
  player.syncSuper(user, notices);
  return { drops: dropped };
}

// ---------- Аукцион командиров ----------
function makeLot(now) {
  const commander = u.pick(config.COMMANDERS);
  return {
    id: u.uid(10),
    commanderId: commander.id,
    minBid: config.AUCTION.MIN_BID,
    best: null, // { userId, name, amount }
    endsAt: now + config.AUCTION.DURATION_MIN * 60 * 1000 + u.rnd(0, 120) * 60 * 1000,
  };
}

// Фоновый тик: закрываем истёкшие лоты, выдаём командиров победителям,
// поддерживаем нужное количество активных лотов.
function tick() {
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
        winner.effects.push({
          id: 'cmd_' + commander.id, name: commander.name,
          type: commander.effect.type, value: commander.effect.value,
          expiresAt: now + config.AUCTION.RENT_HOURS * 3600 * 1000,
        });
        social.systemMail(winner, 'Аукцион выигран!',
          `${commander.name} поступает в ваше распоряжение на ${config.AUCTION.RENT_HOURS} часа. ${commander.desc}.`);
      }
    }
    w.auctions.splice(i, 1);
  }
  while (w.auctions.length < config.AUCTION.LOTS) {
    w.auctions.push(makeLot(now));
  }
  db.save('world');
}

function auctionView() {
  tick();
  const now = Date.now();
  return {
    lots: world().auctions.map((lot) => {
      const c = config.COMMANDERS.find((x) => x.id === lot.commanderId);
      return {
        id: lot.id,
        commander: { name: c.name, desc: c.desc },
        minBid: lot.best ? Math.ceil(lot.best.amount * config.AUCTION.STEP) : lot.minBid,
        best: lot.best ? { name: lot.best.name, amount: lot.best.amount } : null,
        endsInSec: Math.max(0, Math.ceil((lot.endsAt - now) / 1000)),
      };
    }),
    rentHours: config.AUCTION.RENT_HOURS,
  };
}

function bid(user, lotId, amount, notices) {
  tick();
  const w = world();
  const lot = w.auctions.find((l) => l.id === lotId);
  if (!lot) throw new u.ApiError('Лот уже закрыт. Обновите аукцион.');
  amount = u.toInt(amount);
  const min = lot.best ? Math.ceil(lot.best.amount * config.AUCTION.STEP) : lot.minBid;
  if (amount < min) throw new u.ApiError(`Минимальная ставка: 🪙 ${min}`);
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

module.exports = { itemsList, buyItem, containersView, openContainer, auctionView, bid, tick };
