// ===================================================================
// src/services/groups.ts — обобщённая логика групп (альянс и легион)
// Альянс и легион работают одинаково: лидер, заявки, исключение,
// передача лидерства. Различаются только цена, минимальный уровень
// и поле в пользователе (allianceId / legionId).
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import config = require('../../config/gameConfig');
import social = require('./social');
import discounts = require('./discounts');
import type { User, Notices } from '../types';

// kind: 'alliance' | 'legion'
// Каждой группе свой коллекшен и своё поле у пользователя
const KINDS: Record<string, any> = {
  alliance: {
    coll: 'alliances',
    userField: 'allianceId',
    label: 'Альянс',
    discountCategory: 'alliance',
  },
  legion: {
    coll: 'legions',
    userField: 'legionId',
    label: 'Легион',
    discountCategory: 'legion',
  },
};

function defOf(kind: string): any { const d = KINDS[kind]; if (!d) throw new u.ApiError('Неизвестный тип группы'); return d; }
function paramsOf(kind: string): any {
  const c = require('../../config/gameConfig');
  return kind === 'legion' ? c.LEGION : c.ALLIANCE;
}
function coll(kind: string): Record<string, any> { return db.load(defOf(kind).coll, {}); }

function memberBrief(id: string, g: any): any {
  if (String(id).startsWith('bot_')) {
    // Боты эфемерны — используем сохранённый снимок данных, иначе
    // показываем заглушку (на случай совсем старых данных без снимка)
    const snap = g && g.botSnapshots && g.botSnapshots[id];
    return snap || { id, name: 'Боец альянса', flag: '🏳', level: 1, rating: 0 };
  }
  const p = player.users()[id];
  return p ? { id: p.id, name: p.name, flag: player.flag(p), level: p.level, rating: player.rating(p) } : null;
}

// Текущая стоимость создания с учётом активной скидки администратора
function createCost(kind: string): number {
  const params = paramsOf(kind);
  const def = defOf(kind);
  return discounts.applyTo(def.discountCategory, params.CREATE_COST);
}

// Общий «вид» одной группы для UI
function view(user: User, kind: string): any {
  const def = defOf(kind);
  const params = paramsOf(kind);
  const all = coll(kind);
  const groupId = user[def.userField] || null;
  const g = groupId ? all[groupId] : null;

  // В какую группу игрок уже подал заявку (если подал)
  let pendingFor: { id: string; name: string } | null = null;
  for (const x of Object.values(all) as any[]) {
    if (x.requests.includes(user.id)) { pendingFor = { id: x.id, name: x.name }; break; }
  }

  return {
    kind,
    mine: g ? {
      id: g.id, name: g.name,
      leaderId: g.leaderId, isLeader: g.leaderId === user.id,
      members: g.members.map((id) => memberBrief(id, g)).filter(Boolean).sort((x, y) => y.rating - x.rating),
      requests: g.leaderId === user.id ? g.requests.map((id) => memberBrief(id, g)).filter(Boolean) : [],
      perMember: params.PER_MEMBER || 0,
      bonusEach: (params.PER_MEMBER || 0) * g.members.length,
      // Лимит вместимости альянса (по уровню лидера × 10)
      maxMembers: kind === 'alliance' ? user.level * (params.MEMBERS_PER_LEVEL || 10) : null,
      // Дипломаты и лимит приглашений
      diplomats: g.diplomats || 0,
      inviteLimit: inviteLimit(g),
      invitesUsed: pruneInviteLog(g),
      inviteCooldownMin: inviteCooldownMin(g),
      nextDiplomatCost: diplomatCost(g),
    } : null,
    pendingFor,
    top: Object.values(all)
      .map((x) => ({
        id: x.id, name: x.name,
        members: x.members.length,
        leaderName: (player.users()[x.leaderId] || {}).name || '—',
      }))
      .sort((x, y) => y.members - x.members)
      .slice(0, 20),
    rules: {
      createCost: createCost(kind),
      baseCreateCost: params.CREATE_COST,
      minLevel: params.MIN_LEVEL,
      perMember: params.PER_MEMBER || 0,
    },
  };
}

