// ===================================================================
// src/services/mines.ts — раздел «Шахты» (новая система)
//
// Механика (кратко):
//   1. Участок (plot) покупается за ЗОЛОТО, разово. 1-й — 600, каждый
//      следующий ×2. До 5 участков на игрока. Участок остаётся навсегда.
//   2. На участке строится шахта за ДЕНЬГИ (= 500 × цены самой дорогой
//      техники на уровне). Стройка 3 суток. В шахте 200-300 золота, 30 спусков.
//   3. Спуск 10-90 мин (шаг 10). Лимит 90 мин/сутки У КАЖДОЙ шахты (сброс
//      00:00 МСК). Любой спуск = 1 попытка. Минуты и попытка списываются сразу.
//   4. Золото — ДВА независимых броска: «найти» (шанс по времени) и, если
//      нашли, «добыть» (60-90% по времени). Деньги дают ВСЕГДА; если золото
//      не получено — денег в 2-5 раз больше.
//   5. Террорист нападает с шансом 50% (в середине или в конце спуска). Это
//      реальный бой (HP террориста = половина HP игрока; тратятся боеприпасы
//      и энергия из текущих запасов). Отбил — золото цело + жетоны и деньги.
//      Не отбил за 10 мин или проиграл — золото и деньги за спуск сгорают.
//   6. Обвал по достижении 30 спусков ИЛИ истощении запаса. Авто-расчистка
//      24 часа, затем перестройка шахты за деньги (участок остаётся).
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import db = require('../core/db');
import discounts = require('./discounts');
import player = require('./player');
import notif = require('./notifications');
import type { User, Notices } from '../types';

const M = config.MINE;

function plots(user: User): any[] {
  if (!user.mines) user.mines = [];
  return user.mines;
}

// «День» по Москве (UTC+3): сдвигаем время на +3ч и берём календарную дату.
function todayMskKey(): string {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function ensureDaily(mine: any): void {
  const today = todayMskKey();
  if (mine.dailyKey !== today) { mine.dailyKey = today; mine.minutesUsedToday = 0; }
}

// Цена следующего участка (золото): 600, 1200, 2400 … по числу уже купленных.
function nextPlotGold(user: User): number {
  const owned = plots(user).length;
  const base = Math.round(M.PLOT_FIRST_GOLD * Math.pow(M.PLOT_MULT, owned));
  return discounts.applyTo('mine', base);
}

// Стоимость постройки шахты (деньги) = 500 × цены самой дорогой техники на уровне.
function buildDollars(user: User): number {
  const base = M.BUILD_UNITS * config.maxUnitPriceAtLevel(user.level);
  return discounts.applyTo('mine', Math.round(base));
}

// Базовые деньги за спуск = цена самой дорогой техники на уровне × (1..10).
function moneyBase(user: User): number {
  return Math.round(config.maxUnitPriceAtLevel(user.level) * u.rnd(M.MONEY_UNITS_MIN, M.MONEY_UNITS_MAX));
}

function rollReserve(): number { return u.rnd(M.GOLD_MIN, M.GOLD_MAX); }

// Авто-сброс старых шахт при смене версии схемы (обнуляет всё у игрока).
function resetIfOldSchema(user: User): void {
  if ((user as any).minesSchemaV !== M.SCHEMA_V) {
    user.mines = [];
    (user as any).minesBuiltTotal = 0;
    (user as any).minesSchemaV = M.SCHEMA_V;
  }
}

// ---------- Представление одной шахты ----------
function mineView(mine: any) {
  ensureDaily(mine);
  const now = Date.now();
  const built = mine.status !== 'empty' && mine.status !== 'building';
  const collapsedReadyAt = mine.status === 'collapsed' ? mine.collapsedAt + M.COLLAPSE_CLEAR_MS : null;
  const terror = mine.terror && !mine.terror.resolved && now >= mine.terror.at ? {
    active: true,
    deadline: mine.terror.deadline,
    remainingSec: Math.max(0, Math.ceil((mine.terror.deadline - now) / 1000)),
  } : null;
  return {
    id: mine.id,
    status: mine.status, // empty | building | idle | descending | collapsed
    goldTotal: built ? mine.goldTotal : null,
    goldLeft: built ? mine.goldLeft : null,
    descentsLeft: built ? mine.descentsLeft : null,
    maxDescents: M.MAX_DESCENTS,
    buildRemainingSec: mine.status === 'building' ? Math.max(0, Math.ceil((mine.buildFinishesAt - now) / 1000)) : 0,
    minutesUsedToday: mine.minutesUsedToday || 0,
    minutesLeftToday: Math.max(0, M.DAILY_LIMIT_MINUTES - (mine.minutesUsedToday || 0)),
    dailyLimit: M.DAILY_LIMIT_MINUTES,
    descent: mine.status === 'descending' ? {
      minutes: mine.descentMinutes,
      remainingSec: Math.max(0, Math.ceil((mine.descentEndsAt - now) / 1000)),
      timeUp: now >= mine.descentEndsAt,
      terror,
    } : null,
    collapsedReadyAt,
    collapsedRemainingSec: collapsedReadyAt ? Math.max(0, Math.ceil((collapsedReadyAt - now) / 1000)) : 0,
    canRebuild: mine.status === 'collapsed' && collapsedReadyAt !== null && now >= collapsedReadyAt,
    result: mine.pendingResult || null,
  };
}

function stepRange(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max; v += step) out.push(v);
  return out;
}

