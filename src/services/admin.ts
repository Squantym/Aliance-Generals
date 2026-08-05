// ===================================================================
// src/services/admin.ts — инструменты администратора
// ===================================================================

import u = require('../core/utils');
import config = require('../../config/gameConfig');
import player = require('./player');
import social = require('./social');
import ach = require('./achievements');
import discounts = require('./discounts');
import globalBuffs = require('./globalBuffs');
import auditLog = require('./auditLog');
import notifications = require('./notifications');
import units = require('./units');
import buildings = require('./buildings');
import production = require('./production');
import trophies = require('./trophies');
import market = require('./market');
import groups = require('./groups');
import legion = require('./legion');
import db = require('../core/db');
import type { User, Notices } from '../types';

function brief(p: User) {
  return {
    id: p.id, name: p.name, flag: player.flag(p), isAdmin: !!p.isAdmin,
    level: p.level, xp: p.xp,
    dollars: p.dollars, gold: p.gold, bank: p.bank,
    skillPoints: p.skillPoints,
    ears: p.ears, earsCurrent: p.earsCurrent, tokens: p.tokens,
    createdAt: p.createdAt, lastSeen: p.lastSeen,
    banned: !!p.banned, banReason: p.banReason || '',
    online: (Date.now() - (p.lastSeen || 0)) < 5 * 60 * 1000,
  };
}

// Список / поиск игроков
function listPlayers(query: any) {
  const q = String(query || '').trim().toLowerCase();
  return {
    players: Object.values(player.users() as Record<string, User>)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .slice(0, 100)
      .map(brief),
  };
}

