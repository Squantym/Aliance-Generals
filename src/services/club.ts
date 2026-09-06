// ===================================================================
// src/services/club.ts — «Клуб офицеров» (развлекательный центр)
//
// ГЛАВНОЕ ПРАВИЛО КЛУБА: суточный потолок эмиссии золота (CLUB.DAILY_GOLD_CAP).
// До него ограничение было только по времени — кулдаун на каждую игру.
// Замер показал, чем это кончается: играя ровно по кулдаунам, из клуба
// выносилось 3341 🪙 в сутки, около 2500 ₽ бесплатного золота по прайсу
// магазина, причём выигрывала усидчивость, а не умение. Сейф вообще не
// проигрывался: 4000 партий из 4000 при осмысленной игре.
//
// Теперь кулдауны задают ТЕМП, а потолок — СУММУ. Всё золото клуба
// выходит через одну функцию payout(), и другого пути нет.
//
// Мини-игры:
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
import safeCrack = require('./safeCrack');
import type { User, Notices } from '../types';

const C = config.CLUB;

// Гарантируем структуру состояния клуба у игрока
function clubState(user: User): any {
  if (!user.club) user.club = {};
  const c: any = user.club;
  if (!c.cd) c.cd = {};           // кулдауны: { all, pref, raid, dice, bids, tactic }
  if (c.pref === undefined) c.pref = null;
  if (c.safe === undefined) c.safe = null;
  if (c.raid === undefined) c.raid = null;
  if (c.dice === undefined) c.dice = null;
  if (c.tactic === undefined) c.tactic = null;
  return c;
}

// ── СУТОЧНЫЙ ПОТОЛОК ЗОЛОТА ──────────────────────────────────────
// Сутки — общие для игры, от московской полуночи (u.dayKey), а не от
// момента первой партии: иначе у каждого игрока был бы свой сброс, и
// потолок обходился бы сдвигом времени игры.
function budget(c: any): { cap: number; spent: number; left: number } {
  const day = u.dayKey();
  if (c.day !== day) { c.day = day; c.dayGold = 0; }
  const spent = Math.max(0, u.toInt(c.dayGold, 0));
  return { cap: C.DAILY_GOLD_CAP, spent, left: Math.max(0, C.DAILY_GOLD_CAP - spent) };
}

// ЕДИНСТВЕННОЕ место, где клуб выдаёт золото. Каждая игра обязана
// звать эту функцию, а не player.addGold напрямую: иначе новая игра
// однажды пройдёт мимо потолка, и заметить это будет нечем.
//
// Источник помечается («club_safe», «club_tactic»): раньше клуб звал
// addGold без третьего аргумента, всё падало в «Прочее», и владелец не
// видел в статистике крупнейший источник золота в игре.
function payout(user: User, game: string, want: number, notices: Notices, sharedBreak = true): number {
  const c = clubState(user);
  const b = budget(c);
  const wanted = Math.max(0, Math.round(want));
  const give = Math.min(wanted, b.left);
  if (give > 0) {
    c.dayGold = b.spent + give;
    player.addGold(user, give, 'club_' + game);
  }
  // Общий кулдаун взводится за ПОБЕДУ, а не за выданное золото: упёршись
  // в потолок, игрок продолжает играть в том же темпе, просто без денег.
  //
  // Платные игры из него исключены (sharedBreak=false). Общий перерыв
  // придуман, чтобы придержать РАЗДАЧУ бесплатного золота; игра, за вход
  // в которую заплачено, ничего бесплатного не раздаёт, и запирать из-за
  // неё остальной клуб не за что.
  if (sharedBreak) setCd(c, 'all', C.SHARED_CD_MIN);
  if (give < wanted) {
    notices.push(give > 0
      ? `🪙 Суточный предел клуба (${C.DAILY_GOLD_CAP}) достигнут: начислено ${give} вместо ${wanted}. Сброс в полночь по Москве.`
      : `🪙 Суточный предел клуба (${C.DAILY_GOLD_CAP}) исчерпан. Играть можно, золота до полуночи по Москве не будет.`);
  }
  return give;
}

