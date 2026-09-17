// ═══════════════════════════════════════════════════════════════════
// src/services/arena.ts — Арена: бой каждый сам за себя
//
// Как устроено:
//   • Бои стартуют каждые 15 минут от полуночи: 00:15, 00:30, 00:45…
//   • Взнос 10 золота (Элита) или 1 млрд (Базовый), весь банк достаётся
//     единственному победителю.
//   • Характеристики РЕАЛЬНЫЕ, «всё как в игре» (решение владельца,
//     17.09.2026, realStats.ts): здоровье и боеприпасы — максимумы
//     игрока, удар — по формуле войны от мощи армий, крит и уворот — от
//     навыков. До этого у всех было поровну: 1000 HP и удар 25–35.
//   • Четыре умения с ограниченным числом применений — как было.
//   • Если к старту живых меньше 10, за 10 секунд до начала свободные
//     места занимают боты с 70% средних характеристик живых. Взнос боты
//     не платят; победил бот — банк сгорает.
//
// Почему состояние боя держим в базе, а не в памяти: игрок может
// обновить страницу или потерять связь, и бой должен продолжиться.
// Память переживает только до перезапуска, а бой идёт минутами.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import auditLog = require('./auditLog');
import RS = require('./realStats');
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
    entry: 1e9,                   // 1 млрд игровых денег
    icon: '🥉',
  },
  elite: {
    id: 'elite',
    name: 'Арена — Элита',
    short: 'Элита',
    currency: 'gold' as const,
    entry: 10,                    // 10 золота
    icon: '👑',
  },
};
type DivId = keyof typeof DIVISIONS;

// Взносы до снижения. Запись и бойцы, созданные до выката, не знают,
// сколько заплатили, — а платили по старой цене. Без этой таблицы
// отмена записи или несостоявшийся бой вернули бы 10 золота вместо 50.
const LEGACY_ENTRY: Record<DivId, number> = { basic: 1e12, elite: 50 };
function paidOf(rec: any, div: DivId): number {
  return (rec && typeof rec.paid === 'number') ? rec.paid : LEGACY_ENTRY[div];
}
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
const ENTRY_GOLD = 10;             // взнос с каждого (Элита)
const SLOT_MINUTES = 15;           // как часто стартуют бои
const MIN_PLAYERS = 2;             // меньше — бой не состоится (боты считаются)
// Боты: места до ARENA_SEATS за 10 секунд до старта, сила — 70% от
// средних у живых игроков боя (решение владельца)
const ARENA_SEATS = 10;
// Сколько мест добирать ботами. Меняется только тестами: старые
// сценарии проверяют бой четверых без ботов (setSeats(0)).
let seats = ARENA_SEATS;
function setSeats(n: number): void { seats = Math.max(0, Math.floor(Number(n) || 0)); }
const BOT_FILL_BEFORE_MS = 10 * 1000;
const BOT_STRENGTH = 0.7;
const BOT_THINK_MS = 3000;
const BOT_PREFIX = 'abot_';
const BOT_NAMES = ['Гладиатор', 'Страж', 'Центурион', 'Легат', 'Варвар', 'Дуэлянт',
                   'Витязь', 'Ландскнехт', 'Спартанец', 'Самурай'];
const isBotId = (id: string) => String(id).startsWith(BOT_PREFIX);
// Подготовка: полминуты перед боем, чтобы все успели открыть комнату
const PREPARE_MS = 30 * 1000;

// Прежние ровные значения — только для справки в правилах и для боёв,
// начатых до перехода на реальные характеристики
const BASE_HP = 1000;
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
  ammo?: number; maxAmmo?: number;   // боезапас — реальный максимум игрока
  stats?: any;                       // реальные характеристики на старте
  isBot?: boolean;
  botAt?: number;                    // когда бот ходил последний раз
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
  paid?: number;              // сколько внёс — столько и вернуть при отмене
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
  registered: Record<string, { id: string; name: string; flag: string; level: number; at: number; paid?: number }>;
  slot: number;                   // на какой старт идёт запись
  battle: Battle | null;
  // Бои, которые ещё шли, когда наступило время следующего. Раньше
  // следующий бой ждал конца текущего, а время старта переставлялось на
  // четверть часа вперёд — отсчёт «начинался заново».
  others?: Battle[];
  history: Array<{ id: string; slot: number; winnerName: string; pot: number; players: number }>;
};

const isLive = (b: Battle | null | undefined) => !!b
  && (b.state === 'preparing' || b.state === 'waiting' || b.state === 'running');