function view(user: User) {
  resetIfOldSchema(user);
  refreshAll(user);
  return {
    mines: plots(user).map(mineView),
    plotCount: plots(user).length,
    maxPlots: M.MAX_PLOTS,
    nextPlotGold: nextPlotGold(user),
    buildDollars: buildDollars(user),
    minutesOptions: stepRange(M.DESCENT_MIN_MINUTES, M.DESCENT_MAX_MINUTES, M.DESCENT_STEP_MINUTES),
    unlockLevel: config.PRODUCTION_UNLOCK_LEVEL,
  };
}

// ---------- Купить участок (золото) ----------
function buyPlot(user: User, notices: Notices) {
  resetIfOldSchema(user);
  if (user.level < config.PRODUCTION_UNLOCK_LEVEL) throw new u.ApiError(`Шахты доступны с ${config.PRODUCTION_UNLOCK_LEVEL} уровня`);
  if (plots(user).length >= M.MAX_PLOTS) throw new u.ApiError(`Максимум ${M.MAX_PLOTS} участков`);
  const cost = nextPlotGold(user);
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  user.gold -= cost;
  const plot = { id: u.uid(10), status: 'empty', dailyKey: todayMskKey(), minutesUsedToday: 0 };
  plots(user).push(plot);
  db.save('users');
  notices.push(`📍 Участок куплен за 🪙 ${cost}. Теперь постройте на нём шахту за деньги.`);
  return mineView(plot);
}

// ---------- Построить шахту на участке (деньги, 3 дня) ----------
function build(user: User, plotId: string, notices: Notices) {
  resetIfOldSchema(user);
  const mine = plots(user).find((m) => m.id === plotId);
  if (!mine) throw new u.ApiError('Участок не найден');
  const cleared = mine.status === 'collapsed' && Date.now() >= mine.collapsedAt + M.COLLAPSE_CLEAR_MS;
  if (mine.status !== 'empty' && !cleared) throw new u.ApiError('На этом участке нельзя строить шахту сейчас');

  const cost = buildDollars(user);
  if (user.dollars < cost) throw new u.ApiError(`Не хватает денег (нужно $${u.fmt(cost)})`);
  user.dollars -= cost;
  (user as any).minesBuiltTotal = ((user as any).minesBuiltTotal || 0) + 1;

  mine.status = 'building';
  mine.buildFinishesAt = Date.now() + M.BUILD_TIME_MS;
  mine.goldTotal = rollReserve();
  mine.goldLeft = mine.goldTotal;
  mine.descentsLeft = M.MAX_DESCENTS;
  mine.collapsedAt = null;
  mine.pendingResult = null;
  mine.terror = null;
  mine.dailyKey = todayMskKey();
  mine.minutesUsedToday = 0;
  db.save('users');
  const days = Math.round(M.BUILD_TIME_MS / (24 * 3600 * 1000));
  notices.push(`⛏ Шахта строится за $${u.fmt(cost)}. Готовность через ${days} суток. Запас золота откроется после постройки.`);
  return mineView(mine);
}

// rebuild — то же, что build (перестройка после обвала за деньги)
function rebuild(user: User, plotId: string, notices: Notices) {
  return build(user, plotId, notices);
}

