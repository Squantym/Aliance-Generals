// ===================================================================
// src/services/groups.js — обобщённая логика групп (альянс и легион)
// Альянс и легион работают одинаково: лидер, заявки, исключение,
// передача лидерства. Различаются только цена, минимальный уровень
// и поле в пользователе (allianceId / legionId).
// ===================================================================

const db = require('../core/db');
const u = require('../core/utils');
const player = require('./player');
const social = require('./social');
const discounts = require('./discounts');

// kind: 'alliance' | 'legion'
// Каждой группе свой коллекшен и своё поле у пользователя
const KINDS = {
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

function defOf(kind) { const d = KINDS[kind]; if (!d) throw new u.ApiError('Неизвестный тип группы'); return d; }
function paramsOf(kind) {
  const c = require('../../config/gameConfig');
  return kind === 'legion' ? c.LEGION : c.ALLIANCE;
}
function coll(kind) { return db.load(defOf(kind).coll, {}); }

function memberBrief(id) {
  const p = player.users()[id];
  return p ? { id: p.id, name: p.name, flag: player.flag(p), level: p.level, rating: player.rating(p) } : null;
}

// Текущая стоимость создания с учётом активной скидки администратора
function createCost(kind) {
  const params = paramsOf(kind);
  const def = defOf(kind);
  return discounts.applyTo(def.discountCategory, params.CREATE_COST);
}

// Общий «вид» одной группы для UI
function view(user, kind) {
  const def = defOf(kind);
  const params = paramsOf(kind);
  const all = coll(kind);
  const groupId = user[def.userField] || null;
  const g = groupId ? all[groupId] : null;

  // В какую группу игрок уже подал заявку (если подал)
  let pendingFor = null;
  for (const x of Object.values(all)) {
    if (x.requests.includes(user.id)) { pendingFor = { id: x.id, name: x.name }; break; }
  }

  return {
    kind,
    mine: g ? {
      id: g.id, name: g.name,
      leaderId: g.leaderId, isLeader: g.leaderId === user.id,
      members: g.members.map(memberBrief).filter(Boolean).sort((x, y) => y.rating - x.rating),
      requests: g.leaderId === user.id ? g.requests.map(memberBrief).filter(Boolean) : [],
      perMember: params.PER_MEMBER || 0,
      bonusEach: (params.PER_MEMBER || 0) * g.members.length,
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

function create(user, kind, name, notices) {
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

function apply(user, kind, groupId, notices) {
  const def = defOf(kind);
  if (user[def.userField]) throw new u.ApiError('Сначала покиньте текущую группу');
  const all = coll(kind);
  const g = all[groupId];
  if (!g) throw new u.ApiError(`${def.label} не найден`);

  // Одна активная заявка на kind: отзываем прежние
  for (const x of Object.values(all)) {
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

function decide(user, kind, applicantId, accept, notices) {
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
function invite(user, kind, targetId, notices) {
  const def = defOf(kind);
  const groupId = user[def.userField];
  const g = groupId ? coll(kind)[groupId] : null;
  if (!g || g.leaderId !== user.id) throw new u.ApiError('Приглашать может только лидер');
  if (targetId === user.id) throw new u.ApiError('Нельзя пригласить самого себя');
  const target = player.users()[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target[def.userField]) throw new u.ApiError('Игрок уже состоит в группе');

  g.invites = g.invites || [];
  if (g.invites.includes(targetId)) throw new u.ApiError('Приглашение уже отправлено');
  g.invites.push(targetId);
  db.save(def.coll);

  social.systemMail(target, `Приглашение в ${def.label.toLowerCase()}`,
    `Лидер «${g.name}» приглашает вас в свои ряды. ` +
    `Откройте раздел «${def.label}» — там будет кнопка «Принять приглашение».`);
  notices.push(`Приглашение игроку ${target.name} отправлено.`);
}

// Игрок принимает или отклоняет приглашение
function respondInvite(user, kind, groupId, accept, notices) {
  const def = defOf(kind);
  const g = coll(kind)[groupId];
  if (!g) throw new u.ApiError(`${def.label} не найден`);
  g.invites = g.invites || [];
  const i = g.invites.indexOf(user.id);
  if (i < 0) throw new u.ApiError('Приглашение не найдено');
  g.invites.splice(i, 1);

  if (accept) {
    if (user[def.userField]) throw new u.ApiError('Сначала покиньте текущую группу');
    user[def.userField] = g.id;
    g.members.push(user.id);
    const leader = player.users()[g.leaderId];
    if (leader) social.systemMail(leader, 'Пополнение!', `${user.name} принял приглашение в «${g.name}».`);
    notices.push(`Вы приняли приглашение и вступили в «${g.name}»!`);
  } else {
    notices.push('Приглашение отклонено.');
  }
  db.save(def.coll);
}

// Список приглашений, ожидающих ответа этого игрока
function pendingInvites(user, kind) {
  const def = defOf(kind);
  const out = [];
  for (const g of Object.values(coll(kind))) {
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

function kick(user, kind, memberId, notices) {
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

function leave(user, kind, notices) {
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

module.exports = { view, create, apply, decide, invite, respondInvite, pendingInvites, kick, leave };
