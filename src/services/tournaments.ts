// ===================================================================
// src/services/tournaments.ts — турниры легионов
// Два режима:
//  1) 'scheduled' — админ вручную задаёт список матчей «легион vs легион»
//     с конкретным временем старта; система сама запускает каждый бой в срок.
//  2) 'bracket'   — автосетка: админ задаёт список легионов и интервал;
//     система с равным интервалом сама запускает раунды и продвигает
//     победителей, пока не останется один чемпион.
// Прогресс двигает tick(), вызываемый из фонового тика сервера (раз в 30 сек).
// Хранение: коллекция 'tournaments' = { [id]: Tournament }.
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import legion = require('./legion');
import type { User, Notices } from '../types';

interface Match {
  id: string;
  legionAId: string; legionAName: string;
  legionBId: string | null; legionBName: string | null;   // null = бай (проход без боя)
  startAt: number;               // для scheduled — заданное время; для bracket = время старта раунда
  status: 'pending' | 'live' | 'done';
  battleId?: string;
  winnerId?: string | null; winnerName?: string | null;
  note?: string;                 // 'walkover' | 'bye' | 'no_contest'
}
interface Round {
  n: number;
  startAt: number;
  startedAt: number;             // 0 = ещё не запущен
  matches: Match[];
}
interface Tournament {
  id: string;
  name: string;
  type: 'scheduled' | 'bracket';
  status: 'running' | 'finished' | 'cancelled';
  createdAt: number;
  createdBy: string;
  prize?: { gold?: number; dollars?: number; tokens?: number };  // приз чемпиону (каждому бойцу)
  // scheduled:
  matches?: Match[];
  // bracket:
  intervalMs?: number;
  rounds?: Round[];
  participants?: { id: string; name: string }[];
  championId?: string | null; championName?: string | null;
}

function store(): Record<string, Tournament> {
  return db.load<Record<string, Tournament>>('tournaments', {});
}
function legionsColl(): Record<string, any> {
  return db.load<Record<string, any>>('legions', {});
}
function mkMatch(aId: string, aName: string, bId: string | null, bName: string | null, startAt: number): Match {
  return { id: u.uid(8), legionAId: aId, legionAName: aName, legionBId: bId, legionBName: bName, startAt, status: 'pending' };
}
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function prizeOf(body: any): { gold?: number; dollars?: number; tokens?: number } | undefined {
  const p: any = {};
  if (u.toInt(body.prizeGold, 0) > 0) p.gold = u.toInt(body.prizeGold, 0);
  if (u.toInt(body.prizeDollars, 0) > 0) p.dollars = u.toInt(body.prizeDollars, 0);
  if (u.toInt(body.prizeTokens, 0) > 0) p.tokens = u.toInt(body.prizeTokens, 0);
  return Object.keys(p).length ? p : undefined;
}