// Взнос за платную игру возвращается в суточный бюджет. Потолок
// ограничивает НЕТТО — сколько золота клуб отдал игроку сверх внесённого.
// Считай мы по валовой выплате, десять партий преферанса (из них четыре
// выигранных) забили бы весь суточный потолок, хотя игрок при этом ушёл
// в минус на двадцать золота и ничего у игры не выиграл.
function refundBudget(c: any, amount: number): void {
  const b = budget(c);
  c.dayGold = Math.max(0, b.spent - Math.max(0, Math.round(amount)));
}

// Общий перерыв после выигрыша. Проверяется на ВХОДЕ в игру, но не
// мешает доиграть уже начатую партию — иначе выигрыш в костях запирал
// бы недоигранный сейф, и попытки в нём сгорали бы ни за что.
function gate(c: any): void {
  const left = cdLeft(c, 'all');
  if (left > 0) {
    throw new u.ApiError(`В клубе перерыв после выигрыша — ещё ${Math.ceil(left / 60)} мин.`);
  }
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
  const b = budget(c);
  return {
    // Потолок показываем игроку честно и всегда. Скрытый предел
    // выглядит как поломка: награда молча стала нулём.
    budget: { cap: b.cap, spent: b.spent, left: b.left },
    sharedCooldownSec: cdLeft(c, 'all'),
    pref: prefView(c),
    safe: safeView(user),
    raid: raidView(c),
    dice: diceView(c),
    bids: bidsView(c),
    tactic: tacticView(c),
  };
}

// ===================================================================
// 1. ВОЕННЫЙ ПРЕФЕРАНС — добери до 21, не перебрав, против генерала.
//
//    Играется НАСТОЯЩЕЙ колодой из 36 карт (config.CARD_DECK), а не
//    случайным числом от 2 до 11, как было раньше. Разница не косметика:
//    карты уходят из колоды и второй раз не приходят, а стоимости
//    распределены неравномерно — десяток вчетверо больше, чем валетов по
//    два очка. Из-за этого перебор случается заметно чаще, и замер это
//    подтвердил (см. коммит).
//
//    КАРТЫ ГЕНЕРАЛА ОТКРЫТЫ С РАЗДАЧИ. Это сделано намеренно: игрок
//    просил видеть и свои карты, и чужие. Игра от этого становится не
//    проще, а осмысленнее — решение «ещё или хватит» перестаёт быть
//    гаданием и превращается в счёт против известной руки. Неизвестным
//    остаётся то, что генерал доберёт: он тянет, пока у него меньше
//    PREF_DEALER_STOP.
// ===================================================================

// Свежая перетасованная колода на каждую партию. Одна колода на партию,
// а не общая на всех: иначе пришлось бы хранить состояние стола между
// игроками и решать, что делать при обрыве связи посреди раздачи.
function freshDeck(): string[] {
  return u.shuffle((config.CARD_DECK as string[]).slice());
}

function draw(game: any): string {
  // Колода из 36 карт на двоих не кончается: максимум рука игрока и рука
  // генерала — это около десятка карт. Но если кто-то поменяет правила
  // добора, пустая колода не должна ронять сервер.
  if (!game.deck || !game.deck.length) game.deck = freshDeck();
  return game.deck.pop();
}

// Карты для экрана: id, ранг, масть и путь к картинке. Считает сервер,
// потому что стоимость карты — правило игры, а не оформление.
function cardsOut(ids: string[]): any[] {
  return (ids || []).map((id) => config.cardInfo(id)).filter(Boolean);
}

function prefView(c: any) {
  if (c.pref) {
    return {
      state: 'active',
      hand: cardsOut(c.pref.hand),
      sum: config.handSum(c.pref.hand),
      // Рука генерала видна с раздачи — целиком, а не одной картой
      foe: cardsOut(c.pref.foe),
      foeSum: config.handSum(c.pref.foe),
      dealerStop: C.PREF_DEALER_STOP,
      target: C.PREF_TARGET,
    };
  }
  const left = cdLeft(c, 'pref');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return {
    state: 'ready', target: C.PREF_TARGET, dealerStop: C.PREF_DEALER_STOP,
    entry: C.PREF_ENTRY_GOLD, win: C.PREF_WIN_GOLD, cdMin: C.PREF_CD_MIN,
    // Вероятность выигрыша наружу НЕ отдаётся: игрок садится за стол, а
    // не читает таблицу шансов.
  };
}

