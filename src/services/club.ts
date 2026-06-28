// ===================================================================
// src/services/club.ts — «Клуб офицеров» (развлекательный центр)
// Пять многоступенчатых мини-игр с наградами 10-20 золота:
//   1) Военный преферанс — добери до 21, не перебрав, против генерала.
//   2) Сейф штаба — взломай 4-значный код («быки и коровы»).
//   3) Минное поле — открывай ячейки, забери выигрыш до взрыва.
//   4) Полоса препятствий — 5 этапов, выбирай риск, копи награду.
//   5) Штабная партия — тактическая дуэль до 3 побед.
// Состояние каждой игры хранится в user.club.
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import type { User, Notices } from '../types';

const C = config.CLUB;

// Гарантируем структуру состояния клуба у игрока
function clubState(user: User): any {
  if (!user.club) user.club = {};
  const c: any = user.club;
  if (!c.cd) c.cd = {};           // кулдауны по играм: { pref, safe, mine, run, duel }
  if (c.pref === undefined) c.pref = null;
  if (c.safe === undefined) c.safe = null;
  if (c.mine === undefined) c.mine = null;
  if (c.run === undefined) c.run = null;
  if (c.duel === undefined) c.duel = null;
  return c;
}

function cdLeft(c: any, key: string): number {
  const now = Date.now();
  return Math.max(0, Math.ceil(((c.cd[key] || 0) - now) / 1000));
}
function setCd(c: any, key: string, minutes: number): void {
  c.cd[key] = Date.now() + minutes * 60 * 1000;
}

// ===================================================================
// ОБЩИЙ ВИД КЛУБА
// ===================================================================
function view(user: User) {
  const c = clubState(user);
  return {
    pref: prefView(c),
    safe: safeView(c),
    mine: mineView(c),
    run:  runView(c),
    duel: duelView(c),
  };
}

// ===================================================================
// 1. ВОЕННЫЙ ПРЕФЕРАНС — добери до 21, не перебрав, против генерала
//    Карты 2-11. Игрок берёт «ещё» или «хватит». Затем добирает генерал
//    (до 17). Ближе к 21 — победа. Перебор (>21) — мгновенный проигрыш.
// ===================================================================
function drawCard(): number {
  // Колода: значения 2..10 и «туз» = 11. Картинки/масти не важны.
  return u.rnd(2, 11);
}

function prefView(c: any) {
  if (c.pref) {
    return {
      state: 'active',
      hand: c.pref.hand,
      sum: c.pref.hand.reduce((s: number, x: number) => s + x, 0),
      target: C.PREF_TARGET,
    };
  }
  const left = cdLeft(c, 'pref');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return { state: 'ready', target: C.PREF_TARGET, rewardMin: C.PREF_REWARD_MIN, rewardMax: C.PREF_REWARD_MAX };
}

function prefStart(user: User) {
  const c = clubState(user);
  if (c.pref) return prefView(c);
  if (cdLeft(c, 'pref') > 0) throw new u.ApiError('Генерал ещё тасует колоду. Загляните позже.');
  // Стартовая рука — две карты
  c.pref = { hand: [drawCard(), drawCard()] };
  return prefView(c);
}

function prefHit(user: User, notices: Notices) {
  const c = clubState(user);
  if (!c.pref) throw new u.ApiError('Партия не начата');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  c.pref.hand.push(drawCard());
  const sum = c.pref.hand.reduce((s: number, x: number) => s + x, 0);
  if (sum > C.PREF_TARGET) {
    // Перебор — мгновенный проигрыш
    c.pref = null;
    setCd(c, 'pref', C.PREF_CD_FAIL_MIN);
    return { result: 'bust', sum };
  }
  return { result: 'hit', hand: c.pref.hand, sum };
}

function prefStand(user: User, notices: Notices) {
  const c = clubState(user);
  if (!c.pref) throw new u.ApiError('Партия не начата');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  const myСум = c.pref.hand.reduce((s: number, x: number) => s + x, 0);
  // Генерал добирает до PREF_DEALER_STOP
  const dealer: number[] = [drawCard(), drawCard()];
  let dealerSum = dealer.reduce((s, x) => s + x, 0);
  while (dealerSum < C.PREF_DEALER_STOP) {
    const card = drawCard();
    dealer.push(card);
    dealerSum += card;
  }
  c.pref = null;

  let win = false;
  if (dealerSum > C.PREF_TARGET) win = true;       // генерал перебрал
  else if (myСум > dealerSum) win = true;          // у игрока больше
  // равенство и меньше — проигрыш (генерал на своём поле)

  if (win) {
    const reward = u.rnd(C.PREF_REWARD_MIN, C.PREF_REWARD_MAX);
    player.addGold(user, reward);
    setCd(c, 'pref', C.PREF_CD_WIN_MIN);
    notices.push(`🃏 Партия ваша! ${myСум} против ${dealerSum}. +🪙 ${reward}`);
    return { result: 'win', mySum: myСум, dealerSum, dealer, reward };
  }
  setCd(c, 'pref', C.PREF_CD_FAIL_MIN);
  return { result: 'lose', mySum: myСум, dealerSum, dealer };
}

