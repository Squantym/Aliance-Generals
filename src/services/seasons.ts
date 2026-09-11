// ===================================================================
// src/services/seasons.ts — рейтинговый сезон (15 дней).
// 7 категорий (общий рейтинг + 6 отдельных метрик), у каждой свой топ-20.
// Сезон длится config.SEASON.days суток от «московской полночи».
// По окончании сезона топ-3 каждой категории получают награду,
// победители сохраняются в снапшот (показываются вверху раздела),
// метрики всех игроков обнуляются, начинается новый сезон.
//
// В зачёте не участвуют:
//   • администрация — владелец, администраторы, комиссары. Модераторы
//     («Дозор») остаются: это игроки с правом на чат, а не штаб;
//   • игроки с блокировкой на месяц и больше (и бессрочной) — их метрики
//     обнуляются автоматически, пока блокировка действует.
//
// Имена weekId/weekEndsAt и поле user.weekly остались от недельного
// сезона: они в базе и в API, переименование сломало бы живые данные.
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import player = require('./player');
import u = require('../core/utils');
import type { User, Notices } from '../types';

const MSK_OFFSET_MS = u.MSK_OFFSET_MS; // МСК = UTC+3, определение — в core/utils
const DAY_MS = 86400000;
const SEASON_DAYS = config.SEASON.days;
const SEASON_MS = SEASON_DAYS * DAY_MS;
// «Месяц» считаем как 30 суток. Допуск в минуту: срок бана и момент бана
// берутся двумя вызовами Date.now(), и ровно месячный бан не должен
// проскочить мимо из-за миллисекунды.
const LONG_BAN_MS = 30 * DAY_MS - 60 * 1000;
// Версия наград сезона в хранилище. Награды живут в базе (их правят из
// панели) и перекрывают конфиг — без миграции смена планок в конфиге не
// дошла бы до сервера, где награды хоть раз сохранялись.
const REWARDS_VERSION = 2;
const METRICS = ['rating', 'wins', 'ears', 'mercy', 'loot', 'alliance', 'missions'];

function users(): Record<string, User> { return player.users(); }

// «Московская» дата: сдвигаем метку так, чтобы UTC-поля = стенным часам МСК
function mskDate(ts?: number): Date { return new Date((ts ?? Date.now()) + MSK_OFFSET_MS); }