function divBattles(s: DivState): Battle[] {
  if (!Array.isArray(s.others)) s.others = [];
  return [s.battle, ...s.others].filter(Boolean) as Battle[];
}

type Store = {
  divs: Record<string, DivState>;
  ratings: Record<string, Record<string, { id: string; name: string; flag: string; points: number; wins: number; kills: number; battles: number }>>;
  results: Record<string, any>;   // разбор законченных боёв
  // Порядковый номер разбора. Нужен потому, что времени НЕ ХВАТАЕТ:
  // тик обрабатывает все дивизионы в одном проходе, и два боя легко
  // заканчиваются в одну и ту же миллисекунду. Сортировка только по
  // времени в этом случае выбирала произвольный из двух, и игрок видел
  // разбор ЧУЖОГО боя — не свой урон, не свою награду, не свой рейтинг.
  resultSeq?: number;
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
    // Неполная запись дивизиона (правка базы руками, старая версия) не
    // должна ронять тик: он обходит все дивизионы разом
    if (!s.divs[d].registered) s.divs[d].registered = {};
    if (!Array.isArray(s.divs[d].history)) s.divs[d].history = [];
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
// Возвращаем ровно внесённое, а не текущий взнос: цена могла смениться
function refundEntry(user: any, div: DivId, amount: number): void {
  const d = DIVISIONS[div];
  // Сумма берётся из записи в базе: битое поле не должно ни списать
  // вместо возврата, ни разнести NaN по счёту
  const v = Math.max(0, Math.round(Number(amount) || 0));
  if (d.currency === 'gold') player.addGold(user, v, 'arena_refund');
  else player.addMoney(user, v, false);
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
function fmtEntry(div: DivId, amount?: number): string {
  const d = DIVISIONS[div];
  const v = amount === undefined ? d.entry : amount;
  return d.currency === 'gold' ? `🪙 ${v}` : `${u.fmt(v)}`;
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
  divBattles(s);

  // Завершённые бои убираем через минуту: разбор уже сохранён отдельно
  if (s.battle && !isLive(s.battle) && now - (s.battle.finishedAt || 0) > 60000) {
    s.battle = null;
    db.save('arena');
  }
  s.others = (s.others || []).filter((x) => isLive(x) || now - (x.finishedAt || 0) <= 60000);

  const humansQueued = Object.values(s.registered).filter((r) => !isBotId(r.id)).length;
  // Живых в очереди нет — ботам без людей воевать незачем
  if (!humansQueued && Object.keys(s.registered).length) s.registered = {};

  // За 10 секунд до старта свободные места занимают боты
  if (humansQueued && s.slot - now <= BOT_FILL_BEFORE_MS && s.slot - now > 0) {
    fillBots(s);
  }

  // Время старта пришло. Идущий бой старту не мешает: он доигрывается
  // в others, а новый состав получает свой бой вовремя.
  if (now >= s.slot) {
    if (humansQueued) fillBots(s);
    const list = Object.values(s.registered);
    if (list.length && isLive(s.battle)) {
      s.others!.push(s.battle!);
      s.battle = null;
    }
    if (!list.length) {
      s.slot = nextSlot(now);
      db.save('arena');
    } else if (list.length < MIN_PLAYERS) {
      // Бой не состоялся — возвращаем взносы
      const users = player.users();
      for (const r of list) {
        const p = users[r.id];
        if (!p) continue;
        refundEntry(p, div, paidOf(r, div));
        try {
          require('./notifications').push(p.id, 'arena_cancel',
            `⚔ Бой (${DIVISIONS[div].short}) не состоялся — участников меньше ${MIN_PLAYERS}. Взнос ${fmtEntry(div, paidOf(r, div))} возвращён.`, {});
        } catch (e) {}
      }
      db.save('users');
      s.registered = {};
      s.slot = nextSlot(now);
    } else {
      startBattle(div, s, list, now);
    }
  }

  for (const b of divBattles(s)) runBattle(div, s, b, now);
  db.save('arena');
}

// Ход одного боя дивизиона
function runBattle(div: DivId, s: DivState, b: Battle, now: number): void {
  if (!isLive(b)) return;

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
  }

  if (b.state !== 'running') return;
  botsAct(div, s, b, now);
  if (!isLive(b)) return;

  // Бой мог остаться с одним живым не только после удара: боец мог
  // выбыть иначе, а проверка конца стояла ТОЛЬКО внутри атаки. Тогда
  // бой висел «идущим» вечно, а игроки не могли ни записаться заново,
  // ни выйти — «вы уже участвуете в идущем бою».
  const stillAlive = Object.values(b.fighters).filter((f) => f.alive);
  if (stillAlive.length === 1) { finishBattle(div, s, stillAlive[0], b); return; }
  if (stillAlive.length === 0) {
    // Живых не осталось ни одного — это не «бой закончился», а «бой не
    // состоялся»: на арену не вышел НИКТО, и всех разом пометили
    // выбывшими выше. Отменяем бой и возвращаем взносы.
    cancelBattle(div, s, 'Бой не состоялся: на арену никто не вышел', b);
    return;
  }
  // Затянувшийся бой — или стрелять больше нечем: побеждает тот, у кого
  // больше здоровья. С реальными боеприпасами (от 5 штук) второе бывает
  // часто, и ждать четверть часа незачем.
  const noAmmo = stillAlive.every((f) => typeof f.ammo === 'number' && f.ammo <= 0);
  if (now - b.startedAt > BATTLE_MAX_MS || noAmmo) {
    const alive = stillAlive.slice().sort((x, y) => y.hp - x.hp);
    finishBattle(div, s, alive[0], b);
  }
}

// ── Боты ───────────────────────────────────────────────────────────
function fillBots(s: DivState): void {
  const have = Object.keys(s.registered).length;
  let n = Object.values(s.registered).filter((r) => isBotId(r.id)).length;
  for (let i = have; i < seats; i++) {
    const id = BOT_PREFIX + u.uid(8);
    s.registered[id] = { id, name: BOT_NAMES[n % BOT_NAMES.length] + '-' + (n + 1),
                         flag: '🤖', level: 0, at: Date.now(), paid: 0 };
    n++;
  }
}

// Бот бьёт свою цель, лечится при ранении и изредка включает умения.
// Ходит реже живого (раз в 3 секунды): у него нет реакции, только правила.
function botsAct(div: DivId, s: DivState, b: Battle, now: number): void {
  for (const f of Object.values(b.fighters)) {
    if (!f.isBot || !f.alive || b.state !== 'running') continue;
    if (now - (f.botAt || 0) < BOT_THINK_MS) continue;
    f.botAt = now;
    if (f.hp < f.maxHp * 0.4 && (f.skills.medkit || 0) > 0) { skillFor(b, f, 'medkit', now); continue; }
    if ((f.skills.crit || 0) > 0 && Math.random() < 0.15) skillFor(b, f, 'crit', now);
    const hunted = Object.values(b.fighters).some((x) => x.alive && x.targetId === f.id);
    if (hunted && (f.skills.armor || 0) > 0 && Math.random() < 0.2) skillFor(b, f, 'armor', now);
    if (typeof f.ammo === 'number' && f.ammo <= 0) continue;
    strike(div, s, b, f, now);
  }
}

function startBattle(div: DivId, s: DivState, list: any[], now: number): void {
  const fighters: Record<string, Fighter> = {};
  // Рейтинг участников для показа рядом с именами
  const table = store().ratings[div] || {};
  // Реальные характеристики живых — снимок на старте; боты — 70% средних
  const users = player.users();
  const snaps: Record<string, any> = {};
  for (const r of list) if (!isBotId(r.id) && users[r.id]) snaps[r.id] = RS.snapshot(users[r.id]);
  const avg = RS.average(Object.values(snaps));
  const humanPts = list.filter((r) => !isBotId(r.id)).map((r) => (table[r.id] && table[r.id].points) || 0);
  const avgPts = humanPts.length ? Math.round(humanPts.reduce((a, c) => a + c, 0) / humanPts.length) : 0;
  for (const r of list) {
    const bot = isBotId(r.id);
    const st = bot ? RS.botStats(avg, BOT_STRENGTH) : (snaps[r.id] || RS.average([]));
    fighters[r.id] = {
      id: r.id, name: r.name, flag: r.flag,
      hp: st.hp, maxHp: st.hp,
      ammo: st.ammo, maxAmmo: st.ammo, stats: st,
      isBot: bot, botAt: 0,
      targetId: null, lastAttackAt: 0,
      // Бот в комнате с первой секунды — ему открывать нечего
      alive: true, entered: true, seen: bot, place: 0,
      skills: { medkit: SKILLS.medkit.uses, crit: SKILLS.crit.uses, armor: SKILLS.armor.uses, smoke: SKILLS.smoke.uses },
      rating: bot ? Math.max(0, avgPts + Math.round((Math.random() * 2 - 1) * Math.max(5, avgPts * 0.3)))
        : ((table[r.id] && table[r.id].points) || 0),
      critUntil: 0, armorUntil: 0, kills: 0, killedIds: [], damageDealt: 0, log: [],
      paid: bot ? 0 : paidOf(r, div),
    };
  }
  s.battle = {
    id: u.uid(10), div, slot: s.slot, startedAt: now, finishedAt: 0,
    // Банк — сумма реально внесённого, а не «участники × текущий взнос»
    pot: list.reduce((n, r) => n + paidOf(r, div), 0),
    // Сначала подготовка, потом бой: игрок должен успеть открыть комнату
    fighters, winnerId: '', winnerName: '', state: 'preparing',
    prepareUntil: now + PREPARE_MS,
  };
  assignTargets(s.battle);
  s.registered = {};
  s.slot = nextSlot(now);
  for (const r of list) {
    if (isBotId(r.id)) continue;
    try {
      require('./notifications').push(r.id, 'arena_start',
        `⚔ Бой на арене (${DIVISIONS[div].short}) начался! Вы уже на арене — заходите и бейтесь.`, {});
    } catch (e) {}
  }
}

function cancelBattle(div: DivId, s: DivState, reason: string, battle?: Battle): void {
  const b = battle || s.battle;
  if (!b) return;
  const users = player.users();
  for (const f of Object.values(b.fighters)) {
    const p = users[f.id];
    if (!p) continue;
    refundEntry(p, div, paidOf(f, div));
    try {
      require('./notifications').push(p.id, 'arena_cancel',
        `⚔ ${reason}. Взнос ${fmtEntry(div, paidOf(f, div))} возвращён.`, {});
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
function finishBattle(div: DivId, s: DivState, winner: Fighter, battle?: Battle): void {
  const b = battle || s.battle;
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
    // Бот в таблицу рейтинга не пишется: его запись живёт только в разборе
    const rec = f.isBot
      ? { id: f.id, name: f.name, flag: f.flag, points: f.rating || 0, wins: 0, kills: 0, battles: 0 }
      : (table[f.id] || (table[f.id] = {
        id: f.id, name: f.name, flag: f.flag, points: 0, wins: 0, kills: 0, battles: 0,
      }));
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
      id: f.id, name: f.name, flag: f.flag, isBot: !!f.isBot,
      kills: f.kills, damage: f.damageDealt,
      place: f.place, penalty, ratingNet: net,
      alive: f.alive, winner: isWinner,
      favourite: f.id === favouriteId,
      killedFavourite,
      ratingGained: gained,
      ratingTotal: rec.points,
      // Изменение кошелька: победитель забирает банк за вычетом
      // собственного взноса, остальные теряют взнос
      // Бот взнос не платил и банк не получает: победа бота сжигает банк
      delta: f.isBot ? 0 : (isWinner ? (b.pot - paidOf(f, div)) : -paidOf(f, div)),
    });
  }
  // Сортируем по месту: победитель первым, дальше по порядку выбывания
  rows.sort((a, c) => a.place - c.place);

  // Разбор боя — отдельной страницей, доступной после боя
  root.results[b.id] = {
    id: b.id, div, divName: DIVISIONS[div].name, currency: DIVISIONS[div].currency,
    entry, pot: b.pot, at: b.finishedAt,
    // Возрастающий номер: при совпадении времени до миллисекунды он и
    // решает, какой разбор новее. См. Store.resultSeq.
    seq: (root.resultSeq = (root.resultSeq || 0) + 1),
    winnerId: winner.id, winnerName: winner.name,
    winnerIsBot: !!winner.isBot, potBurned: !!winner.isBot && b.pot > 0,
    favouriteId, rows,
  };
  // История разборов не копится бесконечно
  const ids = Object.keys(root.results);
  if (ids.length > 60) {
    ids.sort((a, c) => (root.results[a].at || 0) - (root.results[c].at || 0));
    for (const id of ids.slice(0, ids.length - 60)) delete root.results[id];
  }

  const p = winner.isBot ? null : users[winner.id];
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
    if (f.id === winner.id || f.isBot) continue;
    try {
      require('./notifications').push(f.id, 'arena_lost',
        `⚔ Бой на арене окончен. Победил «${winner.name}»${winner.isBot ? ' (бот) — банк сгорел' : ''}.`, { battleId: b.id });
    } catch (e) {}
  }
  if (winner.isBot && b.pot > 0) {
    auditLog.record({
      userId: 'system', userName: 'system', path: '/system/arena-pot-burned',
      body: { div, pot: b.pot, players: fighters.length },
    });
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
    // Сначала по времени, а при равенстве — по номеру. Сортировка ТОЛЬКО
    // по времени выбирала произвольный разбор из двух, законченных в
    // одну миллисекунду, и игрок открывал чужой бой: с чужим уроном,
    // чужой наградой и чужим рейтингом. Тик обрабатывает все дивизионы
    // одним проходом, так что совпадение — не редкость, а норма.
    .sort((a, b) => ((b.at || 0) - (a.at || 0)) || ((b.seq || 0) - (a.seq || 0)));
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
  // Мёртвый боец в идущем бою больше не участвует — пусть записывается
  if (divBattles(s).some((b) => isLive(b) && b.fighters[user.id] && b.fighters[user.id].alive)) {
    throw new u.ApiError('Вы уже участвуете в идущем бою');
  }
  // В другом дивизионе тоже нельзя: бои идут одновременно, и человек
  // физически не может воевать в двух местах
  for (const other of DIV_IDS) {
    if (other === div) continue;
    const o = divState(other);
    if (o.registered[user.id]) throw new u.ApiError(`Вы уже записаны в дивизион «${DIVISIONS[other].short}»`);
    if (divBattles(o).some((ob) => isLive(ob) && ob.fighters[user.id])) {
      throw new u.ApiError(`Вы участвуете в бою дивизиона «${DIVISIONS[other].short}»`);
    }
  }
  // Нельзя быть в двух режимах разом: бои идут параллельно, и человек
  // физически не может воевать и там, и там
  for (const [mod, where] of [['./groupBattle', 'в рейтинговых боях'], ['./squadBattle', 'в групповых боях']]) {
    try {
      const st = require(mod).busyState(user.id);
      if (st) throw new u.ApiError(`Вы ${st} ${where}`);
    } catch (e: any) {
      if (e instanceof u.ApiError) throw e;
    }
  }

  if (!hasEntry(user, div)) {
    throw new u.ApiError(`Взнос — ${fmtEntry(div)}. Не хватает средств.`);
  }
  chargeEntry(user, div);
  // Места уже заняли боты — живой вытесняет одного из них
  if (seats && Object.keys(s.registered).length >= seats) {
    const botId = Object.keys(s.registered).find(isBotId);
    if (botId) delete s.registered[botId];
  }
  s.registered[user.id] = {
    id: user.id, name: user.name, flag: player.flag(user),
    level: user.level, at: Date.now(),
    paid: DIVISIONS[div].entry,
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
  const paid = paidOf(s.registered[user.id], div);
  delete s.registered[user.id];
  // Живых не осталось — ботов тоже снимаем
  if (!Object.keys(s.registered).some((id) => !isBotId(id))) s.registered = {};
  refundEntry(user, div, paid);
  db.save('arena');
  db.markUser(user.id);
  notices.push(`Запись отменена, взнос ${fmtEntry(div, paid)} возвращён.`);
  return view(user, div);
}

// ---------- Витрина ----------
function view(user: User, divRaw?: any) {
  tick();
  const div = divOf(divRaw);
  const s = divState(div);
  const now = Date.now();
  const mineHere = divBattles(s).filter((x) => x.fighters[user.id]);
  const b = mineHere.find(isLive) || mineHere[0] || s.battle;
  let myStats: any = null;
  try {
    const m = RS.snapshot(user);
    myStats = { hp: m.hp, ammo: m.ammo, atk: m.atk, def: m.def,
      critPct: Math.round(m.critChance * 1000) / 10, dodgePct: Math.round(m.dodgeChance * 1000) / 10 };
  } catch (e) { myStats = null; }

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
    registered: list.map((r) => ({ ...r, isBot: isBotId(r.id) })),
    pot: Object.values(s.registered).reduce((n, r) => n + (isBotId(r.id) ? 0 : paidOf(r, div)), 0),
    seats, botFillSec: Math.round(BOT_FILL_BEFORE_MS / 1000),
    botPct: Math.round(BOT_STRENGTH * 100),
    myStats,
    iAmRegistered: !!s.registered[user.id],
    myGold: user.gold || 0,
    myMoney: user.dollars || 0,
    rating: rating(user, div, 20),
    lastResultId: lastResultId(user.id),
    rules: {
      real: true,
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
    const live = divBattles(st).find((x) => isLive(x) && x.fighters[userId]);
    if (live) return { div: d, s: st, b: live };
  }
  // Идущего нет — отдаём последний завершённый, чтобы показать итог
  let latest: { div: DivId; s: DivState; b: Battle } | null = null;
  for (const d of DIV_IDS) {
    const st = root.divs[d];
    for (const x of divBattles(st)) {
      if (!x.fighters[userId]) continue;
      if (!latest || (x.finishedAt || 0) > (latest.b.finishedAt || 0)) latest = { div: d, s: st, b: x };
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
      ammo: typeof me.ammo === 'number' ? me.ammo : null,
      maxAmmo: typeof me.maxAmmo === 'number' ? me.maxAmmo : null,
      atk: me.stats ? me.stats.atk : 0, def: me.stats ? me.stats.def : 0,
    },
    huntersCount: hunters.length,
    target: target ? {
      id: target.id, name: target.name, flag: target.flag,
      hp: target.hp, maxHp: target.maxHp, alive: target.alive, rating: target.rating || 0,
      isBot: !!target.isBot,
    } : null,
    // Оставшиеся бойцы с их здоровьем
    alive: Object.values(b.fighters)
      .filter((f) => f.alive)
      .sort((a, c) => c.hp - a.hp)
      .map((f) => ({ id: f.id, name: f.name, flag: f.flag, hp: f.hp, maxHp: f.maxHp,
                     rating: f.rating || 0, isMe: f.id === me.id, isBot: !!f.isBot })),
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
  if (typeof me.ammo === 'number' && me.ammo <= 0) throw new u.ApiError('Боеприпасы кончились');
  if (!strike(div, s, b, me, now)) throw new u.ApiError('Целей не осталось');
  db.save('arena');
  return battleState(user);
}

// Удар бойца по своей цели — один и тот же для человека и бота.
// Урон — по формуле войны от реальных характеристик (realStats), сверху
// умения арены: «Критический урон» и «Усиление брони». Бои, начатые до
// перехода на реальные характеристики, бьют по-старому.
function strike(div: DivId, s: DivState, b: Battle, me: Fighter, now: number): boolean {
  if (!me.targetId || !b.fighters[me.targetId] || !b.fighters[me.targetId].alive) {
    me.targetId = pickTarget(b, me.id);
    if (!me.targetId) return false;
  }
  const target = b.fighters[me.targetId];
  me.lastAttackAt = now;
  if (typeof me.ammo === 'number') me.ammo = Math.max(0, me.ammo - 1);

  let dmg: number;
  let crit = false;
  let dodged = false;
  if (me.stats && target.stats) {
    const h = RS.hit(me.stats, target.stats);
    dmg = h.dmg; crit = h.crit; dodged = h.dodged;
  } else {
    dmg = ATK_MIN + Math.floor(Math.random() * (ATK_MAX - ATK_MIN + 1));
  }
  if (dodged) {
    addLog(me, `💨 «${target.name}» увернулся от удара`);
    addLog(target, `💨 Вы увернулись от удара «${me.name}»`);
    return true;
  }
  if (me.critUntil > now) {
    crit = true;
    dmg = Math.round(dmg * (CRIT_MIN + Math.random() * (CRIT_MAX - CRIT_MIN)));
  }
  if (target.armorUntil > now) dmg = Math.round(dmg * (1 - ARMOR_REDUCE_PCT / 100));
  dmg = Math.max(1, dmg);

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
    if (alive.length === 1) finishBattle(div, s, alive[0], b);
  }
  return true;
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
  if (alive.length === 1) finishBattle(div, s, alive[0], b);
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
  skillFor(b, me, skill, Date.now());
  db.save('arena');
  return battleState(user);
}

// Умение — одно для человека и бота
function skillFor(b: Battle, me: Fighter, skill: string, now: number): void {
  const def = (SKILLS as any)[skill];
  if (!def || (me.skills[skill] || 0) <= 0) return;
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
}

// Занят ли игрок ареной: записан или в идущем бою
function busyState(userId: string): string | null {
  const root = store();
  for (const d of DIV_IDS) {
    const st = root.divs[d];
    if (st.registered[userId]) return 'записаны на бой';
    if (divBattles(st).some((b) => b.state === 'running' && b.fighters[userId] && b.fighters[userId].alive)) {
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
  ATTACK_CD_MS, SKILLS, PREPARE_MS, ARENA_SEATS, BOT_FILL_BEFORE_MS, BOT_STRENGTH, BOT_PREFIX,
  strike, botsAct, divBattles, setSeats,
};
