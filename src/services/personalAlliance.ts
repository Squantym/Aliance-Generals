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

// ── Бот в ростере ─────────────────────────────────────────────────
// Живому игроку id выдаёт регистрация, ботам его собирали как 'bot_…'
// (групповые боты — 'gbot_…'). Старые записи несли ещё и пометку
// isBot. Проверяем оба признака: одной пометки мало — в самых старых
// записях её нет, а одного id мало, если формат когда-то менялся.
function isBotEntry(m: any): boolean {
  return !!m && (m.isBot === true || /^g?bot_/.test(String(m.id || '')));
}

// ── Разовая чистка: боты вон из личных альянсов ───────────────────
// Ботов набирали кнопкой «позвать бойца»; кнопку убрали в 217-м, а уже
// набранные остались и продолжали давать вместимость армии — по 10
// единиц техники за каждого. Живых союзников не трогаем.
// Зовётся ОДИН раз при старте по флагу в meta (см. server.ts), а не
// каждый раз: это правка данных, её место — миграция.
function purgeBots(): { players: number; removed: number } {
  const all = users();
  let players = 0, removed = 0;
  for (const id of Object.keys(all)) {
    const p: any = all[id];
    if (!Array.isArray(p.allianceRoster) || !p.allianceRoster.length) continue;
    const kept = p.allianceRoster.filter((m: any) => !isBotEntry(m));
    if (kept.length === p.allianceRoster.length) continue;
    removed += p.allianceRoster.length - kept.length;
    players++;
    p.allianceRoster = kept;
    // Счётчик обязан повторять ростер: от него считается вместимость
    p.allianceMembers = kept.length;
    ensure(p);          // заодно уберёт дубли, если они там были
  }
  return { players, removed };
}

