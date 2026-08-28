// ===================================================================
// src/services/player.ts — «сердце» игрока
// Здесь всё, что описывает состояние бойца: ресурсы и их регенерация,
// опыт/уровни, навыки, расчёт армии и боевой мощи, доход построек,
// банк, профиль. Другие сервисы опираются на этот модуль.
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import type { User, Notices } from '../types';

const HOUR = config.INCOME_PERIOD_MS;

function users(): Record<string, User> { return db.load('users', {}); }
function alliances(): Record<string, any> { return db.load('alliances', {}); }

// Скидка/бонус от трофеев по ключу apply (hospital, upkeep, bank_fee и т.д.)
function trophyDiscountPct(user: User, applyKey: string): number {
  try { return require('./trophies').discountPct(user, applyKey); }
  catch (e) { return 0; }
}

// Множитель скорости восстановления от «Военно-медицинского корпуса» легиона.
// Работает ТОЛЬКО пока игрок реально участвует в активном бою легиона
// (фаза prep/active и он в списке бойцов). Вне боя всегда 1.
function medcorpsRegenMul(user: User): number {
  try {
    if (!user.legionId) return 1;
    const l = require('../core/db').load('legions', {})[user.legionId];
    if (!l || !l.activeBattle || !l.battleBuildings) return 1;
    const lvl = l.battleBuildings['medcorps'] || 0;
    if (lvl <= 0) return 1;
    const battle = require('../core/db').load('battles', {})[l.activeBattle.battleId];
    if (!battle || battle.phase === 'done') return 1;
    if (!battle.combatants || !battle.combatants[user.id]) return 1;   // не участвует
    const def = config.LEGION_BATTLE_BUILDING_BY_ID['medcorps'];
    return 1 + lvl * ((def && def.perLvl) || 10) / 100;
  } catch (e) { return 1; }
}

// Итоговая мощь атаки/защиты с учётом ВСЕХ модификаторов:
//   - страна (typeMul, atkAll, defAll, defType)  — уже в buildArmy
//   - модернизация Mk1/Mk2                       — уже в buildArmy
//   - клановые постройки легиона                 — уже в buildArmy
//   - трофеи «Медаль за отвагу» и «Стальной щит» — добавляются здесь
//   - временные эффекты (допинг и т.п.)          — через effMul
// Эта функция используется и в бою, и в отображении профиля/me —
// чтобы игрок видел те же числа, с которыми реально пойдёт в бой.
// debuffs — опциональный дебафф диверсантов противника: {ground,air,sea,secret,building}
// (доли 0..1, напр. 0.1 = -10%). Применяется к КАЖДОМУ виду техники
// отдельно, ДО трофеев/временных эффектов — те продолжают действовать
// на итоговую (уже уменьшенную) мощь, как и раньше.
function totalPower(user: User, mode: string, debuffs?: any): any {
  const army = buildArmy(user, mode);
  let trophies;
  try { trophies = require('./trophies'); } catch (e) { trophies = null; }
  const trophyAtk = trophies ? trophies.atkBonus(user) : 0;
  const trophyDef = trophies ? trophies.defBonus(user) : 0;
  const tempMul = effMul(user, mode === 'atk' ? 'atk_pct' : 'def_pct');

  // Мощь техники: если задан дебафф диверсантов — пересобираем из
  // разбивки по типам (каждый вид уменьшен своим % отдельно), иначе —
  // как раньше, единым числом army.power.
  let armyBase = army.power;
  if (debuffs) {
    const bt = army.byType;
    armyBase = Math.round(
      bt.ground * (1 - Math.min(1, debuffs.ground || 0)) +
      bt.air    * (1 - Math.min(1, debuffs.air || 0)) +
      bt.sea    * (1 - Math.min(1, debuffs.sea || 0)) +
      bt.secret * (1 - Math.min(1, debuffs.secret || 0))
    );
  }

  // Мощь техники (с бонусом страны по типу + легионом) × трофей × эффекты
  const armyPow = Math.round(armyBase * tempMul * (1 + (mode === 'atk' ? trophyAtk : trophyDef)));

  // В защите добавляем постройки ОТДЕЛЬНО: трофей на них НЕ действует.
  // Бонус страны (defAll) — действует, т.к. это «государственная» скидка.
  let buildPow = 0;
  if (mode === 'def') {
    buildPow = buildingDef(user) * config.BUILDING_DEF_POWER;
    if (debuffs && debuffs.building) buildPow = Math.round(buildPow * (1 - Math.min(1, debuffs.building)));
    const country = config.COUNTRY_BY_ID[user.country];
    if (country && country.mod) {
      const mm = country.mod;
      if (typeof mm.defAll === 'number') buildPow = Math.round(buildPow * mm.defAll);
      else if (mm.defAll === true) buildPow = Math.round(buildPow * 1.05);
    }
  }

  let totalPow = armyPow + buildPow;

  // Штраф «без ушей»: -10% к атаке и защите на 6 часов после потери
  // второго уха (применяется к итоговой мощи, включая постройки)
  if (user.earPenaltyUntil && user.earPenaltyUntil > Date.now()) {
    totalPow = Math.round(totalPow * (1 - config.EARS.PENALTY_PCT));
  }

  return { ...army, power: totalPow, basePower: army.power };
}

// ---------- Максимумы ресурсов с учётом навыков ----------
function maxima(user: User) {
  return {
    hp: config.PLAYER.BASE_HP + user.skills.health * config.PLAYER.HP_PER_SKILL,
    en: config.PLAYER.BASE_ENERGY + user.skills.energy * config.PLAYER.EN_PER_SKILL,
    am: config.PLAYER.BASE_AMMO + user.skills.ammo * config.PLAYER.AMMO_PER_SKILL,
  };
}

// Регенерация одного ресурса: r = {cur, t}, t — время последнего тика
function applyRegen(r: any, max: number, intervalSec: number, now: number, perTick = 1): void {
  const interval = intervalSec * 1000;
  if (r.cur >= max) { r.t = now; return; }
  const ticks = Math.floor((now - r.t) / interval);
  if (ticks > 0) {
    r.cur = Math.min(max, r.cur + ticks * perTick);
    r.t += ticks * interval;
    if (r.cur >= max) r.t = now;
  }
}

// ---------- Деньги, золото, опыт ----------
function addMoney(user: User, amount: number, earned = true): void {
  // Учёт для расширенной статистики (VIP, пункт 9)
  try { require('./stats').track(user, amount >= 0 ? 'moneyEarned' : 'moneySpent', '', amount); } catch (e) {}

  user.dollars = Math.max(0, Math.round(user.dollars + amount));
  // Счётчик «всего заработано» нужен достижению «Олигарх»
  if (amount > 0 && earned) user.counters.moneyEarned += Math.round(amount);
}

// Добавить именно боевой заработок (трофеи с боёв) — отдельный счётчик для зала славы
function addBattleLoot(user: User, amount: number): void {
  if (amount > 0) {
    user.counters.battleLoot = (user.counters.battleLoot || 0) + Math.round(amount);
    addMoney(user, amount, true);
  }
}

// ── Копилка расширенной статистики (VIP, пункт 9) ────────────────
// Отдельный объект stats: сюда пишутся суммы, которых нет в обычных
// счётчиках — заработанное и потраченное по источникам, потери техники.
// Хранится у игрока и накапливается всю жизнь аккаунта.


// ── Золото: начисление, списание и раздельный учёт ────────────────
//
// Зачем раздельный учёт. Купленное за деньги золото и подаренное игрой —
// с точки зрения закона совершенно разные вещи. При возврате платежа или
// его оспаривании нужно списать НЕИСПОЛЬЗОВАННОЕ КУПЛЕННОЕ, не тронув
// заработанное игроком за месяцы. Пока баланс — одно число без истории,
// это невозможно: отличить нечем, и любой возврат превращается либо в
// подарок мошеннику, либо в изъятие честно заработанного.
//
// Как считаем. Общий баланс остаётся одним числом user.gold — арифметика
// игры не меняется вовсе. Рядом лежит goldPaid: сколько из этого баланса
// куплено за деньги. Начисление за деньги поднимает оба, любое списание
// опускает goldPaid до баланса, если тот стал меньше.
//
// Из этого правила само собой следует то, что обещают Правила платежей:
// СНАЧАЛА ТРАТИТСЯ БОНУСНОЕ И ЗАРАБОТАННОЕ, купленное — последним. Оно
// в пользу игрока: оплаченное дольше остаётся доступным к возврату.
//
// Сегодня goldPaid равен нулю у всех — платежи не подключены. Значит
// min(0, баланс) = 0 всегда, и на живой экономике эта правка не меняет
// ни одного числа. Вводить её нужно ДО запуска платежей: задним числом
// источник начислений не восстановить.

// Сколько из нынешнего баланса куплено за деньги.
function paidGold(user: User): number {
  return Math.max(0, Math.min(Number((user as any).goldPaid) || 0, Number(user.gold) || 0));
}

