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
import notifications = require('./notifications');
import discounts = require('./discounts');
import landmines = require('./landmines');
import type { User, Notices } from '../types';

// Цена в золоте у предмета рынка с учётом скидки
function marketGold(item: any, user?: any): number { return discounts.applyTo('market', item.gold, user); }
function containerGold(c: any, user?: any): number { return discounts.applyTo('container', c.gold, user); }

function world(): any {
  const w = db.load('world', { chat: [], auctions: [], seq: 1 });
  if (!w.auctions) w.auctions = [];
  return w;
}

// ---------- Допинг и падлянки ----------
function itemsList(user?: any) {
  const withDiscount = (i) => ({ ...i, gold: marketGold(i, user), baseGold: i.gold });
  return {
    buffs: config.MARKET_ITEMS.filter((i) => i.kind === 'buff' || i.kind.startsWith('refill')).map(withDiscount),
    debuffs: config.MARKET_ITEMS.filter((i) => i.kind === 'debuff').map(withDiscount),
    discount: discounts.info('market'),
  };
}

// ---------- Мины («Растяжка») ----------
function mineInfo(user: User) {
  const item = config.MARKET_ITEM_BY_ID['landmine'];
  return {
    price: marketGold(item, user), basePrice: item.gold,
    stock: user.landmines || 0, maxStock: landmines.maxStock(),
    maxBuyPerOrder: config.MINES.maxBuyPerOrder,
  };
}

function buyMines(user: User, qty: number, notices: Notices) {
  const item = config.MARKET_ITEM_BY_ID['landmine'];
  // Скидка на золото применяется так же, как и к прочим товарам рынка
  const unitPrice = marketGold(item, user);
  const q = Math.max(1, Math.min(config.MINES.maxBuyPerOrder, Math.floor(qty) || 0));
  const have = user.landmines || 0;
  const room = Math.max(0, config.MINES.maxStock - have);
  if (room <= 0) throw new u.ApiError(`Уже максимум мин в запасе (${config.MINES.maxStock})`);
  const bought = Math.min(q, room);
  const cost = bought * unitPrice;
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  player.spendGold(user, cost, 'market');
  user.landmines = have + bought;
  require('./dailyQuests').bump(user, 'marketBought', 1);
  notices.push(`💣 Куплено мин: ${bought} (за 🪙 ${cost}). В запасе: ${user.landmines}.`);
  return { bought, cost, stock: user.landmines };
}

// Накладывает эффект. Если эффект ТАКОГО ЖЕ типа уже есть — НЕ суммирует,
// а обновляет (значение + таймер), т.е. повторная покупка просто продлевает.
// by — игрок, наложивший эффект (для подлянок, чтобы жертва видела автора).
function pushEffect(target: User, item: any, by?: User): void {
  const now = Date.now();
  const addMs = (item.durMin || 0) * 60 * 1000;
  const DAY_MS = 24 * 3600 * 1000;
  const hostile = !!by;
  // Ищем эффект того же типа И той же природы (допинг ≠ падлянка), чтобы
  // бафф и дебафф одного типа не перезаписывали друг друга.
  // ВАЖНО: эффекты наёмников (merc) исключены — иначе купленный поверх
  // наёмника допинг затирал его бонус, и игрок терял оплаченные +100%.
  // Наёмник и допинг живут отдельными эффектами и суммируются в effMul.
  const existing = target.effects.find(
    (e) => e.type === item.effect.type && !!e.hostile === hostile && !(e as any).merc
  );
  if (existing) {
    // СУММИРУЕМ время: оставшееся + новая длительность.
    const remaining = Math.max(0, existing.expiresAt - now);
    let newExpires = now + remaining + addMs;
    // Падлянки суммируются, но действуют не дольше 24 часов от текущего момента.
    if (hostile) newExpires = Math.min(newExpires, now + DAY_MS);
    existing.value = item.effect.value;
    existing.expiresAt = newExpires;
    existing.name = item.name;
    existing.id = item.id;
    if (by) { existing.byId = by.id; existing.byName = by.name; existing.hostile = true; }
    return;
  }
  let expiresAt = now + addMs;
  if (hostile) expiresAt = Math.min(expiresAt, now + DAY_MS);
  target.effects.push({
    id: item.id, name: item.name,
    type: item.effect.type, value: item.effect.value,
    expiresAt,
    byId: by ? by.id : undefined,
    byName: by ? by.name : undefined,
    hostile,
  });
}

