// ═══════════════════════════════════════════════════════════════════
// ПОДКРЕПЛЕНИЯ СОЮЗНИКАМ
// Отправить подкрепление можно ТОЛЬКО игроку, с которым вы состоите во
// взаимном личном альянсе (он у вас в ростере и вы у него).
//
// Правила (config.REINFORCE):
//   • у получателя одновременно максимум MAX_ACTIVE подкреплений,
//     и все — от РАЗНЫХ игроков (по одному от каждого);
//   • отправитель может послать не более PER_DAY подкреплений в сутки,
//     и не более одного в сутки одному и тому же игроку;
//   • подкрепление живёт LIFETIME_H часов, затем истекает.
//
// Эффект: +BONUS_PCT% к мощи армии за каждое активное подкрепление.
// Трофей «Знамя победы» (banner) усиливает бонус: +0.1% за уровень, на
// 10-м — +1.5% (итого 2.5% за подкрепление, config.trophyValue).
// ═══════════════════════════════════════════════════════════════════
import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import pa = require('./personalAlliance');
import notifications = require('./notifications');
import type { User, Notices } from '../types';

const R = config.REINFORCE;

function users(): Record<string, User> { return player.users(); }

// Чистка истёкших подкреплений у игрока
function prune(user: any): any[] {
  if (!Array.isArray(user.reinforcements)) user.reinforcements = [];
  const now = Date.now();
  const before = user.reinforcements.length;
  user.reinforcements = user.reinforcements.filter((r: any) => r && r.expiresAt > now);
  if (user.reinforcements.length !== before) db.markUser(user.id);
  return user.reinforcements;
}

// Сколько подкреплений отправлено за последние сутки (и кому)
function sentToday(user: any): any[] {
  if (!Array.isArray(user.reinforceSent)) user.reinforceSent = [];
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  user.reinforceSent = user.reinforceSent.filter((x: any) => x && x.at > dayAgo);
  return user.reinforceSent;
}

// Бонус к мощи от активных подкреплений (в процентах)
function bonusPct(user: any): number {
  const active = prune(user).length;
  if (!active) return 0;
  let per = R.BONUS_PCT;
  // Трофей «Знамя победы» усиливает каждое подкрепление
  try {
    const trophies = require('./trophies');
    // activeLevel, а не levelOf: трофей, отданный в прокачку, не работает
    const lvl = trophies.activeLevel(user, 'banner');
    const def = (config.TROPHIES || []).find((t: any) => t.id === 'banner');
    if (lvl && def) per += config.trophyValue(def, lvl);
  } catch (e) { /* трофеев нет — базовый бонус */ }
  return Math.round(active * per * 10) / 10;
}

// Множитель для расчёта мощи армии (1.0 = без бонуса)
function powerMul(user: any): number {
  return 1 + bonusPct(user) / 100;
}

// ── Экран подкреплений ────────────────────────────────────────────
// Дневной лимит отправок: у VIP больше. Функция нужна, потому что
// лимит проверяется в трёх местах, и в одном из них он брался прямо
// из конфига — подписка там не действовала.
function perDayFor(user: any): number {
  try { return require('./vip').reinforcePerDay(user); } catch (e) { return R.PER_DAY; }
}

// Можно ли отправить подкрепление этому игроку прямо сейчас. Пустая
// строка — можно, иначе причина. Одна проверка на список союзников и на
// кнопку «Ответить»: разойдись они, кнопка обещала бы то, в чём send()
// потом откажет.
function sendBlock(user: User, ally: User, sent: any[]): { reason: string; mine: boolean; theirActive: number } {
  const theirActive = prune(ally);
  const mine = theirActive.some((r: any) => r.fromId === user.id);
  let reason = '';
  if (!pa.areAllies(user, ally)) reason = 'не во взаимном альянсе';
  else if (mine) reason = 'ваше подкрепление уже действует';
  else if (sent.some((x: any) => x.toId === ally.id)) reason = 'уже отправляли сегодня';
  else if (theirActive.length >= R.MAX_ACTIVE) reason = 'у него все слоты заняты';
  else if (sent.length >= perDayFor(user)) reason = 'ваш дневной лимит исчерпан';
  return { reason, mine, theirActive: theirActive.length };
}

// Кнопка «Отправить подкрепление» в чужом профиле. null — кнопки нет
// (не союзник). Причина отказа — та же sendBlock, что в списке союзников.
function profileState(user: User, target: User) {
  if (!target || target.id === user.id || !pa.areAllies(user, target)) return null;
  const b = sendBlock(user, target, sentToday(user));
  return { canSend: !b.reason, reason: b.reason, mine: b.mine,
    theirActive: b.theirActive, theirMax: R.MAX_ACTIVE };
}

