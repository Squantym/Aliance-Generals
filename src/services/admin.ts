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

export = {
  listPlayers, grant, grantAll, claimGift,
  discountCategories, setDiscount,
  listGlobalBuffs, setGlobalBuff,
  listLogs,
};
