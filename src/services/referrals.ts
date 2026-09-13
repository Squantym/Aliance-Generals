// ═══════════════════════════════════════════════════════════════════
// src/services/referrals.ts — приглашение друзей: ссылка, список, задания
//
// Сам код-приглашение и начисления по нему остались в features.ts
// (историческое место, на него ссылается половина игры). Здесь то, что
// выросло вокруг него:
//   • личная ссылка вида https://адрес/?ref=КОД — по ней код
//     подставляется сам, вводить руками ничего не нужно;
//   • список приглашённых: кто пришёл, докуда дорос, сколько золота
//     принёс. Раньше игрок видел только счётчик «приглашено: 3» и не мог
//     понять, кто из друзей вообще зашёл;
//   • раздел «Задания» — включается и выключается владельцем из панели.
//     Пока пустой: наполнение обсуждается отдельно, а выключатель нужен
//     сразу, чтобы недоделанный раздел не висел у игроков.
//
// QR-код НЕ рисуется на сервере: картинка нужна только в интерфейсе, и
// рисовать её в браузере дешевле, чем гонять по сети (public/js/screens/
// referrals.js).
//
// Хранение: коллекция 'referralSettings' = { questsOn, questsTitle, ... }
// ═══════════════════════════════════════════════════════════════════

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import type { User, Notices } from '../types';

interface RefSettings {
  questsOn: boolean;     // показывать ли игрокам раздел «Задания»
  changedAt: number;
  changedBy: string;
}

function settings(): RefSettings {
  const s = db.load<RefSettings>('referralSettings', { questsOn: false, changedAt: 0, changedBy: '' });
  if (typeof s.questsOn !== 'boolean') s.questsOn = false;
  return s;
}

function questsEnabled(): boolean {
  return !!settings().questsOn;
}

// ── Личная ссылка ──────────────────────────────────────────────────
// Адрес игры берём из той же настройки, что и ссылки в письмах: другого
// достоверного источника у сервера нет, а «угадать» его по заголовку
// запроса нельзя — подменяется кем угодно.
function appUrl(): string {
  let url = '';
  try { url = String(require('./email').APP_URL || ''); } catch (e) { url = ''; }
  return url.replace(/\/+$/, '');
}

function linkFor(code: string): string {
  const base = appUrl();
  return base ? `${base}/?ref=${encodeURIComponent(code)}` : `?ref=${encodeURIComponent(code)}`;
}

// ── Кого привёл ────────────────────────────────────────────────────
// Показываем позывной, уровень и состояние: дошёл ли до 50 (за это
// платят) и заходит ли вообще. Сколько друг ПОТРАТИЛ денег — не
// показываем никогда: это чужая покупка. Видно только, сколько золота
// с него получил сам пригласивший.
const ACTIVE_MS = 3 * 24 * 3600 * 1000;

function invitedList(user: User) {
  const all = player.users() as Record<string, User>;
  const mine = Object.values(all).filter((p: any) => p && p.referredBy === user.id);
  const now = Date.now();
  return mine
    .map((p: any) => ({
      name: String(p.name || ''),
      level: Number(p.level || 1),
      joinedAt: Number(p.createdAt || 0),
      lastSeen: Number(p.lastSeen || 0),
      active: !!p.lastSeen && now - p.lastSeen < ACTIVE_MS,
      reached50: !!p.refLevel50Paid,
      goldFromHim: Number(p.refGoldGiven || 0),
    }))
    .sort((a, b) => b.joinedAt - a.joinedAt);
}

// Переключатель из панели. Зона «Акции»: раздел про привлечение игроков,
// там же живут скидки и бонусы к покупкам.
function setQuests(actor: User, on: boolean, notices: Notices) {
  require('./roles').assertZone(actor, 'discounts', 'включение раздела заданий');
  const s = settings();
  s.questsOn = !!on;
  s.changedAt = Date.now();
  s.changedBy = String(actor.name || '');
  db.save('referralSettings');
  notices.push(s.questsOn
    ? '✅ Раздел «Задания» показан игрокам в «Пригласить друга»'
    : '🚫 Раздел «Задания» убран у игроков');
  return adminView(actor);
}

function adminView(actor: User) {
  require('./roles').assertZone(actor, 'discounts', 'настройки приглашений');
  const s = settings();
  const all = player.users() as Record<string, User>;
  const invited = Object.values(all).filter((p: any) => p && p.referredBy).length;
  return {
    questsOn: s.questsOn,
    changedAt: s.changedAt || 0,
    changedBy: s.changedBy || '',
    // Сколько условий настроено всего: обе шкалы вместе
    questCount: (config.REFERRAL_QUESTS.inviter || []).length + (config.REFERRAL_QUESTS.newbie || []).length,
    invited,
  };
}

export = { settings, questsEnabled, linkFor, appUrl, invitedList, setQuests, adminView };
