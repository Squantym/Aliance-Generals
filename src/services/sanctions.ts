// ===================================================================
// src/services/sanctions.ts — система «Санкций» (заказы на игроков)
//
// Механика:
//   - Любой игрок может объявить санкцию на любого другого, указав
//     награду из своего кармана. Деньги СРАЗУ замораживаются (списываются).
//   - Несколько заказчиков могут объявить санкции на одну цель —
//     награды СУММИРУЮТСЯ в общий банк по цели.
//   - Цель появляется в списке вкладки «Война» → «Санкции».
//   - Кто в обычном бою снизит HP цели до ≤5% или вырубит — забирает
//     ВЕСЬ накопленный банк по этой цели. Санкции с цели снимаются.
//   - Если охотник = один из заказчиков, он тоже получает банк (включая
//     свой замороженный вклад — фактически возврат + чужие деньги).
//
// Хранение: коллекция 'sanctions' = { targetId: { bounty, orders: [...] } }
//   orders: [{ byId, byName, amount, at }]
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import type { User, Notices, SanctionEntry } from '../types';

const MIN_BOUNTY = 1000;       // минимальная ставка
const HP_THRESHOLD_PCT = 0.05; // 5% HP — порог срабатывания

function store(): Record<string, SanctionEntry> { return db.load<Record<string, SanctionEntry>>('sanctions', {}); }

// ── Объявить санкцию ──────────────────────────────────────────────
function declare(user: User, targetId: string, amount: number | string, notices: Notices) {
  amount = u.toInt(amount, 0);
  if (!targetId) throw new u.ApiError('Не указана цель');
  if (targetId === user.id) throw new u.ApiError('Нельзя объявить санкцию на самого себя');
  if (amount < MIN_BOUNTY) throw new u.ApiError(`Минимальная ставка — $${u.fmt(MIN_BOUNTY)}`);

  const players: Record<string, User> = require('./player').users();
  const target = players[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.isBot) throw new u.ApiError('Нельзя объявить санкцию на бота');

  // Объявить санкцию можно ТОЛЬКО на того, кто напал и отрезал тебе ухо.
  // Проверяем по earCutters — там записаны те, кто отрезал уши заказчику.
  const cutters = user.earCutters || [];
  const cutByTarget = cutters.some((c) => c && c.id === targetId);
  if (!cutByTarget) {
    throw new u.ApiError('Объявить санкцию можно только на того, кто напал на вас и отрезал ухо.');
  }

  if (user.dollars < amount) {
    throw new u.ApiError(`Не хватает денег (нужно $${u.fmt(amount)}, есть $${u.fmt(Math.floor(user.dollars))})`);
  }

  // Замораживаем (списываем) деньги заказчика сразу
  user.dollars -= amount;

  const s = store();
  if (!s[targetId]) {
    s[targetId] = { targetId, targetName: target.name, bounty: 0, orders: [], createdAt: Date.now() };
    // «Враг народа»: цель попала под санкции (считаем только НОВУЮ санкцию,
    // добор награды к уже висящей — не отдельное попадание)
    try { require('./achievements').bump(target, 'sanctionedTimes', 1, []); } catch (e) {}
  }
  s[targetId].bounty += amount;
  s[targetId].orders.push({ byId: user.id, byName: user.name, amount, at: Date.now() });
  s[targetId].targetName = target.name; // актуализируем имя

  db.save('sanctions');
  db.save('users');

  // Уведомляем цель
  try {
    require('./notifications').push(targetId, 'sanction_declared',
      `⚠️ На вас объявлена санкция! Награда за вашу голову: $${u.fmt(s[targetId].bounty)}`,
      { bounty: s[targetId].bounty });
  } catch (e) {}

  notices.push(`🎯 Санкция объявлена! Награда за «${target.name}»: $${u.fmt(s[targetId].bounty)} (ваш вклад: $${u.fmt(amount)}).`);
  return { targetId, bounty: s[targetId].bounty };
}

