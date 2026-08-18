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

// Иерархия: владелец → арбитр (главный админ) → администратор
//            владелец → комиссар (главный модератор) → дозор
type Role = 'owner' | 'arbiter' | 'admin' | 'commissar' | 'moderator' | null;

// Старшинство: кто выше, тот управляет теми, кто ниже
const RANK: Record<string, number> = {
  owner: 100, arbiter: 80, admin: 60, commissar: 40, moderator: 20,
};
const rankOf = (r: any): number => RANK[String(r)] || 0;

// Максимальный срок блокировки чата, минут (30 суток)
const MAX_BAN_MINUTES = 30 * 24 * 60;

// Каналы общения, которые можно закрыть игроку по отдельности.
// Раньше блокировка была одна на все публичные чаты; теперь модератор
// выбирает, что именно закрыть — например, только общий чат, оставив
// человеку связь с легионом.
const CHAT_SCOPES: Array<{ id: string; name: string; note: string }> = [
  { id: 'global', name: 'Общий чат',        note: 'мировой чат, виден всем игрокам' },
  { id: 'legion', name: 'Чат легиона',      note: 'внутренний чат легиона и альянса' },
  { id: 'mail',   name: 'Личные сообщения', note: 'переписка один на один' },
];
const ALL_SCOPES = CHAT_SCOPES.map((s) => s.id);

// ═══ ЗОНЫ ДОСТУПА ═════════════════════════════════════════════════
// Права разложены по зонам. Владелец имеет все, администратор — все,
// кроме перечисленных в OWNER_ONLY. Каждый админский запрос относится
// к зоне по своему адресу (см. zoneOfPath ниже), поэтому новый запрос
// автоматически попадает в нужную зону, а неизвестные адреса по
// умолчанию считаются владельческими — безопасная сторона по умолчанию.
type Zone =
  | 'players'     // поиск, профили, история входов, IP и устройства
  | 'chat'        // блокировка чатов и удаление сообщений
  | 'forum'       // закрытие и удаление тем на форуме
  | 'moderation'  // баны аккаунтов и удаление аккаунтов
  | 'security'    // сброс паролей, привязок, прогресса; поиск мультоводов
  | 'support'     // обращения в поддержку, push-уведомления
  | 'legions'     // управление легионами и турнирами
  | 'news'        // новости и анонсы
  | 'event'       // мировое событие
  | 'economy'     // ВЫДАЧА и списание ресурсов, награды, компенсации
  | 'discounts'   // акции и скидки
  | 'database'    // копии базы, снимки, восстановление
  | 'roles'       // назначение администраторов и владельцев
  | 'analytics'   // сводка по проекту: удержание, воронка, экономика
  | 'season';     // настройки сезона, принудительное завершение недели

// Все зоны с человеческими названиями — для настройки в панели
const ZONE_INFO: Array<{ id: Zone; name: string; note: string }> = [
  { id: 'players',    name: 'Игроки',          note: 'поиск, профили, история входов, IP и устройства' },
  { id: 'chat',       name: 'Модерация чатов', note: 'блокировка чатов игрокам, удаление сообщений' },
  { id: 'forum',      name: 'Модерация форума', note: 'закрытие и удаление тем, удаление комментариев' },
  { id: 'moderation', name: 'Баны аккаунтов',  note: 'блокировка входа в игру, удаление аккаунтов' },
  { id: 'security',   name: 'Безопасность',    note: 'сброс паролей и прогресса, поиск мультоводов' },
  { id: 'support',    name: 'Поддержка',       note: 'обращения игроков, ответы, push-уведомления' },
  { id: 'legions',    name: 'Легионы',         note: 'управление легионами, кланами и турнирами' },
  { id: 'news',       name: 'Новости',         note: 'публикация новостей и анонсов' },
  { id: 'event',      name: 'Мировое событие', note: 'запуск и остановка события' },
  { id: 'roles',      name: 'Роли',            note: 'назначение модераторов (администраторов — только владелец)' },
  { id: 'economy',    name: 'Ресурсы',         note: 'выдача и списание денег, золота, наград, наёмников' },
  { id: 'discounts',  name: 'Акции',           note: 'скидки и глобальные бонусы' },
  { id: 'analytics',  name: 'Аналитика',       note: 'удержание, воронка новичка, экономика проекта' },
  { id: 'database',   name: 'База данных',     note: 'копии, снимки, восстановление' },
  { id: 'season',     name: 'Сезон',           note: 'настройки наград и завершение недели' },
];
const ALL_ZONES: Zone[] = ZONE_INFO.map((z) => z.id);

