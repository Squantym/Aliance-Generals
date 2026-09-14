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
// Отдаём и текст, и картинку: под каждым баллом шкалы рисуется та же
// иконка, которую игрок видит в игре — золото, контейнер, ампула
// допинга, портрет наёмника. Эмодзи остаётся запасным вариантом для
// того, чему картинки в игре нет (VIP).
const ICON = {
  gold: '/img/icons/gold.webp',
  dollar: '/img/icons/dollar.webp',
  units: '/img/tabs/tech_ground.webp',
};

function describe(reward: any): { icon: string; img: string; text: string } {
  const none = { icon: '🎁', img: '', text: 'Награда' };
  if (!reward) return none;
  // Награда бывает составной («150 золота и $15 млрд») — тогда
  // перечисляем всё, а картинку берём от первой части
  if (reward.gold && reward.dollars) {
    return { icon: '🪙', img: ICON.gold, text: `${u.fmt(reward.gold)} золота и $${u.fmt(reward.dollars)}` };
  }
  if (reward.gold)    return { icon: '🪙', img: ICON.gold, text: `${u.fmt(reward.gold)} золота` };
  if (reward.dollars) return { icon: '💵', img: ICON.dollar, text: `$${u.fmt(reward.dollars)}` };
  if (reward.containers) {
    const c = config.CONTAINERS.find((x: any) => x.tier === reward.containers.tier);
    return {
      icon: '📦', img: c ? `/img/containers/${c.id}.webp` : '',
      text: `${reward.containers.qty} × ${(c && c.name) || 'контейнер'} (${(c && c.gold) || 0} золота)`,
    };
  }
  if (reward.items) {
    const ids = Object.keys(reward.items);
    const parts = ids.map((id) => {
      const it = config.MARKET_ITEM_BY_ID[id];
      return `${(it && it.name) || id} ×${reward.items[id]}`;
    });
    return { icon: '💉', img: ids.length ? `/img/market/${ids[0]}.webp` : '', text: parts.join(', ') };
  }
  if (reward.vipDays)  return { icon: '👑', img: '', text: `VIP-подписка на ${reward.vipDays} дн.` };
  if (reward.topUnits) return { icon: '🚙', img: ICON.units, text: `${reward.topUnits} единиц новейшей техники` };
  if (reward.saboteurs) {
    const RU: Record<string, string> = { ground: 'наземных', sea: 'морских', air: 'воздушных',
      building: 'построечных', secret: 'секретных', suicide: 'смертников' };
    const kinds = (reward.saboteurs.kinds || []);
    return {
      icon: '🥷', img: kinds.length ? `/img/saboteurs/${kinds[0]}.webp` : '',
      text: `по ${reward.saboteurs.each} диверсантов: ${kinds.map((k: string) => RU[k] || k).join(', ')}`,
    };
  }
  if (reward.halfOfPurchase) return { icon: '🪙', img: ICON.gold, text: 'половина стоимости покупки' };
  if (reward.commanders) {
    const ids = reward.commanders.ids || [];
    const names = ids.map((id: string) => {
      const m = config.COMMANDERS.find((x: any) => x.id === id);
      return (m && m.name) || id;
    });
    return {
      icon: '🎖', img: ids.length ? `/img/mercenaries/${ids[0]}.webp` : '',
      text: `Наёмники ${names.join(' и ')} на ${reward.commanders.days} дн.`,
    };
  }
  return none;
}