// Привести goldPaid к балансу после его изменения.
function syncPaid(user: User): void {
  const paid = paidGold(user);
  if (paid) (user as any).goldPaid = paid;
  else delete (user as any).goldPaid;   // ноль не храним — поле есть только у плативших
}

// source — откуда пришло золото: quest, season, event, purchase, admin.
// Нужен для разбивки в расширенной статистике.
// paid = true — золото куплено за деньги. Ставить его имеет право только
// платёжный код после подтверждённого платежа.
function addGold(user: User, amount: number, source?: string, paid?: boolean): void {
  // Источник золота передаётся вызывающим кодом через третий аргумент
  try {
    const src = (arguments as any)[2] || 'other';
    require('./stats').track(user, amount >= 0 ? 'goldGot' : 'goldSpent', String(src), amount);
  } catch (e) {}

  user.gold = Math.max(0, Math.round(user.gold + amount));
  if (paid && amount > 0) {
    (user as any).goldPaid = (Number((user as any).goldPaid) || 0) + Math.round(amount);
  }
  syncPaid(user);
}

// Списание. Единственная точка, через которую золото уходит с баланса.
// Раньше тридцать мест по всему коду делали `user.gold -= цена` напрямую,
// и добавить к ним учёт источника было негде: пришлось бы править
// тридцать мест и не забыть ни одного при следующей правке.
//
// Арифметика та же, что была: вычитание без пола по нулю. Проверку
// «хватает ли» по-прежнему делает вызывающий код — здесь её нет
// намеренно, чтобы молча не превратить ошибку расчёта в бесплатную
// покупку.
function spendGold(user: User, amount: number, reason?: string): void {
  const n = Math.round(Number(amount) || 0);
  if (n <= 0) return;
  try { require('./stats').track(user, 'goldSpent', String(reason || 'other'), -n); } catch (e) {}
  user.gold -= n;
  syncPaid(user);
}

// Множитель опыта от страны (Украина +7%)
function xpMul(user: User): number {
  const c = config.COUNTRY_BY_ID[user.country];
  return (c && c.mod.xp) || 1;
}

// Начислить опыт; при достижении порога — повышение уровня,
// +3 очка навыков и полное восстановление ресурсов
function addXp(user: User, amount: number, notices: Notices): number {
  // «Сыворотка омоложения» с чёрного рынка полностью останавливает набор
  // опыта. Проверка стоит в ЕДИНСТВЕННОЙ точке начисления, поэтому
  // перекрывает сразу всё: бои, задания, спецоперации, события, награды.
  // Опыт именно сгорает, а не откладывается — иначе после окончания
  // действия игрок разом получил бы всё накопленное и подскочил в уровне.
  if (isXpBlocked(user)) return 0;
  // VIP: +30% к любому получаемому опыту
  amount = Math.round(amount * require('./vip').xpMul(user));
  // К опыту применяется множитель страны, клановый бонус и глобальный бонус админа
  const legionXp = legionBonus(user, 'xp');
  let globalXpMul = 1;
  try { globalXpMul = require('./globalBuffs').multiplier('xp'); } catch (e) {}
  const realXp = Math.max(0, Math.round(amount * xpMul(user) * (1 + legionXp) * globalXpMul));
  user.xp += realXp;
  let ups = 0;
  while (user.level < config.PLAYER.MAX_LEVEL && user.xp >= config.xpToNext(user.level)) {
    user.xp -= config.xpToNext(user.level);
    user.level++;
    user.skillPoints += config.PLAYER.SKILLPOINTS_PER_LEVEL;
    ups++;
  }
  if (ups > 0) {
    const mx = maxima(user);
    user.res.hp.cur = mx.hp; user.res.en.cur = mx.en; user.res.am.cur = mx.am;
    const now = Date.now();
    user.res.hp.t = now; user.res.en.t = now; user.res.am.t = now;
    if (notices) notices.push(`⭐ Новый уровень: ${user.level}! +${ups * config.PLAYER.SKILLPOINTS_PER_LEVEL} очка(ов) навыков, ресурсы восстановлены.`);
  }
  user.counters.level = user.level;
  // Реферальная награда пригласившему при достижении 50 уровня
  if (ups > 0 && user.level >= 50) {
    try { require('./features').onReferralLevelUp(user); } catch (e) {}
  }
  return realXp; // реальный XP с учётом всех бонусов
}

// ---------- Навыки ----------
function spendSkill(user: User, stat: string): any {
  const cost = config.SKILL_COSTS[stat];
  if (!cost) throw new u.ApiError('Неизвестный навык');
  // Потолок навыка (жестокость/ловкость). Дальше — бессмысленно (крит/уворот
  // упираются в 50%), поэтому прокачку блокируем ещё на сервере.
  const cap = config.SKILL_CAPS[stat];
  if (cap != null && (user.skills[stat] || 0) >= cap) {
    throw new u.ApiError(`Навык уже на максимуме (${cap})`);
  }
  if (user.skillPoints < cost) throw new u.ApiError(`Не хватает очков навыков (нужно ${cost})`);
  user.skillPoints -= cost;
  user.skills[stat]++;
  // Прирост максимума сразу отдаём и в текущее значение — приятнее играть
  const mx = maxima(user);
  if (stat === 'energy') user.res.en.cur = Math.min(mx.en, user.res.en.cur + config.PLAYER.EN_PER_SKILL);
  if (stat === 'health') user.res.hp.cur = Math.min(mx.hp, user.res.hp.cur + config.PLAYER.HP_PER_SKILL);
  if (stat === 'ammo') user.res.am.cur = Math.min(mx.am, user.res.am.cur + 1);
}

// Сброс всех навыков. Возвращает все вложенные очки, обнуляет навыки, чтобы
// игрок мог перераспределить их заново. 1-я попытка бесплатна, далее берётся
// золото по нарастающей (см. config.skillResetCost).
function resetSkills(user: User): any {
  const done = user.skillResets || 0;
  const cost = config.skillResetCost(done);
  if (cost > 0 && (user.gold || 0) < cost) {
    throw new u.ApiError(`Не хватает золота для сброса (нужно ${cost})`);
  }
  // Считаем, сколько очков было вложено — вернём их полностью
  let refund = 0;
  for (const stat of Object.keys(config.SKILL_COSTS)) {
    refund += (user.skills[stat] || 0) * config.SKILL_COSTS[stat];
  }
  // Нечего возвращать — не даём впустую потратить бесплатную попытку/золото
  if (refund <= 0) throw new u.ApiError('Навыки ещё не распределены — сбрасывать нечего');
  if (cost > 0) spendGold(user, cost, 'player');
  user.skillPoints += refund;
  user.skills = { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 };
  user.skillResets = done + 1;
  // Здоровье/энергия/боеприпасы обнулились → максимумы упали до базовых.
  // Зажимаем текущие значения, чтобы cur не превышал новый max.
  const mx = maxima(user);
  user.res.hp.cur = Math.min(user.res.hp.cur, mx.hp);
  user.res.en.cur = Math.min(user.res.en.cur, mx.en);
  user.res.am.cur = Math.min(user.res.am.cur, mx.am);
  return {
    skillPoints: user.skillPoints,
    skills: { ...user.skills },
    refunded: refund,
    cost,
    skillResets: user.skillResets,
    nextResetCost: config.skillResetCost(user.skillResets),
  };
}

// ---------- Группы (альянс и легион) и вместимость армии ----------
function legions(): Record<string, any> { return db.load('legions', {}); }

function allianceOf(user: User): any {
  return user.allianceId ? alliances()[user.allianceId] || null : null;
}
function legionOf(user: User): any {
  return user.legionId ? legions()[user.legionId] || null : null;
}

function allianceInfo(user: User): any {
  // Личный альянс — у каждого свой счётчик
  const members = (user as any).allianceMembers || 0;
  return { members, bonusCapacity: config.ALLIANCE.PER_MEMBER * members };
}
function legionInfo(user: User): any {
  const l = legionOf(user);
  if (!l) return null;
  const rank = (l.memberRanks || {})[user.id];
  const rankIndex = l.leaderId === user.id ? 4 : (rank || 0);
  const RANKS = ['Новобранец', 'Боец', 'Лидер отряда', 'Зам. Генерала', 'Генерал'];
  return {
    id: l.id, name: l.name, members: l.members.length, leaderId: l.leaderId,
    rankIndex, rankName: RANKS[rankIndex],
  };
}

// Вместимость армии в бой:
//   30 базы + 10 за каждого участника альянса
// Легион capacity НЕ даёт — он работает через клановые постройки и битвы клан-vs-клан
function capacity(user: User) {
  // Личный альянс: бонус от собственного счётчика участников
  const members = (user as any).allianceMembers || 0;
  const aBonus = config.ALLIANCE.PER_MEMBER * members;
  return config.ALLIANCE.BASE_CAPACITY + aBonus;
}

