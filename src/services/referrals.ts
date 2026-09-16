// ═══════════════════════════════════════════════════════════════════
// src/services/referrals.ts — приглашение друзей: ссылка, список, задания
//
// Сам код-приглашение и начисления по нему остались в features.ts
// (историческое место, на него ссылается половина игры). Здесь то, что
// выросло вокруг него:
//   • личная ссылка вида https://адрес/?ref=КОД — по ней код
//     подставляется сам, вводить руками ничего не нужно;
//   • список приглашённых: кто пришёл, докуда дорос, сколько золота
//     принёс. Раньше игрок видел только счётчик «приглашено: 3» и не мог
//     понять, кто из друзей вообще зашёл;
//   • раздел «Задания» («Операция „Пополнение“») — показан по умолчанию,
//     выключатель в панели остался на случай, если его понадобится
//     временно спрятать.
//
// QR-код НЕ рисуется на сервере: картинка нужна только в интерфейсе, и
// рисовать её в браузере дешевле, чем гонять по сети (public/js/screens/
// referrals.js).
//
// Хранение: коллекция 'referralSettings' = { questsOn, questsTitle, ... }
// ═══════════════════════════════════════════════════════════════════

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import type { User, Notices } from '../types';

interface RefSettings {
  questsOn: boolean;     // показывать ли игрокам раздел «Задания»
  changedAt: number;
  changedBy: string;
}

function settings(): RefSettings {
  // Умолчание — «показан». Раздел заданий давно наполнен, но у игроков он
  // так и не появился: выключатель стоял в положении «скрыт» с тех пор,
  // когда заданий ещё не было, и включить его никто не догадался.
  const s = db.load<RefSettings>('referralSettings', { questsOn: true, changedAt: 0, changedBy: '' });
  if (typeof s.questsOn !== 'boolean') s.questsOn = true;
  // changedAt = 0 значит, что кнопку в панели никто не нажимал, а запись
  // в базе — след старого умолчания: db.saveAll() пишет все загруженные
  // коллекции, в том числе созданные из значения по умолчанию. Решением
  // владельца такую запись считать нельзя.
  if (!s.changedAt) s.questsOn = true;
  return s;
}

function questsEnabled(): boolean {
  return !!settings().questsOn;
}

// ── Личная ссылка ──────────────────────────────────────────────────
// Адрес игры берём из той же настройки, что и ссылки в письмах: другого
// достоверного источника у сервера нет, а «угадать» его по заголовку
// запроса нельзя — подменяется кем угодно.
function appUrl(): string {
  let url = '';
  try { url = String(require('./email').APP_URL || ''); } catch (e) { url = ''; }
  return url.replace(/\/+$/, '');
}

function linkFor(code: string): string {
  const base = appUrl();
  return base ? `${base}/?ref=${encodeURIComponent(code)}` : `?ref=${encodeURIComponent(code)}`;
}

// ── Кого привёл ────────────────────────────────────────────────────
// Показываем позывной, уровень и состояние: дошёл ли до 50 (за это
// платят) и заходит ли вообще. Сколько друг ПОТРАТИЛ денег — не
// показываем никогда: это чужая покупка. Видно только, сколько золота
// с него получил сам пригласивший.
const ACTIVE_MS = 3 * 24 * 3600 * 1000;

function invitedList(user: User) {
  const all = player.users() as Record<string, User>;
  const mine = Object.values(all).filter((p: any) => p && p.referredBy === user.id);
  const now = Date.now();
  return mine
    .map((p: any) => ({
      name: String(p.name || ''),
      level: Number(p.level || 1),
      joinedAt: Number(p.createdAt || 0),
      lastSeen: Number(p.lastSeen || 0),
      active: !!p.lastSeen && now - p.lastSeen < ACTIVE_MS,
      reached50: !!p.refLevel50Paid,
      goldFromHim: Number(p.refGoldGiven || 0),
    }))
    .sort((a, b) => b.joinedAt - a.joinedAt);
}

