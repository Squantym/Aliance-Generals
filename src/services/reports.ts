// ═══════════════════════════════════════════════════════════════════
// src/services/reports.ts — жалобы игроков друг на друга
//
// ЗАЧЕМ: до этого пожаловаться можно было только через поддержку —
// написать обращение, самому вспомнить позывной обидчика и объяснить,
// что случилось. Люди этого не делают: нарушения оставались невидимыми,
// а сотрудники узнавали о них случайно.
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ ПОДДЕРЖКИ: обращение — это диалог по личному
// вопросу игрока. Жалоба — сигнал о ДРУГОМ игроке, и её ценность в
// накоплении: одна жалоба ничего не значит, пять на одного человека за
// день — уже повод посмотреть. Поэтому здесь очередь сгруппирована по
// нарушителю, а не по обращению.
//
// ЗАЩИТА ОТ ЗЛОУПОТРЕБЛЕНИЯ (жалоба — тоже оружие):
//   • не больше DAY_LIMIT жалоб в сутки с одного аккаунта;
//   • повторно на того же человека — не чаще, чем раз в COOLDOWN;
//   • на себя пожаловаться нельзя;
//   • у каждого жалобщика виден счётчик отклонённых жалоб — сотрудник
//     сразу видит, что человек ходит по кругу и жалуется на всех.
//
// НИКАКИХ АВТОМАТИЧЕСКИХ САНКЦИЙ: сколько бы жалоб ни накопилось,
// система только показывает. Наказание выдаёт человек — иначе группа
// друзей сможет забанить кого угодно скоординированными жалобами.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import notifications = require('./notifications');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

interface Report {
  id: string;
  at: number;
  fromId: string;
  fromName: string;
  targetId: string;
  targetName: string;
  reason: string;
  text: string;
  where: string;              // откуда пожаловались: профиль, чат, форум, бой
  status: 'new' | 'accepted' | 'rejected';
  handledBy?: string;
  handledAt?: number;
  verdict?: string;
}

// Причины жалобы. Единый список: и для кнопки у игрока, и для фильтра
// в панели. id короткие — они уходят в базу, label читает человек.
const REASONS = [
  { id: 'cheat',  label: 'Читы или накрутка',        icon: '🚫' },
  { id: 'insult', label: 'Оскорбления, мат, угрозы', icon: '🤬' },
  { id: 'spam',   label: 'Спам или реклама',         icon: '📢' },
  { id: 'nick',   label: 'Недопустимый позывной',    icon: '🏷' },
  { id: 'multi',  label: 'Несколько аккаунтов',      icon: '👥' },
  { id: 'other',  label: 'Другое',                   icon: '💬' },
];
const REASON_IDS = REASONS.map((r) => r.id);
const REASON_LABEL: Record<string, string> = Object.fromEntries(REASONS.map((r) => [r.id, r.label]));

// Откуда пришла жалоба — сотруднику это подсказывает, где искать
const PLACES: Record<string, string> = {
  profile: 'из профиля',
  chat: 'из чата',
  forum: 'с форума',
  battle: 'из боя',
  mail: 'из переписки',
};

const DAY_LIMIT = 5;                     // жалоб в сутки с одного аккаунта
const COOLDOWN = 12 * 3600 * 1000;       // повтор на того же — не раньше
const MAX_TEXT = 500;
const KEEP = 3000;                       // сколько жалоб держим всего
const MIN_LEVEL = 3;                     // ниже — свежесозданные пустышки

function store(): Record<string, Report> {
  return db.load<Record<string, Report>>('reports', {});
}

function normReason(r: any): string {
  const s = String(r || '').trim();
  return REASON_IDS.includes(s) ? s : 'other';
}

