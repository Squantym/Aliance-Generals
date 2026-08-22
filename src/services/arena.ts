// ═══════════════════════════════════════════════════════════════════
// src/services/arena.ts — Арена: бой каждый сам за себя
//
// Как устроено:
//   • Бои стартуют каждые 15 минут от полуночи: 00:15, 00:30, 00:45…
//   • Взнос 50 золота, весь банк достаётся единственному победителю.
//   • Характеристики у всех ОДИНАКОВЫЕ — уровень и техника не значат
//     ничего. Это принципиально: арена про реакцию и выбор цели,
//     а не про то, кто дольше играл.
//   • Четыре умения с ограниченным числом применений.
//
// Почему состояние боя держим в базе, а не в памяти: игрок может
// обновить страницу или потерять связь, и бой должен продолжиться.
// Память переживает только до перезапуска, а бой идёт минутами.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

// ---------- Дивизионы ----------
// Два независимых круга: «Базовый» на игровые деньги и «Элита» на
// золото. У каждого своя очередь, свои бои и свой рейтинг — иначе
// богатые золотом вытесняли бы новичков из общего зачёта.
const DIVISIONS = {
  basic: {
    id: 'basic',
    name: 'Арена — базовый дивизион',
    short: 'Базовый',
    currency: 'money' as const,
    entry: 1e12,                  // 1 Tr игровых денег
    icon: '🥉',
  },
  elite: {
    id: 'elite',
    name: 'Арена — Элита',
    short: 'Элита',
    currency: 'gold' as const,
    entry: 50,                    // 50 золота
    icon: '👑',
  },
};
type DivId = keyof typeof DIVISIONS;
const DIV_IDS: DivId[] = ['basic', 'elite'];

function divOf(raw: any): DivId {
  const v = String(raw || '').toLowerCase();
  return (v === 'basic' || v === 'elite') ? v as DivId : 'elite';
}

// ---------- Начисление рейтинга ----------
// Рейтинг ни на что не влияет — он просто показывает, кто чего стоит
// на арене. Поэтому начисления простые и понятные без пояснений.
const RATING_PER_KILL = 1;
const RATING_PER_WIN = 3;
const RATING_PER_FAVOURITE = 3;   // за убийство самого рейтингового в бою

// ---------- Правила ----------
const ENTRY_GOLD = 50;             // взнос с каждого
const SLOT_MINUTES = 15;           // как часто стартуют бои
const MIN_PLAYERS = 2;             // меньше — бой не состоится
// Подготовка: полминуты перед боем, чтобы все успели открыть комнату
const PREPARE_MS = 30 * 1000;

const BASE_HP = 1000;
// Урон гуляет в диапазоне: ровные 30 делали бой предсказуемым до
// последнего удара — можно было точно посчитать, сколько осталось
const BASE_ATK = 30;
const ATK_MIN = 25;
const ATK_MAX = 35;
const ATTACK_CD_MS = 1500;         // откат между ударами

const SKILLS = {
  medkit:  { name: 'Аптечка',          uses: 1, icon: '💉' },
  crit:    { name: 'Критический урон', uses: 1, icon: '💥', durationMs: 15000 },
  armor:   { name: 'Усиление брони',   uses: 1, icon: '🛡', durationMs: 15000 },
  smoke:   { name: 'Дымовая завеса',   uses: 2, icon: '🌫' },
};
const MEDKIT_HEAL_PCT = 50;        // от полного запаса
const CRIT_MIN = 3, CRIT_MAX = 5;  // множитель крита
const ARMOR_REDUCE_PCT = 50;

// Бой не может длиться вечно: если игроки разбежались и не бьют,
// через это время объявляем победителем того, у кого больше здоровья.
const BATTLE_MAX_MS = 15 * 60 * 1000;

type Fighter = {
  id: string; name: string; flag: string;
  hp: number; maxHp: number;
  targetId: string | null;
  lastAttackAt: number;
  alive: boolean;
  entered: boolean;
  seen: boolean;              // открывал ли игрок комнату боя
  place: number;            // место в бою: 1 — победитель, дальше по выбыванию
  skills: Record<string, number>;      // сколько применений осталось
  critUntil: number;
  armorUntil: number;
  kills: number;
  rating: number;             // рейтинг — виден рядом с именем
  killedIds: string[];      // кого добил — нужно для очков за фаворита
  damageDealt: number;
  log: Array<{ at: number; text: string }>;
};

type Battle = {
  id: string;
  div: string;
  slot: number;                   // время старта
  startedAt: number;
  finishedAt: number;
  pot: number;
  fighters: Record<string, Fighter>;
  winnerId: string;
  winnerName: string;
  state: 'preparing' | 'waiting' | 'running' | 'done' | 'cancelled';
  prepareUntil?: number;
};

// Состояние одного дивизиона
type DivState = {
  registered: Record<string, { id: string; name: string; flag: string; level: number; at: number }>;
  slot: number;                   // на какой старт идёт запись
  battle: Battle | null;
  history: Array<{ id: string; slot: number; winnerName: string; pot: number; players: number }>;
};