function prefStart(user: User, notices?: Notices) {
  const c = clubState(user);
  if (c.pref) return prefView(c);
  if (cdLeft(c, 'pref') > 0) throw new u.ApiError('Генерал ещё тасует колоду. Загляните позже.');
  // gate(c) здесь НЕТ намеренно: за партию плачено, общий перерыв клуба
  // её не касается (см. пояснение в payout).
  const entry = C.PREF_ENTRY_GOLD;
  if ((user.gold || 0) < entry) {
    throw new u.ApiError(`Ставка — 🪙 ${entry}, у вас ${user.gold || 0}`);
  }
  player.spendGold(user, entry, 'club_pref');
  refundBudget(c, entry);
  if (notices) notices.push(`🃏 Ставка принята: −🪙 ${entry}`);
  const game: any = { deck: freshDeck(), hand: [], foe: [] };
  // Раздача по одной и по очереди, как за столом: порядок важен для
  // показа на экране — игрок видит, как ложатся карты.
  game.hand.push(draw(game));
  game.foe.push(draw(game));
  game.hand.push(draw(game));
  game.foe.push(draw(game));
  c.pref = game;
  return prefView(c);
}

function prefHit(user: User, notices: Notices) {
  const c = clubState(user);
  if (!c.pref) throw new u.ApiError('Партия не начата');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  const card = draw(c.pref);
  c.pref.hand.push(card);
  const sum = config.handSum(c.pref.hand);
  if (sum > C.PREF_TARGET) {
    const hand = cardsOut(c.pref.hand), foe = cardsOut(c.pref.foe);
    const foeSum = config.handSum(c.pref.foe);
    c.pref = null;
    setCd(c, 'pref', C.PREF_CD_MIN);
    return { result: 'bust', sum, card: config.cardInfo(card), hand, foe, foeSum, entry: C.PREF_ENTRY_GOLD };
  }
  return { result: 'hit', card: config.cardInfo(card), hand: cardsOut(c.pref.hand), sum };
}

function prefStand(user: User, notices: Notices) {
  const c = clubState(user);
  if (!c.pref) throw new u.ApiError('Партия не начата');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);
  const game = c.pref;
  const mySum = config.handSum(game.hand);

  // Генерал добирает из ТОЙ ЖЕ колоды: карты, уже лежащие у игрока, ему
  // прийти не могут. Раньше он тянул из воздуха, и одна и та же карта
  // могла оказаться на столе дважды.
  const drawn: string[] = [];
  while (config.handSum(game.foe) < C.PREF_DEALER_STOP) {
    const card = draw(game);
    game.foe.push(card);
    drawn.push(card);
  }
  const foeSum = config.handSum(game.foe);
  const foe = cardsOut(game.foe);
  const hand = cardsOut(game.hand);
  c.pref = null;

  let win = false;
  if (foeSum > C.PREF_TARGET) win = true;       // генерал перебрал
  else if (mySum > foeSum) win = true;          // у игрока больше
  // равенство и меньше — проигрыш (генерал на своём поле)

  setCd(c, 'pref', C.PREF_CD_MIN);
  if (win) {
    const reward = payout(user, 'pref', C.PREF_WIN_GOLD, notices, false);
    notices.push(`🃏 Партия ваша! ${mySum} против ${foeSum}.` + (reward ? ` +🪙 ${reward}` : ''));
    return { result: 'win', mySum, foeSum, hand, foe, drawn: cardsOut(drawn), reward, entry: C.PREF_ENTRY_GOLD };
  }
  return { result: 'lose', mySum, foeSum, hand, foe, drawn: cardsOut(drawn), entry: C.PREF_ENTRY_GOLD };
}