// Переключатель из панели. Зона «Акции»: раздел про привлечение игроков,
// там же живут скидки и бонусы к покупкам.
function setQuests(actor: User, on: boolean, notices: Notices) {
  require('./roles').assertZone(actor, 'discounts', 'включение раздела заданий');
  const s = settings();
  s.questsOn = !!on;
  s.changedAt = Date.now();
  s.changedBy = String(actor.name || '');
  db.save('referralSettings');
  notices.push(s.questsOn
    ? '✅ Раздел «Задания» показан игрокам в «Пригласить друга»'
    : '🚫 Раздел «Задания» убран у игроков');
  return adminView(actor);
}

function adminView(actor: User) {
  require('./roles').assertZone(actor, 'discounts', 'настройки приглашений');
  const s = settings();
  const all = player.users() as Record<string, User>;
  const invited = Object.values(all).filter((p: any) => p && p.referredBy).length;
  return {
    questsOn: s.questsOn,
    changedAt: s.changedAt || 0,
    changedBy: s.changedBy || '',
    // Сколько условий настроено всего: обе шкалы и парные задания
    questCount: (config.REFERRAL_QUESTS.inviter || []).length
      + (config.REFERRAL_QUESTS.newbie || []).length
      + (config.REFERRAL_QUESTS.pairDaily || []).length
      + (config.REFERRAL_QUESTS.pairOnce || []).length,
    invited,
  };
}

// Адреса и устройства одного игрока — в виде множеств для сравнения.
// Правила «что считать уликой» те же, что у «Мультоводов»: адрес только
// публичный, устройство — только с отпечатком или меткой браузера
// (голая строка браузера совпадает у тысяч людей).
function fingerprints(p: any) {
  const a = (p && p.access) || {};
  const ips = new Set<string>();
  for (const ip of Object.keys(a.ips || {})) if (u.isPublicIp(ip)) ips.add(ip);
  const devs = new Map<string, string>();          // ключ улики → название устройства
  for (const [key, d] of Object.entries<any>(a.devices || {})) {
    if (!d) continue;
    if (d.fp) { devs.set('key:' + key, d.label || ''); devs.set('fp:' + d.fp, d.label || ''); }
    for (const did of (Array.isArray(d.dids) ? d.dids : [])) devs.set('did:' + did, d.label || '');
  }
  return {
    ips, devs,
    regIp: String(a.regIp || ''), lastIp: String(a.lastIp || ''),
    regDevice: String(a.regDevice || ''), lastDevice: String(a.lastDevice || ''),
    lastAt: Number(a.lastAt || 0),
    ipCount: Object.keys(a.ips || {}).length, devCount: Object.keys(a.devices || {}).length,
  };
}

// Что общего у приглашённого с пригласившим
function overlap(boss: any, friend: any) {
  const ips = [...friend.ips].filter((ip: string) => boss.ips.has(ip));
  const devLabels = new Set<string>();
  for (const [k, label] of friend.devs) if (boss.devs.has(k)) devLabels.add(label || 'устройство');
  return { ips: ips.slice(0, 5), devices: [...devLabels].slice(0, 5) };
}

const accessView = (f: any) => ({
  regIp: f.regIp, lastIp: f.lastIp, regDevice: f.regDevice, lastDevice: f.lastDevice,
  lastAt: f.lastAt, ipCount: f.ipCount, devCount: f.devCount,
});