// Бонусы от клановых построек легиона (множители 1.05, 1.10, ...)
// type: 'atk' | 'def' | 'income' | 'xp' | 'loot' | 'war_def' | 'def_loss'
function legionBonus(user: User, type: string): number {
  const l = legionOf(user);
  if (!l || !l.buildings) return 0;
  let pct = 0;
  for (const b of config.LEGION_BUILDINGS) {
    if (b.apply === type) {
      const lvl = l.buildings[b.id] || 0;
      pct += lvl * b.perLvl;
    }
  }
  return pct / 100; // в долях единицы (0.05 = +5%)
}

// ---------- Эффекты (допинг, падлянки, командиры) ----------
// Действует ли сейчас блокировка опыта
function isXpBlocked(user: User): boolean {
  const now = Date.now();
  return (user.effects || []).some((e: any) => e.type === 'xp_block' && e.expiresAt > now);
}

// Сколько минут осталось до конца блокировки (0 — не действует)
function xpBlockLeftMin(user: User): number {
  const now = Date.now();
  let until = 0;
  for (const e of (user.effects || []) as any[]) {
    if (e.type === 'xp_block' && e.expiresAt > now && e.expiresAt > until) until = e.expiresAt;
  }
  return until ? Math.max(1, Math.round((until - now) / 60000)) : 0;
}

function effMul(user: User, type: string): number {
  const now = Date.now();
  // Эффекты одного типа СУММИРУЮТСЯ: допинг +20% и наёмник +100% дают
  // вместе +120% (а не 100%, как было раньше, когда брался только один
  // эффект — из-за этого купленный поверх допинга наёмник «не работал»).
  // Источники независимы: допинг с чёрного рынка, наёмник с аукциона и
  // вражеская падлянка складываются в один итоговый процент.
  let sum = 0;
  for (const e of user.effects) {
    if (e.type === type && e.expiresAt > now) sum += e.value;
  }
  if (!sum) return 1;
  // Нижняя граница: множитель не может уйти в минус, иначе, например,
  // связка сильных дебаффов давала бы отрицательную атаку или доход.
  return Math.max(0, 1 + sum / 100);
}

// Человекочитаемое описание типа эффекта
function effLabel(type: string): string {
  const map: Record<string, string> = {
    atk_pct: 'атака', def_pct: 'защита', loot_pct: 'грабёж',
    income_pct: 'доход', upkeep_pct: 'содержание',
    enemy_atk_pct: 'атака врага', enemy_def_pct: 'защита врага',
    ammo_regen_pct: 'восст. боеприпасов', energy_regen_pct: 'восст. энергии',
    crit_bonus: 'шанс крита', dodge_bonus: 'шанс уворота',
    xp_pct: 'опыт', build_slow_pct: 'замедление строек', research_slow_pct: 'замедление исследований',
    invite_unlimited: 'безлимит приглашений', fatality_immunity: 'иммунитет к фаталити',
    xp_block: 'опыт не начисляется',
  };
  return map[type] || type;
}

function effectsView(user: User): any[] {
  const now = Date.now();
  return user.effects
    .filter((e) => e.expiresAt > now)
    .map((e) => {
      const secLeft = Math.max(0, Math.ceil((e.expiresAt - now) / 1000));
      const h = Math.floor(secLeft / 3600);
      const m = Math.floor((secLeft % 3600) / 60);
      const timeStr = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
      // Флаговые эффекты (value=1, не проценты) показываем как статус
      // Флаговые эффекты (value=1, не проценты) показываем как статус.
      // Сыворотка сюда же: «+100% (опыт не начисляется)» читалось бы как
      // бонус к опыту — ровно наоборот смыслу.
      const isFlag = e.type === 'invite_unlimited' || e.type === 'fatality_immunity' || e.type === 'xp_block';
      const desc = isFlag
        ? effLabel(e.type)
        : `${e.value > 0 ? '+' : ''}${e.value}% (${effLabel(e.type)})`;
      return {
        id: e.id || null,   // id предмета чёрного рынка — для картинки в профиле
        commanderId: (e as any).commanderId || null,  // id наёмника (для портрета)
        merc: !!(e as any).merc,                       // эффект наёмника, не допинг
        name: e.name,
        type: e.type,
        value: e.value,
        desc,
        secLeft,
        timeLeft: timeStr,
        hostile: !!e.hostile,
        byName: e.byName || null,   // кто наложил (видно жертве для подлянок)
      };
    });
}

// ---------- Армия и боевая мощь ----------
// Собирает войско для боя: сперва секретные разработки (они сильнейшие),
// затем обычная техника, отсортированная по нужному параметру,
// пока не упрёмся в вместимость. mode: 'atk' или 'def'.
function buildArmy(user: User, mode: string): any {
  const cap = capacity(user); // лимит ТОЛЬКО для обычной техники (зависит от альянса)
  const country = config.COUNTRY_BY_ID[user.country] || { mod: {} };
  const secretEntries: any[] = [];
  const unitEntries: any[] = [];

  // Секретные разработки: у каждой свои индивидуальные atk/def.
  // С 51 уровня — +1% за каждый уровень выше 50,
  // +0.5% за каждую сверхсекретную в коллекции (только для секретных!).
  // ВАЖНО: секретные разработки — ОТДЕЛЬНЫЙ пул техники, на них НЕ
  // распространяется лимит альянса (capacity). Они участвуют в бою
  // ВСЕГДА полностью, независимо от размера альянса игрока.
  for (const dev of config.SECRET_DEVS) {
    const n = (user.secretDevs || {})[dev.id] || 0;
    if (n > 0) {
      secretEntries.push({
        name: dev.name, count: n, secret: true,
        atk: config.secretAtk(user, dev),
        def: config.secretDef(user, dev),
      });
    }
  }
  if (user.superSecret > 0) {
    secretEntries.push({
      name: config.SUPER_DEV.name, count: user.superSecret, secret: true,
      atk: config.secretAtk(user, config.SUPER_DEV),
      def: config.secretDef(user, config.SUPER_DEV),
    });
  }

  // Обычная техника: по каждому юниту проходим все этапы модернизации.
  // ЭТОТ пул ограничен capacity(user) — растёт от размера альянса
  // (10 единиц техники за каждого человека в альянсе).
  for (const [unitId, rawMk] of Object.entries(user.units)) {
    const cu = config.UNIT_BY_ID[unitId];
    if (!cu) continue;
    // Принудительно приводим к числовым ключам (MongoDB хранит ключи как строки)
    const mkMap = { 0: 0, 1: 0, 2: 0 };
    if (rawMk && typeof rawMk === 'object') {
      for (const k of Object.keys(rawMk)) {
        const nk = Number(k);
        if (nk >= 0 && nk <= 2) mkMap[nk] = Number(rawMk[k]) || 0;
      }
    } else if (typeof rawMk === 'number') {
      mkMap[0] = rawMk; // старый формат
    }
    for (let mk = 0; mk <= 2; mk++) {
      const count = mkMap[mk];
      if (count <= 0) continue;
      let atk = cu.attack * config.MK_MULT[mk];
      let def = cu.defense * config.MK_MULT[mk];
      const mm = country.mod;
      // Бонус по конкретному типу (Германия — ground, Россия — sea, США — air)
      const typeMul = mm.typeMul || 1.05; // обратная совместимость
      if (mm.atkType === cu.type) atk *= typeMul;
      if (mm.defType === cu.type) def *= typeMul;
      // Бонусы по всем типам (Казахстан)
      if (mm.atkAll) atk *= mm.atkAll;
      if ((mm as any).defAll === true) def *= 1.05;          // старый формат
      else if (typeof mm.defAll === 'number') def *= mm.defAll;
      unitEntries.push({
        name: cu.name + (mk ? ` Mk${mk}` : ''),
        unitId, count, secret: false, mk,
        atk: Math.round(atk), def: Math.round(def),
      });
    }
  }

  // Сортировка ТОЛЬКО внутри обычной техники (секретки не участвуют
  // в конкуренции за место — у них отдельный безлимитный пул).
  // Приоритет:
  //   - в АТАКЕ:  сначала ВОЗДУШНАЯ (упор на атаку), затем по числу атаки
  //   - в ЗАЩИТЕ: сначала МОРСКАЯ (упор на защиту), затем по числу защиты
  const priorityType = mode === 'atk' ? 'air' : 'sea';
  unitEntries.sort((a, b) => {
    const cuA = config.UNIT_BY_ID[a.unitId];
    const cuB = config.UNIT_BY_ID[b.unitId];
    const aPrio = cuA && cuA.type === priorityType ? 1 : 0;
    const bPrio = cuB && cuB.type === priorityType ? 1 : 0;
    if (aPrio !== bPrio) return bPrio - aPrio;
    return mode === 'atk' ? b.atk - a.atk : b.def - a.def;
  });

  // Секретные разработки идут в бой ВСЕ ЦЕЛИКОМ (без ограничения cap)
  let power = 0, taken = 0, secretTaken = 0, unitTaken = 0;
  // Разбивка мощи по типам — нужна для дебаффа диверсантов (каждый вид
  // диверсантов режет мощь ТОЛЬКО своего типа техники противника).
  let powerGround = 0, powerAir = 0, powerSea = 0, powerSecret = 0;
  for (const e of secretEntries) {
    e.taken = e.count;
    taken += e.count;
    secretTaken += e.count;
    const p = e.count * (mode === 'atk' ? e.atk : e.def);
    power += p;
    powerSecret += p;
  }

  // Обычная техника ограничена лимитом альянса (cap)
  let left = cap;
  for (const e of unitEntries) {
    const t = Math.min(e.count, left);
    e.taken = t;
    left -= t; taken += t; unitTaken += t;
    const p = t * (mode === 'atk' ? e.atk : e.def);
    power += p;
    const cu = config.UNIT_BY_ID[e.unitId];
    if (cu) {
      if (cu.type === 'ground') powerGround += p;
      else if (cu.type === 'air') powerAir += p;
      else if (cu.type === 'sea') powerSea += p;
    }
    if (left <= 0) break;
  }
  unitEntries.forEach((e) => { if (e.taken === undefined) e.taken = 0; });

  const entries = [...secretEntries, ...unitEntries];

  // Клановые бонусы от построек легиона: умножаем итоговую мощь
  const legionAtk = legionBonus(user, 'atk');
  const legionDef = legionBonus(user, 'def');
  const legionMul = 1 + (mode === 'atk' ? legionAtk : legionDef);
  // Подкрепления союзников по личному альянсу: +% к мощи за каждое активное
  // (усиливается трофеем «Знамя победы»). Действуют и в атаке, и в обороне.
  let reinMul = 1;
  try { reinMul = require('./reinforcements').powerMul(user); } catch (e) {}
  const totalMul = legionMul * reinMul;
  power = Math.round(power * totalMul);
  powerGround = Math.round(powerGround * totalMul);
  powerAir = Math.round(powerAir * totalMul);
  powerSea = Math.round(powerSea * totalMul);
  powerSecret = Math.round(powerSecret * totalMul);
  // taken — общее число (для обратной совместимости), unitTaken/secretTaken —
  // раздельно для корректного отображения «Техники в бою: X / cap»
  // (секретные разработки НЕ входят в cap и не должны путать это число).
  return {
    power, taken, unitTaken, secretTaken, cap, entries,
    byType: { ground: powerGround, air: powerAir, sea: powerSea, secret: powerSecret },
  };
}

