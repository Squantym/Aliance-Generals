// ===================================================================
// src/services/club.ts — «Клуб офицеров» (развлекательный центр)
// Три способа заработать немного золота:
// 1) «Стенгазета» — загадки (3 золота за верный ответ);
// 2) «Загадка ветерана» — угадай число от 1 до 500 за 8 попыток (10 золота);
// 3) «Армрестлинг» — ставка долларами, победа удваивает ставку.
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
  if (c.riddleId === undefined) c.riddleId = null;
  if (!c.riddleNextAt) c.riddleNextAt = 0;
  if (c.guess === undefined) c.guess = null;
  if (!c.guessNextAt) c.guessNextAt = 0;
  if (!c.armNextAt) c.armNextAt = 0;
  return c;
}

// Общий вид клуба. Если кулдаун загадки прошёл — сразу выдаём новую.
function view(user: User) {
  const c = clubState(user);
  const now = Date.now();

  // Стенгазета: назначаем свежую загадку, когда можно
  let riddle;
  if (c.riddleId !== null) {
    riddle = { state: 'active', q: config.RIDDLES[c.riddleId].q };
  } else if (now < c.riddleNextAt) {
    riddle = { state: 'cooldown', cooldownSec: Math.ceil((c.riddleNextAt - now) / 1000) };
  } else {
    c.riddleId = u.rnd(0, config.RIDDLES.length - 1);
    riddle = { state: 'active', q: config.RIDDLES[c.riddleId].q };
  }

  // Загадка ветерана (угадай число)
  let guess;
  if (c.guess) {
    guess = { state: 'active', left: c.guess.left, lastHint: c.guess.lastHint, range: C.GUESS_RANGE };
  } else if (now < c.guessNextAt) {
    guess = { state: 'cooldown', cooldownSec: Math.ceil((c.guessNextAt - now) / 1000) };
  } else {
    guess = { state: 'ready', range: C.GUESS_RANGE, tries: C.GUESS_TRIES, reward: C.GUESS_GOLD };
  }

  return {
    riddle: { ...riddle, reward: C.RIDDLE_GOLD },
    guess,
    arm: {
      cooldownSec: Math.max(0, Math.ceil((c.armNextAt - now) / 1000)),
      minBet: C.ARM_MIN_BET,
    },
  };
}

// ---------- Стенгазета: ответ на загадку ----------
function answerRiddle(user: User, answer: string, notices: Notices) {
  const c = clubState(user);
  if (c.riddleId === null) throw new u.ApiError('Сейчас нет активной загадки — загляните позже');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  const riddle = config.RIDDLES[c.riddleId];
  const norm = String(answer || '').trim().toLowerCase().replace(/ё/g, 'е');
  const correct = riddle.a.some((a) => a.replace(/ё/g, 'е') === norm);
  c.riddleId = null;
  if (correct) {
    player.addGold(user, C.RIDDLE_GOLD);
    c.riddleNextAt = Date.now() + C.RIDDLE_WIN_CD_MIN * 60 * 1000;
    notices.push(`📰 Ай да умник! Верный ответ. +🪙 ${C.RIDDLE_GOLD}`);
    return { correct: true };
  }
  c.riddleNextAt = Date.now() + C.RIDDLE_FAIL_CD_MIN * 60 * 1000;
  return { correct: false, rightAnswer: riddle.a[0] };
}

// ---------- Загадка ветерана: старт игры ----------
function guessStart(user: User) {
  const c = clubState(user);
  if (c.guess) return { state: 'active', left: c.guess.left, lastHint: c.guess.lastHint };
  const now = Date.now();
  if (now < c.guessNextAt) throw new u.ApiError('Дедуля отдыхает. Загляните позже.');
  c.guess = { secret: u.rnd(1, C.GUESS_RANGE), left: C.GUESS_TRIES, lastHint: null };
  return { state: 'active', left: c.guess.left, lastHint: null };
}

// ---------- Загадка ветерана: попытка ----------
function guessTry(user: User, number: number | string, notices: Notices) {
  const c = clubState(user);
  if (!c.guess) throw new u.ApiError('Игра ещё не начата');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  const n = u.toInt(number);
  if (n < 1 || n > C.GUESS_RANGE) throw new u.ApiError(`Число должно быть от 1 до ${C.GUESS_RANGE}`);
  c.guess.left--;

  if (n === c.guess.secret) {
    c.guess = null;
    c.guessNextAt = Date.now() + C.GUESS_WIN_CD_MIN * 60 * 1000;
    player.addGold(user, C.GUESS_GOLD);
    notices.push(`🎲 Раз — и прямо в цель! Вот он — интеллект! +🪙 ${C.GUESS_GOLD}`);
    return { result: 'win' };
  }
  const hint = n < c.guess.secret ? 'Загаданное БОЛЬШЕ' : 'Загаданное МЕНЬШЕ';
  c.guess.lastHint = `${n} → ${hint}`;
  if (c.guess.left <= 0) {
    const secret = c.guess.secret;
    c.guess = null;
    c.guessNextAt = Date.now() + C.GUESS_FAIL_CD_MIN * 60 * 1000;
    return { result: 'fail', secret };
  }
  return { result: 'hint', hint, left: c.guess.left };
}

// ---------- Армрестлинг ----------
function armWrestle(user: User, bet: number | string, notices: Notices) {
  const c = clubState(user);
  const now = Date.now();
  if (now < c.armNextAt) throw new u.ApiError('Рука ещё дрожит — отдохните минуту');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  bet = u.toInt(bet);
  if (bet < C.ARM_MIN_BET) throw new u.ApiError(`Минимальная ставка: $${u.fmt(C.ARM_MIN_BET)}`);
  if (bet > user.dollars) throw new u.ApiError('Не хватает наличных на ставку');
  c.armNextAt = now + C.ARM_CD_SEC * 1000;

  // Жестокость слегка повышает шанс победы (характер чувствуется в хвате)
  const chance = C.ARM_BASE_CHANCE + Math.min(0.08, user.skills.cruelty * 0.003);
  const win = Math.random() < chance;
  if (win) {
    player.addMoney(user, bet, true);
    notices.push(`💪 Хрясь! Соперник повержен. +$${u.fmt(bet)}`);
  } else {
    user.dollars -= bet;
  }
  return { win, bet };
}

export = { view, answerRiddle, guessStart, guessTry, armWrestle };
