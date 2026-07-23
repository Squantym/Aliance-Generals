// ===================================================================
// src/services/club.ts — «Клуб офицеров» (развлекательный центр)
// Пять мини-игр с наградами 8-20 золота:
//   1) Военный преферанс — добери до 21, не перебрав, против генерала.
//   2) Сейф штаба — взломай 4-значный код («быки и коровы»).
//   3) Артиллерийская пристрелка — угадай дистанцию (перелёт/недолёт).
//   4) Военные кости — 5 кубиков и 2 переброса, собери комбинацию.
//   5) Штабной аукцион — слепые ставки очками влияния против генералов.
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
  if (!c.cd) c.cd = {};           // кулдауны по играм: { pref, safe, arty, dice, bids }
  if (c.pref === undefined) c.pref = null;
  if (c.safe === undefined) c.safe = null;
  if (c.arty === undefined) c.arty = null;
  if (c.dice === undefined) c.dice = null;
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
    arty: artyView(c),
    dice: diceView(c),
    bids: bidsView(c),
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
// 3. АРТИЛЛЕРИЙСКАЯ ПРИСТРЕЛКА — угадай дистанцию до цели.
//    Загадано число ARTY_MIN..ARTY_MAX. После каждого выстрела корректировщик
//    говорит «перелёт» или «недолёт». Чем меньше выстрелов — тем больше приз.
//    Патроны кончились — цель ушла, награды нет.
// ===================================================================
function artyView(c: any) {
  if (c.arty) {
    return {
      state: 'active',
      min: C.ARTY_MIN, max: C.ARTY_MAX,
      shotsLeft: c.arty.shotsLeft,
      history: c.arty.history,        // [{ guess, hint: 'over'|'under' }]
      nextReward: artyReward(c.arty.shots + 1),
    };
  }
  const left = cdLeft(c, 'arty');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return {
    state: 'ready', min: C.ARTY_MIN, max: C.ARTY_MAX, shots: C.ARTY_SHOTS,
    rewardMax: artyReward(1), rewardMin: artyReward(C.ARTY_SHOTS),
  };
}

// Награда за попадание с N-го выстрела
function artyReward(shotNo: number): number {
  return Math.max(C.ARTY_REWARD_MIN, C.ARTY_REWARD_BASE - shotNo * C.ARTY_REWARD_STEP);
}

function artyStart(user: User) {
  const c = clubState(user);
  if (c.arty) return artyView(c);
  if (cdLeft(c, 'arty') > 0) throw new u.ApiError('Батарея перезаряжается. Загляните позже.');
  c.arty = {
    target: u.rnd(C.ARTY_MIN, C.ARTY_MAX),
    shotsLeft: C.ARTY_SHOTS,
    shots: 0,
    history: [] as any[],
  };
  return artyView(c);
}

function artyShoot(user: User, distance: number | string, notices: Notices) {
  const c = clubState(user);
  if (!c.arty) throw new u.ApiError('Сначала займите огневую позицию');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);

  const guess = u.toInt(distance);
  if (guess < C.ARTY_MIN || guess > C.ARTY_MAX) {
    throw new u.ApiError(`Дистанция должна быть от ${C.ARTY_MIN} до ${C.ARTY_MAX}`);
  }

  c.arty.shots++;
  c.arty.shotsLeft--;
  const target = c.arty.target;

  if (guess === target) {
    const reward = artyReward(c.arty.shots);
    const shots = c.arty.shots;
    c.arty = null;
    player.addGold(user, reward);
    setCd(c, 'arty', C.ARTY_CD_WIN_MIN);
    notices.push(`🎯 Прямое попадание с ${shots}-го выстрела! +🪙 ${reward}`);
    return { result: 'hit', target, shots, reward };
  }

  const hint = guess > target ? 'over' : 'under';   // перелёт / недолёт
  c.arty.history.push({ guess, hint });

  if (c.arty.shotsLeft <= 0) {
    c.arty = null;
    setCd(c, 'arty', C.ARTY_CD_FAIL_MIN);
    return { result: 'lost', target };
  }
  return {
    result: 'miss', hint, guess,
    shotsLeft: c.arty.shotsLeft,
    nextReward: artyReward(c.arty.shots + 1),
  };
}

