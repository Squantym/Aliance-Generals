// ===================================================================
// src/services/warReport.ts — сводка «пока вас не было»
// Если игрока атакуют или объявляют на него санкции, ПОКА ОН ОФФЛАЙН,
// события копятся в user.offlineWar. При первом заходе в игру фронт
// получает сводку через /api/me (pendingWarReport) и показывает окно
// «События»: атаки / победы / поражения, потерянные деньги и техника,
// объявленные санкции. После закрытия окна фронт зовёт
// POST /api/war-report/ack — сводка очищается.
// ===================================================================

import db = require('../core/db');
import type { User } from '../types';

// Порог «оффлайн» — тот же, что и везде в проекте (admin, battle,
// legionBattle): нет активности больше 5 минут.
const OFFLINE_MS = 5 * 60 * 1000;

function isOffline(target: User): boolean {
  return Date.now() - (target.lastSeen || 0) > OFFLINE_MS;
}

// Ленивая инициализация копилки событий
function box(target: User): any {
  if (!target.offlineWar) {
    target.offlineWar = {
      since: Date.now(),   // с какого момента копим
      attacks: 0,          // всего атак на игрока
      defended: 0,         // из них отбито (победы в обороне)
      defeats: 0,          // из них проиграно (поражения)
      moneyLost: 0,        // суммарно потеряно долларов
      losses: {},          // unitId -> { id, name, count } — потерянная техника
      sanctions: {},       // byId  -> { byId, byName, byFlag, count, amount }
    };
  }
  return target.offlineWar;
}

// Атака по игроку. Вызывается из battle.attack ТОЛЬКО для реальных
// игроков-защитников. Если цель онлайн — ничего не копим (она видит
// живые уведомления).
// info: { defeat: boolean; moneyLost?: number; losses?: [{id,name,count}] }
function onAttack(target: User, info: { defeat: boolean; moneyLost?: number; losses?: any[] }): void {
  if (!isOffline(target)) return;
  const w = box(target);
  w.attacks++;
  if (info.defeat) {
    w.defeats++;
    w.moneyLost += Math.max(0, info.moneyLost || 0);
  } else {
    w.defended++;
  }
  for (const l of (info.losses || [])) {
    if (!l || !l.count) continue;
    const key = l.id || l.name;
    if (!w.losses[key]) w.losses[key] = { id: l.id || null, name: l.name, count: 0 };
    w.losses[key].count += l.count;
  }
  db.markUser(target.id);
}

// Санкция, объявленная на оффлайн-игрока. Взносы одного заказчика
// агрегируются: (x2) и общая сумма.
function onSanction(target: User, info: { byId: string; byName: string; byFlag: string; amount: number }): void {
  if (!isOffline(target)) return;
  const w = box(target);
  if (!w.sanctions[info.byId]) {
    w.sanctions[info.byId] = { byId: info.byId, byName: info.byName, byFlag: info.byFlag, count: 0, amount: 0 };
  }
  const s = w.sanctions[info.byId];
  s.count++;
  s.amount += Math.max(0, info.amount || 0);
  s.byName = info.byName; // актуализируем имя
  db.markUser(target.id);
}

// Сводка для фронта (null — показывать нечего). Техника отсортирована
// по убыванию потерь — самые крупные потери первыми, как на макете.
function view(user: User): any {
  const w = user.offlineWar;
  if (!w) return null;
  const hasWar = (w.attacks || 0) > 0;
  const sanctions = Object.values(w.sanctions || {});
  if (!hasWar && !sanctions.length) return null;
  return {
    since: w.since,
    attacks: w.attacks || 0,
    defended: w.defended || 0,
    defeats: w.defeats || 0,
    moneyLost: w.moneyLost || 0,
    losses: Object.values(w.losses || {}).sort((a: any, b: any) => b.count - a.count),
    sanctions,
  };
}

// Игрок посмотрел окно — очищаем копилку
function ack(user: User): { ok: true } {
  user.offlineWar = null;
  db.markUser(user.id);
  return { ok: true };
}

export = { isOffline, onAttack, onSanction, view, ack };