// ---------- Спуск ----------
function descend(user: User, plotId: string, minutes: number, notices: Notices) {
  resetIfOldSchema(user);
  refreshAll(user);
  const mine = plots(user).find((m) => m.id === plotId);
  if (!mine) throw new u.ApiError('Шахта не найдена');
  if (mine.status === 'empty') throw new u.ApiError('Сначала постройте шахту на участке');
  if (mine.status === 'building') throw new u.ApiError('Шахта ещё строится');
  if (mine.status === 'collapsed') throw new u.ApiError('Шахта обрушилась — дождитесь расчистки и перестройте');
  if (mine.status === 'descending') throw new u.ApiError('Шахтёры уже внизу');
  if (mine.pendingResult) throw new u.ApiError('Сначала закройте окно с результатом прошлого спуска');
  if (mine.descentsLeft <= 0) throw new u.ApiError('В этой шахте больше нет спусков');

  minutes = u.toInt(minutes);
  const row = M.DESCENT_TABLE[minutes];
  if (!row || minutes < M.DESCENT_MIN_MINUTES || minutes > M.DESCENT_MAX_MINUTES || minutes % M.DESCENT_STEP_MINUTES !== 0) {
    throw new u.ApiError(`Время спуска: ${M.DESCENT_MIN_MINUTES}-${M.DESCENT_MAX_MINUTES} мин, шагом ${M.DESCENT_STEP_MINUTES}`);
  }
  ensureDaily(mine);
  if (mine.minutesUsedToday + minutes > M.DAILY_LIMIT_MINUTES) {
    throw new u.ApiError(`Дневной лимит этой шахты: доступно ещё ${M.DAILY_LIMIT_MINUTES - mine.minutesUsedToday} мин.`);
  }

  const now = Date.now();
  // Списываем минуты и попытку СРАЗУ
  mine.minutesUsedToday += minutes;
  mine.descentsLeft -= 1;
  mine.status = 'descending';
  mine.descentMinutes = minutes;
  mine.descentEndsAt = now + minutes * 60 * 1000;
  mine.pendingResult = null;

  // Бросок нападения террориста (50%). Время атаки — середина или конец спуска.
  mine.terror = null;
  if (Math.random() < M.TERRORIST_CHANCE) {
    const atEnd = Math.random() < 0.5;
    const at = atEnd ? mine.descentEndsAt : now + (minutes * 60 * 1000) / 2;
    mine.terror = { at, deadline: at + M.TERRORIST_REACT_MS, timing: atEnd ? 'end' : 'mid', repelled: false, resolved: false, failed: false, notified: false };
  }

  db.save('users');
  notices.push(`⬇ Спуск на ${minutes} мин. начался. Осталось спусков: ${mine.descentsLeft}/${M.MAX_DESCENTS}.`);
  return mineView(mine);
}

// Подсчёт результата спуска (золото + деньги) и проверка обвала.
function finalizeDescent(user: User, mine: any): void {
  const now = Date.now();
  const minutes = mine.descentMinutes;
  const row = M.DESCENT_TABLE[minutes] || M.DESCENT_TABLE[10];

  const ruined = mine.terror && mine.terror.failed;
  let found = false, foundGold = 0, extracted = false, goldGained = 0, money = 0;

  if (!ruined) {
    // Бросок 1 — «нашлось ли золото»
    found = Math.random() < row.find;
    if (found) {
      foundGold = Math.min(mine.goldLeft, u.rnd(row.goldMin, row.goldMax));
      // Бросок 2 — «удалось ли добыть найденное»
      extracted = Math.random() < row.extract;
      if (extracted) { goldGained = foundGold; user.gold += goldGained; mine.goldLeft -= goldGained; }
    }
    // Деньги дают всегда; если золото не получено — в 2-5 раз больше
    money = moneyBase(user);
    if (goldGained <= 0) money *= u.rnd(M.MONEY_FAIL_MULT_MIN, M.MONEY_FAIL_MULT_MAX);
    money = Math.round(money);
    user.dollars += money;
  }

  mine.pendingResult = {
    ruined: !!ruined,
    found, foundGold,
    extractChancePct: Math.round(row.extract * 100),
    extracted, goldGained, money,
    minutes,
  };

  // Завершаем спуск
  mine.status = 'idle';
  mine.terror = null;
  mine.descentMinutes = 0;
  mine.descentEndsAt = 0;

  // Обвал по достижении лимита спусков ИЛИ истощению запаса
  if (mine.descentsLeft <= 0 || mine.goldLeft <= 0) {
    mine.status = 'collapsed';
    mine.collapsedAt = now;
    mine.pendingResult.collapsed = true;
  }
}

