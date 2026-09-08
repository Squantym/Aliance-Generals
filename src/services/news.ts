// ===================================================================
// src/services/news.ts — раздел «Новости» (объявления/обновления).
// Пост состоит из БЛОКОВ (heading/text/image/callout/quote/list/divider/
// button/badge/spacer). Блочная структура — безопасна (никакого сырого
// HTML) и даёт гибкое оформление. Управление — только у администратора.
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import type { User, Notices } from '../types';

interface NewsBlock { type: string; [k: string]: any; }
interface NewsPost {
  id: string;
  title: string;
  emoji: string;
  tag: string;
  blocks: NewsBlock[];
  authorId: string;
  authorName: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}

function store(): Record<string, NewsPost> { return db.load('news', {}); }

// Разрешённые типы блоков и их «очистка» (обрезка строк, дефолты).
const BLOCK_TYPES = ['heading', 'text', 'image', 'callout', 'quote', 'list', 'divider', 'button', 'badge', 'spacer'];
const CALLOUT_COLORS = ['gold', 'green', 'red', 'blue', 'gray'];
const BADGE_COLORS = ['gold', 'green', 'red', 'blue', 'gray'];

function s(v: any, max: number): string { return String(v == null ? '' : v).slice(0, max); }

// Санитизация одного блока: оставляем только известные поля с лимитами длины.
function cleanBlock(b: any): NewsBlock | null {
  if (!b || typeof b !== 'object' || BLOCK_TYPES.indexOf(b.type) === -1) return null;
  switch (b.type) {
    case 'heading':
      return { type: 'heading', text: s(b.text, 200), level: [1, 2, 3].indexOf(b.level) >= 0 ? b.level : 2 };
    case 'text':
      return { type: 'text', text: s(b.text, 4000) };
    case 'callout':
      return { type: 'callout', text: s(b.text, 2000), color: CALLOUT_COLORS.indexOf(b.color) >= 0 ? b.color : 'gold' };
    case 'quote':
      return { type: 'quote', text: s(b.text, 2000) };
    case 'image':
      return { type: 'image', url: s(b.url, 1000), caption: s(b.caption, 300) };
    case 'list':
      return { type: 'list', ordered: !!b.ordered, items: (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((x: any) => s(x, 500)).filter((x: string) => x) };
    case 'button':
      return { type: 'button', text: s(b.text, 120) || 'Открыть', action: s(b.action, 500) };
    case 'badge':
      return { type: 'badge', text: s(b.text, 80), color: BADGE_COLORS.indexOf(b.color) >= 0 ? b.color : 'gold' };
    case 'divider':
      return { type: 'divider' };
    case 'spacer':
      return { type: 'spacer' };
  }
  return null;
}

function cleanBlocks(blocks: any): NewsBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.map(cleanBlock).filter(Boolean).slice(0, 100) as NewsBlock[];
}

// Право управлять новостями даёт ЗОНА «Новости», а не старое поле
// isAdmin. Сотрудник с ролью и выданным разделом получал отказ именно
// здесь: роль лежит в user.role, а флага isAdmin у него нет.
function requireAdmin(user: User): void {
  require('./roles').assertZone(user, 'news', 'управление новостями');
}

// ── Список постов (для всех): закреплённые сверху, затем свежие ──
function list(user: User): any {
  const all = store();
  const posts = Object.values(all)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt - a.createdAt)
    .map((p) => ({
      id: p.id, title: p.title, emoji: p.emoji, tag: p.tag,
      blocks: p.blocks, authorName: p.authorName,
      createdAt: p.createdAt, updatedAt: p.updatedAt, pinned: !!p.pinned,
    }));
  // Кнопки редактирования показываем по той же зоне, по которой
  // пропускаем действие: иначе кнопка есть, а нажатие даёт отказ.
  const canManage = (() => {
    try { return require('./roles').canAccessZone(user, 'news'); } catch (e) { return false; }
  })();
  return { posts, canManage };
}

