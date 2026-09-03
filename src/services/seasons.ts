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

const MSK_OFFSET_MS = u.MSK_OFFSET_MS; // МСК = UTC+3, определение — в core/utils

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
  // ВАЖНО: перед любым индивидуальным сбросом weekly сначала прогоняем
  // ролловер — он наградит топ-3 за завершившуюся неделю по НЕтронутой
  // статистике ВСЕХ игроков и разом обнулит weekly. Иначе первое действие
  // игрока после полуночи обнуляло бы его weekly раньше раздачи наград, и
  // настоящий топ-1 оставался без награды (а её получал тот, кто ещё не
  // успел сходить). rolloverIfNeeded идемпотентен и дёшев, если неделя та же.
  rolloverIfNeeded();
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

// Живые участники рейтинга БЕЗ дублей по id. Object.values не может дать
// дубли сам по себе, но защита дешёвая: любой будущий merge аккаунтов или
// повторная запись под другим ключом иначе посадит одного игрока сразу на
// два места в топе.
function rankedPlayers(): User[] {
  const seen = new Set<string>();
  const out: User[] = [];
  for (const p of Object.values(users())) {
    if (!p || p.isBot || !p.id) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

// Сортировка мест. КРИТИЧНО: при равных значениях нужен стабильный
// тайбрейкер. Без него Array.sort у игроков с одинаковым счётом (а после
// сброса недели у большинства он нулевой) выдаёт ПРОИЗВОЛЬНЫЙ порядок,
// зависящий от порядка ключей в коллекции — он меняется при каждой
// перезагрузке из Mongo. Игроки прыгали по местам между обновлениями
// страницы, и выглядело это так, будто один и тот же человек занимает
// сразу второе и третье место.
function byValueThenId(a: { value?: number; v?: number; id?: string; p?: any }, b: any): number {
  const av = a.value !== undefined ? a.value : a.v;
  const bv = b.value !== undefined ? b.value : b.v;
  if (bv !== av) return (bv || 0) - (av || 0);
  const aid = a.id || (a.p && a.p.id) || '';
  const bid = b.id || (b.p && b.p.id) || '';
  return aid < bid ? -1 : (aid > bid ? 1 : 0);
}

// Снимок метрик ВСЕХ игроков перед обнулением недели.
// Когда сезонные очки пропали из-за конфликта полей, откатывать было
// нечего: значения жили только в самом затираемом поле. Теперь каждую
// неделю перед сбросом они складываются в коллекцию (последние 8 недель)
// и, если включён драйвер sqlite, дополнительно в снапшот базы.
function saveWeeklyMetricsBackup(all: User[], finishingWeek: string): void {
  try {
    const metrics: Record<string, any> = {};
    for (const p of all) if (p.weekly) metrics[p.id] = { name: p.name, ...p.weekly };
    const backupStore: any = db.load('weeklyMetricsBackup', {});
    backupStore[finishingWeek] = metrics;
    const weeks = Object.keys(backupStore).sort();
    while (weeks.length > 8) { const w = weeks.shift(); if (w) delete backupStore[w]; }
    db.save('weeklyMetricsBackup');
    const snap = (db as any).snapshotCollection;
    if (typeof snap === 'function') snap('weeklyMetricsBackup', `сезон-${finishingWeek}`);
    console.log(`🗄  Снимок сезонных метрик за ${finishingWeek}: ${Object.keys(metrics).length} игроков`);
  } catch (e: any) {
    console.error('⚠️  Не удалось снять снимок сезонных метрик:', e.message);
  }
}

// Награждение топ-3 каждой категории + снапшот победителей за завершившуюся неделю
function awardAndSnapshot(s: any, all: User[], finishingWeek: string) {
  const rewards = (s.rewards && s.rewards.length) ? s.rewards : config.SEASON.rewards;
  const winners: Record<string, any[]> = {};
  for (const cat of config.SEASON.categories) {
    const ranked = all
      .map((p) => ({ p, v: metricVal(p, cat.metric, finishingWeek) }))
      .filter((x) => x.v > 0)
      .sort(byValueThenId)
      .slice(0, 3);
    winners[cat.id] = ranked.map((x) => ({ id: x.p.id, name: x.p.name, flag: player.flag(x.p), value: x.v }));
    ranked.forEach((x, i) => {
      const rw = rewards[i] || { gold: 0, tokens: 0 };
      const place = i + 1;
      const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉';
      // Награда приходит письмом от «Система» с кнопкой «Забрать» —
      // начисляется только при получении (в почте или на главном экране).
      require('./rewards').grant(x.p.id, {
        title: `${medal} Итоги недели — ${place} место`,
        reason: `${place} место в категории «${cat.name}» за прошедшую неделю.`,
        reward: { gold: rw.gold || 0, tokens: rw.tokens || 0 },
      });
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
  const finishing = s.weekId;
  // Помечаем текущую неделю СРАЗУ — до раздачи наград. Это защищает от
  // повторного входа: если во время awardAndSnapshot что-то снова вызовет
  // ensureWeek→rolloverIfNeeded, повторной раздачи не будет (s.weekId уже cur).
  s.weekId = cur;
  if (finishing) {
    // Настоящая смена недели: награждаем топ-3 по статистике завершившейся
    // недели (все weekly ещё нетронуты) и обнуляем метрики всех.
    // СНИМОК ПЕРЕД ОБНУЛЕНИЕМ: когда сезонные очки пропали из-за конфликта
    // полей, откатывать было нечего. Теперь перед каждым сбросом метрики
    // всех игроков сохраняются в снапшот (db.snapshotsList покажет их,
    // восстановление — админской ручкой). Работает на драйвере sqlite.
    const all = rankedPlayers();
    saveWeeklyMetricsBackup(all, finishing);
    awardAndSnapshot(s, all, finishing);
    for (const p of all) p.weekly = freshWeekly(cur);
    db.save('users');
  }
  db.save('weeklySeason');
  return true;
}

// ── Просмотр сезона (все 7 категорий сразу) ────────────────────────
function view(user: User) {
  rolloverIfNeeded();
  const s = store();
  const cur = weekId();
  const all = rankedPlayers();
  const categories = config.SEASON.categories.map((cat) => {
    const ranked = all
      .map((p) => ({ id: p.id, name: p.name, flag: player.flag(p), value: metricVal(p, cat.metric, cur) }))
      .sort(byValueThenId);
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
  const all = rankedPlayers();
  const finishing = weekId();
  // ЗАЩИТА: если в текущей неделе призёров нет (у всех метрики по нулям),
  // не затираем уже сохранённые «итоги прошлой недели» пустым снапшотом.
  // Иначе одно нажатие кнопки стирает последнюю уцелевшую сводку.
  const anyPoints = config.SEASON.categories.some((cat) =>
    all.some((p) => metricVal(p, cat.metric, finishing) > 0));
  if (!anyPoints) {
    const kept = s.lastWinners && Object.values(s.lastWinners).some((a: any) => a && a.length);
    for (const p of all) p.weekly = freshWeekly(finishing);
    s.weekId = finishing;
    db.save('weeklySeason');
    db.save('users');
    notices.push(kept
      ? '⚠️ Награждать некого: на этой неделе ни у кого нет очков. Метрики обнулены, прошлые итоги СОХРАНЕНЫ.'
      : '⚠️ Награждать некого: на этой неделе ни у кого нет очков. Метрики обнулены.');
    return { winners: s.lastWinners || {}, skipped: true };
  }
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
