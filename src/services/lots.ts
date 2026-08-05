// ═══════════════════════════════════════════════════════════════════
// src/services/lots.ts — «Лоты дня» на чёрном рынке
//
// Два раздела, оба обновляются в 00:00 по московскому времени:
//
//   1. АУКЦИОН СЕКРЕТНЫХ РАЗРАБОТОК
//      Четыре разные разработки, по одной штуке на всех игроков.
//      Ставки золотом, минимум 100. Побеждает наибольшая ставка;
//      товар зачисляется победителю при смене суток, проигравшим
//      золото возвращается. Ставки блокируются сразу при подаче —
//      иначе игрок мог бы поставить больше, чем у него есть, и
//      потратить золото до подведения итогов.
//
//   2. ДОПИНГ СО СКИДКОЙ
//      Пять случайных допингов, у каждого свой запас (5–30 штук) и
//      своя скидка (5–30% шагом 5%). Продаётся сразу и всем: кто
//      успел, тот и купил. Запас общий на всех игроков.
//
// Набор дня детерминирован: он выводится из даты, поэтому одинаков
// для всех игроков и не «дрожит» между запросами.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import config = require('../../config/gameConfig');
import player = require('./player');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

const DEVS_PER_DAY = 4;          // сколько разработок разыгрывается
const BUFFS_PER_DAY = 5;         // сколько допингов в продаже
const MIN_BID = 100;             // минимальная ставка, золото
const BID_STEP = 10;             // шаг повышения
const STOCK_MIN = 5;             // запас допинга
const STOCK_MAX = 30;
const DISCOUNTS = [5, 10, 15, 20, 25, 30];   // шаг 5%

type Bid = { userId: string; userName: string; gold: number; at: number };
type DevLot = { devId: string; bids: Bid[]; winnerId?: string; winnerName?: string; winnerGold?: number };
type BuffLot = { itemId: string; stock: number; sold: number; discountPct: number; price: number };
type DayLots = { day: string; devs: DevLot[]; buffs: BuffLot[]; settled?: boolean };

function store(): Record<string, DayLots> {
  return db.load<Record<string, DayLots>>('lots', {});
}

