// ═══════════════════════════════════════════════════════════════════
// src/services/giveaways.ts — раздачи наград к праздникам и событиям
//
// Владелец (или сотрудник с правом «Ресурсы») выкладывает награду, и у
// всех игроков над экраном появляется плашка с её составом и кнопкой
// «Забрать». Два вида:
//
//   разовая  — одна награда на игрока, забрать можно до конца срока;
//   по дням  — список наград на неделю (или сколько задано): каждый
//              московский день игрок забирает СЛЕДУЮЩУЮ по списку.
//
// Срок обязателен для разовой и необязателен для дневной: кончился —
// плашка исчезает, и забрать награду больше нельзя. Ничего не сгорает
// «задним числом»: что игрок успел забрать, остаётся у него.
//
// Позиции награды — те же, что в наборах «Спецпредложений»
// (offers.cleanItem / grantItems): золото, деньги, жетоны, очки навыков,
// опыт, VIP, наёмник, контейнер, техника. Свой склад заводить незачем.
//
// Хранение: коллекция 'giveaways' = { [id]: Giveaway }; у игрока —
// giveawaysTaken { [id]: { total, days, last } }.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import type { User, Notices } from '../types';

type Kind = 'once' | 'daily';

interface Giveaway {
  id: string;
  title: string;
  note: string;
  emoji: string;
  kind: Kind;
  items: any[];          // разовая: что выдаётся
  days: any[][];         // по дням: награда на каждый день
  startAt: number;       // 0 — сразу
  endAt: number;         // 0 — бессрочно (только для дневной)
  enabled: boolean;
  createdAt: number;
  byName: string;
  taken: number;         // сколько раз забрали всего
}

const MAX_DAYS = 31;
const MAX_ITEMS = 12;

function store(): Record<string, Giveaway> { return db.load<Record<string, Giveaway>>('giveaways', {}); }
function offers() { return require('./offers'); }
function assertZone(actor: User) {
  require('./roles').assertZone(actor, 'economy', 'раздачи наград');
}

function live(g: Giveaway, now?: number): boolean {
  const t = now || Date.now();
  return !!g && g.enabled && (!g.startAt || g.startAt <= t) && (!g.endAt || g.endAt > t);
}

function box(user: any): Record<string, { total: number; days: number; last: string }> {
  if (!user.giveawaysTaken || typeof user.giveawaysTaken !== 'object') user.giveawaysTaken = {};
  return user.giveawaysTaken;
}
function takenOf(user: any, id: string) {
  return box(user)[id] || { total: 0, days: 0, last: '' };
}

// Что игроку доступно ПРЯМО СЕЙЧАС и что он уже забрал. Дневная раздача
// живёт в плашке и после сегодняшнего получения: игрок должен видеть,
// что завтра будет следующая награда, иначе он про неё забудет.
function state(user: any, g: Giveaway, now?: number) {
  const t = now || Date.now();
  const taken = takenOf(user, g.id);
  const today = u.dayKey(t);
  if (g.kind === 'once') {
    return {
      canTake: taken.total === 0,
      done: taken.total > 0,
      items: g.items,
      dayIndex: 0, daysTotal: 0,
    };
  }
  const dayIndex = Math.min(taken.days, g.days.length - 1);
  const all = taken.days >= g.days.length;
  return {
    canTake: !all && taken.last !== today,
    done: all,
    items: g.days[dayIndex] || [],
    dayIndex, daysTotal: g.days.length,
    // Сегодня уже забрал — следующая награда откроется в 00:00 по Москве
    nextAt: !all && taken.last === today ? u.dayStart(t) + 86400000 : 0,
  };
}

function itemsView(items: any[]) {
  const o = offers();
  return (items || []).map((it: any) => ({ text: o.describeItem(it), icon: o.itemIcon(it) }));
}

// ── Для игрока: плашка над экраном ────────────────────────────────
// Показываем ОДНУ раздачу — ту, у которой раньше кончается срок: две
// плашки подряд над экраном мешают играть, а не помогают.
function forPlayer(user: any) {
  const now = Date.now();
  const list = Object.values(store())
    .filter((g) => live(g, now))
    .map((g) => ({ g, st: state(user, g, now) }))
    .filter((x) => !x.st.done)
    .sort((a, b) => (a.g.endAt || Infinity) - (b.g.endAt || Infinity));
  if (!list.length) return null;
  const { g, st } = list[0];
  return {
    id: g.id, title: g.title, note: g.note, emoji: g.emoji || '🎁',
    kind: g.kind, items: itemsView(st.items),
    canTake: st.canTake, nextAt: (st as any).nextAt || 0,
    endAt: g.endAt,
    day: g.kind === 'daily' ? st.dayIndex + 1 : 0,
    daysTotal: st.daysTotal,
  };
}