function view(user: User) {
  const active = prune(user);
  const sent = sentToday(user);
  const all = users();

  // Союзники, которым можно отправить прямо сейчас
  const roster = ((user as any).allianceRoster || []).filter((m: any) => m && !m.isBot);
  const allies = roster.map((m: any) => {
    const ally = all[m.id];
    if (!ally) return null;
    const b = sendBlock(user, ally, sent);
    return {
      id: ally.id, name: ally.name, level: ally.level, flag: player.flag(ally),
      canSend: !b.reason, reason: b.reason,
      theirActive: b.theirActive, theirMax: R.MAX_ACTIVE,
    };
  }).filter(Boolean);

  return {
    maxActive: R.MAX_ACTIVE,
    perDay: perDayFor(user),
    lifetimeH: R.LIFETIME_H,
    bonusPctEach: R.BONUS_PCT,
    // Мои активные подкрепления (кто прислал) — с ответной кнопкой: чтобы
    // отблагодарить, не нужно искать человека во всём списке альянса
    active: active
      .slice()
      .sort((a: any, b: any) => (b.at || 0) - (a.at || 0))
      .map((r: any) => {
        const from = all[r.fromId];
        const b = from ? sendBlock(user, from, sent) : { reason: 'игрок не найден', mine: false, theirActive: 0 };
        return {
          fromId: r.fromId, fromName: from ? from.name : r.fromName,
          fromLevel: from ? from.level : 0, flag: from ? player.flag(from) : '',
          receivedAt: r.at || 0,
          expiresInMin: Math.max(0, Math.round((r.expiresAt - Date.now()) / 60000)),
          canReply: !b.reason, replyReason: b.reason, replied: b.mine,
        };
      }),
    activeCount: active.length,
    totalBonusPct: bonusPct(user),
    sentToday: sent.length,
    sentLeft: Math.max(0, perDayFor(user) - sent.length),
    allies,
  };
}

// ── Отправка подкрепления ─────────────────────────────────────────
function send(user: User, toId: string, notices: Notices) {
  const target = users()[toId];
  if (!target) throw new u.ApiError('Игрок не найден');
  if (target.id === user.id) throw new u.ApiError('Нельзя отправить подкрепление самому себе');
  // Свои же персонажи не усиливают друг друга — иначе три аккаунта
  // превращаются в схему бесконечного подкрепления
  require('./account').assertNotSelfAccount(user, target, 'Отправка подкреплений');

  // Только взаимные союзники по личному альянсу
  if (!pa.areAllies(user, target)) {
    throw new u.ApiError('Подкрепления можно отправлять только союзникам из вашего альянса (взаимно)');
  }

  const sent = sentToday(user);
  if (sent.length >= perDayFor(user)) {
    throw new u.ApiError(`Лимит: ${perDayFor(user)} подкреплений в сутки. Попробуйте завтра.`);
  }
  if (sent.some((x: any) => x.toId === toId)) {
    throw new u.ApiError('Этому союзнику вы уже отправляли подкрепление сегодня');
  }

  const theirs = prune(target);
  if (theirs.length >= R.MAX_ACTIVE) {
    throw new u.ApiError(`У «${target.name}» уже максимум подкреплений (${R.MAX_ACTIVE})`);
  }
  if (theirs.some((r: any) => r.fromId === user.id)) {
    throw new u.ApiError('Ваше подкрепление уже действует у этого союзника');
  }

  const expiresAt = Date.now() + R.LIFETIME_H * 3600 * 1000;
  (target as any).reinforcements.push({
    fromId: user.id, fromName: user.name, at: Date.now(), expiresAt,
  });
  (user as any).reinforceSent.push({ toId, toName: target.name, at: Date.now() });
  // Счётчик за всё время: reinforceSent живёт сутки (лимит на день), а
  // условия приглашений спрашивают «отправить 50 подкреплений» — по
  // суточному списку такое не посчитать
  try { require('./dailyQuests').bump(user, 'reinforcesSent', 1); } catch (e) {}
  // Задание «отправить 5 подкреплений друзьям» считает только своих
  // приглашённых, поэтому у него отдельный счётчик
  try { require('./referralQuests').onReinforce(user, target); } catch (e) {}
  db.markUser(target.id);
  db.markUser(user.id);

  try {
    notifications.push(target.id, 'reinforcement',
      `🎖 ${user.name} прислал вам подкрепление`,
      { fromId: user.id, fromName: user.name, hours: R.LIFETIME_H, bonusPct: bonusPct(target) });
  } catch (e) {}

  notices.push(`🎖 Подкрепление отправлено союзнику «${target.name}» на ${R.LIFETIME_H} ч. ` +
    `Осталось отправок сегодня: ${Math.max(0, perDayFor(user) - sentToday(user).length)}.`);
  // sentTo — для журнала действий: игра присылает только toId, и в
  // записи стояло «Отправил подкрепление «—»», то есть кому именно —
  // владелец в журнале не видел.
  return Object.assign(view(user), { sentTo: { id: target.id, name: target.name } });
}

// Отозвать подкрепления между игроком и его бывшими союзниками.
// Вызывается при выходе из альянса и при исключении: иначе игрок
// выходил, заходил обратно и слал второе подкрепление тому же союзнику,
// а первое продолжало действовать.
function revokeAllFor(userId: string, memberIds: string[]): number {
  const users = player.users();
  const me = users[userId];
  let removed = 0;
  const others = memberIds.filter((id) => id !== userId);

  // Мои подкрепления у бывших союзников
  for (const id of others) {
    const other = users[id];
    if (!other || !Array.isArray(other.reinforcements)) continue;
    const before = other.reinforcements.length;
    other.reinforcements = other.reinforcements.filter((r: any) => r && r.fromId !== userId);
    if (other.reinforcements.length !== before) { removed += before - other.reinforcements.length; db.markUser(other.id); }
  }

  // И их подкрепления у меня
  if (me && Array.isArray(me.reinforcements)) {
    const before = me.reinforcements.length;
    me.reinforcements = me.reinforcements.filter((r: any) => r && !others.includes(r.fromId));
    if (me.reinforcements.length !== before) { removed += before - me.reinforcements.length; db.markUser(me.id); }
  }

  if (removed) db.save('users');
  return removed;
}

export = { view, send, profileState, prune, bonusPct, powerMul, revokeAllFor };
