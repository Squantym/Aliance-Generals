// ═══════════════════════════════════════════════════════════════════
// src/services/forum.ts — форум игры
//
// Темы создают все игроки. Темы сотрудников проекта всегда идут первыми
// и выделяются в списке — так объявления не теряются среди обсуждений.
//
// Права модерации выдаёт владелец (зона 'forum'):
//   • закрывать темы для дальнейшего обсуждения
//   • удалять чужие темы и комментарии
// Наказания игрокам (зона 'chat', как и блокировка чатов):
//   • forumWrite  — запрет писать комментарии
//   • forumTopic  — запрет создавать темы
//   • forumRead   — запрет заходить на форум вовсе
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

const PAGE_SIZE = 15;            // тем на странице
const MAX_TITLE = 100;
const MAX_TEXT = 4000;
const MAX_COMMENT = 1500;
const MIN_INTERVAL_MS = 30 * 1000;   // не чаще одной темы в 30 секунд

type Topic = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string | null;      // роль на момент создания
  staff: boolean;                 // тема сотрудника — всегда сверху
  title: string;
  text: string;
  image: string | null;           // адрес картинки
  at: number;
  updatedAt: number;
  closed: boolean;
  closedBy: string;
  pinned: boolean;
  comments: Array<{
    id: string; userId: string; userName: string; role: string | null;
    text: string; at: number; deleted?: boolean; deletedBy?: string;
  }>;
  deleted?: boolean;
  deletedBy?: string;
  views: number;
};

function store(): Record<string, Topic> {
  return db.load<Record<string, Topic>>('forum', {});
}

function roles() { return require('./roles'); }

// ---------- Наказания на форуме ----------
// Хранятся рядом с блокировкой чата: это та же мера, только для форума
function forumBan(user: any): any | null {
  const b = user && user.forumBan;
  if (!b) return null;
  if (b.until && b.until <= Date.now()) return null;
  return b;
}

function canRead(user: any): boolean {
  const b = forumBan(user);
  return !(b && b.scopes && b.scopes.includes('read'));
}
function canWrite(user: any): boolean {
  const b = forumBan(user);
  return !(b && b.scopes && b.scopes.includes('write'));
}
function canCreateTopic(user: any): boolean {
  const b = forumBan(user);
  return !(b && b.scopes && (b.scopes.includes('topic') || b.scopes.includes('write')));
}

function assertRead(user: any): void {
  if (canRead(user)) return;
  const b = forumBan(user);
  const left = Math.max(1, Math.round((b.until - Date.now()) / 60000));
  throw new u.ApiError(`🚫 Доступ к форуму закрыт ещё на ${roles().humanMinutes(left)}. Причина: ${b.reason || 'нарушение правил'}`);
}

// Может ли пользователь модерировать форум
function isForumMod(user: any): boolean {
  return roles().canAccessZone(user, 'forum');
}

// ---------- Список тем ----------
// Темы сотрудников всегда впереди — независимо от давности. Внутри
// каждой группы новые выше старых.
function list(viewer: User, page?: number) {
  assertRead(viewer);
  const all = Object.values(store()).filter((t) => !t.deleted);
  all.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.staff !== b.staff) return a.staff ? -1 : 1;
    // При равном времени (темы созданы в одну миллисекунду) порядок
    // определяем по идентификатору — иначе список «дрожал» бы между
    // обновлениями страницы
    if (b.at !== a.at) return b.at - a.at;
    return a.id < b.id ? 1 : -1;
  });

  const pageNum = Math.max(1, u.toInt(page, 1));
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const start = (Math.min(pageNum, pages) - 1) * PAGE_SIZE;
  const slice = all.slice(start, start + PAGE_SIZE);

  return {
    page: Math.min(pageNum, pages),
    pages,
    total: all.length,
    canModerate: isForumMod(viewer),
    canCreate: canCreateTopic(viewer),
    canWrite: canWrite(viewer),
    myBan: forumBan(viewer),
    topics: slice.map((t) => ({
      id: t.id,
      title: t.title,
      authorName: t.authorName,
      authorId: t.authorId,
      authorRole: t.authorRole,
      authorVip: (() => { try { return require('./vip').isVip(player.users()[t.authorId]); } catch (e) { return false; } })(),
      staff: t.staff,
      at: t.at,
      updatedAt: t.updatedAt,
      closed: t.closed,
      pinned: t.pinned,
      comments: (t.comments || []).filter((c) => !c.deleted).length,
      hasImage: !!t.image,
      views: t.views || 0,
      preview: String(t.text || '').slice(0, 140),
    })),
  };
}