function buyItem(user: User, itemId: string, targetName: string, notices: Notices) {
  const item = config.MARKET_ITEM_BY_ID[itemId];
  if (!item) throw new u.ApiError('Такого товара нет на рынке');
  const price = marketGold(item, user);
  if (user.gold < price) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${price})`);

  // Счётчики поручений двигаем ТОЛЬКО после того, как покупка состоялась.
  // Раньше они стояли здесь, до проверки жертвы: запрос с несуществующим
  // именем падал ошибкой, золото не списывалось — а прогресс поручения
  // засчитывался. Отменённый запрос не откатывает уже изменённого игрока,
  // поэтому «Скупщик» и контрабандные поручения закрывались бесплатно,
  // одной и той же неудачной покупкой подряд.
  const countBuy = () => {
    require('./dailyQuests').bump(user, 'marketBought', 1);
    // Отдельный счётчик по КОНКРЕТНОМУ товару: поручения на контрабанду
    // называют товар явно, поэтому общего счётчика покупок им мало
    require('./dailyQuests').bump(user, 'buy:' + item.id, 1);
    // И сколько золота на него ФАКТИЧЕСКИ ушло: поручение возвращает
    // половину потраченного, а цена бывает со скидкой.
    require('./dailyQuests').bump(user, 'goldOn:' + item.id, price);
  };

  if (item.kind === 'debuff') {
    // Падлянка применяется к другому игроку по имени
    const target = player.findByName(targetName);
    if (!target) throw new u.ApiError('Жертва с таким именем не найдена');
    if (target.id === user.id) throw new u.ApiError('Падлянка самому себе? Оригинально, но нет.');
    // И своему же второму персонажу — тоже: это способ обнулить эффект
    require('./account').assertNotSelfAccount(user, target, 'Применение падлянки');
    player.spendGold(user, price, 'market');
    countBuy();
    pushEffect(target, item, user);
    // Жертву помечаем к записи явно: слой http сохраняет только автора
    // запроса. Без этого падлянка жила лишь в памяти процесса и исчезала
    // при перезапуске — золото у покупателя списано, эффекта нет.
    db.markUser(target.id);
    notifications.push(target.id, 'debuff_applied', 'Диверсия!',
      { text: `Игрок ${user.name} устроил вам «${item.name}»: ${item.desc}`, byId: user.id, byName: user.name });
    notices.push(`😈 «${item.name}» применена к игроку ${target.name}.`);
    return { applied: target.name };
  }

  player.spendGold(user, price, 'market');
  countBuy();
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
    containers: config.CONTAINERS.map((c) => ({
      ...c, gold: containerGold(c, user), baseGold: c.gold,
      owned: ownedCount(user, c.tier),
      // Деньги считаются от цены техники игрока: «20-50 единиц» игроку
      // ни о чём не говорит, поэтому показываем готовые суммы
      money: [c.moneyUnits[0] * unitPrice(user), c.moneyUnits[1] * unitPrice(user)],
    })),
    buyQty: config.CONTAINER_BUY_QTY,
    openQty: config.CONTAINER_OPEN_QTY,
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

// ---------- Склад контейнеров ----------
// Купленный контейнер больше не вскрывается сам: он ложится на склад, и
// игрок решает, когда и сколько открыть. Покупка пачкой раньше означала
// пачку окон с добычей подряд, в которых ничего нельзя было рассмотреть.
function ownedBox(user: any): Record<string, number> {
  if (!user.containersOwned || typeof user.containersOwned !== 'object') user.containersOwned = {};
  return user.containersOwned;
}
function ownedCount(user: any, tier: number): number {
  return Math.max(0, u.toInt(ownedBox(user)[String(tier)], 0));
}
// Положить на склад: зовут покупка на рынке и наборы «Спецпредложений».
function addContainers(user: any, tier: number, qty: number): number {
  const box = ownedBox(user);
  box[String(tier)] = ownedCount(user, tier) + Math.max(0, u.toInt(qty, 0));
  db.markUser(user.id);
  return box[String(tier)];
}

// Цена самой свежей наземной техники игрока. В ней меряются денежные
// награды по всей игре — контейнеры не исключение, иначе на 40 уровне
// выпадала бы сумма, интересная только на третьем.
function unitPrice(user: User): number {
  return config.minUnitPriceAtLevel(user.level || 1);
}

// Шанс больше 100%: целая часть — гарантированные штуки, остаток —
// вероятность ещё одной. 150% = одна гарантированно + 50% на вторую.
function rollCount(chance: number): number {
  const ch = Number(chance) || 0;
  let n = Math.floor(ch / 100);
  if (Math.random() * 100 < ch % 100) n++;
  return n;
}

// Обычные виды диверсантов. Секретные и смертники сюда не входят: они
// бьют по более ценным целям и лежат только в старших ящиках.
const SAB_REGULAR: Array<'ground' | 'sea' | 'air' | 'building'> = ['ground', 'sea', 'air', 'building'];

type Loot = {
  // Разработки — по идентификатору: окно добычи показывает картинку
  // /img/secret/<id>.webp, а по названию её не найти
  devs: Record<string, number>;      // секретные разработки: id → сколько
  doping: Record<string, number>;    // допинг: название → сколько
  money: number;                     // деньги
  sab: Record<string, number>;       // диверсанты: вид → сколько
};
function emptyLoot(): Loot { return { devs: {}, doping: {}, money: 0, sab: {} }; }

// Допинг из контейнера действует сразу: склада предметов в игре нет,
// купленный на рынке допинг тоже применяется в момент покупки.
const DOPING_POOL = (config.MARKET_ITEMS as any[]).filter(
  (i) => i.kind === 'buff' || String(i.kind).startsWith('refill'));
function applyDoping(user: User, item: any, notices: Notices): void {
  const mx = player.maxima(user);
  switch (item.kind) {
    case 'refill_energy': user.res.en.cur = mx.en; break;
    case 'refill_health': user.res.hp.cur = mx.hp; break;
    case 'refill_ammo':   user.res.am.cur = mx.am; break;
    default: pushEffect(user, item);
  }
  notices.push(`💉 Из контейнера: «${item.name}».`);
}

// Добыча ОДНОГО контейнера. Всё выпавшее копится в loot: окно с
// результатом показывает итог по пачке, а не по каждому ящику отдельно.
function rollOne(user: User, c: any, loot: Loot, notices: Notices): void {
  // Секретные разработки — как и раньше, по chance контейнера
  for (let i = 0; i < rollCount(c.chance); i++) {
    const dev = u.pick(config.SECRET_DEVS);
    user.secretDevs[dev.id] = (user.secretDevs[dev.id] || 0) + 1;
    loot.devs[dev.id] = (loot.devs[dev.id] || 0) + 1;
  }
  // Допинг
  for (let i = 0; i < rollCount(c.doping || 0); i++) {
    const item = u.pick(DOPING_POOL);
    applyDoping(user, item, notices);
    loot.doping[item.name] = (loot.doping[item.name] || 0) + 1;
  }
  // Деньги — в единицах цены техники игрока
  const units = c.moneyUnits ? u.rnd(c.moneyUnits[0], c.moneyUnits[1]) : 0;
  if (units > 0) {
    const money = units * unitPrice(user);
    player.addMoney(user, money, false);
    loot.money += money;
  }
  // Диверсанты. Секретные и смертники — ЧАСТЬ общего числа, а не сверх
  // него: иначе старший ящик давал бы вдвое больше обещанного.
  const total = c.sab ? u.rnd(c.sab[0], c.sab[1]) : 0;
  if (total > 0) {
    require('./saboteurs').ensure(user);
    const secret = c.sabSecretMax ? u.rnd(0, Math.min(c.sabSecretMax, total)) : 0;
    const suicide = c.sabSuicideMax ? u.rnd(0, Math.min(c.sabSuicideMax, total - secret)) : 0;
    const add = (kind: string, n: number) => {
      if (n <= 0) return;
      (user.saboteurs as any)[kind] = ((user.saboteurs as any)[kind] || 0) + n;
      loot.sab[kind] = (loot.sab[kind] || 0) + n;
    };
    add('secret', secret);
    add('suicide', suicide);
    for (let left = total - secret - suicide; left > 0; left--) add(u.pick(SAB_REGULAR), 1);
  }
}

// Выдача содержимого контейнеров БЕЗ оплаты и БЕЗ склада. Отдельно от
// покупки, потому что открывать умеет не только чёрный рынок.
function openContainersFree(user: User, c: any, qty: number, notices: Notices): { droppedAll: string[]; droppedCount: Record<string, number>; loot: Loot & { devList: Array<{ id: string; name: string; count: number }> } } {
  // Количество приводим здесь же: функцию зовёт и рынок, и наборы
  // «Спецпредложений», и надеяться, что каждый вызывающий проверил число
  // за нас, — ровно тот случай, когда однажды не проверит.
  const count = u.clamp(u.toInt(qty, 1), 1, 100);
  const loot = emptyLoot();
  for (let n = 0; n < count; n++) rollOne(user, c, loot, notices);

  // Наружу и в историю — по названиям: их читает человек. Внутри — по id.
  const devName = (id: string) => (config.SECRET_DEV_BY_ID[id] || { name: id }).name;
  const droppedCount: Record<string, number> = {};
  const droppedAll: string[] = [];
  for (const [id, n] of Object.entries(loot.devs)) {
    droppedCount[devName(id)] = n;
    for (let i = 0; i < n; i++) droppedAll.push(devName(id));
  }
  const parts: string[] = [];
  if (droppedAll.length) parts.push(Object.entries(droppedCount).map(([n, k]) => `${n} ×${k}`).join(', '));
  if (loot.money > 0) parts.push(`$ ${loot.money.toLocaleString('ru-RU')}`);
  const sabTotal = Object.values(loot.sab).reduce((a, b) => a + b, 0);
  if (sabTotal > 0) parts.push(`диверсантов ×${sabTotal}`);
  notices.push(parts.length
    ? `📦 Открыто ${count} контейнер(ов). Выпало: ${parts.join('; ')}!`
    : `📦 Открыто ${count} контейнер(ов) — пусто. На войне бывает и так.`);

  // Проверяем, не собрался ли полный комплект из 9 разработок
  player.syncSuper(user, notices);
  db.markUser(user.id);
  // devList — то, что рисует окно добычи: картинка, название, сколько
  const devList = Object.entries(loot.devs).map(([id, n]) => ({ id, name: devName(id), count: n }));
  return { droppedAll, droppedCount, loot: { ...loot, devList } };
}

// Наёмник на СРОК: аукцион даёт сутки, админ — сколько скажет, набор
// «Спецпредложения» — сколько записано в наборе. Одна дверь на всех.
function grantCommanderDays(user: User, commanderId: string, days: number, notices: Notices): any {
  const commander = config.COMMANDERS.find((m: any) => m.id === commanderId);
  if (!commander) throw new u.ApiError('Наёмник не найден');
  const d = Math.max(1, u.toInt(days, 1));
  const now = Date.now();
  const existing = (user.effects || []).find(
    (e: any) => e.commanderId === commander.id && e.expiresAt > now
  );
  const base = existing ? existing.expiresAt : now;
  const expiresAt = base + d * 24 * 3600 * 1000;
  applyCommanderUntil(user, commander, expiresAt);
  db.markUser(user.id);
  if (notices) {
    notices.push(`🎖 Наёмник «${commander.name}» с вами ${d} дн.` +
      (existing ? ' (срок продлён)' : ''));
  }
  return { commanderId: commander.id, name: commander.name, days: d, expiresAt };
}

// ---------- Покупка контейнеров на склад ----------
function buyContainers(user: User, tier: number | string, qty: number, notices: Notices) {
  const c = config.CONTAINERS.find((x) => x.tier === u.toInt(tier));
  if (!c) throw new u.ApiError('Такого контейнера не существует');
  const n = u.toInt(qty, 1);
  if (!config.CONTAINER_BUY_QTY.includes(n)) {
    throw new u.ApiError(`Купить можно ${config.CONTAINER_BUY_QTY.join(', ')} контейнеров за раз`);
  }
  const unit = containerGold(c, user);
  const total = unit * n;
  if (user.gold < total) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${total} за ${n} шт.)`);

  require('./dailyQuests').bump(user, 'marketBought', 1);
  // Счётчик по конкретному контейнеру (для поручений на контрабанду)
  require('./dailyQuests').bump(user, 'buy:' + c.id, n);
  // Потраченное золото — по факту, со скидкой: половину от него вернёт
  // поручение на контрабанду.
  require('./dailyQuests').bump(user, 'goldOn:' + c.id, total);
  player.spendGold(user, total, 'container');
  const owned = addContainers(user, c.tier, n);
  notices.push(`📦 Куплено: «${c.name}» ×${n}. На складе: ${owned} — откройте, когда будете готовы.`);
  return { tier: c.tier, bought: n, owned, spent: total };
}

