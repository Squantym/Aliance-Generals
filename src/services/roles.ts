// ═══════════════════════════════════════════════════════════════════
// src/services/roles.ts — роли и модерация
//
// Иерархия:
//   owner     — владелец проекта. Полный доступ, включая выдачу любых
//               ролей. Снять владельца может только другой владелец
//               (или команда на сервере).
//   admin     — администратор. Полный доступ к админ-панели, но НЕ может
//               трогать других администраторов и владельца: назначает и
//               снимает только модераторов.
//   moderator — «Дозор». Следит за чатом: может блокировать игроку чат
//               на срок с указанием причины и снимать блокировку.
//               Никакого доступа к ресурсам, балансу и удалению
//               аккаунтов у модератора нет.
//
// Совместимость: старое поле isAdmin остаётся ведущим для действующих
// администраторов — обновление не отбирает ни у кого доступ.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

type Role = 'owner' | 'admin' | 'moderator' | null;

// Максимальный срок блокировки чата, минут (30 суток)
const MAX_BAN_MINUTES = 30 * 24 * 60;

// ═══ ЗОНЫ ДОСТУПА ═════════════════════════════════════════════════
// Права разложены по зонам. Владелец имеет все, администратор — все,
// кроме перечисленных в OWNER_ONLY. Каждый админский запрос относится
// к зоне по своему адресу (см. zoneOfPath ниже), поэтому новый запрос
// автоматически попадает в нужную зону, а неизвестные адреса по
// умолчанию считаются владельческими — безопасная сторона по умолчанию.
type Zone =
  | 'players'     // поиск, профили, история входов, IP и устройства
  | 'moderation'  // баны аккаунтов, блокировки чата, назначение модераторов
  | 'security'    // сброс паролей, привязок, прогресса; поиск мультоводов
  | 'support'     // обращения в поддержку, push-уведомления
  | 'legions'     // управление легионами и турнирами
  | 'news'        // новости и анонсы
  | 'event'       // мировое событие
  | 'economy'     // ВЫДАЧА и списание ресурсов, награды, компенсации
  | 'discounts'   // акции и скидки
  | 'database'    // копии базы, снимки, восстановление
  | 'roles'       // назначение администраторов и владельцев
  | 'season';     // настройки сезона, принудительное завершение недели

// Все зоны с человеческими названиями — для настройки в панели
const ZONE_INFO: Array<{ id: Zone; name: string; note: string }> = [
  { id: 'players',    name: 'Игроки',          note: 'поиск, профили, история входов, IP и устройства' },
  { id: 'moderation', name: 'Модерация',       note: 'баны аккаунтов, блокировка чата, удаление аккаунтов' },
  { id: 'security',   name: 'Безопасность',    note: 'сброс паролей и прогресса, поиск мультоводов' },
  { id: 'support',    name: 'Поддержка',       note: 'обращения игроков, ответы, push-уведомления' },
  { id: 'legions',    name: 'Легионы',         note: 'управление легионами, кланами и турнирами' },
  { id: 'news',       name: 'Новости',         note: 'публикация новостей и анонсов' },
  { id: 'event',      name: 'Мировое событие', note: 'запуск и остановка события' },
  { id: 'roles',      name: 'Роли',            note: 'назначение модераторов (администраторов — только владелец)' },
  { id: 'economy',    name: 'Ресурсы',         note: 'выдача и списание денег, золота, наград, наёмников' },
  { id: 'discounts',  name: 'Акции',           note: 'скидки и глобальные бонусы' },
  { id: 'database',   name: 'База данных',     note: 'копии, снимки, восстановление' },
  { id: 'season',     name: 'Сезон',           note: 'настройки наград и завершение недели' },
];
const ALL_ZONES: Zone[] = ZONE_INFO.map((z) => z.id);

// Что доступно ролям ПО УМОЛЧАНИЮ. Владельца здесь нет: у него всегда
// полный доступ, иначе он мог бы отключить себе разделы и остаться без
// возможности вернуть их обратно.
const DEFAULT_ZONES: Record<string, Zone[]> = {
  admin: ['players', 'moderation', 'security', 'support', 'legions', 'news', 'event', 'roles'],
  moderator: [],       // модератор работает из чата, панель ему не нужна
};

