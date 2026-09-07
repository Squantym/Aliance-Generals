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
//   2) Сейф штаба — общий на весь мир код («быки и коровы»).
//   3) Тактическая дуэль — камень-ножницы-бумага на родах войск.
//   6) Напёрстки полевой кухни — три котелка, ставка и честная треть.
// Состояние каждой игры хранится в user.club.
//
// Игры 4 и 5 — «Радиоперехват» и «Снайперская дуэль» — идут против
// живого человека, и состояние у них общее на двоих. Они живут в
// src/services/clubMatch.ts, но золото берут отсюда же: через kassa.
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import db = require('../core/db');
import safeCrack = require('./safeCrack');
import antibot = require('./antibot');
import type { User, Notices } from '../types';

const C = config.CLUB;

// Гарантируем структуру состояния клуба у игрока
function clubState(user: User): any {
  if (!user.club) user.club = {};
  const c: any = user.club;
  if (!c.cd) c.cd = {};           // кулдауны: { all, pref, tactic, thimble, intercept, sniper }
  if (c.pref === undefined) c.pref = null;
  if (c.safe === undefined) c.safe = null;

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
    player.addGold(user, give, GAIN_SRC[game] || 'club_other');
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

// Статьи расхода и возврата — строками, а не склейкой из имени игры.
// В сводке владельца каждая статья показывается по-русски (stats.ts), и
// склеенное имя попало бы туда как «club_». Забыл строку — игра просто
// не возьмёт взнос, и это видно сразу.
const GAIN_SRC: Record<string, string> = {
  pref:      'club_pref',
  safe:      'club_safe',
  tactic:    'club_tactic',
  thimble:   'club_thimble',
  intercept: 'club_intercept',
  sniper:    'club_sniper',
};
const STAKE_SRC: Record<string, string> = {
  thimble:   'club_thimble_stake',
  intercept: 'club_intercept_stake',
  sniper:    'club_sniper_stake',
};
const BACK_SRC: Record<string, string> = {
  thimble:   'club_thimble_back',
  intercept: 'club_intercept_back',
  sniper:    'club_sniper_back',
};

// Взнос за платную игру: и золото, и запись в бюджет — одним местом.
// Раньше каждая игра делала это сама, и новая игра легко забывала
// вернуть взнос в бюджет — потолок начинал считать валом.
function takeStake(user: User, game: string, amount: number): void {
  const need = Math.max(0, Math.round(amount));
  const src = STAKE_SRC[game];
  if (!src) throw new u.ApiError('Игра не заведена в кассе клуба');
  if ((user.gold || 0) < need) {
    throw new u.ApiError(`Ставка — 🪙 ${need}, у вас ${user.gold || 0}`);
  }
  player.spendGold(user, need, src);
  refundBudget(clubState(user), need);
}

// Возврат взноса: ничья, отменённая очередь, несостоявшийся матч.
// Бюджет откатываем обратно — иначе возврат считался бы выигрышем и
// расширял суточный потолок на ровном месте.
function giveBack(user: User, game: string, amount: number): number {
  const back = Math.max(0, Math.round(amount));
  if (back <= 0) return 0;
  const c = clubState(user);
  const b = budget(c);
  c.dayGold = b.spent + back;
  player.addGold(user, back, BACK_SRC[game] || 'club_back');
  return back;
}

// ── ПУЛЬС: каждое действие клуба проходит через эту функцию ───────
//
// Клуб — самое привлекательное место для скрипта во всей игре: короткие
// действия, понятный ответ, деньги на выходе. Поэтому ритм действий
// здесь и меряется.
//
// Замер до этой правки: сто действий подряд с машинной регулярностью не
// поднимали подозрительность НИ НА ЕДИНИЦУ — antibot.track не вызывался
// вообще ниоткуда, поле user.behavior даже не заводилось. Панель при
// этом показывала владельцу «подозрительность: 0» как измерение, хотя
// увеличивать её было некому.
//
// Точка входа одна и намеренно: заведи кто-нибудь новую игру и забудь
// про пульс — она станет дырой, через которую скрипт работает
// незамеченным. Тест проверяет, что мимо beat() не ходит ни одна.
function beat(user: User, what: string): void {
  try { antibot.track(user, 'club:' + what); } catch (e) {}
  const extra = (() => { try { return antibot.throttleSec(user); } catch (e) { return 0; } })();
  if (extra > 0) {
    // Не запрет, а задержка. Живой игрок теряет полминуты, скрипт теряет
    // пропускную способность — то единственное, ради чего он и нужен.
    const c = clubState(user);
    const left = cdLeft(c, 'bot');
    if (left > 0) {
      throw new u.ApiError(`Штаб проверяет ваши действия. Следующий заход через ${left} с.`);
    }
    c.cd.bot = Date.now() + extra * 1000;
  }
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
    tactic: tacticView(c),
    thimble: thimbleView(c),
    // Игры против живого соперника живут отдельным модулем: у них общая
    // очередь, общие часы и состояние на двоих, а не в user.club.
    intercept: require('./clubMatch').interceptView(user),
    sniper: require('./clubMatch').sniperView(user),
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

// Пример каждой карты для правил: ранг, чего стоит и картинка.
function prefRankTable(): any[] {
  const suits: string[] = config.CARD_SUITS.map((x: any) => x.id);
  return config.CARD_RANKS.map((r: any, i: number) => {
    const info = config.cardInfo(r.id + '-' + suits[i % suits.length]);
    return {
      rank: r.label,
      value: r.value,
      soft: !!r.soft,          // туз: при переборе считается за 1
      img: info ? info.img : null,
      suit: info ? info.suit : '',
      red: info ? info.red : false,
    };
  });
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
    // Таблица достоинств — с картинками настоящих карт. Считает её
    // СЕРВЕР по той же колоде, что и раздаёт: выпиши клиент эти
    // значения у себя — и однажды он покажет «валет 2», когда на
    // сервере уже 3. Масти взяты вразнобой, чтобы это выглядело
    // сдачей, а не таблицей.
    ranks: prefRankTable(),
    // Вероятность выигрыша наружу НЕ отдаётся: игрок садится за стол, а
    // не читает таблицу шансов.
  };
}

function prefStart(user: User, notices?: Notices) {
  const c = clubState(user);
  beat(user, 'pref');
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
  beat(user, 'pref');
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
  beat(user, 'pref');
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
  beat(user, 'safe');
  gate(c);
  const r = safeCrack.attempt(user, guess);
  // Поручение засчитываем за НАСТОЯЩУЮ попытку: safeCrack уже отверг бы
  // мусор вместо кода и слишком частый запрос.
  require('./dailyQuests').bump(user, 'clubPlayed', 1);

  if (r.result === 'win') {
    // Порядок важен: safeCrack уже обрезал награду остатком МИРОВОГО
    // фонда, payout обрежет её личным суточным потолком игрока, и только
    // фактически выданное списывается из фонда. Спиши мы заранее — фонд
    // терял бы то, чего игрок не получил.
    const reward = payout(user, 'safe', r.reward, notices);
    safeCrack.commitFund(reward);
    notices.push(`🗝 Сейф вскрыт! Код был ${r.code}, попыток ушло ${r.attempts}.`
      + (reward ? ` +🪙 ${reward}` : ' Суточный фонд сейфа на сегодня пуст.'));
    return { ...r, reward };
  }
  return r;
}

// ===================================================================
// 3. ТАКТИЧЕСКАЯ ДУЭЛЬ — камень-ножницы-бумага на родах войск.
//    Треугольник не выдуман, а взят из самой игры: у техники три типа
//    (ground / air / sea). ПВО наземных сбивает авиацию, авиация топит
//    флот, флот накрывает берег.
//
//    Против случайного бота это было бы 33% и никакого решения. Поэтому
//    генерал играет по ПРИВЫЧКЕ: повторяет род, которым только что
//    выиграл, и уходит от того, которым проиграл. История дуэли видна
//    игроку целиком — значит привычку можно прочитать и наказать.
// ===================================================================
// Треугольник взят с наставления клуба (img/club/tactic.webp) и обязан
// совпадать с ним до стрелки: пехота бьёт флот, флот бьёт авиацию,
// авиация бьёт пехоту. Раньше в коде стоял обратный круг — игрок,
// прочитавший наставление, играл бы ровно наоборот.
const TACTIC_KINDS = [
  // beatsRu — «кого бьёт» в винительном падеже, ровно как подписано на
  // наставлении. Склонять на клиенте нечем: «Флот бьёт авиация» — это
  // первое, что получится из name.
  { id: 'ground', icon: '🪖', name: 'Пехота',  beats: 'sea',    beatsRu: 'флот',
    img: '/img/club/kind-ground.webp', note: 'десант берёт корабли у берега' },
  { id: 'sea',    icon: '🚢', name: 'Флот',    beats: 'air',    beatsRu: 'авиацию',
    img: '/img/club/kind-sea.webp',    note: 'корабельное ПВО сбивает авиацию' },
  { id: 'air',    icon: '✈', name: 'Авиация', beats: 'ground', beatsRu: 'пехоту',
    img: '/img/club/kind-air.webp',    note: 'авиация накрывает пехоту с воздуха' },
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

// Ход генерала: чистый случай, каждый раунд заново.
//
// Раньше здесь была ПРИВЫЧКА — повторить выигравший род, уйти от
// проигравшего. Она делала игру про наблюдательность, и по замеру
// внимательный игрок брал 64% против 48% у случайного. Обратная сторона
// та же цифра: закономерность, которую человек замечает иногда, скрипт
// читает всегда и целиком. То есть шаблон работал на автоматизацию
// сильнее, чем на людей.
//
// Со случайным выбором читать нечего никому. Игра стала чистой удачей —
// это осознанная плата за то, что у скрипта здесь нет преимущества
// перед человеком.
function tacticBotPick(_d: any): string {
  return u.pick(TACTIC_KINDS.map((k) => k.id));
}

function tacticStart(user: User) {
  const c = clubState(user);
  beat(user, 'tactic');
  if (c.tactic) return tacticView(c);
  if (cdLeft(c, 'tactic') > 0) throw new u.ApiError('Генерал разбирает прошлую дуэль. Загляните позже.');
  gate(c);
  c.tactic = { my: 0, foe: 0, rounds: [] };
  return tacticView(c);
}

function tacticPlay(user: User, kind: any, notices: Notices) {
  const c = clubState(user);
  if (!c.tactic) throw new u.ApiError('Дуэль не начата');
  beat(user, 'tactic');
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
  // Ничья не считается раундом по очкам, но остаётся в истории — просто
  // как летопись партии: предсказать по ней нечего.
  if (res === 'win') d.my++;
  if (res === 'lose') d.foe++;

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

// ===================================================================
// 6. НАПЁРСТКИ ПОЛЕВОЙ КУХНИ — три котелка, под одним паёк.
//
//    Самая короткая игра клуба: одно нажатие, мгновенный ответ. Держится
//    она не на защите, а на арифметике — ставка 10, выигрыш 20, шанс
//    ровно треть. Ожидание 6.7 против 10, и никакая скорость перебора
//    этого не меняет: чем больше партий, тем ближе результат к минусу.
//    Котелок выбирается сервером в момент хода, поэтому «подсмотреть»
//    его в ответе нельзя — его ещё не существует.
// ===================================================================
function thimbleView(c: any) {
  const left = cdLeft(c, 'thimble');
  return {
    state: left > 0 ? 'cooldown' : 'ready',
    cooldownSec: left,
    pots: C.THIMBLE_POTS,
    entry: C.THIMBLE_ENTRY,
    win: C.THIMBLE_WIN,
    cdMin: C.THIMBLE_CD_MIN,
    last: c.thimbLast || null,
  };
}

function thimblePlay(user: User, pot: any, notices: Notices) {
  const c = clubState(user);
  beat(user, 'thimble');
  if (cdLeft(c, 'thimble') > 0) throw new u.ApiError('Кашевар перекладывает котелки. Загляните позже.');
  gate(c);
  const n = u.toInt(pot, -1);
  if (n < 0 || n >= C.THIMBLE_POTS) throw new u.ApiError('Выберите котелок');

  takeStake(user, 'thimble', C.THIMBLE_ENTRY);
  require('./dailyQuests').bump(user, 'clubPlayed', 1);

  const hidden = u.rnd(0, C.THIMBLE_POTS - 1);
  const won = hidden === n;
  setCd(c, 'thimble', C.THIMBLE_CD_MIN);
  let reward = 0;
  if (won) {
    // Игра платная — общий перерыв на весь клуб она не взводит
    reward = payout(user, 'thimble', C.THIMBLE_WIN, notices, false);
    notices.push(`🍲 Паёк ваш!${reward ? ' +🪙 ' + reward : ''}`);
  } else {
    notices.push('🍲 Пусто. Паёк был под другим котелком.');
  }
  c.thimbLast = { pot: n, hidden, won, at: Date.now() };
  return { result: won ? 'win' : 'lose', pot: n, hidden, reward, entry: C.THIMBLE_ENTRY };
}

export = {
  view,
  prefStart, prefHit, prefStand,
  safeTry,
  tacticStart, tacticPlay,
  thimblePlay,
  // Касса клуба для игр, которые живут в другом модуле (clubMatch).
  // Отдана намеренно одним объектом: чтобы новая игра не завела себе
  // второй путь к золоту в обход потолка, ей нечем это сделать — кроме
  // этих функций, наружу из клуба денег не выходит.
  kassa: { clubState, budget, payout, takeStake, giveBack, gate, beat, setCd, cdLeft },
};