// Ключ суток по Москве — как и остальные суточные механики игры
function mskDay(ts?: number): string {
  const d = new Date((ts || Date.now()) + 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Детерминированный генератор: одинаковый набор для всех игроков.
// Обычный Math.random() выдавал бы разным игрокам разные лоты.
function seedFrom(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function pickN<T>(arr: T[], n: number, rnd: () => number): T[] {
  const pool = arr.slice();
  const out: T[] = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  return out;
}

// Набор лотов на день. Создаётся один раз и дальше только читается.
// Чистка истории: держим неделю. Вызывается при каждом обращении, а не
// только при создании нового дня — иначе на живом сервере, где набор уже
// создан, уборка не запускалась бы вовсе.
function pruneHistory(): void {
  const all = store();
  const keys = Object.keys(all).sort();
  if (keys.length <= 7) return;
  for (const k of keys.slice(0, keys.length - 7)) delete all[k];
  db.save('lots');
}

function ensureDay(day?: string): DayLots {
  const key = day || mskDay();
  const all = store();
  if (all[key]) {
    // Даже если набор уже есть, могли остаться неподведённые прошлые дни
    settleOld(key);
    pruneHistory();
    return all[key];
  }

  const rnd = seedFrom('lots-' + key);
  const devs = pickN(config.SECRET_DEVS, DEVS_PER_DAY, rnd)
    .map((d: any) => ({ devId: d.id, bids: [] as Bid[] }));

  const buffPool = config.MARKET_ITEMS.filter((i: any) => i.kind === 'buff');
  const buffs = pickN(buffPool, BUFFS_PER_DAY, rnd).map((it: any) => {
    const discountPct = DISCOUNTS[Math.floor(rnd() * DISCOUNTS.length)];
    const stock = STOCK_MIN + Math.floor(rnd() * (STOCK_MAX - STOCK_MIN + 1));
    return {
      itemId: it.id,
      stock,
      sold: 0,
      discountPct,
      price: Math.max(1, Math.floor(it.gold * (1 - discountPct / 100))),
    };
  });

  all[key] = { day: key, devs, buffs };
  db.save('lots');

  // Прошлые сутки подводим здесь же: отдельного планировщика нет, а
  // первое обращение после полуночи гарантированно случится
  settleOld(key);
  pruneHistory();
  return all[key];
}

// ---------- Подведение итогов аукциона ----------
// Победитель получает разработку, остальным возвращается золото.
function settleOld(currentDay: string): void {
  const all = store();
  let changed = false;
  for (const key of Object.keys(all)) {
    const d = all[key];
    if (key >= currentDay || d.settled) continue;
    for (const lot of d.devs) {
      if (!lot.bids.length) continue;
      const sorted = lot.bids.slice().sort((a, b) => b.gold - a.gold || a.at - b.at);
      const win = sorted[0];
      const users = player.users();
      const winner = users[win.userId];
      if (winner) {
        (winner as any).secretDevs = (winner as any).secretDevs || {};
        (winner as any).secretDevs[lot.devId] = ((winner as any).secretDevs[lot.devId] || 0) + 1;
        db.markUser(winner.id);
        lot.winnerId = win.userId;
        lot.winnerName = win.userName;
        lot.winnerGold = win.gold;
        try {
          const dev: any = config.SECRET_DEVS.find((x: any) => x.id === lot.devId);
          require('./notifications').push(winner.id, 'lot_won',
            `🏆 Вы выиграли лот: ${dev ? dev.name : lot.devId} за 🪙 ${win.gold}`, { devId: lot.devId });
        } catch (e) {}
      }
      // Проигравшим возвращаем заблокированное золото
      for (const b of sorted.slice(1)) {
        const loser = users[b.userId];
        if (!loser) continue;
        player.addGold(loser, b.gold, 'lot_refund');
        db.markUser(loser.id);
        try {
          require('./notifications').push(loser.id, 'lot_lost',
            `Ставка не выиграла — 🪙 ${b.gold} возвращены`, { devId: lot.devId });
        } catch (e) {}
      }
      changed = true;
    }
    d.settled = true;
    changed = true;
  }
  if (changed) { db.save('lots'); db.save('users'); }

}

// ---------- Витрина ----------
function view(user: User) {
  const day = mskDay();
  const d = ensureDay(day);
  const myGold = user.gold || 0;

  // До полуночи по Москве
  const now = Date.now();
  const mskNow = new Date(now + 3 * 3600 * 1000);
  const endOfDay = Date.UTC(mskNow.getUTCFullYear(), mskNow.getUTCMonth(), mskNow.getUTCDate() + 1) - 3 * 3600 * 1000;

  return {
    day,
    endsAt: endOfDay,
    secondsLeft: Math.max(0, Math.round((endOfDay - now) / 1000)),
    minBid: MIN_BID,
    bidStep: BID_STEP,
    myGold,
    devs: d.devs.map((lot) => {
      const dev: any = config.SECRET_DEVS.find((x: any) => x.id === lot.devId) || {};
      const sorted = lot.bids.slice().sort((a, b) => b.gold - a.gold || a.at - b.at);
      const top = sorted[0];
      const mine = lot.bids.find((b) => b.userId === user.id);
      return {
        devId: lot.devId,
        name: dev.name || lot.devId,
        atk: dev.atk, def: dev.def, desc: dev.desc || '',
        topGold: top ? top.gold : 0,
        topName: top ? top.userName : '',
        leading: !!(top && top.userId === user.id),
        myBid: mine ? mine.gold : 0,
        bidders: lot.bids.length,
        nextBid: Math.max(MIN_BID, (top ? top.gold : 0) + BID_STEP),
      };
    }),
    buffs: d.buffs.map((lot) => {
      const it: any = config.MARKET_ITEMS.find((x: any) => x.id === lot.itemId) || {};
      return {
        itemId: lot.itemId,
        name: it.name || lot.itemId,
        desc: it.desc || '',
        basePrice: it.gold || 0,
        price: lot.price,
        discountPct: lot.discountPct,
        stock: lot.stock,
        sold: lot.sold,
        left: Math.max(0, lot.stock - lot.sold),
      };
    }),
  };
}

// ---------- Ставка на разработку ----------
function bid(user: User, devId: string, gold: number, notices: Notices) {
  const d = ensureDay();
  const lot = d.devs.find((x) => x.devId === devId);
  if (!lot) throw new u.ApiError('Лот не найден');

  const amount = u.toInt(gold, 0);
  const sorted = lot.bids.slice().sort((a, b) => b.gold - a.gold || a.at - b.at);
  const top = sorted[0];
  const need = Math.max(MIN_BID, (top ? top.gold : 0) + BID_STEP);
  if (amount < need) throw new u.ApiError(`Ставка должна быть не меньше 🪙 ${need}`);

  const mine = lot.bids.find((b) => b.userId === user.id);
  // Повышая свою ставку, доплачиваем только разницу — прежняя сумма
  // уже заблокирована
  const charge = mine ? amount - mine.gold : amount;
  if (charge <= 0) throw new u.ApiError('Новая ставка должна быть выше вашей прежней');
  if ((user.gold || 0) < charge) throw new u.ApiError(`Не хватает золота: нужно 🪙 ${charge}`);

  player.addGold(user, -charge, 'lot_bid');
  if (mine) { mine.gold = amount; mine.at = Date.now(); }
  else lot.bids.push({ userId: user.id, userName: user.name, gold: amount, at: Date.now() });

  db.markUser(user.id);
  db.save('lots');
  db.save('users');
  auditLog.record({
    userId: user.id, userName: user.name, path: '/api/lots/bid',
    body: { devId, gold: amount },
  });
  const dev: any = config.SECRET_DEVS.find((x: any) => x.id === devId);
  notices.push(`🔨 Ставка 🪙 ${amount} на «${dev ? dev.name : devId}» принята. Итоги в полночь по Москве.`);
  return view(user);
}

// ---------- Покупка допинга со скидкой ----------
function buyBuff(user: User, itemId: string, qty: number, notices: Notices) {
  const d = ensureDay();
  const lot = d.buffs.find((x) => x.itemId === itemId);
  if (!lot) throw new u.ApiError('Товар не найден в сегодняшних лотах');

  const n = u.clamp(u.toInt(qty, 1), 1, 99);
  const left = lot.stock - lot.sold;
  if (left <= 0) throw new u.ApiError('Разобрали — товар закончился');
  if (n > left) throw new u.ApiError(`Осталось всего ${left} шт.`);

  const total = lot.price * n;
  if ((user.gold || 0) < total) throw new u.ApiError(`Не хватает золота: нужно 🪙 ${total}`);

  player.addGold(user, -total, 'lot_buff');
  lot.sold += n;
  db.save('lots');

  // Эффект накладываем той же функцией, что и обычная покупка на
  // рынке: дублировать логику допингов значило бы разойтись в поведении
  const item: any = config.MARKET_ITEMS.find((x: any) => x.id === itemId);
  const market = require('./market');
  for (let i = 0; i < n; i++) {
    if (item.kind === 'refill_energy') { const mx = player.maxima(user); user.res.en.cur = mx.en; user.res.en.t = Date.now(); }
    else if (item.kind === 'refill_health') { const mx = player.maxima(user); user.res.hp.cur = mx.hp; user.res.hp.t = Date.now(); }
    else if (item.kind === 'refill_ammo') { const mx = player.maxima(user); user.res.am.cur = mx.am; user.res.am.t = Date.now(); }
    else market.pushEffect(user, item);
  }
  db.markUser(user.id);
  db.save('users');

  auditLog.record({
    userId: user.id, userName: user.name, path: '/api/lots/buy',
    body: { itemId, qty: n, gold: total, discountPct: lot.discountPct },
  });
  notices.push(`✅ Куплено: ${item ? item.name : itemId} ×${n} за 🪙 ${total} (скидка ${lot.discountPct}%)`);
  return view(user);
}

export = {
  view, bid, buyBuff, ensureDay, settleOld, pruneHistory, mskDay,
  DEVS_PER_DAY, BUFFS_PER_DAY, MIN_BID, BID_STEP, DISCOUNTS, STOCK_MIN, STOCK_MAX,
};