// ── Панель: кто кого пригласил ─────────────────────────────────────
// Раздел «Приглашения» (#/invites). Всё собирается из живых полей
// игроков: referredBy у приглашённого, refEarnings у пригласившего.
// Отдельного журнала приглашений нет и не нужно — связь хранится в
// самом игроке и не может разойтись с ним.
//
// Зона — «Игроки»: это данные о людях, а не настройка акций. Сколько
// приглашённый ПОТРАТИЛ — не показываем и здесь: видно только, сколько
// золота с его покупок ушло пригласившему (refGoldGiven).
function adminInvites(actor: User, q: any) {
  require('./roles').assertZone(actor, 'players', 'список приглашений');
  const all = player.users() as Record<string, any>;
  const now = Date.now();
  const find = String((q && q.q) || '').trim().toLowerCase();
  const sort = String((q && q.sort) || 'count');
  const onlyMatched = String((q && q.match) || '') === '1';
  const cfg = config.REFERRAL;

  const person = (p: any) => ({
    id: p.id, name: String(p.name || ''), level: Number(p.level || 1),
    lastSeen: Number(p.lastSeen || 0), banned: !!p.banned,
    active: !!p.lastSeen && now - p.lastSeen < ACTIVE_MS,
  });

  // Группируем приглашённых по пригласившему за один проход
  const byInviter: Record<string, any[]> = {};
  for (const p of Object.values(all)) {
    if (!p || !p.referredBy || p.isBot) continue;
    (byInviter[p.referredBy] = byInviter[p.referredBy] || []).push(p);
  }

  let invitedTotal = 0, reached50Total = 0, activeTotal = 0, shareTotal = 0, matchedTotal = 0;
  const rows = Object.keys(byInviter).map((bossId) => {
    const boss = all[bossId];
    const bossFp = boss ? fingerprints(boss) : null;
    const friends = byInviter[bossId]
      .map((p: any) => {
        const fp = fingerprints(p);
        const same = bossFp ? overlap(bossFp, fp) : { ips: [], devices: [] };
        return {
          ...person(p),
          joinedAt: Number(p.createdAt || 0),
          reached50: !!p.refLevel50Paid,
          goldToInviter: Number(p.refGoldGiven || 0),
          access: accessView(fp),
          // Совпадения с пригласившим: общий адрес или общее устройство
          same,
          matched: same.ips.length > 0 || same.devices.length > 0,
        };
      })
      .sort((a, b) => b.joinedAt - a.joinedAt);
    const reached50 = friends.filter((f) => f.reached50).length;
    const active = friends.filter((f) => f.active).length;
    const share = friends.reduce((s, f) => s + f.goldToInviter, 0);
    invitedTotal += friends.length;
    reached50Total += reached50;
    activeTotal += active;
    shareTotal += share;
    const matched = friends.filter((f) => f.matched).length;
    matchedTotal += matched;
    let pct = cfg.purchaseSharePct;
    if (boss) { try { pct = require('./referralQuests').sharePctFor(boss); } catch (e) {} }
    return {
      // Пригласивший мог быть удалён — связь у приглашённых осталась
      inviter: boss
        ? { ...person(boss), refCode: String(boss.refCode || ''), access: accessView(bossFp) }
        : { id: bossId, name: '(удалён)', level: 0, lastSeen: 0, banned: false, active: false, refCode: '', access: null },
      count: friends.length,
      // Старый счётчик: считался при вводе кода и не уменьшается, когда
      // приглашённого удаляют. Показываем, если разошёлся с живым списком.
      counter: boss ? Number(boss.refCount || 0) : 0,
      reached50, active, matched,
      sharePct: pct,
      goldFromPurchases: share,
      goldForLevel50: reached50 * cfg.level50Reward,
      lastJoinedAt: friends.length ? friends[0].joinedAt : 0,
      friends,
    };
  });

  const matches = (r: any) => !find
    || r.inviter.name.toLowerCase().includes(find)
    || r.inviter.refCode.toLowerCase() === find
    || r.friends.some((f: any) => f.name.toLowerCase().includes(find));
  const SORTS: Record<string, (a: any, b: any) => number> = {
    count: (a, b) => b.count - a.count || b.reached50 - a.reached50,
    level50: (a, b) => b.reached50 - a.reached50 || b.count - a.count,
    gold: (a, b) => (b.goldFromPurchases + b.goldForLevel50) - (a.goldFromPurchases + a.goldForLevel50),
    recent: (a, b) => b.lastJoinedAt - a.lastJoinedAt,
    matched: (a, b) => b.matched - a.matched || b.count - a.count,
  };
  const list = rows.filter((r) => matches(r) && (!onlyMatched || r.matched > 0))
    .sort(SORTS[sort] || SORTS.count);

  return {
    totals: {
      inviters: rows.length,
      invited: invitedTotal,
      reached50: reached50Total,
      active: activeTotal,
      goldFromPurchases: shareTotal,
      goldForLevel50: reached50Total * cfg.level50Reward,
      goldToNewbies: invitedTotal * cfg.inviteeGold,
      matched: matchedTotal,
    },
    rules: { inviteeGold: cfg.inviteeGold, level50Reward: cfg.level50Reward, level50Tokens: cfg.level50Tokens, sharePct: cfg.purchaseSharePct },
    rows: list.slice(0, 300),
    shown: Math.min(list.length, 300),
    found: list.length,
  };
}

export = { settings, questsEnabled, linkFor, appUrl, invitedList, setQuests, adminView, adminInvites };
