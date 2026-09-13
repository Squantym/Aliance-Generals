// ═══════════════════════════════════════════════════════════════════
// src/services/multiWatch.ts — кого проверить на мультоводство
//
// Раньше разбор начинался с догадки: сотрудник вбивал два позывных в
// «Адреса и устройства» и смотрел, совпало ли. То есть находили только
// то, что УЖЕ подозревали. Здесь наоборот: сервер сам обходит игроков,
// собирает пары с общим устройством, отпечатком или адресом и выдаёт
// список, отсортированный по силе улик.
//
// Приглашения делают это особенно важным: за приглашённого платят
// золотом и долей с его покупок, а значит, заводить твинков стало
// выгодно. Поэтому связь «пригласивший ↔ приглашённый» прибавляет к
// подозрению отдельно, а сколько золота ушло по этой связи — видно
// прямо в строке.
//
// ВАЖНО: это не приговор. Общий компьютер в семье, интернет-клуб и
// одинаковая модель телефона дают те же совпадения честно. Поэтому
// каждая строка несёт ПРИЧИНЫ, а решение принимает человек.
// ═══════════════════════════════════════════════════════════════════

import u = require('../core/utils');
import player = require('./player');
import type { User } from '../types';

// Ячейка, в которой сидит больше этого числа аккаунтов, — не улика, а
// оператор связи, общежитие или кривой прокси. Такие показываем
// отдельным списком, но пар из них не строим: там тысячи сочетаний.
const CROWD = 12;

type Bucket = { kind: string; key: string; ids: string[] };

function livePlayers(): any[] {
  return Object.values(player.users() as Record<string, User>).filter((p: any) => p && !p.isBot);
}

function sameAccount(a: any, b: any): boolean {
  try { return require('./account').sameAccount(a, b); } catch (e) { return false; }
}

// Раскладываем игроков по признакам: устройство, отпечаток, адрес
function buckets(list: any[]): { buckets: Bucket[]; crowded: Bucket[] } {
  const dev: Record<string, string[]> = {};
  const fps: Record<string, string[]> = {};
  const ips: Record<string, string[]> = {};
  const put = (map: Record<string, string[]>, key: string, id: string) => {
    if (!key) return;
    if (!map[key]) map[key] = [];
    if (map[key].indexOf(id) === -1) map[key].push(id);
  };
  for (const p of list) {
    const acc = (p.access || {}) as any;
    for (const [key, d] of Object.entries(acc.devices || {})) {
      const dd: any = d;
      // Ключ без отпечатка — это просто строка браузера, она совпадает
      // у тысяч людей и уликой не является
      if (dd && dd.fp) put(dev, key, p.id);
      if (dd && dd.fp) put(fps, String(dd.fp), p.id);
      // dids — массив меток браузера (access.ts), а не объект
      for (const did of (Array.isArray(dd && dd.dids) ? dd.dids : [])) put(dev, 'did:' + did, p.id);
    }
    for (const ip of Object.keys(acc.ips || {})) {
      if (ip && ip !== 'unknown' && isRealIp(ip)) put(ips, ip, p.id);
    }
  }
  const all: Bucket[] = [];
  const crowded: Bucket[] = [];
  const collect = (map: Record<string, string[]>, kind: string) => {
    for (const [key, ids] of Object.entries(map)) {
      if (ids.length < 2) continue;
      (ids.length > CROWD ? crowded : all).push({ kind, key, ids });
    }
  };
  collect(dev, 'device');
  collect(fps, 'fp');
  collect(ips, 'ip');
  return { buckets: all, crowded };
}

// Адрес, по которому вообще можно кого-то опознать: локальные и
// служебные адреса появляются у всех сразу при кривом прокси
function isRealIp(ip: string): boolean {
  try { return require('./access').isIdentifyingIp(ip); } catch (e) { return true; }
}

// Вес каждой улики. Устройство весит больше адреса: адрес общий у всей
// квартиры, а метка браузера — у одного браузера на одной машине.
const WEIGHT: Record<string, number> = { device: 50, fp: 30, ip: 15 };
const WHY: Record<string, string> = {
  device: 'общее устройство',
  fp: 'совпал отпечаток (экран, пояс, ядра)',
  ip: 'общий адрес',
};

function pairKey(a: string, b: string): string { return a < b ? a + '|' + b : b + '|' + a; }

