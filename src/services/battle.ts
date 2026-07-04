// ===================================================================
// src/services/battle.ts — раздел «Война»
// Список из 10 целей: реальные игроки в диапазоне ±10 уровней и 2–3
// бота-террориста. Каждое обновление списка генерирует новый набор.
// Атака тратит 1 боеприпас. Победа = грабёж наличных + опыт.
// При крите и почти полном уничтожении доступно фаталити:
// отрезать ухо (ресурс «ухо») или отпустить (ресурс «жетон»).
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import social = require('./social');
import notifications = require('./notifications');
import ach = require('./achievements');
import tutorial = require('./tutorial');
import trophies = require('./trophies');
import type { User, Notices } from '../types';

const B = config.BATTLE;

// Кэш живых ботов: id → { bot, exp }. Боты живут 15 минут,
// чтобы по ним можно было успеть ударить после показа списка.
const botCache = new Map<string, any>();

function pruneBots(): void {
  const now = Date.now();
  for (const [id, rec] of botCache) {
    if (rec.exp < now) botCache.delete(id);
  }
}

// Создание бота-террориста, сбалансированного под игрока:
// его мощь — доля от атакующей мощи самого игрока, чтобы бой
// был честным на любом этапе прокачки.
// Генерация рандомного «игрового» позывного: Префикс + Корень + Суффикс
function randomPlayerName(): string {
  const p = u.pick(config.BOT_PLAYER_PREFIXES);
  const c = u.pick(config.BOT_PLAYER_CORES);
  const s = u.pick(config.BOT_PLAYER_SUFFIXES);
  return p + c + s;
}

// Псевдоармия бота для отображения в окне боя (учёта потерь не ведём —
// бот эфемерен и при следующей атаке его уже нет)
function makeBotArmy(bot: any): any {
  const level = bot.level || 1;
  const entries: any[] = [];
  // Подбираем по 3 юнита разных типов, доступных на уровне бота
  for (const type of ['air', 'sea', 'ground']) {
    const candidates = config.UNITS.filter((cu) => cu.type === type && cu.unlock <= level);
    if (candidates.length === 0) continue;
    const cu = candidates[Math.min(candidates.length - 1, Math.floor(level / 5))];
    const count = Math.max(1, Math.round(5 + level / 3));
    entries.push({
      name: cu.name,
      unitId: cu.id, count, taken: count, secret: false, mk: 0,
      atk: cu.attack, def: cu.defense,
    });
  }
  return { entries, power: bot.power, taken: entries.reduce((s, e) => s + e.taken, 0), cap: 30 };
}

function makeBot(user: User): any {
  const level = u.clamp(user.level + u.rnd(-7, 7), 1, config.PLAYER.MAX_LEVEL);
  const base = Math.max(30, player.buildArmy(user, 'atk').power);
  // 50% — обычный бот-террорист, 50% — псевдоигрок
  const isPlayerLike = Math.random() < 0.5;
  // Псевдоигроки слабее реального игрока на ~10% (было «почти равны»),
  // террористы слабее ещё сильнее — на 30% от прежнего диапазона.
  // Было: playerLike 0.90-1.15, террористы 0.50-0.95.
  // Стало: playerLike 0.80-1.04 (−10%), террористы 0.35-0.665 (−30%).
  const powerRange = isPlayerLike
    ? (0.80 + Math.random() * 0.24)
    : (0.35 + Math.random() * 0.315);
  const power = Math.max(25, Math.round(base * powerRange * (1 + (level - user.level) * 0.03)));
  const maxHp = 100 + level * 8;
  // ----- Казна бота (loot pool) -----
  // По требованиям: за ОДНУ атаку игрок должен получить сумму, на которую
  // можно купить 10-30 единиц актуальной техники СВОЕГО уровня. Если в
  // среднем на полное уничтожение бота уходит ~20 атак (урон ~5% HP за
  // удар), общая «казна» бота — это сумма геометрически убывающей серии
  // из ~20 потенциальных выплат, где первая выплата самая крупная.
  const unitPrice = config.minUnitPriceAtLevel(user.level);
  // Награда привязана к уровню: на старте игрок получает скромную сумму
  // (несколько единиц техники), с ростом уровня множитель плавно растёт
  // до полного 10-30. Так первая атака на 1 уровне не даёт состояние.
  //   ур.1   → ×3-8
  //   ур.50  → ×7-21
  //   ур.100+→ ×10-30 (полный)
  const lvlFactor = Math.min(1, 0.3 + 0.7 * (user.level / 100)); // 0.3 → 1.0
  const firstHitMin = unitPrice * Math.round(10 * lvlFactor);
  const firstHitMax = unitPrice * Math.round(30 * lvlFactor);
  const firstHit = u.rnd(Math.round(firstHitMin), Math.round(firstHitMax));
  // Геометрическая прогрессия с коэффициентом ~0.95 (близко к темпу
  // убывания HP за удар) и ~20 членами: казна ≈ firstHit / (1 - 0.95)
  // ограничено разумным числом членов, чтобы не уйти в бесконечность.
  const DECAY = 0.95;
  const ESTIMATED_HITS = 20;
  let lootPool = 0;
  for (let i = 0; i < ESTIMATED_HITS; i++) lootPool += firstHit * Math.pow(DECAY, i);
  lootPool = Math.round(lootPool);

  // Случайные характеристики профиля бота
  const botStatuses = [
    'За Родину!', 'Иду в бой', 'Война — моя работа',
    'Всех к ногтю', 'Не трогай — целее будешь', 'Без жалости',
    'Слава героям', 'Победа любой ценой', '',
  ];
  const allianceNames = [
    'Чёрная сотня', 'Северный волк', 'Багровый легион', 'Стальной фронт',
    'Орден ветеранов', 'Восточный союз', 'Дозор', 'Гарнизон', 'Бригада',
    'Свободные стрелки', 'Кавалькада',
  ];
  // У 60% ботов есть альянс
  const hasAlliance = Math.random() < 0.6;
  const allianceMembers = hasAlliance ? u.rnd(2, 20) : 0;
  const allianceName = hasAlliance ? u.pick(allianceNames) : null;
  const allianceId = hasAlliance ? 'bot_alliance_' + u.uid(8) : null;

  const bot = {
    id: 'bot_' + u.uid(10),
    isBot: true,
    isPlayerLike,
    name: isPlayerLike ? randomPlayerName() : u.pick(config.BOT_NAMES),
    flag: isPlayerLike ? u.pick(config.BOT_PLAYER_FLAGS) : '💀',
    level, power, maxHp, hp: maxHp,
    loot: lootPool,        // общая «казна» бота — расходуется при атаках
    firstHit,               // размер первой выплаты (база для прогрессии)
    hitsLanded: 0,           // сколько раз по этому боту уже ударили
    // Профильные данные
    status: u.pick(botStatuses),
    rating: Math.round(power * (0.5 + Math.random() * 1.5)),
    wins: u.rnd(50, 500) * level,
    losses: u.rnd(10, 100) * level,
    fatalities: u.rnd(0, 50) * Math.max(1, Math.floor(level / 10)),
    createdDaysAgo: u.rnd(7, 800),
    allianceId, allianceName, allianceMembers,
  };
  botCache.set(bot.id, { bot, exp: Date.now() + B.BOTS_TTL_MS });
  return bot;
}

