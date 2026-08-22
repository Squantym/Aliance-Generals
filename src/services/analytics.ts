// ═══════════════════════════════════════════════════════════════════
// src/services/analytics.ts — аналитика проекта
//
// ЗАЧЕМ: до этого владелец видел только «онлайн / всего / новых сегодня».
// По этим трём числам нельзя ответить ни на один вопрос, от которого
// зависят решения: доживают ли новички до второго дня, на каком уровне
// люди уходят, не разгоняется ли инфляция. Баланс правился вслепую.
//
// ЧТО СЧИТАЕМ:
//   • УДЕРЖАНИЕ — доля вернувшихся на 1/3/7/30-й день после регистрации.
//     Главная метрика игры: если новички не возвращаются на второй день,
//     всё остальное не имеет значения.
//   • ВОРОНКА НОВИЧКА — сколько дошло до первого боя, 5-го и 10-го
//     уровня. Показывает, ГДЕ именно теряются люди.
//   • АКТИВНОСТЬ — DAU/WAU/MAU и «липкость» (DAU/MAU): как часто
//     возвращаются те, кто уже играет.
//   • УРОВНИ — распределение живых игроков. Провал в гистограмме
//     означает стену в прогрессии.
//   • ЭКОНОМИКА — сколько денег и золота на руках, у скольких игроков
//     сосредоточено богатство. Разгон означает инфляцию.
//
// КАК СЧИТАЕМ: по объектам игроков, без отдельного хранилища событий.
// Даты регистрации и последнего входа уже есть у каждого — этого
// достаточно для удержания и активности. Плюс ежедневный СРЕЗ (см.
// snapshotDaily) — он копит историю, чтобы видеть динамику, а не только
// сегодняшний день.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import player = require('./player');

const DAY = 24 * 3600 * 1000;

