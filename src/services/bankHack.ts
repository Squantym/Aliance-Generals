// ===================================================================
// src/services/bankHack.ts — взлом банковского сейфа при атаке в войне
//
// Механика (согласовано с владельцем проекта):
//   1. При атаке в ВОЙНЕ (и только там) с шансом от 1% (0 ур. трофея)
//      до 10% (10 ур.) игроку показывают сейф цели ДО боя. Выбор:
//      «Попытаться взломать» или «Продолжить бой» (пропустить).
//   2. Взлом — мини-игра «Быки и коровы»: угадать 4-значный код без
//      повторов цифр за ограниченное число попыток. После каждой
//      попытки — сколько цифр угаданы точно (быки) и просто есть в
//      коде не на своём месте (коровы).
//   3. Даже при ВЕРНО угаданном коде взлом срабатывает не всегда —
//      шанс успеха растёт с 20% (1 ур.) до 70% (10 ур.). Без трофея
//      (0 ур.) шанс успеха 0% — код узнать можно, а обойти сигнализацию
//      нечем, поэтому взлом всегда проваливается с флавором «тревога».
//   4. При удаче крадётся % от БАНКА (защищённого хранилища, не
//      наличных) жертвы — от 1% (1 ур.) до 10% (10 ур.).
//   5. Лимиты (оба считаются с момента, когда игрок нажал «Попытаться»,
//      а не когда ему просто предложили окно; ПРОВАЛ тоже засчитывается
//      как использованная попытка — не только успех):
//        - не больше 10 попыток взлома в сутки;
//        - одну и ту же жертву можно пытаться взломать не чаще раза в сутки.
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import db = require('../core/db');
import trophies = require('./trophies');
import player = require('./player');
import type { User, Notices } from '../types';

function today(): string {
  // День по МСК (UTC+3): новый день наступает в 00:00 МСК
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Сбрасывает суточные лимиты (счётчик попыток + список жертв), если
// наступил новый день
function ensureDay(user: User): void {
  const t = today();
  if (user.lastBankHackDay !== t) {
    user.lastBankHackDay = t;
    user.bankHackCountToday = 0;
    user.bankHackVictimsToday = [];
  }
}

// Отметить, что попытка взлома (успешная или нет) израсходована —
// вызывается на КАЖДОМ завершении мини-игры, включая провал.
function consumeAttempt(user: User, victimId: string): void {
  ensureDay(user);
  user.bankHackCountToday = (user.bankHackCountToday || 0) + 1;
  if (!user.bankHackVictimsToday) user.bankHackVictimsToday = [];
  if (!user.bankHackVictimsToday.includes(victimId)) user.bankHackVictimsToday.push(victimId);
}

// Случайный код из N РАЗНЫХ цифр (0-9), первая цифра может быть 0 —
// это код сейфа, а не число.
function generateCode(digits: number): string {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  let code = '';
  for (let i = 0; i < digits; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    code += pool.splice(idx, 1)[0];
  }
  return code;
}

// «Быки и коровы»: bulls — верная цифра на верном месте, cows — верная
// цифра, но не на своём месте (коровы считаются только среди «не быков»)
function evaluateGuess(code: string, guess: string): { bulls: number; cows: number } {
  let bulls = 0;
  const codeRest: string[] = [], guessRest: string[] = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === guess[i]) bulls++;
    else { codeRest.push(code[i]); guessRest.push(guess[i]); }
  }
  let cows = 0;
  const used = new Array(codeRest.length).fill(false);
  for (const g of guessRest) {
    const idx = codeRest.findIndex((c, i) => c === g && !used[i]);
    if (idx >= 0) { used[idx] = true; cows++; }
  }
  return { bulls, cows };
}

// Проверить и (если повезло) открыть окно взлома. Возвращает объект
// encounter для клиента, либо null, если предлагать нечего (лимиты,
// нет денег в банке жертвы, не повезло с шансом и т.д.)
function tryOffer(user: User, target: User): any {
  ensureDay(user);
  if (user.pendingBankHack) return null; // уже есть незавершённая попытка (не должно случаться)
  if ((user.bankHackCountToday || 0) >= config.BANK_HACK.perDay) return null; // суточный лимит попыток исчерпан
  if ((user.bankHackVictimsToday || []).includes(target.id)) return null;     // эту жертву уже пытались взломать сегодня
  if (!target || (target.bank || 0) <= 0) return null; // нечего красть
  const level = trophies.bankHackLevel(user);
  const chance = config.BANK_HACK.offerChancePct(level);
  if (Math.random() * 100 >= chance) return null;  // не повезло

  const code = generateCode(config.BANK_HACK.digits);
  user.pendingBankHack = {
    targetId: target.id, targetName: target.name, bankAmount: target.bank,
    code, digits: config.BANK_HACK.digits,
    triesLeft: config.BANK_HACK.maxTries, maxTries: config.BANK_HACK.maxTries,
    history: [],
  };
  return {
    encounter: 'bank_hack',
    targetId: target.id, targetName: target.name, bankAmount: target.bank,
    digits: config.BANK_HACK.digits, triesLeft: config.BANK_HACK.maxTries,
    maxTries: config.BANK_HACK.maxTries,
  };
}