// ── АДМИН: полный просмотр профиля игрока «его глазами» ───────────
// Собирает ВСЁ, что видит сам игрок на своих экранах: экономику, армию,
// постройки, секретные разработки, трофеи, покупки контейнеров и т.д.
// Переиспользует те же view-функции, что и обычные роуты игрока —
// просто вызывает их с target вместо req.user.
function viewAsPlayer(adminUser: User, targetId: string) {
  const target = player.users()[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  player.refresh(target);
  return {
    me: player.mePayload(target),
    // isOwn=true (viewer === target) — раскрывает армию/постройки/секретки
    // полностью, как в своём профиле, а не урезанно как для чужого
    profile: player.publicProfile(target, target),
    units: units.list(target),
    buildings: buildings.list(target),
    production: production.view(target),
    trophies: trophies.list(target),
    containerHistory: market.containerHistory(target),
  };
}

// ── АДМИН: ПОЛНЫЙ СНИМОК игрока (характеристики + всё имущество) ──────
// Плоская, читаемая для админки сводка: основное, ресурсы, навыки,
// мощь, боевая статистика, армия, постройки, секретки, трофеи,
// диверсанты, ракеты, альянс/легион. Только просмотр (не «его глазами»).
const SKILL_LABELS: Record<string, string> = {
  energy: '⚡ Энергия', health: '❤️ Здоровье', ammo: '🔫 Боеприпасы',
  cruelty: '💀 Жестокость', agility: '🏃 Ловкость',
};
const SAB_LABELS: Record<string, string> = {
  ground: '🪖 Наземные', sea: '🚢 Морские', air: '✈️ Воздушные',
  secret: '🕵️ Секретные', building: '🏗 Построечные', suicide: '💀 Смертники',
};

function playerSnapshot(adminUser: User, targetId: string) {
  const t = player.users()[targetId];
  if (!t) throw new u.ApiError('Игрок не найден');
  player.refresh(t);

  const mx = player.maxima(t);
  const atk = player.totalPower(t, 'atk');
  const def = player.totalPower(t, 'def');
  const country = config.COUNTRY_BY_ID[t.country];

  // Навыки с русскими подписями
  const skills = Object.keys(SKILL_LABELS).map((k) => ({
    id: k, name: SKILL_LABELS[k], level: (t.skills as any)[k] || 0,
  }));

  // Армия: разворачиваем units { unitId: { 0,1,2 } } в плоский список
  const army: any[] = [];
  let armyTotal = 0;
  for (const [unitId, mkMap] of Object.entries(t.units || {})) {
    const cu = config.UNIT_BY_ID[unitId];
    if (!cu) continue;
    for (let mk = 0; mk <= 2; mk++) {
      const count = (mkMap && (mkMap as any)[mk]) || 0;
      if (count <= 0) continue;
      army.push({
        name: cu.name + (mk ? ` Mk${mk}` : ''),
        type: config.UNIT_TYPE_NAMES[cu.type], count,
      });
      armyTotal += count;
    }
  }
  army.sort((a, b) => b.count - a.count);

  // Постройки
  const buildingsList: any[] = [];
  for (const [id, count] of Object.entries(t.buildings || {})) {
    const b = config.BUILDING_BY_ID[id];
    if (b && count) buildingsList.push({ name: b.name, count, kind: b.kind });
  }

  // Секретные разработки (+ супероружие)
  const secretList: any[] = [];
  for (const d of config.SECRET_DEVS) {
    const count = (t.secretDevs || {})[d.id] || 0;
    if (count > 0) secretList.push({ name: d.name, count });
  }
  if (t.superSecret > 0) secretList.push({ name: config.SUPER_DEV.name, count: t.superSecret });

  // Трофеи (только прокачанные)
  const trophyList: any[] = [];
  for (const tr of config.TROPHIES) {
    const lvl = (t.trophies || {})[tr.id] || 0;
    if (lvl > 0) trophyList.push({ name: tr.name, level: lvl, maxLevel: config.TROPHY_MAX_LEVEL });
  }

  // Диверсанты: наличие / лимит / работает по каждому виду
  const sb = require('./saboteurs');
  sb.ensure(t);
  const sabList = ['ground', 'sea', 'air', 'secret', 'building'].map((k) => ({
    id: k, name: SAB_LABELS[k],
    count: t.saboteurs![k as 'ground'], limit: t.saboteurLimits![k as 'ground'],
    active: Math.min(t.saboteurs![k as 'ground'], t.saboteurLimits![k as 'ground']),
  }));
  const suicideCount = t.saboteurs!.suicide || 0;

  // Ракеты (силосы)
  const silosBuilt = (t.silos || []).length;

  const alliance = player.allianceInfo(t);
  const legion = player.legionInfo(t);

  return {
    main: {
      id: t.id, name: t.name, flag: player.flag(t),
      country: country ? country.name : t.country,
      status: t.status || '',
      level: t.level, xp: t.xp, xpNext: config.xpToNext(t.level),
      rank: player.rank(t.level), rating: player.rating(t),
      isAdmin: !!t.isAdmin, banned: !!t.banned, banReason: t.banReason || '',
      createdAt: t.createdAt, lastSeen: t.lastSeen || t.createdAt,
      online: (Date.now() - (t.lastSeen || 0)) < 5 * 60 * 1000,
    },
    resources: {
      dollars: t.dollars, gold: t.gold, bank: t.bank,
      tokens: t.tokens, skillPoints: t.skillPoints,
      earsTrophy: t.ears, earsCurrent: t.earsCurrent, earsMax: config.EARS.MAX,
      landmines: t.landmines || 0,
      hp: { cur: t.res.hp.cur, max: mx.hp },
      en: { cur: t.res.en.cur, max: mx.en },
      am: { cur: t.res.am.cur, max: mx.am },
    },
    skills,
    power: {
      atk: atk.power, def: def.power,
      capacity: player.capacity(t), armyTotal,
    },
    battle: { ...t.battle },
    army, buildings: buildingsList, secretDevs: secretList, trophies: trophyList,
    saboteurs: { types: sabList, suicide: suicideCount, suicideLimit: config.SABOTEURS.suicide.fixedLimit },
    silos: silosBuilt,
    // Личный альянс — просто счётчик приглашённых членов (имени нет).
    allianceMembers: (alliance && alliance.members) || 0,
    legion: legion ? { name: legion.name, members: legion.members, rankName: legion.rankName } : null,
    extra: {
      loginStreak: t.loginStreak || 0,
      refCount: t.refCount || 0,
      seasonRating: t.seasonRating || 0,
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// Применить набор ресурсов к одному игроку
// Возвращает строку что выдали (для лога)
// ──────────────────────────────────────────────────────────────────
function applyGrant(target: User, body: any): string[] {
  player.refresh(target);
  const granted: string[] = [];
  const addInt = (field) => u.toInt(body[field], 0);

  if (addInt('dollars'))    { player.addMoney(target, addInt('dollars'), false);             granted.push(`$${u.fmt(addInt('dollars'))}`); }
  if (addInt('gold'))       { player.addGold(target, addInt('gold'), 'admin');                        granted.push(`🪙 ${addInt('gold')}`); }
  if (addInt('skillPoints')){ target.skillPoints = Math.max(0, target.skillPoints + addInt('skillPoints')); granted.push(`${addInt('skillPoints')} оч. навыков`); }
  if (addInt('ears'))       {
    // Уши от администратора — в отдельный кошелёк, не смешиваются с игровыми
    target.adminEars   = (target.adminEars   || 0) + addInt('ears');
    granted.push(`${addInt('ears')} 👂`);
  }
  if (addInt('tokens'))     {
    // Жетоны от администратора — аналогично
    target.adminTokens = (target.adminTokens || 0) + addInt('tokens');
    granted.push(`${addInt('tokens')} 🎖`);
  }
  if (addInt('xp'))         { player.addXp(target, addInt('xp'), []);                       granted.push(`${u.fmt(addInt('xp'))} XP`); }

  if (body.setLevel !== undefined && body.setLevel !== null && body.setLevel !== '') {
    const lvl = u.clamp(u.toInt(body.setLevel, target.level), 1, config.PLAYER.MAX_LEVEL);
    target.level = lvl; target.xp = 0; target.counters.level = lvl;
    const mx = player.maxima(target);
    target.res.hp.cur = mx.hp; target.res.en.cur = mx.en; target.res.am.cur = mx.am;
    granted.push(`уровень = ${lvl}`);
  }

  const mx = player.maxima(target);
  if (body.energy !== undefined && body.energy !== '') { target.res.en.cur = u.clamp(u.toInt(body.energy), 0, mx.en); granted.push('энергия'); }
  if (body.health !== undefined && body.health !== '') { target.res.hp.cur = u.clamp(u.toInt(body.health), 0, mx.hp); granted.push('здоровье'); }
  if (body.ammo   !== undefined && body.ammo   !== '') { target.res.am.cur = u.clamp(u.toInt(body.ammo),   0, mx.am); granted.push('боеприпасы'); }

  ach.check(target, []);
  return granted;
}

// ──────────────────────────────────────────────────────────────────
// Создать всплывающий подарок (сохраняется на пользователе)
// ──────────────────────────────────────────────────────────────────
function pushGiftPopup(target: User, grantedList: string[], customNote?: string | null): void {
  if (!target.pendingGifts) target.pendingGifts = [];
  target.pendingGifts.push({
    id: u.uid(8),
    at: Date.now(),
    items: grantedList,         // ['$1 000', '50 👂', ...]
    note: customNote || undefined,
  });
}

// ──────────────────────────────────────────────────────────────────
// Выдача одному игроку
// ──────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────
// ОТЪЁМ ресурсов у игрока (включая банк)
// Значения указываются ПОЛОЖИТЕЛЬНЫМИ — сколько списать. Ниже нуля не
// уходим: если у игрока меньше, снимаем всё, что есть, и пишем сколько.
// ──────────────────────────────────────────────────────────────────
function applyTake(target: User, body: any): string[] {
  player.refresh(target);
  const taken: string[] = [];
  const amt = (field: string) => Math.max(0, u.toInt(body[field], 0));

  // Наличные
  const wantCash = amt('dollars');
  if (wantCash) {
    const real = Math.min(wantCash, Math.floor(target.dollars || 0));
    target.dollars = Math.max(0, Math.floor((target.dollars || 0) - real));
    taken.push(`$${u.fmt(real)} наличными`);
  }
  // Банк — деньги на вкладе (обычные атаки его не трогают, админ может)
  const wantBank = amt('bank');
  if (wantBank) {
    const real = Math.min(wantBank, Math.floor(target.bank || 0));
    target.bank = Math.max(0, Math.floor((target.bank || 0) - real));
    taken.push(`$${u.fmt(real)} из банка`);
  }
  // Золото
  const wantGold = amt('gold');
  if (wantGold) {
    const real = Math.min(wantGold, Math.floor(target.gold || 0));
    target.gold = Math.max(0, Math.floor((target.gold || 0) - real));
    taken.push(`🪙 ${u.fmt(real)}`);
  }
  // Очки навыков
  const wantSp = amt('skillPoints');
  if (wantSp) {
    const real = Math.min(wantSp, target.skillPoints || 0);
    target.skillPoints = Math.max(0, (target.skillPoints || 0) - real);
    taken.push(`${real} оч. навыков`);
  }
  // Уши: сначала админский кошелёк, потом игровой
  const wantEars = amt('ears');
  if (wantEars) {
    let left = wantEars;
    const fromAdmin = Math.min(left, target.adminEars || 0);
    target.adminEars = (target.adminEars || 0) - fromAdmin; left -= fromAdmin;
    const fromReal = Math.min(left, target.ears || 0);
    target.ears = (target.ears || 0) - fromReal; left -= fromReal;
    taken.push(`${wantEars - left} 👂`);
  }
  // Жетоны: та же схема
  const wantTok = amt('tokens');
  if (wantTok) {
    let left = wantTok;
    const fromAdmin = Math.min(left, target.adminTokens || 0);
    target.adminTokens = (target.adminTokens || 0) - fromAdmin; left -= fromAdmin;
    const fromReal = Math.min(left, target.tokens || 0);
    target.tokens = (target.tokens || 0) - fromReal; left -= fromReal;
    taken.push(`${wantTok - left} 🎖`);
  }
  // Опыт (уровень не понижаем — только очки опыта текущего уровня)
  const wantXp = amt('xp');
  if (wantXp) {
    const real = Math.min(wantXp, target.xp || 0);
    target.xp = Math.max(0, (target.xp || 0) - real);
    taken.push(`${u.fmt(real)} XP`);
  }

  return taken;
}

function take(adminUser: User, body: any, notices: Notices) {
  const target = player.users()[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');

  const taken = applyTake(target, body);
  if (!taken.length) throw new u.ApiError('Не указано, что списывать');

  db.markUser(target.id);
  const note = String(body.giftNote || '').trim().slice(0, 300);
  notifications.push(target.id, 'admin_take', '⚠️ Списание администрацией',
    { text: note || `Администратор ${adminUser.name} списал у вас: ${taken.join(', ')}.` });

  notices.push(`➖ Списано у ${target.name}: ${taken.join(', ')}`);
  return { player: brief(target) };
}


// Вторая линия обороны: проверяем права ВНУТРИ функции, а не только на
// роуте. Аудит показал, что модератор мог вызвать setBan, setPassword и
// resetAccount напрямую — роут их закрывал, но сама функция никого не
// спрашивала, и любой внутренний вызов обходил защиту.
function assertZone(actor: User, zone: string, what: string): void {
  const roles = require('./roles');
  if (!roles.canAccessZone(actor, zone)) {
    throw new u.ApiError(roles.roleOf(actor) === 'moderator'
      ? `${what} доступно только администрации. «Дозор» работает с чатами.`
      : 'Недостаточно прав');
  }
}

function grant(adminUser: User, body: any, notices: Notices) {
  assertZone(adminUser, 'economy', 'Выдача ресурсов');
  const target = player.users()[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');

  const granted = applyGrant(target, body);
  if (!granted.length) throw new u.ApiError('Не указано, что выдавать');

  const customNote = String(body.giftNote || '').trim().slice(0, 300);
  pushGiftPopup(target, granted, customNote || undefined);

  const mailText = customNote
    ? customNote
    : `Администратор ${adminUser.name} выдал вам: ${granted.join(', ')}.`;
  notifications.push(target.id, 'admin_gift', customNote ? '🎁 Подарок от администрации' : '📦 Подарок администрации', { text: mailText });

  notices.push(`✅ Выдано игроку ${target.name}: ${granted.join(', ')}`);
  return { player: brief(target) };
}

// ──────────────────────────────────────────────────────────────────
// Выдача ВСЕМ игрокам сразу
// ──────────────────────────────────────────────────────────────────
function grantAll(adminUser: User, body: any, notices: Notices) {
  assertZone(adminUser, 'economy', 'Массовая выдача');
  const all = player.users();
  const keys = ['dollars','gold','skillPoints','ears','tokens','xp'];
  const hasAny = keys.some(k => u.toInt(body[k], 0) !== 0);
  if (!hasAny) throw new u.ApiError('Не указано, что выдавать');

  const customNote = String(body.giftNote || '').trim().slice(0, 300);
  let count = 0;
  let sampleGranted: string[] = [];

  for (const target of Object.values(all as Record<string, User>)) {
    const granted = applyGrant(target, body);
    if (granted.length) {
      pushGiftPopup(target, granted, customNote || undefined);
      const mailText = customNote
        ? customNote
        : `Администратор ${adminUser.name} выдал всем игрокам: ${granted.join(', ')}.`;
      notifications.push(target.id, 'admin_gift', '🎁 Подарок всем игрокам', { text: mailText });
      if (!sampleGranted.length) sampleGranted = granted;
      count++;
    }
  }

  notices.push(`✅ Выдано ${count} игрокам: ${sampleGranted.join(', ')}`);
  return { count };
}

// ──────────────────────────────────────────────────────────────────
// Игрок забирает подарок (вызывается с фронта)
// ──────────────────────────────────────────────────────────────────
function claimGift(user: User, giftId: string) {
  if (!user.pendingGifts || !user.pendingGifts.length) return { ok: true, remaining: 0 };
  const before = user.pendingGifts.length;
  user.pendingGifts = user.pendingGifts.filter(g => g.id !== giftId);
  return { ok: true, claimed: before - user.pendingGifts.length, remaining: user.pendingGifts.length };
}

// ──────────────────────────────────────────────────────────────────
// Скидки
// ──────────────────────────────────────────────────────────────────
function discountCategories() {
  return { categories: discounts.categories(), active: discounts.getActive(), scheduled: discounts.allScheduled() };
}
function setDiscount(adminUser: User, body: any, notices: Notices) {
  const cat = String(body.category || '');
  const pct = u.toInt(body.pct, 0);
  const hours = Math.max(0, Number(body.hours) || 0);
  const delayHours = Math.max(0, Number(body.delayHours) || 0);
  discounts.set(cat, pct, hours, delayHours);
  if (pct > 0 && hours > 0) {
    const label = delayHours > 0
      ? `«${discounts.CATEGORIES[cat] || cat}»: ${pct}% запланирована — старт через ${delayHours} ч., действует ${hours} ч.`
      : `«${discounts.CATEGORIES[cat] || cat}»: ${pct}% на ${hours} ч.`;
    notices.push(`🏷 Скидка ${label}`);
  } else {
    notices.push(`Скидка «${discounts.CATEGORIES[cat] || cat}» снята.`);
  }
  return discountCategories();
}

// ──────────────────────────────────────────────────────────────────
// Глобальные бонусы
// ──────────────────────────────────────────────────────────────────
function listGlobalBuffs() {
  return { active: globalBuffs.listActive(), keys: Object.entries(globalBuffs.KEYS).map(([k, v]) => ({ key: k, label: v.label })) };
}
function setGlobalBuff(adminUser: User, body: any, notices: Notices) {
  const key = String(body.key || '');
  const pct = u.toInt(body.pct, 0);
  const hours = Math.max(0, Number(body.hours) || 0);
  globalBuffs.set(key, pct, hours);
  if (pct > 0 && hours > 0) {
    notices.push(`🎉 Активирован глобальный бонус «${(globalBuffs.KEYS[key] || {}).label || key}»: +${pct}% на ${hours} ч.`);
  } else {
    notices.push(`Глобальный бонус «${key}» снят.`);
  }
  return listGlobalBuffs();
}

// ──────────────────────────────────────────────────────────────────
// Журнал действий
// ──────────────────────────────────────────────────────────────────
async function listLogs(query: any) {
  const limit = Math.min(1000, Math.max(1, u.toInt(query.limit, 200)));
  const entries = query.userId
    ? await auditLog.listForUser(String(query.userId), limit)
    : await auditLog.listAll(limit);
  return { logs: entries };
}

// ── Бан / разбан игрока ───────────────────────────────────────────
function setBan(adminUser: User, body: any, notices: Notices) {
  assertZone(adminUser, 'moderation', 'Блокировка аккаунта');
  const players: Record<string, User> = require('./player').users();
  const target = players[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');
  // Сотрудников проекта банит только владелец
  const rolesSrv = require('./roles');
  const targetRole = rolesSrv.roleOf(target);
  if (targetRole === 'owner') throw new u.ApiError('Нельзя забанить владельца проекта');
  if (targetRole && !rolesSrv.isOwner(adminUser)) throw new u.ApiError('Нельзя забанить сотрудника проекта');

  const ban = !!body.banned;
  target.banned = ban;
  if (ban) {
    target.banReason = String(body.reason || 'Нарушение правил').slice(0, 200);
    target.bannedAt = Date.now();
    // Срок бана в минутах. 0 или пусто — бессрочно. Минимум — 1 минута:
    // короткие баны нужны для остывания, а не только для тяжёлых случаев.
    const mins = u.toInt(body.minutes, 0);
    (target as any).banUntil = mins > 0
      ? Date.now() + u.clamp(mins, 1, 365 * 24 * 60) * 60 * 1000
      : 0;
    // Завершаем все сессии забаненного игрока
    try {
      const sessions = require('../core/db').load('sessions', {});
      for (const [tok, uid] of Object.entries(sessions)) {
        if ((typeof uid === 'string' ? uid : (uid as any) && (uid as any).u) === target.id) delete (sessions as any)[tok];
      }
      require('../core/db').save('sessions');
    } catch (e) {}
  } else {
    (target as any).banUntil = 0;
    target.banReason = '';
    target.bannedAt = 0;
  }
  require('../core/db').save('users');
  notices.push(ban
    ? `🚫 Игрок «${target.name}» забанен. Причина: ${target.banReason}`
    : `✅ Игрок «${target.name}» разбанен.`);
  return { userId: target.id, banned: ban };
}

// ── Полное обнуление аккаунта (игрок начинает заново) ─────────────
// Сбрасывает все игровые характеристики к стартовым значениям, сохраняя
// учётные данные (логин, пароль, email, имя, гражданство, статус админа).
// ── Полный сброс аккаунта: игрок начинает игру заново, БЕЗ ИСКЛЮЧЕНИЙ.
// Убираем из альянса/легиона (с передачей лидерства/расформированием),
// чистим глобальные летящие ракеты игрока и пересобираем весь профиль из
// эталона newUser — сохраняя только идентификацию (логин/почта/роль/бан/
// реф-код). Любые НЕ перечисленные явно поля прогресса гарантированно
// удаляются, т.к. объект пересобирается с нуля.
function leaveGroupForReset(target: User, kind: string): void {
  const db = require('../core/db');
  const DEFS: Record<string, { coll: string; field: string }> = {
    alliance: { coll: 'alliances', field: 'allianceId' },
    legion: { coll: 'legions', field: 'legionId' },
  };
  const def = DEFS[kind];
  const groupId = (target as any)[def.field];
  (target as any)[def.field] = null;
  if (!groupId) return;
  const all = db.load(def.coll, {});
  const g = all[groupId];
  if (!g) return;
  g.members = (g.members || []).filter((m: string) => m !== target.id);
  if (g.leaderId === target.id) {
    if (g.members.length === 0) delete all[groupId];       // никого не осталось — расформировываем
    else g.leaderId = g.members[0];                        // лидерство — первому оставшемуся
  }
  db.save(def.coll);
}

function resetAccount(adminUser: User, body: any, notices: Notices) {
  assertZone(adminUser, 'security', 'Сброс аккаунта');
  const players: Record<string, User> = require('./player').users();
  const target = players[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.isAdmin && target.id !== adminUser.id) {
    throw new u.ApiError('Нельзя обнулить аккаунт другого администратора');
  }
  const db = require('../core/db');

  // 1) Выводим игрока из альянса и легиона (чистим состав групп, лидерство)
  try { leaveGroupForReset(target, 'alliance'); } catch (e) {}
  try { leaveGroupForReset(target, 'legion'); } catch (e) {}

  // 2) Чистим глобальные летящие ракеты, где игрок — атакующий или цель
  try {
    const rockets = db.load('rockets', {});
    let changed = false;
    for (const rid of Object.keys(rockets)) {
      const rk = rockets[rid];
      if (rk.attackerId === target.id || rk.targetId === target.id) { delete rockets[rid]; changed = true; }
    }
    if (changed) db.save('rockets');
  } catch (e) {}

  // 3) Пересобираем весь профиль из эталона нового игрока
  const fresh: any = require('./auth').newUser(
    target.id, target.name, target.email, target.passHash, target.salt,
    target.country, target.isAdmin, target.emailVerified
  );
  // Сохраняем то, что относится к ИДЕНТИФИКАЦИИ/аккаунту, а не к прогрессу:
  fresh.createdAt = target.createdAt;                 // возраст аккаунта
  fresh.emailVerifyToken = target.emailVerifyToken;   // состояние подтверждения почты
  fresh.emailVerifySentAt = target.emailVerifySentAt;
  fresh.resetToken = (target as any).resetToken || null;
  fresh.resetTokenExp = (target as any).resetTokenExp || 0;
  fresh.banned = target.banned;                       // сброс не снимает бан
  fresh.banReason = target.banReason;
  fresh.bannedAt = target.bannedAt;
  fresh.refCode = (target as any).refCode;            // личный код-приглашение
  fresh.referredBy = (target as any).referredBy || null; // кто пригласил (история)
  if (target.isBot) { fresh.isBot = true; fresh.behavior = (target as any).behavior; }
  fresh.lastSeen = Date.now();

  // Полностью заменяем содержимое объекта (удаляем ВСЕ старые ключи —
  // никаких остатков прогресса, даже полей, добавленных в будущем)
  for (const k of Object.keys(target)) delete (target as any)[k];
  Object.assign(target, fresh);

  db.save('users');
  // Уведомляем игрока
  try {
    require('./notifications').push(target.id, 'account_reset',
      '⚠️ Ваш аккаунт был обнулён администрацией. Вы начинаете игру заново.', {});
  } catch (e) {}
  notices.push(`♻️ Аккаунт «${target.name}» полностью обнулён — игрок начинает заново (альянс, шахты, лазеры, постройки, ресурсы — всё сброшено).`);
  return { userId: target.id };
}

// ── Сброс отдельного ПАРАМЕТРА: у всех игроков или у одного ───────
// param — какой параметр сбросить; userId — если задан, только у этого
// игрока, иначе у всех. Позволяет точечно чинить/обнулять системы.
function resetParam(adminUser: User, body: any, notices: Notices) {
  const players: Record<string, User> = require('./player').users();
  const param = String(body.param || '');
  const userId = body.userId ? String(body.userId) : null;

  const RESETTERS: Record<string, (t: User) => void> = {
    // Прогресс миссий хранится в missionProgress (пройденные шаги/конфликты)
    // и missionQueue (шаги в процессе с таймерами). Легаси-поле user.missions
    // системой миссий не используется — чистим всё, чтобы наверняка.
    missions: (t) => {
      t.missionProgress = {};
      t.missionQueue = [];
      t.missions = {};
      (t as any).counters.missionStages = 0;
    },
    achievements: (t) => { (t as any).achStages = {};
      (t as any).counters = { ...(t as any).counters, wins: 0, attacks: 0, fatalities: 0, unitsBought: 0, buildingsBuilt: 0, earsCut: 0, moneyEarned: 0, battleLoot: 0 }; },
    trophies: (t) => { t.trophies = Object.fromEntries(config.TROPHIES.map((tr: any) => [tr.id, 0])); (t as any).trophyQueue = []; },
    skills: (t) => { t.skills = { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 }; t.skillPoints = 0; },
    money: (t) => { t.dollars = config.PLAYER.START_DOLLARS; t.gold = config.PLAYER.START_GOLD; t.bank = 0; },
    units: (t) => { t.units = {}; t.workshops = 0; (t as any).modernQueue = []; },
    buildings: (t) => { t.buildings = {}; },
    ears: (t) => { t.ears = 0; t.earsLost = 0; t.earsCurrent = config.EARS.MAX; t.earsLostAt = []; t.earPenaltyUntil = 0; t.earCutters = [null, null]; t.earMessage = null; },
    battle: (t) => { t.battle = { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 }; t.vsRecord = {}; },
    effects: (t) => { t.effects = []; },
    alliances: (t) => { t.allianceMembers = 0; t.allianceRoster = []; t.allianceDiplomats = 0; t.allianceInviteLog = []; t.allianceId = null; t.legionId = null; },
    tokens: (t) => { t.tokens = 0; },
    cosmetics: (t) => { (t as any).ownedCosmetics = []; (t as any).profileFrame = null; (t as any).profileBg = null; (t as any).titles = []; (t as any).activeTitle = null; },
    streak: (t) => { t.loginStreak = 0; t.lastLoginDay = ''; },
  };

  const fn = RESETTERS[param];
  if (!fn) throw new u.ApiError(`Неизвестный параметр: ${param}`);

  let count = 0;
  if (userId) {
    const target = players[userId];
    if (!target) throw new u.ApiError('Игрок не найден');
    if (target.isAdmin && target.id !== adminUser.id) {
      throw new u.ApiError('Нельзя сбрасывать параметры другого администратора');
    }
    fn(target);
    count = 1;
  } else {
    for (const t of Object.values(players)) {
      if (t.isAdmin) continue;
      fn(t);
      count++;
    }
  }
  require('../core/db').save('users');
  const scope = userId ? `у игрока «${players[userId].name}»` : `у всех (${count})`;
  notices.push(`♻️ Параметр «${param}» сброшен ${scope}.`);
  return { param, count, userId };
}

// ── Сброс ВСЕХ миссий (у всех или у одного игрока) ────────────────
function resetMissions(adminUser: User, body: any, notices: Notices) {
  return resetParam(adminUser, { param: 'missions', userId: body.userId }, notices);
}

// ── Полная очистка всех групп (альянсов и легионов) ──────────────
// Стирает все альянсы, легионы, активные/прошедшие бои и логи.
// Игроки начинают создавать группы заново.
function wipeGroups(adminUser: User, body: any, notices: Notices) {
  const db = require('../core/db');
  const what = (body && body.what) || 'all'; // 'alliances' | 'legions' | 'all'

  let cleared: string[] = [];
  if (what === 'alliances' || what === 'all') {
    // Стираем общие альянсы (старая система) и личные счётчики
    const alliances = db.load('alliances', {});
    for (const k of Object.keys(alliances)) delete alliances[k];
    db.save('alliances');
    const inv = db.load('alliance_invites', {});
    for (const k of Object.keys(inv)) delete inv[k];
    db.save('alliance_invites');
    const players: Record<string, User> = require('./player').users();
    for (const p of Object.values(players)) {
      p.allianceId = null;
      (p as any).allianceMembers = 0;
      (p as any).allianceRoster = [];
      (p as any).allianceDiplomats = 0;
    }
    cleared.push('альянсы');
  }
  if (what === 'legions' || what === 'all') {
    // Стираем легионы, бои и логи боёв
    const legions = db.load('legions', {});
    for (const k of Object.keys(legions)) delete legions[k];
    db.save('legions');
    const battles = db.load('battles', {});
    for (const k of Object.keys(battles)) delete battles[k];
    db.save('battles');
    const players: Record<string, User> = require('./player').users();
    for (const p of Object.values(players)) {
      p.legionId = null;
    }
    cleared.push('легионы и логи боёв');
  }
  db.save('users');
  notices.push(`🧹 Очищено: ${cleared.join(', ')}. Игроки создают заново.`);
  return { cleared };
}

// ═══════════════════════════════════════════════════════════════════
// ТЕХНИЧЕСКИЙ РАЗДЕЛ: полное удаление аккаунта и смена пароля
// ═══════════════════════════════════════════════════════════════════

// ── ПОЛНОЕ УДАЛЕНИЕ АККАУНТА ──────────────────────────────────────
// В отличие от «обнуления» (resetAccount), которое оставляет учётную
// запись живой, здесь игрок стирается из игры целиком: логин
// освобождается, войти под старым паролем нельзя — сервер отвечает так,
// будто такого позывного никогда не было. Подчищаются ВСЕ коллекции и
// перекрёстные ссылки у других игроков (уши, история боёв, эффекты),
// чтобы нигде не осталось битых ссылок на удалённый профиль.
// Требуется подтверждение: body.confirmName должен совпасть с позывным.
function deleteAccount(adminUser: User, body: any, notices: Notices) {
  assertZone(adminUser, 'moderation', 'Удаление аккаунта');
  const db = require('../core/db');
  const players: Record<string, User> = require('./player').users();
  const target = players[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.id === adminUser.id) throw new u.ApiError('Нельзя удалить собственный аккаунт');
  if (target.isAdmin) throw new u.ApiError('Нельзя удалить аккаунт администратора. Сначала снимите права.');

  // Защита от случайного клика: админ вручную вводит позывной игрока
  const confirm = String(body.confirmName || '').trim().toLowerCase();
  if (confirm !== String(target.name).trim().toLowerCase()) {
    throw new u.ApiError('Подтверждение не совпало: введите точный позывной игрока');
  }

  const id = target.id;
  const name = target.name;
  const cleaned: string[] = [];

  // 1) Выводим из альянса и легиона (лидерство передаётся / группа
  //    расформировывается — та же логика, что при обнулении)
  try { leaveGroupForReset(target, 'alliance'); } catch (e) {}
  try { leaveGroupForReset(target, 'legion'); } catch (e) {}

  // 2) Все сессии — иначе по живому токену можно продолжать играть
  try {
    const sessions = db.load('sessions', {});
    let n = 0;
    for (const [tok, uid] of Object.entries(sessions)) {
      if (uid === id) { delete (sessions as any)[tok]; n++; }
    }
    if (n) { db.save('sessions'); cleaned.push(`сессии (${n})`); }
  } catch (e) {}

  // 3) Коллекции вида { userId: [...] } — почта, уведомления, push-подписки
  for (const coll of ['mail', 'notifications', 'pushsubs', 'alliance_invites']) {
    try {
      const store = db.load(coll, {});
      if (store[id]) { delete store[id]; db.save(coll); cleaned.push(coll); }
    } catch (e) {}
  }

  // 4) Коллекции вида { recordId: { userId } } — награды и тикеты поддержки
  for (const coll of ['rewards', 'support']) {
    try {
      const store = db.load(coll, {});
      let n = 0;
      for (const key of Object.keys(store)) {
        if (store[key] && store[key].userId === id) { delete store[key]; n++; }
      }
      if (n) { db.save(coll); cleaned.push(`${coll} (${n})`); }
    } catch (e) {}
  }

  // 5) Санкции: снимаем санкцию НА игрока и вычищаем его взносы из
  //    санкций на других (иначе в списке заказчиков будет призрак)
  try {
    const sanc = db.load('sanctions', {});
    let changed = false;
    if (sanc[id]) { delete sanc[id]; changed = true; }
    for (const key of Object.keys(sanc)) {
      const entry: any = sanc[key];
      if (!entry || !Array.isArray(entry.orders)) continue;
      const before = entry.orders.length;
      entry.orders = entry.orders.filter((o: any) => o && o.byId !== id);
      if (entry.orders.length !== before) {
        // Пересчитываем награду по оставшимся взносам
        entry.bounty = entry.orders.reduce((s: number, o: any) => s + (o.amount || 0), 0);
        if (!entry.orders.length) delete sanc[key];
        changed = true;
      }
    }
    if (changed) { db.save('sanctions'); cleaned.push('санкции'); }
  } catch (e) {}

  // 6) Летящие ракеты, где игрок — атакующий или цель
  try {
    const rockets = db.load('rockets', {});
    let n = 0;
    for (const rid of Object.keys(rockets)) {
      const rk: any = rockets[rid];
      if (rk && (rk.attackerId === id || rk.targetId === id)) { delete rockets[rid]; n++; }
    }
    if (n) { db.save('rockets'); cleaned.push(`ракеты (${n})`); }
  } catch (e) {}

  // 7) Бои легиона: убираем игрока из составов и статистики активности
  try {
    const battles = db.load('battles', {});
    let changed = false;
    for (const bid of Object.keys(battles)) {
      const b: any = battles[bid];
      if (!b) continue;
      if (b.combatants && b.combatants[id]) { delete b.combatants[id]; changed = true; }
      if (b.activity && b.activity[id] !== undefined) { delete b.activity[id]; changed = true; }
    }
    if (changed) { db.save('battles'); cleaned.push('бои легиона'); }
  } catch (e) {}

  // 8) Общий чат: стираем сообщения удалённого игрока
  try {
    const w = db.load('world', { chat: [], auctions: [], seq: 1 });
    if (Array.isArray(w.chat)) {
      const before = w.chat.length;
      w.chat = w.chat.filter((m: any) => m && m.userId !== id && m.authorId !== id);
      if (w.chat.length !== before) { db.save('world'); cleaned.push(`чат (${before - w.chat.length})`); }
    }
  } catch (e) {}

  // 9) Перекрёстные ссылки у ОСТАЛЬНЫХ игроков: отрезанные уши,
  //    послание на ухе, личная история боёв, наложенные эффекты.
  //    Без этой чистки в чужих профилях остались бы ссылки в никуда.
  let refs = 0;
  for (const p of Object.values(players)) {
    if (p.id === id) continue;
    let touched = false;
    if (Array.isArray((p as any).earCutters)) {
      const cs = (p as any).earCutters;
      for (let i = 0; i < cs.length; i++) {
        if (cs[i] && cs[i].id === id) { cs[i] = null; touched = true; }
      }
    }
    if ((p as any).earMessage && (p as any).earMessage.byId === id) {
      (p as any).earMessage = null; touched = true;
    }
    if ((p as any).vsRecord && (p as any).vsRecord[id]) {
      delete (p as any).vsRecord[id]; touched = true;
    }
    if (Array.isArray(p.effects)) {
      const before = p.effects.length;
      p.effects = p.effects.filter((e: any) => !(e && e.hostile && e.byId === id));
      if (p.effects.length !== before) touched = true;
    }
    if (touched) { refs++; db.markUser(p.id); }
  }
  if (refs) cleaned.push(`ссылки у других игроков (${refs})`);

  // 10) И, наконец, сама учётная запись — позывной и почта снова свободны
  // Удаляем и из памяти, и из хранилища. Раньше здесь было только
  // `delete players[id]`, из-за чего в mongo документ игрока оставался
  // и возвращался после рестарта процесса.
  db.dropUser(id);
  db.save('users');

  auditLog.record({
    userId: adminUser.id, userName: adminUser.name,
    path: '/api/admin/delete-account',
    body: { deletedId: id, deletedName: name },
  });
  notices.push(`🗑 Аккаунт «${name}» удалён из игры полностью. Вход невозможен, позывной и email освобождены. Очищено: ${cleaned.join(', ') || 'нет связанных данных'}.`);
  return { deletedId: id, deletedName: name, cleaned };
}

// ── УСТАНОВКА ПАРОЛЯ ИГРОКУ ───────────────────────────────────────
// Для случаев «игрок забыл пароль, почта недоступна». Админ задаёт
// любой пароль (минимум 8 символов — единственное ограничение, чтобы
// аккаунт не остался беззащитным). Все сессии игрока завершаются, а
// висящая ссылка восстановления аннулируется.
function setPassword(adminUser: User, body: any, notices: Notices) {
  assertZone(adminUser, 'security', 'Смена пароля игроку');
  const db = require('../core/db');
  const players: Record<string, User> = require('./player').users();
  const target = players[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.isAdmin && target.id !== adminUser.id) {
    throw new u.ApiError('Нельзя менять пароль другого администратора');
  }

  const pass = String(body.password || '');
  if (pass.length < 8) throw new u.ApiError('Пароль: минимум 8 символов');

  const salt = u.uid(16);
  target.salt = salt;
  target.passHash = u.hashPassword(pass, salt);
  (target as any).resetToken = null;      // старая ссылка из письма больше не нужна
  (target as any).resetTokenExp = 0;

  // Завершаем все сессии игрока — вход только с новым паролем.
  // Формат сессий знает auth — здесь просто просим сбросить.
  let killed = 0;
  try { killed = require('./auth').killSessions(target.id); } catch (e) {}
  db.save('users');

  auditLog.record({
    userId: adminUser.id, userName: adminUser.name,
    path: '/api/admin/set-password',
    body: { targetId: target.id, targetName: target.name },  // сам пароль в журнал НЕ пишем
  });
  notices.push(`🔑 Пароль игрока «${target.name}» изменён. Активные сессии сброшены (${killed}). Передайте новый пароль игроку — сменить его он сможет в «Настройки → Аккаунт».`);
  return { userId: target.id, name: target.name, sessionsKilled: killed };
}

export = {
  listPlayers, grant, grantAll, take, claimGift,
  discountCategories, setDiscount,
  listGlobalBuffs, setGlobalBuff,
  listLogs, setBan, resetAccount, resetParam, resetMissions, wipeGroups,
  viewAsPlayer, playerSnapshot,
  deleteAccount, setPassword,
};