// ---------- Одна тема ----------
function view(viewer: User, topicId: string) {
  assertRead(viewer);
  const t = store()[topicId];
  if (!t || t.deleted) throw new u.ApiError('Тема не найдена');
  t.views = (t.views || 0) + 1;
  db.save('forum');
  const seesDeleted = roles().isAdmin(viewer);
  return {
    id: t.id, title: t.title, text: t.text, image: t.image,
    authorId: t.authorId, authorName: t.authorName, authorRole: t.authorRole,
    staff: t.staff, at: t.at, closed: t.closed, closedBy: t.closedBy,
    pinned: t.pinned, views: t.views,
    canModerate: isForumMod(viewer),
    canComment: !t.closed && canWrite(viewer),
    isAuthor: t.authorId === viewer.id,
    comments: (t.comments || [])
      .filter((c) => seesDeleted || !c.deleted)
      .map((c) => ({
        id: c.id, userId: c.userId, userName: c.userName, role: c.role,
        text: c.deleted && !seesDeleted ? 'Комментарий удалён' : c.text,
        at: c.at, deleted: !!c.deleted, deletedBy: seesDeleted ? (c.deletedBy || '') : '',
        mine: c.userId === viewer.id,
      })),
  };
}

// ---------- Создание темы ----------
function createTopic(user: User, title: string, text: string, image: string | null, notices: Notices) {
  assertRead(user);
  if (!canCreateTopic(user)) {
    const b = forumBan(user);
    const left = b ? Math.max(1, Math.round((b.until - Date.now()) / 60000)) : 0;
    throw new u.ApiError(`🚫 Вам закрыто создание тем${left ? ` ещё на ${roles().humanMinutes(left)}` : ''}. Причина: ${(b && b.reason) || 'нарушение правил'}`);
  }
  const ttl = String(title || '').trim().slice(0, MAX_TITLE);
  const txt = String(text || '').trim().slice(0, MAX_TEXT);
  if (ttl.length < 3) throw new u.ApiError('Название темы: минимум 3 символа');
  if (!txt && !image) throw new u.ApiError('Напишите текст или прикрепите изображение');

  // Антифлуд: одна тема в полминуты
  const lastAt = (user as any).lastForumTopicAt || 0;
  if (Date.now() - lastAt < MIN_INTERVAL_MS) {
    throw new u.ApiError('Не так быстро — новую тему можно создать через полминуты');
  }

  const role = roles().roleOf(user);
  const id = u.uid(10);
  const now = Date.now();
  store()[id] = {
    id, authorId: user.id, authorName: user.name, authorRole: role,
    staff: !!role,                       // тема сотрудника всегда сверху
    title: ttl, text: txt, image: image || null,
    at: now, updatedAt: now, closed: false, closedBy: '', pinned: false,
    comments: [], views: 0,
  };
  (user as any).lastForumTopicAt = now;
  db.markUser(user.id);
  db.save('forum');
  auditLog.record({ userId: user.id, userName: user.name, path: '/api/forum/topic', body: { id, title: ttl } });
  notices.push(`📝 Тема «${ttl}» создана`);
  return { id };
}

// ---------- Комментарии ----------
function addComment(user: User, topicId: string, text: string, notices: Notices) {
  assertRead(user);
  const t = store()[topicId];
  if (!t || t.deleted) throw new u.ApiError('Тема не найдена');
  if (t.closed) throw new u.ApiError('Тема закрыта для обсуждения');
  if (!canWrite(user)) {
    const b = forumBan(user);
    const left = b ? Math.max(1, Math.round((b.until - Date.now()) / 60000)) : 0;
    throw new u.ApiError(`🚫 Вам закрыто обсуждение${left ? ` ещё на ${roles().humanMinutes(left)}` : ''}. Причина: ${(b && b.reason) || 'нарушение правил'}`);
  }
  const txt = String(text || '').trim().slice(0, MAX_COMMENT);
  if (!txt) throw new u.ApiError('Пустой комментарий');
  // Антифлуд общий с чатом
  const now = Date.now();
  if ((user as any).lastForumCommentAt && now - (user as any).lastForumCommentAt < 5000) {
    throw new u.ApiError('Не так быстро, боец');
  }
  (user as any).lastForumCommentAt = now;
  db.markUser(user.id);

  t.comments = t.comments || [];
  t.comments.push({
    id: u.uid(8), userId: user.id, userName: user.name,
    role: roles().roleOf(user), text: txt, at: now,
  });
  if (t.comments.length > 500) t.comments = t.comments.slice(-500);
  t.updatedAt = now;
  db.save('forum');
  return view(user, topicId);
}

// ---------- Модерация ----------
function setClosed(actor: User, topicId: string, closed: boolean, notices: Notices) {
  const t = store()[topicId];
  if (!t || t.deleted) throw new u.ApiError('Тема не найдена');
  // Автор может закрыть свою тему; чужую — только модератор форума
  const own = t.authorId === actor.id;
  if (!own && !isForumMod(actor)) throw new u.ApiError('Нет права модерировать форум');
  t.closed = !!closed;
  t.closedBy = closed ? actor.name : '';
  db.save('forum');
  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/forum/close',
    body: { topicId, title: t.title, closed: !!closed },
  });
  notices.push(closed ? `🔒 Тема «${t.title}» закрыта для обсуждения` : `🔓 Тема «${t.title}» открыта`);
  return { ok: true };
}