// ── Создание турнира ──────────────────────────────────────────────
function create(adminUser: User, body: any, notices: Notices) {
  if (!adminUser || !adminUser.isAdmin) throw new u.ApiError('Только для администратора');
  const name = String(body.name || 'Турнир').trim().slice(0, 80) || 'Турнир';
  const type = body.type === 'bracket' ? 'bracket' : 'scheduled';
  const legs = legionsColl();
  const all = store();
  const id = u.uid(10);

  if (type === 'scheduled') {
    const raw = Array.isArray(body.matches) ? body.matches : [];
    if (!raw.length) throw new u.ApiError('Добавьте хотя бы один матч');
    const matches: Match[] = [];
    for (const m of raw) {
      const A = legs[m.legionAId]; const B = legs[m.legionBId];
      if (!A || !B) throw new u.ApiError('Один из легионов матча не найден');
      if (m.legionAId === m.legionBId) throw new u.ApiError('Легион не может биться сам с собой');
      const startAt = Number(m.startAt) || Date.now();
      matches.push(mkMatch(A.id, A.name, B.id, B.name, startAt));
    }
    all[id] = { id, name, type, status: 'running', createdAt: Date.now(), createdBy: adminUser.id, prize: prizeOf(body), matches };
    db.save('tournaments');
    notices.push(`✅ Турнир «${name}» создан: ${matches.length} матч(ей) по расписанию.`);
    return { id };
  }

  // bracket
  const ids: string[] = Array.isArray(body.legionIds) ? body.legionIds : [];
  const uniq = Array.from(new Set(ids)).filter((x) => legs[x]);
  if (uniq.length < 2) throw new u.ApiError('Нужно минимум 2 легиона');
  const intervalMin = Math.max(1, u.toInt(body.intervalMinutes, 30));
  const intervalMs = intervalMin * 60 * 1000;
  const firstStartAt = Number(body.firstStartAt) || Date.now();
  const participants = uniq.map((x) => ({ id: x, name: legs[x].name }));

  const round1 = buildRound(1, shuffle(participants), firstStartAt);
  all[id] = {
    id, name, type: 'bracket', status: 'running', createdAt: Date.now(), createdBy: adminUser.id,
    prize: prizeOf(body), intervalMs, participants, rounds: [round1], championId: null, championName: null,
  };
  db.save('tournaments');
  notices.push(`✅ Автотурнир «${name}» создан: ${participants.length} легионов, интервал раундов ${intervalMin} мин.`);
  return { id };
}

// Построить раунд из списка участников (парами; нечётный получает бай)
function buildRound(n: number, parts: { id: string; name: string }[], startAt: number): Round {
  const matches: Match[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const a = parts[i];
    const b = parts[i + 1] || null;
    matches.push(mkMatch(a.id, a.name, b ? b.id : null, b ? b.name : null, startAt));
  }
  return { n, startAt, startedAt: 0, matches };
}

// ── ФОНОВЫЙ ТИК: двигает все активные турниры ──────────────────────
function tick(): void {
  const all = store();
  let changed = false;
  for (const t of Object.values(all)) {
    if (t.status !== 'running') continue;
    if (t.type === 'scheduled') changed = tickScheduled(t) || changed;
    else changed = tickBracket(t) || changed;
  }
  if (changed) db.save('tournaments');
}

// Запустить/дорезолвить один матч. Возвращает true, если что-то изменилось.
function progressMatch(m: Match): boolean {
  if (m.status === 'done') return false;

  // Бай — мгновенный проход
  if (m.status === 'pending' && !m.legionBId) {
    m.status = 'done'; m.winnerId = m.legionAId; m.winnerName = m.legionAName; m.note = 'bye';
    return true;
  }

  if (m.status === 'pending') {
    if (Date.now() < m.startAt) return false;   // ещё не время
    const r = legion.systemStartBattle(m.legionAId, m.legionBId as string);
    if (r.ok) { m.status = 'live'; m.battleId = r.battleId; return true; }
    if (r.reason === 'busy') return false;       // один из легионов занят — ждём
    if (r.reason === 'empty') {                  // нет бойцов — техническая победа
      if (r.aEmpty && r.bEmpty) { m.status = 'done'; m.winnerId = null; m.winnerName = null; m.note = 'no_contest'; }
      else if (r.aEmpty) { m.status = 'done'; m.winnerId = m.legionBId; m.winnerName = m.legionBName; m.note = 'walkover'; }
      else { m.status = 'done'; m.winnerId = m.legionAId; m.winnerName = m.legionAName; m.note = 'walkover'; }
      return true;
    }
    // missing/invalid — отменяем матч (обоих в никуда)
    m.status = 'done'; m.winnerId = null; m.winnerName = null; m.note = 'no_contest';
    return true;
  }

  if (m.status === 'live' && m.battleId) {
    const res = legion.battleResult(m.battleId);
    if (res.done) {
      m.status = 'done'; m.winnerId = res.winnerId; m.winnerName = res.winnerName;
      return true;
    }
  }
  return false;
}