type Store = {
  divs: Record<string, DivState>;
  ratings: Record<string, Record<string, { id: string; name: string; flag: string; points: number; wins: number; kills: number; battles: number }>>;
  results: Record<string, any>;   // разбор законченных боёв
};

function emptyDiv(): DivState {
  return { registered: {}, slot: 0, battle: null, history: [] };
}

function store(): Store {
  const s = db.load<Store>('arena', { divs: {}, ratings: {}, results: {} });
  if (!s.divs) s.divs = {};
  if (!s.ratings) s.ratings = {};
  if (!s.results) s.results = {};
  for (const d of DIV_IDS) {
    if (!s.divs[d]) s.divs[d] = emptyDiv();
    if (!s.ratings[d]) s.ratings[d] = {};
  }
  // Перенос со старой схемы: раньше арена была одна и лежала в корне.
  // Считаем её «Элитой» — она была за золото.
  const legacy: any = s as any;
  if (legacy.registered || legacy.battle) {
    if (legacy.registered && Object.keys(legacy.registered).length) s.divs.elite.registered = legacy.registered;
    if (legacy.battle) s.divs.elite.battle = legacy.battle;
    if (legacy.slot) s.divs.elite.slot = legacy.slot;
    if (legacy.history) s.divs.elite.history = legacy.history;
    delete legacy.registered; delete legacy.battle;
    delete legacy.slot; delete legacy.history;
  }
  return s;
}

function divState(div: DivId): DivState {
  return store().divs[div];
}

// Списание и возврат взноса — в нужной валюте
function chargeEntry(user: any, div: DivId): void {
  const d = DIVISIONS[div];
  if (d.currency === 'gold') player.addGold(user, -d.entry, 'arena_entry');
  else user.dollars = Math.max(0, Math.round(user.dollars - d.entry));
  db.markUser(user.id);
}
function refundEntry(user: any, div: DivId): void {
  const d = DIVISIONS[div];
  if (d.currency === 'gold') player.addGold(user, d.entry, 'arena_refund');
  else player.addMoney(user, d.entry, false);
  db.markUser(user.id);
}
function payPot(user: any, div: DivId, pot: number): void {
  const d = DIVISIONS[div];
  if (d.currency === 'gold') player.addGold(user, pot, 'arena_win');
  else player.addMoney(user, pot, false);
  db.markUser(user.id);
}
function hasEntry(user: any, div: DivId): boolean {
  const d = DIVISIONS[div];
  return d.currency === 'gold' ? (user.gold || 0) >= d.entry : (user.dollars || 0) >= d.entry;
}
function fmtEntry(div: DivId): string {
  const d = DIVISIONS[div];
  return d.currency === 'gold' ? `🪙 ${d.entry}` : `$${u.fmt(d.entry)}`;
}

// ---------- Время ----------
// Ближайший старт: следующая отметка, кратная 15 минутам.
function nextSlot(from?: number): number {
  const now = from || Date.now();
  const ms = SLOT_MINUTES * 60 * 1000;
  return Math.floor(now / ms) * ms + ms;
}

// ---------- Обслуживание ----------
// Вызывается при каждом обращении к арене: запускает бой, когда пришло
// время, и завершает, когда остался один. Отдельного планировщика в
// проекте нет, а обращения к арене идут постоянно — этого достаточно.
// Обслуживание всех дивизионов сразу: бой в одном не должен зависеть
// от того, заходит ли кто-то в другой
function tick(): void {
  for (const d of DIV_IDS) tickDiv(d);
}