function create(user: User, kind: string, name: string, notices: Notices) {
  const def = defOf(kind);
  const params = paramsOf(kind);
  if (user[def.userField]) throw new u.ApiError('Вы уже состоите в этой группе');
  if (user.level < params.MIN_LEVEL) {
    throw new u.ApiError(`Создание доступно с ${params.MIN_LEVEL} уровня`);
  }
  name = String(name || '').trim();
  if (name.length < 3 || name.length > 20) throw new u.ApiError('Название: от 3 до 20 символов');
  const exists = Object.values(coll(kind)).some((x) => x.name.toLowerCase() === name.toLowerCase());
  if (exists) throw new u.ApiError(`${def.label} с таким названием уже существует`);

  const cost = createCost(kind);
  if (user.dollars < cost) throw new u.ApiError(`Создание стоит $${u.fmt(cost)}`);

  user.dollars -= cost;
  const id = u.uid(10);
  const isLegion = kind === 'legion';
  coll(kind)[id] = {
    id, name, leaderId: user.id, members: [user.id], requests: [], invites: [],
    createdAt: Date.now(),
    // Легион-специфика: казна и клановые постройки
    treasury: isLegion ? 0 : undefined,
    buildings: isLegion ? {} : undefined,
    war: isLegion ? null : undefined,
  };
  user[def.userField] = id;
  db.save(def.coll);
  notices.push(`⭐ ${def.label} «${name}» основан! Вы — его лидер.`);
  return { id, name };
}

function apply(user: User, kind: string, groupId: string, notices: Notices) {
  const def = defOf(kind);
  if (user[def.userField]) throw new u.ApiError('Сначала покиньте текущую группу');
  const all = coll(kind);
  const g = all[groupId];
  if (!g) throw new u.ApiError(`${def.label} не найден`);

  // Одна активная заявка на kind: отзываем прежние
  for (const x of Object.values(all) as any[]) {
    const i = x.requests.indexOf(user.id);
    if (i >= 0) x.requests.splice(i, 1);
  }
  g.requests.push(user.id);
  db.save(def.coll);

  const leader = player.users()[g.leaderId];
  if (leader) {
    social.systemMail(leader, `Заявка в ${def.label.toLowerCase()}`,
      `Игрок ${user.name} (ур. ${user.level}) хочет вступить в «${g.name}». Решение — за вами.`);
  }
  notices.push(`Заявка в «${g.name}» отправлена. Ждите решения лидера.`);
}

function decide(user: User, kind: string, applicantId: string, accept: boolean, notices: Notices) {
  const def = defOf(kind);
  const groupId = user[def.userField];
  const g = groupId ? coll(kind)[groupId] : null;
  if (!g || g.leaderId !== user.id) throw new u.ApiError('Решать заявки может только лидер');
  const i = g.requests.indexOf(applicantId);
  if (i < 0) throw new u.ApiError('Заявка не найдена (возможно, отозвана)');
  g.requests.splice(i, 1);

  const applicant = player.users()[applicantId];
  if (accept && applicant && !applicant[def.userField]) {
    applicant[def.userField] = g.id;
    g.members.push(applicant.id);
    social.systemMail(applicant, 'Добро пожаловать!',
      `Вы приняты в ${def.label.toLowerCase()} «${g.name}».`);
    notices.push(`${applicant.name} принят. Бойцов: ${g.members.length}.`);
  } else if (applicant) {
    social.systemMail(applicant, 'Заявка отклонена', `Лидер «${g.name}» отклонил вашу заявку.`);
    notices.push('Заявка отклонена.');
  }
  db.save(def.coll);
}

