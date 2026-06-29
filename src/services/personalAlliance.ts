// ===================================================================
// src/services/personalAlliance.ts — ЛИЧНЫЙ альянс игрока.
// У каждого игрока СВОЙ альянс с собственным счётчиком участников.
// Значения не общие: если игрок А (100 чел) приглашает игрока Б (200 чел),
// каждому прибавляется по 1 — у А станет 101, у Б 201.
// Размер альянса даёт бонус к лимиту техники в бою (capacity).
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import config = require('../../config/gameConfig');
import type { User, Notices } from '../types';

const A = config.ALLIANCE;
const INVITE_COST_GOLD = 50;     // приглашение бота-наёмника стоит золота
const DIPLOMAT_BASE = 5;

function users(): Record<string, User> { return require('./player').users(); }

// Гарантируем поля личного альянса
function ensure(user: User): void {
  if (typeof user.allianceMembers !== 'number') user.allianceMembers = 0;
  if (!Array.isArray(user.allianceRoster)) user.allianceRoster = [];
  if (typeof user.allianceDiplomats !== 'number') user.allianceDiplomats = 0;
}

// Лимит размера альянса = уровень × MEMBERS_PER_LEVEL
function maxMembers(user: User): number {
  return user.level * (A.MEMBERS_PER_LEVEL || 10);
}

// ── Вид экрана альянса ────────────────────────────────────────────
function view(user: User) {
  ensure(user);
  return {
    members: user.allianceMembers,
    maxMembers: maxMembers(user),
    roster: user.allianceRoster,
    diplomats: user.allianceDiplomats,
    perMember: A.PER_MEMBER,
    bonusCapacity: A.PER_MEMBER * (user.allianceMembers || 0),
    inviteCostGold: INVITE_COST_GOLD,
  };
}

// ── Пригласить бота-наёмника (мгновенно +1) ──────────────────────
function recruitBot(user: User, notices: Notices) {
  ensure(user);
  if (user.allianceMembers! >= maxMembers(user)) {
    throw new u.ApiError(`Лимит альянса: ${maxMembers(user)} (растёт с уровнем). Поднимите уровень.`);
  }
  if (user.gold < INVITE_COST_GOLD) {
    throw new u.ApiError(`Вербовка наёмника стоит 🪙 ${INVITE_COST_GOLD}`);
  }
  user.gold -= INVITE_COST_GOLD;
  user.allianceMembers!++;
  const botNames = ['Ветеран', 'Снайпер', 'Сапёр', 'Радист', 'Танкист', 'Десантник', 'Пулемётчик', 'Разведчик', 'Гранатомётчик', 'Медик'];
  const name = u.pick(botNames) + ' #' + Math.floor(Math.random() * 900 + 100);
  user.allianceRoster!.push({ id: 'bot_' + u.uid(8), name, isBot: true });
  db.save('users');
  notices.push(`🤝 Наёмник «${name}» завербован в ваш альянс! Теперь в строю: ${user.allianceMembers}.`);
  return view(user);
}

// ── Пригласить реального игрока (по позывному) ───────────────────
function invitePlayer(user: User, targetName: string, notices: Notices) {
  ensure(user);
  if (user.allianceMembers! >= maxMembers(user)) {
    throw new u.ApiError(`Лимит альянса: ${maxMembers(user)}. Поднимите уровень.`);
  }
  const q = String(targetName || '').trim().toLowerCase();
  if (!q) throw new u.ApiError('Введите позывной игрока');
  const target = Object.values(users()).find((p) => p.name.toLowerCase() === q);
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.id === user.id) throw new u.ApiError('Нельзя пригласить самого себя');
  if (target.isBot) throw new u.ApiError('Это бот — вербуйте наёмников отдельной кнопкой');

  // Кладём заявку в инбокс цели
  const inv = db.load<Record<string, any[]>>('alliance_invites', {});
  if (!inv[target.id]) inv[target.id] = [];
  if (inv[target.id].some((x: any) => x.fromId === user.id)) {
    throw new u.ApiError('Вы уже приглашали этого игрока');
  }
  inv[target.id].push({ fromId: user.id, fromName: user.name, at: Date.now() });
  db.save('alliance_invites');
  try {
    require('./notifications').push(target.id, 'alliance_invite',
      `🤝 ${user.name} приглашает вас в свой альянс`, { fromId: user.id, fromName: user.name });
  } catch (e) {}
  notices.push(`✉️ Приглашение отправлено игроку «${target.name}».`);
  return { ok: true };
}

// ── Список приглашений, пришедших игроку ──────────────────────────
function myInvites(user: User) {
  const inv = db.load<Record<string, any[]>>('alliance_invites', {});
  return { invites: inv[user.id] || [] };
}

// ── Принять приглашение: +1 себе И +1 пригласившему ──────────────
// Каждый растит СВОЙ счётчик независимо.
function acceptInvite(user: User, fromId: string, notices: Notices) {
  ensure(user);
  const inv = db.load<Record<string, any[]>>('alliance_invites', {});
  const list = inv[user.id] || [];
  const idx = list.findIndex((x: any) => x.fromId === fromId);
  if (idx === -1) throw new u.ApiError('Приглашение не найдено');

  const inviter = users()[fromId];
  if (!inviter) throw new u.ApiError('Пригласивший игрок не найден');
  ensure(inviter);

  // Каждому +1 (друг друга добавляют в ростер), лимиты независимы
  if (user.allianceMembers! < maxMembers(user)) {
    user.allianceMembers!++;
    user.allianceRoster!.push({ id: inviter.id, name: inviter.name });
  }
  if (inviter.allianceMembers! < maxMembers(inviter)) {
    inviter.allianceMembers!++;
    inviter.allianceRoster!.push({ id: user.id, name: user.name });
  }

  list.splice(idx, 1);
  inv[user.id] = list;
  db.save('alliance_invites');
  db.save('users');
  try {
    require('./notifications').push(inviter.id, 'alliance_joined',
      `🤝 ${user.name} принял ваше приглашение в альянс!`, { id: user.id, name: user.name });
  } catch (e) {}
  notices.push(`🤝 Вы и «${inviter.name}» теперь союзники! В вашем альянсе: ${user.allianceMembers}.`);
  return view(user);
}

// ── Отклонить приглашение ─────────────────────────────────────────
function declineInvite(user: User, fromId: string, notices: Notices) {
  const inv = db.load<Record<string, any[]>>('alliance_invites', {});
  const list = inv[user.id] || [];
  inv[user.id] = list.filter((x: any) => x.fromId !== fromId);
  db.save('alliance_invites');
  notices.push('Приглашение отклонено.');
  return { ok: true };
}

// ── Исключить участника из своего альянса ─────────────────────────
function removeMember(user: User, memberId: string, notices: Notices) {
  ensure(user);
  const before = user.allianceRoster!.length;
  user.allianceRoster = user.allianceRoster!.filter((m) => m.id !== memberId);
  if (user.allianceRoster.length < before) {
    user.allianceMembers = Math.max(0, user.allianceMembers! - 1);
    db.save('users');
    notices.push('Участник исключён из вашего альянса.');
  }
  return view(user);
}

export = {
  ensure, maxMembers, view, recruitBot, invitePlayer,
  myInvites, acceptInvite, declineInvite, removeMember,
};