function tickDiv(div: DivId): void {
  const root = store();
  const s = root.divs[div];
  const now = Date.now();
  if (!s.slot) s.slot = nextSlot();

  // Время ушло в прошлое, а бой уже идёт — переставляем на следующее.
  // Без этого отсчёт вставал на нуле намертво: блок ниже не выполнялся
  // (условие !s.battle), время не обновлялось, и очередь замирала.
  if (s.battle && (s.battle.state === 'preparing' || s.battle.state === 'running'
      || s.battle.state === 'waiting') && now >= s.slot) {
    s.slot = nextSlot(now);
    db.save('arena');
  }

  // Бой закончился — очередь должна снова принимать людей
  if (s.battle && (s.battle.state === 'done' || s.battle.state === 'cancelled')) {
    // Держим разбор недолго: игрокам нужно увидеть итог, но очередь
    // важнее — иначе следующий бой не начнётся никогда
    const finishedAgo = now - (s.battle.finishedAt || 0);
    if (finishedAgo > 60000) {
      s.battle = null;
      db.save('arena');
    }
    if (now >= s.slot) {
      s.slot = nextSlot(now);
      db.save('arena');
    }
  }

  // Время старта пришло
  if (now >= s.slot && !s.battle) {
    const list = Object.values(s.registered);
    if (list.length < MIN_PLAYERS) {
      // Бой не состоялся — возвращаем взносы
      if (list.length) {
        const users = player.users();
        for (const r of list) {
          const p = users[r.id];
          if (!p) continue;
          refundEntry(p, div);
          try {
            require('./notifications').push(p.id, 'arena_cancel',
              `⚔ Бой (${DIVISIONS[div].short}) не состоялся — участников меньше ${MIN_PLAYERS}. Взнос ${fmtEntry(div)} возвращён.`, {});
          } catch (e) {}
        }
        db.save('users');
      }
      s.registered = {};
      s.slot = nextSlot(now);
      db.save('arena');
      return;
    }
    startBattle(div, s, list, now);
  }

  // Идущий бой
  if (s.battle && s.battle.state !== 'done' && s.battle.state !== 'cancelled') {
    const b = s.battle;

    // Подготовка окончена — начинаем бой.
    // Кто не открыл комнату — выбывает: он не увидит боя и всё равно
    // не смог бы драться, а держать его живым нечестно к остальным.
    if (b.state === 'preparing' && now >= (b.prepareUntil || 0)) {
      b.state = 'running';
      b.startedAt = now;
      const total = Object.keys(b.fighters).length;
      let placeFrom = total;
      for (const f of Object.values(b.fighters)) {
        if (f.seen) continue;
        f.alive = false;
        f.hp = 0;
        f.place = placeFrom--;
        addLog(f, '⏰ Вы не вышли на бой — засчитано поражение');
      }
      // Все цели могли указывать на выбывших — раздаём заново
      assignTargets(b);
      db.save('arena');
    }

    // Окна ожидания нет: все участники выходят на арену сразу при
    // старте. Взнос уже уплачен, и отвлёкшийся на минуту человек
    // терял бы деньги ни за что.

    // Бой мог остаться с одним живым не только после удара: боец мог
    // выбыть иначе, а проверка конца стояла ТОЛЬКО внутри атаки. Тогда
    // бой висел «идущим» вечно, а игроки не могли ни записаться заново,
    // ни выйти — «вы уже участвуете в идущем бою».
    if (b.state === 'running') {
      const stillAlive = Object.values(b.fighters).filter((f) => f.alive);
      if (stillAlive.length === 1) {
        finishBattle(div, s, stillAlive[0]);
        db.save('arena');
        return;
      }
      if (stillAlive.length === 0) {
        // Живых не осталось ни одного — это не «бой закончился», а «бой не
        // состоялся»: на арену не вышел НИКТО, и всех разом пометили
        // выбывшими выше. Раньше бой просто закрывался, и банк из взносов
        // исчезал вместе с ним — деньги списаны у всех, победителя нет,
        // возврата нет. Отменяем бой и возвращаем взносы.
        cancelBattle(div, s, 'Бой не состоялся: на арену никто не вышел');
        db.save('arena');
        return;
      }
    }

    // Затянувшийся бой
    if (b.state === 'running' && now - b.startedAt > BATTLE_MAX_MS) {
      const alive = Object.values(b.fighters).filter((f) => f.alive)
        .sort((a, b2) => b2.hp - a.hp);
      if (alive.length) finishBattle(div, s, alive[0]);
      db.save('arena');
      return;
    }
  }

  db.save('arena');
}

function startBattle(div: DivId, s: DivState, list: any[], now: number): void {
  const fighters: Record<string, Fighter> = {};
  // Рейтинг участников для показа рядом с именами
  const table = store().ratings[div] || {};
  for (const r of list) {
    fighters[r.id] = {
      id: r.id, name: r.name, flag: r.flag,
      hp: BASE_HP, maxHp: BASE_HP,
      targetId: null, lastAttackAt: 0,
      alive: true, entered: true, seen: false, place: 0,
      skills: { medkit: SKILLS.medkit.uses, crit: SKILLS.crit.uses, armor: SKILLS.armor.uses, smoke: SKILLS.smoke.uses },
      rating: (table[r.id] && table[r.id].points) || 0,
      critUntil: 0, armorUntil: 0, kills: 0, killedIds: [], damageDealt: 0, log: [],
    };
  }
  s.battle = {
    id: u.uid(10), div, slot: s.slot, startedAt: now, finishedAt: 0,
    pot: list.length * DIVISIONS[div].entry,
    // Сначала подготовка, потом бой: игрок должен успеть открыть комнату
    fighters, winnerId: '', winnerName: '', state: 'preparing',
    prepareUntil: now + PREPARE_MS,
  };
  assignTargets(s.battle);
  s.registered = {};
  s.slot = nextSlot(now);
  for (const r of list) {
    try {
      require('./notifications').push(r.id, 'arena_start',
        `⚔ Бой на арене (${DIVISIONS[div].short}) начался! Вы уже на арене — заходите и бейтесь.`, {});
    } catch (e) {}
  }
}

function cancelBattle(div: DivId, s: DivState, reason: string): void {
  const b = s.battle;
  if (!b) return;
  const users = player.users();
  for (const f of Object.values(b.fighters)) {
    const p = users[f.id];
    if (!p) continue;
    refundEntry(p, div);
    try {
      require('./notifications').push(p.id, 'arena_cancel',
        `⚔ ${reason}. Взнос ${fmtEntry(div)} возвращён.`, {});
    } catch (e) {}
  }
  db.save('users');
  b.state = 'cancelled';
  b.finishedAt = Date.now();
}