// ---------- Открытие со склада ----------
// qty: 1, 3, 5 или 'all'. Золото здесь не списывается — за контейнер уже
// заплачено при покупке.
function openOwned(user: User, tier: number | string, qty: number | string, notices: Notices) {
  const c = config.CONTAINERS.find((x) => x.tier === u.toInt(tier));
  if (!c) throw new u.ApiError('Такого контейнера не существует');
  const have = ownedCount(user, c.tier);
  if (have <= 0) throw new u.ApiError('На складе нет таких контейнеров — сначала купите');
  const all = String(qty) === 'all';
  const want = all ? have : u.toInt(qty, 1);
  if (!all && !config.CONTAINER_OPEN_QTY.includes(want)) {
    throw new u.ApiError(`Открыть можно ${config.CONTAINER_OPEN_QTY.join(', ')} контейнеров за раз или все сразу`);
  }
  if (want > have) throw new u.ApiError(`На складе только ${have} шт.`);

  ownedBox(user)[String(c.tier)] = have - want;
  const { droppedAll, droppedCount, loot } = openContainersFree(user, c, want, notices);

  // История последних 10 открытий
  const historyEntry = {
    id: u.uid(8), tier: c.tier, tierName: c.name, qty: want,
    spent: 0, dropped: droppedCount, at: Date.now(),
    money: loot.money, doping: loot.doping, sab: loot.sab,
  };
  if (!user.containerHistory) user.containerHistory = [];
  user.containerHistory.unshift(historyEntry);
  if (user.containerHistory.length > 10) user.containerHistory.length = 10;
  db.markUser(user.id);

  return { drops: droppedAll, droppedCount, loot, qty: want, owned: ownedCount(user, c.tier), spent: 0, history: historyEntry };
}