// ===================================================================
// 2. СЕЙФ ШТАБА — ОДИН код на весь мир, ломают сообща.
//    Правила и устройство — в src/services/safeCrack.ts. Здесь только
//    оболочка: общий перерыв клуба и выдача золота через payout(),
//    потому что другой двери к золоту в клубе нет.
// ===================================================================
function safeView(user: User) {
  return safeCrack.view(user);
}

function safeTry(user: User, guess: string, notices: Notices) {
  const c = clubState(user);
  gate(c);
  const r = safeCrack.attempt(user, guess);
  // Поручение засчитываем за НАСТОЯЩУЮ попытку: safeCrack уже отверг бы
  // мусор вместо кода и слишком частый запрос.
  require('./dailyQuests').bump(user, 'clubPlayed', 1);

  if (r.result === 'win') {
    const reward = payout(user, 'safe', r.reward, notices);
    notices.push(`🗝 Сейф вскрыт! Код был ${r.code}, попыток ушло ${r.attempts}.`
      + (reward ? ` +🪙 ${reward}` : ''));
    return { ...r, reward };
  }
  return r;
}

// ===================================================================
// 3. НОЧНОЙ РЕЙД — игра про остановку, а не про угадывание.
//
//    Группа идёт через рубежи. После каждого взятого рубежа добыча
//    растёт, но растёт и риск сорваться на следующем; сорвался —
//    потерял всё, что набрал. Отойти можно в любой момент.
//
//    Вероятность следующего рубежа показана игроку ЧЕСТНО, до решения.
//    Игра втёмную была бы просто рулеткой: решение имеет смысл, только
//    если известна цена риска.
//
//    По расчёту лучшая остановка — третий рубеж (ожидание 5.1 🪙).
//    Дойти до шестого можно, но ожидание там 2.6 — жадность наказана
//    арифметикой, а не окриком.
// ===================================================================
function raidRisk(step: number): number {
  const arr: number[] = C.RAID_RISK_PCT;
  return arr[Math.min(step, arr.length) - 1];
}
function raidLoot(step: number): number {
  const arr: number[] = C.RAID_LOOT;
  return step <= 0 ? 0 : arr[Math.min(step, arr.length) - 1];
}

function raidView(c: any) {
  if (c.raid) {
    const done = c.raid.step;
    const last = (C.RAID_RISK_PCT as number[]).length;
    return {
      state: 'active',
      step: done,
      total: last,
      loot: raidLoot(done),                                  // что унесём, если отойти сейчас
      nextRisk: done < last ? raidRisk(done + 1) : null,     // цена следующего шага
      nextLoot: done < last ? raidLoot(done + 1) : null,
      atEnd: done >= last,
    };
  }
  const left = cdLeft(c, 'raid');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return {
    state: 'ready',
    total: (C.RAID_RISK_PCT as number[]).length,
    firstRisk: raidRisk(1),
    firstLoot: raidLoot(1),
    maxLoot: raidLoot((C.RAID_LOOT as number[]).length),
  };
}

function raidStart(user: User) {
  const c = clubState(user);
  if (c.raid) return raidView(c);
  if (cdLeft(c, 'raid') > 0) throw new u.ApiError('Группа отдыхает после выхода. Загляните позже.');
  gate(c);
  c.raid = { step: 0 };
  return raidView(c);
}

// Шаг вперёд: бросок против риска следующего рубежа
function raidPush(user: User, notices: Notices) {
  const c = clubState(user);
  if (!c.raid) throw new u.ApiError('Группа не вышла на маршрут');
  const last = (C.RAID_RISK_PCT as number[]).length;
  if (c.raid.step >= last) throw new u.ApiError('Дальше рубежей нет — отходите с добычей');
  require('./dailyQuests').bump(user, 'clubPlayed', 1);

  const next = c.raid.step + 1;
  const risk = raidRisk(next);
  if (u.rnd(1, 100) <= risk) {
    const lost = raidLoot(c.raid.step);
    c.raid = null;
    setCd(c, 'raid', C.RAID_CD_FAIL_MIN);
    return { result: 'lost', step: next, risk, lostLoot: lost };
  }
  c.raid.step = next;
  return { result: 'passed', ...raidView(c) };
}