// Раздаём цели по кругу со случайным порядком: каждый видит следующего.
// Кольцо гарантирует, что никто не остался без цели и никто не бьёт сам себя.
function assignTargets(b: Battle): void {
  const alive = Object.values(b.fighters).filter((f) => f.alive);
  const order = u.shuffle(alive.slice());
  for (let i = 0; i < order.length; i++) {
    order[i].targetId = order[(i + 1) % order.length].id;
  }
}

// Случайная живая цель, кроме себя и, если можно, кроме указанной
function pickTarget(b: Battle, selfId: string, exceptId?: string): string | null {
  const pool = Object.values(b.fighters)
    .filter((f) => f.alive && f.id !== selfId && f.id !== exceptId);
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)].id;
  // Кроме исключённой никого нет — берём хоть кого-то
  const any = Object.values(b.fighters).filter((f) => f.alive && f.id !== selfId);
  return any.length ? any[Math.floor(Math.random() * any.length)].id : null;
}

function addLog(f: Fighter, text: string): void {
  f.log.push({ at: Date.now(), text });
  if (f.log.length > 40) f.log = f.log.slice(-40);
}

// Начисление рейтинга и сохранение разбора боя.
// Фаворит — участник с наибольшим рейтингом НА МОМЕНТ НАЧАЛА боя: если
// считать по итогам, «фаворитом» мог бы стать сам победитель, и очки
// за него достались бы тому, кого он убил.
function finishBattle(div: DivId, s: DivState, winner: Fighter): void {
  const b = s.battle;
  if (!b || b.state === 'done') return;
  b.state = 'done';
  b.finishedAt = Date.now();
  b.winnerId = winner.id;
  b.winnerName = winner.name;

  const root = store();
  const table = root.ratings[div];
  const users = player.users();
  const fighters = Object.values(b.fighters);

  // Кто был фаворитом на входе
  let favouriteId = '';
  let best = -1;
  for (const f of fighters) {
    const pts = (table[f.id] && table[f.id].points) || 0;
    if (pts > best) { best = pts; favouriteId = f.id; }
  }

  const entry = DIVISIONS[div].entry;
  const rows: any[] = [];

  for (const f of fighters) {
    const rec = table[f.id] || (table[f.id] = {
      id: f.id, name: f.name, flag: f.flag, points: 0, wins: 0, kills: 0, battles: 0,
    });
    rec.name = f.name;
    rec.flag = f.flag;
    rec.battles += 1;
    rec.kills += f.kills;

    let gained = f.kills * RATING_PER_KILL;
    const isWinner = f.id === winner.id;
    if (isWinner) { gained += RATING_PER_WIN; rec.wins += 1; }
    // Очки за фаворита — тому, кто его добил
    const killedFavourite = !!(favouriteId && favouriteId !== f.id && f.killedIds
      && f.killedIds.indexOf(favouriteId) >= 0);
    if (killedFavourite) gained += RATING_PER_FAVOURITE;

    // Штраф за место: победитель без штрафа, выбывший первым теряет
    // больше всех. При пятерых: −4, −3, −2, −1, 0.
    if (isWinner) f.place = 1;
    if (!f.place) f.place = fighters.length;      // подстраховка
    const penalty = Math.max(0, f.place - 1);

    // Заработанное перекрывает штраф: убил троих и выбыл — всё равно
    // в плюсе. Это и задумано: наказывается пассивность, а не смерть.
    const net = gained - penalty;
    rec.points = Math.max(0, rec.points + net);   // ниже нуля рейтинг не уходит

    rows.push({
      id: f.id, name: f.name, flag: f.flag,
      kills: f.kills, damage: f.damageDealt,
      place: f.place, penalty, ratingNet: net,
      alive: f.alive, winner: isWinner,
      favourite: f.id === favouriteId,
      killedFavourite,
      ratingGained: gained,
      ratingTotal: rec.points,
      // Изменение кошелька: победитель забирает банк за вычетом
      // собственного взноса, остальные теряют взнос
      delta: isWinner ? (b.pot - entry) : -entry,
    });
  }
  // Сортируем по месту: победитель первым, дальше по порядку выбывания
  rows.sort((a, c) => a.place - c.place);

  // Разбор боя — отдельной страницей, доступной после боя
  root.results[b.id] = {
    id: b.id, div, divName: DIVISIONS[div].name, currency: DIVISIONS[div].currency,
    entry, pot: b.pot, at: b.finishedAt,
    winnerId: winner.id, winnerName: winner.name,
    favouriteId, rows,
  };
  // История разборов не копится бесконечно
  const ids = Object.keys(root.results);
  if (ids.length > 60) {
    ids.sort((a, c) => (root.results[a].at || 0) - (root.results[c].at || 0));
    for (const id of ids.slice(0, ids.length - 60)) delete root.results[id];
  }

  const p = users[winner.id];
  if (p) {
    payPot(p, div, b.pot);
    db.save('users');
    try {
      require('./notifications').push(p.id, 'arena_win',
        `🏆 Вы победили на арене (${DIVISIONS[div].short})! Приз: ${DIVISIONS[div].currency === 'gold'
          ? '🪙 ' + b.pot : '$' + u.fmt(b.pot)}`, { battleId: b.id });
    } catch (e) {}
    auditLog.record({
      userId: p.id, userName: p.name, path: '/system/arena-win',
      body: { div, pot: b.pot, players: fighters.length },
    });
  }
  for (const f of fighters) {
    if (f.id === winner.id) continue;
    try {
      require('./notifications').push(f.id, 'arena_lost',
        `⚔ Бой на арене окончен. Победил «${winner.name}».`, { battleId: b.id });
    } catch (e) {}
  }

  s.history.unshift({
    id: b.id, slot: b.slot, winnerName: winner.name,
    pot: b.pot, players: fighters.length,
  });
  if (s.history.length > 20) s.history.length = 20;
}