// Игрок отказался от взлома — просто продолжаем бой. Возвращает
// targetId, чтобы вызывающий роут знал, кого атаковать дальше. Отказ
// НЕ расходует суточный лимит попыток (лимит тратится только на
// реально начатую мини-игру, см. consumeAttempt).
function skip(user: User): string {
  const p = user.pendingBankHack;
  if (!p) throw new u.ApiError('Нет открытого сейфа для этого решения');
  const targetId = p.targetId;
  user.pendingBankHack = null;
  return targetId;
}

// Игрок ушёл с окна сейфа (закрыл/свернул/сменил экран) — молча снимаем
// незавершённое предложение. В отличие от skip, бой НЕ начинается: окно
// показывается ДО боя и ничего ещё не потрачено (боеприпас не списан,
// суточный лимит попыток тратится только на реальный ввод кода). Просто
// разблокируем возможность атаковать. Безопасно вызывать, даже если сейфа нет.
function cancel(user: User): boolean {
  if (!user.pendingBankHack) return false;
  user.pendingBankHack = null;
  return true;
}

// Попытка ввода кода. Возвращает { targetId, result } — result идёт
// клиенту как есть, targetId — вызывающему роуту (чтобы продолжить бой,
// если взлом завершился любым исходом).
function guess(user: User, guessRaw: string, notices: Notices): { targetId: string; finished: boolean; result: any } {
  const p = user.pendingBankHack;
  if (!p) throw new u.ApiError('Нет открытого сейфа для этого решения');
  const g = String(guessRaw || '').trim();
  if (!new RegExp(`^\\d{${p.digits}}$`).test(g)) {
    throw new u.ApiError(`Введите ${p.digits}-значный код`);
  }
  if (new Set(g.split('')).size !== g.length) {
    throw new u.ApiError('Цифры в коде не должны повторяться');
  }

  const { bulls, cows } = evaluateGuess(p.code, g);
  p.triesLeft--;
  p.history.push({ guess: g, bulls, cows });

  const targetId = p.targetId;

  if (bulls === p.digits) {
    // Код угадан — теперь решает удача, зависящая от уровня трофея.
    // Попытка расходуется ВСЕГДА (и при провале сигнализации тоже).
    consumeAttempt(user, targetId);
    const level = trophies.bankHackLevel(user);
    const successChance = config.BANK_HACK.successChancePct[Math.max(0, Math.min(10, level))];
    const succeeded = Math.random() * 100 < successChance;
    let stolen = 0;
    const target = player.users()[p.targetId];
    if (succeeded && target) {
      const lootPct = config.BANK_HACK.lootPct[Math.max(0, Math.min(10, level))];
      stolen = Math.floor((target.bank || 0) * lootPct / 100);
      stolen = Math.max(0, Math.min(stolen, target.bank || 0));
      target.bank = Math.max(0, (target.bank || 0) - stolen);
      player.addBattleLoot(user, stolen);
      db.markUser(target.id);
      notices.push(`🔓 Сейф взломан! Похищено 🪙 из банка: $${u.fmt(stolen)}.`);
    } else {
      notices.push('🚨 Код верный, но сработала сигнализация — взлом сорван!');
    }
    user.pendingBankHack = null;
    return {
      targetId, finished: true,
      result: { code: p.code, bulls, cows, cracked: true, alarmed: !succeeded, stolen },
    };
  }

  if (p.triesLeft <= 0) {
    // Код так и не разгадан — попытка тоже расходуется (провал = попытка)
    consumeAttempt(user, targetId);
    user.pendingBankHack = null;
    notices.push('⛔ Попытки закончились — код сейфа не разгадан.');
    return { targetId, finished: true, result: { code: p.code, bulls, cows, cracked: false, outOfTries: true } };
  }

  return { targetId, finished: false, result: { bulls, cows, triesLeft: p.triesLeft, cracked: false, history: p.history } };
}

export = { tryOffer, skip, cancel, guess, generateCode, evaluateGuess, ensureDay };
