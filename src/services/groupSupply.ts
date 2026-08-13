// ═══════════════════════════════════════════════════════════════════
// src/services/groupSupply.ts — База снабжения групповых боёв
//
// Три торговца, каждый открывается своим рейтингом. Предметы дают
// временные усиления: они действуют в реальном времени и тратятся
// не на бой, а на срок — купил и живёшь с ним, пока не истечёт.
//
// Бонусов к рейтингу здесь НЕТ намеренно: рейтинг — мера мастерства,
// по нему открываются ранги и ступени улучшений. Если его можно
// ускорить за валюту, ранг перестаёт что-либо значить.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

// ---------- Виды усилений ----------
// money  — множитель валюты за бой (боевых очков)
// attack — множитель наносимого урона
// energy — прибавка к запасу энергии
// crit   — прибавка к шансу крита и крита лечения
// dodge  — прибавка к шансу уворота
type BuffKind = 'money' | 'attack' | 'energy' | 'crit' | 'dodge';

type ItemDef = {
  id: string;
  name: string;
  kind: BuffKind;
  pct: number;        // насколько усиливает, в долях (0.25 = +25%)
  minutes: number;    // сколько действует
  price: number;      // цена в боевых очках
  icon: string;
  desc: string;
};

type Trader = {
  id: string;
  name: string;
  need: number;       // рейтинг для доступа
  icon: string;
  about: string;
  items: ItemDef[];
};

const TRADERS: Trader[] = [
  {
    id: 'pavel',
    name: 'Павел Терентич',
    need: 500,
    icon: '🎖',
    about: 'Старый снабженец. Берёт недорого, но и товар простой.',
    items: [
      { id: 'p_money', name: 'Премиальные выплаты', kind: 'money', pct: 0.25, minutes: 15,
        price: 50, icon: '🎗', desc: 'Боевых очков за бои на 25% больше' },
    ],
  },
  {
    id: 'nicole',
    name: 'Николь Колман',
    need: 1500,
    icon: '💼',
    about: 'Держит связи с оружейниками. Товар серьёзнее, и цена под стать.',
    items: [
      { id: 'n_money', name: 'Контракт на поставку', kind: 'money', pct: 0.35, minutes: 30,
        price: 100, icon: '🎗', desc: 'Боевых очков за бои на 35% больше' },
      { id: 'n_attack', name: 'Бронебойные боеприпасы', kind: 'attack', pct: 0.30, minutes: 20,
        price: 80, icon: '⚔', desc: 'Урон в бою выше на 30%' },
      { id: 'n_energy', name: 'Полевой рацион', kind: 'energy', pct: 0.50, minutes: 20,
        price: 75, icon: '⚡', desc: 'Запас энергии больше на 50%' },
    ],
  },
  {
    id: 'peacemaker',
    name: 'Миротворец',
    need: 3000,
    icon: '🕊',
    about: 'Имени не называет. Достаёт то, чего нет ни у кого — по своей цене.',
    items: [
      { id: 'pm_money', name: 'Тёмная бухгалтерия', kind: 'money', pct: 0.50, minutes: 45,
        price: 300, icon: '🎗', desc: 'Боевых очков за бои в полтора раза больше' },
      { id: 'pm_attack', name: 'Экспериментальный ствол', kind: 'attack', pct: 0.50, minutes: 30,
        price: 500, icon: '⚔', desc: 'Урон в бою выше на 50%' },
      { id: 'pm_energy', name: 'Боевые стимуляторы', kind: 'energy', pct: 1.00, minutes: 30,
        price: 500, icon: '⚡', desc: 'Запас энергии вдвое больше' },
      { id: 'pm_crit', name: 'Прицельный комплекс', kind: 'crit', pct: 0.30, minutes: 30,
        price: 450, icon: '💥', desc: 'Шанс крита и крита лечения выше на 30%' },
      { id: 'pm_dodge', name: 'Маскировочный костюм', kind: 'dodge', pct: 0.30, minutes: 30,
        price: 470, icon: '💨', desc: 'Шанс уворота выше на 30%' },
    ],
  },
];

const ALL_ITEMS: Record<string, ItemDef> = {};
for (const t of TRADERS) for (const it of t.items) ALL_ITEMS[it.id] = it;