// Публичный профиль бота (для маршрута /api/profile/bot_xxx)
// Безопасный просмотр данных бота из кэша (для снимка при вступлении
// в альянс). Возвращает null, если бот уже истёк/не найден — вызывающий
// код тогда использует заглушку.
function peekBot(botId: string): any {
  const rec = botCache.get(botId);
  return rec ? rec.bot : null;
}

function botProfile(botId: string, viewer: User): any {
  pruneBots();
  const rec = botCache.get(botId);
  if (!rec) throw new u.ApiError('Профиль не найден или устарел. Обновите список целей.');
  const b = rec.bot;
  // Можно ли пригласить в альянс: любой бот без своего альянса (включая террористов)
  const canInviteAlliance = !b.allianceId && !!viewer.allianceId;
  // Можно ли атаковать
  const canAttack = Math.abs(b.level - viewer.level) <= config.PLAYER.LEVEL_RANGE;
  return {
    id: b.id, isBot: true, isPlayerLike: b.isPlayerLike,
    name: b.name, flag: b.flag, status: b.status,
    level: b.level, rank: '—', rating: b.rating,
    country: 'bot',
    canAttack,
    alliance: b.allianceId ? { id: b.allianceId, name: b.allianceName, members: b.allianceMembers } : null,
    legion: null,
    canInviteAlliance,
    battle: {
      wins: b.wins, losses: b.losses,
      defWins: Math.floor(b.wins * 0.4), defLosses: Math.floor(b.losses * 0.6),
      fatalities: b.fatalities,
    },
    power: { atk: b.power, def: Math.round(b.power * 0.85), taken: 30 },
    capacity: 30,
    units: [],
    createdDaysAgo: b.createdDaysAgo,
    ears: Math.floor(b.fatalities * 0.6),
    tokens: Math.floor(b.fatalities * 0.4),
  };
}

// Список целей: до 7–8 реальных игроков подходящего уровня + 2–3 бота.
// Если живых игроков мало — добиваем список ботами до 10.
function opponents(user: User): any {
  pruneBots();
  const real = Object.values(player.users()).filter(
    (t) => t.id !== user.id && Math.abs(t.level - user.level) <= config.PLAYER.LEVEL_RANGE
  );
  u.shuffle(real);
  const botsCount = 2 + (Math.random() < 0.5 ? 1 : 0); // 2 или 3 бота
  const picked = real.slice(0, Math.max(0, 10 - botsCount));

  const list = picked.map((t) => {
    const a = player.allianceOf(t);
    return {
      id: t.id, name: t.name, level: t.level,
      flag: player.flag(t), isBot: false,
      online: Date.now() - (t.lastSeen || 0) < 5 * 60 * 1000,
      allianceMembers: a ? a.members.length : 0,
    };
  });
  while (list.length < 10) {
    const b = makeBot(user);
    list.push({
      id: b.id, name: b.name, level: b.level, flag: b.flag, isBot: true, online: true,
      allianceMembers: b.allianceMembers || 0,
    });
  }
  u.shuffle(list);
  return { opponents: list };
}

