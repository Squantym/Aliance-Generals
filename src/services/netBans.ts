// ═══════════════════════════════════════════════════════════════════
// src/services/netBans.ts — бан по адресу и по устройству
//
// Бан аккаунта не мешает нарушителю завести новый. Этот бан закрывает
// вход с адреса или с устройства — любым аккаунтом, включая новые.
//
// Честно о пределах (панель говорит то же самое сотруднику):
//   • АДРЕС. За одним адресом бывает квартира, общежитие или мобильный
//     оператор на сотни абонентов — бан заденет всех. Поэтому перед баном
//     панель показывает, кто ещё заходил с адреса, а срок лучше ставить.
//   • УСТРОЙСТВО. Браузер не отдаёт сайту серийные номера — «железа» в
//     прямом смысле игра не видит. Устройство узнаётся по двум вещам:
//       – метке браузера: случайная строка, которую игра кладёт в память
//         браузера (public/js/api.js). Точная, но снимается очисткой
//         данных браузера или другим браузером;
//       – отпечатку: экран, часовой пояс, язык, ядра. Переживает очистку,
//         но у одинаковых моделей телефонов может совпасть.
//     Бан ловит по любому из двух.
//
// Сотрудников бан не запирает (см. core/http.ts), а забанить адрес или
// устройство, которым пользуется сотрудник, сервис не даёт вовсе:
// владелец не должен остаться без панели из-за общего с нарушителем
// мобильного оператора.
//
// Хранение: коллекция 'netBans' = { [id]: NetBan }
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import type { User, Notices } from '../types';

type NetBan = {
  id: string;
  type: 'ip' | 'device';
  value: string;          // адрес или ключ устройства
  dids: string[];         // метки браузера этого устройства
  fp: string;             // отпечаток этого устройства
  label: string;          // как устройство называлось в панели
  reason: string;
  byId: string;
  byName: string;
  at: number;
  until: number;          // 0 — бессрочно
  accounts: Array<{ id: string; name: string }>;   // кто заходил на момент бана
  removedAt?: number;
  removedBy?: string;
};

const MAX_DAYS = 3650;
const DID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function store(): Record<string, NetBan> {
  return db.load<Record<string, NetBan>>('netBans', {});
}

function cleanDid(v: any): string {
  const s = String(v || '').trim();
  return DID_RE.test(s) ? s : '';
}

function isActive(b: NetBan): boolean {
  return !b.removedAt && (!b.until || b.until > Date.now());
}

function access() { return require('./access'); }
function roles() { return require('./roles'); }
function users(): Record<string, any> { return require('./player').users(); }

function assertZone(actor: User) {
  if (!roles().canAccessZone(actor, 'moderation')) {
    throw new u.ApiError('Нет права «Баны аккаунтов». Обратитесь к владельцу проекта.');
  }
}

// ── Проверка запроса ──────────────────────────────────────────────
// Зовётся на каждом запросе вошедшего игрока, поэтому дорогой ключ
// устройства считается только при совпавшем отпечатке.
function check(ctx: { ip?: string; ua?: string; hints?: any; fp?: string; did?: string }): NetBan | null {
  const all = store();
  const ids = Object.keys(all);
  if (!ids.length) return null;
  const ip = String((ctx && ctx.ip) || '').replace(/^::ffff:/, '');
  const did = cleanDid(ctx && ctx.did);
  const fp = String((ctx && ctx.fp) || '');
  let key: string | null = null;
  for (const id of ids) {
    const b = all[id];
    if (!b || !isActive(b)) continue;
    if (b.type === 'ip') {
      if (ip && b.value === ip) return b;
      continue;
    }
    if (did && Array.isArray(b.dids) && b.dids.indexOf(did) >= 0) return b;
    if (b.fp && fp && fp === b.fp) {
      if (key === null) key = access().deviceKey((ctx && ctx.ua) || '', ctx && ctx.hints, fp);
      // По отпечатку ловим только того, чья метка браузера нигде в игре не
      // встречалась. Отпечаток у одинаковых моделей телефонов совпадает, и
      // без этой оговорки бан задел бы честного владельца такой же модели —
      // а его метка давно записана в его аккаунте. Нарушитель же, очистивший
      // браузер ради обхода бана, приходит с новой меткой и попадается.
      if (key === b.value && (!did || !didKnown(did))) return b;
    }
  }
  return null;
}

// Встречалась ли метка браузера хоть у одного аккаунта. Зовётся только при
// совпавшем отпечатке забаненного устройства — то есть почти никогда.
function didKnown(did: string): boolean {
  for (const p of Object.values(users())) {
    const devs = (p && p.access && p.access.devices) || {};
    for (const d of Object.values(devs) as any[]) {
      if (d && Array.isArray(d.dids) && d.dids.indexOf(did) >= 0) return true;
    }
  }
  return false;
}

// Сведения для окна блокировки — того же вида, что у бана аккаунта:
// клиент уже умеет его показывать (App.showBanScreen)
function banInfo(b: NetBan, name: string) {
  const what = b.type === 'ip' ? 'с этого адреса' : 'с этого устройства';
  return {
    banned: true,
    network: b.type,
    reason: `Вход ${what} закрыт администрацией. ${b.reason}`.trim(),
    until: b.until || 0,
    bannedAt: b.at || 0,
    name: name || '',
  };
}

