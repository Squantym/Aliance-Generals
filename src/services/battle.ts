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
import bankHack = require('./bankHack');
import landmines = require('./landmines');
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

  // Базовый урон зависит от соотношения сил и имеет УЗКИЙ разброс (±2-3),
  // чтобы обычные удары были предсказуемы, а крит (×2, с трофеем до ×6)
  // не пересекался с обычным уроном по величине. Раньше разброс был большим
  // (напр. 8–18), из-за чего слабый крит мог оказаться меньше сильного
  // обычного удара — это выглядело хаотично.
  if (ratio >= 1.5) {
    // атакующий заметно слабее — бьёт слабо, но стабильно
    dealt = u.rnd(3, 5);
  } else if (ratio >= 1.2) {
    dealt = u.rnd(6, 9);
  } else if (ratio >= 0.9 && ratio <= 1.1) {
    // равные силы — «эталонный» удар
    dealt = u.rnd(12, 16);
  } else if (ratio >= 0.6) {
    dealt = u.rnd(18, 22);
  } else {
    // атакующий доминирует
    dealt = u.rnd(24, 28);
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
  if (user.pendingBankHack) throw new u.ApiError('Сначала решите, что делать с сейфом (взломать или продолжить бой)!');
  if (user.pendingMineDefuse) throw new u.ApiError('Сначала разберитесь с миной!');
  // Кулдаун атак — 1 секунда (защита от спама). Считаем его сразу, чтобы
  // спамить окно взлома банка тоже было нельзя.
  const ATTACK_CD_MS = 1000;
  const nowMs = Date.now();
  if ((user as any).lastAttackAt && nowMs - (user as any).lastAttackAt < ATTACK_CD_MS) {
    throw new u.ApiError('Слишком быстро! Между атаками нужна 1 секунда.');
  }
  if (user.res.am.cur < 1) throw new u.ApiError('Нет боеприпасов. Они восстанавливаются со временем.');
  if (user.res.hp.cur < config.PLAYER.MIN_HP_TO_FIGHT) {
    throw new u.ApiError(`Здоровье ниже ${config.PLAYER.MIN_HP_TO_FIGHT} — сначала подлечитесь.`);
  }
  (user as any).lastAttackAt = nowMs;

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

  // Сейф банка больше НЕ предлагается до боя — он выпадает с низким шансом
  // ПОСЛЕ резолва боя (см. конец resolveCombatCore). Так атака не блокируется
  // окном заранее, а сейф ощущается как случайный трофей во время рейда.
  return proceedToCombat(user, target, isBot, targetId, notices);
}

// Тратим боеприпас, фиксируем попытку, проверяем не сработала ли мина
// жертвы — и только если всё чисто, резолвим сам бой. Вызывается либо
// сразу из attack() (нет предложения взлома банка), либо из роутов
// bank-hack/guess и bank-hack/skip (после решения по сейфу).
function proceedToCombat(user: User, target: any, isBot: boolean, targetId: string, notices: Notices) {
  if (user.res.am.cur < 1) throw new u.ApiError('Нет боеприпасов. Они восстанавливаются со временем.');
  user.res.am.cur -= 1;
  user.battle.attacks++;
  require('./dailyQuests').bump(user, 'attacks', 1);
  ach.bump(user, 'attacks', 1, notices);
  try { require('./seasons').onAttack(user); } catch (e) {}

  // Армия, которую нападающий берёт в ЭТОТ бой — считаем один раз здесь,
  // чтобы то же самое количество техники учитывалось и при возможном
  // взрыве мины, и при обычном резолве боя.
  const aArmy = player.buildArmy(user, 'atk');

  // ----- Мина жертвы (только реальные игроки, только у жертвы, только
  // если есть хотя бы 1 мина в запасе и трофей «Растяжка» прокачан) -----
  if (!isBot) {
    const mineLevel = trophies.mineLevel(target);
    if ((target.landmines || 0) > 0 && mineLevel > 0 && landmines.rollTrigger(mineLevel)) {
      target.landmines -= 1;
      db.markUser(target.id);
      const { wires, correctIdx } = landmines.generateWires();
      user.pendingMineDefuse = {
        targetId, isBot,
        wires, correctIdx,
        techLossPct: landmines.techLossPct(mineLevel),
        aArmyEntries: aArmy.entries,
      };
      notices.push('💥 Вы нарвались на растяжку! Обезвредьте провода, пока не поздно.');
      require('./saboteurs').ensure(user);
      return {
        encounter: 'mine_defuse',
        wires: landmines.wiresView(wires),
        canSacrifice: (user.saboteurs!.suicide || 0) > 0,
      };
    }
  }

  return resolveCombatCore(user, target, isBot, aArmy, notices);
}