// ── Выдача награды ────────────────────────────────────────────────
function grantReward(user: User, reward: any, notices: Notices, source: string): void {
  if (!reward) return;
  if (reward.topUnits) {
    const units = require('./units');
    const top = units.topUnitFor(user);
    if (top) units.grantUnits(user, top.id, reward.topUnits);
  }
  if (reward.saboteurs) {
    const sab = require('./saboteurs');
    sab.ensure(user);
    for (const kind of (reward.saboteurs.kinds || [])) {
      (user as any).saboteurs[kind] = ((user as any).saboteurs[kind] || 0) + (reward.saboteurs.each || 0);
    }
  }
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
      step, icon: d.icon, img: d.img, text: d.text,
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
  out.pair = pairBoard(user);
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
// 20 — 20%, 30 — 25%. Считаются приглашённые, дошедшие до уровня
// SHARE_MIN_LEVEL (70): в этой выплате настоящие деньги, и пачка
// брошенных аккаунтов не должна её поднимать. Порог намеренно выше,
// чем у шкалы заданий, — там 50.
function shareMinLevel(): number {
  return Math.max(1, Number(config.REFERRAL_QUESTS.SHARE_MIN_LEVEL) || 70);
}
function goodFriends(user: User): number {
  const need = shareMinLevel();
  return friendsOf(user).filter((p) => (p.level || 1) >= need).length;
}

function sharePctFor(user: User): number {
  const base = config.REFERRAL.purchaseSharePct;
  const good = goodFriends(user);
  let pct = base;
  for (const s of config.REFERRAL_QUESTS.SHARE_STEPS) {
    if (good >= s.friends && s.pct > pct) pct = s.pct;
  }
  return pct;
}

function shareView(user: User) {
  const good = goodFriends(user);
  const steps = config.REFERRAL_QUESTS.SHARE_STEPS.map((s: any) => ({
    friends: s.friends, pct: s.pct, reached: good >= s.friends,
  }));
  const next = config.REFERRAL_QUESTS.SHARE_STEPS.find((s: any) => good < s.friends) || null;
  return {
    pct: sharePctFor(user),
    basePct: config.REFERRAL.purchaseSharePct,
    minLevel: shareMinLevel(),
    friendsReady: good,
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

// ═══ ПАРНЫЕ ЗАДАНИЯ ═══════════════════════════════════════════════
// Доска у игрока ОДНА, а напарников может быть много: пригласил пятерых —
// в напарники идёт любой из них. По каждому заданию берётся тот, кто
// продвинулся дальше всех; у приглашённого напарник один — тот, кто его
// привёл.
//
// Награда приходит обоим — игроку и тому напарнику, чьим прогрессом
// задание закрыто. Каждому задание засчитывается ОДИН раз (ежедневным —
// раз в московские сутки), поэтому пятеро друзей не превращают одно
// задание в пять наград.
//
// Проверка идёт в момент, когда игрок открывает раздел: гонять всех
// в игровом тике — работа на ровном месте, а награда всё равно ждёт
// человека в игре.
//
// Хранение: user.refQuests.pair = { day, daily: {id:at}, once: {id:at} }
function pairBox(user: any): any {
  const b = boxOf(user);
  if (!b.pair || typeof b.pair !== 'object') b.pair = { day: '', daily: {}, once: {} };
  const st = b.pair;
  const today = u.dayKey();
  if (st.day !== today) { st.day = today; st.daily = {}; }
  if (!st.daily) st.daily = {};
  if (!st.once) st.once = {};
  return st;
}

const daily = (p: any, key: string) => require('./dailyQuests').mskCount(p, key);
const dayBox = (p: any) => require('./dailyQuests').mskBox(p);

// Отправил ли A подкрепление B сегодня (по московскому дню)
function sentReinforceToday(from: any, toId: string): boolean {
  const since = u.dayStart();   // начало московских суток
  const list = (from && from.reinforceSent) || [];
  return list.some((x: any) => x && x.toId === toId && x.at >= since);
}

// Значение ежедневного показателя для ОДНОГО игрока пары
function pairDailyValue(p: any, other: any, metric: string): number {
  switch (metric) {
    // Совместные показатели без напарника не считаются: «отправить друг
    // другу подкрепления» в одиночку не выполняется
    case 'pairReinforce':    return other && sentReinforceToday(p, other.id) ? 1 : 0;
    case 'pairGroupBattles': return other ? Math.max(0, Number((dayBox(p).groupWith || {})[other.id]) || 0) : 0;
    case 'marketBuy':        return dayBox(p).bestBuyGold > 0 ? 1 : 0;
    case 'breachIn':         return daily(p, 'breaches');
    default:                 return daily(p, metric);
  }
}

// Значение разового показателя — за всё время
function pairOnceValue(p: any, metric: string): number {
  switch (metric) {
    case 'level':      return Math.max(0, Number(p.level) || 0);
    case 'inLegion':   return p.legionId ? 1 : 0;
    case 'allies':     return alliesCount(p);
    case 'breachIn':   return cnt(p, 'breaches');
    case 'goldSpent':  return Object.values(((p.stats || {}).goldSpent) || {})
                               .reduce((s: number, v: any) => s + (Number(v) || 0), 0);
    default:           return cnt(p, metric);
  }
}

// Награда, которая зависит от самого игрока (половина его покупки)
function resolveReward(reward: any, p: any): any {
  if (!reward || !reward.halfOfPurchase) return reward;
  const spent = Math.max(0, Number(dayBox(p).bestBuyGold) || 0);
  return { gold: Math.max(1, Math.floor(spent / 2)) };
}

// Награду получают оба: игрок и тот напарник, чьим прогрессом задание
// закрыто. Напарнику задание тоже отмечается — иначе он получил бы за
// него награду второй раз, открыв свой раздел.
function grantPairReward(a: any, b: any, reward: any, taskName: string,
                         kind: 'daily' | 'once', taskId: string): void {
  for (const p of [a, b]) {
    const box = pairBox(p);
    const slot = kind === 'daily' ? box.daily : box.once;
    if (slot[taskId]) continue;          // уже получал
    slot[taskId] = Date.now();
    const notes: any[] = [];
    grantReward(p, resolveReward(reward, p), notes, 'referral');
    db.markUser(p.id);
    try {
      const d = describe(resolveReward(reward, p));
      require('./notifications').push(p.id, 'ref_pair',
        `🤝 Парное задание «${taskName}» выполнено: ${d.text}`, {});
    } catch (e) {}
  }
}

// Доска парных заданий игрока целиком. Здесь же выдаются награды за
// только что закрытые задания — отдельной кнопки у парных заданий нет.
function pairBoard(user: User) {
  const st = pairBox(user);
  const mates = partnersOf(user);
  const build = (list: any[], kind: 'daily' | 'once') => list.map((t: any) => {
    const mine = kind === 'daily' ? pairDailyValue(user, null, t.metric) : pairOnceValue(user, t.metric);
    // Совместные задания (обмен подкреплениями, бои вместе) считаются
    // по конкретному напарнику, поэтому лучшего ищем по ПАРЕ, а не по
    // одному лишь его собственному счётчику
    let best: any = null, bestVal = -1, bestMine = mine;
    for (const m of mates) {
      const theirs = kind === 'daily' ? pairDailyValue(m, user, t.metric) : pairOnceValue(m, t.metric);
      const mineWith = kind === 'daily' ? pairDailyValue(user, m, t.metric) : mine;
      const pairMin = Math.min(mineWith, theirs);
      const score = pairMin >= t.need ? Infinity : theirs;
      if (score > bestVal) { bestVal = score; best = m; bestMine = mineWith; }
    }
    const theirs = best
      ? (kind === 'daily' ? pairDailyValue(best, user, t.metric) : pairOnceValue(best, t.metric))
      : 0;
    const box = kind === 'daily' ? st.daily : st.once;
    let done = !!box[t.id];
    if (!done && best && bestMine >= t.need && theirs >= t.need) {
      grantPairReward(user, best, t.reward, t.name, kind, t.id);
      box[t.id] = Date.now();
      done = true;
      db.markUser(user.id);
    }
    const d = describe(resolveReward(t.reward, user));
    return {
      id: t.id, name: t.name, note: t.note || '', need: t.need,
      mine: Math.min(bestMine, t.need), theirs: Math.min(theirs, t.need),
      mateName: best ? best.name : '',
      done, icon: d.icon, img: d.img || '', reward: d.text,
    };
  });
  return {
    mates: mates.map((m: any) => ({ id: m.id, name: m.name, level: m.level || 1 })),
    daily: build(config.REFERRAL_QUESTS.pairDaily || [], 'daily'),
    once:  build(config.REFERRAL_QUESTS.pairOnce  || [], 'once'),
  };
}

// С кем у игрока есть пары: у приглашающего — со всеми приглашёнными,
// у приглашённого — с тем, кто его привёл.
function partnersOf(user: User): User[] {
  const all = player.users() as Record<string, User>;
  const out = friendsOf(user);
  const boss = (user as any).referredBy ? all[(user as any).referredBy] : null;
  if (boss) out.unshift(boss);
  return out;
}
// ── Хук: групповой бой закончился ─────────────────────────────────
// Отмечаем у каждого участника, с кем он сегодня сражался. Считаем
// только пары «пригласивший — приглашённый»: остальным это поле ни к
// чему, а объект игрока раздувать незачем.
function onGroupBattle(ids: string[]): void {
  const all = player.users() as Record<string, User>;
  const people = (ids || []).map((id) => all[id]).filter(Boolean) as any[];
  for (const a of people) {
    for (const b of people) {
      if (a.id === b.id) continue;
      if (a.referredBy !== b.id && b.referredBy !== a.id) continue;
      const box = dayBox(a);
      box.groupWith[b.id] = (Number(box.groupWith[b.id]) || 0) + 1;
      db.markUser(a.id);
    }
  }
}

export = { view, boardView, claim, sharePctFor, shareView, onReinforce, describe, metricValue,
  pairBoard, partnersOf, onGroupBattle };
