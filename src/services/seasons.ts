// ===================================================================
// src/services/seasons.ts — еженедельный рейтинговый сезон.
// 7 категорий (общий рейтинг + 6 отдельных метрик), у каждой свой топ-20.
// Неделя: понедельник 00:00 — воскресенье 23:59 по МСК (UTC+3).
// По окончании недели топ-3 каждой категории получают награду,
// победители сохраняются в снапшот (показываются вверху раздела),
// метрики всех игроков обнуляются, начинается новая неделя.
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import player = require('./player');
import u = require('../core/utils');
import type { User, Notices } from '../types';

const MSK_OFFSET_MS = 3 * 3600 * 1000; // МСК = UTC+3

function users(): Record<string, User> { return player.users(); }

// «Московская» дата: сдвигаем метку так, чтобы UTC-поля = стенным часам МСК
function mskDate(ts?: number): Date { return new Date((ts ?? Date.now()) + MSK_OFFSET_MS); }

// ID недели = дата понедельника (МСК) в формате YYYY-MM-DD (уникален на неделю)
function weekId(ts?: number): string {
  const d = mskDate(ts);
  const dow = (d.getUTCDay() + 6) % 7; // 0=Пн … 6=Вс
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Реальный UTC-таймстамп конца недели (следующий понедельник 00:00 МСК)
function weekEndsAt(ts?: number): number {
  const d = mskDate(ts);
  const dow = (d.getUTCDay() + 6) % 7;
  const nextMondayMskMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow + 7);
  return nextMondayMskMidnight - MSK_OFFSET_MS; // из «московской полночи» в реальный UTC
}

function freshWeekly(wid: string) {
  return { weekId: wid, rating: 0, wins: 0, ears: 0, mercy: 0, loot: 0, alliance: 0, missions: 0 };
}

// Гарантирует актуальный weekly у игрока (сброс, если неделя сменилась)
function ensureWeek(user: User) {
  const wid = weekId();
  if (!user.weekly || user.weekly.weekId !== wid) user.weekly = freshWeekly(wid);
  return user.weekly;
}

// ── Хуки начисления (вызываются из боёв/миссий/групп) ──────────────
const P = () => config.SEASON.points;
function onAttack(user: User)        { ensureWeek(user).rating += P().attack; }
function onWin(user: User)           { const w = ensureWeek(user); w.wins++;  w.rating += P().win; }
function onFatalityEar(user: User)   { const w = ensureWeek(user); w.ears++;  w.rating += P().fatalityEar; }
function onMercy(user: User)         { const w = ensureWeek(user); w.mercy++; w.rating += P().mercy; }
function onLoot(user: User, amount: number) {
  if (!(amount > 0)) return;
  const w = ensureWeek(user); w.loot += Math.round(amount); w.rating += P().loot;
}
function onMissionStep(user: User)     { const w = ensureWeek(user); w.missions++; w.rating += P().missionStep; }
function onMissionComplete(user: User) { ensureWeek(user).rating += P().missionComplete; }
function onAllianceRecruit(user: User) { const w = ensureWeek(user); w.alliance++; w.rating += P().allianceRecruit; }

// ── Хранилище сезона ───────────────────────────────────────────────
function store(): any {
  return db.load('weeklySeason', {
    weekId: '', lastWeekId: '', lastWinners: null, rewards: config.SEASON.rewards,
  });
}

function metricVal(p: User, metric: string, forWeek: string): number {
  return (p.weekly && p.weekly.weekId === forWeek) ? (Number((p.weekly as any)[metric]) || 0) : 0;
}