// Суммарные очки защиты оборонительных построек
function buildingDef(user: User): number {
  let total = 0;
  for (const [id, count] of Object.entries(user.buildings)) {
    const b = config.BUILDING_BY_ID[id];
    if (b && b.kind === 'defense') total += b.def * count;
  }
  return total;
}

// Доход построек в час (с бонусом страны и эффектом командира)
function totalIncome(user: User): number {
  let total = 0;
  for (const [id, count] of Object.entries(user.buildings)) {
    const b = config.BUILDING_BY_ID[id];
    if (b && b.kind === 'income') total += b.income * count;
  }
  const country = config.COUNTRY_BY_ID[user.country];
  if (country && country.mod.income) total *= country.mod.income;
  total *= (1 + legionBonus(user, 'income'));
  total *= (1 + trophyDiscountPct(user, 'income') / 100); // трофей «Квартмейстер»
  total *= require('./vip').incomeMul(user);               // VIP: +15% к доходу
  return Math.round(total * effMul(user, 'income_pct'));
}

// Содержание всей техники в час (секретные разработки бесплатны)
// ── Принудительная распродажа техники ────────────────────────────
// Когда содержание армии превышает доход построек и деньги кончились,
// техника уходит с молотка за половину цены — ровно столько, чтобы
// закрыть часовой платёж. Так каждый час, пока расходы не станут
// подъёмными. Продаём с САМОЙ ДОРОГОЙ в содержании: она и разоряет.
function sellUnitsForDebt(user: User, debt: number): void {
  if (debt <= 0) return;
  const owned: Array<{ unitId: string; mk: string; count: number; upkeep: number; price: number }> = [];
  for (const [unitId, mkMap] of Object.entries(user.units || {})) {
    const def: any = config.UNIT_BY_ID[unitId];
    if (!def) continue;
    for (const [mk, count] of Object.entries(mkMap as any)) {
      const n = Number(count) || 0;
      if (n > 0) owned.push({ unitId, mk, count: n, upkeep: def.upkeep, price: def.price });
    }
  }
  if (!owned.length) return;
  // Дороже в содержании — первой на продажу
  owned.sort((a, b) => b.upkeep - a.upkeep);

  let need = debt;
  let soldCount = 0;
  let earned = 0;
  for (const it of owned) {
    if (need <= 0) break;
    const perUnit = Math.max(1, Math.floor(it.price * 0.5));   // 50% от цены
    const want = Math.min(it.count, Math.ceil(need / perUnit));
    if (want <= 0) continue;
    (user.units as any)[it.unitId][it.mk] -= want;
    if ((user.units as any)[it.unitId][it.mk] <= 0) delete (user.units as any)[it.unitId][it.mk];
    if (!Object.keys((user.units as any)[it.unitId]).length) delete (user.units as any)[it.unitId];
    const got = perUnit * want;
    earned += got;
    need -= got;
    soldCount += want;
  }
  if (!soldCount) return;

  // Вырученное сверх долга остаётся игроку
  user.dollars = Math.max(0, user.dollars + Math.max(0, earned - debt));
  try {
    require('./notifications').push(user.id, 'forced_sale',
      `⚠️ Содержание армии превысило доход. Продано техники: ${soldCount} ед. за $${u.fmt(earned)} (50% цены).`,
      { sold: soldCount, earned });
  } catch (e) {}
  try {
    require('./auditLog').record({
      userId: user.id, userName: user.name, path: '/system/forced-sale',
      body: { sold: soldCount, earned, debt },
    });
  } catch (e) {}
}

function totalUpkeep(user: User): number {
  let total = 0;
  for (const [unitId, mkMap] of Object.entries(user.units)) {
    const cu = config.UNIT_BY_ID[unitId];
    if (!cu) continue;
    const count = (mkMap[0] || 0) + (mkMap[1] || 0) + (mkMap[2] || 0);
    total += cu.upkeep * count;
  }
  // Трофей «Снабженческие линии» снижает содержание
  total *= (1 - trophyDiscountPct(user, 'upkeep') / 100);
  // VIP: содержание техники дешевле на 15%
  total *= require('./vip').upkeepMul(user);
  return Math.round(total * effMul(user, 'upkeep_pct'));
}

// Общее количество техники одного типа (по всем mk)
function unitTotalCount(user: User, unitId: string): number {
  const m = user.units[unitId];
  if (!m) return 0;
  return (m[0] || 0) + (m[1] || 0) + (m[2] || 0);
}

// Суммарное количество единиц техники во всей армии (все виды, все Mk)
function unitCountTotal(user: User): number {
  let total = 0;
  for (const m of Object.values(user.units || {})) {
    if (!m) continue;
    total += (m[0] || 0) + (m[1] || 0) + (m[2] || 0);
  }
  return total;
}

// Гарантирует наличие структуры { 0, 1, 2 } для юнита
function ensureUnit(user: User, unitId: string): any {
  if (!user.units[unitId]) user.units[unitId] = { 0: 0, 1: 0, 2: 0 };
  const m = user.units[unitId];
  if (m[0] === undefined) m[0] = 0;
  if (m[1] === undefined) m[1] = 0;
  if (m[2] === undefined) m[2] = 0;
  return m;
}

// ---------- Сверхсекретная разработка ----------
// «Абсолют» выдаётся за каждый ПОЛНЫЙ комплект из 9 разных разработок.
// Комплекты не сгорают: 10 штук каждого вида = 10 «Абсолютов».
function syncSuper(user: User, notices: Notices): any {
  if (!user.secretDevs || typeof user.secretDevs !== 'object') user.secretDevs = {};
  if (!user.superSecret) user.superSecret = 0;
  let minCount = Infinity;
  for (const dev of config.SECRET_DEVS) {
    minCount = Math.min(minCount, user.secretDevs[dev.id] || 0);
  }
  if (!Number.isFinite(minCount)) minCount = 0;
  if (minCount > user.superSecret) {
    const gained = minCount - user.superSecret;
    user.superSecret = minCount;
    if (notices) notices.push(`🛸 Собран полный комплект разработок! Получено: ${config.SUPER_DEV.name} ×${gained}`);
    return gained;
  }
  return 0;
}

