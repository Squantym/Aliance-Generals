// ═══════════════════════════════════════════════════════════════════
// ПОДКРЕПЛЕНИЯ СОЮЗНИКАМ
// Отправить подкрепление можно ТОЛЬКО игроку, с которым вы состоите во
// взаимном личном альянсе (он у вас в ростере и вы у него).
//
// Правила (config.REINFORCE):
//   • у получателя одновременно максимум MAX_ACTIVE подкреплений,
//     и все — от РАЗНЫХ игроков (по одному от каждого);
//   • отправитель может послать не более PER_DAY подкреплений в сутки,
//     и не более одного в сутки одному и тому же игроку;
//   • подкрепление живёт LIFETIME_H часов, затем истекает.
//
// Эффект: +BONUS_PCT% к мощи армии за каждое активное подкрепление.
// Трофей «Знамя победы» (banner) усиливает бонус на perLvl% за уровень.
// ═══════════════════════════════════════════════════════════════════
import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import pa = require('./personalAlliance');
import notifications = require('./notifications');
import type { User, Notices } from '../types';

const R = config.REINFORCE;

function users(): Record<string, User> { return player.users(); }

// Чистка истёкших подкреплений у игрока
function prune(user: any): any[] {
  if (!Array.isArray(user.reinforcements)) user.reinforcements = [];
  const now = Date.now();
  const before = user.reinforcements.length;
  user.reinforcements = user.reinforcements.filter((r: any) => r && r.expiresAt > now);
  if (user.reinforcements.length !== before) db.markUser(user.id);
  return user.reinforcements;
}

// Сколько подкреплений отправлено за последние сутки (и кому)
function sentToday(user: any): any[] {
  if (!Array.isArray(user.reinforceSent)) user.reinforceSent = [];
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  user.reinforceSent = user.reinforceSent.filter((x: any) => x && x.at > dayAgo);
  return user.reinforceSent;
}

// Бонус к мощи от активных подкреплений (в процентах)
function bonusPct(user: any): number {
  const active = prune(user).length;
  if (!active) return 0;
  let per = R.BONUS_PCT;
  // Трофей «Знамя победы» усиливает каждое подкрепление
  try {
    const trophies = require('./trophies');
    const lvl = trophies.levelOf ? trophies.levelOf(user, 'banner') : 0;
    const def = (config.TROPHIES || []).find((t: any) => t.id === 'banner');
    if (lvl && def) per += lvl * def.perLvl;
  } catch (e) { /* трофеев нет — базовый бонус */ }
  return Math.round(active * per * 10) / 10;
}

// Множитель для расчёта мощи армии (1.0 = без бонуса)
function powerMul(user: any): number {
  return 1 + bonusPct(user) / 100;
}

// ── Экран подкреплений ────────────────────────────────────────────
function view(user: User) {
  const active = prune(user);
  const sent = sentToday(user);
  const all = users();

  // Союзники, которым можно отправить прямо сейчас
  const roster = ((user as any).allianceRoster || []).filter((m: any) => m && !m.isBot);
  const allies = roster.map((m: any) => {
    const ally = all[m.id];
    if (!ally) return null;
    const mutual = pa.areAllies(user, ally);
    const alreadyToday = sent.some((x: any) => x.toId === m.id);
    const theirActive = prune(ally);
    const theirSlots = theirActive.length >= R.MAX_ACTIVE;
    const alreadyMine = theirActive.some((r: any) => r.fromId === user.id);
    let reason = '';
    if (!mutual) reason = 'не во взаимном альянсе';
    else if (alreadyMine) reason = 'ваше подкрепление уже действует';
    else if (alreadyToday) reason = 'уже отправляли сегодня';
    else if (theirSlots) reason = 'у него все слоты заняты';
    else if (sent.length >= R.PER_DAY) reason = 'ваш дневной лимит исчерпан';
    return {
      id: ally.id, name: ally.name, level: ally.level, flag: player.flag(ally),
      canSend: !reason, reason,
      theirActive: theirActive.length, theirMax: R.MAX_ACTIVE,
    };
  }).filter(Boolean);

  return {
    maxActive: R.MAX_ACTIVE,
    perDay: R.PER_DAY,
    lifetimeH: R.LIFETIME_H,
    bonusPctEach: R.BONUS_PCT,
    // Мои активные подкрепления (кто прислал)
    active: active.map((r: any) => ({
      fromId: r.fromId, fromName: r.fromName,
      expiresInMin: Math.max(0, Math.round((r.expiresAt - Date.now()) / 60000)),
    })),
    activeCount: active.length,
    totalBonusPct: bonusPct(user),
    sentToday: sent.length,
    sentLeft: Math.max(0, R.PER_DAY - sent.length),
    allies,
  };
}

// ── Отправка подкрепления ─────────────────────────────────────────
function send(user: User, toId: string, notices: Notices) {
  const target = users()[toId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.id === user.id) throw new u.ApiError('Нельзя отправить подкрепление самому себе');

  // Только взаимные союзники по личному альянсу
  if (!pa.areAllies(user, target)) {
    throw new u.ApiError('Подкрепления можно отправлять только союзникам из вашего альянса (взаимно)');
  }

  const sent = sentToday(user);
  if (sent.length >= R.PER_DAY) {
    throw new u.ApiError(`Лимит: ${R.PER_DAY} подкреплений в сутки. Попробуйте завтра.`);
  }
  if (sent.some((x: any) => x.toId === toId)) {
    throw new u.ApiError('Этому союзнику вы уже отправляли подкрепление сегодня');
  }

  const theirs = prune(target);
  if (theirs.length >= R.MAX_ACTIVE) {
    throw new u.ApiError(`У «${target.name}» уже максимум подкреплений (${R.MAX_ACTIVE})`);
  }
  if (theirs.some((r: any) => r.fromId === user.id)) {
    throw new u.ApiError('Ваше подкрепление уже действует у этого союзника');
  }

  const expiresAt = Date.now() + R.LIFETIME_H * 3600 * 1000;
  (target as any).reinforcements.push({
    fromId: user.id, fromName: user.name, at: Date.now(), expiresAt,
  });
  (user as any).reinforceSent.push({ toId, toName: target.name, at: Date.now() });
  db.markUser(target.id);
  db.markUser(user.id);

  try {
    notifications.push(target.id, 'reinforcement',
      `🎖 ${user.name} прислал вам подкрепление`,
      { fromId: user.id, fromName: user.name, hours: R.LIFETIME_H, bonusPct: bonusPct(target) });
  } catch (e) {}

  notices.push(`🎖 Подкрепление отправлено союзнику «${target.name}» на ${R.LIFETIME_H} ч. ` +
    `Осталось отправок сегодня: ${Math.max(0, R.PER_DAY - sentToday(user).length)}.`);
  return view(user);
}

export = { view, send, prune, bonusPct, powerMul };