// ── Получение награды ─────────────────────────────────────────────
function claim(user: any, id: string, notices: Notices) {
  const g = store()[String(id || '')];
  if (!g) throw new u.ApiError('Награда не найдена');
  const now = Date.now();
  if (!live(g, now)) throw new u.ApiError('Срок получения этой награды истёк');
  const st = state(user, g, now);
  if (st.done) throw new u.ApiError('Эту награду вы уже забрали');
  if (!st.canTake) throw new u.ApiError('Сегодня награда уже получена — следующая откроется завтра');

  const given: string[] = offers().grantItems(user, st.items, notices);
  const taken = takenOf(user, g.id);
  box(user)[g.id] = {
    total: taken.total + 1,
    days: taken.days + 1,
    last: u.dayKey(now),
  };
  g.taken = (g.taken || 0) + 1;
  db.save('giveaways');
  db.markUser(user.id);

  notices.push(`${g.emoji || '🎁'} Получено: ${given.join(', ')}`);
  return { ok: true, given, items: itemsView(st.items), next: forPlayer(user) };
}

// ── Штаб ──────────────────────────────────────────────────────────
function adminList(actor: User) {
  assertZone(actor);
  const now = Date.now();
  return {
    giveaways: Object.values(store())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((g) => Object.assign({}, g, {
        live: live(g, now),
        itemsText: (g.kind === 'once' ? g.items : ([] as any[]).concat(...g.days)).map((it) => offers().describeItem(it)),
      })),
    palette: offers().palette(),
  };
}

function cleanList(raw: any): any[] {
  const o = offers();
  return (Array.isArray(raw) ? raw : []).map((x: any) => o.cleanItem(x)).filter(Boolean).slice(0, MAX_ITEMS);
}

function adminSave(actor: User, data: any, notices: Notices) {
  assertZone(actor);
  const b = data || {};
  const title = String(b.title || '').trim().slice(0, 60);
  if (!title) throw new u.ApiError('Назовите награду — название увидят игроки');
  const kind: Kind = b.kind === 'daily' ? 'daily' : 'once';

  let items: any[] = [];
  let days: any[][] = [];
  if (kind === 'once') {
    items = cleanList(b.items);
    if (!items.length) throw new u.ApiError('Добавьте хотя бы одну позицию в награду');
  } else {
    days = (Array.isArray(b.days) ? b.days : []).slice(0, MAX_DAYS).map(cleanList).filter((d) => d.length);
    if (!days.length) throw new u.ApiError('Добавьте награду хотя бы на один день');
  }

  const startAt = Math.max(0, u.toInt(b.startAt, 0));
  const endAt = Math.max(0, u.toInt(b.endAt, 0));
  // Разовая без срока висела бы над экраном вечно у тех, кто её не забрал
  if (kind === 'once' && !endAt) throw new u.ApiError('Укажите, до какого времени можно забрать награду');
  if (endAt && endAt <= (startAt || Date.now())) throw new u.ApiError('Срок получения истекает раньше начала');

  const all = store();
  const prev = b.id ? all[String(b.id)] : null;
  const id = prev ? prev.id : u.uid(10);
  all[id] = {
    id, title,
    note: String(b.note || '').trim().slice(0, 300),
    emoji: String(b.emoji || '🎁').slice(0, 4) || '🎁',
    kind, items, days, startAt, endAt,
    enabled: b.enabled !== false,
    createdAt: prev ? prev.createdAt : Date.now(),
    byName: actor.name,
    taken: prev ? (prev.taken || 0) : 0,
  };
  db.save('giveaways');
  notices.push(`🎁 Раздача «${title}» ${prev ? 'изменена' : 'создана'}.`);
  return { giveaway: all[id] };
}

function adminRemove(actor: User, id: string, notices: Notices) {
  assertZone(actor);
  const all = store();
  const g = all[String(id || '')];
  if (!g) throw new u.ApiError('Раздача не найдена');
  delete all[g.id];
  db.save('giveaways');
  notices.push(`🗑 Раздача «${g.title}» удалена. Уже полученные награды остаются у игроков.`);
  return { ok: true };
}

export = { forPlayer, claim, adminList, adminSave, adminRemove, MAX_DAYS, MAX_ITEMS };