// ---------- «Освежение» игрока перед каждым запросом ----------
// Лениво досчитываем всё, что должно было произойти со временем:
// регенерацию, почасовой доход, истечение эффектов и окна фаталити.
function refresh(user: User): void {
  const now = Date.now();
  const mx = maxima(user);
  // «Военно-медицинский корпус» легиона ускоряет восстановление ВСЕХ ресурсов,
  // но СТРОГО пока игрок находится в активном бою легиона (вне боя — не даёт
  // ничего). Делим интервал на множитель: +10% за уровень.
  const med = medcorpsRegenMul(user);
  // Трофей «Полевая реанимация» ускоряет восстановление HP
  // VIP срезает ещё 30% — но ПОСЛЕ трофеев и допингов, то есть от уже
  // ускоренного значения: 180 → 90 трофеем → 63 подпиской
  const vipSrv = require('./vip');
  const hpInterval = Math.max(5, vipSrv.regenSeconds(user, Math.round(
    config.REGEN.hp * (1 - trophyDiscountPct(user, 'regen_hp') / 100) / med
  )));
  applyRegen(user.res.hp, mx.hp, hpInterval, now);
  // Трофей «Логистика» снижает интервал регенерации энергии,
  // допинг «Адреналин-Х» дополнительно ускоряет (делим интервал на множитель)
  const enInterval = Math.max(5, vipSrv.regenSeconds(user, Math.round(
    config.REGEN.en * (1 - trophyDiscountPct(user, 'regen_en') / 100) / effMul(user, 'energy_regen_pct') / med
  )));
  applyRegen(user.res.en, mx.en, enInterval, now, config.REGEN.EN_PER_TICK);
  // Трофей «Боевая логистика» + допинг «Конвой» ускоряют боеприпасы
  const amInterval = Math.max(15, vipSrv.regenSeconds(user, Math.round(
    config.REGEN.am * (1 - trophyDiscountPct(user, 'regen_am') / 100) / effMul(user, 'ammo_regen_pct') / med
  )));
  applyRegen(user.res.am, mx.am, amInterval, now);

  // Истёкшие эффекты удаляем
  user.effects = user.effects.filter((e) => e.expiresAt > now);

  // Почасовая выплата: доход минус содержание (может уйти в минус,
  // но баланс не опускается ниже нуля)
  if (!user.lastIncomeAt) user.lastIncomeAt = now;
  const hours = Math.floor((now - user.lastIncomeAt) / HOUR);
  if (hours > 0) {
    // Считаем по часам ОТДЕЛЬНО, а не одной суммой: если содержание
    // превышает доход, армия распродаётся постепенно, и каждый
    // следующий час расход уже меньше. Иначе за сутки отсутствия
    // списалось бы всё разом по старой, самой высокой ставке.
    for (let h = 0; h < hours; h++) {
      const net = totalIncome(user) - totalUpkeep(user);
      if (net >= 0) { addMoney(user, net, true); continue; }
      const debt = -net;
      if (user.dollars >= debt) { user.dollars -= debt; continue; }
      // Денег не хватает — забираем всё, что есть, а недостачу закрываем
      // распродажей техники по 50% цены.
      // ВАЖНО: остаток долга считаем по деньгам ДО списания. Раньше здесь
      // сначала обнулялся счёт, а потом остаток считался от уже нулевого
      // счёта — то есть долг за час снимался ДВАЖДЫ: деньгами и техникой.
      // При долгой отлучке это съедало армию примерно вдвое быстрее, чем
      // положено, и объяснить игроку пропажу было нечем.
      const have = user.dollars;
      user.dollars = 0;
      sellUnitsForDebt(user, debt - have);
    }
    user.lastIncomeAt += hours * HOUR;
  }

  syncSuper(user, []);

  // Просроченное окно фаталити закрывается
  if (user.pendingFatality && (user.pendingFatality as any).exp < now) user.pendingFatality = null;

  // Страховка для существующих игроков: новые поля при обновлении версии
  if (user.legionId === undefined) user.legionId = null;
  if (!user.modernQueue) user.modernQueue = [];
  // Аккаунты, созданные до введения подтверждения почты — считаем
  // подтверждёнными, чтобы старые игроки не потеряли доступ
  if (user.emailVerified === undefined) user.emailVerified = true;
  if (user.email === undefined) user.email = '';

  // Миграция полей собственных ушей игрока (новая механика)
  if (user.earsCurrent === undefined) user.earsCurrent = config.EARS.MAX;
  if (!user.earsLostAt) user.earsLostAt = [];
  if (user.earPenaltyUntil === undefined) user.earPenaltyUntil = 0;
  // Естественная регенерация: каждое ухо восстанавливается через
  // EARS.REGROW_MS после своей потери (не общий таймер на оба сразу)
  const earsNow = Date.now();
  while (user.earsLostAt.length > 0 && user.earsCurrent < config.EARS.MAX
         && earsNow - user.earsLostAt[0] >= config.EARS.REGROW_MS) {
    user.earsLostAt.shift();
    user.earsCurrent = Math.min(config.EARS.MAX, user.earsCurrent + 1);
  }
  // Если оба уха отросли — стираем записи об отрезавших и послание
  if (user.earsCurrent >= config.EARS.MAX && (user.earMessage || (user.earCutters && (user.earCutters[0] || user.earCutters[1])))) {
    user.earCutters = [null, null];
    user.earMessage = null;
  }
  // Штраф снимается автоматически по истечении срока
  if (user.earPenaltyUntil > 0 && earsNow >= user.earPenaltyUntil) {
    user.earPenaltyUntil = 0;
  }

  // Миграция формата техники: принудительно нормализуем. MongoDB может
  // вернуть объект с внутренними прототипами BSON, из-за чего Object.entries
  // и обращение по числовому ключу работают непредсказуемо. Чистим JSON-ом.
  if (!user.units || typeof user.units !== 'object') user.units = {};
  try {
    user.units = JSON.parse(JSON.stringify(user.units));
  } catch (e) {
    user.units = {};
  }
  for (const [unitId, val] of Object.entries(user.units)) {
    if (typeof val === 'number') {
      // Старый формат: одна цифра вместо объекта
      const mkLevel = (user.modernization || {})[unitId] || 0;
      const m = { 0: 0, 1: 0, 2: 0 };
      m[mkLevel] = val;
      user.units[unitId] = m;
    } else if (val && typeof val === 'object') {
      // Новый формат: убеждаемся что все ключи (0,1,2) присутствуют
      // как числа, а не как строки (после MongoDB)
      const m = { 0: 0, 1: 0, 2: 0 };
      for (const k of Object.keys(val)) {
        const numK = Number(k);
        if (numK >= 0 && numK <= 2 && Number.isInteger(numK)) {
          m[numK] = Number(val[k]) || 0;
        }
      }
      user.units[unitId] = m;
    } else {
      // Невалидное значение — удаляем
      delete user.units[unitId];
    }
  }
  // Старое поле modernization больше не нужно
  if (user.modernization) delete user.modernization;

  // Завершение готовых процессов модернизации
  if (user.modernQueue.length > 0) {
    const now = Date.now();
    const remaining: any[] = [];
    for (const proc of user.modernQueue) {
      if (proc.finishesAt <= now) {
        const m = ensureUnit(user, proc.unitId);
        m[proc.toMk] = (m[proc.toMk] || 0) + proc.qty;
      } else {
        remaining.push(proc);
      }
    }
    user.modernQueue = remaining;
  }

  // Завершение готовых процессов прокачки трофеев
  try { require('./trophies').checkCompleted(user); } catch (e) {}
  // Завершение готовых шагов миссий
  try { require('./missions').checkCompleted(user, [] as string[]); } catch (e) {}

  // Страховка: если в конфиг добавили новые трофеи — инициализируем их
  for (const t of config.TROPHIES) {
    if (user.trophies[t.id] === undefined) user.trophies[t.id] = 0;
  }
  if (!user.club) user.club = {};

  // Миграция: поля секретных разработок (могут отсутствовать у старых аккаунтов)
  if (!user.secretDevs || typeof user.secretDevs !== 'object') user.secretDevs = {};
  if (user.superSecret === undefined || user.superSecret === null) user.superSecret = 0;

  // Миграция счётчика боевого заработка
  if (user.counters.battleLoot === undefined) user.counters.battleLoot = 0;

  user.counters.level = user.level;
}

// ---------- Рейтинг и звание ----------
// НАКОПИТЕЛЬНЫЙ рейтинг (переработан). Правила начисления:
//   победа в бою +1, поражение −1;
//   отрезал ухо ИЛИ дал жетон (помиловал) +3;
//   тебе отрезали ухо −3; подорвался на мине −3.
// У старых игроков поле отсутствует → рейтинг начинается с 0 (обнуление всем).
// Начисляют боевые события через addRating(); rating() только читает.
function rating(user: User): number {
  return user.rating || 0;
}

// Изменить рейтинг игрока на delta (может быть отрицательной).
function addRating(user: User, delta: number): void {
  user.rating = (user.rating || 0) + delta;
  db.markUser(user.id);
}