function isoDay(mskTs: number): string {
  const d = new Date(mskTs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Точка отсчёта сезонов — «московская полночь» (UTC-поля = часам МСК).
// Хранится в базе, а не в конфиге. При переходе с недельного сезона
// берётся начало ИДУЩЕЙ недели: тогда её id совпадает с id нового
// сезона, ролловер не срабатывает, и набранные очки остаются — сезон
// просто заканчивается позже. Жёсткая дата в конфиге этого не гарантирует:
// выкати её после понедельника — и игроков обнулило бы второй раз.
function anchorMsk(): number {
  const s = store();
  if (typeof s.anchor === 'number' && s.anchor > 0) return s.anchor;
  const prev = String(s.weekId || '');
  let a = /^\d{4}-\d{2}-\d{2}$/.test(prev) ? Date.parse(prev + 'T00:00:00Z') : NaN;
  if (!(a > 0)) {
    const d = mskDate();
    const dow = (d.getUTCDay() + 6) % 7; // 0=Пн … 6=Вс
    a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
  }
  s.anchor = a;
  db.save('weeklySeason');
  return a;
}

// Начало сезона, в котором лежит момент ts («московская» метка)
function seasonStartMsk(ts?: number): number {
  const a = anchorMsk();
  const k = Math.floor(((ts ?? Date.now()) + MSK_OFFSET_MS - a) / SEASON_MS);
  return a + k * SEASON_MS;
}

// ID сезона = дата его первого дня (МСК) в формате YYYY-MM-DD
function weekId(ts?: number): string { return isoDay(seasonStartMsk(ts)); }

// Реальный UTC-таймстамп конца сезона (полночь МСК после последнего дня)
function weekEndsAt(ts?: number): number { return seasonStartMsk(ts) + SEASON_MS - MSK_OFFSET_MS; }

function freshWeekly(wid: string) {
  return { weekId: wid, rating: 0, wins: 0, ears: 0, mercy: 0, loot: 0, alliance: 0, missions: 0 };
}

function hasPoints(w: any): boolean {
  return !!w && METRICS.some((k) => (Number(w[k]) || 0) !== 0);
}

// Почему игрок не участвует в сезоне: 'staff', 'ban' или null
function exclusionOf(p: any): 'staff' | 'ban' | null {
  if (!p) return null;
  let role: string | null = null;
  try { role = require('./roles').roleOf(p); } catch (e) { role = null; }
  if (role && role !== 'moderator') return 'staff';
  if (p.banned) {
    const until = Number(p.banUntil) || 0;
    if (until === 0) return 'ban';                              // бессрочно
    if (until > Date.now() && until - (Number(p.bannedAt) || 0) >= LONG_BAN_MS) return 'ban';
  }
  return null;
}

// Гарантирует актуальный weekly у игрока (сброс, если сезон сменился)
function ensureWeek(user: User) {
  // ВАЖНО: перед любым индивидуальным сбросом weekly сначала прогоняем
  // ролловер — он наградит топ-3 за завершившийся сезон по НЕтронутой
  // статистике ВСЕХ игроков и разом обнулит weekly. Иначе первое действие
  // игрока после полуночи обнуляло бы его weekly раньше раздачи наград, и
  // настоящий топ-1 оставался без награды (а её получал тот, кто ещё не
  // успел сходить). rolloverIfNeeded идемпотентен и дёшев, если сезон тот же.
  rolloverIfNeeded();
  const wid = weekId();
  if (exclusionOf(user)) {
    // Вне зачёта: поле держим обнулённым, а начисление уходит в
    // одноразовый объект. Возвращать null нельзя — хуки пишут в ответ.
    if (!user.weekly || user.weekly.weekId !== wid || hasPoints(user.weekly)) user.weekly = freshWeekly(wid);
    return freshWeekly(wid);
  }
  if (!user.weekly || user.weekly.weekId !== wid) user.weekly = freshWeekly(wid);
  return user.weekly;
}

// ── Хуки начисления (вызываются из боёв/миссий/групп) ──────────────
const P = () => config.SEASON.points;
function onAttack(user: User)        { ensureWeek(user).rating += P().attack; }
function onWin(user: User)           { const w = ensureWeek(user); w.wins++;  w.rating += P().win; }
function onBreachCrest(user: User)   { const w = ensureWeek(user); w.ears++;  w.rating += P().breachCrest; }
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
  const s: any = db.load('weeklySeason', {
    weekId: '', lastWeekId: '', lastWinners: null, rewards: config.SEASON.rewards,
  });
  if ((s.rewardsV || 0) < REWARDS_VERSION) {
    // Новые планки золота — 500 / 300 / 100. Жетоны оставляем те, что
    // стояли: о них решения не было.
    const old = (s.rewards && s.rewards.length) ? s.rewards : config.SEASON.rewards;
    s.rewards = config.SEASON.rewards.map((r: any, i: number) => ({
      gold: r.gold,
      tokens: (old[i] && Number.isFinite(Number(old[i].tokens))) ? Number(old[i].tokens) : r.tokens,
    }));
    s.rewardsV = REWARDS_VERSION;
    db.save('weeklySeason');
  }
  return s;
}

function metricVal(p: User, metric: string, forWeek: string): number {
  return (p.weekly && p.weekly.weekId === forWeek) ? (Number((p.weekly as any)[metric]) || 0) : 0;
}

// Живые участники рейтинга БЕЗ дублей по id. Object.values не может дать
// дубли сам по себе, но защита дешёвая: любой будущий merge аккаунтов или
// повторная запись под другим ключом иначе посадит одного игрока сразу на
// два места в топе.
// Администрация и долгие баны сюда не попадают — значит, их нет ни в
// топах, ни среди награждённых.
function rankedPlayers(): User[] {
  const seen = new Set<string>();
  const out: User[] = [];
  for (const p of Object.values(users())) {
    if (!p || p.isBot || !p.id) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (exclusionOf(p)) continue;
    out.push(p);
  }
  return out;
}

// Обнуляет метрики тех, кто вне зачёта, и вычищает их из итогов прошлого
// сезона. Отфильтровать при показе мало: очки лежали бы в базе и
// всплыли бы после разбана или снятия роли — а обнулить просили.
function purgeExcluded(): number {
  const s = store();
  const cur = weekId();
  const out = new Set<string>();
  let zeroed = 0;
  for (const p of Object.values(users())) {
    if (!p || p.isBot || !p.id || !exclusionOf(p)) continue;
    out.add(p.id);
    if (hasPoints(p.weekly)) {
      p.weekly = freshWeekly(cur);
      db.markUser(p.id);
      zeroed++;
    }
  }
  if (zeroed) db.save('users');
  if (out.size && s.lastWinners) {
    let changed = false;
    for (const cat of Object.keys(s.lastWinners)) {
      const list = s.lastWinners[cat];
      if (!Array.isArray(list)) continue;
      const kept = list.filter((w: any) => !(w && out.has(w.id)));
      if (kept.length !== list.length) { s.lastWinners[cat] = kept; changed = true; }
    }
    if (changed) db.save('weeklySeason');
  }
  return zeroed;
}

// Сортировка мест. КРИТИЧНО: при равных значениях нужен стабильный
// тайбрейкер. Без него Array.sort у игроков с одинаковым счётом (а после
// сброса сезона у большинства он нулевой) выдаёт ПРОИЗВОЛЬНЫЙ порядок,
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

// Снимок метрик ВСЕХ игроков перед обнулением сезона.
// Когда сезонные очки пропали из-за конфликта полей, откатывать было
// нечего: значения жили только в самом затираемом поле. Теперь каждый
// сезон перед сбросом они складываются в коллекцию (последние 8 сезонов)
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

// Награждение топ-3 каждой категории + снапшот победителей за завершившийся сезон
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
        title: `${medal} Итоги сезона — ${place} место`,
        reason: `${place} место в категории «${cat.name}» за прошедший сезон.`,
        reward: { gold: rw.gold || 0, tokens: rw.tokens || 0 },
      });
    });
  }
  s.lastWinners = winners;
  s.lastWeekId = finishingWeek;
  // Длительность завершённого зачёта — для подписи дат в итогах.
  // Последний зачёт до перехода был недельным, и подпись «15 дней» на нём соврала бы.
  s.lastDays = SEASON_DAYS;
}