// Гарантируем поля личного альянса
function ensure(user: User): void {
  if (typeof user.allianceMembers !== 'number') user.allianceMembers = 0;
  if (!Array.isArray(user.allianceRoster)) user.allianceRoster = [];
  if (typeof user.allianceDiplomats !== 'number') user.allianceDiplomats = 0;
  if (!Array.isArray(user.allianceInviteLog)) user.allianceInviteLog = [];
  // Один и тот же союзник мог попасть в ростер дважды: если двое
  // позвали друг друга и оба приняли заявку, каждая сторона
  // добавлялась по второму разу, и альянс рос на двоих вместо одного.
  // Чистим повторы здесь, чтобы починились и уже испорченные списки.
  // Счётчик правим ТОЛЬКО вместе с чисткой: он и ростер всегда росли
  // в одном месте, и трогать его без доказанного повтора нельзя —
  // ошибись мы, и у игрока молча упадёт вместимость армии.
  const seen: Record<string, boolean> = {};
  const clean = user.allianceRoster!.filter((m: any) => {
    if (!m || !m.id || m.id === user.id || seen[m.id]) return false;
    seen[m.id] = true;
    return true;
  });
  if (clean.length !== user.allianceRoster!.length) {
    user.allianceRoster = clean;
    user.allianceMembers = clean.length;
  }
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
  // Обучение: задание «Плечо товарища» закрывается у ПРИГЛАСИВШЕГО и
  // только когда человек действительно вступил, а не когда позвали
  try { require('./tutorial').notify(inviter, 'ally_join', []); } catch (e) {}

  // Каждому +1 (друг друга добавляют в ростер), лимиты независимы.
  // ВАЖНО: только если его там ещё нет. Двое могли позвать друг друга
  // одновременно — тогда вторая принятая заявка добавляла того же
  // человека повторно, и альянс рос на двоих вместо одного.
  const alreadyMine = user.allianceRoster!.some((m: any) => m.id === inviter.id);
  const alreadyTheirs = inviter.allianceRoster!.some((m: any) => m.id === user.id);
  // ИЛИ ОБОИМ, ИЛИ НИКОМУ. Раньше при полном альянсе у одной из сторон
  // запись получала только вторая — союз выходил односторонним: игра
  // писала «теперь союзники», а areAllies (взаимный ростер) отвечала
  // «нет». Отсюда жалобы: человек в альянсе, а в профиле предлагают его
  // пригласить и в списке целей он не помечен союзником.
  if (!alreadyMine && user.allianceMembers! >= maxMembers(user)) {
    throw new u.ApiError(`Ваш альянс заполнен: ${maxMembers(user)}. Поднимите уровень или исключите кого-то.`);
  }
  if (!alreadyTheirs && inviter.allianceMembers! >= maxMembers(inviter)) {
    throw new u.ApiError(`У «${inviter.name}» альянс заполнен — он не может принять новых союзников.`);
  }
  if (!alreadyMine) {
    user.allianceMembers!++;
    user.allianceRoster!.push({ id: inviter.id, name: inviter.name });
    try { require('./seasons').onAllianceRecruit(user); } catch (e) {}
  }
  if (!alreadyTheirs) {
    inviter.allianceMembers!++;
    inviter.allianceRoster!.push({ id: user.id, name: user.name });
    try { require('./seasons').onAllianceRecruit(inviter); } catch (e) {}
  }
  // Встречную заявку гасим: иначе тот, кого только что приняли, мог бы
  // «принять» ответную и снова попасть в тот же альянс
  const mirror = fresh(inv[inviter.id] || []).filter((x: any) => x.fromId !== user.id);
  inv[inviter.id] = mirror;

  list.splice(idx, 1);
  inv[user.id] = list;
  db.save('alliance_invites');
  db.save('users');
  try {
    require('./notifications').push(inviter.id, 'alliance_joined',
      `🤝 ${user.name} принял ваше приглашение в альянс!`, { id: user.id, name: user.name });
  } catch (e) {}
  notices.push(alreadyMine
    ? `🤝 Вы и «${inviter.name}» и так союзники. В вашем альянсе: ${user.allianceMembers}.`
    : `🤝 Вы и «${inviter.name}» теперь союзники! В вашем альянсе: ${user.allianceMembers}.`);
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
// Исключение разрывает союз У ОБОИХ. Раньше запись пропадала только у
// того, кто исключал: у второго «союзник» оставался в списке, давал
// вместимость армии и сбивал с толку — игра его союзником не считала
// (areAllies смотрит оба ростера), а список показывал.
function removeMember(user: User, memberId: string, notices: Notices) {
  ensure(user);
  const before = user.allianceRoster!.length;
  user.allianceRoster = user.allianceRoster!.filter((m) => m.id !== memberId);
  // Вторая сторона: убираем и у неё, даже если у себя записи не было —
  // так чинятся и уже перекошенные пары
  const other = users()[String(memberId || '')];
  if (other) {
    ensure(other);
    const wasThere = other.allianceRoster!.length;
    other.allianceRoster = other.allianceRoster!.filter((m: any) => m.id !== user.id);
    if (other.allianceRoster.length < wasThere) {
      other.allianceMembers = Math.max(0, (other.allianceMembers || 0) - 1);
      db.markUser(other.id);
      try {
        require('./notifications').push(other.id, 'alliance_left',
          `🤝 «${user.name}» вышел из союза с вами`, { id: user.id, name: user.name });
      } catch (e) {}
    }
  }
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

// ── Разовая починка односторонних союзов ──────────────────────────
// До 18.09.2026 союз мог получиться односторонним: исключение убирало
// запись только у одной стороны, а приём приглашения при заполненном
// альянсе добавлял только второму. Такие пары игра союзниками не
// считает, но в списке альянса они видны — и игроки пишут в поддержку.
// Решение владельца: делать их ВЗАИМНЫМИ (а не разрывать), союз ведь и
// задумывался. Лимит здесь не смотрим: запись уже существует у одной
// стороны, и отказать значило бы оставить перекос навсегда.
// Зовётся ОДИН раз при старте по флагу в meta — это правка данных.
function repairOneSided(): { pairs: number; players: number } {
  const all = users();
  const touched: Record<string, boolean> = {};
  let pairs = 0;
  for (const id of Object.keys(all)) {
    const p: any = all[id];
    if (!Array.isArray(p.allianceRoster)) continue;
    for (const m of p.allianceRoster.slice()) {
      const other: any = m && all[m.id];
      if (!other) continue;
      if (!Array.isArray(other.allianceRoster)) other.allianceRoster = [];
      if (other.allianceRoster.some((x: any) => x && x.id === p.id)) continue;
      other.allianceRoster.push({ id: p.id, name: p.name });
      other.allianceMembers = other.allianceRoster.length;
      db.markUser(other.id);
      touched[other.id] = true; touched[p.id] = true;
      pairs++;
    }
  }
  if (pairs) db.save('users');
  return { pairs, players: Object.keys(touched).length };
}

export = {
  areAllies, sweepInvites, INVITE_TTL_MS, repairOneSided,
  ensure, maxMembers, view, buyDiplomat, invitePlayer,
  myInvites, acceptInvite, declineInvite, removeMember, purgeBots,
};
