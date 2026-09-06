// ═══════════════════════════════════════════════════════════════════
// src/services/lottery.ts — «Военный займ» (лотерея)
//
// Два тиража в сутки по 12 часов: розыгрыш в 12:00 и в 00:00 по Москве.
// Билет стоит фиксированное золото, на тираж выпускается ограниченное
// число билетов НА ВСЕХ игроков.
//
// Правило одно, и оно должно быть понятно без объяснений:
//   шанс игрока = его билеты ÷ все проданные билеты,
//   банк = все проданные билеты × цена билета,
//   победитель один и забирает банк целиком.
//
// Отсюда следствие, которое стоит понимать заранее: игра НЕ СОЗДАЁТ
// золота. Сколько игроки внесли, ровно столько один из них и получил.
// Купивший все проданные билеты выигрывает наверняка и просто возвращает
// своё. Поэтому суточный потолок клуба (CLUB.DAILY_GOLD_CAP) на выигрыш
// НЕ распространяется: обрезав выигрыш по потолку, мы бы уничтожали
// чужие взносы — золото исчезало бы из игры, и экономика перестала бы
// сходиться.
//
// Что здесь легко сломать и почему сделано именно так:
//
//  1. ЗОЛОТО СПИСЫВАЕТСЯ ПРИ ПОКУПКЕ, а не при розыгрыше. Иначе билет
//     можно купить, потратить золото на другое, а к розыгрышу прийти
//     пустым — и банк не сойдётся с обещанной суммой.
//  2. РОЗЫГРЫШ ИДЁТ ИЗ ТИКА, а не по заходу игрока. Тираж обязан
//     разыграться, даже если в 12:00 в игре нет ни одного человека.
//     Пропущенный из-за перезапуска тираж разыгрывается на первом же
//     тике после — по записанным участникам, задним числом.
//  3. ПОБЕДИТЕЛЬ ВЫБИРАЕТСЯ ПО БИЛЕТАМ, а не по игрокам: два билета —
//     вдвое больший шанс, иначе покупка второго билета бессмысленна.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import config = require('../../config/gameConfig');
import player = require('./player');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

const L = config.LOTTERY;
const HOUR_MS = 3600 * 1000;

type Draw = {
  id: string;
  openAt: number;
  drawAt: number;
  tickets: Record<string, number>;      // сколько билетов у какого игрока
  names: Record<string, string>;        // позывной на момент покупки
  sold: number;
  settled?: boolean;
  winnerId?: string;
  winnerName?: string;
  pot?: number;
  winnerTickets?: number;
};

type Store = { current?: Draw; history: Draw[] };

function store(): Store {
  return db.load<Store>('lottery', { history: [] });
}

// ── Границы тиража ────────────────────────────────────────────────
// Сутки берём общие для игры (u.dayStart — московская полночь), а внутри
// суток режем по часам из конфига. Так тираж не разъезжается с суточными
// сбросами остальной игры.
function windowFor(ts: number): { id: string; openAt: number; drawAt: number } {
  const day = u.dayStart(ts);
  const hours: number[] = (L.DRAW_HOURS || [0, 12]).slice().sort((a: number, b: number) => a - b);
  // Розыгрыш в час H закрывает окно, начавшееся в предыдущий час из
  // списка. Для [0, 12] это «00:00→12:00» и «12:00→00:00 следующих».
  for (let i = 0; i < hours.length; i++) {
    const openAt = day + hours[i] * HOUR_MS;
    const drawAt = i + 1 < hours.length
      ? day + hours[i + 1] * HOUR_MS
      : day + 24 * HOUR_MS + hours[0] * HOUR_MS;
    if (ts >= openAt && ts < drawAt) {
      return { id: u.dayKey(openAt) + '-' + (i + 1), openAt, drawAt };
    }
  }
  // Момент раньше первого часа суток принадлежит последнему окну
  // ПРОШЛЫХ суток.
  const prevDay = day - 24 * HOUR_MS;
  const last = hours.length - 1;
  const openAt = prevDay + hours[last] * HOUR_MS;
  return { id: u.dayKey(openAt) + '-' + hours.length, openAt, drawAt: day + hours[0] * HOUR_MS };
}

function blankDraw(w: { id: string; openAt: number; drawAt: number }): Draw {
  return { id: w.id, openAt: w.openAt, drawAt: w.drawAt, tickets: {}, names: {}, sold: 0 };
}

// Текущий тираж. Просроченный здесь НЕ разыгрывается — этим занимается
// tick(), чтобы розыгрыш происходил ровно один раз и в одном месте.
function current(): Draw {
  const s = store();
  const w = windowFor(Date.now());
  if (!s.current || s.current.id !== w.id) {
    if (s.current && !s.current.settled) settleDraw(s, s.current);
    s.current = blankDraw(w);
    db.save('lottery');
  }
  return s.current;
}

// ── Что видит игрок ───────────────────────────────────────────────
function view(user: User) {
  const s = store();
  const d = current();
  const mine = d.tickets[user.id] || 0;
  const last = (s.history || [])[0] || null;
  return {
    drawId: d.id,
    ticketGold: L.TICKET_GOLD,
    maxTickets: L.MAX_TICKETS,
    maxPerPlayer: L.MAX_PER_PLAYER,
    sold: d.sold,
    left: Math.max(0, L.MAX_TICKETS - d.sold),
    // Банк виден всем и растёт на глазах — это и есть главный экран игры
    pot: d.sold * L.TICKET_GOLD,
    myTickets: mine,
    // Шанс в процентах. Пока не продано ни одного билета, шанса нет ни у
    // кого — показываем 0, а не деление на ноль.
    myChancePct: d.sold > 0 ? Math.round((mine / d.sold) * 10000) / 100 : 0,
    myLeft: Math.max(0, L.MAX_PER_PLAYER - mine),
    players: Object.keys(d.tickets).length,
    drawAt: d.drawAt,
    secondsLeft: Math.max(0, Math.round((d.drawAt - Date.now()) / 1000)),
    last: last ? {
      id: last.id, winnerName: last.winnerName || null,
      pot: last.pot || 0, sold: last.sold, winnerTickets: last.winnerTickets || 0,
    } : null,
  };
}