// Ролловер: если сезон сменился — наградить, снапшотнуть, обнулить
function rolloverIfNeeded(): boolean {
  const s = store();
  const cur = weekId();
  if (s.weekId === cur) return false;
  const finishing = s.weekId;
  // Помечаем текущий сезон СРАЗУ — до раздачи наград. Это защищает от
  // повторного входа: если во время awardAndSnapshot что-то снова вызовет
  // ensureWeek→rolloverIfNeeded, повторной раздачи не будет (s.weekId уже cur).
  s.weekId = cur;
  if (finishing) {
    // Настоящая смена сезона: награждаем топ-3 по статистике завершившегося
    // сезона (все weekly ещё нетронуты) и обнуляем метрики всех.
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
  purgeExcluded();
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
      winners: (s.lastWinners && s.lastWinners[cat.id]) || null, // топ-3 прошлого сезона
    };
  });
  return {
    weekId: cur,
    endsAt: weekEndsAt(),
    seasonDays: SEASON_DAYS,
    // Игрок видит, почему его нет в таблице, а не гадает
    excluded: exclusionOf(user),
    lastWeekId: s.lastWeekId || null,
    lastSeasonDays: s.lastDays || 7,
    points: config.SEASON.points,
    rewards: (s.rewards && s.rewards.length) ? s.rewards : config.SEASON.rewards,
    categories,
  };
}

// ── АДМИН: настройка наград топ-3 (применяется ко всем категориям) ──
function adminSetRewards(adminUser: User, body: any) {
  const s = store();
  const d = config.SEASON.rewards;
  const row = (g: any, t: any, dg: number, dt: number) => ({
    gold: Math.max(0, u.toInt(g, dg)), tokens: Math.max(0, u.toInt(t, dt)),
  });
  s.rewards = [
    row(body.gold1, body.tokens1, d[0].gold, d[0].tokens),
    row(body.gold2, body.tokens2, d[1].gold, d[1].tokens),
    row(body.gold3, body.tokens3, d[2].gold, d[2].tokens),
  ];
  db.save('weeklySeason');
  return { rewards: s.rewards, endsAt: weekEndsAt(), weekId: weekId() };
}

// ── АДМИН: принудительно завершить текущий сезон сейчас ─────────────
function adminForceRollover(adminUser: User, notices: Notices) {
  purgeExcluded();
  const s = store();
  const all = rankedPlayers();
  const finishing = weekId();
  // ЗАЩИТА: если в текущем сезоне призёров нет (у всех метрики по нулям),
  // не затираем уже сохранённые «итоги прошлого сезона» пустым снапшотом.
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
      ? '⚠️ Награждать некого: в этом сезоне ни у кого нет очков. Метрики обнулены, прошлые итоги СОХРАНЕНЫ.'
      : '⚠️ Награждать некого: в этом сезоне ни у кого нет очков. Метрики обнулены.');
    return { winners: s.lastWinners || {}, skipped: true };
  }
  awardAndSnapshot(s, all, finishing);
  const cur = weekId(); // не изменится, но метрики сбрасываем «на новый сезон»
  for (const p of all) p.weekly = freshWeekly(cur);
  s.weekId = cur;
  db.save('weeklySeason');
  db.save('users');
  const total = config.SEASON.categories.reduce((n, c) => n + ((s.lastWinners[c.id] || []).length), 0);
  notices.push(`🏁 Сезон принудительно завершён. Награждено призёров: ${total}.`);
  return { winners: s.lastWinners };
}

export = {
  weekId, weekEndsAt, view, rolloverIfNeeded,
  seasonId: weekId, seasonEndsAt: weekEndsAt, SEASON_DAYS,
  exclusionOf, purgeExcluded,
  onAttack, onWin, onBreachCrest, onMercy, onLoot,
  onMissionStep, onMissionComplete, onAllianceRecruit,
  adminSetRewards, adminForceRollover,
};
