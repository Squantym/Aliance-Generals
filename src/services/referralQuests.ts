// ═══════════════════════════════════════════════════════════════════
// src/services/referralQuests.ts — задания приглашений
//
// Две шкалы по 10 баллов (условия и награды — в config.REFERRAL_QUESTS):
//   • «Вербовщик» — у того, кто приглашает;
//   • «Новобранец» — у того, кого пригласили.
// Одно выполненное условие = 1 балл. Под каждым баллом своя награда,
// забирается кнопкой.
//
// Балл НЕ сгорает: условия проверяются по текущему состоянию игрока и
// его друзей, а список забранных наград хранится отдельно. Поэтому
// «шкала откатилась назад» невозможно — забранное остаётся забранным,
// даже если друг потом ушёл из альянса.
//
// Хранение: user.refQuests = {
//   claimed: { inviter: ['1','2'], newbie: [...] },
//   reinforceFriends: N          // отправлено подкреплений приглашённым
// }
// ═══════════════════════════════════════════════════════════════════

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import type { User, Notices } from '../types';

type Board = 'inviter' | 'newbie';

function boxOf(user: any): any {
  if (!user.refQuests || typeof user.refQuests !== 'object') user.refQuests = {};
  const b = user.refQuests;
  if (!b.claimed || typeof b.claimed !== 'object') b.claimed = {};
  if (!Array.isArray(b.claimed.inviter)) b.claimed.inviter = [];
  if (!Array.isArray(b.claimed.newbie)) b.claimed.newbie = [];
  if (typeof b.reinforceFriends !== 'number') b.reinforceFriends = 0;
  return b;
}

function friendsOf(user: User): User[] {
  const all = player.users() as Record<string, User>;
  return Object.values(all).filter((p: any) => p && p.referredBy === user.id);
}

function alliesCount(user: User, among?: User[]): number {
  const pa = require('./personalAlliance');
  const all = player.users() as Record<string, User>;
  const roster = ((user as any).allianceRoster || []).filter((m: any) => m && !m.isBot);
  const list = among || roster.map((m: any) => all[m.id]).filter(Boolean);
  return list.filter((p: any) => p && all[p.id] && pa.areAllies(user, all[p.id])).length;
}

function xpThisWeek(p: any): number {
  const box = p && p.xpWeek;
  return box && box.week === config.weekUtcKey() ? Math.max(0, Number(box.xp) || 0) : 0;
}
const cnt = (p: any, key: string) => Math.max(0, Number(((p && p.counters) || {})[key]) || 0);

// Текущее значение показателя. Всё считается «здесь и сейчас» по живым
// данным: отдельных накопителей на каждое условие нет, поэтому и
// разойтись с реальностью им негде.
function metricValue(user: User, metric: string): number {
  switch (metric) {
    // ── Шкала вербовщика: считаем по приглашённым ──
    case 'friends50':           return friendsOf(user).filter((p) => (p.level || 1) >= 50).length;
    case 'friendsAllies':       return alliesCount(user, friendsOf(user));
    case 'friendsXpWeek':       return friendsOf(user).reduce((s, p) => s + xpThisWeek(p), 0);
    case 'reinforceFriends':    return Math.max(0, Number(boxOf(user).reinforceFriends) || 0);
    case 'friendsMissionSteps': return friendsOf(user).reduce((s, p) => s + cnt(p, 'missionStages'), 0);
    case 'friendsBattleLoot':   return friendsOf(user).reduce((s, p) => s + cnt(p, 'battleLoot'), 0);
    case 'friendsChat':         return friendsOf(user).reduce((s, p) => s + cnt(p, 'chatMessages'), 0);
    // ── Шкала новобранца: считаем по себе ──
    case 'level':               return Math.max(0, Number(user.level) || 0);
    case 'allies':              return alliesCount(user);
    case 'reinforcesSent':      return cnt(user, 'reinforcesSent');
    case 'questsDone':          return cnt(user, 'questsDone');
    case 'tutorialDone':        return (user as any).tutorial && (user as any).tutorial.done ? 1 : 0;
    case 'chatMessages':        return cnt(user, 'chatMessages');
    case 'sanctionsMade':       return cnt(user, 'sanctionsMade');
    default:                    return 0;
  }
}

function tasksOf(board: Board): any[] {
  return (config.REFERRAL_QUESTS as any)[board] || [];
}
function rewardsOf(board: Board): any[] {
  return (config.REFERRAL_QUESTS as any)[board === 'inviter' ? 'inviterRewards' : 'newbieRewards'] || [];
}

// ── Описание награды для интерфейса ───────────────────────────────
// Возвращаем и текст, и иконку: под каждым баллом шкалы рисуется
// маленькая картинка, а подпись читается при нажатии.
function describe(reward: any): { icon: string; text: string } {
  if (!reward) return { icon: '🎁', text: 'Награда' };
  if (reward.gold)     return { icon: '🪙', text: `${u.fmt(reward.gold)} золота` };
  if (reward.dollars)  return { icon: '💵', text: `$${u.fmt(reward.dollars)}` };
  if (reward.containers) {
    const c = config.CONTAINERS.find((x: any) => x.tier === reward.containers.tier);
    return { icon: '📦', text: `${reward.containers.qty} × ${(c && c.name) || 'контейнер'} (${(c && c.gold) || 0} золота)` };
  }
  if (reward.items) {
    const parts = Object.entries(reward.items).map(([id, n]) => {
      const it = config.MARKET_ITEM_BY_ID[id];
      return `${(it && it.name) || id} ×${n}`;
    });
    return { icon: '💉', text: parts.join(', ') };
  }
  if (reward.vipDays)  return { icon: '👑', text: `VIP-подписка на ${reward.vipDays} дн.` };
  if (reward.commanders) {
    const names = (reward.commanders.ids || []).map((id: string) => {
      const m = config.COMMANDERS.find((x: any) => x.id === id);
      return (m && m.name) || id;
    });
    return { icon: '🎖', text: `Наёмники ${names.join(' и ')} на ${reward.commanders.days} дн.` };
  }
  return { icon: '🎁', text: 'Награда' };
}

