// ===================================================================
// src/services/battle.js — раздел «Война»
// Список из 10 целей: реальные игроки в диапазоне ±10 уровней и 2–3
// бота-террориста. Каждое обновление списка генерирует новый набор.
// Атака тратит 1 боеприпас. Победа = грабёж наличных + опыт.
// При крите и почти полном уничтожении доступно фаталити:
// отрезать ухо (ресурс «ухо») или отпустить (ресурс «жетон»).
// ===================================================================

const config = require('../../config/gameConfig');
const db = require('../core/db');
const u = require('../core/utils');
const player = require('./player');
const social = require('./social');
const ach = require('./achievements');
const tutorial = require('./tutorial');
const trophies = require('./trophies');

const B = config.BATTLE;

// Кэш живых ботов: id → { bot, exp }. Боты живут 15 минут,
// чтобы по ним можно было успеть ударить после показа списка.
const botCache = new Map();

function pruneBots() {
  const now = Date.now();
  for (const [id, rec] of botCache) {
    if (rec.exp < now) botCache.delete(id);
  }
}

// Создание бота-террориста, сбалансированного под игрока:
// его мощь — доля от атакующей мощи самого игрока, чтобы бой
// был честным на любом этапе прокачки.
// Генерация рандомного «игрового» позывного: Префикс + Корень + Суффикс
function randomPlayerName() {
  const p = u.pick(config.BOT_PLAYER_PREFIXES);
  const c = u.pick(config.BOT_PLAYER_CORES);
  const s = u.pick(config.BOT_PLAYER_SUFFIXES);
  return p + c + s;
}

