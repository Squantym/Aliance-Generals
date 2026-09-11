// ═══════════════════════════════════════════════════════════════════
// src/services/donateBonus.ts — бонусы к покупкам за рубли
//
// Акция, которую собирает владелец (или сотрудник с правом «Акции»):
//   • что даёт: +N% золота к пакету ИЛИ ускорение опыта +N% на срок;
//   • как часто: за первое пополнение, один раз на игрока, до N раз в
//     сутки (московские), к каждой покупке;
//   • для каких покупок (опыт): пакеты золота, наборы или любые;
//   • срок акции и выключатель.
//
// Чем отличается от «Бонуса к покупаемому золоту» в скидках: там надбавка
// одна на всех и без ограничений на игрока. Здесь — лимиты на человека, и
// обе надбавки складываются.
//
// Главное правило — обещанное до оплаты исполняется. Условия акции
// снимаются в заказ в момент его создания (snapshot): изменили или удалили
// акцию, пока игрок платил, — он всё равно получит то, что видел в банке.
// Лимиты при этом перепроверяются при зачислении: две покупки, оформленные
// одновременно, не получат разовый бонус дважды.
//
// Хранение: коллекция 'donateBonuses' = { [id]: Promo }; у игрока —
// поле donateBonus { used: {id: {total, day, dayCount}}, xp: {pct, until} }.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import type { User, Notices } from '../types';

type Kind = 'gold' | 'xp';
type Limit = 'first' | 'once' | 'daily' | 'every';
type Target = 'gold' | 'offers' | 'all';

interface Promo {
  id: string;
  title: string;
  kind: Kind;
  pct: number;
  limit: Limit;
  perDay: number;      // для daily — сколько раз в сутки
  hours: number;       // для xp — на сколько часов ускорение
  target: Target;      // для xp — к каким покупкам; gold — только пакеты
  startAt: number;     // 0 — сразу
  endAt: number;       // 0 — бессрочно
  enabled: boolean;
  createdAt: number;
  byName: string;
  applied: number;     // сколько раз бонус начислен
}

const MAX_PCT = 300;
const MAX_HOURS = 720;
// Ускорение копится продлением, но не больше месяца вперёд: иначе серия
// покупок превращала бы временную акцию в постоянный множитель
const MAX_XP_BOOST_MS = 30 * 24 * 3600 * 1000;
const LIMITS: Limit[] = ['first', 'once', 'daily', 'every'];

function store(): Record<string, Promo> { return db.load<Record<string, Promo>>('donateBonuses', {}); }
function roles() { return require('./roles'); }
const num = (v: number) => Number(v || 0).toLocaleString('ru-RU');

function assertZone(actor: User) {
  if (!roles().canAccessZone(actor, 'discounts')) throw new u.ApiError('Нужно право «Акции»');
}

function isLive(p: Promo, now?: number): boolean {
  const t = now || Date.now();
  return !!p && p.enabled && (!p.startAt || p.startAt <= t) && (!p.endAt || p.endAt > t);
}

function orderKind(order: any): 'gold' | 'offers' { return order && order.offerId ? 'offers' : 'gold'; }

function fits(p: { kind: Kind; target: Target }, kind: 'gold' | 'offers'): boolean {
  if (p.kind === 'gold') return kind === 'gold';          // процент от золота пакета
  return p.target === 'all' || p.target === kind;
}

function box(user: any) {
  const b = user.donateBonus || (user.donateBonus = { used: {}, xp: null });
  if (!b.used) b.used = {};
  return b;
}

// Сколько оплаченных заказов у игрока, кроме указанного
function paidCount(user: any, exceptOrderId?: string): number {
  const all: Record<string, any> = db.load('payments', {});
  let n = 0;
  for (const o of Object.values(all)) {
    if (o && o.userId === user.id && o.status === 'paid' && o.id !== exceptOrderId) n++;
  }
  return n;
}

function canUse(user: any, p: { id: string; limit: Limit; perDay: number }, exceptOrderId?: string, now?: number) {
  const t = now || Date.now();
  const used = (user.donateBonus && user.donateBonus.used && user.donateBonus.used[p.id]) || { total: 0, day: '', dayCount: 0 };
  switch (p.limit) {
    case 'first': return { ok: paidCount(user, exceptOrderId) === 0, left: null as number | null };
    case 'once': return { ok: (used.total || 0) === 0, left: null as number | null };
    case 'daily': {
      const cnt = used.day === u.dayKey(t) ? (used.dayCount || 0) : 0;
      const left = Math.max(0, (p.perDay || 0) - cnt);
      return { ok: left > 0, left };
    }
    default: return { ok: true, left: null as number | null };
  }
}