function rank(level: number): string {
  let name = 'Рядовой';
  for (const [lvl, title] of config.RANKS as [number, string][]) {
    if (level >= lvl) name = title;
  }
  return name;
}

function flag(user: User): string {
  const c = config.COUNTRY_BY_ID[user.country];
  return c ? c.flag : '🏳';
}

// Поиск игрока по имени (без учёта регистра) — нужен почте и падлянкам
function findByName(name: string): User | null {
  const low = String(name || '').trim().toLowerCase();
  if (!low) return null;
  return Object.values(users()).find((p) => p.name.toLowerCase() === low) || null;
}

// ---------- Банк ----------
function bankDeposit(user: User, amount: number) {
  amount = u.toInt(amount);
  if (amount <= 0) throw new u.ApiError('Укажите сумму вклада');
  if (amount > user.dollars) throw new u.ApiError('Недостаточно наличных');
  user.dollars -= amount;
  // Базовая комиссия 10% — снижается ОТНОСИТЕЛЬНО трофеем «Налоговая льгота».
  // На 10 уровне трофея даёт −50% от комиссии → итог 5%.
  const taxPct = trophyDiscountPct(user, 'bank_fee');
  const fee = Math.max(0, config.BANK.DEPOSIT_FEE * (1 - taxPct / 100));
  user.bank += Math.floor(amount * (1 - fee));
  // Счётчик ежедневного задания: общая сумма вкладов за день
  require('./dailyQuests').bump(user, 'bankDeposited', amount);
}

function bankWithdraw(user: User, amount: number) {
  amount = u.toInt(amount);
  if (amount <= 0) throw new u.ApiError('Укажите сумму снятия');
  if (amount > user.bank) throw new u.ApiError('В хранилище нет такой суммы');
  user.bank -= amount;
  addMoney(user, amount, false);
}

// Зарезервировать доллары → Резервы для легиона
// 1 000 $ = 1 Резерв. Деньги списываются из наличных, Резервы идут в казну легиона.
function reserveForLegion(user: User, dollars: number, notices: Notices) {
  const legion = require('./legion');
  const l = user.legionId ? require('../core/db').load('legions', {})[user.legionId] : null;
  if (!l) throw new u.ApiError('Вы не состоите в легионе');
  const RATE = require('../../config/gameConfig').LEGION.RESERVE_EXCHANGE_RATE;
  dollars = u.toInt(dollars, 0);
  if (dollars <= 0) throw new u.ApiError('Укажите сумму');
  if (dollars % RATE !== 0) throw new u.ApiError(`Сумма должна быть кратна ${u.fmt(RATE)} (1 Резерв)`);
  if (user.dollars < dollars) throw new u.ApiError('Не хватает долларов');
  const reserves = dollars / RATE;
  user.dollars -= dollars;
  l.reserves = (l.reserves || 0) + reserves;
  require('../core/db').save('legions');
  if (notices) notices.push(`💱 Зарезервировано: $${u.fmt(dollars)} → ${u.fmt(reserves)} РЕЗ для легиона «${l.name}».`);
  return { reserves: l.reserves };
}


// Заготовка: возвращает список пакетов для отображения в банке.
function goldPackages(): any[] {
  return config.GOLD_PACKAGES.map((p) => ({
    id: p.id,
    gold: p.gold,
    bonus: p.bonus,
    total: p.gold + p.bonus,
    priceRub: p.priceRub,
    bonusPct: p.bonus > 0 ? Math.round((p.bonus / p.gold) * 100) : 0,
  }));
}

// Покупка золота. Реальная оплата пока НЕ подключена — это заготовка.
// Возвращает данные для будущей платёжной системы. Золото НЕ зачисляется
// (зачисление произойдёт после подтверждения оплаты платёжным провайдером).
function buyGold(user: User, packId: string) {
  const pack = config.GOLD_PACKAGE_BY_ID[packId];
  if (!pack) throw new u.ApiError('Пакет не найден');
  // TODO: здесь будет создание платежа через платёжную систему.
  // Пока возвращаем «заглушку»: фронт покажет сообщение, что оплата
  // скоро будет доступна.
  return {
    pending: true,
    packId: pack.id,
    gold: pack.gold,
    bonus: pack.bonus,
    total: pack.gold + pack.bonus,
    priceRub: pack.priceRub,
    message: 'Оплата скоро будет доступна. Пакет зарезервирован.',
  };
}

// ---------- Сводка для шапки и главного экрана (/api/me) ----------
function resView(user: User) {
  const now = Date.now();
  const mx = maxima(user);
  // ВАЖНО: время до следующего тика должно считаться по ЭФФЕКТИВНОМУ интервалу
  // (с учётом трофеев регенерации, допингов и медкорпуса), иначе игрок видит
  // базовые 3 минуты и думает, что трофей не работает, хотя энергия копится
  // быстрее. Здесь пересчитываем те же интервалы, что и в refresh().
  const med = medcorpsRegenMul(user);
  const hpSec = Math.max(5, Math.round(
    config.REGEN.hp * (1 - trophyDiscountPct(user, 'regen_hp') / 100) / med
  ));
  const enSec = Math.max(5, Math.round(
    config.REGEN.en * (1 - trophyDiscountPct(user, 'regen_en') / 100) / effMul(user, 'energy_regen_pct') / med
  ));
  const amSec = Math.max(15, Math.round(
    config.REGEN.am * (1 - trophyDiscountPct(user, 'regen_am') / 100) / effMul(user, 'ammo_regen_pct') / med
  ));
  const one = (r, max, sec, perTick = 1) => ({
    cur: r.cur, max,
    regenSec: sec,
    perTick,
    toNextSec: r.cur >= max ? 0 : Math.max(0, Math.ceil((r.t + sec * 1000 - now) / 1000)),
  });
  return {
    hp: one(user.res.hp, mx.hp, hpSec),
    en: one(user.res.en, mx.en, enSec, config.REGEN.EN_PER_TICK),
    am: one(user.res.am, mx.am, amSec),
  };
}

function tutorialView(user: User) {
  // Нет поля обучения — считаем курс пройденным (см. tutorial.notify):
  // иначе главный экран старого аккаунта падал бы на ровном месте.
  if (!user.tutorial || user.tutorial.done) return { done: true, total: config.TUTORIAL.length };
  const q = config.TUTORIAL[user.tutorial.step];
  return {
    done: false,
    step: user.tutorial.step,
    total: config.TUTORIAL.length,
    prologue: config.STORY_PROLOGUE,
    quest: q ? {
      title: q.title, story: q.story, goal: q.goal, screen: q.screen,
      reward: `$${u.fmt(q.dollars)} и ${q.xp} опыта` +
        (user.tutorial.step === config.TUTORIAL.length - 1 ? `, затем 🪙 ${config.TUTORIAL_FINAL_GOLD} золота за весь курс` : ''),
    } : null,
  };
}

