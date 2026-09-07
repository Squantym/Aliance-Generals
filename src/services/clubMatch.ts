// ===================================================================
// src/services/clubMatch.ts — игры клуба ПРОТИВ ЖИВОГО ЧЕЛОВЕКА
//
// Две игры: «Радиоперехват» и «Снайперская дуэль». Общего у них больше,
// чем различий, поэтому очередь, сведение пары, часы хода и касса здесь
// одни на обе, а различается только разбор хода.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ. Остальные игры клуба живут в user.club:
// состояние принадлежит одному игроку, и сохранить его достаточно вместе
// с ним. Здесь состояние общее на двоих и живёт дольше, чем запрос:
// матч продолжается, даже когда оба закрыли вкладку. Такое состояние
// хранится в общем хранилище (db.load('clubmatch')), а не в игроке.
//
// ЧАСЫ. Ход не «начинается, когда игрок открыл страницу», а истекает по
// общему для обоих сроку. Дошли часы — за молчащего ходит жребий. Поэтому
// матч обязан двигаться и без запросов: tick() зовётся и из мирового
// тика, и на входе в любой вызов этого модуля.
//
// ДЕНЬГИ. Своей кассы у модуля нет и быть не должно: взносы, выплаты и
// суточный потолок — через club.kassa. Это единственный путь золота
// наружу, и новая игра не может завести себе второй.
// ===================================================================
import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import db = require('../core/db');
import type { User, Notices } from '../types';

const C = config.CLUB;

type Game = 'intercept' | 'sniper';

type QueueEntry = { game: Game; id: string; name: string; at: number; ip: string };

type Side = {
  id: string;
  name: string;
  // радиоперехват
  hide?: number | null;
  guess?: number[] | null;
  // снайперская дуэль
  acc?: number;
  sure?: boolean;          // следующий выстрел бьёт наверняка: соперник открылся
  act?: 'aim' | 'shoot' | null;
  auto?: boolean;          // последний ход сделан жребием, а не игроком
};

type Match = {
  id: string;
  game: Game;
  at: number;
  deadline: number;
  a: Side;
  b: Side;
  round?: number;
  turn?: number;
  log?: { round: number; turn: number; text: string }[];
  done?: { at: number; winner: string | null; reason: string } | null;
};

type Store = { queue: QueueEntry[]; matches: Match[]; seq: number };

function store(): Store {
  return db.load<Store>('clubmatch', { queue: [], matches: [], seq: 0 });
}

function kassa(): any { return require('./club').kassa; }

const RULES: Record<Game, { entry: number; win: number; cd: number; turnSec: number; title: string }> = {
  intercept: { entry: C.INTERCEPT_ENTRY, win: C.INTERCEPT_WIN, cd: C.INTERCEPT_CD_MIN,
               turnSec: C.INTERCEPT_MOVE_SEC, title: 'Радиоперехват' },
  sniper:    { entry: C.SNIPER_ENTRY, win: C.SNIPER_WIN, cd: C.SNIPER_CD_MIN,
               turnSec: C.SNIPER_TURN_SEC, title: 'Снайперская дуэль' },
};

function secLeft(at: number): number { return Math.max(0, Math.ceil((at - Date.now()) / 1000)); }
function userIp(user: any): string { return String(((user || {}).access || {}).lastIp || ''); }
function notify(id: string, kind: string, text: string, payload?: any): void {
  try { require('./notifications').push(id, kind, text, payload || {}); } catch (e) {}
}

// ── ОЧЕРЕДЬ ──────────────────────────────────────────────────────
function inQueue(st: Store, userId: string): QueueEntry | null {
  return st.queue.find((q) => q.id === userId) || null;
}
function myMatch(st: Store, userId: string): Match | null {
  return st.matches.find((m) => !m.done && (m.a.id === userId || m.b.id === userId)) || null;
}

// Встать в очередь. Взнос берётся здесь, а не при сведении пары: иначе
// к моменту, когда соперник найден, золота у игрока может уже не быть,
// и матч разваливался бы в момент старта — у обоих.
function enqueue(user: User, game: Game, notices: Notices) {
  if (!RULES[game]) throw new u.ApiError('Такой игры нет');
  const k = kassa();
  const c = k.clubState(user);
  k.beat(user, game);
  tick();
  const st = store();
  if (myMatch(st, user.id)) throw new u.ApiError('Вы уже в бою — доиграйте его');
  if (inQueue(st, user.id)) throw new u.ApiError('Вы уже в очереди');
  if (k.cdLeft(c, game) > 0) throw new u.ApiError('Перерыв после прошлого боя. Загляните позже.');

  k.takeStake(user, game, RULES[game].entry);
  st.queue.push({ game, id: user.id, name: user.name, at: Date.now(), ip: userIp(user) });
  db.save('clubmatch');
  notices.push(`⏳ Вы в очереди на «${RULES[game].title}». Ищем соперника.`);
  pairAll();
  return viewOf(user, game);
}