// ── Выдача награды ────────────────────────────────────────────────
function grantReward(user: User, reward: any, notices: Notices, source: string): void {
  if (!reward) return;
  if (reward.gold)    player.addGold(user, reward.gold, source);
  if (reward.dollars) player.addMoney(user, reward.dollars, false);
  if (reward.containers) {
    require('./market').addContainers(user, reward.containers.tier, reward.containers.qty);
  }
  if (reward.items) {
    for (const [id, n] of Object.entries(reward.items)) require('./market').addItems(user, id, Number(n) || 0);
  }
  if (reward.vipDays) require('./vip').grant(null, user, reward.vipDays, 'Задания приглашений', notices);
  if (reward.commanders) {
    for (const id of (reward.commanders.ids || [])) {
      require('./market').grantCommanderDays(user, id, reward.commanders.days, notices);
    }
  }
  db.markUser(user.id);
}

// ── Шкала целиком ─────────────────────────────────────────────────
function boardView(user: User, board: Board) {
  const b = boxOf(user);
  const claimed: string[] = b.claimed[board] || [];
  const tasks = tasksOf(board).map((t: any) => {
    const have = metricValue(user, t.metric);
    return {
      id: t.id, name: t.name, note: t.note || '',
      need: t.need, have: Math.min(have, t.need), rawHave: have,
      done: have >= t.need,
    };
  });
  const points = tasks.filter((t) => t.done).length;
  const steps = rewardsOf(board).map((r: any, i: number) => {
    const step = i + 1;
    const d = describe(r);
    return {
      step, icon: d.icon, text: d.text,
      reached: points >= step,
      claimed: claimed.indexOf(String(step)) >= 0,
    };
  });
  return { board, points, total: tasks.length, tasks, steps };
}

function view(user: User) {
  const out: any = { inviter: boardView(user, 'inviter'), share: shareView(user) };
  // Шкала новобранца — тем, кто сам пришёл по приглашению
  if ((user as any).referredBy) out.newbie = boardView(user, 'newbie');
  return out;
}

// ── Забрать награду за балл ───────────────────────────────────────
function claim(user: User, board: string, step: number | string, notices: Notices) {
  const bd: Board = board === 'newbie' ? 'newbie' : 'inviter';
  if (bd === 'newbie' && !(user as any).referredBy) {
    throw new u.ApiError('Шкала новобранца доступна тем, кто пришёл по приглашению');
  }
  const s = u.toInt(step, 0);
  const rewards = rewardsOf(bd);
  if (s < 1 || s > rewards.length) throw new u.ApiError('Такой награды нет');
  const b = boxOf(user);
  const claimed: string[] = b.claimed[bd];
  if (claimed.indexOf(String(s)) >= 0) throw new u.ApiError('Эта награда уже получена');
  const v = boardView(user, bd);
  if (v.points < s) {
    throw new u.ApiError(`Нужно ${s} балл(ов), у вас ${v.points}. Выполните ещё одно условие.`);
  }
  claimed.push(String(s));
  grantReward(user, rewards[s - 1], notices, 'referral');
  db.markUser(user.id);
  const d = describe(rewards[s - 1]);
  notices.push(`🎁 Награда за ${s}-й балл: ${d.text}`);
  return boardView(user, bd);
}

// ── Доля с покупок приглашённых ───────────────────────────────────
// Растёт вместе с числом приглашённых: 5 друзей — 12%, 10 — 15%,
// 20 — 20%, 30 — 25%. Считаются приглашённые, дошедшие до 50 уровня:
// в этой выплате настоящие деньги, и пачка брошенных аккаунтов не
// должна её поднимать.
function sharePctFor(user: User): number {
  const base = config.REFERRAL.purchaseSharePct;
  const good = friendsOf(user).filter((p) => (p.level || 1) >= 50).length;
  let pct = base;
  for (const s of config.REFERRAL_QUESTS.SHARE_STEPS) {
    if (good >= s.friends && s.pct > pct) pct = s.pct;
  }
  return pct;
}

function shareView(user: User) {
  const good = friendsOf(user).filter((p) => (p.level || 1) >= 50).length;
  const steps = config.REFERRAL_QUESTS.SHARE_STEPS.map((s: any) => ({
    friends: s.friends, pct: s.pct, reached: good >= s.friends,
  }));
  const next = config.REFERRAL_QUESTS.SHARE_STEPS.find((s: any) => good < s.friends) || null;
  return {
    pct: sharePctFor(user),
    basePct: config.REFERRAL.purchaseSharePct,
    friends50: good,
    steps,
    next: next ? { friends: next.friends, pct: next.pct, left: next.friends - good } : null,
  };
}

// ── Хук: подкрепление отправлено ──────────────────────────────────
// Считаем только подкрепления СВОИМ приглашённым — условие именно о них.
function onReinforce(sender: User, target: User): void {
  if (!sender || !target || (target as any).referredBy !== sender.id) return;
  const b = boxOf(sender);
  b.reinforceFriends = (Number(b.reinforceFriends) || 0) + 1;
  db.markUser(sender.id);
}

export = { view, boardView, claim, sharePctFor, shareView, onReinforce, describe, metricValue };