function mePayload(user: User): any {
  const atk = totalPower(user, "atk");
  const def = totalPower(user, "def");
  const now = Date.now();
  return {
    id: user.id, name: user.name, isAdmin: !!user.isAdmin,
    country: user.country, flag: flag(user), status: user.status,
    level: user.level, xp: user.xp, xpNext: config.xpToNext(user.level),
    rank: rank(user.level), rating: rating(user),
    dollars: user.dollars, gold: user.gold, bank: user.bank,
    skillPoints: user.skillPoints, skills: { ...user.skills }, skillCosts: config.SKILL_COSTS,
    skillCaps: config.SKILL_CAPS, skillResets: user.skillResets || 0,
    skillResetCost: config.skillResetCost(user.skillResets || 0),
    res: resView(user),
    healCost: config.hospitalPrice(user.level),  // для баннера «вылечиться» при HP < 25
    healCooldownLeft: Math.max(0, Math.ceil((((user as any).lastHospitalHeal || 0) + 5 * 60 * 1000 - Date.now()) / 1000)),
    battle: { ...user.battle },
    ears: user.ears, tokens: user.tokens, earsLost: user.earsLost,
    adminEars: user.adminEars || 0, adminTokens: user.adminTokens || 0,
    // Собственные уши игрока (лимит 2): сколько есть сейчас, штраф,
    // время до следующего восстановления и цена мгновенного восстановления
    earsCurrent: user.earsCurrent, earsMax: config.EARS.MAX,
    earPenaltyActive: !!(user.earPenaltyUntil && user.earPenaltyUntil > Date.now()),
    earPenaltyUntil: user.earPenaltyUntil || 0,
    earRegrowAt: user.earsLostAt && user.earsLostAt.length > 0 ? user.earsLostAt[0] + config.EARS.REGROW_MS : null,
    earRestoreCostGold: config.EARS.RESTORE_GOLD,
    capacity: capacity(user),
    // Чего игрок ещё не подтвердил. У всех, кто регистрировался до
    // появления отметок, здесь непустой список: согласий у них нет — их
    // просто не спрашивали. Клиент по этому списку показывает окно,
    // закрывающее игру, пока человек не ответит.
    needConsent: (() => {
      try { return require('./consent').outdated(user); } catch (e) { return []; }
    })(),
    power: { atk: atk.power, def: def.power, taken: atk.taken, unitTaken: atk.unitTaken, secretTaken: atk.secretTaken },
    incomePerHour: totalIncome(user), upkeepPerHour: totalUpkeep(user),
    nextPayoutSec: Math.max(0, Math.ceil((user.lastIncomeAt + HOUR - now) / 1000)),
    alliance: allianceInfo(user),
    legion: legionInfo(user),
    tutorial: tutorialView(user),
    pendingFatality: user.pendingFatality ? { name: user.pendingFatality.name } : null,
    // Безопасные сводки незавершённых мини-игр — БЕЗ кода сейфа и БЕЗ
    // индекса верного провода (иначе игрок мог бы подсмотреть в консоли).
    pendingBankHack: user.pendingBankHack ? {
      targetId: user.pendingBankHack.targetId, targetName: user.pendingBankHack.targetName,
      bankAmount: user.pendingBankHack.bankAmount, digits: user.pendingBankHack.digits,
      triesLeft: user.pendingBankHack.triesLeft, maxTries: user.pendingBankHack.maxTries,
      history: user.pendingBankHack.history,
    } : null,
    pendingMineDefuse: user.pendingMineDefuse ? {
      wires: require('./landmines').wiresView(user.pendingMineDefuse.wires),
      canSacrifice: ((user.saboteurs && user.saboteurs.suicide) || 0) > 0,
    } : null,
    landmines: user.landmines || 0,
    avatar: user.avatar || null,
    pendingGifts: user.pendingGifts && user.pendingGifts.length ? user.pendingGifts : [],
    effects: effectsView(user),
    needsVerification: (() => { try { return require('./antibot').needsVerification(user); } catch (e) { return false; } })(),
    unlocked: { production: user.level >= config.PRODUCTION_UNLOCK_LEVEL },
    productionUnlockLevel: config.PRODUCTION_UNLOCK_LEVEL,
  };
}

// ---------- Публичный профиль (его видят другие игроки) ----------
function powerStats(user: User): any {
  // Детальная раскладка: каждая единица техники (с учётом Mk и бонуса страны)
  // даёт свою атаку/защиту, плюс суммы по категориям (наземная/воздушная/
  // морская/секретные). Используется для экрана «Подробная статистика».
  const country = config.COUNTRY_BY_ID[user.country];
  const mm = (country && country.mod) || {};
  const typeMul = mm.typeMul || 1.05;

  const calcUnitPower = (cu, mk) => {
    let atk = cu.attack * config.MK_MULT[mk];
    let def = cu.defense * config.MK_MULT[mk];
    if (mm.atkType === cu.type) atk *= typeMul;
    if (mm.defType === cu.type) def *= typeMul;
    if (mm.atkAll) atk *= mm.atkAll;
    if ((mm as any).defAll === true) def *= 1.05;
    else if (typeof mm.defAll === 'number') def *= mm.defAll;
    return { atk: Math.round(atk), def: Math.round(def) };
  };

  const byType = { ground: { atk: 0, def: 0, count: 0 }, air: { atk: 0, def: 0, count: 0 }, sea: { atk: 0, def: 0, count: 0 } };
  const lines: any[] = [];
  for (const [unitId, mkMapRaw] of Object.entries(user.units)) {
    const cu = config.UNIT_BY_ID[unitId];
    if (!cu) continue;
    for (let mk = 0; mk <= 2; mk++) {
      const count = (mkMapRaw && mkMapRaw[mk]) || 0;
      if (count <= 0) continue;
      const { atk, def } = calcUnitPower(cu, mk);
      byType[cu.type].atk += atk * count;
      byType[cu.type].def += def * count;
      byType[cu.type].count += count;
      lines.push({
        name: cu.name + (mk ? ` Mk${mk}` : ''),
        type: cu.type, typeName: config.UNIT_TYPE_NAMES[cu.type],
        count, atkEach: atk, defEach: def,
        atkTotal: atk * count, defTotal: def * count,
      });
    }
  }
  // Секретные разработки — отдельная категория
  const secretLines: any[] = [];
  let secretAtkSum = 0, secretDefSum = 0, secretCount = 0;
  for (const d of config.SECRET_DEVS) {
    const count = user.secretDevs[d.id] || 0;
    if (count <= 0) continue;
    const a = config.secretAtk(user, d);
    const dd = config.secretDef(user, d);
    secretLines.push({ id: d.id, name: d.name, count, atkEach: a, defEach: dd, atkTotal: a * count, defTotal: dd * count });
    secretAtkSum += a * count;
    secretDefSum += dd * count;
    secretCount += count;
  }
  if (user.superSecret > 0) {
    const abs = config.SUPER_DEV;
    const a = config.secretAtk(user, abs);
    const dd = config.secretDef(user, abs);
    secretLines.push({ id: abs.id, name: abs.name, count: user.superSecret, atkEach: a, defEach: dd, atkTotal: a * user.superSecret, defTotal: dd * user.superSecret });
    secretAtkSum += a * user.superSecret;
    secretDefSum += dd * user.superSecret;
    secretCount += user.superSecret;
  }

  return {
    lines: lines.sort((a, b) => b.atkTotal - a.atkTotal),
    secretLines: secretLines.sort((a, b) => b.atkTotal - a.atkTotal),
    byCategory: {
      ground: byType.ground, air: byType.air, sea: byType.sea,
      secret: { atk: secretAtkSum, def: secretDefSum, count: secretCount },
    },
  };
}