// ── Покупка билетов ───────────────────────────────────────────────
function buy(user: User, count: any, notices: Notices) {
  const n = u.clamp(u.toInt(count, 1), 1, L.MAX_TICKETS);
  const d = current();

  const mine = d.tickets[user.id] || 0;
  if (mine + n > L.MAX_PER_PLAYER) {
    throw new u.ApiError('Больше ' + L.MAX_PER_PLAYER + ' билетов на тираж в одни руки. У вас уже ' + mine + '.');
  }
  if (d.sold + n > L.MAX_TICKETS) {
    throw new u.ApiError('Осталось билетов: ' + Math.max(0, L.MAX_TICKETS - d.sold));
  }
  const price = n * L.TICKET_GOLD;
  if ((user.gold || 0) < price) {
    throw new u.ApiError('Нужно 🪙 ' + price + ', у вас ' + (user.gold || 0));
  }

  // Списываем сразу: см. пункт 1 в шапке файла
  player.addGold(user, -price, 'lottery_ticket');
  d.tickets[user.id] = mine + n;
  d.names[user.id] = user.name;
  d.sold += n;
  db.save('lottery');
  db.markUser(user.id);

  try {
    auditLog.record({
      userId: user.id, userName: user.name, path: '/system/lottery-buy',
      body: { drawId: d.id, tickets: n, gold: price },
    });
  } catch (e) {}

  notices.push('🎟 Куплено билетов: ' + n + ' за 🪙 ' + price
    + '. Ваш шанс — ' + d.tickets[user.id] + ' из ' + d.sold + '.');
  return view(user);
}

// ── Розыгрыш ──────────────────────────────────────────────────────
// Победитель выбирается по БИЛЕТАМ: раскладываем проданные билеты в
// линию и бросаем точку. Два билета — вдвое больший шанс.
function pickWinner(d: Draw): string | null {
  if (d.sold <= 0) return null;
  let roll = u.rnd(1, d.sold);
  for (const [id, cnt] of Object.entries(d.tickets)) {
    roll -= cnt;
    if (roll <= 0) return id;
  }
  return null;   // сюда не дойти: сумма билетов равна d.sold
}

function settleDraw(s: Store, d: Draw): void {
  if (d.settled) return;
  d.settled = true;
  d.pot = d.sold * L.TICKET_GOLD;

  const winnerId = pickWinner(d);
  if (winnerId) {
    d.winnerId = winnerId;
    d.winnerName = d.names[winnerId] || '—';
    d.winnerTickets = d.tickets[winnerId] || 0;
    const users = player.users();
    const w = users[winnerId];
    if (w) {
      // Банк выдаётся целиком и в обход потолка клуба: это не эмиссия,
      // а те же взносы, что игроки внесли часом раньше.
      player.addGold(w, d.pot, 'lottery_win');
      db.markUser(w.id);
      try {
        auditLog.record({
          userId: w.id, userName: w.name, path: '/system/lottery-win',
          body: { drawId: d.id, gold: d.pot, tickets: d.winnerTickets, sold: d.sold },
        });
        require('./notifications').push(w.id, 'lottery_won',
          '🎉 Военный займ: выигрыш 🪙 ' + d.pot + '! Ваших билетов '
          + d.winnerTickets + ' из ' + d.sold + '.', { drawId: d.id });
      } catch (e) {}
    }
    // Остальным — короткое уведомление, что тираж прошёл мимо. Молчание
    // выглядело бы так, будто билет потерялся.
    for (const id of Object.keys(d.tickets)) {
      if (id === winnerId) continue;
      try {
        require('./notifications').push(id, 'lottery_lost',
          '🎟 Военный займ разыгран: победил ' + d.winnerName
          + '. Банк был 🪙 ' + d.pot + '.', { drawId: d.id });
      } catch (e) {}
    }
  }

  s.history = [d].concat(s.history || []).slice(0, 30);
  db.save('lottery');
  db.save('users');
}

// Вызывается из игрового тика. Разыгрывает всё, чему пришло время, —
// включая тиражи, пропущенные из-за остановки сервера.
function tick(): void {
  const s = store();
  const now = Date.now();
  if (s.current && !s.current.settled && now >= s.current.drawAt) {
    settleDraw(s, s.current);
    s.current = blankDraw(windowFor(now));
    db.save('lottery');
  } else {
    current();   // заодно откроет тираж, если его ещё нет
  }
}

// Для панели: последние тиражи с итогами
function history(limit = 10) {
  const s = store();
  return (s.history || []).slice(0, u.clamp(u.toInt(limit, 10), 1, 30)).map((d) => ({
    id: d.id, sold: d.sold, pot: d.pot || 0,
    winnerName: d.winnerName || null, winnerTickets: d.winnerTickets || 0,
    players: Object.keys(d.tickets || {}).length,
    drawAt: d.drawAt,
  }));
}

export = { view, buy, tick, history };