// Начало суток по МСК: сутки игры считаем от 00:00 московского времени,
// иначе «новые за сегодня» скакали бы посреди вечера.
function dayStart(ts: number): number {
  const shifted = ts + 3 * 3600 * 1000;
  return Math.floor(shifted / DAY) * DAY - 3 * 3600 * 1000;
}
function dayKey(ts: number): string {
  return new Date(dayStart(ts) + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function livePlayers(): any[] {
  const users: Record<string, any> = player.users();
  return Object.values(users).filter((p: any) => p && !p.isBot);
}

// ── Удержание ─────────────────────────────────────────────────────
// Для дня N берём тех, кто зарегистрировался достаточно давно, чтобы
// этот день у них уже наступил, и смотрим, заходил ли игрок ПОЗЖЕ
// этой отметки. Игроков, у которых день ещё не наступил, в знаменатель
// не берём — иначе вчерашние новички занижали бы недельное удержание.
function retention(list: any[]): any {
  const now = Date.now();
  const out: any = {};
  for (const d of [1, 3, 7, 30]) {
    const eligible = list.filter((p) => p.createdAt && now - p.createdAt >= d * DAY);
    const returned = eligible.filter((p) => (p.lastSeen || 0) - p.createdAt >= d * DAY);
    out['d' + d] = {
      eligible: eligible.length,
      returned: returned.length,
      pct: eligible.length ? Math.round(returned.length / eligible.length * 1000) / 10 : null,
    };
  }
  return out;
}

// ── Воронка новичка ───────────────────────────────────────────────
// Считаем по всем, кто когда-либо регистрировался: сколько прошло
// каждый рубеж. Провал между двумя соседними ступенями показывает,
// где именно теряются люди.
// Боёв всего: боевая статистика лежит в user.battle (wins/losses).
function battlesOf(p: any): number {
  const b = p.battle || {};
  return (b.wins || 0) + (b.losses || 0) + (b.defWins || 0) + (b.defLosses || 0);
}

function funnel(list: any[]): any[] {
  const total = list.length || 1;
  const step = (name: string, pass: (p: any) => boolean, note: string) => {
    const n = list.filter(pass).length;
    return { name, count: n, pct: Math.round(n / total * 1000) / 10, note };
  };
  // Ступени доведены до верхних уровней. Раньше воронка обрывалась на
  // 25-м, и вся вторая половина игры была одной строкой: по ней нельзя
  // понять, где стоит долгожитель — упирается ли он в стену на 50-м или
  // спокойно идёт к 200-му. Ступени редкие там, где игроков много, и
  // частые там, где начинается «долгая» игра.
  const lvl = (n: number) => (p: any) => (p.level || 1) >= n;
  return [
    step('Зарегистрировались', () => true, 'все аккаунты'),
    step('Провели первый бой', (p) => battlesOf(p) > 0, 'хотя бы одна атака'),
    step('Дошли до 5 уровня', lvl(5), 'освоились'),
    step('Дошли до 10 уровня', lvl(10), 'закрепились'),
    step('Дошли до 25 уровня', lvl(25), 'играют всерьёз'),
    step('Дошли до 50 уровня', lvl(50), 'втянулись'),
    step('Дошли до 100 уровня', lvl(100), 'ветераны'),
    step('Дошли до 150 уровня', lvl(150), 'редкие'),
    step('Дошли до 200 уровня', lvl(200), 'верхушка сервера'),
    step('Вступили в легион', (p) => !!p.legionId, 'социальная привязка'),
  ];
}

// ── Активность ────────────────────────────────────────────────────
function activity(list: any[]): any {
  const now = Date.now();
  const seenWithin = (ms: number) => list.filter((p) => now - (p.lastSeen || 0) <= ms).length;
  const dau = seenWithin(DAY), wau = seenWithin(7 * DAY), mau = seenWithin(30 * DAY);
  return {
    online: list.filter((p) => now - (p.lastSeen || 0) <= 5 * 60000).length,
    dau, wau, mau,
    // Липкость: какая доля месячной аудитории заходит в конкретный день.
    // 20% и выше — хороший признак для игры такого жанра.
    stickiness: mau ? Math.round(dau / mau * 1000) / 10 : null,
    newToday: list.filter((p) => (p.createdAt || 0) >= dayStart(now)).length,
    newWeek: list.filter((p) => (p.createdAt || 0) >= now - 7 * DAY).length,
    total: list.length,
  };
}

// ── Распределение по уровням ──────────────────────────────────────
// Только по живым за месяц: мёртвые души искажают картину прогрессии.
function levels(list: any[]): any[] {
  const now = Date.now();
  const active = list.filter((p) => now - (p.lastSeen || 0) <= 30 * DAY);
  const buckets = [[1, 4], [5, 9], [10, 24], [25, 49], [50, 99], [100, 199], [200, 300]];
  return buckets.map(([a, b]) => ({
    label: a === b ? String(a) : `${a}–${b}`,
    from: a, to: b,
    count: active.filter((p) => (p.level || 1) >= a && (p.level || 1) <= b).length,
  }));
}

// ── Экономика ─────────────────────────────────────────────────────
// Инфляция видна не по среднему, а по концентрации: если верхний
// процент игроков держит большую часть денег, экономика перекошена.
function economy(list: any[]): any {
  const now = Date.now();
  const active = list.filter((p) => now - (p.lastSeen || 0) <= 30 * DAY);
  const money = active.map((p) => (p.dollars || 0) + (p.bank || 0)).sort((a, b) => b - a);
  const gold = active.map((p) => p.gold || 0).sort((a, b) => b - a);
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const totalMoney = sum(money), totalGold = sum(gold);
  const topShare = (arr: number[], pct: number) => {
    if (!arr.length) return null;
    const n = Math.max(1, Math.round(arr.length * pct / 100));
    const t = sum(arr);
    return t ? Math.round(sum(arr.slice(0, n)) / t * 1000) / 10 : 0;
  };
  const median = (arr: number[]) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);
  return {
    players: active.length,
    money: {
      total: totalMoney,
      avg: active.length ? Math.round(totalMoney / active.length) : 0,
      median: median(money),
      top1Pct: topShare(money, 1),
      top10Pct: topShare(money, 10),
    },
    gold: {
      total: totalGold,
      avg: active.length ? Math.round(totalGold / active.length) : 0,
      median: median(gold),
      top10Pct: topShare(gold, 10),
    },
  };
}

// ── Ежедневный срез ───────────────────────────────────────────────
// Метрики выше считаются «на сейчас». Чтобы видеть ДИНАМИКУ, раз в
// сутки складываем их в историю. Один день — одна строка, поэтому за
// год накопится 365 записей: место это не займёт.
function snapshotDaily(force = false): any {
  const store: any = db.load('analytics', { days: {} });
  if (!store.days) store.days = {};
  const key = dayKey(Date.now());
  if (store.days[key] && !force) return store.days[key];

  const list = livePlayers();
  const a = activity(list), e = economy(list);
  store.days[key] = {
    at: Date.now(),
    dau: a.dau, wau: a.wau, mau: a.mau, online: a.online,
    total: a.total, newToday: a.newToday,
    moneyTotal: e.money.total, goldTotal: e.gold.total,
    moneyMedian: e.money.median,
  };
  // История за год — дальше смысла нет
  const keys = Object.keys(store.days).sort();
  while (keys.length > 400) delete store.days[keys.shift() as string];
  db.save('analytics');
  return store.days[key];
}

function historyDays(limit = 60): any[] {
  const store: any = db.load('analytics', { days: {} });
  return Object.entries(store.days || {})
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-limit)
    .map(([day, v]: any) => ({ day, ...v }));
}

// ── Всё вместе для экрана ─────────────────────────────────────────
function overview(): any {
  const list = livePlayers();
  snapshotDaily();     // заодно фиксируем сегодняшний день
  return {
    activity: activity(list),
    retention: retention(list),
    funnel: funnel(list),
    levels: levels(list),
    economy: economy(list),
    history: historyDays(60),
  };
}

export = { overview, activity, retention, funnel, levels, economy, snapshotDaily, historyDays, dayKey };