// Лидер приглашает другого игрока (отправляет инвайт по userId)
// ---------- Дипломаты и лимит приглашений ----------
// Базовый лимит: 5 приглашений в час. Дипломаты добавляют по +1 в час.
// Первый дипломат стоит 100 золота, каждый следующий в 2 раза дороже.
const BASE_INVITES_PER_HOUR = 5;
const DIPLOMAT_BASE_COST_GOLD = 100;
const INVITE_WINDOW_MS = 60 * 60 * 1000;

function inviteLimit(g: any): number {
  return BASE_INVITES_PER_HOUR + (g.diplomats || 0);
}
function diplomatCost(g: any): number {
  // Стоимость следующего дипломата: 100 * 2^N
  return DIPLOMAT_BASE_COST_GOLD * Math.pow(2, g.diplomats || 0);
}
// Чистим устаревшие отметки и считаем, сколько приглашений уже отправлено за час
function pruneInviteLog(g: any): number {
  if (!g.inviteLog) g.inviteLog = [];
  const cutoff = Date.now() - INVITE_WINDOW_MS;
  g.inviteLog = g.inviteLog.filter((t) => t > cutoff);
  return g.inviteLog.length;
}
// Минут до восстановления одного слота приглашений
function inviteCooldownMin(g: any): number {
  pruneInviteLog(g);
  if (g.inviteLog.length === 0) return 0;
  const oldest = g.inviteLog[0];
  return Math.max(0, Math.ceil((INVITE_WINDOW_MS - (Date.now() - oldest)) / 60000));
}