// Уйти из очереди — взнос возвращается целиком. Уйти из НАЧАВШЕГОСЯ боя
// нельзя: соперник уже заплатил и уже ждёт.
function leaveQueue(user: User, game: Game, notices: Notices) {
  kassa().beat(user, game);
  tick();
  const st = store();
  const idx = st.queue.findIndex((q) => q.id === user.id && q.game === game);
  if (idx < 0) throw new u.ApiError('Вас нет в очереди');
  st.queue.splice(idx, 1);
  db.save('clubmatch');
  const back = kassa().giveBack(user, game, RULES[game].entry);
  notices.push(`Вы вышли из очереди. Взнос возвращён: 🪙 ${back}`);
  return viewOf(user, game);
}

// Сведение пар. Два ограничения, и оба намеренные:
//   1) сам с собой — очевидно;
//   2) два аккаунта с одного адреса (QUEUE_SAME_IP=false). Это защита от
//      простейшего сговора: два окна на одном компьютере, где один
//      сливает другому. Если в очереди только такая пара, они просто
//      ждут — и по истечении срока получают взносы обратно.
function pairAll(): void {
  const st = store();
  let changed = false;
  for (const game of Object.keys(RULES) as Game[]) {
    for (;;) {
      const q = st.queue.filter((x) => x.game === game).sort((x, y) => x.at - y.at);
      if (q.length < 2) break;
      let pair: [QueueEntry, QueueEntry] | null = null;
      outer:
      for (let i = 0; i < q.length; i++) {
        for (let j = i + 1; j < q.length; j++) {
          if (q[i].id === q[j].id) continue;
          if (!C.QUEUE_SAME_IP && q[i].ip && q[j].ip && q[i].ip === q[j].ip) continue;
          pair = [q[i], q[j]];
          break outer;
        }
      }
      if (!pair) break;
      for (const e of pair) st.queue.splice(st.queue.indexOf(e), 1);
      st.matches.push(makeMatch(game, pair[0], pair[1], ++st.seq));
      changed = true;
    }
  }
  if (changed) db.save('clubmatch');
}

function makeMatch(game: Game, x: QueueEntry, y: QueueEntry, seq: number): Match {
  const now = Date.now();
  const m: Match = {
    id: game[0] + seq + '-' + (now % 100000),
    game, at: now,
    deadline: now + RULES[game].turnSec * 1000,
    a: { id: x.id, name: x.name },
    b: { id: y.id, name: y.name },
    done: null,
  };
  if (game === 'intercept') {
    m.a.hide = null; m.a.guess = null;
    m.b.hide = null; m.b.guess = null;
  } else {
    m.round = 1; m.turn = 1; m.log = [];
    m.a.acc = C.SNIPER_ACC_START; m.a.sure = false; m.a.act = null;
    m.b.acc = C.SNIPER_ACC_START; m.b.sure = false; m.b.act = null;
  }
  for (const s of [m.a, m.b]) {
    const foe = s === m.a ? m.b : m.a;
    notify(s.id, 'club_match',
      `Соперник найден: ${foe.name}. «${RULES[game].title}» — ход до истечения времени.`,
      { game, matchId: m.id });
  }
  return m;
}

// ── ЧАСЫ: матчи двигаются и без запросов ─────────────────────────
function tick(): void {
  const st = store();
  const now = Date.now();
  let changed = false;

  // Очередь: не дождался соперника — возврат взноса. Иначе взнос завис
  // бы в очереди навсегда, а игрок этого даже не увидел бы.
  const ttl = C.QUEUE_TTL_MIN * 60 * 1000;
  for (const q of st.queue.slice()) {
    if (now - q.at < ttl) continue;
    st.queue.splice(st.queue.indexOf(q), 1);
    const p = player.users()[q.id];
    if (p) {
      const back = kassa().giveBack(p, q.game, RULES[q.game].entry);
      db.markUser(p.id);
      notify(q.id, 'club_match',
        `Соперник на «${RULES[q.game].title}» не нашёлся. Взнос возвращён: 🪙 ${back}`, { gold: back });
    }
    changed = true;
  }

  for (const m of st.matches.slice()) {
    if (m.done) {
      // Доигранные держим ещё десять минут: игрок должен успеть увидеть
      // итог, даже если закрыл вкладку в момент развязки.
      if (now - m.done.at > 10 * 60 * 1000) { st.matches.splice(st.matches.indexOf(m), 1); changed = true; }
      continue;
    }
    if (now < m.deadline) continue;
    resolveTurn(m, true);
    changed = true;
  }
  if (changed) db.save('clubmatch');
}

