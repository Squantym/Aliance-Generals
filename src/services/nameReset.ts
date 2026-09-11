// ═══════════════════════════════════════════════════════════════════
// src/services/nameReset.ts — сброс позывного модерацией
//
// Позывной с оскорблением, матом или копией чужого имени заменяется на
// нейтральный general_12345. Сотрудник решает две вещи:
//   • бесплатна ли игроку следующая смена (или по обычной цене «Паспорта»);
//   • закрыть ли игру до смены.
//
// Почему «закрыть игру» — это окно на весь экран с формой, а не полоса
// со ссылкой в «Паспорт». Полоса поверх игры запрещает переходы только в
// браузере: любой запрос мимо интерфейса проходит, а смена в «Паспорте»
// платная и спрятана на чёрном рынке. Поэтому закрывает СЕРВЕР — любые
// действия игрока, кроме смены позывного, отклоняются (blocks), — а окно
// лишь объясняет это и даёт форму прямо на месте.
//
// В окне всегда есть «Оставить выданный позывной». Выданный правилам не
// противоречит, а игрок без золота на платную смену иначе остался бы
// заперт навсегда — это уже не мера, а блокировка аккаунта в обход бана.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import type { User, Notices } from '../types';

const HISTORY_MAX = 20;

// Что можно делать, пока игра закрыта до смены позывного
const ALLOWED_WHILE_BLOCKED: RegExp[] = [
  /^\/api\/name-reset\//, /^\/api\/rename$/, /^\/api\/passport\/name$/,
  /^\/api\/logout$/, /^\/api\/consents\//, /^\/api\/2fa\//,
  /^\/api\/achievements\/ack$/, /^\/api\/payments\/(check|ack)$/,
  // Обращение в поддержку — единственный способ оспорить сброс
  /^\/api\/support/,
];

function users(): Record<string, any> { return require('./player').users(); }
function roles() { return require('./roles'); }

// Сбрасывать может «Модерация чатов» или «Баны аккаунтов»: позывной —
// это то, что пишется в каждом сообщении, и модератору чата он нужен не
// меньше, чем администратору
function canReset(actor: User): boolean {
  const r = roles();
  return r.canAccessZone(actor, 'chat') || r.canAccessZone(actor, 'moderation');
}

function pushHistory(user: any, entry: any) {
  const h = Array.isArray(user.nameHistory) ? user.nameHistory : (user.nameHistory = []);
  h.unshift(entry);
  if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
}

function reset(actor: User, targetId: string, body: any, notices: Notices) {
  if (!canReset(actor)) {
    throw new u.ApiError('Нет права сбрасывать позывные: нужна «Модерация чатов» или «Баны аккаунтов»');
  }
  const target = users()[String(targetId || '')];
  if (!target || target.isBot) throw new u.ApiError('Игрок не найден');
  if (target.id === actor.id) throw new u.ApiError('Свой позывной так не сбрасывают');
  const r = roles();
  const role = r.roleOf(target);
  if (role === 'owner') throw new u.ApiError('Позывной владельца проекта сбросить нельзя');
  if (role && !r.isOwner(actor)) throw new u.ApiError('Позывной сотрудника сбрасывает только владелец');
  const reason = String((body && body.reason) || '').trim().slice(0, 200);
  if (!reason) throw new u.ApiError('Укажите причину — её увидит игрок');
  const free = !!(body && body.free);
  const block = !!(body && body.block);

  const now = Date.now();
  const from = target.name;
  const to = require('./names').generate();
  target.name = to;
  target.nameReset = { at: now, byId: actor.id, byName: actor.name, reason, from, to, free, block };
  pushHistory(target, { at: now, from, to, kind: 'reset', byName: actor.name, reason });
  db.markUser(target.id);
  db.save('users');
  try { require('./access').securityEvent(target, 'name_reset', `${from} → ${to}: ${reason}`); } catch (e) {}
  try {
    require('./notifications').push(target.id, 'name_reset',
      `✏️ Позывной «${from}» сброшен модерацией. Причина: ${reason}. Сейчас вы — «${to}». `
      + (free ? 'Сменить его можно бесплатно.' : 'Сменить можно по цене паспорта — или оставить этот.'), {});
  } catch (e) {}
  notices.push(`✏️ Позывной «${from}» сброшен → «${to}». `
    + `${free ? 'Смена для игрока бесплатна' : 'Смена за счёт игрока'}${block ? ', игра закрыта до смены' : ''}.`);
  return { id: target.id, from, to, free, block };
}