function describe(p: { kind: Kind; pct: number; hours: number; limit: Limit; perDay: number; target: Target }): string {
  const what = p.kind === 'gold' ? `+${p.pct}% золота к пакету` : `+${p.pct}% опыта на ${p.hours} ч`;
  const lim = p.limit === 'first' ? 'за первое пополнение'
    : p.limit === 'once' ? 'один раз'
    : p.limit === 'daily' ? `до ${p.perDay} раз в день`
    : 'к каждой покупке';
  const where = p.kind === 'xp' && p.target !== 'all' ? (p.target === 'gold' ? ' (пакеты золота)' : ' (наборы)') : '';
  return `${what}, ${lim}${where}`;
}

function view(p: Promo) {
  return Object.assign({}, p, { live: isLive(p), text: describe(p) });
}

// ── Для игрока: что сейчас идёт и что из этого ему доступно ───────
function forPlayer(user: any) {
  const now = Date.now();
  return Object.values(store())
    .filter((p) => isLive(p, now))
    .map((p) => {
      const c = canUse(user, p, undefined, now);
      return {
        id: p.id, title: p.title, kind: p.kind, pct: p.pct, limit: p.limit, perDay: p.perDay,
        hours: p.hours, target: p.target, endAt: p.endAt, text: describe(p),
        available: c.ok, leftToday: c.left,
      };
    })
    .sort((a, b) => (a.endAt || Infinity) - (b.endAt || Infinity));
}

// ── Снимок условий в заказ ────────────────────────────────────────
function snapshot(user: any, order: any) {
  const now = Date.now();
  const kind = orderKind(order);
  return Object.values(store())
    .filter((p) => isLive(p, now) && fits(p, kind) && canUse(user, p, undefined, now).ok)
    .map((p) => ({ id: p.id, title: p.title, kind: p.kind, pct: p.pct, limit: p.limit, perDay: p.perDay, hours: p.hours }));
}

function markUsed(user: any, promoId: string, now: number) {
  const b = box(user);
  const today = u.dayKey(now);
  const used = b.used[promoId] || { total: 0, day: '', dayCount: 0 };
  used.total = (used.total || 0) + 1;
  used.dayCount = used.day === today ? (used.dayCount || 0) + 1 : 1;
  used.day = today;
  b.used[promoId] = used;
}

// Повторная покупка ПРОДЛЕВАЕТ ускорение, а не складывает проценты:
// +100% дважды — это вдвое дольше, а не +200%
function grantXp(user: any, pct: number, hours: number, now: number) {
  const b = box(user);
  const cur = b.xp && b.xp.until > now ? b.xp : null;
  const from = cur ? cur.until : now;
  const until = Math.min(now + MAX_XP_BOOST_MS, from + hours * 3600 * 1000);
  b.xp = { pct: Math.max(cur ? cur.pct : 0, pct), until };
  return b.xp;
}

// ── Зачисление по оплаченному заказу ──────────────────────────────
// Возвращает золото сверху (зачисляет его платёжный модуль вместе с
// покупкой), строки для окна покупки и квитанции и что применено.
function applyOnPaid(user: any, order: any) {
  const now = Date.now();
  const snap = Array.isArray(order && order.promos) ? order.promos : [];
  const out = { goldExtra: 0, lines: [] as Array<{ text: string; icon: string | null }>, applied: [] as any[] };
  const all = store();
  for (const s of snap) {
    if (!canUse(user, s, order.id, now).ok) continue;
    if (s.kind === 'gold') {
      if (order.offerId) continue;
      const extra = Math.round((Number(order.gold) || 0) * s.pct / 100);
      if (extra <= 0) continue;
      out.goldExtra += extra;
      out.lines.push({ text: `Бонус «${s.title}»: +${num(extra)} золота`, icon: '/img/icons/gold.webp' });
      out.applied.push({ id: s.id, title: s.title, kind: 'gold', pct: s.pct, gold: extra });
    } else {
      const xp = grantXp(user, s.pct, s.hours, now);
      out.lines.push({ text: `⚡ +${s.pct}% опыта на ${s.hours} ч — «${s.title}»`, icon: null });
      out.applied.push({ id: s.id, title: s.title, kind: 'xp', pct: s.pct, hours: s.hours, until: xp.until });
    }
    markUsed(user, s.id, now);
    if (all[s.id]) all[s.id].applied = (all[s.id].applied || 0) + 1;
  }
  if (out.applied.length) {
    db.save('donateBonuses');
    db.markUser(user.id);
  }
  return out;
}