// ── Полоса закреплённой новости (для всех экранов) ───────────────
// Закрепили новость — игрок видит её строкой над игрой, пока не
// закроет крестиком. Закрытие адресное: у каждой новости свой id, и
// следующее объявление снова покажется всем. Иначе первый же закрытый
// баннер выключил бы этот способ докричаться до игроков навсегда.
function banner(user: User): any {
  const hidden: string[] = Array.isArray((user as any).newsHidden) ? (user as any).newsHidden : [];
  const pinned = Object.values(store())
    .filter((p) => p.pinned && hidden.indexOf(p.id) === -1)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!pinned) return null;
  return { id: pinned.id, title: pinned.title, emoji: pinned.emoji || '📰', tag: pinned.tag || '' };
}

// Игрок закрыл полосу: помним ровно id, а не «выключено вообще».
// Список подрезаем — он растёт по одной строке на объявление и не
// должен превращаться в вечный хвост в карточке игрока.
function hideBanner(user: User, id: string): any {
  const pid = String(id || '').trim();
  if (!pid || !store()[pid]) throw new u.ApiError('Новость не найдена');
  const hidden: string[] = Array.isArray((user as any).newsHidden) ? (user as any).newsHidden : [];
  if (hidden.indexOf(pid) === -1) hidden.push(pid);
  (user as any).newsHidden = hidden.slice(-30);
  db.markUser(user.id);
  return { ok: true };
}

// ── Один пост ──
function get(id: string): any {
  const p = store()[id];
  if (!p) throw new u.ApiError('Новость не найдена');
  return p;
}

// ── АДМИН: создать пост ──
function create(user: User, data: any, notices: Notices): any {
  requireAdmin(user);
  const title = s(data && data.title, 200).trim();
  if (!title) throw new u.ApiError('Введите заголовок');
  const blocks = cleanBlocks(data && data.blocks);
  if (blocks.length === 0) throw new u.ApiError('Добавьте хотя бы один блок содержимого');
  const all = store();
  const id = u.uid(12);
  const nowMs = Date.now();
  all[id] = {
    id, title, emoji: s(data.emoji, 8) || '📰', tag: s(data.tag, 40),
    blocks, authorId: user.id, authorName: user.name,
    createdAt: nowMs, updatedAt: nowMs, pinned: !!(data && data.pinned),
  };
  db.save('news');
  notices.push('📰 Новость опубликована!');
  return { id, post: all[id] };
}

// ── АДМИН: изменить пост ──
function update(user: User, id: string, data: any, notices: Notices): any {
  requireAdmin(user);
  const all = store();
  const p = all[id];
  if (!p) throw new u.ApiError('Новость не найдена');
  if (data.title !== undefined) { const t = s(data.title, 200).trim(); if (!t) throw new u.ApiError('Заголовок не может быть пустым'); p.title = t; }
  if (data.emoji !== undefined) p.emoji = s(data.emoji, 8) || '📰';
  if (data.tag !== undefined) p.tag = s(data.tag, 40);
  if (data.blocks !== undefined) { const bl = cleanBlocks(data.blocks); if (bl.length === 0) throw new u.ApiError('Добавьте хотя бы один блок'); p.blocks = bl; }
  if (data.pinned !== undefined) p.pinned = !!data.pinned;
  p.updatedAt = Date.now();
  db.save('news');
  notices.push('✏️ Новость обновлена.');
  return { id, post: p };
}

// ── АДМИН: удалить пост ──
function remove(user: User, id: string, notices: Notices): any {
  requireAdmin(user);
  const all = store();
  if (!all[id]) throw new u.ApiError('Новость не найдена');
  delete all[id];
  db.save('news');
  notices.push('🗑 Новость удалена.');
  return { ok: true };
}

// ── АДМИН: закрепить/открепить ──
function togglePin(user: User, id: string, notices: Notices): any {
  requireAdmin(user);
  const all = store();
  const p = all[id];
  if (!p) throw new u.ApiError('Новость не найдена');
  p.pinned = !p.pinned;
  db.save('news');
  notices.push(p.pinned ? '📌 Закреплено.' : 'Откреплено.');
  return { id, pinned: p.pinned };
}

export = { list, get, create, update, remove, togglePin, banner, hideBanner };