// ---------- РЕЗУЛЬТАТ ВЗЛОМА БАНКА: ввод кода ----------
// Бой уже прошёл при атаке (сейф выпадает ПОСЛЕ боя) — здесь только
// мини-игра «быки/коровы» и её итог. Повторно бой не запускаем.
function bankHackGuess(user: User, code: string, notices: Notices) {
  const { finished, result } = bankHack.guess(user, code, notices);
  if (!finished) return { encounter: 'bank_hack', ...result };
  return { bankHack: result, safeResolved: true };
}

// ---------- ЗАКРЫТЬ СЕЙФ БЕЗ ВЗЛОМА ----------
// Бой уже прошёл — «пропустить» и «отменить» теперь равнозначны: просто
// снимаем окно сейфа. Оставлены оба роута ради обратной совместимости.
function bankHackSkip(user: User) {
  bankHack.cancel(user);
  return { skipped: true };
}

// Игрок ушёл с окна сейфа — снимаем окно. Бой уже прошёл, ничего не теряем.
function bankHackCancel(user: User) {
  const cancelled = bankHack.cancel(user);
  return { cancelled };
}

// ---------- РАЗМИНИРОВАНИЕ: выбор провода ----------
function mineDefuse(user: User, wireIndex: number, notices: Notices) {
  const p = user.pendingMineDefuse;
  if (!p) throw new u.ApiError('Нет мины, которую нужно обезвредить');
  const idx = Math.floor(Number(wireIndex));
  if (!Number.isFinite(idx) || idx < 0 || idx >= p.wires.length) {
    throw new u.ApiError('Некорректный провод');
  }

  if (idx === p.correctIdx) {
    // Обезврежено — бой продолжается как обычно
    user.pendingMineDefuse = null;
    const target = player.users()[p.targetId];
    if (!target) return { mineDefused: true, aborted: true };
    player.refresh(target);
    notices.push('✂️ Провод перерезан верно — мина обезврежена!');
    const battleResult = resolveCombatCore(user, target, p.isBot, { entries: p.aArmyEntries }, notices);
    return { mineDefused: true, ...battleResult };
  }

  // Неверный провод — взрыв: 100% здоровья + % техники по трофею жертвы
  user.res.hp.cur = 0;
  ach.bump(user, 'deaths', 1, notices); // достижение «Смертник»: гибель при подрыве на мине
  const lostTech = landmines.destroyExactPct(user, p.aArmyEntries, p.techLossPct);
  const lostSaboteurs = require('./saboteurs').mineDestroy(user, notices);
  user.pendingMineDefuse = null;
  notices.push('💥 Взрыв! Мина уничтожила часть вашей техники и снесла всё здоровье.');
  return {
    mineDefused: false, exploded: true,
    techLossPct: p.techLossPct, lostTech, lostSaboteurs,
    hp: user.res.hp.cur,
  };
}

// ---------- РАЗМИНИРОВАНИЕ: пожертвовать смертником вместо проводов ----------
// Гарантированно спасает от взрыва: -1 смертник, бой продолжается как обычно.
function mineSacrifice(user: User, notices: Notices) {
  const p = user.pendingMineDefuse;
  if (!p) throw new u.ApiError('Нет мины, которую нужно обезвредить');
  const sb = require('./saboteurs');
  sb.ensure(user);
  if ((user.saboteurs!.suicide || 0) <= 0) throw new u.ApiError('Нет смертников в наличии');
  user.saboteurs!.suicide -= 1;
  user.pendingMineDefuse = null;
  const target = player.users()[p.targetId];
  if (!target) return { mineDefused: true, sacrificed: true, aborted: true };
  player.refresh(target);
  notices.push('💀 Смертник пожертвовал собой — вы избежали взрыва!');
  const battleResult = resolveCombatCore(user, target, p.isBot, { entries: p.aArmyEntries }, notices);
  return { mineDefused: true, sacrificed: true, ...battleResult };
}