// ===================================================================
// 4. ВОЕННЫЕ КОСТИ — 5 кубиков, до DICE_REROLLS перебросов.
//    Оставляешь нужные кубики, остальные перебрасываешь. В конце
//    считается комбинация (от «двух пар» до «полного залпа»).
// ===================================================================
function diceCombo(dice: number[]): { id: string; name: string; gold: number } | null {
  const counts: Record<number, number> = {};
  for (const d of dice) counts[d] = (counts[d] || 0) + 1;
  const values = Object.values(counts).sort((a, b) => b - a);
  const uniq = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const pay = (id: string) => C.DICE_PAYOUTS.find((p: any) => p.id === id) || null;

  if (values[0] === 5) return pay('five');
  if (values[0] === 4) return pay('four');
  if (values[0] === 3 && values[1] === 2) return pay('full');
  // Стрит: 5 разных подряд (1-5 или 2-6)
  if (uniq.length === 5 && uniq[4] - uniq[0] === 4) return pay('straight');
  if (values[0] === 3) return pay('three');
  if (values[0] === 2 && values[1] === 2) return pay('twopair');
  return null;
}

function diceView(c: any) {
  if (c.dice) {
    return {
      state: 'active',
      dice: c.dice.dice,
      rerollsLeft: c.dice.rerollsLeft,
      combo: diceCombo(c.dice.dice),   // текущая комбинация (подсказка игроку)
      payouts: C.DICE_PAYOUTS,
    };
  }
  const left = cdLeft(c, 'dice');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return {
    state: 'ready', count: C.DICE_COUNT, rerolls: C.DICE_REROLLS,
    payouts: C.DICE_PAYOUTS,
    rewardMax: Math.max(...C.DICE_PAYOUTS.map((p: any) => p.gold)),
    rewardMin: Math.min(...C.DICE_PAYOUTS.map((p: any) => p.gold)),
  };
}

function rollDice(n: number): number[] {
  return Array.from({ length: n }, () => u.rnd(1, 6));
}

function diceStart(user: User) {
  const c = clubState(user);
  if (c.dice) return diceView(c);
  if (cdLeft(c, 'dice') > 0) throw new u.ApiError('Кости ещё у другого расчёта. Загляните позже.');
  c.dice = { dice: rollDice(C.DICE_COUNT), rerollsLeft: C.DICE_REROLLS };
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  return diceView(c);
}

// keep — массив индексов кубиков, которые ОСТАВЛЯЕМ; остальные перебрасываются
function diceReroll(user: User, keep: any, notices: Notices) {
  const c = clubState(user);
  if (!c.dice) throw new u.ApiError('Сначала бросьте кости');
  if (c.dice.rerollsLeft <= 0) throw new u.ApiError('Перебросы кончились — забирайте результат');
  const keepSet = new Set((Array.isArray(keep) ? keep : []).map((x: any) => u.toInt(x)));
  c.dice.dice = c.dice.dice.map((d: number, i: number) => (keepSet.has(i) ? d : u.rnd(1, 6)));
  c.dice.rerollsLeft--;
  return { result: 'rerolled', dice: c.dice.dice, rerollsLeft: c.dice.rerollsLeft, combo: diceCombo(c.dice.dice) };
}

function diceFinish(user: User, notices: Notices) {
  const c = clubState(user);
  if (!c.dice) throw new u.ApiError('Нет активной игры');
  const dice = c.dice.dice.slice();
  const combo = diceCombo(dice);
  c.dice = null;
  if (!combo) {
    setCd(c, 'dice', C.DICE_CD_FAIL_MIN);
    return { result: 'nothing', dice };
  }
  player.addGold(user, combo.gold);
  setCd(c, 'dice', C.DICE_CD_WIN_MIN);
  notices.push(`🎲 ${combo.name}! +🪙 ${combo.gold}`);
  return { result: 'win', dice, combo, reward: combo.gold };
}