// Что доступно ролям ПО УМОЛЧАНИЮ. Владельца здесь нет: у него всегда
// полный доступ, иначе он мог бы отключить себе разделы и остаться без
// возможности вернуть их обратно.
// Ни у одной роли НЕТ прав по умолчанию. Всё, что может сотрудник,
// владелец выдаёт явно во вкладке «Роли». Так исключается ситуация,
// когда роль получает возможности, о которых владелец не знал:
// новая роль — пустой лист, а не набор допущений разработчика.
const DEFAULT_ZONES: Record<string, Zone[]> = {
  arbiter: [],
  admin: [],
  commissar: [],
  moderator: [],
};

// Зоны, недоступные роли «Дозор» ни при каких настройках. Иначе владелец
// мог по ошибке открыть модератору «Модерацию» и вместе с ней — бан
// аккаунтов, выдачу ресурсов и удаление игроков.
// Зоны, которые владелец не может выдать НИКОМУ: они означают полный
// контроль над проектом и деньгами игроков. Всё остальное — на его
// усмотрение, включая опасные разделы (интерфейс о них предупреждает).
const OWNER_ONLY_ZONES: Zone[] = ['database'];
function forbiddenFor(_role: string): Zone[] { return OWNER_ONLY_ZONES; }

// Действующая настройка: из базы, если владелец её менял, иначе по
// умолчанию. Коллекция roleZones переживает перезапуск сервера.
function zonesOfRole(role: string): Zone[] {
  if (role === 'owner') return ALL_ZONES.slice();
  const saved: any = db.load('roleZones', {});
  const list = saved[role];
  const base: Zone[] = Array.isArray(list)
    ? list.filter((z: any) => ALL_ZONES.includes(z))
    : (DEFAULT_ZONES[role] || []).slice();
  // Страховка: даже если в базе осталась запрещённая зона (выдана по
  // ошибке или из старой версии), модератор её не получит
  const forbidden = forbiddenFor(role);
  return forbidden.length ? base.filter((z) => !forbidden.includes(z)) : base;
}

// Полномочия роли «администратор». true — админы работают в своих зонах.
const ADMIN_POWERS_ENABLED = true;

