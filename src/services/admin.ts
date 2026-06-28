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

// ──────────────────────────────────────────────────────────────────
// Применить набор ресурсов к одному игроку
// Возвращает строку что выдали (для лога)
// ──────────────────────────────────────────────────────────────────
function applyGrant(target: User, body: any): string[] {
  player.refresh(target);
  const granted: string[] = [];
  const addInt = (field) => u.toInt(body[field], 0);

  if (addInt('dollars'))    { player.addMoney(target, addInt('dollars'), false);             granted.push(`$${u.fmt(addInt('dollars'))}`); }
  if (addInt('gold'))       { player.addGold(target, addInt('gold'));                        granted.push(`🪙 ${addInt('gold')}`); }
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
function grant(adminUser: User, body: any, notices: Notices) {
  const target = player.users()[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');

  const granted = applyGrant(target, body);
  if (!granted.length) throw new u.ApiError('Не указано, что выдавать');

  const customNote = String(body.giftNote || '').trim().slice(0, 300);
  pushGiftPopup(target, granted, customNote || undefined);

  const mailText = customNote
    ? customNote
    : `Администратор ${adminUser.name} выдал вам: ${granted.join(', ')}.`;
  social.systemMail(target, customNote ? '🎁 Подарок от администрации' : '📦 Подарок администрации', mailText);

  notices.push(`✅ Выдано игроку ${target.name}: ${granted.join(', ')}`);
  return { player: brief(target) };
}

// ──────────────────────────────────────────────────────────────────
// Выдача ВСЕМ игрокам сразу
// ──────────────────────────────────────────────────────────────────
function grantAll(adminUser: User, body: any, notices: Notices) {
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
      social.systemMail(target, '🎁 Подарок всем игрокам', mailText);
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
function listLogs(query: any) {
  const limit = Math.min(1000, Math.max(1, u.toInt(query.limit, 200)));
  const entries = query.userId
    ? auditLog.listForUser(String(query.userId), limit)
    : auditLog.listAll(limit);
  return { logs: entries };
}

// ── Бан / разбан игрока ───────────────────────────────────────────
function setBan(adminUser: User, body: any, notices: Notices) {
  const players: Record<string, User> = require('./player').users();
  const target = players[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.isAdmin) throw new u.ApiError('Нельзя забанить администратора');

  const ban = !!body.banned;
  target.banned = ban;
  if (ban) {
    target.banReason = String(body.reason || 'Нарушение правил').slice(0, 200);
    target.bannedAt = Date.now();
    // Завершаем все сессии забаненного игрока
    try {
      const sessions = require('../core/db').load('sessions', {});
      for (const [tok, uid] of Object.entries(sessions)) {
        if (uid === target.id) delete (sessions as any)[tok];
      }
      require('../core/db').save('sessions');
    } catch (e) {}
  } else {
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
function resetAccount(adminUser: User, body: any, notices: Notices) {
  const players: Record<string, User> = require('./player').users();
  const target = players[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.isAdmin && target.id !== adminUser.id) {
    throw new u.ApiError('Нельзя обнулить аккаунт другого администратора');
  }
  const now = Date.now();

  // Сбрасываем игровой прогресс к стартовым значениям
  target.level = 1; target.xp = 0;
  target.dollars = config.PLAYER.START_DOLLARS;
  target.gold = config.PLAYER.START_GOLD;
  target.bank = 0;
  target.skillPoints = 0;
  target.skills = { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 };
  target.res = {
    hp: { cur: config.PLAYER.BASE_HP, t: now },
    en: { cur: config.PLAYER.BASE_ENERGY, t: now },
    am: { cur: config.PLAYER.BASE_AMMO, t: now },
  };
  target.units = {}; target.workshops = 0; (target as any).modernQueue = [];
  target.buildings = {};
  target.secretDevs = {}; target.superSecret = 0;
  target.ears = 0; target.tokens = 0; target.earsLost = 0;
  target.earsCurrent = config.EARS.MAX; target.earsLostAt = []; target.earPenaltyUntil = 0;
  target.earCutters = [null, null]; target.earMessage = null;
  target.battle = { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 };
  (target as any).counters = { wins: 0, attacks: 0, fatalities: 0, unitsBought: 0, buildingsBuilt: 0, missionStages: 0, earsCut: 0, moneyEarned: 0, battleLoot: 0, level: 1 };
  (target as any).achStages = {};
  target.missions = {};
  (target as any).tutorial = { step: 0, done: false };
  target.effects = [];
  target.trophies = Object.fromEntries(config.TROPHIES.map((t: any) => [t.id, 0]));
  target.club = {};
  target.allianceId = null;
  target.legionId = null;
  (target as any).lastIncomeAt = now;
  target.pendingFatality = null;
  (target as any).lastHospitalHeal = 0;
  (target as any).lastAttackAt = 0;

  require('../core/db').save('users');
  // Уведомляем игрока
  try {
    require('./notifications').push(target.id, 'account_reset',
      '⚠️ Ваш аккаунт был обнулён администрацией. Вы начинаете игру заново.', {});
  } catch (e) {}
  notices.push(`♻️ Аккаунт «${target.name}» полностью обнулён — игрок начинает заново.`);
  return { userId: target.id };
}

export = {
  listPlayers, grant, grantAll, claimGift,
  discountCategories, setDiscount,
  listGlobalBuffs, setGlobalBuff,
  listLogs, setBan, resetAccount,
};
