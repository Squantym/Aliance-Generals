// ===================================================================
// src/services/rewards.ts — письма от «Система»
//
// Два вида писем:
//   • награда — не начисляется сразу: приходит письмом с описанием (что и
//     за что) и кнопкой «Забрать», начисление только при получении.
//     Забрать можно в почте и на главном экране. Источники: сезоны,
//     администрация;
//   • квитанция о покупке — покупка к её приходу УЖЕ зачислена. Кнопки
//     «Забрать» у неё нет, и получить что-то через неё невозможно.
//
// Хранение: коллекция 'rewards' = { [rewardId]: RewardLetter }
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import type { User, Notices } from '../types';

// Что может входить в награду. Все поля необязательны.
interface RewardPayload {
  dollars?: number;      // доллары (игровая валюта)
  gold?: number;         // золото (премиум)
  tokens?: number;       // жетоны перемирия
  ears?: number;         // трофейные уши
  skillPoints?: number;  // очки навыков
  xp?: number;           // опыт
}

type ReceiptLine = { text: string; icon: string | null };

interface RewardLetter {
  id: string;
  userId: string;
  from: string;          // всегда «Система»
  kind?: 'reward' | 'receipt';   // нет поля — награда (письма до появления квитанций)
  title: string;         // заголовок письма
  reason: string;        // за что награда / детали покупки
  reward: RewardPayload;
  lines?: ReceiptLine[]; // квитанция: что куплено, построчно, с картинками
  createdAt: number;
  claimed: boolean;
  claimedAt?: number;
}

function store(): Record<string, RewardLetter> {
  return db.load<Record<string, RewardLetter>>('rewards', {});
}

// ── Создать награду-письмо для игрока ──────────────────────────────
function grant(userId: string, opts: { title: string; reason: string; reward: RewardPayload }): RewardLetter {
  const all = store();
  const r: RewardLetter = {
    id: u.uid(12),
    userId,
    from: 'Система',
    kind: 'reward',
    title: String(opts.title || 'Награда').slice(0, 120),
    reason: String(opts.reason || '').slice(0, 400),
    reward: cleanPayload(opts.reward),
    createdAt: Date.now(),
    claimed: false,
  };
  all[r.id] = r;
  db.save('rewards');
  return r;
}

// ── Квитанция о покупке ────────────────────────────────────────────
// Письмо рождается уже «забранным», а награда внутри пустая: даже если
// кто-то доберётся до claim по id квитанции, начислять там нечего, и сам
// claim откажет раньше.
function grantReceipt(userId: string, opts: { title: string; reason: string; lines: ReceiptLine[] }): RewardLetter {
  const all = store();
  const now = Date.now();
  const r: RewardLetter = {
    id: u.uid(12),
    userId,
    from: 'Система',
    kind: 'receipt',
    title: String(opts.title || 'Покупка').slice(0, 120),
    reason: String(opts.reason || '').slice(0, 600),
    reward: {},
    lines: (opts.lines || []).slice(0, 30).map((l) => ({
      text: String((l && l.text) || '').slice(0, 120),
      icon: l && l.icon ? String(l.icon).slice(0, 200) : null,
    })),
    createdAt: now,
    claimed: true,
    claimedAt: now,
  };
  all[r.id] = r;
  db.save('rewards');
  return r;
}

// Оставляем только положительные числовые поля награды
function cleanPayload(p: RewardPayload): RewardPayload {
  const out: RewardPayload = {};
  const keys: (keyof RewardPayload)[] = ['dollars', 'gold', 'tokens', 'ears', 'skillPoints', 'xp'];
  for (const k of keys) {
    const v = Math.floor(Number(p && p[k]) || 0);
    if (v > 0) out[k] = v;
  }
  return out;
}

// Человекочитаемое описание награды: ['💵 20 000', '🪙 500', ...]
function describe(p: RewardPayload): string[] {
  const parts: string[] = [];
  if (p.dollars)     parts.push(`💵 ${u.fmt(p.dollars)}`);
  if (p.gold)        parts.push(`🪙 ${u.fmt(p.gold)}`);
  if (p.tokens)      parts.push(`🎖 ${u.fmt(p.tokens)}`);
  if (p.ears)        parts.push(`👂 ${u.fmt(p.ears)}`);
  if (p.skillPoints) parts.push(`🎯 ${u.fmt(p.skillPoints)} оч. навыков`);
  if (p.xp)          parts.push(`✨ ${u.fmt(p.xp)} XP`);
  return parts;
}