function setPinned(actor: User, topicId: string, pinned: boolean, notices: Notices) {
  if (!isForumMod(actor)) throw new u.ApiError('Нет права модерировать форум');
  const t = store()[topicId];
  if (!t || t.deleted) throw new u.ApiError('Тема не найдена');
  t.pinned = !!pinned;
  db.save('forum');
  notices.push(pinned ? `📌 Тема «${t.title}» закреплена` : `Тема «${t.title}» откреплена`);
  return { ok: true };
}

function deleteTopic(actor: User, topicId: string, notices: Notices) {
  const t = store()[topicId];
  if (!t || t.deleted) throw new u.ApiError('Тема не найдена');
  const own = t.authorId === actor.id;
  if (!own && !isForumMod(actor)) throw new u.ApiError('Нет права модерировать форум');
  t.deleted = true;
  t.deletedBy = actor.name;
  db.save('forum');
  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/forum/delete',
    body: { topicId, title: t.title },
  });
  notices.push(`🗑 Тема «${t.title}» удалена`);
  return { ok: true };
}

function deleteComment(actor: User, topicId: string, commentId: string, notices: Notices) {
  const t = store()[topicId];
  if (!t || t.deleted) throw new u.ApiError('Тема не найдена');
  const c = (t.comments || []).find((x) => x.id === commentId);
  if (!c) throw new u.ApiError('Комментарий не найден');
  const own = c.userId === actor.id;
  if (!own && !isForumMod(actor)) throw new u.ApiError('Нет права модерировать форум');
  c.deleted = true;
  c.deletedBy = actor.name;
  db.save('forum');
  notices.push('🗑 Комментарий удалён');
  return view(actor, topicId);
}

// ---------- Наказания на форуме ----------
const FORUM_SCOPES = [
  { id: 'write', name: 'Комментарии',   note: 'не сможет писать в темах' },
  { id: 'topic', name: 'Создание тем',  note: 'не сможет создавать новые темы' },
  { id: 'read',  name: 'Доступ к форуму', note: 'не сможет даже открыть форум' },
];

function banForum(actor: User, targetId: string, minutes: number, reason: string, scopeList: string[], notices: Notices) {
  // Право то же, что и на блокировку чатов
  if (!roles().canAccessZone(actor, 'chat')) throw new u.ApiError('Нет права «Модерация чатов»');
  const users = player.users();
  const target = users[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.id === actor.id) throw new u.ApiError('Нельзя закрыть форум самому себе');
  const targetRole = roles().roleOf(target);
  if (targetRole === 'owner') throw new u.ApiError('Нельзя ограничить владельца проекта');
  if (targetRole && !roles().isOwner(actor)) throw new u.ApiError('Нельзя ограничить сотрудника проекта');

  const why = String(reason || '').trim().slice(0, 200);
  if (!why) throw new u.ApiError('Укажите причину');
  const mins = u.clamp(u.toInt(minutes, 0), 1, 30 * 24 * 60);
  let scopes = Array.isArray(scopeList) ? scopeList.filter((x) => FORUM_SCOPES.some((s) => s.id === x)) : [];
  if (!scopes.length) scopes = ['write'];

  (target as any).forumBan = {
    until: Date.now() + mins * 60 * 1000,
    reason: why, scopes, byId: actor.id, byName: actor.name, at: Date.now(),
  };
  db.markUser(target.id);
  db.save('users');
  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/forum/ban',
    body: { targetId: target.id, targetName: target.name, minutes: mins, reason: why, scopes },
  });
  const names = scopes.map((sc) => (FORUM_SCOPES.find((s) => s.id === sc) || { name: sc }).name).join(', ');
  notices.push(`🚫 Игроку «${target.name}» закрыто на форуме: ${names} (${roles().humanMinutes(mins)}). Причина: ${why}`);
  return { id: target.id, name: target.name, scopes, minutes: mins };
}

function unbanForum(actor: User, targetId: string, notices: Notices) {
  if (!roles().canAccessZone(actor, 'chat')) throw new u.ApiError('Нет права «Модерация чатов»');
  const target = player.users()[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (!(target as any).forumBan) throw new u.ApiError('Ограничений на форуме нет');
  (target as any).forumBan = null;
  db.markUser(target.id);
  db.save('users');
  notices.push(`✅ Ограничения на форуме сняты с игрока «${target.name}»`);
  return { ok: true };
}

export = {
  list, view, createTopic, addComment,
  setClosed, setPinned, deleteTopic, deleteComment,
  banForum, unbanForum, forumBan, canRead, canWrite, canCreateTopic, isForumMod,
  FORUM_SCOPES, PAGE_SIZE, MAX_TITLE, MAX_TEXT, MAX_COMMENT,
};