// Множитель опыта — зовёт player.addXp, единственная точка начисления
function xpBoostMul(user: any): number {
  const x = user && user.donateBonus && user.donateBonus.xp;
  return x && x.until > Date.now() ? 1 + (Number(x.pct) || 0) / 100 : 1;
}

function xpBoostView(user: any) {
  const x = user && user.donateBonus && user.donateBonus.xp;
  return x && x.until > Date.now() ? { pct: x.pct, until: x.until } : null;
}

// ── Штаб ──────────────────────────────────────────────────────────
function adminList(actor: User) {
  assertZone(actor);
  return { promos: Object.values(store()).sort((a, b) => b.createdAt - a.createdAt).map(view) };
}

function adminSave(actor: User, body: any, notices: Notices) {
  assertZone(actor);
  const b = body || {};
  const title = String(b.title || '').trim().slice(0, 60);
  if (!title) throw new u.ApiError('Назовите акцию — название увидят игроки');
  const kind = b.kind === 'xp' ? 'xp' : (b.kind === 'gold' ? 'gold' : '');
  if (!kind) throw new u.ApiError('Выберите, что даёт акция: золото или опыт');
  const pct = u.toInt(b.pct, 0);
  if (pct < 1 || pct > MAX_PCT) throw new u.ApiError(`Процент — от 1 до ${MAX_PCT}`);
  const limit = LIMITS.indexOf(b.limit) >= 0 ? b.limit as Limit : null;
  if (!limit) throw new u.ApiError('Выберите, как часто даётся бонус');
  const perDay = limit === 'daily' ? u.toInt(b.perDay, 0) : 0;
  if (limit === 'daily' && (perDay < 1 || perDay > 50)) throw new u.ApiError('Раз в день — от 1 до 50');
  const hours = kind === 'xp' ? u.toInt(b.hours, 0) : 0;
  if (kind === 'xp' && (hours < 1 || hours > MAX_HOURS)) throw new u.ApiError(`Срок ускорения — от 1 до ${MAX_HOURS} часов`);
  const target: Target = kind === 'gold' ? 'gold' : (['gold', 'offers', 'all'].indexOf(b.target) >= 0 ? b.target : 'all');
  const startAt = Math.max(0, Number(b.startAt) || 0);
  const endAt = Math.max(0, Number(b.endAt) || 0);
  if (endAt && endAt <= (startAt || Date.now())) throw new u.ApiError('Конец акции раньше её начала');

  const all = store();
  const prev = b.id ? all[String(b.id)] : null;
  const id = prev ? prev.id : u.uid(10);
  all[id] = {
    id, title, kind: kind as Kind, pct, limit, perDay, hours, target, startAt, endAt,
    enabled: b.enabled !== false,
    createdAt: prev ? prev.createdAt : Date.now(),
    byName: actor.name,
    applied: prev ? (prev.applied || 0) : 0,
  };
  db.save('donateBonuses');
  notices.push(`🎁 Акция «${title}» ${prev ? 'изменена' : 'создана'}: ${describe(all[id])}`);
  return { promo: view(all[id]) };
}

function adminRemove(actor: User, id: string, notices: Notices) {
  assertZone(actor);
  const all = store();
  const p = all[String(id || '')];
  if (!p) throw new u.ApiError('Акция не найдена');
  delete all[p.id];
  db.save('donateBonuses');
  notices.push(`🗑 Акция «${p.title}» удалена. Заказы, оформленные до удаления, получат обещанный бонус.`);
  return { ok: true };
}

export = {
  forPlayer, snapshot, applyOnPaid, xpBoostMul, xpBoostView, describe,
  adminList, adminSave, adminRemove, MAX_PCT, MAX_HOURS,
};