// Готов ли ход у обеих сторон
function bothMoved(m: Match): boolean {
  return m.game === 'intercept'
    ? (m.a.guess != null && m.b.guess != null)
    : (m.a.act != null && m.b.act != null);
}

// Разбор хода. byClock=true — время вышло, за молчащих ходит жребий.
function resolveTurn(m: Match, byClock: boolean): void {
  if (m.done) return;
  if (!bothMoved(m) && !byClock) return;
  if (m.game === 'intercept') { interceptResolve(m); return; }
  sniperResolve(m);
}

// ── КАССА МАТЧА ──────────────────────────────────────────────────
// Победа/ничья одним местом: и золото, и кулдаун, и итог обоим на
// экран. Раньше это было размазано по двум играм, и ничья в одной из
// них однажды забыла бы вернуть взнос.
function finish(m: Match, winnerId: string | null, reason: string): void {
  const k = kassa();
  const rules = RULES[m.game];
  m.done = { at: Date.now(), winner: winnerId, reason };

  for (const s of [m.a, m.b]) {
    const p = player.users()[s.id];
    if (!p) continue;
    const c = k.clubState(p);
    const foe = s === m.a ? m.b : m.a;
    // Тост о выигрыше показываем тому, кто нажал кнопку прямо сейчас;
    // второй узнаёт из уведомления — он может быть вообще офлайн.
    const mine: Notices = (CALLER === s.id && CALLER_NOTICES) ? CALLER_NOTICES : [];
    let reward = 0;
    if (winnerId === null) {
      // Ничья — взносы назад обоим. Победителя нет, и клуб ничего не
      // печатает: сколько внесли, столько и разошлось.
      reward = k.giveBack(p, m.game, rules.entry);
    } else if (winnerId === s.id) {
      reward = k.payout(p, m.game, rules.win, mine);
    }
    k.setCd(c, m.game, rules.cd);
    (c as any)[m.game + 'Last'] = {
      at: Date.now(), foeName: foe.name, reason,
      result: winnerId === null ? 'draw' : (winnerId === s.id ? 'win' : 'lose'),
      reward, entry: rules.entry, log: m.log ? m.log.slice(-12) : null,
      hide: m.game === 'intercept' ? { mine: s.hide, foe: foe.hide, guess: s.guess } : null,
    };
    db.markUser(p.id);
    const head = winnerId === null ? 'Ничья' : (winnerId === s.id ? 'Победа' : 'Поражение');
    notify(s.id, 'club_match',
      `«${rules.title}» против ${foe.name}: ${head.toLowerCase()}. ${reason}` + (reward ? ` +🪙 ${reward}` : ''),
      { game: m.game, gold: reward });
  }
}

// Чей вызов сейчас идёт — чтобы тост о выигрыше показался тому, кто
// нажал кнопку, а второй получил уведомление. Матч может завершиться и
// без вызова вообще — по часам, из мирового тика: тогда CALLER пуст, и
// оба получают только уведомление.
let CALLER: string | null = null;
let CALLER_NOTICES: Notices | null = null;

