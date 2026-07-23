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
const INVITE_BASE_PER_HOUR = 5;      // базовый лимит заявок в час
const DIPLOMAT_BASE_COST = 200;      // первый дипломат — 200 золота
const HOUR_MS = 3600 * 1000;

function users(): Record<string, User> { return require('./player').users(); }

// Гарантируем поля личного альянса
function ensure(user: User): void {
  if (typeof user.allianceMembers !== 'number') user.allianceMembers = 0;
  if (!Array.isArray(user.allianceRoster)) user.allianceRoster = [];
  if (typeof user.allianceDiplomats !== 'number') user.allianceDiplomats = 0;
  if (!Array.isArray(user.allianceInviteLog)) user.allianceInviteLog = [];
}

// Лимит размера альянса = уровень × MEMBERS_PER_LEVEL
function maxMembers(user: User): number {
  return user.level * (A.MEMBERS_PER_LEVEL || 10);
}

// Лимит заявок в час = база + число дипломатов
function inviteLimit(user: User): number {
  return INVITE_BASE_PER_HOUR + (user.allianceDiplomats || 0);
}

// Наёмник «Дипломат» (эффект invite_unlimited, напр. Эйден Роу) снимает
// почасовой лимит заявок на время действия. Работает и на приём ботов,
// и на приглашение живых игроков — в обход лимита от числа дипломатов.
function hasUnlimitedInvite(user: User): boolean {
  return (user.effects || []).some(
    (e: any) => e.type === 'invite_unlimited' && e.expiresAt > Date.now()
  );
}

// Сколько заявок отправлено за последний час (чистит старые записи)
function invitesUsedThisHour(user: User): number {
  ensure(user);
  const now = Date.now();
  user.allianceInviteLog = user.allianceInviteLog!.filter((t) => now - t < HOUR_MS);
  return user.allianceInviteLog!.length;
}

// Цена следующего дипломата: 200, 400, 800… (вдвое за каждого купленного)
function nextDiplomatCost(user: User): number {
  return DIPLOMAT_BASE_COST * Math.pow(2, user.allianceDiplomats || 0);
}

// Записать использование одной заявки
function logInvite(user: User): void {
  ensure(user);
  user.allianceInviteLog!.push(Date.now());
}

// ── Вид экрана альянса ────────────────────────────────────────────
function view(user: User) {
  ensure(user);
  const used = invitesUsedThisHour(user);
  const limit = inviteLimit(user);
  // Наёмник-дипломат (Эйден Роу) снимает почасовой лимит заявок.
  // Клиенту это нужно, чтобы НЕ гасить кнопку приглашения при 0 заявок.
  const unlimited = hasUnlimitedInvite(user);
  const mercEff = (user.effects || []).find(
    (e: any) => e.type === 'invite_unlimited' && e.expiresAt > Date.now()
  );
  return {
    members: user.allianceMembers,
    maxMembers: maxMembers(user),
    roster: user.allianceRoster,
    diplomats: user.allianceDiplomats,
    perMember: A.PER_MEMBER,
    bonusCapacity: A.PER_MEMBER * (user.allianceMembers || 0),
    // Заявки в час
    inviteLimit: limit,
    invitesUsed: used,
    invitesLeft: Math.max(0, limit - used),
    unlimitedInvite: unlimited,                        // безлимит активен?
    unlimitedName: mercEff ? (mercEff as any).name : null,
    unlimitedUntil: mercEff ? mercEff.expiresAt : null,
    nextDiplomatCost: nextDiplomatCost(user),
  };
}