// ---------- Аукцион командиров ----------
// Время окончания текущего аукциона: ближайшие 23:59:59 по Москве (UTC+3).
// Эффекты начинают действовать в 00:00 (сразу после закрытия).
function auctionEndMsk(now: number): number {
  const MSK_OFFSET = u.MSK_OFFSET_MS;
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
    // Начальная ставка записывается В ЛОТ: поменяли её в конфиге —
    // висящие лоты подтягиваются в tick(), пока по ним нет ставок
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
  applyCommanderUntil(winner, commander, now + config.AUCTION.RENT_HOURS * 3600 * 1000);
}

// Базовая выдача наёмника до указанного момента времени.
// Используется и аукционом (срок = аренда), и админ-выдачей (срок любой).
function applyCommanderUntil(winner: User, commander: any, expiresAt: number): void {
  const eff = commander.effect;
  const pushOne = (type: string, value: number) => {
    const id = 'cmd_' + commander.id + '_' + type;
    // Ищем ТОЛЬКО собственный эффект этого же наёмника: раньше здесь
    // бралcя любой эффект того же типа, поэтому выдача наёмника затирала
    // купленный допинг (а заодно могла превратить вражескую падлянку в
    // бафф, сохранив ей пометку «враждебный»). Теперь допинг, падлянка и
    // наёмник — независимые эффекты, которые складываются в effMul.
    const ex = winner.effects.find(
      (e) => e.type === type && (e as any).merc && (e as any).commanderId === commander.id
    );
    if (ex) {
      // Повторная выдача того же наёмника — продлеваем/обновляем его же эффект
      ex.value = value; ex.expiresAt = expiresAt; ex.name = commander.name;
      ex.id = id; (ex as any).commanderId = commander.id; (ex as any).merc = true;
    } else {
      winner.effects.push({ id, name: commander.name, type, value, expiresAt,
        commanderId: commander.id, merc: true } as any);
    }
  };
  if (eff.type === 'economy_combo') {
    // Содержание −100% и доход +100%
    pushOne('upkeep_pct', -100);
    pushOne('income_pct', 100);
  } else {
    // Обычные и флаговые эффекты (atk_pct, def_pct, invite_unlimited, breach_immunity)
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
        // Лот закрывает ФОНОВЫЙ тик, а не запрос победителя: пометить его
        // к записи некому. Без этой строки выигранный наёмник существовал
        // только в памяти — перезапуск процесса стирал его вместе с
        // потраченным золотом.
        db.markUser(winner.id);
        notifications.push(winner.id, 'auction_won', 'Аукцион выигран!',
          { text: `${commander.name} поступает в ваше распоряжение на ${config.AUCTION.RENT_HOURS} часа. ${commander.desc}.` });
      }
    }
    w.auctions.splice(i, 1);
  }
  // Начальную ставку поменяли в конфиге — подтягиваем висящие лоты, по
  // которым ещё никто не торговался. Иначе новая цена начала бы работать
  // только со следующих суток, а игроки видели бы старую.
  for (const lot of w.auctions) {
    if (!lot.best && lot.minBid !== config.AUCTION.MIN_BID) lot.minBid = config.AUCTION.MIN_BID;
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
  // Кто сейчас владеет наёмниками (активный эффект, выигранный на аукционе).
  // Эффекты наёмников имеют id вида cmd_{commanderId}_{type}.
  const holders: any[] = [];
  const seen = new Set<string>();
  for (const usr of Object.values(player.users())) {
    for (const e of (usr.effects || [])) {
      if (typeof e.id === 'string' && e.id.startsWith('cmd_') && e.expiresAt > now) {
        const cmdId = e.id.split('_')[1];
        const key = usr.id + '_' + cmdId;
        if (seen.has(key)) continue;
        seen.add(key);
        const c = config.COMMANDERS.find((x: any) => x.id === cmdId);
        if (c) {
          holders.push({
            commanderName: c.name,
            holderId: usr.id,
            holderName: usr.name,
            expiresInSec: Math.max(0, Math.ceil((e.expiresAt - now) / 1000)),
          });
        }
      }
    }
  }

  return {
    lots: world().auctions.map((lot) => {
      const c = config.COMMANDERS.find((x: any) => x.id === lot.commanderId) || { id: '?', name: '?', desc: '' };
      return {
        id: lot.id,
        commander: { id: c.id, name: c.name, desc: c.desc },
        minBid: lot.best ? lot.best.amount + config.AUCTION.BID_STEP : lot.minBid,
        best: lot.best ? { name: lot.best.name, amount: lot.best.amount } : null,
        endsInSec: Math.max(0, Math.ceil((lot.endsAt - now) / 1000)),
      };
    }),
    holders,
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
  // Минимум: первая ставка — MIN_BID, далее +BID_STEP к текущей
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
      player.addGold(prev, lot.best.amount, 'auction_refund');
      // Возврат золота — правка ЧУЖОГО игрока, а http сохраняет только
      // того, кто перебил ставку. Прежний лидер терял возврат при
      // перезапуске: его ставка уже списана, а вернувшееся золото жило
      // в памяти. Помечаем явно.
      db.markUser(prev.id);
      notifications.push(prev.id, 'auction_outbid', 'Аукцион: ставку перебили',
        { text: `Вашу ставку 🪙 ${lot.best.amount} перебил ${user.name}. Золото возвращено.` });
    }
  }
  player.spendGold(user, amount, 'market');
  lot.best = { userId: user.id, name: user.name, amount };
  db.save('world');
  notices.push(`🔨 Ставка 🪙 ${amount} принята. Вы — лидер лота!`);
  return { lotId, amount };
}