// ── Кого затронет бан ─────────────────────────────────────────────
function target(type: 'ip' | 'device', q: any): { value: string; dids: string[]; fp: string; label: string } {
  if (type === 'ip') {
    const value = String((q && q.value) || '').trim().replace(/^::ffff:/, '');
    if (!value || value.length > 45 || !/^[0-9a-fA-F:.]+$/.test(value) || !u.isPublicIp(value)) {
      throw new u.ApiError('Укажите внешний IP-адрес. Внутренние адреса (127.x, 192.168.x, 10.x) никого не опознают.');
    }
    return { value, dids: [], fp: '', label: value };
  }
  const owner = users()[String((q && q.userId) || '')];
  if (!owner) throw new u.ApiError('Игрок не найден');
  const dev = (((owner.access || {}).devices) || {})[String((q && q.key) || '')];
  if (!dev) throw new u.ApiError('У игрока нет такого устройства');
  const dids = (Array.isArray(dev.dids) ? dev.dids : []).map(cleanDid).filter(Boolean);
  if (!dev.fp && !dids.length) {
    throw new u.ApiError('У этого устройства нет ни отпечатка, ни метки браузера: бан задел бы всех, '
      + 'у кого такой же браузер и система. Забаньте адрес или дождитесь нового входа с устройства.');
  }
  return { value: String(dev.key), dids, fp: String(dev.fp || ''), label: String(dev.label || '') };
}

function touches(p: any, type: 'ip' | 'device', t: { value: string; dids: string[] }): boolean {
  const a = (p && p.access) || {};
  if (type === 'ip') return !!(a.ips && a.ips[t.value]);
  const devs = a.devices || {};
  if (devs[t.value]) return true;
  if (!t.dids.length) return false;
  return Object.values(devs).some((d: any) => Array.isArray(d.dids) && d.dids.some((x: string) => t.dids.indexOf(x) >= 0));
}

function affected(type: 'ip' | 'device', t: { value: string; dids: string[] }) {
  const out: Array<{ id: string; name: string; level: number; staff: boolean }> = [];
  for (const p of Object.values(users())) {
    if (!p || p.isBot || !touches(p, type, t)) continue;
    out.push({ id: p.id, name: p.name, level: p.level || 1, staff: !!roles().roleOf(p) });
  }
  return out;
}

function kindOf(q: any): 'ip' | 'device' {
  const t = String((q && q.type) || '');
  if (t === 'ip') return 'ip';
  if (t === 'device') return 'device';
  throw new u.ApiError('Укажите, что банить: адрес или устройство');
}

// Что будет, если забанить — показывается ДО бана
function preview(actor: User, q: any) {
  assertZone(actor);
  const type = kindOf(q);
  const t = target(type, q);
  const list = affected(type, t);
  const staff = list.filter((x) => x.staff).map((x) => x.name);
  return {
    type, value: t.value, label: t.label, hasDid: t.dids.length > 0, hasFp: !!t.fp,
    accounts: list.filter((x) => !x.staff), staff,
    canBan: staff.length === 0,
  };
}

function add(actor: User, body: any, notices: Notices) {
  assertZone(actor);
  const type = kindOf(body);
  const t = target(type, body);
  const reason = String((body && body.reason) || '').trim().slice(0, 200);
  if (!reason) throw new u.ApiError('Укажите причину: её увидит тот, кого не пустит в игру');
  const days = u.clamp(u.toInt(body && body.days, 0), 0, MAX_DAYS);

  const all = store();
  if (Object.values(all).some((b) => isActive(b) && b.type === type && b.value === t.value)) {
    throw new u.ApiError(type === 'ip' ? 'Этот адрес уже заблокирован' : 'Это устройство уже заблокировано');
  }
  const list = affected(type, t);
  const staff = list.filter((x) => x.staff).map((x) => x.name);
  if (staff.length) {
    throw new u.ApiError(`${type === 'ip' ? 'Этим адресом' : 'Этим устройством'} пользуется сотрудник: `
      + `${staff.join(', ')}. Бан запер бы и его — выберите другой способ.`);
  }

  const now = Date.now();
  const b: NetBan = {
    id: u.uid(10), type, value: t.value, dids: t.dids, fp: t.fp, label: t.label,
    reason, byId: actor.id, byName: actor.name, at: now,
    until: days ? now + days * 86400000 : 0,
    accounts: list.slice(0, 50).map((x) => ({ id: x.id, name: x.name })),
  };
  all[b.id] = b;
  db.save('netBans');
  const what = type === 'ip' ? `адреса ${t.value}` : `устройства «${t.label}»`;
  notices.push(`🚫 Вход с ${what} закрыт ${days ? `на ${days} дн.` : 'бессрочно'}. Затронуто аккаунтов: ${list.length}.`);
  return { ban: viewOf(b), affected: list.length };
}

function remove(actor: User, id: string, notices: Notices) {
  assertZone(actor);
  const b = store()[String(id || '')];
  if (!b || b.removedAt) throw new u.ApiError('Бан не найден');
  b.removedAt = Date.now();
  b.removedBy = actor.name;
  db.save('netBans');
  notices.push(`✅ Бан ${b.type === 'ip' ? 'адреса ' + b.value : 'устройства «' + b.label + '»'} снят`);
  return { ok: true };
}

function viewOf(b: NetBan) {
  return {
    id: b.id, type: b.type, value: b.value, label: b.label,
    byDid: (b.dids || []).length > 0, byFp: !!b.fp,
    reason: b.reason, byName: b.byName, at: b.at, until: b.until,
    active: isActive(b), removedAt: b.removedAt || 0, removedBy: b.removedBy || '',
    accounts: b.accounts || [],
  };
}

// Действующие и снятые/истёкшие за последний месяц — для истории решений
function list(actor: User) {
  assertZone(actor);
  const monthAgo = Date.now() - 30 * 86400000;
  const rows = Object.values(store())
    .filter((b) => isActive(b) || (b.removedAt || b.until || 0) > monthAgo)
    .sort((a, b) => b.at - a.at)
    .map(viewOf);
  return { bans: rows };
}

export = { check, banInfo, preview, add, remove, list, cleanDid };