// ===================================================================
// РАДИОПЕРЕХВАТ
// ===================================================================
function interceptView(user: User) {
  tick();
  const k = kassa();
  const c = k.clubState(user);
  const st = store();
  const base = {
    entry: C.INTERCEPT_ENTRY, win: C.INTERCEPT_WIN,
    cells: C.INTERCEPT_CELLS, guesses: C.INTERCEPT_GUESSES,
    moveSec: C.INTERCEPT_MOVE_SEC, cdMin: C.INTERCEPT_CD_MIN,
    ttlMin: C.QUEUE_TTL_MIN,
    waiting: st.queue.filter((q) => q.game === 'intercept').length,
    last: c.interceptLast || null,
  };
  const m = myMatch(st, user.id);
  if (m && m.game === 'intercept') {
    const me = m.a.id === user.id ? m.a : m.b;
    const foe = m.a.id === user.id ? m.b : m.a;
    return Object.assign(base, {
      state: 'match',
      match: { id: m.id, foeName: foe.name, deadlineSec: secLeft(m.deadline), moved: me.guess != null },
    });
  }
  const q = inQueue(st, user.id);
  if (q && q.game === 'intercept') {
    return Object.assign(base, {
      state: 'queue',
      queue: { waitedSec: Math.floor((Date.now() - q.at) / 1000), ttlSec: secLeft(q.at + C.QUEUE_TTL_MIN * 60000) },
    });
  }
  const left = k.cdLeft(c, 'intercept');
  return Object.assign(base, {
    state: left > 0 ? 'cooldown' : 'ready', cooldownSec: left,
    busy: !!q || !!myMatch(st, user.id),
  });
}

// Ход: где прячем свой штаб и куда даём наводки — одной отправкой.
// Разбивать на два шага было бы честнее по духу, но дороже по времени:
// каждый шаг это ещё три минуты ожидания молчащего соперника.
function interceptMove(user: User, hide: any, guess: any, notices: Notices) {
  const k = kassa();
  k.beat(user, 'intercept');
  tick();
  const st = store();
  const m = myMatch(st, user.id);
  if (!m || m.game !== 'intercept') throw new u.ApiError('Бой не идёт');
  const me = m.a.id === user.id ? m.a : m.b;
  if (me.guess != null) throw new u.ApiError('Ход уже сделан — ждём соперника');

  const cells = C.INTERCEPT_CELLS;
  const h = u.toInt(hide, -1);
  if (h < 0 || h >= cells) throw new u.ApiError('Укажите, где прячете штаб');
  const g = Array.isArray(guess) ? guess.map((x: any) => u.toInt(x, -1)) : [];
  if (g.length !== C.INTERCEPT_GUESSES) throw new u.ApiError(`Наводок должно быть ${C.INTERCEPT_GUESSES}`);
  if (g.some((x) => x < 0 || x >= cells)) throw new u.ApiError('Такого квадрата нет');
  if (new Set(g).size !== g.length) throw new u.ApiError('Наводки должны быть в разные квадраты');

  me.hide = h; me.guess = g; me.auto = false;
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  CALLER = user.id; CALLER_NOTICES = notices;
  try {
    if (bothMoved(m)) resolveTurn(m, false);
    db.save('clubmatch');
  } finally { CALLER = null; CALLER_NOTICES = null; }
  return interceptView(user);
}

function interceptAuto(s: Side): void {
  const cells = C.INTERCEPT_CELLS;
  const all: number[] = [];
  for (let i = 0; i < cells; i++) all.push(i);
  u.shuffle(all);
  s.hide = all[0];
  s.guess = all.slice(1, 1 + C.INTERCEPT_GUESSES);
  s.auto = true;
}

function interceptResolve(m: Match): void {
  for (const s of [m.a, m.b]) if (s.guess == null) interceptAuto(s);
  const aPos = (m.b.guess as number[]).indexOf(m.a.hide as number);   // где A нашли
  const bPos = (m.a.guess as number[]).indexOf(m.b.hide as number);   // где B нашли
  const aFound = bPos >= 0;    // A нашёл штаб B
  const bFound = aPos >= 0;

  let winner: string | null = null;
  let reason: string;
  if (aFound && !bFound) { winner = m.a.id; reason = `${m.a.name} нашёл штаб первым.`; }
  else if (bFound && !aFound) { winner = m.b.id; reason = `${m.b.name} нашёл штаб первым.`; }
  else if (aFound && bFound) {
    // Нашли оба — считается, кто попал более ранней наводкой. Совпали и
    // наводки — ничья: разделять тут больше нечем, кроме монетки, а
    // монетка в игре про решение лишняя.
    if (bPos < aPos) { winner = m.a.id; reason = 'Оба нашли, но перехват был раньше.'; }
    else if (aPos < bPos) { winner = m.b.id; reason = 'Оба нашли, но перехват был раньше.'; }
    else reason = 'Штабы нашли друг друга одновременно.';
  } else {
    reason = 'Ни один штаб не найден.';
  }
  finish(m, winner, reason);
}