// Снять у проигравшего часть техники, взятой в бой.
// Секретные разработки неуязвимы (по ТЗ). Возвращает список потерь.
// ---------------------------------------------------------------------
// Пороговая формула урона по соотношению ЗАЩИТА vs АТАКА противника:
//   def >= atk*1.5            -> урон 1-5   (атакующий почти бессилен)
//   def >= atk*1.2 (1.2-1.49) -> урон 5-15  (атакующий слаб)
//   |def - atk| <= 10%         -> «примерное равенство»: урон средний,
//                                  ближе к верхней границе у сильнейшего
//   atk > def (выше equal-зоны) -> атакующий доминирует, урон растёт к 45
// Возвращает { dealt, strength } — урон по защитнику и «боевую силу»
// атакующего в этой схватке (для последующего честного сравнения сторон
// и определения победителя — НЕ случайным броском, а по факту того, кто
// нанёс больше реального урона относительно сил противника).
// ---------------------------------------------------------------------
function resolveDamage(atk: number, def: number): any {
  const ratio = def / Math.max(1, atk); // >1 защитник сильнее, <1 — атакующий сильнее
  let dealt;

  // Потолок обычного урона — 30. Крит ×2 = 60, с трофеем на макс (+200%) = 180.
  if (ratio >= 1.5) {
    dealt = u.rnd(1, 4);
  } else if (ratio >= 1.2) {
    dealt = u.rnd(4, 10);
  } else if (ratio >= 0.9 && ratio <= 1.1) {
    dealt = u.rnd(8, 18);
  } else {
    const dominance = Math.min(1, (0.9 - ratio) / 0.9);
    dealt = Math.round(18 + dominance * 9 + Math.random() * 3);
  }

  dealt = u.clamp(Math.round(dealt), 1, 30);
  return { dealt };
}

// Потери техники зависят от полученного урона и крита: чем больше урон,
// тем выше шанс и размер потерь, но всегда есть шанс не потерять ничего.
// pctBase — базовая доля «эталонных» потерь (как раньше), но теперь
// масштабируется случайным образом от 0 до ~2× базы, и явно зависит
// от того, был ли нанесён критический удар (crit => потери крупнее).
function removeUnits(victim: any, armyEntries: any[], pctBase: number, crit: boolean): any {
  // Сортируем «жертв» от слабой к сильной: сначала Mk0, потом Mk1, Mk2;
  // внутри одного Mk — по возрастанию unlock (уровень открытия = «слабее»).
  const pool = armyEntries
    .filter((e) => !e.secret && e.unitId && e.taken > 0)
    .slice()
    .sort((a, b) => {
      if (a.mk !== b.mk) return a.mk - b.mk;
      const cuA = config.UNIT_BY_ID[a.unitId];
      const cuB = config.UNIT_BY_ID[b.unitId];
      return (cuA ? cuA.unlock : 0) - (cuB ? cuB.unlock : 0);
    });
  const totalTaken = pool.reduce((s, e) => s + e.taken, 0);
  if (totalTaken <= 0) return [];

  // Случайный множитель потерь: 0% (без потерь) .. 200% от базовой доли.
  // Критический удар сдвигает диапазон вверх (потери крупнее и стабильнее).
  const randMul = crit ? (0.6 + Math.random() * 1.4) : (0 + Math.random() * 1.6);
  let toLose = Math.floor(totalTaken * pctBase * randMul);
  // Не более трети взятой в бой техники за один обмен ударами — чтобы
  // потери оставались правдоподобными даже при крите
  toLose = Math.min(toLose, Math.ceil(totalTaken / 3));
  if (toLose <= 0) return [];

  const lost = {};
  const lostMeta = {};
  for (const e of pool) {
    if (toLose <= 0) break;
    const m = victim.units[e.unitId];
    const have = m ? (m[e.mk] || 0) : 0;
    if (have <= 0 || e.taken <= 0) continue;
    const n = Math.min(have, e.taken, toLose);
    m[e.mk] = have - n;
    e.taken -= n;
    toLose -= n;
    lost[e.name] = (lost[e.name] || 0) + n;
    lostMeta[e.name] = { id: e.unitId, type: (config.UNIT_BY_ID[e.unitId] || {}).type };
    if ((m[0] || 0) + (m[1] || 0) + (m[2] || 0) <= 0) delete victim.units[e.unitId];
  }
  // Возвращаем объекты с id (для картинок) — фронт сам решит как показать
  return Object.entries(lost).map(([name, count]) => ({
    name, count, id: lostMeta[name].id, unitType: lostMeta[name].type,
  }));
}