// Нанять дипломата. Снимает золото с пользователя (лидера альянса/легиона).
function hireDiplomat(user: User, kind: string, notices: Notices) {
  const def = defOf(kind);
  const groupId = user[def.userField];
  const g = groupId ? coll(kind)[groupId] : null;
  if (!g || g.leaderId !== user.id) throw new u.ApiError(`Нанять дипломата может только лидер ${def.label.toLowerCase()}`);
  const cost = diplomatCost(g);
  if (user.gold < cost) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${cost})`);
  user.gold -= cost;
  g.diplomats = (g.diplomats || 0) + 1;
  db.save(def.coll);
  notices.push(`🎩 Нанят дипломат №${g.diplomats}. Лимит приглашений: ${inviteLimit(g)}/час. Следующий — 🪙 ${diplomatCost(g)}.`);
  return { diplomats: g.diplomats, inviteLimit: inviteLimit(g), nextCost: diplomatCost(g) };
}

function invite(user: User, kind: string, targetId: string, notices: Notices) {
  const def = defOf(kind);
  const groupId = user[def.userField];
  const g = groupId ? coll(kind)[groupId] : null;
  if (!g || g.leaderId !== user.id) throw new u.ApiError('Приглашать может только лидер');
  if (targetId === user.id) throw new u.ApiError('Нельзя пригласить самого себя');

  // Лимит участников: уровень лидера × 10
  if (kind === 'alliance') {
    const maxMembers = user.level * (config.ALLIANCE.MEMBERS_PER_LEVEL || 10);
    const current = (g.members || []).length;
    if (current >= maxMembers) {
      throw new u.ApiError(`Альянс заполнен: ${current}/${maxMembers}. Повысьте свой уровень — каждый уровень открывает +10 мест.`);
    }
  }

  // Проверка лимита приглашений в час.
  // Наёмник «Дипломат Вектор» (invite_unlimited) снимает этот лимит на 24ч.
  const hasUnlimited = (user.effects || []).some(
    (e) => e.type === 'invite_unlimited' && e.expiresAt > Date.now()
  );
  const limit = hasUnlimited ? 999 : inviteLimit(g);
  const used = pruneInviteLog(g);
  if (!hasUnlimited && used >= limit) {
    const wait = inviteCooldownMin(g);
    throw new u.ApiError(`Лимит ${limit} приглашений/час исчерпан. Слот освободится через ~${wait} мин. Наймите дипломата чтобы увеличить лимит.`);
  }

  // Автоприём для ботов: добавляем фейкового члена в альянс.
  // ВАЖНО: боты эфемерны (живут 15 минут в кэше battle.js), поэтому
  // сохраняем СНИМОК их данных (имя/уровень/флаг) на момент вступления —
  // иначе отображение списка участников будет терять их после истечения TTL.
  if (String(targetId).startsWith('bot_')) {
    if (kind !== 'alliance') throw new u.ApiError('В легион можно приглашать только живых игроков');
    const botMembers = g.botMembers || (g.botMembers = []);
    if (botMembers.includes(targetId)) throw new u.ApiError('Этот боец уже у вас в альянсе');
    botMembers.push(targetId);
    g.members = g.members || [g.leaderId];
    g.members.push(targetId);
    // Снимок данных бота — берём из battle.js (если ещё жив в кэше)
    if (!g.botSnapshots) g.botSnapshots = {};
    const battle = require('./battle');
    const botData = battle.peekBot(targetId);
    g.botSnapshots[targetId] = botData
      ? { id: targetId, name: botData.name, flag: botData.flag, level: botData.level, rating: botData.rating || botData.power }
      : { id: targetId, name: 'Боец альянса', flag: '🏳', level: 1, rating: 0 };
    g.inviteLog.push(Date.now());
    db.save(def.coll);
    notices.push(`✅ Боец автоматически принял приглашение в альянс. Осталось приглашений: ${limit - used - 1}/час`);
    return;
  }

  const target = player.users()[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target[def.userField]) throw new u.ApiError('Игрок уже состоит в группе');

  g.invites = g.invites || [];
  if (g.invites.includes(targetId)) throw new u.ApiError('Приглашение уже отправлено');
  g.invites.push(targetId);
  g.inviteLog.push(Date.now());
  db.save(def.coll);

  social.systemMail(target, `Приглашение в альянс`,
    `Лидер «${g.name}» (${user.name}) приглашает вас присоединиться к его альянсу. ` +
    `Откройте раздел «Альянс» и примите или отклоните приглашение.`);
  notices.push(`Приглашение игроку ${target.name} отправлено. Осталось приглашений: ${limit - used - 1}/час`);
}

// Удаление всех ботов из всех альянсов (миграция: «фейковая мощь» от ботов сбрасывается)
function cleanupBotsFromAlliances(): void {
  const all = coll('alliance');
  let removed = 0;
  for (const g of Object.values(all)) {
    if (!g.members) continue;
    const before = g.members.length;
    g.members = g.members.filter((m) => !String(m).startsWith('bot_'));
    g.botMembers = [];
    removed += before - g.members.length;
  }
  if (removed > 0) {
    db.save('alliance');
    console.log(`🧹 Удалено ${removed} фейковых ботов из альянсов`);
  }
}

// Игрок принимает или отклоняет приглашение
function respondInvite(user: User, kind: string, groupId: string, accept: boolean, notices: Notices) {
  const def = defOf(kind);
  const g = coll(kind)[groupId];
  if (!g) throw new u.ApiError(`${def.label} не найден`);
  g.invites = g.invites || [];
  const i = g.invites.indexOf(user.id);
  if (i < 0) throw new u.ApiError('Приглашение не найдено');
  g.invites.splice(i, 1);

  if (accept) {
    if (kind === 'alliance') {
      // Альянс — это ЛИЧНАЯ сеть союзников у каждого игрока. У каждого
      // свой отдельный альянс со своим составом. Принятие приглашения
      // означает взаимный обмен: лидер добавляет игрока в свой альянс,
      // а игрок — лидера в свой (создаём, если у игрока альянса ещё нет).
      const leader = player.users()[g.leaderId];

      // 1. Добавляем принявшего в альянс лидера-инициатора
      if (!g.members.includes(user.id)) {
        g.members.push(user.id);
      }

      // 2. Гарантируем что у принявшего есть СВОЙ отдельный альянс
      const userAlliances = coll('alliance');
      let userAlliance = user.allianceId ? userAlliances[user.allianceId] : null;
      if (!userAlliance) {
        // Создаём личный альянс для принявшего (бесплатно, как ответный союз)
        const aid = u.uid(10);
        userAlliance = {
          id: aid,
          name: `Союз ${user.name}`,
          leaderId: user.id,
          members: [user.id],
          requests: [], invites: [],
          createdAt: Date.now(),
        };
        userAlliances[aid] = userAlliance;
        user.allianceId = aid;
      }

      // 3. Добавляем лидера-инициатора в альянс принявшего (его отдельный состав)
      if (!userAlliance.members.includes(g.leaderId)) {
        userAlliance.members.push(g.leaderId);
      }

      db.save('alliances');
      db.save('users');

      if (leader) social.systemMail(leader, 'Приглашение принято!',
        `${user.name} принял ваше приглашение. Вы теперь в союзе.`);
      notices.push(`Вы заключили союз с «${g.name}». У вас свой состав альянса.`);
    } else {
      // Легион — классическое вступление (один легион на игрока)
      if (user[def.userField]) throw new u.ApiError('Сначала покиньте текущую группу');
      user[def.userField] = g.id;
      g.members.push(user.id);
      const leader = player.users()[g.leaderId];
      if (leader) social.systemMail(leader, 'Пополнение!', `${user.name} принял приглашение в «${g.name}».`);
      notices.push(`Вы приняли приглашение и вступили в «${g.name}»!`);
    }
  } else {
    notices.push('Приглашение отклонено.');
  }
  db.save(def.coll);
}

// Список приглашений, ожидающих ответа этого игрока
function pendingInvites(user: User, kind: string): any {
  const def = defOf(kind);
  const out: any[] = [];
  for (const g of Object.values(coll(kind)) as any[]) {
    if (g.invites && g.invites.includes(user.id)) {
      const leader = player.users()[g.leaderId];
      out.push({
        id: g.id, name: g.name,
        leaderName: leader ? leader.name : '—',
        members: g.members.length,
      });
    }
  }
  return out;
}

function kick(user: User, kind: string, memberId: string, notices: Notices) {
  const def = defOf(kind);
  const groupId = user[def.userField];
  const g = groupId ? coll(kind)[groupId] : null;
  if (!g || g.leaderId !== user.id) throw new u.ApiError('Исключать может только лидер');
  if (memberId === user.id) throw new u.ApiError('Лидер не может исключить сам себя — используйте выход');
  const i = g.members.indexOf(memberId);
  if (i < 0) throw new u.ApiError('Этого игрока нет в группе');
  g.members.splice(i, 1);
  const member = player.users()[memberId];
  if (member) {
    member[def.userField] = null;
    social.systemMail(member, 'Исключение из группы', `Вы исключены из «${g.name}».`);
  }
  db.save(def.coll);
  notices.push('Боец исключён.');
}

function leave(user: User, kind: string, notices: Notices) {
  const def = defOf(kind);
  const all = coll(kind);
  const groupId = user[def.userField];
  const g = groupId ? all[groupId] : null;
  if (!g) throw new u.ApiError('Вы не состоите в группе');

  const i = g.members.indexOf(user.id);
  if (i >= 0) g.members.splice(i, 1);
  user[def.userField] = null;

  if (g.leaderId === user.id) {
    if (g.members.length === 0) {
      delete all[g.id];
      notices.push(`«${g.name}» расформирован.`);
    } else {
      g.leaderId = g.members[0];
      const heir = player.users()[g.leaderId];
      if (heir) social.systemMail(heir, 'Вы — новый лидер', `Руководство «${g.name}» переходит к вам.`);
      notices.push(`Вы покинули «${g.name}». Лидерство передано.`);
    }
  } else {
    notices.push(`Вы покинули «${g.name}».`);
  }
  db.save(def.coll);
}

export = { view, create, apply, decide, invite, respondInvite, pendingInvites, kick, leave, hireDiplomat, cleanupBotsFromAlliances };