// ===================================================================
// СНАЙПЕРСКАЯ ДУЭЛЬ
// ===================================================================
function aimLabel(turn: number): string {
  const steps: string[] = C.SNIPER_AIM_STEPS;
  return steps[Math.min(turn, steps.length) - 1] || steps[steps.length - 1];
}
function accCap(): number { return C.SNIPER_ACC_START + C.SNIPER_ACC_STEP * (C.SNIPER_TURNS - 1); }

function sniperView(user: User) {
  tick();
  const k = kassa();
  const c = k.clubState(user);
  const st = store();
  const base = {
    entry: C.SNIPER_ENTRY, win: C.SNIPER_WIN, turns: C.SNIPER_TURNS,
    turnSec: C.SNIPER_TURN_SEC, accStart: C.SNIPER_ACC_START, accStep: C.SNIPER_ACC_STEP,
    accMax: accCap(), roundsMax: C.SNIPER_ROUNDS_MAX, cdMin: C.SNIPER_CD_MIN,
    ttlMin: C.QUEUE_TTL_MIN,
    waiting: st.queue.filter((q) => q.game === 'sniper').length,
    last: c.sniperLast || null,
  };
  const m = myMatch(st, user.id);
  if (m && m.game === 'sniper') {
    const me = m.a.id === user.id ? m.a : m.b;
    const foe = m.a.id === user.id ? m.b : m.a;
    const lastTurn = (m.turn as number) >= C.SNIPER_TURNS;
    return Object.assign(base, {
      state: 'match',
      match: {
        id: m.id, foeName: foe.name, round: m.round, turn: m.turn,
        deadlineSec: secLeft(m.deadline),
        myAcc: me.sure ? 100 : me.acc, foeAcc: foe.sure ? 100 : foe.acc,
        sure: !!me.sure, acted: me.act || null,
        canAim: !lastTurn, aimLabel: aimLabel(m.turn as number),
        log: (m.log || []).slice(-8),
      },
    });
  }
  const q = inQueue(st, user.id);
  if (q && q.game === 'sniper') {
    return Object.assign(base, {
      state: 'queue',
      queue: { waitedSec: Math.floor((Date.now() - q.at) / 1000), ttlSec: secLeft(q.at + C.QUEUE_TTL_MIN * 60000) },
    });
  }
  const left = k.cdLeft(c, 'sniper');
  return Object.assign(base, {
    state: left > 0 ? 'cooldown' : 'ready', cooldownSec: left,
    busy: !!q || !!m,
  });
}

function sniperAct(user: User, action: any, notices: Notices) {
  const k = kassa();
  k.beat(user, 'sniper');
  tick();
  const st = store();
  const m = myMatch(st, user.id);
  if (!m || m.game !== 'sniper') throw new u.ApiError('Дуэль не идёт');
  const me = m.a.id === user.id ? m.a : m.b;
  if (me.act) throw new u.ApiError('Ход уже сделан — ждём соперника');
  let act = String(action || '');
  if (act !== 'aim' && act !== 'shoot') throw new u.ApiError('Прицелиться или выстрелить');
  // На последнем ходу прицеливаться уже некуда: либо выстрел, либо
  // дуэль кончится ничем.
  if (act === 'aim' && (m.turn as number) >= C.SNIPER_TURNS) act = 'shoot';

  me.act = act as 'aim' | 'shoot';
  me.auto = false;
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  CALLER = user.id; CALLER_NOTICES = notices;
  try {
    if (bothMoved(m)) resolveTurn(m, false);
    db.save('clubmatch');
  } finally { CALLER = null; CALLER_NOTICES = null; }
  return sniperView(user);
}

function sniperLog(m: Match, text: string): void {
  (m.log = m.log || []).push({ round: m.round as number, turn: m.turn as number, text });
  if (m.log.length > 40) m.log.shift();
}