// ---------- Фоновая обработка (лениво при каждом обращении) ----------
function refreshAll(user: User): void {
  const now = Date.now();
  let changed = false;
  for (const mine of plots(user)) {
    // Завершение постройки
    if (mine.status === 'building' && mine.buildFinishesAt <= now) { mine.status = 'idle'; changed = true; }

    if (mine.status === 'descending') {
      const t = mine.terror;
      // Активация нападения + уведомление сверху (один раз).
      // ВАЖНО: шлём уведомление ТОЛЬКО если дедлайн ещё не прошёл — иначе при
      // позднем (ленивом) заходе игрок видел «отбей за 10 минут», хотя атака
      // уже провалилась. Если время вышло — просто пометим notified и разрешим
      // ниже как провал (без вводящего в заблуждение алерта).
      if (t && !t.resolved && now >= t.at && !t.notified) {
        t.notified = true; changed = true;
        if (now < t.deadline) {
          const leftMin = Math.max(1, Math.ceil((t.deadline - now) / 60000));
          notif.push(user.id, 'mine_terror',
            `⚠️ На вашу шахту напали террористы! Зайдите в «Шахты» и отбейте атаку — осталось ~${leftMin} мин., иначе спуск и золото пропадут.`,
            { mineId: mine.id, deadline: t.deadline });
        }
      }
      // Тайм-аут реакции — атака не отбита
      if (t && !t.resolved && now >= t.at && now >= t.deadline && !t.repelled) {
        t.resolved = true; t.failed = true; changed = true;
      }
      // Финализация спуска: время вышло И (нет террориста ИЛИ он разрешён)
      if (now >= mine.descentEndsAt && (!t || t.resolved)) {
        finalizeDescent(user, mine); changed = true;
      }
    }
  }
  if (changed) db.save('users');
}

// Бой с террористом: мощь игрока против HP террориста (= половина HP игрока).
// Тратит боеприпасы и энергию из ТЕКУЩИХ запасов. Возвращает исход.
function terroristFight(user: User): { win: boolean; hpLost: number } {
  player.refresh(user); // актуализируем текущие HP/боеприпасы/энергию
  const mx = player.maxima(user);
  const aPow = Math.max(10, player.buildArmy(user, 'atk').power);
  const dPow = Math.max(10, player.buildArmy(user, 'def').power);
  const tPow = Math.max(5, Math.round(aPow * (M.TERRORIST_POW_MIN + Math.random() * (M.TERRORIST_POW_MAX - M.TERRORIST_POW_MIN))));
  let tHp = Math.max(1, Math.ceil(mx.hp * M.TERRORIST_HP_FRACTION));
  let pHp = user.res.hp.cur;
  const startHp = pHp;

  // Тратим ресурсы из текущих запасов
  user.res.am.cur = Math.max(0, user.res.am.cur - M.TERRORIST_AMMO_COST);
  user.res.en.cur = Math.max(0, user.res.en.cur - M.TERRORIST_ENERGY_COST);

  // Размен ударами (как обычный бой); потолок раундов на всякий случай
  let win = false;
  for (let r = 0; r < 60; r++) {
    tHp -= basicDmg(aPow, Math.round(tPow * 0.85));
    if (tHp <= 0) { win = true; break; }
    pHp -= basicDmg(tPow, Math.round(dPow * 0.85));
    if (pHp <= 0) { win = false; break; }
  }
  user.res.hp.cur = u.clamp(Math.round(pHp), 1, mx.hp); // от террориста не «умирают»
  return { win, hpLost: Math.max(0, startHp - user.res.hp.cur) };
}

// Простой расчёт урона за раунд (эхо resolveDamage из battle.ts, потолок 30).
function basicDmg(atk: number, def: number): number {
  const ratio = def / Math.max(1, atk);
  let dealt;
  if (ratio >= 1.5) dealt = u.rnd(1, 4);
  else if (ratio >= 1.2) dealt = u.rnd(4, 10);
  else if (ratio >= 0.9 && ratio <= 1.1) dealt = u.rnd(8, 18);
  else { const dom = Math.min(1, (0.9 - ratio) / 0.9); dealt = Math.round(18 + dom * 9 + Math.random() * 3); }
  return u.clamp(Math.round(dealt), 1, 30);
}