// Разбор конкретного боя
function result(user: User, battleId: string) {
  const root = store();
  const r = root.results[String(battleId || '')];
  if (!r) throw new u.ApiError('Разбор боя не найден — возможно, он уже устарел');
  return { ...r, iAmIn: r.rows.some((x: any) => x.id === user.id) };
}

// Последний бой игрока — чтобы открыть разбор сразу после боя
function lastResultId(userId: string): string {
  const root = store();
  const all = Object.values(root.results) as any[];
  const mine = all
    .filter((r) => r.rows.some((x: any) => x.id === userId))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  return mine.length ? mine[0].id : '';
}

// Таблица рейтинга дивизиона
function rating(user: User, div: DivId, limit?: number) {
  const table = store().ratings[div] || {};
  const list = Object.values(table)
    .filter((r: any) => r.points > 0 || r.battles > 0)
    .sort((a: any, b: any) => b.points - a.points || b.wins - a.wins || b.kills - a.kills);
  const myIndex = list.findIndex((r: any) => r.id === user.id);
  return {
    top: list.slice(0, u.clamp(u.toInt(limit, 20), 1, 100)).map((r: any, i) => ({
      place: i + 1, id: r.id, name: r.name, flag: r.flag,
      points: r.points, wins: r.wins, kills: r.kills, battles: r.battles,
      isMe: r.id === user.id,
    })),
    me: myIndex >= 0 ? { place: myIndex + 1, ...(list[myIndex] as any) } : null,
    total: list.length,
  };
}

// ---------- Запись на бой ----------
function register(user: User, divRaw: any, notices: Notices) {
  tick();
  const div = divOf(divRaw);
  const s = divState(div);
  if (s.registered[user.id]) throw new u.ApiError('Вы уже записаны на ближайший бой');
  if (s.battle && s.battle.state !== 'done' && s.battle.state !== 'cancelled' && s.battle.fighters[user.id]) {
    // Мёртвый боец в идущем бою больше не участвует — пусть записывается
    const mine = s.battle.fighters[user.id];
    if (mine.alive) throw new u.ApiError('Вы уже участвуете в идущем бою');
  }
  // В другом дивизионе тоже нельзя: бои идут одновременно, и человек
  // физически не может воевать в двух местах
  for (const other of DIV_IDS) {
    if (other === div) continue;
    const o = divState(other);
    if (o.registered[user.id]) throw new u.ApiError(`Вы уже записаны в дивизион «${DIVISIONS[other].short}»`);
    const ob = o.battle;
    if (ob && ob.state !== 'done' && ob.state !== 'cancelled' && ob.fighters[user.id]) {
      throw new u.ApiError(`Вы участвуете в бою дивизиона «${DIVISIONS[other].short}»`);
    }
  }
  // Нельзя быть в двух режимах разом: бои идут параллельно, и человек
  // физически не может воевать и там, и там
  try {
    const gbSrv = require('./groupBattle');
    const gbState = gbSrv.busyState(user.id);
    if (gbState) throw new u.ApiError(`Вы ${gbState} в групповых боях`);
  } catch (e: any) {
    if (e instanceof u.ApiError) throw e;
  }

  if (!hasEntry(user, div)) {
    throw new u.ApiError(`Взнос — ${fmtEntry(div)}. Не хватает средств.`);
  }
  chargeEntry(user, div);
  s.registered[user.id] = {
    id: user.id, name: user.name, flag: player.flag(user),
    level: user.level, at: Date.now(),
  };
  db.save('arena');
  db.markUser(user.id);
  notices.push(`⚔ Вы записаны на бой (${DIVISIONS[div].short}). Взнос ${fmtEntry(div)} списан.`);
  return view(user, div);
}

function unregister(user: User, divRaw: any, notices: Notices) {
  tick();
  const div = divOf(divRaw);
  const s = divState(div);
  if (!s.registered[user.id]) throw new u.ApiError('Вы не записаны на бой');
  delete s.registered[user.id];
  refundEntry(user, div);
  db.save('arena');
  db.markUser(user.id);
  notices.push(`Запись отменена, взнос ${fmtEntry(div)} возвращён.`);
  return view(user, div);
}

