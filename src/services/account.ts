// ═══════════════════════════════════════════════════════════════════
// src/services/account.ts — кабинет: до трёх персонажей на один аккаунт
//
// Как устроено: аккаунт — это почта и пароль. Персонаж — привычная
// запись игрока. Их связывает поле accountId: у первого персонажа оно
// равно его же идентификатору, у остальных — тому же значению.
//
// Почему так, а не отдельная таблица аккаунтов: весь код игры работает
// с игроком напрямую, и введение промежуточной сущности потребовало бы
// переписать сотни мест. Здесь же достаточно одного поля.
//
// ГЛАВНОЕ ОГРАНИЧЕНИЕ: персонажи одного аккаунта не взаимодействуют.
// Без этого запрета три персонажа превращаются в схему: один бьёт
// другого ради опыта и трофеев, третий шлёт подкрепления, деньги
// перекладываются по кругу. Проверка стоит в самих механиках, а не
// только в интерфейсе.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

const MAX_CHARACTERS = 3;

// Идентификатор аккаунта. У старых записей поля нет — считаем, что
// персонаж сам себе аккаунт: так миграция не нужна вовсе.
function accountIdOf(p: any): string {
  return String((p && (p.accountId || p.id)) || '');
}

// Все персонажи одного аккаунта
function charactersOf(user: any): any[] {
  const acc = accountIdOf(user);
  if (!acc) return [];
  return Object.values(player.users())
    .filter((p: any) => !p.isBot && accountIdOf(p) === acc)
    .sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0));
}

// Один ли это аккаунт. Используется механиками игры для запрета
// взаимодействия между своими же персонажами.
function sameAccount(a: any, b: any): boolean {
  if (!a || !b) return false;
  const x = accountIdOf(a), y = accountIdOf(b);
  return !!x && x === y;
}

// Проверка перед действием одного персонажа против другого
function assertNotSelfAccount(a: any, b: any, what?: string): void {
  if (!sameAccount(a, b)) return;
  throw new u.ApiError(
    `${what || 'Это действие'} между своими персонажами невозможно — они принадлежат одному аккаунту.`
  );
}

// ---------- Карточки для кабинета ----------
function view(user: User) {
  const list = charactersOf(user);
  const rolesSrv = require('./roles');
  const vipSrv = require('./vip');
  return {
    max: MAX_CHARACTERS,
    canCreate: list.length < MAX_CHARACTERS,
    currentId: user.id,
    characters: list.map((p: any) => ({
      id: p.id,
      name: p.name,
      level: p.level,
      rank: player.rank(p.level),
      rating: player.rating(p),
      flag: player.flag(p),
      avatar: p.avatar || null,
      dollars: p.dollars || 0,
      gold: p.gold || 0,
      alliance: p.alliance ? p.alliance.name : (p.allianceName || null),
      legion: p.legionId ? (db.load('legions', {})[p.legionId] || {}).name || null : null,
      lastSeen: p.lastSeen || 0,
      current: p.id === user.id,
      vip: (() => { try { return vipSrv.isVip(p); } catch (e) { return false; } })(),
      staffTag: (() => { try { return rolesSrv.roleTag(p) || null; } catch (e) { return null; } })(),
      banned: !!p.banned,
    })),
  };
}

// ---------- Создание персонажа ----------
// Пароль и почта общие: новый персонаж наследует их у аккаунта, поэтому
// вводить их заново не нужно — вход остаётся один.
function createCharacter(user: User, name: string, country: string, notices: Notices) {
  const list = charactersOf(user);
  if (list.length >= MAX_CHARACTERS) {
    throw new u.ApiError(`На аккаунт можно создать не больше ${MAX_CHARACTERS} персонажей`);
  }
  if ((user as any).banned) throw new u.ApiError('Аккаунт заблокирован');

  const auth = require('./auth');
  const nick = String(name || '').trim().replace(/\s+/g, ' ');
  auth.validateName(nick);

  const all = player.users();
  const taken = Object.values(all).find((p: any) => String(p.name || '').toLowerCase() === nick.toLowerCase());
  if (taken) throw new u.ApiError('Такой позывной уже занят');

  const cc = String(country || '').trim() || (user as any).country || 'ru';
  const id = u.uid(12);
  const fresh = auth.newUser(
    id, nick, (user as any).email, (user as any).passHash, (user as any).salt,
    cc, false, true
  );
  // Связываем с аккаунтом. Первый персонаж мог быть создан до появления
  // кабинета — проставляем ему accountId задним числом.
  const acc = accountIdOf(user);
  (fresh as any).accountId = acc;
  if (!(user as any).accountId) {
    (user as any).accountId = acc;
    db.markUser(user.id);
  }
  all[id] = fresh;
  db.markUser(id);
  db.save('users');

  auditLog.record({
    userId: user.id, userName: user.name, path: '/api/account/create',
    body: { newId: id, newName: nick, country: cc },
  });
  notices.push(`🎖 Персонаж «${nick}» создан. Переключитесь на него в кабинете.`);
  return { id, name: nick };
}

// ---------- Переключение ----------
// Выдаём токен другому персонажу того же аккаунта. Пароль не спрашиваем:
// человек уже вошёл, и это тот же самый аккаунт.
function switchTo(user: User, targetId: string, notices: Notices) {
  const target = player.users()[String(targetId || '')];
  if (!target) throw new u.ApiError('Персонаж не найден');
  if (!sameAccount(user, target)) throw new u.ApiError('Это персонаж другого аккаунта');
  if (target.id === user.id) throw new u.ApiError('Вы уже играете за него');
  if ((target as any).banned) throw new u.ApiError('Этот персонаж заблокирован');

  const auth = require('./auth');
  const token = auth.issueToken(target.id);
  auditLog.record({
    userId: user.id, userName: user.name, path: '/api/account/switch',
    body: { toId: target.id, toName: target.name },
  });
  notices.push(`🔄 Вы играете за «${target.name}»`);
  return { token, id: target.id, name: target.name };
}

export = {
  view, createCharacter, switchTo, charactersOf, accountIdOf,
  sameAccount, assertNotSelfAccount, MAX_CHARACTERS,
};