// Награждение топ-3 каждой категории + снапшот победителей за завершившуюся неделю
function awardAndSnapshot(s: any, all: User[], finishingWeek: string) {
  const rewards = (s.rewards && s.rewards.length) ? s.rewards : config.SEASON.rewards;
  const winners: Record<string, any[]> = {};
  for (const cat of config.SEASON.categories) {
    const ranked = all
      .map((p) => ({ p, v: metricVal(p, cat.metric, finishingWeek) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3);
    winners[cat.id] = ranked.map((x) => ({ id: x.p.id, name: x.p.name, flag: player.flag(x.p), value: x.v }));
    ranked.forEach((x, i) => {
      const rw = rewards[i] || { gold: 0, tokens: 0 };
      player.addGold(x.p, rw.gold || 0);
      x.p.tokens = (x.p.tokens || 0) + (rw.tokens || 0);
      try {
        require('./notifications').push(x.p.id, 'season_reward',
          `🏆 Итоги недели! ${i + 1} место в категории «${cat.name}». Награда: 🪙 ${rw.gold}, 🎖 ${rw.tokens}`, {});
      } catch (e) {}
    });
  }
  s.lastWinners = winners;
  s.lastWeekId = finishingWeek;
}

// Ролловер: если неделя сменилась — наградить, снапшотнуть, обнулить
function rolloverIfNeeded(): boolean {
  const s = store();
  const cur = weekId();
  if (s.weekId === cur) return false;
  if (s.weekId) {
    // Настоящая смена недели: награждаем топ-3 и обнуляем метрики всех.
    // (Первая инициализация, когда s.weekId пустой, метрики не трогает —
    //  устаревшие weekly сбрасываются лениво через ensureWeek.)
    const all = Object.values(users()).filter((p) => !p.isBot);
    awardAndSnapshot(s, all, s.weekId);
    for (const p of all) p.weekly = freshWeekly(cur);
    db.save('users');
  }
  s.weekId = cur;
  db.save('weeklySeason');
  return true;
}

// ── Просмотр сезона (все 7 категорий сразу) ────────────────────────
function view(user: User) {
  rolloverIfNeeded();
  const s = store();
  const cur = weekId();
  const all = Object.values(users()).filter((p) => !p.isBot);
  const categories = config.SEASON.categories.map((cat) => {
    const ranked = all
      .map((p) => ({ id: p.id, name: p.name, flag: player.flag(p), value: metricVal(p, cat.metric, cur) }))
      .sort((a, b) => b.value - a.value);
    const myRankIdx = ranked.findIndex((x) => x.id === user.id);
    return {
      id: cat.id, name: cat.name, icon: cat.icon, unit: cat.unit, money: !!cat.money,
      top: ranked.slice(0, 20),
      myValue: metricVal(user, cat.metric, cur),
      myRank: myRankIdx >= 0 ? myRankIdx + 1 : null,
      winners: (s.lastWinners && s.lastWinners[cat.id]) || null, // топ-3 прошлой недели
    };
  });
  return {
    weekId: cur,
    endsAt: weekEndsAt(),
    lastWeekId: s.lastWeekId || null,
    points: config.SEASON.points,
    rewards: (s.rewards && s.rewards.length) ? s.rewards : config.SEASON.rewards,
    categories,
  };
}

// ── АДМИН: настройка наград топ-3 (применяется ко всем категориям) ──
function adminSetRewards(adminUser: User, body: any) {
  const s = store();
  const row = (g: any, t: any, dg: number, dt: number) => ({
    gold: Math.max(0, u.toInt(g, dg)), tokens: Math.max(0, u.toInt(t, dt)),
  });
  s.rewards = [
    row(body.gold1, body.tokens1, 500, 3),
    row(body.gold2, body.tokens2, 300, 2),
    row(body.gold3, body.tokens3, 150, 1),
  ];
  db.save('weeklySeason');
  return { rewards: s.rewards, endsAt: weekEndsAt(), weekId: weekId() };
}

// ── АДМИН: принудительно завершить текущую неделю сейчас ────────────
function adminForceRollover(adminUser: User, notices: Notices) {
  const s = store();
  const all = Object.values(users()).filter((p) => !p.isBot);
  const finishing = weekId();
  awardAndSnapshot(s, all, finishing);
  const cur = weekId(); // не изменится, но метрики сбрасываем «на новую неделю»
  for (const p of all) p.weekly = freshWeekly(cur);
  s.weekId = cur;
  db.save('weeklySeason');
  db.save('users');
  const total = config.SEASON.categories.reduce((n, c) => n + ((s.lastWinners[c.id] || []).length), 0);
  notices.push(`🏁 Неделя принудительно завершена. Награждено призёров: ${total}.`);
  return { winners: s.lastWinners };
}

export = {
  weekId, weekEndsAt, view, rolloverIfNeeded,
  onAttack, onWin, onFatalityEar, onMercy, onLoot,
  onMissionStep, onMissionComplete, onAllianceRecruit,
  adminSetRewards, adminForceRollover,
};