// ── Список писем игрока (для почты и главного экрана) ──────────────
function listFor(user: User) {
  const all = store();
  return Object.values(all)
    .filter((r) => r.userId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id,
      from: r.from,
      kind: r.kind || 'reward',
      title: r.title,
      reason: r.reason,
      reward: r.reward,
      rewardText: describe(r.reward),
      lines: r.lines || [],
      createdAt: r.createdAt,
      claimed: r.claimed,
      claimedAt: r.claimedAt || null,
    }));
}

// Сколько наград ещё не забрано (для бейджа)
function pendingCount(user: User): number {
  const all = store();
  return Object.values(all).filter((r) => r.userId === user.id && !r.claimed).length;
}

// ── Забрать награду (начисляет ресурсы) ───────────────────────────
function claim(user: User, rewardId: string, notices: Notices) {
  const all = store();
  const r = all[rewardId];
  if (!r || r.userId !== user.id) throw new u.ApiError('Награда не найдена');
  if (r.kind === 'receipt') throw new u.ApiError('Это квитанция о покупке — всё уже зачислено');
  if (r.claimed) throw new u.ApiError('Эта награда уже получена');

  creditReward(user, r.reward, sourceOf(r));
  r.claimed = true;
  r.claimedAt = Date.now();
  db.save('rewards');
  db.markUser(user.id);

  const parts = describe(r.reward);
  notices.push(parts.length ? `🎁 Получено: ${parts.join(', ')}` : '🎁 Награда получена');
  return { ok: true, credited: r.reward, rewardText: parts };
}

// Куда отнести награду: по заголовку письма понятно, за что она.
// «Итоги недели» → сезон, событие → событие, остальное — администрация.
function sourceOf(r: any): string {
  const t = String((r && r.title) || '');
  const reason = String((r && r.reason) || '');
  if (/недел|сезон/i.test(t)) return 'season:' + t.replace(/^[^\wА-Яа-я]+/, '').slice(0, 60);
  if (/событ|босс/i.test(t + reason)) return 'event:' + t.slice(0, 60);
  if (/турнир/i.test(t + reason)) return 'event:' + t.slice(0, 60);
  return 'admin:' + (t || 'Награда от администрации').slice(0, 60);
}

// Начислить ресурсы игроку
function creditReward(user: User, p: RewardPayload, source?: string): void {
  if (p.dollars)     player.addMoney(user, p.dollars, false);
  // Источник с подробностью («Итоги недели — 1 место») берём из заголовка
  // награды: иначе всё сваливалось бы в «Прочее» и владелец не понимал,
  // за что именно человек получил золото
  if (p.gold)        player.addGold(user, p.gold, source || 'admin');
  if (p.tokens)      user.tokens = (user.tokens || 0) + p.tokens;
  if (p.ears)        user.ears = (user.ears || 0) + p.ears;
  if (p.skillPoints) user.skillPoints = Math.max(0, (user.skillPoints || 0) + p.skillPoints);
  if (p.xp)          player.addXp(user, p.xp, []);
}

// ── Удалить письмо (только уже полученное) ─────────────────────────
function remove(user: User, rewardId: string) {
  const all = store();
  const r = all[rewardId];
  if (!r || r.userId !== user.id) throw new u.ApiError('Награда не найдена');
  if (!r.claimed) throw new u.ApiError('Сначала заберите награду — иначе она пропадёт');
  delete all[rewardId];
  db.save('rewards');
  return { ok: true, deleted: rewardId };
}

// ── Админ: выдать награду-письмо одному или всем ───────────────────
function adminGrant(adminUser: User, body: any, notices: Notices) {
  const reward = cleanPayload({
    dollars: u.toInt(body.dollars, 0),
    gold: u.toInt(body.gold, 0),
    tokens: u.toInt(body.tokens, 0),
    ears: u.toInt(body.ears, 0),
    skillPoints: u.toInt(body.skillPoints, 0),
    xp: u.toInt(body.xp, 0),
  });
  if (!Object.keys(reward).length) throw new u.ApiError('Не указано, что выдавать в награду');
  const title = String(body.title || '🎁 Награда от администрации').slice(0, 120);
  const reason = String(body.reason || `Награда от ${adminUser.name}`).slice(0, 400);

  if (body.toAll) {
    const all = player.users() as Record<string, User>;
    let count = 0;
    for (const t of Object.values(all)) { grant(t.id, { title, reason, reward }); count++; }
    notices.push(`✅ Награда-письмо отправлена ${count} игрокам: ${describe(reward).join(', ')}`);
    return { count };
  }
  const target = (player.users() as Record<string, User>)[body.userId];
  if (!target) throw new u.ApiError('Игрок не найден');
  grant(target.id, { title, reason, reward });
  notices.push(`✅ Награда-письмо отправлена игроку ${target.name}: ${describe(reward).join(', ')}`);
  return { ok: true };
}

export = { grant, grantReceipt, listFor, pendingCount, claim, remove, adminGrant, describe };
