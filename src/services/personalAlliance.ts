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
// Сколько живёт приглашение. Раньше заявка висела в инбоксе вечно:
// игрок мог принять зов месячной давности от человека, который давно
// про него забыл, — и оба получали союзника, о котором не договаривались.
const INVITE_TTL_MS = HOUR_MS;

function users(): Record<string, User> { return require('./player').users(); }

// Живые приглашения: старше часа не существуют. Фильтр применяется при
// КАЖДОМ чтении, а не только в уборке, — иначе между уборками игрок
// увидел бы просроченное и получил отказ уже после нажатия.
function fresh(list: any[]): any[] {
  const now = Date.now();
  return (Array.isArray(list) ? list : []).filter((x: any) => now - Number(x.at || 0) < INVITE_TTL_MS);
}

// Уборка инбоксов — зовётся мировым тиком. Без неё просроченные заявки
// копились бы в коллекции навсегда: показывать их перестали, а лежать
// они продолжают.
function sweepInvites(): number {
  const inv = db.load<Record<string, any[]>>('alliance_invites', {});
  let dropped = 0;
  for (const id of Object.keys(inv)) {
    const before = (inv[id] || []).length;
    const left = fresh(inv[id]);
    dropped += before - left.length;
    if (left.length) inv[id] = left; else delete inv[id];
  }
  if (dropped) db.save('alliance_invites');
  return dropped;
}

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
// Состоят ли игроки во ВЗАИМНОМ личном альянсе (каждый есть в ростере другого).
// Используется для значка союзника в «Войне» и для отправки подкреплений.
function areAllies(a: any, b: any): boolean {
  if (!a || !b || a.id === b.id) return false;
  const inA = (a.allianceRoster || []).some((m: any) => m && m.id === b.id);
  const inB = (b.allianceRoster || []).some((m: any) => m && m.id === a.id);
  return inA && inB;
}

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
    inviteTtlMin: Math.round(INVITE_TTL_MS / 60000),
  };
}

// ── Купить дипломата (+1 к лимиту заявок в час) ──────────────────
function buyDiplomat(user: User, notices: Notices) {
  ensure(user);
  const cost = nextDiplomatCost(user);
  if (user.gold < cost) {
    throw new u.ApiError(`Дипломат стоит 🪙 ${cost} (каждый следующий вдвое дороже).`);
  }
  require('./player').spendGold(user, cost, 'alliance');
  user.allianceDiplomats = (user.allianceDiplomats || 0) + 1;
  db.save('users');
  notices.push(`🎩 Дипломат нанят! Лимит заявок: ${inviteLimit(user)}/час. Всего дипломатов: ${user.allianceDiplomats}.`);
  return view(user);
}

// ── Пригласить реального игрока (по позывному) ───────────────────
function invitePlayer(user: User, targetName: string, notices: Notices, targetId?: string) {
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
  // Цель: по id (кнопка в профиле) или по позывному (вкладка альянса)
  const id = String(targetId || '').trim();
  const q = String(targetName || '').trim().toLowerCase();
  if (!id && !q) throw new u.ApiError('Введите позывной игрока');
  const target = id ? users()[id] : Object.values(users()).find((p) => p.name.toLowerCase() === q);
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.id === user.id) throw new u.ApiError('Нельзя пригласить самого себя');
  // Ботов в альянс больше не зовут — ни кнопкой, ни по имени. Альянс
  // существует ради живых союзников: подкрепления, совместные бои и
  // прочее с ботом не работают, а вместимость армии он поднимал.
  if (target.isBot) throw new u.ApiError('В альянс приглашают только живых игроков');
  if ((user.allianceRoster || []).some((m: any) => m.id === target.id)) {
    throw new u.ApiError('Этот игрок уже в вашем альянсе');
  }

  // Кладём заявку в инбокс цели. Просроченные сразу отбрасываем: иначе
  // «вы уже приглашали» срабатывало бы на заявку, которой давно нет.
  const inv = db.load<Record<string, any[]>>('alliance_invites', {});
  inv[target.id] = fresh(inv[target.id]);
  if (inv[target.id].some((x: any) => x.fromId === user.id)) {
    throw new u.ApiError('Вы уже приглашали этого игрока — заявка ещё висит');
  }
  if (!unlimited) logInvite(user); // с наёмником заявки не расходуются
  inv[target.id].push({ fromId: user.id, fromName: user.name, at: Date.now() });
  db.save('alliance_invites');
  db.save('users');
  try {
    require('./notifications').push(target.id, 'alliance_invite',
      `🤝 ${user.name} приглашает вас в свой альянс`, { fromId: user.id, fromName: user.name });
  } catch (e) {}
  notices.push(`✉️ Приглашение отправлено игроку «${target.name}» — оно ждёт ответа час. ` +
    `Заявок осталось: ${unlimited ? 'без лимита (наёмник-дипломат)' : `${limit - used - 1}/час`}.`);
  return { ok: true };
}

// ── Список приглашений, пришедших игроку ──────────────────────────
function myInvites(user: User) {
  const inv = db.load<Record<string, any[]>>('alliance_invites', {});
  const list = fresh(inv[user.id]);
  inv[user.id] = list;
  // Игрок должен видеть, сколько осталось: заявка живёт час, и «успею
  // потом» здесь не работает.
  return {
    invites: list.map((x: any) => Object.assign({}, x, {
      expiresInSec: Math.max(0, Math.ceil((Number(x.at || 0) + INVITE_TTL_MS - Date.now()) / 1000)),
    })),
    ttlMin: Math.round(INVITE_TTL_MS / 60000),
  };
}

// ── Принять приглашение: +1 себе И +1 пригласившему ──────────────
// Каждый растит СВОЙ счётчик независимо.
function acceptInvite(user: User, fromId: string, notices: Notices) {
  ensure(user);
  const inv = db.load<Record<string, any[]>>('alliance_invites', {});
  const all = inv[user.id] || [];
  const list = fresh(all);
  inv[user.id] = list;
  const idx = list.findIndex((x: any) => x.fromId === fromId);
  if (idx === -1) {
    // Разделяем «не было» и «истекло»: игрок должен понимать, что
    // произошло, а не гадать, почему кнопка не сработала.
    const wasExpired = all.some((x: any) => x.fromId === fromId);
    throw new u.ApiError(wasExpired
      ? 'Приглашение просрочено — оно действовало час'
      : 'Приглашение не найдено');
  }

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
    // Разорвали союз — отзываем подкрепления в обе стороны. Иначе можно
    // было выйти, вернуться и отправить второе тому же игроку, а первое
    // продолжало действовать: подкреплений накапливалось сколько угодно.
    let revoked = 0;
    try { revoked = require('./reinforcements').revokeAllFor(user.id, [memberId]); } catch (e) {}
    db.save('users');
    notices.push(revoked
      ? `Участник исключён. Подкреплений отозвано: ${revoked}.`
      : 'Участник исключён из вашего альянса.');
  }
  return view(user);
}

export = {
  areAllies, sweepInvites, INVITE_TTL_MS,
  ensure, maxMembers, view, buyDiplomat, invitePlayer,
  myInvites, acceptInvite, declineInvite, removeMember,
};