// ---------- ГЛАВНАЯ ФУНКЦИЯ: атака цели ----------
function attack(user: User, targetId: string, notices: Notices) {
  if (user.pendingFatality) throw new u.ApiError('Сначала решите судьбу поверженного врага (фаталити)!');
  // Кулдаун атак — 1 секунда (защита от спама)
  const ATTACK_CD_MS = 1000;
  const nowMs = Date.now();
  if ((user as any).lastAttackAt && nowMs - (user as any).lastAttackAt < ATTACK_CD_MS) {
    throw new u.ApiError('Слишком быстро! Между атаками нужна 1 секунда.');
  }
  if (user.res.am.cur < 1) throw new u.ApiError('Нет боеприпасов. Они восстанавливаются со временем.');
  if (user.res.hp.cur < config.PLAYER.MIN_HP_TO_FIGHT) {
    throw new u.ApiError(`Здоровье ниже ${config.PLAYER.MIN_HP_TO_FIGHT} — сначала подлечитесь.`);
  }

  // Находим цель: бот из кэша или реальный игрок из базы
  let target: any = null, isBot = false;
  if (String(targetId).startsWith('bot_')) {
    pruneBots();
    const rec = botCache.get(targetId);
    if (!rec) throw new u.ApiError('Цель ушла из зоны видимости. Обновите список.');
    target = rec.bot;
    isBot = true;
    if (target.hp < config.PLAYER.MIN_HP_TO_FIGHT) throw new u.ApiError('Террорист уже ликвидирован. Обновите список.');
  } else {
    target = player.users()[targetId];
    if (!target || target.id === user.id) throw new u.ApiError('Цель не найдена');
    player.refresh(target);
    // Обычные атаки по цели РАЗРЕШЕНЫ всем, включая заказчика санкции.
    // Ограничение только на награду: заказчик не может забрать СВОЮ же
    // награду за санкцию (см. checkPayout ниже).
    // Цель с активной санкцией можно атаковать вне диапазона уровней и
    // добивать ниже лазаретного порога (охота за наградой)
    let underSanction = false;
    try { underSanction = !!(require('./sanctions').list(user).sanctions || []).find((x: any) => x.targetId === targetId); } catch (e) {}
    if (!underSanction && Math.abs(target.level - user.level) > config.PLAYER.LEVEL_RANGE) {
      throw new u.ApiError('Цель вне диапазона ±10 уровней');
    }
    if (!underSanction && target.res.hp.cur < config.PLAYER.MIN_HP_TO_FIGHT) {
      throw new u.ApiError('Игрок восстанавливается в лазарете — добивать лежачих запрещено уставом.');
    }
  }

  // Тратим боеприпас и фиксируем попытку
  user.res.am.cur -= 1;
  (user as any).lastAttackAt = nowMs;
  user.battle.attacks++;
  require('./dailyQuests').bump(user, 'attacks', 1);
  ach.bump(user, 'attacks', 1, notices);

  // ----- Мощь атакующего: армия × эффекты × трофеи -----
  const aArmy = player.buildArmy(user, 'atk');
  const aTotal = player.totalPower(user, 'atk');
  let aPow = Math.max(10, aTotal.power);

  // ----- Мощь защитника -----
  let dPow: any, dArmy: any = null, defPoints = 0, targetMaxHp: number, targetLevel: number;
  if (isBot) {
    dPow = target.power;
    targetMaxHp = target.maxHp;
    targetLevel = target.level;
    // У бота нет реальной техники, но для красивого отображения сводки
    // боя генерируем «псевдоармию» — 2-3 вида в зависимости от уровня.
    dArmy = makeBotArmy(target);
  } else {
    dArmy = player.buildArmy(target, 'def');
    defPoints = player.buildingDef(target);
    // Используем ту же формулу что и в totalPower: техника + постройки (с бонусом страны), потом трофей и эффекты
    const dTotal = player.totalPower(target, 'def');
    dPow = Math.max(10, dTotal.power);
    targetMaxHp = player.maxima(target).hp;
    targetLevel = target.level;
  }

  // ----- Броски: крит атакующего, полный уворот защитника -----
  // Допинг «Ястреб» добавляет крит СВЕРХ лимита (capped-часть + бонус эффекта)
  const critBase = Math.min(B.CRIT_MAX_CHANCE, B.CRIT_BASE + user.skills.cruelty * B.CRIT_PER_CRUELTY);
  const critChance = critBase + player.effMul(user, 'crit_bonus') - 1; // effMul=1.2 → +0.2
  const crit = Math.random() < critChance;
  // Ловкость даёт ШАНС НА ПОЛНЫЙ УВОРОТ (не просто снижение урона):
  // 0.5% за уровень, максимум 50%. Допинг «Призрак» добавляет сверх лимита.
  const dodgeBase = isBot ? 0 : Math.min(B.DODGE_MAX, target.skills.agility * B.DODGE_PER_AGILITY);
  const dodgeChance = isBot ? 0 : dodgeBase + player.effMul(target, 'dodge_bonus') - 1;
  const dodge = Math.random() < dodgeChance;

  // Базовый урон (БЕЗ крита) по пороговой формуле — соотносим обычную
  // атаку (без множителя крита) с защитой противника
  const { dealt: dealtBase } = resolveDamage(aPow, dPow);

  // Крит явно умножает ИТОГОВЫЙ урон (не подмешивается в пороговую
  // формулу до клампа): база ×2.0, трофей «Лицензия на убийство» на
  // максимуме добавляет ещё ×2.0 сверху (итог ×6.0 на максимуме —
  // см. config.BATTLE.CRIT_MULT и trophies.critPower).
  //   Пример без трофея: 30 урона -> крит 30×2 = 60
  //   Пример с трофеем макс.: 60 + (60×2) = 180
  const critTrophyBonus = trophies.critPower(user); // 0..2.0 (0%-200%)
  const dealtCrit = crit
    ? Math.round(dealtBase * B.CRIT_MULT * (1 + critTrophyBonus))
    : dealtBase;

  // Определение победителя ДЕТЕРМИНИРОВАНО: сравниваем эффективную мощь
  // атаки (с учётом крита) против мощи защиты напрямую, без случайных
  // бросков. Если у нападающего мощь ниже — он НЕ выигрывает. Крит может
  // «дожать» победу, усилив атаку, но случайность исход не переворачивает.
  let effectiveAtk = aPow;
  if (crit) effectiveAtk *= B.CRIT_MULT * (1 + critTrophyBonus);
  const win = effectiveAtk >= dPow;

  // Полный уворот — обнуляем урон, но не исход боя
  const dealt = dodge ? 0 : dealtCrit;

  // Урон, получаемый АТАКУЮЩИМ от защитника (та же формула в обратную
  // сторону — у бота тоже есть шанс крита, см. ниже)
  const { dealt: receivedBase } = resolveDamage(dPow, aPow);
  const botCritChance = isBot ? Math.min(0.30, 0.05 + (target.level || 1) * 0.002) : 0;
  const botCrit = isBot && Math.random() < botCritChance;
  const received = botCrit ? Math.round(receivedBase * B.CRIT_MULT) : receivedBase;
  user.res.hp.cur = Math.max(1, user.res.hp.cur - received);

  let targetHpAfter;
  if (isBot) {
    target.hp = Math.max(0, target.hp - dealt);
    targetHpAfter = target.hp;
  } else {
    target.res.hp.cur = Math.max(1, target.res.hp.cur - dealt);
    targetHpAfter = target.res.hp.cur;
  }

  // Проверка санкций: если цель — живой игрок и его HP упало до ≤5%,
  // охотник получает накопленный банк по этой цели.
  if (!isBot && win) {
    try {
      const targetMax = player.maxima(target).hp;
      require('./sanctions').checkPayout(user, target, targetHpAfter, targetMax, notices);
    } catch (e) { /* санкций нет — игнор */ }
  }

  // ----- Грабёж, опыт, потери техники -----
  let loot = 0;
  const myLosses: any[] = [], enemyLosses: any[] = [];
  const lootReduce = defPoints / (defPoints + B.DEF_LOOT_SOFT);
  const lossReduce = defPoints / (defPoints + B.DEF_LOSS_SOFT);

  // Уменьшение грабежа при последовательных атаках на одну цель:
  // запоминаем атаки на цели за последний час, и каждая следующая атака
  // даёт меньше денег (×0.5 за каждую предыдущую атаку этого часа).
  // Это и от ботов, и от живых игроков — фарм одного объекта невыгоден.
  if (!user.recentAttacks) user.recentAttacks = {};
  const HOUR_MS = 3600 * 1000;
  // Чистим старые записи
  for (const k of Object.keys(user.recentAttacks)) {
    user.recentAttacks[k] = (user.recentAttacks[k] || []).filter((t) => Date.now() - t < HOUR_MS);
    if (user.recentAttacks[k].length === 0) delete user.recentAttacks[k];
  }
  const targetKey = isBot ? 'bots_pool' : target.id;
  const recentCount = (user.recentAttacks[targetKey] || []).length;
  const lootMul = Math.pow(0.5, recentCount); // 1.0, 0.5, 0.25, 0.125, ...
  user.recentAttacks[targetKey] = (user.recentAttacks[targetKey] || []).concat(Date.now());

  if (win) {
    user.battle.wins++;
    // Личная история против реального противника: +победа
    if (!isBot) {
      if (!user.vsRecord) user.vsRecord = {};
      const rec = user.vsRecord[target.id] || { wins: 0, losses: 0 };
      rec.wins++;
      user.vsRecord[target.id] = rec;
    }
    require('./dailyQuests').bump(user, 'wins', 1);
    ach.bump(user, 'wins', 1, notices);
    // Сезонный рейтинг и проверка титулов
    try {
      const feat = require('./features');
      feat.addSeasonRating(user, 10);
      feat.checkTitles(user, notices);
    } catch (e) {}
    if (isBot) {
      // Выплата = очередной член геометрически убывающей серии из казны
      // бота. Первая атака на этого бота — самая крупная (10-30 единиц
      // техники уровня игрока), каждая следующая — меньше (×0.95 за шаг),
      // вплоть до почти нуля. Привязано к hitsLanded конкретного бота, а
      // не к общему пулу 'bots_pool' — так результат честно совпадает с
      // тем, сколько раз именно ПО ЭТОМУ боту уже ударили.
      const DECAY = 0.95;
      loot = Math.round(target.firstHit * Math.pow(DECAY, target.hitsLanded || 0));
      // Трофей «Мародёр» (+5%/ур) и эффект loot_pct действуют и на ботов
      const looterBonusBot = 1 + (player.trophyDiscountPct ? player.trophyDiscountPct(user, 'loot') / 100 : 0);
      loot = Math.round(loot * player.effMul(user, 'loot_pct') * looterBonusBot);
      loot = Math.min(loot, target.loot); // не больше, чем осталось в казне
      loot = Math.max(0, loot);
      target.hitsLanded = (target.hitsLanded || 0) + 1;
      target.loot = Math.max(0, target.loot - loot);
      // Симулируем потери техники бота для отображения в окне боя.
      // У бота нет реальной техники в БД (это заглушка для красивого
      // отображения), но потери теперь РАНДОМНЫ и учитывают крит —
      // как и у реальных игроков, без статичного фиксированного числа.
      if (dArmy && dArmy.entries) {
        const botRandMul = crit ? (0.6 + Math.random() * 1.4) : (0 + Math.random() * 1.6);
        for (const e of dArmy.entries) {
          if (e.taken > 0) {
            const lost = Math.floor(e.taken * B.LOSS_DEF_PCT * (1 - lossReduce) * 1.5 * botRandMul);
            if (lost > 0) enemyLosses.push({ name: e.name, count: lost, id: e.unitId, unitType: (config.UNIT_BY_ID[e.unitId] || {}).type });
          }
        }
      }
    } else {
      // С игрока: 7% от наличных, с учётом уменьшающего множителя
      // и трофея «Мародёр» (+5% за уровень)
      const looterBonus = 1 + (player.trophyDiscountPct ? player.trophyDiscountPct(user, 'loot') / 100 : 0);
      loot = Math.floor(target.dollars * B.LOOT_PCT * (1 - lootReduce) * lootMul * player.effMul(user, 'loot_pct') * looterBonus);
      loot = Math.max(0, Math.min(loot, target.dollars));
      target.dollars -= loot;
      target.battle.defLosses++;
      // Потери защитника (только если он реальный игрок), с учётом крита
      enemyLosses.push(...removeUnits(target, dArmy.entries, B.LOSS_DEF_PCT * (1 - lossReduce), crit));
      notifications.push(target.id, 'attack_lost', `${user.name} атаковал вас и победил`, {
        attackerName: user.name, attackerLevel: user.level, attackerId: user.id,
        loot, lossesText: enemyLosses.join(', ') || null,
        dealt, at: Date.now(),
      });
    }
    // Победитель тоже несёт небольшие потери (война есть война)
    myLosses.push(...removeUnits(user, aArmy.entries, B.LOSS_ATK_WIN_PCT, false));
    player.addBattleLoot(user, loot);
  } else {
    user.battle.losses++;
    if (!isBot) {
      // Личная история против реального противника: +поражение
      if (!user.vsRecord) user.vsRecord = {};
      const rec = user.vsRecord[target.id] || { wins: 0, losses: 0 };
      rec.losses++;
      user.vsRecord[target.id] = rec;
      target.battle.defWins++;
      // Защитник, отразив атаку, тоже несёт минимальные потери
      enemyLosses.push(...removeUnits(target, dArmy.entries, B.LOSS_DEF_WIN_PCT, false));
      notifications.push(target.id, 'attack_defended', `${user.name} атаковал вас, но был отбит`, {
        attackerName: user.name, attackerLevel: user.level, attackerId: user.id,
        lossesText: enemyLosses.join(', ') || null,
        received, at: Date.now(),
      });
    }
    // Проигравший атакующий теряет существенно больше (крупнее, если
    // защитник нанёс критический ответный удар)
    myLosses.push(...removeUnits(user, aArmy.entries, B.LOSS_ATK_PCT, botCrit));
  }

  // Опыт: фиксированный диапазон из конфига (4–7 за победу, 1–2 за поражение)
  const xpBase = win
    ? u.rnd(B.XP_WIN_MIN,  B.XP_WIN_MAX)
    : u.rnd(B.XP_LOSS_MIN, B.XP_LOSS_MAX);
  const xp = player.addXp(user, xpBase, notices); // реальный XP с бонусами страны/легиона/админа

  // ----- Окно фаталити -----
  // Доступно против реальных игроков И ботов-игроков (псевдоигроков с
  // позывными и флагами). На обычных террористах (💀) — нельзя, это
  // безликая массовка.
  const fatalityAllowed = !isBot || (isBot && target.isPlayerLike);
  // Наёмник «Призрак Нерушимый» (fatality_immunity) защищает жертву:
  // окно фаталити против неё не появляется в течение 24ч.
  const targetImmune = !isBot && (target.effects || []).some(
    (e: any) => e.type === 'fatality_immunity' && e.expiresAt > Date.now()
  );
  let fatality = false;
  let fatalityDodged = false;
  // Фаталити доступно только тому, кто РЕАЛЬНО побеждает противника.
  // Если по личной истории боёв игрок проигрывает этой цели чаще, чем
  // выигрывает — шанс фаталити над ней блокируется (нельзя «фармить»
  // фаталити над тем, кто обычно сильнее).
  let fatalityVsOk = true;
  if (!isBot) {
    const rec = (user.vsRecord || {})[target.id] || { wins: 0, losses: 0 };
    if (rec.losses > rec.wins) fatalityVsOk = false;
  }
  if (!targetImmune && fatalityAllowed && fatalityVsOk && win && crit && targetHpAfter <= targetMaxHp * B.FATALITY_HP_PCT) {
    // Жестокость даёт ШАНС совершить фаталити (не гарантию): 0.5% за
    // уровень навыка, максимум 50%.
    const fatalityChance = Math.min(0.50, user.skills.cruelty * 0.005);
    if (Math.random() < fatalityChance) {
      // Ловкость защитника даёт шанс «ускользнуть» от занесённого клинка:
      // 0.5% за уровень, максимум 50%. Применяется только к реальным игрокам.
      const escapeChance = isBot ? 0 : Math.min(0.50, target.skills.agility * 0.005);
      if (Math.random() < escapeChance) {
        fatalityDodged = true;
      } else {
        fatality = true;
        user.pendingFatality = {
          targetId: target.id,
          name: target.name, isBot,
          exp: Date.now() + B.FATALITY_WINDOW_MS,
        };
      }
    }
  }

  tutorial.notify(user, 'attack', notices); // задание «Боевое крещение»

  // Цель (живой игрок) тоже изменилась — HP, деньги, потери техники.
  // Помечаем её на точечное сохранение (атакующий сохранится в http.js).
  if (!isBot && target && target.id) db.markUser(target.id);

  // Сводка участвовавшей техники для окна боя: ТОЛЬКО обычная военная
  // техника (секретные разработки в бою участвуют всегда полностью, но
  // в окне атаки не показываются — по требованию игрового дизайна).
  const armyBrief = (entries: any[]) => entries
    .filter((e) => e.taken > 0 && !e.secret)
    .map((e) => ({ name: e.name, count: e.taken, id: e.unitId, unitType: (config.UNIT_BY_ID[e.unitId] || {}).type }));

  // Оборонительные постройки цели, участвующие в защите (для окна боя)
  const defenseBuildings = (!isBot && target && target.buildings)
    ? Object.entries(target.buildings)
        .map(([id, count]) => {
          const bd = config.BUILDING_BY_ID[id];
          return (bd && bd.kind === 'defense' && (count as number) > 0)
            ? { id, name: bd.name, count: count as number, def: bd.def || 0 } : null;
        })
        .filter(Boolean)
    : [];

  return {
    win, crit, dodge,
    dealt, received, loot, xp,
    targetId, targetName: target.name, targetLevel, isBot,
    targetHpPct: Math.round((targetHpAfter / targetMaxHp) * 100),
    myArmy: armyBrief(aArmy.entries),
    enemyArmy: dArmy ? armyBrief(dArmy.entries) : [],
    enemyDefenseBuildings: defenseBuildings,
    myLosses, enemyLosses,
    fatality, fatalityDodged,
  };
}