function tickScheduled(t: Tournament): boolean {
  let ch = false;
  for (const m of t.matches || []) ch = progressMatch(m) || ch;
  if ((t.matches || []).every((m) => m.status === 'done')) { t.status = 'finished'; ch = true; }
  return ch;
}

function tickBracket(t: Tournament): boolean {
  let ch = false;
  const rounds = t.rounds as Round[];
  const cur = rounds[rounds.length - 1];

  // Стартуем текущий раунд, когда пришло его время
  if (cur.startedAt === 0) {
    if (Date.now() < cur.startAt) return false;
    cur.startedAt = Date.now();
    ch = true;
  }

  // Двигаем матчи текущего раунда
  for (const m of cur.matches) ch = progressMatch(m) || ch;

  // Раунд завершён?
  if (cur.matches.every((m) => m.status === 'done')) {
    const winners = cur.matches
      .filter((m) => m.winnerId)
      .map((m) => ({ id: m.winnerId as string, name: (m.winnerName as string) || '' }));

    if (winners.length <= 1) {
      // Чемпион определён (либо все выбыли)
      t.championId = winners[0] ? winners[0].id : null;
      t.championName = winners[0] ? winners[0].name : null;
      t.status = 'finished';
      if (t.championId && t.prize) awardChampion(t);
      return true;
    }
    // Следующий раунд ещё не создан — создаём из победителей
    if (rounds.length === cur.n) {
      const nextStart = cur.startedAt + (t.intervalMs || 0);
      rounds.push(buildRound(cur.n + 1, winners, nextStart));
      ch = true;
    }
  }
  return ch;
}

// Приз чемпиону — награда-письмо каждому бойцу легиона-победителя
function awardChampion(t: Tournament): void {
  try {
    const legs = legionsColl();
    const champ = legs[t.championId as string];
    if (!champ) return;
    const rewards = require('./rewards');
    for (const memberId of (champ.members || [])) {
      rewards.grant(memberId, {
        title: `🏆 Победа в турнире «${t.name}»`,
        reason: `Ваш легион «${champ.name}» стал чемпионом турнира.`,
        reward: { gold: t.prize!.gold || 0, dollars: t.prize!.dollars || 0, tokens: t.prize!.tokens || 0 },
      });
    }
  } catch (e) { /* приз не критичен для завершения турнира */ }
}

// ── Просмотр (админ) ──────────────────────────────────────────────
function list() {
  const all = store();
  return {
    tournaments: Object.values(all)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => ({
        id: t.id, name: t.name, type: t.type, status: t.status,
        createdAt: t.createdAt,
        championName: t.championName || null,
        matchCount: t.type === 'scheduled' ? (t.matches || []).length : undefined,
        roundCount: t.type === 'bracket' ? (t.rounds || []).length : undefined,
        participantCount: t.type === 'bracket' ? (t.participants || []).length : undefined,
      })),
  };
}

function view(id: string) {
  const t = store()[id];
  if (!t) throw new u.ApiError('Турнир не найден');
  return { tournament: t };
}

function cancel(adminUser: User, id: string, notices: Notices) {
  if (!adminUser || !adminUser.isAdmin) throw new u.ApiError('Только для администратора');
  const t = store()[id];
  if (!t) throw new u.ApiError('Турнир не найден');
  if (t.status === 'finished') throw new u.ApiError('Турнир уже завершён');
  t.status = 'cancelled';
  db.save('tournaments');
  notices.push(`🚫 Турнир «${t.name}» отменён.`);
  return { ok: true };
}

// Список легионов для выпадающих списков в админке
function legionOptions() {
  const legs = legionsColl();
  return {
    legions: Object.values(legs)
      .map((l: any) => ({ id: l.id, name: l.name, members: (l.members || []).length }))
      .sort((a, b) => b.members - a.members),
  };
}

export = { create, tick, list, view, cancel, legionOptions };