// ===================================================================
// 2. СЕЙФ ШТАБА — взломай 4-значный код за 8 попыток.
//    «Быки» (точная цифра на месте) и «коровы» (цифра есть, но не там).
//    Цифры в коде не повторяются. Классический Mastermind/Быки-коровы.
// ===================================================================
function genSafeCode(digits: number): string {
  const pool = ['0','1','2','3','4','5','6','7','8','9'];
  u.shuffle(pool);
  return pool.slice(0, digits).join('');
}

function safeView(c: any) {
  if (c.safe) {
    return {
      state: 'active',
      digits: C.SAFE_DIGITS,
      triesLeft: c.safe.triesLeft,
      history: c.safe.history,  // [{ guess, bulls, cows }]
    };
  }
  const left = cdLeft(c, 'safe');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return { state: 'ready', digits: C.SAFE_DIGITS, tries: C.SAFE_TRIES, reward: C.SAFE_REWARD };
}

function safeStart(user: User) {
  const c = clubState(user);
  if (c.safe) return safeView(c);
  if (cdLeft(c, 'safe') > 0) throw new u.ApiError('Сейф на таймере блокировки. Загляните позже.');
  c.safe = { code: genSafeCode(C.SAFE_DIGITS), triesLeft: C.SAFE_TRIES, history: [] };
  return safeView(c);
}

function safeTry(user: User, guess: string, notices: Notices) {
  const c = clubState(user);
  if (!c.safe) throw new u.ApiError('Сначала подойдите к сейфу');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  const g = String(guess || '').replace(/\D/g, '');
  if (g.length !== C.SAFE_DIGITS) throw new u.ApiError(`Введите ${C.SAFE_DIGITS} цифры`);
  if (new Set(g.split('')).size !== C.SAFE_DIGITS) {
    throw new u.ApiError('Цифры в коде не повторяются — введите разные');
  }
  const code = c.safe.code;
  let bulls = 0, cows = 0;
  for (let i = 0; i < code.length; i++) {
    if (g[i] === code[i]) bulls++;
    else if (code.includes(g[i])) cows++;
  }
  c.safe.triesLeft--;
  c.safe.history.push({ guess: g, bulls, cows });

  if (bulls === C.SAFE_DIGITS) {
    c.safe = null;
    player.addGold(user, C.SAFE_REWARD);
    setCd(c, 'safe', C.SAFE_CD_WIN_MIN);
    notices.push(`🗝 Сейф вскрыт! Код был верный. +🪙 ${C.SAFE_REWARD}`);
    return { result: 'win', bulls, cows, reward: C.SAFE_REWARD };
  }
  if (c.safe.triesLeft <= 0) {
    const code2 = c.safe.code;
    c.safe = null;
    setCd(c, 'safe', C.SAFE_CD_FAIL_MIN);
    return { result: 'fail', bulls, cows, code: code2 };
  }
  return { result: 'continue', bulls, cows, triesLeft: c.safe.triesLeft };
}

// ===================================================================
// 3. МИННОЕ ПОЛЕ — поле из 25 ячеек, 5 мин. Открывай по одной.
//    За каждую безопасную ячейку растёт награда. Можно «забрать» в любой
//    момент. Наступил на мину — теряешь всё накопленное.
// ===================================================================
function mineView(c: any) {
  if (c.mine) {
    return {
      state: 'active',
      cells: C.MINE_CELLS,
      bombs: C.MINE_BOMBS,
      opened: c.mine.opened,          // массив индексов открытых безопасных ячеек
      pot: c.mine.pot,                // накоплено золота
      safeLeft: C.MINE_CELLS - C.MINE_BOMBS - c.mine.opened.length,
    };
  }
  const left = cdLeft(c, 'mine');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return { state: 'ready', cells: C.MINE_CELLS, bombs: C.MINE_BOMBS, rewardMax: C.MINE_REWARD_MAX };
}

function mineStart(user: User) {
  const c = clubState(user);
  if (c.mine) return mineView(c);
  if (cdLeft(c, 'mine') > 0) throw new u.ApiError('Поле ещё разминируют сапёры. Загляните позже.');
  // Расставляем мины
  const idx = Array.from({ length: C.MINE_CELLS }, (_, i) => i);
  u.shuffle(idx);
  const bombs = idx.slice(0, C.MINE_BOMBS);
  c.mine = { bombs, opened: [], pot: 0 };
  return mineView(c);
}