// ---------- Фаталити: «ухо» или «жетон» ----------
function fatality(user: User, choice: string, notices: Notices) {
  const pf: any = user.pendingFatality;
  if (!pf || pf.exp < Date.now()) {
    user.pendingFatality = null;
    throw new u.ApiError('Момент упущен — враг уполз с поля боя.');
  }
  // Если цель — реальный игрок без ушей, фаталити совершить нельзя вообще
  if (!pf.isBot) {
    const victimCheck = player.users()[pf.targetId];
    if (victimCheck) {
      player.refresh(victimCheck); // актуализируем earsCurrent (регенерация)
      if (victimCheck.earsCurrent <= 0) {
        user.pendingFatality = null;
        throw new u.ApiError(`У «${victimCheck.name}» уже нет ушей — фаталити невозможно совершить.`);
      }
      // ЛОВКОСТЬ ЖЕРТВЫ: тем же шансом, что и уворот в бою (база макс 50% +
      // допинг «Призрак» до +20%), жертва может ускользнуть от фаталити —
      // и от отрезания уха, и от помилования. Окно просто закрывается.
      const dodgeBase = Math.min(B.DODGE_MAX, victimCheck.skills.agility * B.DODGE_PER_AGILITY);
      const dodgeChance = dodgeBase + (player.effMul(victimCheck, 'dodge_bonus') - 1);
      if (Math.random() < dodgeChance) {
        user.pendingFatality = null;
        notifications.push(victimCheck.id, 'fatality_escape', `Вы ускользнули от фаталити игрока ${user.name}!`, {
          attackerName: user.name, attackerId: user.id, at: Date.now(),
        });
        notices.push(`💨 «${victimCheck.name}» ускользнул в последний момент — фаталити сорвалось!`);
        return { choice: 'escaped', escaped: true, ears: user.ears, tokens: user.tokens };
      }
    }
  }
  user.pendingFatality = null;
  user.battle.fatalities++;
  ach.bump(user, 'fatalities', 1, notices);
  require('./dailyQuests').bump(user, 'fatalities', 1);

  if (choice === 'ear') {
    user.ears++;
    ach.bump(user, 'earsCut', 1, notices);
    let canLeaveMessage = false;  // true, если этот игрок отрезал ОБА уха
    if (!pf.isBot) {
      const victim = player.users()[pf.targetId];
      if (victim) {
        // Трофей «Тесак мясника»: шанс отрезать СРАЗУ ОБА уха
        const doublePct = trophies.discountPct ? trophies.discountPct(user, 'double_ear') : 0;
        const doubleCut = victim.earsCurrent >= 2 && Math.random() * 100 < doublePct;
        const cutsToMake = doubleCut ? 2 : 1;
        if (doubleCut) user.ears++; // второе ухо тоже в коллекцию

        if (!victim.earCutters) victim.earCutters = [null, null];
        for (let k = 0; k < cutsToMake; k++) {
          victim.earsLost++;
          victim.earsCurrent = Math.max(0, victim.earsCurrent - 1);
          victim.earsLostAt.push(Date.now());
          const cutIndex = config.EARS.MAX - victim.earsCurrent - 1;
          const slot = Math.max(0, Math.min(config.EARS.MAX - 1, cutIndex));
          victim.earCutters[slot] = { id: user.id, name: user.name };
        }

        // Трофей жертвы «Полевой хирург»: шанс мгновенно восстановить ухо.
        // Восстанавливает ОДНО ухо (последнее отрезанное). Если восстановил —
        // нападавший уже не отрезал «оба», и послание оставить нельзя.
        const restorePct = trophies.discountPct ? trophies.discountPct(victim, 'ear_restore') : 0;
        let restored = false;
        if (restorePct > 0 && Math.random() * 100 < restorePct && victim.earsCurrent < config.EARS.MAX) {
          victim.earsCurrent = Math.min(config.EARS.MAX, victim.earsCurrent + 1);
          if (victim.earsLostAt.length > 0) victim.earsLostAt.pop();
          // Снимаем последнюю отметку об отрезавшем (ухо вернулось)
          const lostNow = config.EARS.MAX - victim.earsCurrent;
          if (lostNow < 2) victim.earCutters[1] = null;
          if (lostNow < 1) victim.earCutters[0] = null;
          restored = true;
        }

        // Послание можно оставить только если СЕЙЧАС оба уха отрезаны этим игроком
        const c0 = victim.earCutters[0], c1 = victim.earCutters[1];
        if (c0 && c1 && c0.id === user.id && c1.id === user.id) {
          canLeaveMessage = true;
        }

        let penaltyNote = '';
        if (victim.earsCurrent <= 0) {
          victim.earPenaltyUntil = Date.now() + config.EARS.PENALTY_MS;
          penaltyNote = ' Оба уха отрезаны — штраф −10% к атаке и защите на 6 часов.';
        }
        const cutMsg = doubleCut ? 'оба уха одним ударом' : 'ухо';
        const restMsg = restored ? ' Но жертва мгновенно восстановила ухо полевым хирургом!' : '';
        notifications.push(victim.id, 'fatality_ear', `${user.name} совершил фаталити и отрезал вам ${cutMsg}${restored ? ', но вы восстановили ухо' : ''}`, {
          attackerName: user.name, attackerId: user.id, at: Date.now(),
          earsLeft: victim.earsCurrent, penaltyApplied: victim.earsCurrent <= 0,
          doubleCut, restored,
        });
        notices.push(`✂️ Фаталити! Отрезано: ${cutMsg} (трофеев-ушей всего: ${user.ears}).${penaltyNote}${restMsg}`);
      } else {
        notices.push(`✂️ Фаталити! Трофейное ухо отправлено в коллекцию (всего: ${user.ears}).`);
      }
    } else {
      notices.push(`✂️ Фаталити! Трофейное ухо отправлено в коллекцию (всего: ${user.ears}).`);
    }
    return { choice, ears: user.ears, tokens: user.tokens, canLeaveMessage, victimId: pf.isBot ? null : pf.targetId };
  }

  // Отпускаем: +1 жетон милосердия
  user.tokens++;
  if (!pf.isBot) {
    const victim = player.users()[pf.targetId];
    if (victim) {
      notifications.push(victim.id, 'fatality_mercy', `${user.name} мог совершить фаталити, но помиловал вас`, {
        attackerName: user.name, attackerId: user.id, at: Date.now(),
      });
    }
  }
  notices.push(`🎖 Враг отпущен. Получен жетон милосердия (всего: ${user.tokens}).`);
  return { choice, ears: user.ears, tokens: user.tokens };
}

// Оставить послание на профиле жертвы — доступно только тому, кто отрезал
// ОБА уха этому игроку. Послание видно всем в профиле жертвы.
function leaveEarMessage(user: User, victimId: string, text: string, notices: Notices) {
  const victim = player.users()[victimId];
  if (!victim) throw new u.ApiError('Игрок не найден');
  const c = victim.earCutters;
  const bothByUser = c && c[0] && c[1] && c[0].id === user.id && c[1].id === user.id;
  if (!bothByUser) throw new u.ApiError('Оставить послание может только тот, кто отрезал оба уха этому игроку');
  const clean = String(text || '').trim().slice(0, 200);
  if (!clean) {
    // Пустой текст = отказ оставить послание
    return { ok: true, left: false };
  }
  victim.earMessage = { byId: user.id, byName: user.name, text: clean };
  notices.push('✍️ Послание оставлено на профиле жертвы.');
  return { ok: true, left: true };
}

export = { opponents, attack, fatality, leaveEarMessage, botProfile, peekBot };