// Псевдоармия бота для отображения в окне боя (учёта потерь не ведём —
// бот эфемерен и при следующей атаке его уже нет)
function makeBotArmy(bot) {
  const level = bot.level || 1;
  const entries = [];
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

function makeBot(user) {
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
    loot: Math.round(300 * Math.pow(level, 1.2)),
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
function botProfile(botId, viewer) {
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
function opponents(user) {
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
//   |def - atk| <= 10%         -> «примерное равенство»: рандомный исход,
//                                  но с перевесом по факту чисел (кто
//                                  сильнее — тот чаще выигрывает и наносит
//                                  урон ближе к верхней границе диапазона)
//   atk > def (выше equal-зоны) -> атакующий доминирует, урон растёт к 45
// Возвращает { dealt, win } — урон по защитнику и исход (атакующий победил?)
// ---------------------------------------------------------------------
function resolveDamage(atk, def) {
  const ratio = def / Math.max(1, atk); // >1 защитник сильнее, <1 — атакующий сильнее
  let dealt, winChance;

  if (ratio >= 1.5) {
    dealt = u.rnd(1, 5);
    winChance = 0.05;
  } else if (ratio >= 1.2) {
    dealt = u.rnd(5, 15);
    winChance = 0.20;
  } else if (ratio >= 0.9 && ratio <= 1.1) {
    const advantage = atk / Math.max(1, def);
    winChance = u.clamp(0.5 * advantage, 0.30, 0.70);
    dealt = u.rnd(10, 25);
  } else {
    const dominance = Math.min(1, (0.9 - ratio) / 0.9);
    dealt = Math.round(25 + dominance * 20 + Math.random() * 5);
    winChance = u.clamp(0.70 + dominance * 0.25, 0.70, 0.95);
  }

  dealt = u.clamp(Math.round(dealt), 1, 45);
  const win = Math.random() < winChance;
  return { dealt, win };
}

function removeUnits(victim, armyEntries, pct) {
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
  let toLose = Math.max(1, Math.floor(pool.reduce((s, e) => s + e.taken, 0) * pct));
  const lost = {};
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
    if ((m[0] || 0) + (m[1] || 0) + (m[2] || 0) <= 0) delete victim.units[e.unitId];
  }
  return Object.entries(lost).map(([name, count]) => `${name} ×${count}`);
}

// ---------- ГЛАВНАЯ ФУНКЦИЯ: атака цели ----------
function attack(user, targetId, notices) {
  if (user.pendingFatality) throw new u.ApiError('Сначала решите судьбу поверженного врага (фаталити)!');
  if (user.res.am.cur < 1) throw new u.ApiError('Нет боеприпасов. Они восстанавливаются со временем.');
  if (user.res.hp.cur < config.PLAYER.MIN_HP_TO_FIGHT) {
    throw new u.ApiError(`Здоровье ниже ${config.PLAYER.MIN_HP_TO_FIGHT} — сначала подлечитесь.`);
  }

  // Находим цель: бот из кэша или реальный игрок из базы
  let target = null, isBot = false;
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
    if (Math.abs(target.level - user.level) > config.PLAYER.LEVEL_RANGE) {
      throw new u.ApiError('Цель вне диапазона ±10 уровней');
    }
    if (target.res.hp.cur < config.PLAYER.MIN_HP_TO_FIGHT) {
      throw new u.ApiError('Игрок восстанавливается в лазарете — добивать лежачих запрещено уставом.');
    }
  }

  // Тратим боеприпас и фиксируем попытку
  user.res.am.cur -= 1;
  user.battle.attacks++;
  require('./dailyQuests').bump(user, 'attacks', 1);
  ach.bump(user, 'attacks', 1, notices);

  // ----- Мощь атакующего: армия × эффекты × трофеи -----
  const aArmy = player.buildArmy(user, 'atk');
  const aTotal = player.totalPower(user, 'atk');
  let aPow = Math.max(10, aTotal.power);

  // ----- Мощь защитника -----
  let dPow, dArmy = null, defPoints = 0, targetMaxHp, targetLevel;
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
  const critChance = Math.min(B.CRIT_MAX_CHANCE, B.CRIT_BASE + user.skills.cruelty * B.CRIT_PER_CRUELTY);
  const crit = Math.random() < critChance;
  // Ловкость даёт ШАНС НА ПОЛНЫЙ УВОРОТ (не просто снижение урона):
  // 0.5% за уровень, максимум 50%. При уворачивании защитник получает
  // 0 урона, но победа всё равно засчитывается атакующему (он «попал
  // мимо», но инициативу не потерял).
  const dodgeChance = isBot ? 0 : Math.min(B.DODGE_MAX, target.skills.agility * B.DODGE_PER_AGILITY);
  const dodge = Math.random() < dodgeChance;

  // Эффективная атака с учётом крита (база ×1.5, трофей до ×4.5 на максимуме)
  let effectiveAtk = aPow;
  if (crit) effectiveAtk *= B.CRIT_MULT * (1 + trophies.critPower(user));

  // Пороговая формула: соотносим эффективную атаку с защитой противника
  const { dealt: dealtRaw, win } = resolveDamage(effectiveAtk, dPow);

  // Полный уворот — обнуляем урон, но не исход боя
  const dealt = dodge ? 0 : dealtRaw;

  // Урон, получаемый АТАКУЮЩИМ от защитника, считается по той же формуле
  // в обратную сторону (защитник «атакует» своей мощью защиты против
  // атаки противника — упрощённая симметрия для второй стороны обмена).
  const { dealt: receivedRaw } = resolveDamage(dPow, aPow);
  const received = receivedRaw;
  user.res.hp.cur = Math.max(1, user.res.hp.cur - received);

  let targetHpAfter;
  if (isBot) {
    target.hp = Math.max(0, target.hp - dealt);
    targetHpAfter = target.hp;
  } else {
    target.res.hp.cur = Math.max(1, target.res.hp.cur - dealt);
    targetHpAfter = target.res.hp.cur;
  }

  // ----- Грабёж, опыт, потери техники -----
  let loot = 0;
  const myLosses = [], enemyLosses = [];
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
    require('./dailyQuests').bump(user, 'wins', 1);
    ach.bump(user, 'wins', 1, notices);
    if (isBot) {
      // Базовая выплата с бота — широкий случайный разброс (40%-120% от
      // базы), плюс убывание при повторных атаках на ботов за последний час.
      const baseBot = target.loot;
      loot = Math.round(baseBot * (0.4 + Math.random() * 0.8) * lootMul);
      // Гарантированный минимум: за одну победную атаку на бота/террориста
      // игрок должен суметь купить хотя бы 10 единиц актуальной техники
      // своего уровня (но не уровня бота — ориентируемся на игрока).
      // Гарантия тоже немного «дышит» от повторных атак, но не уходит в 0.
      const guaranteedMin = Math.max(
        Math.round(config.minUnitPriceAtLevel(user.level) * 10 * Math.max(0.3, lootMul)),
        1
      );
      if (loot < guaranteedMin) loot = guaranteedMin;
      // Симулируем потери техники бота для отображения в окне боя.
      // У бота нет реальной техники в БД, поэтому просто берём имена из
      // его псевдоармии и пишем туда «×N потерь».
      if (dArmy && dArmy.entries) {
        for (const e of dArmy.entries) {
          if (e.taken > 0) {
            const lost = Math.max(1, Math.floor(e.taken * B.LOSS_DEF_PCT * (1 - lossReduce) * 1.5));
            if (lost > 0) enemyLosses.push(`${e.name} ×${lost}`);
          }
        }
      }
    } else {
      // С игрока: 7% от наличных (было 10%), с учётом уменьшающего множителя
      // и трофея «Мародёр» (+2% за уровень)
      const looterBonus = 1 + (player.trophyDiscountPct ? player.trophyDiscountPct(user, 'loot') / 100 : 0);
      loot = Math.floor(target.dollars * B.LOOT_PCT * (1 - lootReduce) * lootMul * player.effMul(user, 'loot_pct') * looterBonus);
      loot = Math.max(0, Math.min(loot, target.dollars));
      target.dollars -= loot;
      target.battle.defLosses++;
      // Потери защитника (только если он реальный игрок)
      enemyLosses.push(...removeUnits(target, dArmy.entries, B.LOSS_DEF_PCT * (1 - lossReduce)));
      social.mailTo(target, user.name, 'Сводка боя: поражение',
        `На вашу базу напал ${user.name} (ур. ${user.level}). Награблено: $${u.fmt(loot)}.` +
        (enemyLosses.length ? ` Потеряна техника: ${enemyLosses.join(', ')}.` : ' Техника уцелела.'));
    }
    // Победитель тоже несёт небольшие потери (война есть война)
    myLosses.push(...removeUnits(user, aArmy.entries, B.LOSS_ATK_WIN_PCT));
    player.addMoney(user, loot, true);
  } else {
    user.battle.losses++;
    if (!isBot) {
      target.battle.defWins++;
      // Защитник, отразив атаку, тоже несёт минимальные потери
      enemyLosses.push(...removeUnits(target, dArmy.entries, B.LOSS_DEF_WIN_PCT));
      social.mailTo(target, user.name, 'Сводка боя: атака отбита',
        `${user.name} (ур. ${user.level}) атаковал вашу базу, но оборона выстояла. Так держать!`);
    }
    // Проигравший атакующий теряет существенно больше
    myLosses.push(...removeUnits(user, aArmy.entries, B.LOSS_ATK_PCT));
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
  let fatality = false;
  let fatalityDodged = false;
  if (fatalityAllowed && win && crit && targetHpAfter <= targetMaxHp * B.FATALITY_HP_PCT) {
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

  // Сводка участвовавшей техники для окна боя (только реально взятые в бой)
  const armyBrief = (entries) => entries
    .filter((e) => e.taken > 0)
    .map((e) => ({ name: e.name, count: e.taken, secret: !!e.secret }));

  return {
    win, crit, dodge,
    dealt, received, loot, xp,
    targetId, targetName: target.name, targetLevel, isBot,
    targetHpPct: Math.round((targetHpAfter / targetMaxHp) * 100),
    myArmy: armyBrief(aArmy.entries),
    enemyArmy: dArmy ? armyBrief(dArmy.entries) : [],
    myLosses, enemyLosses,
    fatality, fatalityDodged,
  };
}

// ---------- Фаталити: «ухо» или «жетон» ----------
function fatality(user, choice, notices) {
  const pf = user.pendingFatality;
  if (!pf || pf.exp < Date.now()) {
    user.pendingFatality = null;
    throw new u.ApiError('Момент упущен — враг уполз с поля боя.');
  }
  user.pendingFatality = null;
  user.battle.fatalities++;
  ach.bump(user, 'fatalities', 1, notices);
  require('./dailyQuests').bump(user, 'fatalities', 1);

  if (choice === 'ear') {
    // Отрезаем ухо: +1 ресурс «ухо» себе, жертве — счётчик потерянных ушей
    user.ears++;
    ach.bump(user, 'earsCut', 1, notices);
    if (!pf.isBot) {
      const victim = player.users()[pf.targetId];
      if (victim) {
        victim.earsLost++;
        social.mailTo(victim, user.name, '✂️ Фаталити!',
          `${user.name} совершил фаталити и отрезал вам ухо. Война — дело жестокое.`);
      }
    }
    notices.push(`✂️ Фаталити! Трофейное ухо отправлено в коллекцию (всего: ${user.ears}).`);
    return { choice, ears: user.ears, tokens: user.tokens };
  }

  // Отпускаем: +1 жетон милосердия
  user.tokens++;
  if (!pf.isBot) {
    const victim = player.users()[pf.targetId];
    if (victim) {
      social.mailTo(victim, user.name, '🎖 Помилование',
        `${user.name} мог совершить фаталити, но отпустил вас. Вы обязаны ему жизнью.`);
    }
  }
  notices.push(`🎖 Враг отпущен. Получен жетон милосердия (всего: ${user.tokens}).`);
  return { choice, ears: user.ears, tokens: user.tokens };
}

module.exports = { opponents, attack, fatality, botProfile };