function mineOpen(user: User, cell: number | string, notices: Notices) {
  const c = clubState(user);
  if (!c.mine) throw new u.ApiError('Сначала выйдите на поле');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  const idx = u.toInt(cell);
  if (idx < 0 || idx >= C.MINE_CELLS) throw new u.ApiError('Нет такой ячейки');
  if (c.mine.opened.includes(idx)) throw new u.ApiError('Эта ячейка уже открыта');

  if (c.mine.bombs.includes(idx)) {
    // Взрыв — теряем накопленное
    const bombs = c.mine.bombs.slice();
    c.mine = null;
    setCd(c, 'mine', C.MINE_CD_MIN);
    return { result: 'boom', cell: idx, bombs };
  }
  // Безопасно — растим награду (шаг растёт по мере прогресса)
  c.mine.opened.push(idx);
  const step = C.MINE_STEP_REWARD + Math.floor(c.mine.opened.length / 3);
  c.mine.pot = Math.min(C.MINE_REWARD_MAX, c.mine.pot + step);
  const safeLeft = C.MINE_CELLS - C.MINE_BOMBS - c.mine.opened.length;

  if (safeLeft <= 0) {
    // Открыты все безопасные — максимальный приз и авто-забор
    const reward = C.MINE_REWARD_MAX;
    c.mine = null;
    player.addGold(user, reward);
    setCd(c, 'mine', C.MINE_CD_MIN);
    notices.push(`💣 Поле полностью разминировано! +🪙 ${reward}`);
    return { result: 'cleared', reward };
  }
  return { result: 'safe', cell: idx, pot: c.mine.pot, safeLeft };
}

function mineCashout(user: User, notices: Notices) {
  const c = clubState(user);
  if (!c.mine) throw new u.ApiError('Нет активной игры');
  const pot = c.mine.pot;
  if (pot <= 0) throw new u.ApiError('Сначала откройте хотя бы одну ячейку');
  c.mine = null;
  player.addGold(user, pot);
  setCd(c, 'mine', C.MINE_CD_MIN);
  notices.push(`💰 Вы вовремя ушли с поля! +🪙 ${pot}`);
  return { result: 'cashout', reward: pot };
}

// ===================================================================
// 4. ПОЛОСА ПРЕПЯТСТВИЙ — 5 этапов. На каждом выбираешь сложность:
//    лёгкий (75% пройти, +2🪙), средний (55%, +4🪙), тяжёлый (35%, +7🪙).
//    Награда копится. Провал на любом этапе — теряешь всё. После 3 этапа
//    можно «сойти с дистанции» и забрать накопленное.
// ===================================================================
const RUN_LEVELS: Record<string, { chance: number; reward: number; label: string }> = {
  easy:   { chance: 0.75, reward: 2, label: 'Лёгкий' },
  medium: { chance: 0.55, reward: 4, label: 'Средний' },
  hard:   { chance: 0.35, reward: 7, label: 'Тяжёлый' },
};

function runView(c: any) {
  if (c.run) {
    return {
      state: 'active',
      stage: c.run.stage,           // текущий этап (1..RUN_STAGES)
      totalStages: C.RUN_STAGES,
      pot: c.run.pot,
      canCashout: c.run.stage > 3,  // сойти можно после 3-го этапа
      levels: RUN_LEVELS,
    };
  }
  const left = cdLeft(c, 'run');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return { state: 'ready', totalStages: C.RUN_STAGES, rewardMax: C.RUN_REWARD_MAX };
}

function runStart(user: User) {
  const c = clubState(user);
  if (c.run) return runView(c);
  if (cdLeft(c, 'run') > 0) throw new u.ApiError('Полоса на ремонте после прошлого забега. Загляните позже.');
  c.run = { stage: 1, pot: 0 };
  return runView(c);
}

function runStep(user: User, level: string, notices: Notices) {
  const c = clubState(user);
  if (!c.run) throw new u.ApiError('Забег не начат');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  const lv = RUN_LEVELS[level];
  if (!lv) throw new u.ApiError('Неизвестная сложность этапа');

  if (Math.random() < lv.chance) {
    // Этап пройден
    c.run.pot = Math.min(C.RUN_REWARD_MAX, c.run.pot + lv.reward);
    c.run.stage++;
    if (c.run.stage > C.RUN_STAGES) {
      // Финиш — забираем награду
      const reward = c.run.pot;
      c.run = null;
      player.addGold(user, reward);
      setCd(c, 'run', C.RUN_CD_WIN_MIN);
      notices.push(`🏁 Полоса пройдена до конца! +🪙 ${reward}`);
      return { result: 'finish', reward };
    }
    return { result: 'pass', stage: c.run.stage, pot: c.run.pot };
  }
  // Провал — теряем всё
  c.run = null;
  setCd(c, 'run', C.RUN_CD_FAIL_MIN);
  return { result: 'fail', level: lv.label };
}