function containerHistory(user: User) {
  return { history: user.containerHistory || [] };
}

// ══════════════════════════════════════════════════════════════════
// АДМИН: выдача наёмников В ОБХОД АУКЦИОНА
// Аукцион и его логика (лоты, ставки, победители, holders) НЕ трогаются —
// админская выдача просто вешает игроку тот же эффект наёмника напрямую.
// «Количество» = число суток аренды (каждое = AUCTION.RENT_HOURS часов).
// Если наёмник уже активен — срок ПРОДЛЕВАЕТСЯ от текущего окончания.
// ══════════════════════════════════════════════════════════════════

// Список наёмников для админ-панели (id, имя, что даёт)
function adminCommandersList(): any {
  return {
    rentHours: config.AUCTION.RENT_HOURS,
    commanders: config.COMMANDERS.map((m: any) => ({
      id: m.id, name: m.name, desc: m.desc || '',
      effectType: m.effect.type, effectValue: m.effect.value,
    })),
  };
}

function adminGrantCommander(adminUser: User, body: any, notices: Notices): any {
  require('./roles').assertZone(adminUser, 'economy', 'выдача наёмников');
  const pl = require('./player');
  const users = pl.users();

  // Цель: по id или по позывному
  let target: any = body.userId ? users[body.userId] : null;
  if (!target && body.name) target = pl.findByName(String(body.name));
  if (!target) throw new u.ApiError('Игрок не найден');

  const commander = config.COMMANDERS.find((m: any) => m.id === body.commanderId);
  if (!commander) throw new u.ApiError('Наёмник не найден');

  // Количество (суток аренды). Разрешаем сколько угодно, но не 0/минус.
  const count = Math.max(1, u.toInt(body.count, 1));
  const addMs = count * config.AUCTION.RENT_HOURS * 3600 * 1000;

  // Если этот наёмник уже активен — продлеваем от текущего окончания
  const now = Date.now();
  const existing = (target.effects || []).find(
    (e: any) => e.commanderId === commander.id && e.expiresAt > now
  );
  const base = existing ? existing.expiresAt : now;
  const expiresAt = base + addMs;

  applyCommanderUntil(target, commander, expiresAt);
  db.markUser(target.id);

  const untilStr = new Date(expiresAt).toLocaleString('ru-RU');
  const hours = Math.round((expiresAt - now) / 3600000);
  notices.push(`🎖 Наёмник «${commander.name}» выдан игроку ${target.name}: ${count} шт. ` +
    `(${extended(existing)}срок до ${untilStr}, ~${hours} ч).`);
  return {
    targetId: target.id, targetName: target.name,
    commanderId: commander.id, commanderName: commander.name,
    count, expiresAt, hours, extended: !!existing,
  };
}