// Отход с добычей — единственный способ что-то унести
function raidPull(user: User, notices: Notices) {
  const c = clubState(user);
  if (!c.raid) throw new u.ApiError('Группа не вышла на маршрут');
  const step = c.raid.step;
  if (step <= 0) {
    // Отойти, не взяв ни одного рубежа, можно — но и уносить нечего.
    // Кулдаун за это не ставим: игрок ничего не сыграл.
    c.raid = null;
    return { result: 'empty', step: 0, reward: 0 };
  }
  c.raid = null;
  const reward = payout(user, 'raid', raidLoot(step), notices);
  setCd(c, 'raid', C.RAID_CD_WIN_MIN);
  notices.push(`🌒 Группа вернулась с ${step}-го рубежа.${reward ? ' +🪙 ' + reward : ''}`);
  return { result: 'home', step, reward };
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
  gate(c);
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
  const reward = payout(user, 'dice', combo.gold, notices);
  setCd(c, 'dice', C.DICE_CD_WIN_MIN);
  notices.push(`🎲 ${combo.name}!${reward ? ' +🪙 ' + reward : ''}`);
  return { result: 'win', dice, combo, reward };
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
  gate(c);

  const arr = (Array.isArray(bids) ? bids : []).map((x: any) => Math.max(0, u.toInt(x, 0)));
  if (arr.length !== C.BIDS_LOTS) throw new u.ApiError(`Нужно указать ставку по каждому из ${C.BIDS_LOTS} лотов`);
  const total = arr.reduce((s, x) => s + x, 0);
  if (total > C.BIDS_POINTS) throw new u.ApiError(`Всего очков влияния: ${C.BIDS_POINTS}, вы распределили ${total}`);
  // Только после проверки ставок — см. пояснение в safeTry
  require('./dailyQuests').bump(user, 'clubPlayed', 1);

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
    reward = payout(user, 'bids', reward, notices);
    setCd(c, 'bids', C.BIDS_CD_WIN_MIN);
    notices.push(`💼 Аукцион: выиграно лотов ${won}/${C.BIDS_LOTS}${sweep ? ' (все!)' : ''}.${reward ? ' +🪙 ' + reward : ''}`);
  } else {
    setCd(c, 'bids', C.BIDS_CD_FAIL_MIN);
  }
  return { result: reward > 0 ? 'win' : 'lost', lots, won, sweep, reward };
}


// ===================================================================
// 6. ТАКТИЧЕСКАЯ ДУЭЛЬ — камень-ножницы-бумага на родах войск.
//    Треугольник не выдуман, а взят из самой игры: у техники три типа
//    (ground / air / sea). ПВО наземных сбивает авиацию, авиация топит
//    флот, флот накрывает берег.
//
//    Против случайного бота это было бы 33% и никакого решения. Поэтому
//    генерал играет по ПРИВЫЧКЕ: повторяет род, которым только что
//    выиграл, и уходит от того, которым проиграл. История дуэли видна
//    игроку целиком — значит привычку можно прочитать и наказать.
// ===================================================================
const TACTIC_KINDS = [
  { id: 'ground', icon: '🛡', name: 'Наземные', beats: 'air',    note: 'ПВО сбивает авиацию' },
  { id: 'air',    icon: '✈', name: 'Авиация',  beats: 'sea',    note: 'авиация топит флот' },
  { id: 'sea',    icon: '🚢', name: 'Флот',     beats: 'ground', note: 'флот накрывает берег' },
];
const TACTIC_BY_ID: Record<string, any> = Object.fromEntries(TACTIC_KINDS.map((k) => [k.id, k]));

function tacticReward(foeScore: number): number {
  if (foeScore === 0) return C.TACTIC_REWARD_CLEAN;
  if (foeScore === 1) return C.TACTIC_REWARD_SOLID;
  return C.TACTIC_REWARD_CLOSE;
}