// ── Список активных санкций (для вкладки «Война») ─────────────────
// ── Детализация: кто заказал цель и сколько заплатил ──────────────
// Полная сумма банка складывается из вкладов нескольких заказчиков —
// эта функция раскрывает разбивку. Вклады одного заказчика (если он
// доставлял несколько раз) суммируются в одну строку.
function orders(user: User, targetId: string) {
  const s = store();
  const entry = s[targetId];
  if (!entry) return { targetId, targetName: '', bounty: 0, orders: [] };
  // Сворачиваем несколько ставок одного заказчика в одну строку
  const byOrderer: Record<string, { byId: string; byName: string; amount: number; count: number; lastAt: number }> = {};
  for (const o of entry.orders || []) {
    const k = o.byId;
    if (!byOrderer[k]) byOrderer[k] = { byId: o.byId, byName: o.byName, amount: 0, count: 0, lastAt: 0 };
    byOrderer[k].amount += o.amount;
    byOrderer[k].count += 1;
    byOrderer[k].lastAt = Math.max(byOrderer[k].lastAt, o.at || 0);
  }
  const rows = Object.values(byOrderer)
    .map(r => ({
      byName: r.byName,
      amount: r.amount,
      count: r.count,                 // сколько раз этот заказчик доплачивал
      lastAt: r.lastAt,
      isMe: r.byId === user.id,
      pct: entry.bounty > 0 ? Math.round((r.amount / entry.bounty) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  return {
    targetId,
    targetName: entry.targetName || '',
    bounty: entry.bounty,
    ordererCount: rows.length,
    orders: rows,
  };
}

function list(user: User) {
  const s = store();
  const players: Record<string, User> = require('./player').users();
  const result: any[] = [];
  for (const entry of Object.values(s)) {
    if (entry.bounty <= 0) continue;
    const target = players[entry.targetId];
    if (!target) continue;
    const pl = require('./player');
    result.push({
      targetId: entry.targetId,
      targetName: entry.targetName || target.name,
      flag: pl.flag ? pl.flag(target) : '',
      level: target.level,
      bounty: entry.bounty,
      orderCount: entry.orders.length,
      myOrder: entry.orders.filter(o => o.byId === user.id).reduce((s2, o) => s2 + o.amount, 0),
      hpPct: target.res ? Math.round((target.res.hp.cur / require('./player').maxima(target).hp) * 100) : 100,
    });
  }
  // Сортируем по размеру награды (самые жирные сверху)
  result.sort((a, b) => b.bounty - a.bounty);
  return { sanctions: result, threshold: Math.round(HP_THRESHOLD_PCT * 100), minBounty: MIN_BOUNTY };
}

// ── Проверка выплаты при атаке (вызывается из battle.attack) ──────
// hunter — атакующий, target — цель (реальный игрок), hpAfter/maxHp —
// HP цели после удара. Если HP ≤ 5% или 0 — выплачиваем банк охотнику.
function checkPayout(hunter: User, target: User, hpAfter: number, maxHp: number, notices: Notices): number {
  if (!target || target.isBot) return 0;
  const s = store();
  const entry = s[target.id];
  if (!entry || entry.bounty <= 0) return 0;

  const pct = hpAfter / Math.max(1, maxHp);
  if (pct > HP_THRESHOLD_PCT) return 0; // порог не достигнут

  // Заказчик санкции не может забрать СВОЮ же награду — её получают другие.
  // Бой засчитывается как обычный, но выплаты нет и санкция не снимается.
  if ((entry.orders || []).some((o: any) => o.byId === hunter.id)) {
    notices.push(`⚠️ Вы заказали эту санкцию — награду за неё получают другие охотники, не вы.`);
    return 0;
  }

  // Выплата охотнику
  const payout = entry.bounty;
  const pl = require('./player');
  pl.addMoney(hunter, payout, true);
  try { require('./achievements').bump(hunter, 'sanctionsCompleted', 1, notices); } catch (e) {} // «Охотник за головами»

  // Снимаем санкцию полностью
  delete s[target.id];
  db.save('sanctions');

  notices.push(`💰 САНКЦИЯ ВЫПОЛНЕНА! Вы загнали «${target.name}» и получили награду $${u.fmt(payout)}!`);

  // Уведомления
  try {
    const notif = require('./notifications');
    notif.push(target.id, 'sanction_executed',
      `💀 Санкция против вас выполнена! ${hunter.name} получил награду $${u.fmt(payout)}`,
      { hunterName: hunter.name, payout });
  } catch (e) {}

  return payout;
}

// ── Снять/отменить нельзя (деньги уже в игре), но при бане игрока
//    можно очистить. Утилита для админки. ──────────────────────────
function clearTarget(targetId: string): void {
  const s = store();
  if (s[targetId]) { delete s[targetId]; db.save('sanctions'); }
}

// Проверка: заказывал ли userId санкцию на targetId.
// Используется в бою — заказчик не может сам бить свою цель (её бьют другие).
function isOrderer(userId: string, targetId: string): boolean {
  const s = store();
  const entry = s[targetId];
  if (!entry || !entry.orders) return false;
  return entry.orders.some((o: any) => o.byId === userId);
}

export = { declare, list, orders, checkPayout, clearTarget, isOrderer, MIN_BOUNTY, HP_THRESHOLD_PCT };