// ===================================================================
// 5. ШТАБНОЙ АУКЦИОН — слепые ставки против генералов.
//    У вас BIDS_POINTS очков влияния и BIDS_LOTS лотов. Распределяете
//    очки между лотами втёмную; соперники делают то же самое. Лот
//    достаётся тому, кто поставил больше. Ничья — лот уходит казне.
// ===================================================================
const BID_LOT_NAMES = ['Партия боеприпасов', 'Трофейная техника', 'Разведданные'];

function bidsView(c: any) {
  const left = cdLeft(c, 'bids');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return {
    state: 'ready',
    points: C.BIDS_POINTS,
    lots: BID_LOT_NAMES.slice(0, C.BIDS_LOTS),
    rivals: C.BIDS_RIVALS,
    perLot: C.BIDS_REWARD_PER_LOT,
    sweepBonus: C.BIDS_SWEEP_BONUS,
    rewardMax: C.BIDS_LOTS * C.BIDS_REWARD_PER_LOT + C.BIDS_SWEEP_BONUS,
  };
}

// Соперник распределяет очки случайно, но осмысленно (не все в один лот)
function rivalBids(): number[] {
  const lots = C.BIDS_LOTS;
  let left = C.BIDS_POINTS;
  const out: number[] = [];
  for (let i = 0; i < lots - 1; i++) {
    // берём случайную долю остатка, чтобы ставки были разнообразными
    const take = u.rnd(0, Math.max(0, Math.round(left * 0.7)));
    out.push(take);
    left -= take;
  }
  out.push(left);
  return out;
}

function bidsPlay(user: User, bids: any, notices: Notices) {
  const c = clubState(user);
  if (cdLeft(c, 'bids') > 0) throw new u.ApiError('Аукцион уже закрыт. Загляните позже.');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);

  const arr = (Array.isArray(bids) ? bids : []).map((x: any) => Math.max(0, u.toInt(x, 0)));
  if (arr.length !== C.BIDS_LOTS) throw new u.ApiError(`Нужно указать ставку по каждому из ${C.BIDS_LOTS} лотов`);
  const total = arr.reduce((s, x) => s + x, 0);
  if (total > C.BIDS_POINTS) throw new u.ApiError(`Всего очков влияния: ${C.BIDS_POINTS}, вы распределили ${total}`);

  // Ставки соперников
  const rivals: number[][] = [];
  for (let i = 0; i < C.BIDS_RIVALS; i++) rivals.push(rivalBids());

  const lots: any[] = [];
  let won = 0;
  for (let i = 0; i < C.BIDS_LOTS; i++) {
    const mine = arr[i];
    const best = Math.max(...rivals.map((r) => r[i]));
    const win = mine > best;           // строго больше: при равенстве лот уходит казне
    if (win) won++;
    lots.push({ name: BID_LOT_NAMES[i], my: mine, rivalBest: best, win });
  }

  let reward = won * C.BIDS_REWARD_PER_LOT;
  const sweep = won === C.BIDS_LOTS;
  if (sweep) reward += C.BIDS_SWEEP_BONUS;

  if (reward > 0) {
    player.addGold(user, reward);
    setCd(c, 'bids', C.BIDS_CD_WIN_MIN);
    notices.push(`💼 Аукцион: выиграно лотов ${won}/${C.BIDS_LOTS}${sweep ? ' (все!)' : ''}. +🪙 ${reward}`);
  } else {
    setCd(c, 'bids', C.BIDS_CD_FAIL_MIN);
  }
  return { result: reward > 0 ? 'win' : 'lost', lots, won, sweep, reward };
}

export = {
  view,
  prefStart, prefHit, prefStand,
  safeStart, safeTry,
  artyStart, artyShoot,
  diceStart, diceReroll, diceFinish,
  bidsPlay,
};