// ── Игрок: пожаловаться ───────────────────────────────────────────
function create(user: User, targetId: string, reason: string, text: string,
                where: string, notices: Notices) {
  const all = store();
  const now = Date.now();

  if (!targetId || targetId === user.id) throw new u.ApiError('На себя пожаловаться нельзя');
  if ((user.level || 1) < MIN_LEVEL) {
    throw new u.ApiError(`Жалобы доступны с ${MIN_LEVEL} уровня — так отсекаются одноразовые аккаунты`);
  }
  const target = player.users()[targetId];
  if (!target) throw new u.ApiError('Игрок не найден');

  const mine = Object.values(all).filter((r) => r.fromId === user.id);
  const today = mine.filter((r) => now - r.at < 24 * 3600 * 1000);
  if (today.length >= DAY_LIMIT) {
    throw new u.ApiError(`Не больше ${DAY_LIMIT} жалоб в сутки. Это не ограничение справедливости, ` +
      'а защита от заваливания панели: сотрудники должны успевать разбирать.');
  }
  const same = mine.filter((r) => r.targetId === targetId).sort((a, b) => b.at - a.at)[0];
  if (same && now - same.at < COOLDOWN) {
    const h = Math.ceil((COOLDOWN - (now - same.at)) / 3600000);
    throw new u.ApiError(`Вы уже жаловались на этого игрока. Повторно можно через ${h} ч — ` +
      'прошлая жалоба ещё в очереди.');
  }

  const body = String(text || '').trim().slice(0, MAX_TEXT);
  if (body.length < 10) throw new u.ApiError('Опишите, что произошло: хотя бы 10 символов');

  const id = 'rp' + now.toString(36) + Math.random().toString(36).slice(2, 6);
  all[id] = {
    id, at: now,
    fromId: user.id, fromName: user.name,
    targetId, targetName: target.name,
    reason: normReason(reason), text: body,
    where: PLACES[String(where)] ? String(where) : 'profile',
    status: 'new',
  };
  prune(all);
  db.save('reports');
  notices.push('📨 Жалоба отправлена. Её посмотрит сотрудник — ответ придёт в уведомления.');
  return { ok: true, left: DAY_LIMIT - today.length - 1 };
}

// Старые разобранные жалобы вытесняем, новые не трогаем никогда:
// очередь не должна «худеть» сама по себе.
function prune(all: Record<string, Report>): void {
  const ids = Object.keys(all);
  if (ids.length <= KEEP) return;
  const handled = ids.filter((id) => all[id].status !== 'new')
    .sort((a, b) => (all[a].handledAt || all[a].at) - (all[b].handledAt || all[b].at));
  for (const id of handled) {
    if (Object.keys(all).length <= KEEP) break;
    delete all[id];
  }
}

// ── Игрок: свои жалобы и остаток на сутки ─────────────────────────
function mine(user: User) {
  const now = Date.now();
  const list = Object.values(store()).filter((r) => r.fromId === user.id)
    .sort((a, b) => b.at - a.at).slice(0, 30);
  const today = list.filter((r) => now - r.at < 24 * 3600 * 1000).length;
  return {
    left: Math.max(0, DAY_LIMIT - today),
    dayLimit: DAY_LIMIT,
    reasons: REASONS,
    list: list.map((r) => ({
      id: r.id, at: r.at, targetName: r.targetName,
      reason: REASON_LABEL[r.reason] || r.reason,
      status: r.status, verdict: r.verdict || '',
    })),
  };
}