function runCashout(user: User, notices: Notices) {
  const c = clubState(user);
  if (!c.run) throw new u.ApiError('Нет активного забега');
  if (c.run.stage <= 3) throw new u.ApiError('Сойти с дистанции можно только после 3-го этапа');
  const reward = c.run.pot;
  c.run = null;
  player.addGold(user, reward);
  setCd(c, 'run', C.RUN_CD_WIN_MIN);
  notices.push(`🏃 Вы сошли с дистанции с наградой! +🪙 ${reward}`);
  return { result: 'cashout', reward };
}

// ===================================================================
// 5. ШТАБНАЯ ПАРТИЯ — тактическая дуэль до 3 побед (best of 5).
//    Три рода войск по кругу бьют друг друга:
//      пехота (infantry) → авиация (air) → танк (tank) → пехота
//    (пехота бьёт авиацию ПЗРК, авиация бьёт танк, танк давит пехоту).
//    Игрок выбирает род войск, генерал — свой. Кто наберёт 3 — победил.
// ===================================================================
const DUEL_BEATS: Record<string, string> = {
  infantry: 'air',     // пехота сбивает авиацию
  air: 'tank',         // авиация уничтожает танк
  tank: 'infantry',    // танк давит пехоту
};
const DUEL_NAMES: Record<string, string> = {
  infantry: '🪖 Пехота', air: '✈️ Авиация', tank: '🛡 Танк',
};

function duelView(c: any) {
  if (c.duel) {
    return {
      state: 'active',
      myWins: c.duel.myWins,
      foeWins: c.duel.foeWins,
      needed: C.DUEL_WINS_NEEDED,
      lastRound: c.duel.lastRound,  // { my, foe, outcome } или null
      units: DUEL_NAMES,
    };
  }
  const left = cdLeft(c, 'duel');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return { state: 'ready', needed: C.DUEL_WINS_NEEDED, rewardMin: C.DUEL_REWARD_MIN, rewardMax: C.DUEL_REWARD_MAX, units: DUEL_NAMES };
}

function duelStart(user: User) {
  const c = clubState(user);
  if (c.duel) return duelView(c);
  if (cdLeft(c, 'duel') > 0) throw new u.ApiError('Генерал анализирует прошлую партию. Загляните позже.');
  c.duel = { myWins: 0, foeWins: 0, lastRound: null };
  return duelView(c);
}

function duelMove(user: User, unit: string, notices: Notices) {
  const c = clubState(user);
  if (!c.duel) throw new u.ApiError('Дуэль не начата');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  if (!DUEL_BEATS[unit]) throw new u.ApiError('Выберите род войск');

  const units = ['infantry', 'air', 'tank'];
  const foe = u.pick(units);
  let outcome: string;
  if (unit === foe) outcome = 'draw';
  else if (DUEL_BEATS[unit] === foe) { outcome = 'win'; c.duel.myWins++; }
  else { outcome = 'lose'; c.duel.foeWins++; }
  c.duel.lastRound = { my: unit, foe, outcome };

  // Проверяем завершение матча
  if (c.duel.myWins >= C.DUEL_WINS_NEEDED) {
    const reward = u.rnd(C.DUEL_REWARD_MIN, C.DUEL_REWARD_MAX);
    c.duel = null;
    player.addGold(user, reward);
    setCd(c, 'duel', C.DUEL_CD_WIN_MIN);
    notices.push(`♟ Партия выиграна! Генерал повержен. +🪙 ${reward}`);
    return { result: 'match_win', my: unit, foe, outcome, reward };
  }
  if (c.duel.foeWins >= C.DUEL_WINS_NEEDED) {
    c.duel = null;
    setCd(c, 'duel', C.DUEL_CD_FAIL_MIN);
    return { result: 'match_lose', my: unit, foe, outcome };
  }
  return {
    result: 'round', my: unit, foe, outcome,
    myWins: c.duel.myWins, foeWins: c.duel.foeWins,
  };
}

export = {
  view,
  prefStart, prefHit, prefStand,
  safeStart, safeTry,
  mineStart, mineOpen, mineCashout,
  runStart, runStep, runCashout,
  duelStart, duelMove,
};