function sniperResolve(m: Match): void {
  const lastTurn = (m.turn as number) >= C.SNIPER_TURNS;
  // Молчащий прицеливается, а на последнем ходу стреляет: это самое
  // безобидное действие из возможных. Пропускать ход нельзя — тогда
  // отсутствие стало бы стратегией.
  for (const s of [m.a, m.b]) if (!s.act) { s.act = lastTurn ? 'shoot' : 'aim'; s.auto = true; }

  const shotA = m.a.act === 'shoot', shotB = m.b.act === 'shoot';
  const accOf = (s: Side) => (s.sure ? 100 : (s.acc as number));
  const hitA = shotA && u.rnd(1, 100) <= accOf(m.a);
  const hitB = shotB && u.rnd(1, 100) <= accOf(m.b);

  if (shotA && shotB) {
    if (hitA && hitB) {
      sniperLog(m, 'Выстрелы прозвучали одновременно — оба попали.');
      finish(m, null, 'Оба выстрела достигли цели: победителя нет, взносы возвращены.');
      return;
    }
    if (hitA) { sniperLog(m, `${m.a.name} успел первым.`); finish(m, m.a.id, `${m.a.name} снял цель выстрелом.`); return; }
    if (hitB) { sniperLog(m, `${m.b.name} успел первым.`); finish(m, m.b.id, `${m.b.name} снял цель выстрелом.`); return; }
    // Промахнулись оба — обе позиции выданы, дуэль начинается заново
    sniperLog(m, 'Оба промахнулись и выдали себя. Позиции меняются, всё сначала.');
    nextRound(m);
    return;
  }

  if (shotA || shotB) {
    const sh = shotA ? m.a : m.b;
    const other = shotA ? m.b : m.a;
    const hit = shotA ? hitA : hitB;
    if (hit) {
      sniperLog(m, `${sh.name} выстрелил и попал.`);
      finish(m, sh.id, `${sh.name} снял цель выстрелом.`);
      return;
    }
    sniperLog(m, `${sh.name} выстрелил и промахнулся — вспышка выдала позицию.`);
    sh.acc = C.SNIPER_ACC_START;      // позиция сменена, прицел сбит
    sh.sure = false;
    other.sure = true;                 // следующий выстрел — наверняка
    if (other.act === 'aim') other.acc = Math.min(accCap(), (other.acc as number) + C.SNIPER_ACC_STEP);
    nextTurn(m);
    return;
  }

  // Прицеливались оба
  for (const s of [m.a, m.b]) s.acc = Math.min(accCap(), (s.acc as number) + C.SNIPER_ACC_STEP);
  sniperLog(m, 'Оба выжидают.');
  nextTurn(m);
}

function nextTurn(m: Match): void {
  m.a.act = null; m.b.act = null;
  m.turn = (m.turn as number) + 1;
  if ((m.turn as number) > C.SNIPER_TURNS) { nextRound(m); return; }
  m.deadline = Date.now() + C.SNIPER_TURN_SEC * 1000;
}

function nextRound(m: Match): void {
  m.round = (m.round as number) + 1;
  if ((m.round as number) > C.SNIPER_ROUNDS_MAX) {
    finish(m, null, 'Дуэль ничем не кончилась: взносы возвращены.');
    return;
  }
  m.turn = 1;
  m.a.act = null; m.b.act = null;
  m.a.acc = C.SNIPER_ACC_START; m.b.acc = C.SNIPER_ACC_START;
  m.a.sure = false; m.b.sure = false;
  m.deadline = Date.now() + C.SNIPER_TURN_SEC * 1000;
}

// ===================================================================
// ПОЛОСКА СВЕРХУ: игрок в очереди или в бою должен узнать об этом с
// любого экрана, а не только открыв клуб. Ответ намеренно крошечный —
// его опрашивают раз в несколько секунд.
// ===================================================================
function liveView(user: User) {
  tick();
  const st = store();
  const m = myMatch(st, user.id);
  if (m) {
    const me = m.a.id === user.id ? m.a : m.b;
    const foe = m.a.id === user.id ? m.b : m.a;
    const moved = m.game === 'intercept' ? me.guess != null : me.act != null;
    return {
      kind: 'match', game: m.game, title: RULES[m.game].title,
      foeName: foe.name, deadlineSec: secLeft(m.deadline), moved,
      turn: m.turn || null, round: m.round || null,
    };
  }
  const q = inQueue(st, user.id);
  if (q) {
    return {
      kind: 'queue', game: q.game, title: RULES[q.game].title,
      waitedSec: Math.floor((Date.now() - q.at) / 1000),
      ttlSec: secLeft(q.at + C.QUEUE_TTL_MIN * 60000),
    };
  }
  return { kind: 'none' };
}

// Для тестов и админки: сколько народу ждёт и сколько боёв идёт
function stateSummary() {
  const st = store();
  return { queue: st.queue.length, matches: st.matches.filter((m) => !m.done).length };
}

function viewOf(user: User, game: Game) {
  return game === 'intercept' ? interceptView(user) : sniperView(user);
}

export = {
  tick,
  enqueue, leaveQueue,
  interceptView, interceptMove,
  sniperView, sniperAct,
  liveView, stateSummary,
};
