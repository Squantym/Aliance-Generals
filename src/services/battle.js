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

function makeBot(user) {
  const level = u.clamp(user.level + u.rnd(-7, 7), 1, config.PLAYER.MAX_LEVEL);
  const base = Math.max(30, player.buildArmy(user, 'atk').power);
  // 50% — обычный бот-террорист, 50% — псевдоигрок (примерно равный по силе)
  const isPlayerLike = Math.random() < 0.5;
  // Псевдоигроки почти равны игроку (90-115%), террористы слабее (50-95%)
  const powerRange = isPlayerLike
    ? (0.90 + Math.random() * 0.25)
    : (0.50 + Math.random() * 0.45);
  const power = Math.max(25, Math.round(base * powerRange * (1 + (level - user.level) * 0.03)));
  const maxHp = 100 + level * 8;
  const bot = {
    id: 'bot_' + u.uid(10),
    isBot: true,
    isPlayerLike,
    name: isPlayerLike ? randomPlayerName() : u.pick(config.BOT_NAMES),
    flag: isPlayerLike ? u.pick(config.BOT_PLAYER_FLAGS) : '💀',
    level, power, maxHp, hp: maxHp,
    loot: Math.round(300 * Math.pow(level, 1.2)),
  };
  botCache.set(bot.id, { bot, exp: Date.now() + B.BOTS_TTL_MS });
  return bot;
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

  const list = picked.map((t) => ({
    id: t.id, name: t.name, level: t.level,
    flag: player.flag(t), isBot: false,
    online: Date.now() - (t.lastSeen || 0) < 5 * 60 * 1000,
  }));
  while (list.length < 10) {
    const b = makeBot(user);
    list.push({ id: b.id, name: b.name, level: b.level, flag: b.flag, isBot: true, online: true });
  }
  u.shuffle(list);
  return { opponents: list };
}