function publicProfile(target: User, viewer: User): any {
  const atk = totalPower(target, "atk");
  const def = totalPower(target, "def");
  const unitsList: any[] = [];
  for (const [unitId, mkMap] of Object.entries(target.units)) {
    const cu = config.UNIT_BY_ID[unitId];
    if (!cu) continue;
    for (let mk = 0; mk <= 2; mk++) {
      const count = (mkMap && mkMap[mk]) || 0;
      if (count > 0) {
        unitsList.push({
          id: unitId,                 // для картинки (air_1, ground_5...)
          unitType: cu.type,          // ground/air/sea
          mk,
          name: cu.name + (mk ? ` Mk${mk}` : ''),
          baseName: cu.name,
          type: config.UNIT_TYPE_NAMES[cu.type],
          attack: Math.round(cu.attack * config.MK_MULT[mk]),
          defense: Math.round(cu.defense * config.MK_MULT[mk]),
          count,
        });
      }
    }
  }
  const buildingsList = Object.entries(target.buildings)
    .map(([id, count]) => {
      const b = config.BUILDING_BY_ID[id];
      return b && count ? { id, name: b.name, count, kind: b.kind,
        income: b.income || 0, def: b.def || 0 } : null;
    })
    .filter(Boolean);
  const devsList = config.SECRET_DEVS
    .map((d) => ({
      id: d.id, name: d.name,
      count: (target.secretDevs || {})[d.id] || 0,
      attack: d.atk, defense: d.def,
    }))
    .filter((d) => d.count > 0);

  const country = config.COUNTRY_BY_ID[target.country];
  const isOwn = viewer && viewer.id === target.id;
  // Администратор видит чужой профиль ПОЛНОСТЬЮ (армия/постройки/секретки),
  // без разведки — как свой. reveal = свой профиль ИЛИ смотрит админ.
  const isAdminViewer = !!(viewer && viewer.isAdmin);
  const reveal = isOwn || isAdminViewer;
  // Блокировка аккаунта видна в профиле всем: наказание публично, чтобы
  // другие понимали, почему игрок пропал, и видели, что правила работают
  const banInfo = (() => {
    try {
      const ab = require('./roles').accountBanInfo(target);
      return ab ? { reason: ab.reason, until: ab.until, byName: ab.byName, at: ab.at } : null;
    } catch (e) { return null; }
  })();

  return {
    id: target.id, name: target.name, flag: flag(target), status: target.status,
    // Роль в проекте: сотрудников видно всем, чтобы игроки знали, к кому
    // обращаться и от кого исходят требования в чате
    staffRole: (() => { try { return require('./roles').roleOf(target); } catch (e) { return null; } })(),
    staffLabel: (() => { try { return require('./roles').roleLabel(target) || null; } catch (e) { return null; } })(),
    staffTag: (() => { try { return require('./roles').roleTag(target) || null; } catch (e) { return null; } })(),
    vip: (() => { try { return require('./vip').isVip(target); } catch (e) { return false; } })(),
    level: target.level, rank: rank(target.level), rating: rating(target),
    accountBan: banInfo,
    country: target.country,
    countryName: country ? country.name : '',
    countryBonus: country ? country.desc : '',
    alliance: allianceInfo(target),
    legion: legionInfo(target),
    battle: { ...target.battle },
    // «Смерти» для блока «Статистика» в профиле: гибель при подрыве на
    // мине (счётчик достижения «Смертник»)
    deathsCount: ((target.counters as any) || {}).deaths || 0,
    ears: target.ears, tokens: target.tokens, earsLost: target.earsLost,
    earsCurrent: target.earsCurrent, earsMax: config.EARS.MAX,
    earPenaltyActive: !!(target.earPenaltyUntil && target.earPenaltyUntil > Date.now()),
    // Кто отрезал уши (видно всем): левое = earCutters[0], правое = [1].
    // Показываем только реально отрезанные (earsCurrent < MAX).
    earCutInfo: (() => {
      const c = target.earCutters || [null, null];
      const out: any = { left: null, right: null };
      // Левое ухо считается отрезанным, если потеряно хотя бы одно ухо
      const lost = config.EARS.MAX - (target.earsCurrent ?? config.EARS.MAX);
      if (lost >= 1 && c[0]) out.left = { id: c[0].id, name: c[0].name };
      if (lost >= 2 && c[1]) out.right = { id: c[1].id, name: c[1].name };
      return out;
    })(),
    earMessage: target.earMessage ? {
      byName: target.earMessage.byName,
      byId: target.earMessage.byId,
      text: target.earMessage.text,
    } : null,
    // Активные эффекты видны всем (название + сколько осталось). Имя
    // того, кто наложил подлянку, видит ТОЛЬКО сама жертва (isOwn).
    activeEffects: effectsView(target).map((e) => ({
      id: e.id,
      commanderId: e.commanderId, merc: e.merc,
      name: e.name, desc: e.desc, timeLeft: e.timeLeft,
      hostile: e.hostile,
      byName: (isOwn || isAdminViewer) ? e.byName : null,
    })),
    power:          reveal ? { atk: atk.power, def: def.power } : null,
    critChancePct:  reveal ? Math.round((Math.min(config.BATTLE.CRIT_MAX_CHANCE, config.BATTLE.CRIT_BASE + target.skills.cruelty * config.BATTLE.CRIT_PER_CRUELTY) + (effMul(target, 'crit_bonus') - 1)) * 1000) / 10 : null,
    dodgeChancePct: reveal ? Math.round((Math.min(config.BATTLE.DODGE_MAX, target.skills.agility * config.BATTLE.DODGE_PER_AGILITY) + (effMul(target, 'dodge_bonus') - 1)) * 1000) / 10 : null,
    powerStats:     reveal ? powerStats(target) : null,
    capacity: capacity(target),
    // Техника, постройки и секретки врага СКРЫТЫ от чужих — их можно
    // увидеть только через шпионаж (разведку). Свои всегда видны, а
    // администратору видно всё без разведки (reveal).
    units: reveal ? unitsList : [],
    buildings: reveal ? buildingsList : [],
    secretDevs: reveal ? devsList : [],
    superSecret: reveal ? target.superSecret : 0,
    superDevInfo: (reveal && target.superSecret > 0) ? {
      id: config.SUPER_DEV.id, name: config.SUPER_DEV.name,
      count: target.superSecret, attack: config.SUPER_DEV.atk, defense: config.SUPER_DEV.def,
    } : null,
    hideArmy: !reveal,   // флаг для фронта: армия скрыта, нужна разведка
    adminView: isAdminViewer && !isOwn,   // админ смотрит чужой профиль (для бейджа)
    // Титул и косметика профиля — видны всем
    activeTitle: (() => { try { return require('./features').activeTitleName(target); } catch (e) { return null; } })(),
    profileFrame: target.profileFrame || null,
    profileBg: target.profileBg || null,
    avatar: target.avatar || null,
    isOwn,
    createdAt: target.createdAt, lastSeen: target.lastSeen || target.createdAt,
    online: (Date.now() - (target.lastSeen || 0)) < 5 * 60 * 1000,
    canAttack: !!viewer && viewer.id !== target.id &&
      Math.abs(viewer.level - target.level) <= config.PLAYER.LEVEL_RANGE,
  };
}

function setStatus(user: User, text: string) {
  user.status = String(text || '').slice(0, 120);
}

// Установить аватар профиля (только из разрешённого списка)
// ── Смена позывного (VIP, пункт 18) ──────────────────────────────
// Раз в 30 дней бесплатно. Проверки те же, что при регистрации:
// длина, запрещённые имена, занятость — иначе сменой позывного можно
// было бы обойти фильтр, действующий при создании аккаунта.
function renameSelf(user: User, newName: string, notices: Notices) {
  const vipSrv = require('./vip');
  if (!vipSrv.isVip(user)) throw new u.ApiError('Смена позывного доступна по VIP-подписке');
  if (!vipSrv.canRenameFree(user)) {
    const days = Math.ceil((30 * 86400000 - (Date.now() - (user as any).lastFreeRenameAt)) / 86400000);
    throw new u.ApiError(`Позывной можно менять раз в 30 дней. Осталось ждать: ${days} дн.`);
  }
  const name = String(newName || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 16) throw new u.ApiError('Позывной: от 3 до 16 символов');
  if (name === user.name) throw new u.ApiError('Это ваш текущий позывной');
  if (!/^[A-Za-zА-Яа-яЁё0-9 _-]+$/.test(name)) {
    throw new u.ApiError('В позывном допустимы буквы, цифры, пробел, дефис и подчёркивание');
  }
  const auth = require('./auth');
  if (auth.RESERVED_NAMES && auth.RESERVED_NAMES.has(name.toLowerCase().replace(/\s/g, ''))) {
    throw new u.ApiError('Это имя зарезервировано и недоступно');
  }
  const taken = Object.values(users()).find((p: any) => p.id !== user.id
    && String(p.name || '').toLowerCase() === name.toLowerCase());
  if (taken) throw new u.ApiError('Такой позывной уже занят');

  const old = user.name;
  user.name = name;
  vipSrv.markRenameUsed(user);
  db.markUser(user.id);
  db.save('users');
  try {
    require('./auditLog').record({
      userId: user.id, userName: name, path: '/api/rename',
      body: { from: old, to: name },
    });
  } catch (e) {}
  notices.push(`✏️ Позывной изменён: «${old}» → «${name}»`);
  return { name, nextFreeAt: Date.now() + 30 * 86400000 };
}

function setAvatar(user: User, avatarId: string) {
  if (avatarId === '' || avatarId === null) { user.avatar = undefined; db.markUser(user.id); return { avatar: null }; }
  if (!config.AVATAR_IDS.includes(avatarId)) throw new u.ApiError('Неизвестный аватар');
  user.avatar = avatarId;
  db.markUser(user.id);
  return { avatar: avatarId };
}

// Восстановить одно ухо мгновенно за золото (если потеряно хотя бы одно)
function restoreEar(user: User, notices: Notices) {
  if (user.earsCurrent >= config.EARS.MAX) {
    throw new u.ApiError('У вас уже оба уха целы');
  }
  if (user.gold < config.EARS.RESTORE_GOLD) {
    throw new u.ApiError(`Не хватает золота (нужно 🪙 ${config.EARS.RESTORE_GOLD})`);
  }
  spendGold(user, config.EARS.RESTORE_GOLD, 'player');
  user.earsCurrent = Math.min(config.EARS.MAX, user.earsCurrent + 1);
  // Убираем самую старую запись о потере (это ухо уже восстановлено)
  if (user.earsLostAt.length > 0) user.earsLostAt.shift();
  // Если теперь снова есть хотя бы одно ухо — штраф снимается
  if (user.earsCurrent > 0) user.earPenaltyUntil = 0;
  // Если оба уха восстановлены — стираем записи о том, кто отрезал, и послание
  if (user.earsCurrent >= config.EARS.MAX) {
    user.earCutters = [null, null];
    user.earMessage = null;
  }
  notices.push(`👂 Ухо восстановлено за 🪙 ${config.EARS.RESTORE_GOLD}. Сейчас ушей: ${user.earsCurrent}/${config.EARS.MAX}.`);
  return { earsCurrent: user.earsCurrent };
}

export = { isXpBlocked, xpBlockLeftMin,
  users, maxima, refresh, addMoney, addBattleLoot, addGold, spendGold, paidGold, addXp, xpMul, spendSkill, resetSkills,
  allianceOf, allianceInfo, legionOf, legionInfo, legionBonus, capacity, effMul, effectsView,
  ensureUnit, unitTotalCount, unitCountTotal, trophyDiscountPct, totalPower,
  buildArmy, buildingDef, totalIncome, totalUpkeep, syncSuper,
  rating, addRating, rank, flag, findByName,
  bankDeposit, bankWithdraw, reserveForLegion, goldPackages, buyGold,
  mePayload, publicProfile, setStatus, setAvatar, restoreEar, renameSelf, sellUnitsForDebt,};