// Действующая настройка: из базы, если владелец её менял, иначе по
// умолчанию. Коллекция roleZones переживает перезапуск сервера.
function zonesOfRole(role: string): Zone[] {
  if (role === 'owner') return ALL_ZONES.slice();
  const saved: any = db.load('roleZones', {});
  const list = saved[role];
  if (Array.isArray(list)) return list.filter((z: any) => ALL_ZONES.includes(z));
  return (DEFAULT_ZONES[role] || []).slice();
}

// Полномочия роли «администратор». true — админы работают в своих зонах.
const ADMIN_POWERS_ENABLED = true;

// Определение зоны по адресу запроса. Порядок важен: более длинные
// совпадения проверяются раньше.
const ZONE_RULES: Array<[RegExp, Zone]> = [
  [/^\/api\/admin\/db\//,                          'database'],
  [/^\/api\/admin\/(discount|discounts)$/,          'discounts'],
  [/^\/api\/admin\/(grant|grant-all|take|rewards|merc)/, 'economy'],
  [/^\/api\/admin\/global-buffs?$/,                 'economy'],
  [/^\/api\/admin\/claim-gift$/,                    'economy'],
  [/^\/api\/admin\/season\//,                      'season'],
  [/^\/api\/admin\/fame\//,                        'season'],
  [/^\/api\/staff\/role$/,                          'roles'],
  // Настройка возможностей ролей — отдельная зона: её проверяет сам
  // сервис (только владелец), но адрес обязан быть размечен, иначе
  // тест полноты зон справедливо ругается
  [/^\/api\/staff\/permissions/,                    'roles'],
  [/^\/api\/admin\/(ban|delete-account|wipe-groups|mines\/wipe)$/, 'moderation'],
  [/^\/api\/mod\//,                                 'moderation'],
  [/^\/api\/admin\/(reset|reset-missions|reset-param|set-password)$/, 'security'],
  [/^\/api\/admin\/(players|logs|db-integrity)$/,   'players'],
  // Просмотр карточки игрока и его состояния — часть раздела «Игроки».
  // Раньше эти адреса не попадали ни в одну зону и по умолчанию считались
  // владельческими: администратор не мог открыть даже профиль.
  [/^\/api\/admin\/player-(view|snapshot)\//,       'players'],
  // Кланы и легионы через общий раздел групп
  [/^\/api\/admin\/groups\//,                       'legions'],
  [/^\/api\/admin\/(support|email)/,                'support'],
  [/^\/api\/admin\/push\//,                        'support'],
  [/^\/api\/admin\/(legion|tournaments)/,           'legions'],
  [/^\/api\/admin\/event\//,                       'event'],
  [/^\/api\/staff$/,                                 'players'],
];

function zoneOfPath(pathname: string): Zone | null {
  for (const [re, zone] of ZONE_RULES) if (re.test(pathname)) return zone;
  return null;   // неизвестный админский адрес — только владельцу
}

// Может ли пользователь работать в зоне
function canAccessZone(user: any, zone: Zone | null): boolean {
  if (isOwner(user)) return true;                       // владельцу открыто всё
  if (!ADMIN_POWERS_ENABLED) return false;
  const r = roleOf(user);
  if (!r) return false;
  if (!zone) return false;                              // незнакомый адрес — нет
  return zonesOfRole(r).includes(zone);
}

// Зоны, доступные конкретному пользователю — для интерфейса панели
function zonesFor(user: any): Zone[] {
  if (isOwner(user)) return ALL_ZONES.slice();
  if (!ADMIN_POWERS_ENABLED) return [];
  const r = roleOf(user);
  return r ? zonesOfRole(r) : [];
}

// ---------- Настройка возможностей ролей (только владелец) ----------
function permissionsView() {
  const saved: any = db.load('roleZones', {});
  return {
    zones: ZONE_INFO,
    roles: [
      { id: 'admin',     name: 'Администратор', zones: zonesOfRole('admin'),     custom: Array.isArray(saved.admin) },
      { id: 'moderator', name: 'Дозор',         zones: zonesOfRole('moderator'), custom: Array.isArray(saved.moderator) },
    ],
    defaults: DEFAULT_ZONES,
  };
}

// Включить или выключить раздел для роли. Владельца настраивать нельзя:
// у него всегда полный доступ — иначе можно было бы отключить себе
// «Роли» и потерять возможность вернуть настройки обратно.
function setRoleZone(actor: User, role: string, zone: string, enabled: boolean, notices: Notices) {
  if (!isOwner(actor)) throw new u.ApiError('Настраивать возможности ролей может только владелец');
  if (role === 'owner') throw new u.ApiError('У владельца всегда полный доступ — это нельзя изменить');
  if (role !== 'admin' && role !== 'moderator') throw new u.ApiError('Неизвестная роль');
  if (!ALL_ZONES.includes(zone as Zone)) throw new u.ApiError('Неизвестный раздел');

  const saved: any = db.load('roleZones', {});
  const current: Zone[] = Array.isArray(saved[role]) ? saved[role].slice() : (DEFAULT_ZONES[role] || []).slice();
  const has = current.includes(zone as Zone);
  if (enabled && !has) current.push(zone as Zone);
  if (!enabled && has) current.splice(current.indexOf(zone as Zone), 1);
  saved[role] = current;
  db.save('roleZones');

  const zi = ZONE_INFO.find((z) => z.id === zone);
  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/staff/permissions',
    body: { role, zone, enabled },
  });
  notices.push(`${enabled ? '✅ Открыт' : '⛔ Закрыт'} раздел «${zi ? zi.name : zone}» для роли ` +
               `${role === 'admin' ? 'Администратор' : 'Дозор'}`);
  return permissionsView();
}

// Вернуть роли настройку по умолчанию
function resetRoleZones(actor: User, role: string, notices: Notices) {
  if (!isOwner(actor)) throw new u.ApiError('Настраивать возможности ролей может только владелец');
  if (role !== 'admin' && role !== 'moderator') throw new u.ApiError('Неизвестная роль');
  const saved: any = db.load('roleZones', {});
  delete saved[role];
  db.save('roleZones');
  notices.push(`↩️ Возможности роли «${role === 'admin' ? 'Администратор' : 'Дозор'}» сброшены к исходным`);
  return permissionsView();
}

// ---------- Определение роли ----------
function roleOf(user: any): Role {
  if (!user) return null;
  if (user.role === 'owner') return 'owner';
  if (user.role === 'admin' || user.isAdmin) return 'admin';   // isAdmin — наследие
  if (user.role === 'moderator') return 'moderator';
  return null;
}

function isOwner(user: any): boolean { return roleOf(user) === 'owner'; }

// Полный доступ: владелец всегда; администратор — только если его
// полномочия включены (сейчас приостановлены, см. ADMIN_POWERS_ENABLED).
function isAdmin(user: any): boolean {
  const r = roleOf(user);
  if (r === 'owner') return true;
  return ADMIN_POWERS_ENABLED && r === 'admin';
}

// Право модерировать чат: владелец, «Дозор» и — при включённых
// полномочиях — администратор.
function isModerator(user: any): boolean {
  const r = roleOf(user);
  if (r === 'owner' || r === 'moderator') return true;
  return ADMIN_POWERS_ENABLED && r === 'admin';
}

// Приостановлены ли полномочия администраторов — нужно интерфейсу,
// чтобы честно показать носителю роли, что доступа сейчас нет
function adminPowersEnabled(): boolean { return ADMIN_POWERS_ENABLED; }

// Название роли для интерфейса
function roleLabel(user: any): string {
  switch (roleOf(user)) {
    case 'owner': return 'Владелец';
    case 'admin': return ADMIN_POWERS_ENABLED ? 'Администратор' : 'Администратор (без прав)';
    case 'moderator': return 'Дозор';
    default: return '';
  }
}

// ---------- Управление ролями ----------
// Кто кого может назначать:
//   владелец → любую роль любому
//   админ    → только модератора, и только тому, кто не админ и не владелец
function canManage(actor: any, target: any, newRole: Role): boolean {
  if (!actor || !target) return false;
  if (actor.id === target.id) return false;               // себе роль не меняют
  if (isOwner(actor)) return true;                        // владелец — любые роли
  if (!ADMIN_POWERS_ENABLED) return false;
  if (roleOf(actor) !== 'admin') return false;
  // Администратор назначает и снимает ТОЛЬКО модераторов и только тем,
  // у кого нет роли. Администраторов и владельца назначает владелец.
  if (roleOf(target) === 'owner' || roleOf(target) === 'admin') return false;
  return newRole === 'moderator' || newRole === null;
}

function setRole(actor: User, targetId: string, role: Role, notices: Notices) {
  const users = player.users();
  const target = users[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (role !== null && role !== 'owner' && role !== 'admin' && role !== 'moderator') {
    throw new u.ApiError('Неизвестная роль');
  }
  if (actor.id === target.id) throw new u.ApiError('Нельзя менять роль самому себе');
  // Раздавать роли могут только администрация и владелец. Проверяем это
  // отдельно, иначе модератор получал бы ответ, адресованный админу.
  if (!isAdmin(actor)) throw new u.ApiError('Недостаточно прав');
  if (!canManage(actor, target, role)) {
    throw new u.ApiError(isOwner(actor)
      ? 'Недостаточно прав'
      : 'Администратор может назначать только модераторов и только обычным игрокам');
  }
  if (role === 'owner' && !isOwner(actor)) throw new u.ApiError('Владельца может назначить только владелец');

  const before = roleOf(target);
  (target as any).role = role;
  // Держим старое поле в согласии с ролью, чтобы прежние проверки работали
  (target as any).isAdmin = role === 'owner' || role === 'admin';
  db.markUser(target.id);
  db.save('users');

  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/roles/set',
    body: { targetId: target.id, targetName: target.name, from: before, to: role },
  });
  notices.push(role
    ? `Игроку «${target.name}» назначена роль: ${roleLabel(target)}`
    : `С игрока «${target.name}» сняты все роли`);
  return { id: target.id, name: target.name, role, label: roleLabel(target) };
}

// Список всех, у кого есть роль
function staffList() {
  const out: any[] = [];
  for (const p of Object.values(player.users()) as any[]) {
    const r = roleOf(p);
    if (!r) continue;
    out.push({
      id: p.id, name: p.name, level: p.level, flag: player.flag(p),
      role: r, label: roleLabel(p), lastSeen: p.lastSeen || 0,
    });
  }
  const order: Record<string, number> = { owner: 0, admin: 1, moderator: 2 };
  return out.sort((a, b) => (order[a.role] - order[b.role]) || a.name.localeCompare(b.name));
}

// ---------- Блокировка чата ----------
// Проверка перед отправкой в ПУБЛИЧНЫЙ канал (общий чат, чат легиона).
// Личная переписка блокировкой не затрагивается: наказание за поведение
// на публике не должно лишать человека возможности написать напрямую.
function assertCanWritePublic(user: any): void {
  const ban = chatBanInfo(user);
  if (!ban) return;
  const left = Math.max(1, Math.round((ban.until - Date.now()) / 60000));
  throw new u.ApiError(
    `🔇 Вам закрыты общие чаты ещё на ${humanMinutes(left)}. Причина: ${ban.reason}` +
    (ban.byName ? ` (Дозор: ${ban.byName})` : '') +
    '. Личные сообщения по-прежнему доступны.'
  );
}

function chatBanInfo(user: any): { active: boolean; until: number; reason: string; byName: string } | null {
  const b = user && (user as any).chatBan;
  if (!b) return null;
  if (b.until && b.until <= Date.now()) return null;         // срок вышел
  return { active: true, until: b.until, reason: b.reason || '', byName: b.byName || '' };
}

function banChat(actor: User, targetId: string, minutes: number, reason: string, notices: Notices) {
  if (!isModerator(actor)) throw new u.ApiError('Недостаточно прав');
  const users = player.users();
  const target = users[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.id === actor.id) throw new u.ApiError('Нельзя заблокировать чат самому себе');
  // Кого нельзя заглушить: проверяем по НАЗНАЧЕННОЙ роли, а не по текущим
  // полномочиям. Иначе администратор с приостановленными правами перестал
  // бы считаться сотрудником, и модератор смог бы его заблокировать.
  const targetRole = roleOf(target);
  if (targetRole === 'owner') throw new u.ApiError('Нельзя блокировать владельца проекта');
  if (targetRole && !isOwner(actor)) throw new u.ApiError('Нельзя блокировать сотрудника проекта');

  const mins = u.clamp(u.toInt(minutes, 0), 1, MAX_BAN_MINUTES);
  const why = String(reason || '').trim().slice(0, 200);
  if (!why) throw new u.ApiError('Укажите причину блокировки');

  (target as any).chatBan = {
    until: Date.now() + mins * 60 * 1000,
    minutes: mins,
    reason: why,
    byId: actor.id,
    byName: actor.name,
    at: Date.now(),
  };
  db.markUser(target.id);
  db.save('users');

  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/mod/chat-ban',
    body: { targetId: target.id, targetName: target.name, minutes: mins, reason: why },
  });
  try {
    require('./notifications').push(target.id, 'chat_ban',
      `🔇 Чат заблокирован на ${humanMinutes(mins)}. Причина: ${why}`, { until: (target as any).chatBan.until });
  } catch (e) {}

  notices.push(`🔇 Чат игрока «${target.name}» заблокирован на ${humanMinutes(mins)}. Причина: ${why}`);
  return { id: target.id, name: target.name, until: (target as any).chatBan.until, minutes: mins, reason: why };
}

function unbanChat(actor: User, targetId: string, notices: Notices) {
  if (!isModerator(actor)) throw new u.ApiError('Недостаточно прав');
  const users = player.users();
  const target = users[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (!(target as any).chatBan) throw new u.ApiError('У этого игрока чат не заблокирован');
  (target as any).chatBan = null;
  db.markUser(target.id);
  db.save('users');
  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/mod/chat-unban',
    body: { targetId: target.id, targetName: target.name },
  });
  try {
    require('./notifications').push(target.id, 'chat_unban', '🔊 Блокировка чата снята', {});
  } catch (e) {}
  notices.push(`🔊 Блокировка чата снята с игрока «${target.name}»`);
  return { id: target.id, name: target.name };
}

// Действующие блокировки — для панели модератора
function bannedList() {
  const out: any[] = [];
  for (const p of Object.values(player.users()) as any[]) {
    const info = chatBanInfo(p);
    if (!info) continue;
    out.push({
      id: p.id, name: p.name, flag: player.flag(p), level: p.level,
      until: info.until, reason: info.reason, byName: info.byName,
      leftMinutes: Math.max(1, Math.round((info.until - Date.now()) / 60000)),
    });
  }
  return out.sort((a, b) => a.until - b.until);
}

function humanMinutes(m: number): string {
  if (m < 60) return `${m} мин`;
  if (m < 24 * 60) {
    const h = Math.round(m / 60);
    return `${h} ч`;
  }
  const d = Math.round(m / (24 * 60));
  return `${d} дн`;
}

export = {
  roleOf, isOwner, isAdmin, isModerator, roleLabel, adminPowersEnabled,
  zoneOfPath, canAccessZone, zonesFor, zonesOfRole,
  permissionsView, setRoleZone, resetRoleZones, ZONE_INFO, ALL_ZONES, DEFAULT_ZONES,
  setRole, staffList, canManage,
  banChat, unbanChat, chatBanInfo, bannedList, humanMinutes, assertCanWritePublic,
  MAX_BAN_MINUTES,
};