// Снять у проигравшего часть техники, взятой в бой.
// Секретные разработки неуязвимы (по ТЗ). Возвращает список потерь.
function removeUnits(victim, armyEntries, pct) {
  const pool = armyEntries.filter((e) => !e.secret && e.unitId && e.taken > 0);
  let toLose = Math.floor(pool.reduce((s, e) => s + e.taken, 0) * pct);
  const lost = {};
  while (toLose > 0 && pool.length > 0) {
    const i = u.rnd(0, pool.length - 1);
    const e = pool[i];
    const m = victim.units[e.unitId];
    const have = m ? (m[e.mk] || 0) : 0;
    if (have <= 0 || e.taken <= 0) { pool.splice(i, 1); continue; }
    const n = Math.min(have, e.taken, toLose, Math.max(1, u.rnd(1, Math.ceil(toLose / 2))));
    m[e.mk] = have - n;
    e.taken -= n;
    toLose -= n;
    lost[e.name] = (lost[e.name] || 0) + n;
    if (e.taken <= 0) pool.splice(i, 1);
    // Если у юнита суммарно ничего не осталось — удалим запись из коллекции
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
  ach.bump(user, 'attacks', 1, notices);

  // ----- Мощь атакующего: армия × эффекты × трофеи -----
  const aArmy = player.buildArmy(user, 'atk');
  let aPow = aArmy.power * player.effMul(user, 'atk_pct') * (1 + trophies.atkBonus(user));
  aPow = Math.max(10, aPow); // даже без техники солдат стреляет из автомата

  // ----- Мощь защитника -----
  let dPow, dArmy = null, defPoints = 0, targetMaxHp, targetLevel;
  if (isBot) {
    dPow = target.power;
    targetMaxHp = target.maxHp;
    targetLevel = target.level;
  } else {
    dArmy = player.buildArmy(target, 'def');
    defPoints = player.buildingDef(target);
    dPow = (dArmy.power + defPoints * config.BUILDING_DEF_POWER) *
      player.effMul(target, 'def_pct') * (1 + trophies.defBonus(target));
    dPow = Math.max(10, dPow);
    targetMaxHp = player.maxima(target).hp;
    targetLevel = target.level;
  }

  // ----- Броски: ±15% случайности, крит атакующего, уворот защитника -----
  const critChance = Math.min(B.CRIT_MAX, B.CRIT_BASE + user.skills.cruelty * B.CRIT_PER_CRUELTY);
  const crit = Math.random() < critChance;
  const dodgeChance = isBot ? 0 : Math.min(B.DODGE_MAX, target.skills.agility * B.DODGE_PER_AGILITY);
  const dodge = Math.random() < dodgeChance;

  let aRoll = aPow * (0.85 + Math.random() * 0.3);
  if (crit) aRoll *= B.CRIT_MULT + trophies.critPower(user); // «Лицензия на убийство» усиливает крит
  if (dodge) aRoll *= B.DODGE_REDUCE;                        // ловкость защитника гасит удар
  const dRoll = dPow * (0.85 + Math.random() * 0.3);
  const win = aRoll > dRoll;

  // ----- Урон по здоровью обеих сторон -----
  const dealt = u.clamp(Math.round(6 + 26 * (aRoll / (aRoll + dRoll)) + Math.random() * 6), 5, 45);
  const received = u.clamp(Math.round(4 + 20 * (dRoll / (aRoll + dRoll)) + Math.random() * 5), 2, 40);
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
    ach.bump(user, 'wins', 1, notices);
    if (isBot) {
      // Базовая выплата с бота заметно урезана: с уровнем растёт мягко
      const baseBot = target.loot;
      loot = Math.round(baseBot * (0.5 + Math.random() * 0.4) * lootMul);
    } else {
      // С игрока: 7% от наличных (было 10%), с учётом уменьшающего множителя
      // и трофея «Мародёр» (+2% за уровень)
      const looterBonus = 1 + (player.trophyDiscountPct ? player.trophyDiscountPct(user, 'loot') / 100 : 0);
      loot = Math.floor(target.dollars * B.LOOT_PCT * (1 - lootReduce) * lootMul * player.effMul(user, 'loot_pct') * looterBonus);
      loot = Math.max(0, Math.min(loot, target.dollars));
      target.dollars -= loot;
      target.battle.defLosses++;
      enemyLosses.push(...removeUnits(target, dArmy.entries, B.LOSS_DEF_PCT * (1 - lossReduce)));
      social.mailTo(target, user.name, 'Сводка боя: поражение',
        `На вашу базу напал ${user.name} (ур. ${user.level}). Награблено: $${u.fmt(loot)}.` +
        (enemyLosses.length ? ` Потеряна техника: ${enemyLosses.join(', ')}.` : ' Техника уцелела.'));
    }
    // Победитель тоже несёт небольшие потери в технике (война есть война)
    myLosses.push(...removeUnits(user, aArmy.entries, B.LOSS_ATK_WIN_PCT));
    player.addMoney(user, loot, true);
  } else {
    user.battle.losses++;
    if (!isBot) {
      target.battle.defWins++;
      social.mailTo(target, user.name, 'Сводка боя: атака отбита',
        `${user.name} (ур. ${user.level}) атаковал вашу базу, но оборона выстояла. Так держать!`);
    }
    // Проигравший несёт большие потери
    myLosses.push(...removeUnits(user, aArmy.entries, B.LOSS_ATK_PCT));
  }

  // Опыт: фиксированный диапазон из конфига (4–7 за победу, 1–2 за поражение)
  const xp = win
    ? u.rnd(B.XP_WIN_MIN,  B.XP_WIN_MAX)
    : u.rnd(B.XP_LOSS_MIN, B.XP_LOSS_MAX);
  player.addXp(user, xp, notices);

  // ----- Окно фаталити -----
  // Доступно против реальных игроков И ботов-игроков (псевдоигроков с
  // позывными и флагами). На обычных террористах (💀) — нельзя, это
  // безликая массовка.
  const fatalityAllowed = !isBot || (isBot && target.isPlayerLike);
  let fatality = false;
  if (fatalityAllowed && win && crit && targetHpAfter <= targetMaxHp * B.FATALITY_HP_PCT) {
    fatality = true;
    user.pendingFatality = {
      targetId: target.id,
      name: target.name, isBot,
      exp: Date.now() + B.FATALITY_WINDOW_MS,
    };
  }

  tutorial.notify(user, 'attack', notices); // задание «Боевое крещение»

  return {
    win, crit, dodge,
    dealt, received, loot, xp,
    targetId, targetName: target.name, targetLevel, isBot,
    targetHpPct: Math.round((targetHpAfter / targetMaxHp) * 100),
    myLosses, enemyLosses,
    fatality,
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

module.exports = { opponents, attack, fatality };