// ---------- Действующие усиления игрока ----------
// Хранятся у игрока: { kind: { until, pct, itemId } }. По одному
// усилению каждого вида — покупка того же вида продлевает срок, а не
// складывается, иначе можно было бы накопить бесконечный множитель.
function buffsOf(user: any): Record<string, any> {
  if (!user.gbBuffs) user.gbBuffs = {};
  return user.gbBuffs;
}

// Только действующие: истёкшие вычищаем при обращении
function activeBuffs(user: any): Record<string, any> {
  const all = buffsOf(user);
  const now = Date.now();
  let changed = false;
  for (const kind of Object.keys(all)) {
    if (!all[kind] || all[kind].until <= now) { delete all[kind]; changed = true; }
  }
  if (changed) { try { db.markUser(user.id); } catch (e) {} }
  return all;
}

// Насколько усилен игрок по указанному виду (0 — не усилен)
function bonus(user: any, kind: BuffKind): number {
  const b = activeBuffs(user)[kind];
  return b ? b.pct : 0;
}

function ratingOf(user: any): number {
  try {
    const s = db.load<any>('groupBattle', {});
    const rec = (s.ratings || {})[user.id];
    return rec ? rec.points : 0;
  } catch (e) { return 0; }
}

// ---------- Витрина ----------
function view(user: User) {
  const points = ratingOf(user);
  const act = activeBuffs(user);
  const now = Date.now();

  return {
    myPoints: points,
    wallet: { points: (user as any).battlePoints || 0 },
    // Действующие усиления — показываем игроку, что у него сейчас есть
    active: Object.keys(act).map((kind) => ({
      kind,
      pct: Math.round(act[kind].pct * 100),
      leftSec: Math.max(0, Math.round((act[kind].until - now) / 1000)),
      name: (ALL_ITEMS[act[kind].itemId] || {}).name || kind,
      icon: (ALL_ITEMS[act[kind].itemId] || {}).icon || '✨',
    })),
    traders: TRADERS.map((t) => ({
      id: t.id, name: t.name, need: t.need, icon: t.icon, about: t.about,
      unlocked: points >= t.need,
      left: Math.max(0, t.need - points),
      items: t.items.map((it) => {
        const cur = act[it.kind];
        return {
          ...it,
          pctText: Math.round(it.pct * 100),
          affordable: ((user as any).battlePoints || 0) >= it.price,
          canBuy: points >= t.need && ((user as any).battlePoints || 0) >= it.price,
          // Если такое усиление уже действует — покупка продлит срок
          activeNow: !!cur,
          activeLeftSec: cur ? Math.max(0, Math.round((cur.until - now) / 1000)) : 0,
        };
      }),
    })),
  };
}

// ---------- Покупка ----------
function buy(user: User, itemId: string, notices: Notices) {
  const item = ALL_ITEMS[String(itemId || '')];
  if (!item) throw new u.ApiError('Такого товара нет');

  const trader = TRADERS.find((t) => t.items.some((x) => x.id === item.id))!;
  const points = ratingOf(user);
  if (points < trader.need) {
    throw new u.ApiError(`«${trader.name}» торгует с рейтинга ${u.fmt(trader.need)} — у вас ${u.fmt(points)}`);
  }
  if (((user as any).battlePoints || 0) < item.price) {
    throw new u.ApiError(`Не хватает боевых очков: нужно ${u.fmt(item.price)}`);
  }

  (user as any).battlePoints -= item.price;
  const all = buffsOf(user);
  const now = Date.now();
  const prev = all[item.kind];
  // Тот же вид — продлеваем от текущего срока, а не начинаем заново:
  // иначе покупка «про запас» сгорала бы зря
  const base = (prev && prev.until > now && prev.pct >= item.pct) ? prev.until : now;
  all[item.kind] = {
    until: base + item.minutes * 60 * 1000,
    pct: Math.max(item.pct, (prev && prev.until > now) ? prev.pct : 0),
    itemId: item.id,
  };

  db.markUser(user.id);
  db.save('users');
  auditLog.record({
    userId: user.id, userName: user.name, path: '/api/group/supply/buy',
    body: { item: item.id, price: item.price, minutes: item.minutes },
  });
  notices.push(`${item.icon} «${item.name}» куплен — действует ${item.minutes} мин.`);
  return view(user);
}

export = {
  view, buy, bonus, activeBuffs, buffsOf, TRADERS, ALL_ITEMS,
};