// ---------- Отразить атаку террориста ----------
function fightTerrorists(user: User, plotId: string, notices: Notices) {
  resetIfOldSchema(user);
  refreshAll(user);
  const mine = plots(user).find((m) => m.id === plotId);
  if (!mine) throw new u.ApiError('Шахта не найдена');
  const t = mine.terror;
  if (mine.status !== 'descending' || !t || t.resolved || Date.now() < t.at) throw new u.ApiError('Сейчас нет активного нападения');
  if (Date.now() > t.deadline) { t.resolved = true; t.failed = true; db.save('users'); throw new u.ApiError('Время на реакцию истекло — атаку отбить не успели'); }
  if (user.res.am.cur < 1) throw new u.ApiError('Нет боеприпасов для боя с террористом');
  if (user.res.hp.cur < config.PLAYER.MIN_HP_TO_FIGHT) throw new u.ApiError(`Здоровье ниже ${config.PLAYER.MIN_HP_TO_FIGHT} — сначала подлечитесь`);

  const res = terroristFight(user);
  if (res.win) {
    t.repelled = true; t.resolved = true; t.failed = false;
    const tokens = u.rnd(M.TERRORIST_REWARD_TOKENS_MIN, M.TERRORIST_REWARD_TOKENS_MAX);
    const money = Math.round(config.maxUnitPriceAtLevel(user.level) * u.rnd(M.TERRORIST_REWARD_UNITS_MIN, M.TERRORIST_REWARD_UNITS_MAX));
    user.tokens = (user.tokens || 0) + tokens;
    user.dollars += money;
    notices.push(`⚔ Атака отбита! Потеряно HP: ${res.hpLost}. Награда: 🎫 ${tokens} жетон(а) и $${u.fmt(money)}. Золото спуска в безопасности.`);
    // Если время спуска уже вышло — сразу подводим итог
    if (Date.now() >= mine.descentEndsAt) finalizeDescent(user, mine);
  } else {
    t.resolved = true; t.failed = true;
    notices.push(`💥 Бой с террористом проигран (потеряно HP: ${res.hpLost}). Спуск и золото пропали.`);
    if (Date.now() >= mine.descentEndsAt) finalizeDescent(user, mine);
  }
  db.save('users');
  return mineView(mine);
}

// ---------- Закрыть окно результата ----------
function dismissResult(user: User, plotId: string, notices: Notices) {
  const mine = plots(user).find((m) => m.id === plotId);
  if (!mine) throw new u.ApiError('Шахта не найдена');
  mine.pendingResult = null;
  db.save('users');
  return mineView(mine);
}

// ---------- АДМИН: обнулить все шахты у всех игроков ----------
function wipeAllMines(adminUser: User, notices: Notices) {
  if (!adminUser || !adminUser.isAdmin) throw new u.ApiError('Только для администратора');
  const users = player.users();
  let n = 0;
  for (const uid of Object.keys(users)) {
    const usr: any = users[uid];
    if (usr.mines && usr.mines.length) n++;
    usr.mines = [];
    usr.minesBuiltTotal = 0;
    usr.minesSchemaV = M.SCHEMA_V;
  }
  db.save('users');
  notices.push(`🧹 Шахты обнулены у всех игроков (затронуто: ${n}).`);
  return { affected: n };
}

// ---------- Фоновый тик мира ----------
// Обрабатывает шахты игроков, у которых идёт спуск: уведомление о нападении
// приходит ВОВРЕМЯ (в реальном времени), а не только когда игрок откроет экран.
// Так же вовремя финализируется спуск и снимается провал по тайм-ауту.
function tickAll(): void {
  const users = require('./player').users();
  for (const id of Object.keys(users)) {
    const user = users[id];
    if (!user || user.isBot || !Array.isArray(user.mines) || !user.mines.length) continue;
    const hasActive = user.mines.some((m: any) => m && (m.status === 'descending' || m.status === 'building'));
    if (hasActive) { try { refreshAll(user); } catch (e) {} }
  }
}

export = { view, buyPlot, build, rebuild, descend, fightTerrorists, dismissResult, refreshAll, tickAll, wipeAllMines };