// Определение зоны по адресу запроса. Порядок важен: более длинные
// совпадения проверяются раньше.
const ZONE_RULES: Array<[RegExp, Zone]> = [
  [/^\/api\/admin\/db\//,                          'database'],
  [/^\/api\/admin\/(discount|discounts)$/,          'discounts'],
  [/^\/api\/admin\/(grant|grant-all|take|rewards|merc|vip)/, 'economy'],
  [/^\/api\/admin\/global-buffs?$/,                 'economy'],
  [/^\/api\/admin\/claim-gift$/,                    'economy'],
  [/^\/api\/admin\/season\//,                      'season'],
  [/^\/api\/admin\/fame\//,                        'season'],
  [/^\/api\/staff\/role$/,                          'roles'],
  // Настройка возможностей ролей — отдельная зона: её проверяет сам
  // сервис (только владелец), но адрес обязан быть размечен, иначе
  // тест полноты зон справедливо ругается
  [/^\/api\/staff\/permissions/,                    'roles'],
  [/^\/api\/admin\/(ban|account-ban|account-unban|delete-account|wipe-groups|mines\/wipe)$/, 'moderation'],
  // Блокировка чатов — своя зона, отдельная от банов аккаунтов
  [/^\/api\/mod\/(chat-ban|chat-unban|chat-bans|chat-scopes|chat-status|find)/, 'chat'],
  // Модерация форума: закрытие и удаление — своя зона; наказания игрокам
  // идут по зоне «Модерация чатов», проверка внутри сервиса
  [/^\/api\/forum\/(close|pin|delete|delete-comment)/, 'forum'],
  [/^\/api\/mod\//,                                 'moderation'],
  [/^\/api\/admin\/(reset|reset-missions|reset-param|set-password)$/, 'security'],
  [/^\/api\/admin\/(players|logs|db-integrity)$/,   'players'],
  // Сводка и карточка игрока — рабочий стол сотрудника, зона «Игроки»
  [/^\/api\/admin\/(dashboard|player-card|access)/, 'players'],
  [/^\/api\/admin\/(multi-check|net-check|email-status|verify-email|email-check|lobby-check|lobby-reset)/, 'security'],
  // Просмотр карточки игрока и его состояния — часть раздела «Игроки».
  // Раньше эти адреса не попадали ни в одну зону и по умолчанию считались
  // владельческими: администратор не мог открыть даже профиль.
  [/^\/api\/admin\/player-(view|snapshot)\//,       'players'],
  // Кланы и легионы через общий раздел групп
  [/^\/api\/admin\/groups\//,                       'legions'],
  [/^\/api\/admin\/(support|email)/,                'support'],
  // Журнал действий сотрудников — владельческий раздел (проверка внутри)
  [/^\/api\/admin\/(staff-log|gold-log)/,           'roles'],
  [/^\/api\/admin\/push\//,                        'support'],
  [/^\/api\/admin\/(legion|tournaments)/,           'legions'],
  [/^\/api\/admin\/event\//,                       'event'],
  [/^\/api\/admin\/event\/image$/,                 'event'],
  [/^\/api\/staff$/,                                 'players'],
  // Античит — раздел «Безопасность»: находки, а не действия
  [/^\/api\/admin\/anticheat/,                      'security'],
  // Аналитика проекта — отдельная зона: цифры бизнеса, не игровые права
  [/^\/api\/admin\/analytics/,                      'analytics'],
  // История состояния игрока — зона «Игроки». Она показывает то же, что
  // и досье игрока, только в прошлом, и ничего не меняет. Держать её под
  // владельческой зоной значило бы, что разобрать «у меня всё пропало»
  // может только владелец — а это самая частая задача сотрудника.
  [/^\/api\/admin\/player-history/,                 'players'],
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
  const row = (id: string, name: string) => ({ id, name, zones: zonesOfRole(id), custom: Array.isArray(saved[id]) });
  return {
    zones: ZONE_INFO,
    roles: [
      row('arbiter', 'Арбитр'),
      row('admin', 'Администратор'),
      row('commissar', 'Комиссар'),
      row('moderator', 'Дозор'),
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
  if (!['arbiter', 'admin', 'commissar', 'moderator'].includes(role)) throw new u.ApiError('Неизвестная роль');
  if (!ALL_ZONES.includes(zone as Zone)) throw new u.ApiError('Неизвестный раздел');
  // Опасные зоны роли «Дозор» не выдаются: его полномочия ограничены
  // общением намеренно, и открыть их «галочкой» нельзя
  if (enabled && forbiddenFor(role).includes(zone as Zone)) {
    const zi = ZONE_INFO.find((z) => z.id === zone);
    throw new u.ApiError(
      `Раздел «${zi ? zi.name : zone}» нельзя открыть этой роли — это полномочия администрации. ` +
      `Если человеку нужны такие права, назначьте его администратором.`
    );
  }

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
  if (!['arbiter', 'admin', 'commissar', 'moderator'].includes(role)) throw new u.ApiError('Неизвестная роль');
  const saved: any = db.load('roleZones', {});
  delete saved[role];
  db.save('roleZones');
  notices.push(`↩️ Возможности роли «${({ arbiter: 'Арбитр', admin: 'Администратор', commissar: 'Комиссар', moderator: 'Дозор' } as any)[role] || role}» сброшены к исходным`);
  return permissionsView();
}

// ---------- Определение роли ----------
function roleOf(user: any): Role {
  if (!user) return null;
  const r = user.role;
  if (r === 'owner' || r === 'arbiter' || r === 'admin' || r === 'commissar' || r === 'moderator') return r;
  if (user.isAdmin) return 'admin';        // наследие: старый флаг без роли
  return null;
}

function isOwner(user: any): boolean { return roleOf(user) === 'owner'; }

// Полный доступ: владелец всегда; администратор — только если его
// полномочия включены (сейчас приостановлены, см. ADMIN_POWERS_ENABLED).
// «Администратор» в смысле доступа к панели — тот, кому выдана хотя бы
// одна зона. Роль сама по себе прав больше не даёт.
function isAdmin(user: any): boolean {
  if (isOwner(user)) return true;
  if (!ADMIN_POWERS_ENABLED) return false;
  return zonesFor(user).length > 0;
}

// Право модерировать чат: владелец, «Дозор» и — при включённых
// полномочиях — администратор.
// Право модерировать чаты — теперь обычная выдаваемая возможность,
// а не свойство роли. Владельцу доступно всегда.
function isModerator(user: any): boolean {
  return canAccessZone(user, 'chat');
}

// Приостановлены ли полномочия администраторов — нужно интерфейсу,
// чтобы честно показать носителю роли, что доступа сейчас нет
function adminPowersEnabled(): boolean { return ADMIN_POWERS_ENABLED; }

// Название роли для интерфейса
// Полное название роли — для карточек и списков
function roleLabel(user: any): string {
  switch (roleOf(user)) {
    case 'owner': return 'Владелец';
    case 'arbiter': return 'Арбитр';
    case 'admin': return ADMIN_POWERS_ENABLED ? 'Администратор' : 'Администратор (без прав)';
    case 'commissar': return 'Комиссар';
    case 'moderator': return 'Дозор';
    default: return '';
  }
}

// Короткая приписка к имени — маленьким шрифтом над строкой
function roleTag(user: any): string {
  switch (roleOf(user)) {
    case 'owner': return 'owner';
    case 'arbiter': return 'arbiter';
    case 'admin': return 'admin';
    case 'commissar': return 'commissar';
    case 'moderator': return 'дозор';
    default: return '';
  }
}

// ---------- Управление ролями ----------
// Кто кого может назначать:
//   владелец → любую роль любому
//   админ    → только модератора, и только тому, кто не админ и не владелец
// Управлять можно только теми, кто НИЖЕ по старшинству, и назначать
// роль строго ниже своей. Иначе администратор мог бы сделать себе равного
// и потерялась бы вертикаль.
//   владелец  → любые роли
//   арбитр    → администратор, комиссар, дозор
//   админ     → дозор
//   комиссар  → дозор (он старший по чатам)
//   дозор     → никого
const CAN_ASSIGN: Record<string, Role[]> = {
  owner:     ['arbiter', 'admin', 'commissar', 'moderator', null],
  arbiter:   ['admin', 'commissar', 'moderator', null],
  admin:     ['moderator', null],
  commissar: ['moderator', null],
};

function canManage(actor: any, target: any, newRole: Role): boolean {
  if (!actor || !target) return false;
  if (actor.id === target.id) return false;               // себе роль не меняют
  if (isOwner(actor)) return true;                        // владелец — любые роли
  if (!ADMIN_POWERS_ENABLED) return false;
  // Мало быть старшим по званию — нужно ещё и выданное право «Роли».
  // Иначе арбитр без единой выданной возможности всё равно раздавал бы
  // должности, а мы договорились: роль сама по себе прав не даёт.
  if (!canAccessZone(actor, 'roles')) return false;
  const myRole = roleOf(actor);
  if (!myRole) return false;
  const allowed = CAN_ASSIGN[myRole];
  if (!allowed || allowed.indexOf(newRole) === -1) return false;
  // Нельзя трогать равных и старших
  return rankOf(roleOf(target)) < rankOf(myRole);
}

function setRole(actor: User, targetId: string, role: Role, notices: Notices) {
  const users = player.users();
  const target = users[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (role !== null && !['owner', 'arbiter', 'admin', 'commissar', 'moderator'].includes(String(role))) {
    throw new u.ApiError('Неизвестная роль');
  }
  if (actor.id === target.id) throw new u.ApiError('Нельзя менять роль самому себе');
  // Раздавать роли может тот, кому выдано право «Роли» и у кого есть
  // кто ниже по старшинству (см. CAN_ASSIGN)
  if (!isOwner(actor)) {
    if (!canAccessZone(actor, 'roles')) throw new u.ApiError('Нет права «Роли»');
    if (!CAN_ASSIGN[String(roleOf(actor))]) throw new u.ApiError('Недостаточно прав');
  }
  if (!canManage(actor, target, role)) {
    const myRole = roleOf(actor);
    const canList = (CAN_ASSIGN[String(myRole)] || []).filter(Boolean)
      .map((r) => ({ arbiter: 'арбитра', admin: 'администратора', commissar: 'комиссара', moderator: 'дозорного' } as any)[String(r)])
      .join(', ');
    throw new u.ApiError(canList
      ? `Вы можете назначать: ${canList} — и только тем, кто ниже вас по старшинству`
      : 'Недостаточно прав');
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
  assertCanWrite(user, 'global');
}

function chatBanInfo(user: any): { active: boolean; until: number; reason: string; byName: string; scopes: string[] } | null {
  const b = user && (user as any).chatBan;
  if (!b) return null;
  if (b.until && b.until <= Date.now()) return null;         // срок вышел
  // Старые блокировки без списка каналов закрывали общий чат и легион —
  // сохраняем это поведение, чтобы обновление не сняло действующие кляпы
  const scopes = Array.isArray(b.scopes) && b.scopes.length ? b.scopes : ['global', 'legion'];
  return { active: true, until: b.until, reason: b.reason || '', byName: b.byName || '', scopes };
}

// Закрыт ли игроку конкретный канал
function isChatBlocked(user: any, scope: string): boolean {
  const info = chatBanInfo(user);
  return !!info && info.scopes.includes(scope);
}

// Проверка перед отправкой в конкретный канал
function assertCanWrite(user: any, scope: string): void {
  const info = chatBanInfo(user);
  if (!info || !info.scopes.includes(scope)) return;
  const left = Math.max(1, Math.round((info.until - Date.now()) / 60000));
  const zone = CHAT_SCOPES.find((z) => z.id === scope);
  const openLeft = ALL_SCOPES.filter((sc) => !info.scopes.includes(sc))
    .map((sc) => (CHAT_SCOPES.find((z) => z.id === sc) || { name: sc }).name);
  throw new u.ApiError(
    `🔇 ${zone ? zone.name : 'Чат'} закрыт для вас ещё на ${humanMinutes(left)}. Причина: ${info.reason}` +
    (info.byName ? ` (Дозор: ${info.byName})` : '') +
    (openLeft.length ? `. Доступно: ${openLeft.join(', ')}.` : '.')
  );
}

function banChat(actor: User, targetId: string, minutes: number, reason: string, notices: Notices, scopeList?: string[], purge?: boolean) {
  if (!canAccessZone(actor, 'chat')) throw new u.ApiError('Нет права «Модерация чатов»');
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

  // Какие каналы закрываем. Пусто или 'all' — закрываем все.
  let scopes: string[] = Array.isArray(scopeList) ? scopeList.filter((x) => ALL_SCOPES.includes(x)) : [];
  if (!scopes.length) scopes = ALL_SCOPES.slice();

  (target as any).chatBan = {
    until: Date.now() + mins * 60 * 1000,
    minutes: mins,
    reason: why,
    scopes,
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
      `🔇 Закрыто на ${humanMinutes(mins)}: ${scopes.map((sc) => (CHAT_SCOPES.find((z) => z.id === sc) || { name: sc }).name).join(', ')}. Причина: ${why}`,
      { until: (target as any).chatBan.until });
  } catch (e) {}

  // По желанию модератора — вычищаем сообщения нарушителя из общего чата.
  // Личную переписку и чат легиона не трогаем: это закрытые каналы.
  let purged = 0;
  if (purge) {
    try { purged = require('./social').purgeChatMessages(target.id, actor.name); } catch (e) {}
  }

  const scopeNames = scopes.map((sc) => (CHAT_SCOPES.find((z) => z.id === sc) || { name: sc }).name).join(', ');
  notices.push(`🔇 Игроку «${target.name}» закрыто на ${humanMinutes(mins)}: ${scopeNames}. Причина: ${why}` +
               (purged ? ` Удалено сообщений в общем чате: ${purged}.` : ''));
  return { id: target.id, name: target.name, until: (target as any).chatBan.until,
           minutes: mins, reason: why, scopes, scopeNames, purged };
}

function unbanChat(actor: User, targetId: string, notices: Notices) {
  if (!canAccessZone(actor, 'chat')) throw new u.ApiError('Нет права «Модерация чатов»');
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

// ---------- Бан аккаунта силами модератора ----------
// У модератора нет доступа к админ-панели, но закрывать вход нарушителю
// он должен уметь — иначе на грубое нарушение он может ответить только
// кляпом. Ограничения ниже отличают его от администратора.
const MOD_MAX_BAN_MINUTES = 7 * 24 * 60;      // модератор банит максимум на 7 суток

function banAccount(actor: User, targetId: string, minutes: number, reason: string, notices: Notices) {
  // Блокировка АККАУНТА — мера администрации. Роль «Дозор» не получает её
  // НИ ПРИ КАКИХ настройках: даже если владелец по ошибке откроет ей зону
  // «Модерация» в настройке возможностей ролей. Инструмент модератора —
  // чаты; закрыть человеку вход в игру он не может.
  // Право определяется выданной зоной, а не ролью: владелец сам решает,
  // кому доверить блокировку входа в игру.
  if (!canAccessZone(actor, 'moderation')) {
    throw new u.ApiError('Нет права «Баны аккаунтов». Обратитесь к владельцу проекта.');
  }
  const users = player.users();
  const target = users[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.id === actor.id) throw new u.ApiError('Нельзя забанить самого себя');
  const targetRole = roleOf(target);
  if (targetRole === 'owner') throw new u.ApiError('Нельзя забанить владельца проекта');
  if (targetRole && !isOwner(actor)) throw new u.ApiError('Нельзя забанить сотрудника проекта');

  const why = String(reason || '').trim().slice(0, 200);
  if (!why) throw new u.ApiError('Укажите причину бана');

  let mins = u.toInt(minutes, 0);
  mins = mins > 0 ? u.clamp(mins, 1, 365 * 24 * 60) : 0;   // 0 — бессрочно

  (target as any).banned = true;
  (target as any).banReason = why;
  (target as any).bannedAt = Date.now();
  (target as any).banUntil = mins > 0 ? Date.now() + mins * 60 * 1000 : 0;
  (target as any).banByName = actor.name;
  db.markUser(target.id);
  db.save('users');

  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/mod/ban',
    body: { targetId: target.id, targetName: target.name, minutes: mins, reason: why },
  });
  notices.push(`🚫 Аккаунт «${target.name}» заблокирован ${mins ? 'на ' + humanMinutes(mins) : 'бессрочно'}. Причина: ${why}`);
  return { id: target.id, name: target.name, until: (target as any).banUntil, minutes: mins, reason: why };
}

function unbanAccount(actor: User, targetId: string, notices: Notices) {
  if (!canAccessZone(actor, 'moderation')) {
    throw new u.ApiError('Нет права «Баны аккаунтов»');
  }
  const users = player.users();
  const target = users[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (!(target as any).banned) throw new u.ApiError('Этот аккаунт не заблокирован');
  (target as any).banned = false;
  (target as any).banUntil = 0;
  (target as any).banReason = '';
  (target as any).banByName = '';
  db.markUser(target.id);
  db.save('users');
  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/mod/unban',
    body: { targetId: target.id, targetName: target.name },
  });
  notices.push(`✅ Блокировка аккаунта «${target.name}» снята`);
  return { id: target.id, name: target.name };
}

// Сведения о бане аккаунта — для плашки в профиле
function accountBanInfo(user: any): any | null {
  if (!user || !user.banned) return null;
  if (user.banUntil && user.banUntil <= Date.now()) return null;   // срок вышел
  return {
    reason: user.banReason || 'Нарушение правил',
    until: user.banUntil || 0,
    byName: user.banByName || '',
    at: user.bannedAt || 0,
  };
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
      scopes: info.scopes,
      scopeNames: info.scopes.map((sc: string) => (CHAT_SCOPES.find((z) => z.id === sc) || { name: sc }).name).join(', '),
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
  roleOf, isOwner, isAdmin, isModerator, roleLabel, roleTag, adminPowersEnabled, rankOf, CAN_ASSIGN,
  zoneOfPath, canAccessZone, zonesFor, zonesOfRole,
  permissionsView, setRoleZone, resetRoleZones, ZONE_INFO, ALL_ZONES, DEFAULT_ZONES, OWNER_ONLY_ZONES,
  setRole, staffList, canManage,
  banChat, unbanChat, chatBanInfo, bannedList, humanMinutes, assertCanWritePublic,
  banAccount, unbanAccount, accountBanInfo, MOD_MAX_BAN_MINUTES,
  assertCanWrite, isChatBlocked, CHAT_SCOPES, ALL_SCOPES,
  MAX_BAN_MINUTES,
};