function tacticView(c: any) {
  if (c.tactic) {
    return {
      state: 'active',
      kinds: TACTIC_KINDS,
      my: c.tactic.my, foe: c.tactic.foe,
      needed: C.TACTIC_WINS_NEEDED,
      rounds: c.tactic.rounds,      // [{ mine, foe, res }] — вся история, это и есть подсказка
    };
  }
  const left = cdLeft(c, 'tactic');
  if (left > 0) return { state: 'cooldown', cooldownSec: left };
  return {
    state: 'ready', kinds: TACTIC_KINDS, needed: C.TACTIC_WINS_NEEDED,
    rewardMax: C.TACTIC_REWARD_CLEAN, rewardMin: C.TACTIC_REWARD_CLOSE,
  };
}

// Ход генерала. Привычка задана явно и одним числом (TACTIC_BOT_SWITCH_PCT),
// чтобы её можно было ослабить или усилить, не переписывая игру.
function tacticBotPick(d: any): string {
  const ids = TACTIC_KINDS.map((k) => k.id);
  const roll = u.rnd(1, 100) <= C.TACTIC_BOT_SWITCH_PCT;
  if (d.foeWonWith && roll) return d.foeWonWith;                       // выиграл — повторяет
  if (d.foeLostWith && roll) return u.pick(ids.filter((x) => x !== d.foeLostWith)); // проиграл — уходит
  return u.pick(ids);
}

function tacticStart(user: User) {
  const c = clubState(user);
  if (c.tactic) return tacticView(c);
  if (cdLeft(c, 'tactic') > 0) throw new u.ApiError('Генерал разбирает прошлую дуэль. Загляните позже.');
  gate(c);
  c.tactic = { my: 0, foe: 0, rounds: [], foeWonWith: null, foeLostWith: null };
  return tacticView(c);
}

function tacticPlay(user: User, kind: any, notices: Notices) {
  const c = clubState(user);
  if (!c.tactic) throw new u.ApiError('Дуэль не начата');
  const mine = String(kind || '');
  if (!TACTIC_BY_ID[mine]) throw new u.ApiError('Выберите род войск');
  // Поручение засчитываем только за настоящий ход — см. пояснение в safeTry
  require('./dailyQuests').bump(user, 'clubPlayed', 1);

  const d = c.tactic;
  const foe = tacticBotPick(d);
  let res: 'win' | 'lose' | 'draw';
  if (mine === foe) res = 'draw';
  else if (TACTIC_BY_ID[mine].beats === foe) res = 'win';
  else res = 'lose';

  d.rounds.push({ mine, foe, res });
  // Ничья не считается раундом по очкам, но остаётся в истории: она тоже
  // говорит игроку, что генерал сейчас думает.
  if (res === 'win') { d.my++; d.foeWonWith = null; d.foeLostWith = foe; }
  if (res === 'lose') { d.foe++; d.foeWonWith = foe; d.foeLostWith = null; }

  const need = C.TACTIC_WINS_NEEDED;
  if (d.my >= need) {
    const foeScore = d.foe;
    const rounds = d.rounds;
    c.tactic = null;
    const reward = payout(user, 'tactic', tacticReward(foeScore), notices);
    notices.push(`⚔ Дуэль выиграна ${need}:${foeScore}!${reward ? ' +🪙 ' + reward : ''}`);
    return { result: 'win', my: need, foe: foeScore, rounds, reward, last: { mine, foe, res } };
  }
  if (d.foe >= need) {
    const myScore = d.my;
    const rounds = d.rounds;
    c.tactic = null;
    setCd(c, 'tactic', C.TACTIC_CD_FAIL_MIN);
    return { result: 'lose', my: myScore, foe: need, rounds, last: { mine, foe, res } };
  }
  return { result: res, my: d.my, foe: d.foe, rounds: d.rounds, last: { mine, foe, res } };
}

export = {
  view,
  prefStart, prefHit, prefStand,
  safeTry,
  raidStart, raidPush, raidPull,
  diceStart, diceReroll, diceFinish,
  bidsPlay,
  tacticStart, tacticPlay,
};