function suspects(opts?: { limit?: number; minScore?: number }) {
  const list = livePlayers();
  const byId: Record<string, any> = {};
  for (const p of list) byId[p.id] = p;
  const { buckets: bk, crowded } = buckets(list);

  const pairs: Record<string, any> = {};
  for (const b of bk) {
    for (let i = 0; i < b.ids.length; i++) {
      for (let j = i + 1; j < b.ids.length; j++) {
        const A = byId[b.ids[i]], B = byId[b.ids[j]];
        if (!A || !B) continue;
        // Несколько персонажей одного аккаунта — разрешено правилами
        // игры, и мешать их с мультоводством нельзя
        if (sameAccount(A, B)) continue;
        const key = pairKey(A.id, B.id);
        const row = pairs[key] || (pairs[key] = {
          a: { id: A.id, name: A.name, level: A.level || 1, lastSeen: A.lastSeen || 0, banned: !!A.banned },
          b: { id: B.id, name: B.name, level: B.level || 1, lastSeen: B.lastSeen || 0, banned: !!B.banned },
          score: 0, reasons: [] as string[], kinds: {} as Record<string, number>,
        });
        row.kinds[b.kind] = (row.kinds[b.kind] || 0) + 1;
      }
    }
  }

  const out: any[] = [];
  for (const row of Object.values(pairs) as any[]) {
    const A = byId[row.a.id], B = byId[row.b.id];
    for (const [kind, n] of Object.entries(row.kinds)) {
      row.score += WEIGHT[kind] || 0;
      row.reasons.push(`${WHY[kind]}${(n as number) > 1 ? ` ×${n}` : ''}`);
    }
    // Связь по приглашению — отдельный повод присмотреться: именно за
    // неё платят золотом
    const invited = A.referredBy === B.id ? { boss: B, mate: A } : (B.referredBy === A.id ? { boss: A, mate: B } : null);
    if (invited) {
      row.score += 25;
      row.referral = { bossId: invited.boss.id, bossName: invited.boss.name,
                       mateName: invited.mate.name,
                       goldPaid: Number(invited.mate.refGoldGiven || 0) };
      row.reasons.push(`«${invited.boss.name}» пригласил «${invited.mate.name}»`);
      if (row.referral.goldPaid > 0) {
        row.score += 15;
        row.reasons.push(`по этой связи ушло 🪙 ${u.fmt(row.referral.goldPaid)}`);
      }
    }
    // Завели в один день — частый почерк твинковода
    const dayA = u.dayKey(A.createdAt || 0), dayB = u.dayKey(B.createdAt || 0);
    if (A.createdAt && B.createdAt && dayA === dayB) {
      row.score += 10;
      row.reasons.push('зарегистрированы в один день');
    }
    out.push(row);
  }

  // Ноль — это «показать всё», а не «настройки нет»: через `|| 30` такой
  // порог молча превращался бы в тридцать
  const rawMin = opts && opts.minScore;
  const minScore = Math.max(0, rawMin === undefined || rawMin === null || isNaN(Number(rawMin)) ? 30 : Number(rawMin));
  const limit = u.clamp(Number(opts && opts.limit) || 50, 1, 300);
  out.sort((x, y) => y.score - x.score);
  const rows = out.filter((r) => r.score >= minScore).slice(0, limit);

  return {
    pairs: rows,
    total: out.length,
    shown: rows.length,
    minScore,
    // Переполненные ячейки: показываем как справку, а не как улику
    crowded: crowded
      .map((c) => ({ kind: c.kind, key: c.kind === 'ip' ? c.key : String(c.key).slice(0, 16), count: c.ids.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    players: list.length,
  };
}

// Отдельный вопрос владельца: «а не сам ли он себе наприглашал?»
// Для каждого приглашающего — сколько его приглашённых сидят с ним на
// одном устройстве или адресе.
function referralRisk(limit?: number) {
  const list = livePlayers();
  const byId: Record<string, any> = {};
  for (const p of list) byId[p.id] = p;
  const { buckets: bk } = buckets(list);
  const linked: Record<string, Set<string>> = {};
  for (const b of bk) {
    for (let i = 0; i < b.ids.length; i++) {
      for (let j = i + 1; j < b.ids.length; j++) {
        const x = b.ids[i], y = b.ids[j];
        (linked[x] || (linked[x] = new Set())).add(b.kind + ':' + y);
        (linked[y] || (linked[y] = new Set())).add(b.kind + ':' + x);
      }
    }
  }
  const rows: any[] = [];
  for (const boss of list) {
    const mates = list.filter((p: any) => p.referredBy === boss.id);
    if (!mates.length) continue;
    const shared = mates.filter((m: any) => {
      const set = linked[boss.id];
      return !!set && (set.has('device:' + m.id) || set.has('fp:' + m.id) || set.has('ip:' + m.id));
    });
    if (!shared.length) continue;
    rows.push({
      id: boss.id, name: boss.name, level: boss.level || 1,
      invited: mates.length,
      shared: shared.length,
      goldPaid: mates.reduce((s: number, m: any) => s + Number(m.refGoldGiven || 0), 0),
      names: shared.slice(0, 10).map((m: any) => m.name),
    });
  }
  rows.sort((a, b) => (b.shared - a.shared) || (b.goldPaid - a.goldPaid));
  return { rows: rows.slice(0, u.clamp(Number(limit) || 30, 1, 200)) };
}

function view(opts?: any) {
  return Object.assign(suspects(opts), { referral: referralRisk(30).rows });
}

export = { suspects, referralRisk, view };