function extended(existing: any): string { return existing ? 'продлён, ' : ''; }

// Отозвать наёмника у игрока (на случай ошибочной выдачи)
function adminRevokeCommander(adminUser: User, body: any, notices: Notices): any {
  require('./roles').assertZone(adminUser, 'economy', 'выдача наёмников');
  const pl = require('./player');
  const users = pl.users();
  let target: any = body.userId ? users[body.userId] : null;
  if (!target && body.name) target = pl.findByName(String(body.name));
  if (!target) throw new u.ApiError('Игрок не найден');
  const commander = config.COMMANDERS.find((m: any) => m.id === body.commanderId);
  if (!commander) throw new u.ApiError('Наёмник не найден');

  const before = (target.effects || []).length;
  target.effects = (target.effects || []).filter((e: any) => e.commanderId !== commander.id);
  const removed = before - target.effects.length;
  if (!removed) throw new u.ApiError(`У игрока ${target.name} нет наёмника «${commander.name}»`);
  db.markUser(target.id);
  notices.push(`🚫 Наёмник «${commander.name}» отозван у игрока ${target.name}.`);
  return { targetId: target.id, targetName: target.name, removed };
}

// Кто из игроков сейчас держит наёмников (для админ-панели)
function adminCommanderHolders(): any {
  const pl = require('./player');
  const users = pl.users();
  const now = Date.now();
  const out: any[] = [];
  for (const id of Object.keys(users)) {
    const usr = users[id];
    if (!usr || usr.isBot || !Array.isArray(usr.effects)) continue;
    for (const e of usr.effects) {
      if (!e.commanderId || e.expiresAt <= now) continue;
      if (out.some((x) => x.userId === id && x.commanderId === e.commanderId)) continue;
      out.push({
        userId: id, name: usr.name, commanderId: e.commanderId,
        commanderName: e.name, expiresAt: e.expiresAt,
        hoursLeft: Math.round((e.expiresAt - now) / 3600000),
      });
    }
  }
  return { holders: out.sort((a, b) => b.expiresAt - a.expiresAt) };
}

export = { itemsList, buyItem, containersView, buyContainers, openOwned, addContainers, ownedCount, openContainersFree, grantCommanderDays, containerHistory, auctionView, bid, tick, mineInfo, buyMines, applyCommanderEffect,
  adminCommandersList, adminGrantCommander, adminRevokeCommander, adminCommanderHolders, pushEffect,};
