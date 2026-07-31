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
      // Кто именно нападал: без этого сводка отвечала «на вас напали 8 раз»,
      // но не говорила КТО — а это первое, что хочет знать игрок.
      attackers: {},       // byId -> { id, name, flag, level, attacks, won, lost, moneyTaken, unitsKilled }
      rockets: [],         // ракетные удары по игроку (полный ущерб)
      saboteursLost: {},   // тип диверсанта -> сколько погибло
      buildingsLost: 0,    // разрушено построек
    };
  }
  const w: any = target.offlineWar;
  if (!w.attackers) w.attackers = {};
  if (!w.rockets) w.rockets = [];
  if (!w.saboteursLost) w.saboteursLost = {};
  if (typeof w.buildingsLost !== 'number') w.buildingsLost = 0;
  return w;
}

// Атака по игроку. Вызывается из battle.attack ТОЛЬКО для реальных
// игроков-защитников. Если цель онлайн — ничего не копим (она видит
// живые уведомления).
// info: { defeat: boolean; moneyLost?: number; losses?: [{id,name,count}] }
function onAttack(target: User, info: {
  defeat: boolean; moneyLost?: number; losses?: any[];
  by?: { id: string; name: string; flag?: string; level?: number };
}): void {
  if (!isOffline(target)) return;
  const w = box(target);
  w.attacks++;
  const lostUnits = (info.losses || []).reduce((n: number, l: any) => n + (l && l.count ? l.count : 0), 0);
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
  // Разбивка по нападавшему: сколько раз бил, чем это кончилось, сколько унёс
  const by = info.by;
  if (by && by.id) {
    if (!w.attackers[by.id]) {
      w.attackers[by.id] = { id: by.id, name: by.name, flag: by.flag || '', level: by.level || 0,
                             attacks: 0, won: 0, lost: 0, moneyTaken: 0, unitsKilled: 0 };
    }
    const a = w.attackers[by.id];
    a.name = by.name;                     // имя могло измениться
    a.flag = by.flag || a.flag;
    a.level = by.level || a.level;
    a.attacks++;
    if (info.defeat) { a.won++; a.moneyTaken += Math.max(0, info.moneyLost || 0); }
    else a.lost++;                        // атака отбита
    a.unitsKilled += lostUnits;
  }
  db.markUser(target.id);
}

// Ракетный удар по оффлайн-игроку: складываем в ту же сводку, чтобы игрок
// увидел ВЕСЬ ущерб за время отсутствия в одном окне, а не отдельными.
function onRocket(target: User, report: any): void {
  if (!isOffline(target) || !report) return;
  const w = box(target);
  w.rockets.push({
    by: report.attackerName || 'Неизвестно',
    moneyLost: Math.max(0, report.moneyLost || 0),
    buildings: report.destroyedBuildings || 0,
    buildingsText: report.destroyedBuildingsText || null,
    techLost: report.techLost || 0,
    techLostText: report.techLostText || null,
    saboteurs: report.lostSaboteurs || {},
    at: report.at || Date.now(),
  });
  if (w.rockets.length > 20) w.rockets = w.rockets.slice(-20);
  w.moneyLost += Math.max(0, report.moneyLost || 0);
  w.buildingsLost += report.destroyedBuildings || 0;
  for (const [kind, n] of Object.entries(report.lostSaboteurs || {})) {
    w.saboteursLost[kind] = (w.saboteursLost[kind] || 0) + (Number(n) || 0);
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
  const rockets = w.rockets || [];
  const sanctions = Object.values(w.sanctions || {});
  if (!hasWar && !sanctions.length && !rockets.length) return null;
  const attackers = Object.values(w.attackers || {})
    .sort((a: any, b: any) => (b.attacks - a.attacks) || (b.moneyTaken - a.moneyTaken));
  const sabTotal = Object.values(w.saboteursLost || {}).reduce((n: number, v: any) => n + (Number(v) || 0), 0);
  return {
    since: w.since,
    attacks: w.attacks || 0,
    defended: w.defended || 0,
    defeats: w.defeats || 0,
    moneyLost: w.moneyLost || 0,
    unitsLost: Object.values(w.losses || {}).reduce((n: number, l: any) => n + (l.count || 0), 0),
    losses: Object.values(w.losses || {}).sort((a: any, b: any) => b.count - a.count),
    attackers,
    rockets: rockets.slice().sort((a: any, b: any) => b.at - a.at),
    saboteursLost: w.saboteursLost || {},
    saboteursLostTotal: sabTotal,
    buildingsLost: w.buildingsLost || 0,
    sanctions,
  };
}

// Игрок посмотрел окно — очищаем копилку
function ack(user: User): { ok: true } {
  user.offlineWar = null;
  db.markUser(user.id);
  return { ok: true };
}

export = { isOffline, onAttack, onRocket, onSanction, view, ack };
