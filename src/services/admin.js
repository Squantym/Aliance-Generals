// ===================================================================
// src/services/admin.js — инструменты администратора
// Поиск игроков и выдача любых ресурсов: доллары, золото, опыт,
// очки навыков, уши, жетоны, уровень, текущие ресурсы.
// ===================================================================

const u = require('../core/utils');
const config = require('../../config/gameConfig');
const player = require('./player');
const social = require('./social');
const ach = require('./achievements');
const discounts = require('./discounts');
const auditLog = require('./auditLog');

function brief(p) {
  return {
    id: p.id, name: p.name, flag: player.flag(p), isAdmin: !!p.isAdmin,
    level: p.level, xp: p.xp,
    dollars: p.dollars, gold: p.gold, bank: p.bank,
    skillPoints: p.skillPoints, ears: p.ears, tokens: p.tokens,
    createdAt: p.createdAt, lastSeen: p.lastSeen,
  };
}

// Список/поиск игроков по части имени
function listPlayers(query) {
  const q = String(query || '').trim().toLowerCase();
  return {
    players: Object.values(player.users())
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 50)
      .map(brief),
  };
}

// Выдача ресурсов. body: { userId, dollars?, gold?, xp?, skillPoints?,
// ears?, tokens?, setLevel?, energy?, health?, ammo? }
function grant(adminUser, body, notices) {
  const target = player.users()[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');
  player.refresh(target);

  const granted = [];
  const addInt = (field) => u.toInt(body[field], 0);

  if (addInt('dollars')) { player.addMoney(target, addInt('dollars'), false); granted.push(`$${u.fmt(addInt('dollars'))}`); }
  if (addInt('gold')) { player.addGold(target, addInt('gold')); granted.push(`🪙 ${addInt('gold')}`); }
  if (addInt('skillPoints')) { target.skillPoints = Math.max(0, target.skillPoints + addInt('skillPoints')); granted.push(`${addInt('skillPoints')} оч. навыков`); }
  if (addInt('ears')) { target.ears = Math.max(0, target.ears + addInt('ears')); granted.push(`${addInt('ears')} ушей`); }
  if (addInt('tokens')) { target.tokens = Math.max(0, target.tokens + addInt('tokens')); granted.push(`${addInt('tokens')} жетонов`); }
  if (addInt('xp')) { player.addXp(target, addInt('xp'), notices); granted.push(`${u.fmt(addInt('xp'))} опыта`); }

  // Прямое выставление уровня (опыт обнуляется, ресурсы — в максимум)
  if (body.setLevel !== undefined && body.setLevel !== null && body.setLevel !== '') {
    const lvl = u.clamp(u.toInt(body.setLevel, target.level), 1, config.PLAYER.MAX_LEVEL);
    target.level = lvl;
    target.xp = 0;
    target.counters.level = lvl;
    const mx = player.maxima(target);
    target.res.hp.cur = mx.hp; target.res.en.cur = mx.en; target.res.am.cur = mx.am;
    granted.push(`уровень = ${lvl}`);
  }

  // Прямое выставление текущих ресурсов
  const mx = player.maxima(target);
  if (body.energy !== undefined && body.energy !== '') { target.res.en.cur = u.clamp(u.toInt(body.energy), 0, mx.en); granted.push('энергия'); }
  if (body.health !== undefined && body.health !== '') { target.res.hp.cur = u.clamp(u.toInt(body.health), 0, mx.hp); granted.push('здоровье'); }
  if (body.ammo !== undefined && body.ammo !== '') { target.res.am.cur = u.clamp(u.toInt(body.ammo), 0, mx.am); granted.push('боеприпасы'); }

  if (!granted.length) throw new u.ApiError('Не указано, что выдавать');

  ach.check(target, []);
  social.systemMail(target, 'Подарок администрации',
    `Администратор ${adminUser.name} выдал вам: ${granted.join(', ')}.`);
  notices.push(`Выдано игроку ${target.name}: ${granted.join(', ')}`);
  return { player: brief(target) };
}

// ---------- Скидки ----------
// Перечень категорий для UI админки
function discountCategories() {
  return { categories: discounts.categories(), active: discounts.getActive() };
}

// Установить скидку (или снять, если pct=0). body: { category, pct, hours }
function setDiscount(adminUser, body, notices) {
  const cat = String(body.category || '');
  const pct = u.toInt(body.pct, 0);
  const hours = Math.max(0, Number(body.hours) || 0);
  discounts.set(cat, pct, hours);
  if (pct > 0 && hours > 0) {
    notices.push(`🏷 Скидка «${discounts.CATEGORIES[cat] || cat}»: ${pct}% на ${hours} ч.`);
  } else {
    notices.push(`Скидка «${discounts.CATEGORIES[cat] || cat}» снята.`);
  }
  return discountCategories();
}

// ---------- Журнал действий ----------
// query: { userId?, limit? }. Без userId — последние действия всех игроков.
function listLogs(query) {
  const limit = Math.min(500, Math.max(1, u.toInt(query.limit, 200)));
  const entries = query.userId
    ? auditLog.listForUser(String(query.userId), limit)
    : auditLog.listAll(limit);
  return { logs: entries };
}

module.exports = { listPlayers, grant, discountCategories, setDiscount, listLogs };