// ── Пригласить бота в альянс (расходует заявку в час, без золота) ──
function inviteBot(user: User, notices: Notices) {
  ensure(user);
  if (user.allianceMembers! >= maxMembers(user)) {
    throw new u.ApiError(`Лимит альянса: ${maxMembers(user)} (растёт с уровнем). Поднимите уровень.`);
  }
  const used = invitesUsedThisHour(user);
  const limit = inviteLimit(user);
  const unlimited = hasUnlimitedInvite(user);
  if (!unlimited && used >= limit) {
    throw new u.ApiError(`Лимит заявок исчерпан (${limit}/час). Купите дипломата, чтобы поднять лимит.`);
  }
  // При активном наёмнике заявка НЕ расходуется: иначе после окончания его
  // действия игрок мгновенно упрётся в «лимит исчерпан» из-за накопленного лога.
  if (!unlimited) logInvite(user);
  user.allianceMembers!++;
  const botNames = ['Ветеран', 'Снайпер', 'Сапёр', 'Радист', 'Танкист', 'Десантник', 'Пулемётчик', 'Разведчик', 'Гранатомётчик', 'Медик'];
  const name = u.pick(botNames) + ' #' + Math.floor(Math.random() * 900 + 100);
  user.allianceRoster!.push({ id: 'bot_' + u.uid(8), name, isBot: true });
  db.save('users');
  try { require('./seasons').onAllianceRecruit(user); } catch (e) {}
  const leftMsg = unlimited ? 'без лимита (наёмник-дипломат)' : `${limit - used - 1}/час`;
  notices.push(`🤝 Боец «${name}» вступил в ваш альянс! В строю: ${user.allianceMembers}. Заявок осталось: ${leftMsg}.`);
  return view(user);
}

// ── Купить дипломата (+1 к лимиту заявок в час) ──────────────────
function buyDiplomat(user: User, notices: Notices) {
  ensure(user);
  const cost = nextDiplomatCost(user);
  if (user.gold < cost) {
    throw new u.ApiError(`Дипломат стоит 🪙 ${cost} (каждый следующий вдвое дороже).`);
  }
  user.gold -= cost;
  user.allianceDiplomats = (user.allianceDiplomats || 0) + 1;
  db.save('users');
  notices.push(`🎩 Дипломат нанят! Лимит заявок: ${inviteLimit(user)}/час. Всего дипломатов: ${user.allianceDiplomats}.`);
  return view(user);
}

// ── Пригласить реального игрока (по позывному) ───────────────────
function invitePlayer(user: User, targetName: string, notices: Notices) {
  ensure(user);
  if (user.allianceMembers! >= maxMembers(user)) {
    throw new u.ApiError(`Лимит альянса: ${maxMembers(user)}. Поднимите уровень.`);
  }
  const used = invitesUsedThisHour(user);
  const limit = inviteLimit(user);
  const unlimited = hasUnlimitedInvite(user);
  if (!unlimited && used >= limit) {
    throw new u.ApiError(`Лимит заявок исчерпан (${limit}/час). Купите дипломата, чтобы поднять лимит.`);
  }
  const q = String(targetName || '').trim().toLowerCase();
  if (!q) throw new u.ApiError('Введите позывной игрока');
  const target = Object.values(users()).find((p) => p.name.toLowerCase() === q);
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.id === user.id) throw new u.ApiError('Нельзя пригласить самого себя');
  if (target.isBot) throw new u.ApiError('Это бот — приглашайте бойцов отдельной кнопкой');

  // Кладём заявку в инбокс цели
  const inv = db.load<Record<string, any[]>>('alliance_invites', {});
  if (!inv[target.id]) inv[target.id] = [];
  if (inv[target.id].some((x: any) => x.fromId === user.id)) {
    throw new u.ApiError('Вы уже приглашали этого игрока');
  }
  if (!unlimited) logInvite(user); // с наёмником заявки не расходуются
  inv[target.id].push({ fromId: user.id, fromName: user.name, at: Date.now() });
  db.save('alliance_invites');
  db.save('users');
  try {
    require('./notifications').push(target.id, 'alliance_invite',
      `🤝 ${user.name} приглашает вас в свой альянс`, { fromId: user.id, fromName: user.name });
  } catch (e) {}
  notices.push(`✉️ Приглашение отправлено игроку «${target.name}». Заявок осталось: ${unlimited ? 'без лимита (наёмник-дипломат)' : `${limit - used - 1}/час`}.`);
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
    try { require('./seasons').onAllianceRecruit(user); } catch (e) {}
  }
  if (inviter.allianceMembers! < maxMembers(inviter)) {
    inviter.allianceMembers!++;
    inviter.allianceRoster!.push({ id: user.id, name: user.name });
    try { require('./seasons').onAllianceRecruit(inviter); } catch (e) {}
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
  ensure, maxMembers, view, inviteBot, buyDiplomat, invitePlayer,
  myInvites, acceptInvite, declineInvite, removeMember,
};