// ── Панель: очередь, сгруппированная по нарушителю ────────────────
// Одна жалоба — шум. Пять от разных людей за день — сигнал. Поэтому
// сортируем по числу РАЗНЫХ жалобщиков, а не по времени.
function queue(status = 'new', limit = 60) {
  const all = Object.values(store());
  const picked = all.filter((r) => (status === 'all' ? true : r.status === status));
  const byTarget: Record<string, any> = {};
  for (const r of picked) {
    const g = byTarget[r.targetId] || (byTarget[r.targetId] = {
      targetId: r.targetId, targetName: r.targetName, reports: [], reporters: new Set<string>(),
    });
    g.reports.push(r);
    g.reporters.add(r.fromId);
  }
  const users = player.users();
  const groups = Object.values(byTarget).map((g: any) => {
    const t = users[g.targetId] || {};
    return {
      targetId: g.targetId, targetName: g.targetName,
      exists: !!users[g.targetId],
      banned: !!t.banned,
      level: t.level || 0,
      total: g.reports.length,
      uniqueReporters: g.reporters.size,
      lastAt: Math.max(...g.reports.map((r: Report) => r.at)),
      reports: g.reports.sort((a: Report, b: Report) => b.at - a.at).map((r: Report) => ({
        id: r.id, at: r.at, fromId: r.fromId, fromName: r.fromName,
        reason: REASON_LABEL[r.reason] || r.reason, reasonId: r.reason,
        text: r.text, where: PLACES[r.where] || r.where,
        status: r.status, verdict: r.verdict || '', handledBy: r.handledBy || '',
        // Репутация жалобщика: сколько его жалоб уже отклонили. Высокое
        // число означает, что человек жалуется на всех подряд.
        rejectedByAuthor: all.filter((x) => x.fromId === r.fromId && x.status === 'rejected').length,
      })),
    };
  });
  groups.sort((a, b) => (b.uniqueReporters - a.uniqueReporters) || (b.lastAt - a.lastAt));
  return {
    groups: groups.slice(0, limit),
    counts: {
      new: all.filter((r) => r.status === 'new').length,
      accepted: all.filter((r) => r.status === 'accepted').length,
      rejected: all.filter((r) => r.status === 'rejected').length,
      total: all.length,
    },
    reasons: REASONS,
  };
}

// ── Панель: решение по жалобе ─────────────────────────────────────
// accept — жалоба обоснована (наказание выдаётся отдельно, вручную),
// reject — жалоба не подтвердилась. И то и другое сообщаем жалобщику:
// молчание в ответ на жалобу — верный способ отучить людей жаловаться.
function resolve(actor: User, reportId: string, accept: boolean, verdict: string, notices: Notices) {
  const all = store();
  const r = all[String(reportId)];
  if (!r) throw new u.ApiError('Жалоба не найдена');
  if (r.status !== 'new') throw new u.ApiError('По этой жалобе уже есть решение');

  r.status = accept ? 'accepted' : 'rejected';
  r.handledBy = actor.name;
  r.handledAt = Date.now();
  r.verdict = String(verdict || '').trim().slice(0, 300);
  db.save('reports');

  notifications.push(r.fromId, 'report',
    accept ? '✅ Ваша жалоба подтвердилась' : '📭 Жалоба не подтвердилась',
    { text: (accept
        ? `Жалоба на «${r.targetName}» рассмотрена, меры приняты.`
        : `Жалоба на «${r.targetName}» рассмотрена — нарушения не нашли.`) +
        (r.verdict ? ` Комментарий: ${r.verdict}` : '') });

  auditLog.record({
    user: actor, userId: actor.id, userName: actor.name,
    path: `/api/mod/report/${accept ? 'accept' : 'reject'}`,
    desc: `${accept ? '✅ Подтвердил' : '📭 Отклонил'} жалобу на «${r.targetName}» от «${r.fromName}»`,
  });
  notices.push(accept ? '✅ Жалоба подтверждена' : '📭 Жалоба отклонена');
  return { ok: true };
}

// Разобрать все жалобы на одного игрока сразу — очередь чистится за
// один клик, а не по одной строке
function resolveAll(actor: User, targetId: string, accept: boolean, verdict: string, notices: Notices) {
  const all = store();
  const ids = Object.values(all).filter((r) => r.targetId === targetId && r.status === 'new').map((r) => r.id);
  if (!ids.length) throw new u.ApiError('Новых жалоб на этого игрока нет');
  for (const id of ids) resolve(actor, id, accept, verdict, { push: () => {} } as any);
  notices.push(`${accept ? '✅' : '📭'} Разобрано жалоб: ${ids.length}`);
  return { ok: true, count: ids.length };
}

// Сколько новых жалоб ждёт — для значка на вкладке панели
function pendingCount(): number {
  return Object.values(store()).filter((r) => r.status === 'new').length;
}

export = { create, mine, queue, resolve, resolveAll, pendingCount, REASONS, REASON_LABEL, DAY_LIMIT, MIN_LEVEL };