function priceFor(user: any): number {
  try { return require('./passport').namePrice(user); } catch (e) { return 0; }
}

// Сведения для игрока — едут в /api/me
function info(user: any) {
  const nr = user && user.nameReset;
  if (!nr) return null;
  let vipFree = false;
  try { vipFree = !nr.free && require('./vip').canRenameFree(user); } catch (e) { vipFree = false; }
  return {
    at: nr.at, reason: nr.reason, from: nr.from, current: user.name, byName: nr.byName,
    free: !!nr.free, block: !!nr.block, vipFree,
    price: nr.free || vipFree ? 0 : priceFor(user),
  };
}

// Смена позывного после сброса: бесплатно, по VIP или по цене паспорта
function rename(user: any, newName: string, notices: Notices) {
  const nr = user && user.nameReset;
  if (!nr) throw new u.ApiError('Позывной не сбрасывался — сменить его можно в «Паспорте» на чёрном рынке');
  const names = require('./names');
  const name = names.validate(newName);
  if (name === user.name) throw new u.ApiError('Это и есть ваш нынешний позывной — нажмите «Оставить»');
  names.assertFree(name, user.id);

  let how = 'бесплатно';
  let paid = 0;
  const vip = require('./vip');
  if (nr.free) {
    how = 'бесплатно';
  } else if (vip.canRenameFree(user)) {
    vip.markRenameUsed(user);
    how = 'бесплатно по VIP';
  } else {
    const price = priceFor(user);
    if ((user.gold || 0) < price) {
      throw new u.ApiError(`Не хватает золота: смена стоит 🪙 ${price}. Можно оставить нынешний позывной.`);
    }
    require('./player').spendGold(user, price, 'passport');
    require('./passport').countNameChange(user);
    paid = price;
    how = `за 🪙 ${price}`;
  }
  const old = user.name;
  user.name = name;
  user.nameReset = null;
  pushHistory(user, { at: Date.now(), from: old, to: name, kind: 'rename' });
  db.markUser(user.id);
  db.save('users');
  try { require('./access').securityEvent(user, 'rename', `${old} → ${name}`); } catch (e) {}
  notices.push(`✏️ Позывной изменён: «${old}» → «${name}» (${how})`);
  return { name, paid };
}

// «Оставить выданный позывной»
function keep(user: any, notices: Notices) {
  if (!user.nameReset) return { name: user.name };
  user.nameReset = null;
  db.markUser(user.id);
  notices.push(`✅ Позывной «${user.name}» оставлен`);
  return { name: user.name };
}

// Позывной сменили обычным путём (VIP, «Паспорт») — сброс исполнен
function onRenamed(user: any, from: string) {
  if (!user) return;
  if (user.nameReset) user.nameReset = null;
  pushHistory(user, { at: Date.now(), from, to: user.name, kind: 'rename' });
  db.markUser(user.id);
}

// Закрывает ли сброс этот запрос. Смотреть можно всё (иначе и окно со
// сменой не открылось бы), действовать — только сменить позывной.
function blocks(user: any, method: string, pathname: string): boolean {
  if (!user || !user.nameReset || !user.nameReset.block) return false;
  if (method !== 'POST') return false;
  return !ALLOWED_WHILE_BLOCKED.some((re) => re.test(pathname));
}

function history(user: any) {
  return (Array.isArray(user && user.nameHistory) ? user.nameHistory : []).slice(0, HISTORY_MAX);
}

export = { reset, rename, keep, info, onRenamed, blocks, history, canReset };