// ---------- Витрина ----------
function view(user: User, divRaw?: any) {
  tick();
  const div = divOf(divRaw);
  const s = divState(div);
  const now = Date.now();
  const b = s.battle;
  const inBattle = !!(b && b.fighters[user.id] && b.state !== 'done' && b.state !== 'cancelled');

  const list = Object.values(s.registered)
    .sort((a, b2) => a.at - b2.at)
    .map((r) => ({ id: r.id, name: r.name, flag: r.flag, level: r.level }));

  return {
    div,
    divisions: DIV_IDS.map((d) => ({
      id: d, name: DIVISIONS[d].name, short: DIVISIONS[d].short,
      icon: DIVISIONS[d].icon, currency: DIVISIONS[d].currency, entry: DIVISIONS[d].entry,
    })),
    divName: DIVISIONS[div].name,
    currency: DIVISIONS[div].currency,
    currencyLabel: DIVISIONS[div].currency === 'gold' ? 'золото' : 'игровые деньги',
    entry: DIVISIONS[div].entry,
    entryGold: DIVISIONS[div].entry,
    slotMinutes: SLOT_MINUTES,
    minPlayers: MIN_PLAYERS,
    nextStartAt: s.slot,
    secondsLeft: Math.max(0, Math.round((s.slot - now) / 1000)),
    registered: list,
    pot: list.length * DIVISIONS[div].entry,
    iAmRegistered: !!s.registered[user.id],
    myGold: user.gold || 0,
    myMoney: user.dollars || 0,
    rating: rating(user, div, 20),
    lastResultId: lastResultId(user.id),
    rules: {
      hp: BASE_HP, atk: BASE_ATK, cooldownMs: ATTACK_CD_MS,
      medkitPct: MEDKIT_HEAL_PCT, critMin: CRIT_MIN, critMax: CRIT_MAX,
      armorPct: ARMOR_REDUCE_PCT, critMs: SKILLS.crit.durationMs, armorMs: SKILLS.armor.durationMs,
      smokeUses: SKILLS.smoke.uses,
    },
    // Идущий бой
    battle: b && b.state !== 'cancelled' ? {
      state: b.state,
      iAmIn: !!b.fighters[user.id],
      entered: !!(b.fighters[user.id] && b.fighters[user.id].entered),
      // Идёт подготовка и игрок ещё не занял место
      needEnter: b.state === 'preparing' && !!b.fighters[user.id]
        && !b.fighters[user.id].seen,
      prepareLeftSec: b.state === 'preparing'
        ? Math.max(0, Math.round(((b.prepareUntil || 0) - now) / 1000)) : 0,
      canEnter: b.state === 'preparing' && !!b.fighters[user.id]
        && !b.fighters[user.id].seen,
      // Сколько осталось на выход в комнату — это и есть остаток подготовки:
      // не вышел до её конца — засчитано поражение. Поле стояло жёстким
      // нулём, а экран печатает его дословно: игрок читал «выйдите на
      // арену, пока не истекло время: 0 с» и не понимал, успел он или нет.
      enterLeftSec: b.state === 'preparing'
        ? Math.max(0, Math.round(((b.prepareUntil || 0) - now) / 1000)) : 0,
      pot: b.pot,
      alive: Object.values(b.fighters).filter((f) => f.alive).length,
      total: Object.keys(b.fighters).length,
      winnerName: b.winnerName,
    } : null,
    history: (s.history || []).slice(0, 5),
  };
}

// ---------- Вход в бой ----------
// В каком дивизионе идёт бой этого игрока
function myBattle(userId: string): { div: DivId; s: DivState; b: Battle } | null {
  const root = store();
  // Сначала ищем ИДУЩИЙ бой: у игрока мог остаться завершённый бой в
  // другом дивизионе, и без этой оговорки игра показывала бы старый,
  // а действия падали бы с «бой не идёт».
  for (const d of DIV_IDS) {
    const st = root.divs[d];
    if (st.battle && st.battle.fighters[userId]
        && st.battle.state !== 'done' && st.battle.state !== 'cancelled') {
      return { div: d, s: st, b: st.battle };
    }
  }
  // Идущего нет — отдаём последний завершённый, чтобы показать итог
  let latest: { div: DivId; s: DivState; b: Battle } | null = null;
  for (const d of DIV_IDS) {
    const st = root.divs[d];
    if (st.battle && st.battle.fighters[userId]) {
      if (!latest || (st.battle.finishedAt || 0) > (latest.b.finishedAt || 0)) {
        latest = { div: d, s: st, b: st.battle };
      }
    }
  }
  return latest;
}

function enter(user: User, notices: Notices) {
  tick();
  const found = myBattle(user.id);
  const s = found ? found.s : divState('elite');
  const b = found ? found.b : null;
  if (!b || b.state === 'done' || b.state === 'cancelled') throw new u.ApiError('Бой не идёт');
  const f = b.fighters[user.id];
  if (!f) throw new u.ApiError('Вы не записаны на этот бой');
  if (f.entered) return battleState(user);
  f.entered = true;
  f.seen = true;      // явился в комнату — учитывается при старте
  addLog(f, '⚔ Вы вышли на арену');

  // Когда вышли все — начинаем, не дожидаясь окончания окна.
  // Состояния 'waiting' у боя не существует (оно бывает 'preparing',
  // 'running', 'done', 'cancelled') — условие не срабатывало никогда, и
  // полностью собравшийся бой всё равно дожидался конца подготовки.
  const all = Object.values(b.fighters);
  if (b.state === 'preparing' && all.every((x) => x.entered)) {
    b.state = 'running';
    assignTargets(b);
  }
  db.save('arena');
  return battleState(user);
}

