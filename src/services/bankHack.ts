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

// ═══ ИСТОРИЯ СЕЙФА ══════════════════════════════════════════════════
// Раньше о взломе узнавал только сам взломщик — жертве не приходило
// ничего. Деньги пропадали из хранилища молча, и понять, куда они
// делись и кто их взял, было нельзя. Теперь пишем событие ОБЕИМ
// сторонам и шлём жертве уведомление.
const BANK_LOG_PER_SIDE = 25;   // сколько записей держим в каждой вкладке

// Порядковый номер события. Нужен потому, что метка времени в
// миллисекундах не различает события одной секунды: два взломщика могут
// уложиться в одну миллисекунду, и тогда сортировка по времени ставит их
// в произвольном порядке — в истории они прыгали бы местами.
let bankSeq = 0;

function bankLog(user: any): any[] {
  if (!Array.isArray(user.bankLog)) user.bankLog = [];
  return user.bankLog;
}

// Сравнение «сначала новые»: по времени, при равенстве — по номеру
function byNewest(a: any, b: any): number {
  return (b.at || 0) - (a.at || 0) || (b.seq || 0) - (a.seq || 0);
}

// Ограничение считаем по каждой стороне отдельно: серия своих взломов
// не должна вытеснять историю тех, кто лез ко мне.
function pushBankLog(user: any, entry: any): void {
  if (!user) return;
  const log = bankLog(user);
  log.push(entry);
  const keep = (role: string) => log.filter((e: any) => e.role === role).slice(-BANK_LOG_PER_SIDE);
  user.bankLog = keep('attack').concat(keep('defense'))
    .sort((a: any, b: any) => (a.at || 0) - (b.at || 0) || (a.seq || 0) - (b.seq || 0));
  db.markUser(user.id);
}

// Записать исход обеим сторонам и уведомить жертву.
// outcome: 'stolen' — унёс деньги, 'alarm' — код подобран, но сработала
// сигнализация, 'failed' — код так и не разгадан.
function recordHack(attacker: any, target: any, outcome: string, stolen: number): void {
  const at = Date.now();
  const base = {
    at, seq: ++bankSeq, outcome, stolen: stolen || 0,
    attackerId: attacker.id, attackerName: attacker.name,
    targetId: target ? target.id : null, targetName: target ? target.name : '—',
  };
  pushBankLog(attacker, { ...base, role: 'attack' });
  if (!target) return;
  pushBankLog(target, { ...base, role: 'defense' });

  const notifications = require('./notifications');
  if (outcome === 'stolen') {
    notifications.push(target.id, 'bank_hacked',
      `🔓 Ваш сейф вскрыл «${attacker.name}» — похищено $${u.fmt(stolen)}`,
      { attackerName: attacker.name, attackerId: attacker.id, stolen });
  } else {
    notifications.push(target.id, 'bank_hack_failed',
      `🚨 «${attacker.name}» пытался вскрыть ваш сейф, но не смог — деньги на месте`,
      { attackerName: attacker.name, attackerId: attacker.id, stolen: 0 });
  }
}

// История для экрана банка: две вкладки, новые сверху
function history(user: User) {
  const log = bankLog(user);
  return {
    incoming: log.filter((e: any) => e.role === 'defense').sort(byNewest),
    outgoing: log.filter((e: any) => e.role === 'attack').sort(byNewest),
  };
}

// День по МСК: новый день наступает в 00:00 МСК (правило — u.dayKey)
function today(): string { return u.dayKey(); }

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

// Сколько РАЗ одна цифра может встретиться в коде. Раньше все цифры
// были разными, и это работало против сейфа: зная правило, игрок сразу
// отбрасывал 4630 вариантов из 10 000 и вскрывал код расчётом. Теперь
// цифра может повториться дважды — вариантов 9630, и «все разные»
// больше не гарантировано.
const MAX_SAME = 2;

// Случайный код из N цифр (0-9), где ни одна цифра не встречается больше
// MAX_SAME раз. Первая цифра может быть 0 — это код сейфа, а не число.
function generateCode(digits: number): string {
  const used: Record<string, number> = {};
  let code = '';
  for (let i = 0; i < digits; i++) {
    // Берём только те цифры, которые ещё не выбрали свой лимит
    const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => (used[d] || 0) < MAX_SAME);
    const d = pool[Math.floor(Math.random() * pool.length)];
    used[d] = (used[d] || 0) + 1;
    code += d;
  }
  return code;
}

// Сколько раз повторяется самая частая цифра строки
function maxRepeat(s: string): number {
  const c: Record<string, number> = {};
  for (const ch of s) c[ch] = (c[ch] || 0) + 1;
  return Math.max(0, ...Object.values(c));
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
  // Ровно то же правило, что у самого кода: одинаковых цифр не больше двух.
  // Попытки вида 1111 и 2222 перебирали присутствие цифры в коде и решали
  // сейф за считанные ходы — их больше нет.
  if (maxRepeat(g) > MAX_SAME) {
    throw new u.ApiError(`Одинаковых цифр в коде не больше ${MAX_SAME} — так же и в вашей попытке`);
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
    // Событие в историю обеим сторонам + уведомление жертве: раньше о
    // пропаже денег она не узнавала никак
    recordHack(user, target, succeeded ? 'stolen' : 'alarm', stolen);
    user.pendingBankHack = null;
    return {
      targetId, finished: true,
      result: { code: p.code, bulls, cows, cracked: true, alarmed: !succeeded, stolen },
    };
  }

  if (p.triesLeft <= 0) {
    // Код так и не разгадан — попытка тоже расходуется (провал = попытка)
    consumeAttempt(user, targetId);
    recordHack(user, player.users()[targetId], 'failed', 0);
    user.pendingBankHack = null;
    notices.push('⛔ Попытки закончились — код сейфа не разгадан.');
    return { targetId, finished: true, result: { code: p.code, bulls, cows, cracked: false, outOfTries: true } };
  }

  return { targetId, finished: false, result: { bulls, cows, triesLeft: p.triesLeft, cracked: false, history: p.history } };
}

export = { MAX_SAME, maxRepeat, tryOffer, skip, cancel, guess, generateCode, evaluateGuess, ensureDay, history, recordHack, BANK_LOG_PER_SIDE };