// ----- Резолв самого боя: расчёт мощи, победа/поражение, грабёж, фаталити -----
// aArmy — армия атакующего, УЖЕ посчитанная в proceedToCombat (или взятая
// из «замороженного» состояния на момент подрыва на мине).
function resolveCombatCore(user: User, target: any, isBot: boolean, aArmy: any, notices: Notices) {
  const saboteurs = require('./saboteurs');
  // Диверсанты жертвы (реального игрока) режут мощь атакующего по типам.
  // У ботов диверсантов нет (нет экономики) — дебафф не применяется.
  const debuffOnAttacker = isBot ? undefined : saboteurs.debuffsFor(target);
  const aTotal = player.totalPower(user, 'atk', debuffOnAttacker);
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
    // Диверсанты АТАКУЮЩЕГО режут мощь защитника по типам (действует в
    // обе стороны боя — не только когда владелец сам атакует).
    const debuffOnDefender = saboteurs.debuffsFor(user);
    // Используем ту же формулу что и в totalPower: техника + постройки (с бонусом страны), потом трофей и эффекты
    const dTotal = player.totalPower(target, 'def', debuffOnDefender);
    dPow = Math.max(10, dTotal.power);
    targetMaxHp = player.maxima(target).hp;
    targetLevel = target.level;
  }

  // ----- Броски: крит атакующего, полный уворот защитника -----
  // Допинг «Ястреб» добавляет крит СВЕРХ лимита (capped-часть + бонус эффекта)
  const critBase = Math.min(B.CRIT_MAX_CHANCE, B.CRIT_BASE + user.skills.cruelty * B.CRIT_PER_CRUELTY);
  const critChance = critBase + player.effMul(user, 'crit_bonus') - 1; // effMul=1.2 → +0.2
  const crit = Math.random() < critChance;
  // Ловкость даёт ШАНС НА ПОЛНЫЙ УВОРОТ (обнуление урона). Теперь уворот
  // работает у ОБЕИХ сторон: и у цели (от атаки), и у самого атакующего
  // (от ответного урона). Допинг «Призрак» добавляет сверх лимита.
  const targetDodgeChance = isBot ? 0 : Math.min(B.DODGE_MAX, target.skills.agility * B.DODGE_PER_AGILITY) + player.effMul(target, 'dodge_bonus') - 1;
  const targetDodge = Math.random() < targetDodgeChance;
  const attackerDodgeChance = Math.min(B.DODGE_MAX, user.skills.agility * B.DODGE_PER_AGILITY) + player.effMul(user, 'dodge_bonus') - 1;
  const attackerDodge = Math.random() < attackerDodgeChance;

  // Базовый урон (БЕЗ крита) по пороговой формуле — соотносим обычную
  // атаку (без множителя крита) с защитой противника
  const { dealt: dealtBase } = resolveDamage(aPow, dPow);

  const critTrophyBonus = trophies.critPower(user); // 0..2.0 (0%-200%)
  const dealtCrit = crit
    ? Math.round(dealtBase * B.CRIT_MULT * (1 + critTrophyBonus))
    : dealtBase;

  // Полный уворот ЦЕЛИ — обнуляем нанесённый урон (влияет только на HP/грабёж)
  let dealt = targetDodge ? 0 : dealtCrit;

  // Урон, получаемый АТАКУЮЩИМ. Полный уворот АТАКУЮЩЕГО тоже обнуляет его.
  const { dealt: receivedBase } = resolveDamage(dPow, aPow);
  const botCritChance = isBot ? Math.min(0.30, 0.05 + (target.level || 1) * 0.002) : 0;
  const botCrit = isBot && Math.random() < botCritChance;
  let received = attackerDodge ? 0 : (botCrit ? Math.round(receivedBase * B.CRIT_MULT) : receivedBase);

  // ЧИСЛОВОЙ АПСЕТ: с шансом 5–10% сильнейший наносит МЕНЬШЕ урона, чем
  // получает — и, поскольку исход решает урон, он этот бой ПРОИГРЫВАЕТ.
  // Это и есть задуманная непредсказуемость: изредка фаворит падает.
  // Порог случайно выбирается в диапазоне 5–10% на каждый бой.
  // ЧИСЛОВОЙ АПСЕТ ОТКЛЮЧЁН (по требованию владельца).
  // Раньше с шансом 5–10% урон сильнейшего резался ниже полученного
  // (напр. 24 → 2), из-за чего по ОДНОМУ И ТОМУ ЖЕ противнику выходило то 2,
  // то 27 урона, и фаворит внезапно проигрывал. Теперь урон стабилен в рамках
  // своей полосы (обычный по resolveDamage / крит ×2+). Чтобы вернуть эффект —
  // раскомментировать блок ниже.
  // const upsetChance = B.DAMAGE_UPSET_MIN + Math.random() * (B.DAMAGE_UPSET_MAX - B.DAMAGE_UPSET_MIN);
  // if (Math.random() < upsetChance && dealt > 0 && received > 0) {
  //   const factor = 0.5 + Math.random() * 0.4; // 50–90% от урона противника
  //   if (aPow >= dPow) {
  //     if (dealt >= received) dealt = Math.max(1, Math.round(received * factor));
  //   } else {
  //     if (received >= dealt) received = Math.max(1, Math.round(dealt * factor));
  //   }
  // }
  user.res.hp.cur = Math.max(1, user.res.hp.cur - received);

  // ИСХОД боя решает УРОН: побеждает тот, кто нанёс больше. Это значит:
  //  • крит слабого игрока может перевернуть бой — если он критом нанёс
  //    больше, чем получил, он выигрывает (так и задумано);
  //  • числовой апсет (5–10%) занижает урон сильнейшего ниже полученного —
  //    и тогда сильнейший честно проигрывает;
  //  • при равенстве урона (например, оба увернулись и дошли до 0)
  //    исход решает мощь — иначе исход был бы неопределён.
  // ИСХОД боя. Террористы (боты 💀 из BOT_NAMES, т.е. НЕ «псевдоигроки»)
  // ВСЕГДА проигрывают игроку — они низкоуровневый фарм, а не вызов.
  // Псевдоигроки (isPlayerLike) и реальные игроки решаются по урону:
  // побеждает тот, кто нанёс больше; при равенстве — по мощи.
  const win = (isBot && !target.isPlayerLike)
    ? true
    : (dealt !== received ? dealt > received : aPow >= dPow);

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
  // Софт-редукция ПОТЕРЬ техники от обороны (грабёж больше не режется обороной:
  // с реального игрока берётся ровно 5% наличных, см. ветку ниже).
  const lossReduce = defPoints / (defPoints + B.DEF_LOSS_SOFT);

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
    try { require('./seasons').onWin(user); } catch (e) {}
    try { require('./tutorial').notify(user, 'win', notices); } catch (e) {} // курс молодого бойца
    // Проверка титулов
    try {
      require('./features').checkTitles(user, notices);
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
      // Реальный игрок: строго 5% (LOOT_PCT) от ТЕКУЩИХ наличных на руках.
      // Деньги в банке (target.bank) НЕ трогаем — банк защищён от обычных атак.
      // БЕЗ затухания за серию атак (lootMul) и БЕЗ софт-редукции обороны
      // (lootReduce): каждая атака снимает 5% от остатка наличных, следующая —
      // 5% от нового (уменьшенного) остатка. Трофей «Мародёр»/эффекты loot_pct
      // применяются сверху как обычно.
      const looterBonus = 1 + (player.trophyDiscountPct ? player.trophyDiscountPct(user, 'loot') / 100 : 0);
      loot = Math.floor(target.dollars * B.LOOT_PCT * player.effMul(user, 'loot_pct') * looterBonus);
      loot = Math.max(0, Math.min(loot, target.dollars));
      target.dollars -= loot;
      target.battle.defLosses++;
      ach.bump(target, 'losses', 1, []); // «Битый»: поражение в обороне
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
    try { require('./seasons').onLoot(user, loot); } catch (e) {}
  } else {
    user.battle.losses++;
    ach.bump(user, 'losses', 1, notices); // «Битый»: поражение в нападении
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
    // уровень навыка, максимум 50%. Допинг «Ястреб» (crit_bonus) усиливает
    // не только крит в бою, но и этот шанс — раньше учитывался только в
    // critChance, из-за чего покупка допинга не ощущалась на фаталити.
    const fatalityChance = Math.min(0.50, user.skills.cruelty * 0.005 + (player.effMul(user, 'crit_bonus') - 1));
    if (Math.random() < fatalityChance) {
      // Ловкость защитника даёт шанс «ускользнуть» от занесённого клинка:
      // 0.5% за уровень, максимум 50%. Применяется только к реальным игрокам.
      const escapeChance = isBot ? 0 : Math.min(0.50, target.skills.agility * 0.005);
      if (Math.random() < escapeChance) {
        fatalityDodged = true;
        // Достижение «Неуловимый» — у ЦЕЛИ (реальный игрок ушёл от клинка)
        ach.bump(target, 'dodgesInFatality', 1, []);
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

  // Расход диверсантов в обычном бою: у атакующего заметно чаще, чем
  // у защитника (реального игрока). У ботов диверсантов нет.
  try {
    saboteurs.battleAttrition(user, 'attacker');
    if (!isBot) saboteurs.battleAttrition(target, 'defender');
  } catch (e) {}

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

  // Сводка ДИВЕРСАНТОВ сторон для окна боя (наравне с техникой). Показываем
  // работающих (в пределах лимита) по типам — именно они влияют на бой.
  // У ботов диверсантов нет. Названия/иконки типов формирует фронтенд.
  const sabBrief = (who: any) => {
    if (!who || who.isBot || !who.saboteurs) return [];
    const out: any[] = [];
    for (const t of ['ground', 'sea', 'air', 'secret', 'building']) {
      const cnt = saboteurs.active(who, t);
      if (cnt > 0) out.push({ type: t, count: cnt });
    }
    return out;
  };

  const result: any = {
    win, crit, dodge: targetDodge, attackerDodge,
    dealt, received, loot, xp,
    targetId: target.id, targetName: target.name, targetLevel, isBot,
    targetHpPct: Math.round((targetHpAfter / targetMaxHp) * 100),
    myArmy: armyBrief(aArmy.entries),
    enemyArmy: dArmy ? armyBrief(dArmy.entries) : [],
    mySaboteurs: sabBrief(user),
    enemySaboteurs: isBot ? [] : sabBrief(target),
    enemyDefenseBuildings: defenseBuildings,
    myLosses, enemyLosses,
    fatality, fatalityDodged,
  };

  // ----- Сейф банка: низкий шанс ПОСЛЕ боя -----
  // Только реальные игроки (у ботов нет банка), трофей «Медвежатник» ≥ 1,
  // у жертвы есть деньги в банке. Не наслаиваем сейф на нерешённое фаталити —
  // одно окно решения за раз. tryOffer сам ставит pendingBankHack и вернёт
  // { encounter:'bank_hack', ... } с параметрами окна для клиента.
  if (!isBot && !user.pendingFatality) {
    const offer = bankHack.tryOffer(user, target);
    if (offer) Object.assign(result, offer);
  }

  return result;
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
    require('./dailyQuests').bump(user, 'earsCut', 1); // ежедневное поручение «Коллекция»
    try { require('./seasons').onFatalityEar(user); } catch (e) {}
    let canLeaveMessage = false;  // true, если этот игрок отрезал ОБА уха
    if (!pf.isBot) {
      const victim = player.users()[pf.targetId];
      if (victim) {
        // Трофей «Тесак мясника»: шанс отрезать СРАЗУ ОБА уха
        const doublePct = trophies.discountPct ? trophies.discountPct(user, 'double_ear') : 0;
        const doubleCut = victim.earsCurrent >= 2 && Math.random() * 100 < doublePct;
        const cutsToMake = doubleCut ? 2 : 1;
        if (doubleCut) { user.ears++; require('./dailyQuests').bump(user, 'earsCut', 1); } // второе ухо тоже в коллекцию

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
        // Бот: постоянного состояния ушей у него нет, но трофей «Тесак
        // мясника» всё равно даёт шанс отрезать СРАЗУ ОБА уха — в коллекцию.
        const doublePct = trophies.discountPct ? trophies.discountPct(user, 'double_ear') : 0;
        const doubleCut = Math.random() * 100 < doublePct;
        if (doubleCut) user.ears++; // второе ухо в коллекцию
        notices.push(`✂️ Фаталити! ${doubleCut ? 'Отрезаны СРАЗУ ОБА уха' : 'Трофейное ухо'} — в коллекцию (всего: ${user.ears}).`);
      }
    } else {
      // Жертва-игрок не найдена (редкий случай): та же логика, что для бота.
      const doublePct = trophies.discountPct ? trophies.discountPct(user, 'double_ear') : 0;
      if (Math.random() * 100 < doublePct) user.ears++;
      notices.push(`✂️ Фаталити! Трофейное ухо отправлено в коллекцию (всего: ${user.ears}).`);
    }
    return { choice, ears: user.ears, tokens: user.tokens, canLeaveMessage, victimId: pf.isBot ? null : pf.targetId };
  }

  // Отпускаем: +1 жетон милосердия
  user.tokens++;
  ach.bump(user, 'merciesGiven', 1, notices); // достижение «Милосердный»
  try { require('./seasons').onMercy(user); } catch (e) {}
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

export = {
  opponents, attack, fatality, leaveEarMessage, botProfile, peekBot, removeUnits,
  bankHackGuess, bankHackSkip, bankHackCancel, mineDefuse, mineSacrifice,
};