// ---------- Состояние боя для игрока ----------
function battleState(user: User) {
  tick();
  const found = myBattle(user.id);
  const b = found ? found.b : null;
  if (!b) return { active: false };

  const me = b.fighters[user.id];
  if (!me) return { active: false };

  const now = Date.now();
  const target = me.targetId ? b.fighters[me.targetId] : null;
  // Кто целится в меня — чтобы показать «Вас атакуют N»
  const hunters = Object.values(b.fighters).filter((f) => f.alive && f.targetId === me.id && f.id !== me.id);

  return {
    active: b.state === 'preparing' || b.state === 'waiting' || b.state === 'running',
    state: b.state,
    preparing: b.state === 'preparing',
    prepareLeftSec: b.state === 'preparing'
      ? Math.max(0, Math.round(((b.prepareUntil || 0) - now) / 1000)) : 0,
    pot: b.pot,
    div: found ? found.div : 'elite',
    divName: found ? DIVISIONS[found.div].name : '',
    currency: found ? DIVISIONS[found.div].currency : 'gold',
    battleId: b.id,
    finished: b.state === 'done',
    winnerName: b.winnerName,
    iWon: b.winnerId === user.id,
    me: {
      id: me.id, name: me.name, flag: me.flag,
      hp: me.hp, maxHp: me.maxHp, alive: me.alive,
      skills: me.skills,
      critLeftSec: Math.max(0, Math.round((me.critUntil - now) / 1000)),
      armorLeftSec: Math.max(0, Math.round((me.armorUntil - now) / 1000)),
      cooldownLeftMs: Math.max(0, me.lastAttackAt + ATTACK_CD_MS - now),
      cooldownMs: ATTACK_CD_MS,
      critLeftMs: Math.max(0, me.critUntil - now),
      armorLeftMs: Math.max(0, me.armorUntil - now),
      rating: me.rating || 0,
      kills: me.kills, damageDealt: me.damageDealt,
    },
    huntersCount: hunters.length,
    target: target ? {
      id: target.id, name: target.name, flag: target.flag,
      hp: target.hp, maxHp: target.maxHp, alive: target.alive, rating: target.rating || 0,
    } : null,
    // Оставшиеся бойцы с их здоровьем
    alive: Object.values(b.fighters)
      .filter((f) => f.alive)
      .sort((a, c) => c.hp - a.hp)
      .map((f) => ({ id: f.id, name: f.name, flag: f.flag, hp: f.hp, maxHp: f.maxHp,
                     rating: f.rating || 0, isMe: f.id === me.id })),
    aliveCount: Object.values(b.fighters).filter((f) => f.alive).length,
    total: Object.keys(b.fighters).length,
    log: me.log.slice(-25),
  };
}

// ---------- Действия в бою ----------
function requireFight(user: User): { div: DivId; s: DivState; b: Battle; me: Fighter } {
  tick();
  const found = myBattle(user.id);
  if (!found || found.b.state !== 'running') throw new u.ApiError('Бой не идёт');
  const { div, s, b } = found;
  const me = b.fighters[user.id];
  if (!me) throw new u.ApiError('Вы не участвуете в этом бою');
  if (!me.alive) throw new u.ApiError('Вы выбыли из боя');
  return { div, s, b, me };
}

function attack(user: User) {
  const { div, s, b, me } = requireFight(user);
  const now = Date.now();
  if (now - me.lastAttackAt < ATTACK_CD_MS) {
    throw new u.ApiError(`Перезарядка ${((ATTACK_CD_MS - (now - me.lastAttackAt)) / 1000).toFixed(1)} с`);
  }
  if (!me.targetId || !b.fighters[me.targetId] || !b.fighters[me.targetId].alive) {
    me.targetId = pickTarget(b, me.id);
    if (!me.targetId) throw new u.ApiError('Целей не осталось');
  }
  const target = b.fighters[me.targetId];
  me.lastAttackAt = now;

  // Урон: база, крит и броня цели
  let dmg = ATK_MIN + Math.floor(Math.random() * (ATK_MAX - ATK_MIN + 1));
  let crit = false;
  if (me.critUntil > now) {
    crit = true;
    dmg = Math.round(dmg * (CRIT_MIN + Math.random() * (CRIT_MAX - CRIT_MIN)));
  }
  if (target.armorUntil > now) dmg = Math.round(dmg * (1 - ARMOR_REDUCE_PCT / 100));

  target.hp = Math.max(0, target.hp - dmg);
  me.damageDealt += dmg;
  addLog(me, `${crit ? '💥 Крит! ' : '⚔ '}Вы ударили «${target.name}» на ${dmg}`);
  addLog(target, `🩸 «${me.name}» ударил вас на ${dmg}${crit ? ' (критический)' : ''}`);

  if (target.hp <= 0) {
    target.alive = false;
    // Место = сколько бойцов ещё в строю (включая павшего). Кто выбыл
    // первым при пятерых — получает пятое место, и штраф у него
    // наибольший.
    target.place = Object.values(b.fighters).filter((f) => f.alive).length + 1;
    me.kills += 1;
    me.killedIds.push(target.id);
    addLog(me, `☠ Вы вывели из боя «${target.name}»`);
    addLog(target, `☠ Вы выбыли из боя. Вас добил «${me.name}»`);
    // Все, кто целился в павшего, получают новую цель
    for (const f of Object.values(b.fighters)) {
      if (f.alive && f.targetId === target.id) f.targetId = pickTarget(b, f.id);
    }
    const alive = Object.values(b.fighters).filter((f) => f.alive);
    if (alive.length <= 1) {
      if (alive.length === 1) finishBattle(div, s, alive[0]);
      db.save('arena');
      return battleState(user);
    }
  }
  db.save('arena');
  return battleState(user);
}

// Покинуть бой: боец считается выбывшим, награды не получает.
// Нужно, чтобы человек не сидел взаперти, если ему надо уйти.
function leave(user: User, notices: Notices) {
  tick();
  const found = myBattle(user.id);
  if (!found) throw new u.ApiError('Вы не в бою');
  const { div, s, b } = found;
  const me = b.fighters[user.id];
  if (!me || !me.alive) throw new u.ApiError('Вы уже выбыли');
  me.alive = false;
  me.hp = 0;
  me.place = Object.values(b.fighters).filter((f) => f.alive).length + 1;
  addLog(me, '🚪 Вы покинули бой — поражение засчитано');
  for (const f of Object.values(b.fighters)) {
    if (f.alive && f.targetId === me.id) f.targetId = pickTarget(b, f.id);
  }
  const alive = Object.values(b.fighters).filter((f) => f.alive);
  if (alive.length === 1) finishBattle(div, s, alive[0]);
  db.save('arena');
  notices.push('Вы покинули бой. Награды не начислены.');
  return { left: true };
}

function switchTarget(user: User) {
  const { b, me } = requireFight(user);
  const old = me.targetId;
  me.targetId = pickTarget(b, me.id, old || undefined);
  if (!me.targetId) throw new u.ApiError('Целей не осталось');
  const t = b.fighters[me.targetId];
  addLog(me, `🎯 Новая цель: «${t.name}»`);
  db.save('arena');
  return battleState(user);
}

function useSkill(user: User, skill: string) {
  const { b, me } = requireFight(user);
  const def = (SKILLS as any)[skill];
  if (!def) throw new u.ApiError('Неизвестное умение');
  if ((me.skills[skill] || 0) <= 0) throw new u.ApiError(`«${def.name}» уже использована`);
  const now = Date.now();
  me.skills[skill] -= 1;

  if (skill === 'medkit') {
    const heal = Math.round(me.maxHp * MEDKIT_HEAL_PCT / 100);
    me.hp = Math.min(me.maxHp, me.hp + heal);
    addLog(me, `💉 Аптечка: +${heal} HP`);
  } else if (skill === 'crit') {
    me.critUntil = now + def.durationMs;
    addLog(me, `💥 Критический урон на ${def.durationMs / 1000} с`);
  } else if (skill === 'armor') {
    me.armorUntil = now + def.durationMs;
    addLog(me, `🛡 Броня усилена на ${def.durationMs / 1000} с`);
  } else if (skill === 'smoke') {
    // Уходим из-под прицела: все, кто целился в нас, получают другую цель
    let lost = 0;
    for (const f of Object.values(b.fighters)) {
      if (f.alive && f.id !== me.id && f.targetId === me.id) {
        f.targetId = pickTarget(b, f.id, me.id);
        addLog(f, '🌫 Цель скрылась в дыму — вы переключились на другую');
        lost++;
      }
    }
    addLog(me, lost ? `🌫 Дымовая завеса: вы ушли от ${lost} преследователей`
                    : '🌫 Дымовая завеса: за вами никто не гнался');
  }
  db.save('arena');
  return battleState(user);
}

// Занят ли игрок ареной: записан или в идущем бою
function busyState(userId: string): string | null {
  const root = store();
  for (const d of DIV_IDS) {
    const st = root.divs[d];
    if (st.registered[userId]) return 'записаны на бой';
    const b = st.battle;
    if (b && b.fighters[userId] && b.state === 'running' && b.fighters[userId].alive) {
      return 'сейчас в бою';
    }
  }
  return null;
}

export = {
  view, register, unregister, enter, battleState, attack, switchTarget, useSkill, busyState, leave,
  result, rating, lastResultId, DIVISIONS, DIV_IDS, divOf,
  RATING_PER_KILL, RATING_PER_WIN, RATING_PER_FAVOURITE,
  tick, nextSlot, ENTRY_GOLD, SLOT_MINUTES, MIN_PLAYERS, BASE_HP, BASE_ATK,
  ATTACK_CD_MS, SKILLS, PREPARE_MS,
};
