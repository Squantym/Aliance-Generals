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
//   • раздел «Задания» («Операция „Пополнение“») — показан по умолчанию,
//     выключатель в панели остался на случай, если его понадобится
//     временно спрятать.
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
  // Умолчание — «показан». Раздел заданий давно наполнен, но у игроков он
  // так и не появился: выключатель стоял в положении «скрыт» с тех пор,
  // когда заданий ещё не было, и включить его никто не догадался.
  const s = db.load<RefSettings>('referralSettings', { questsOn: true, changedAt: 0, changedBy: '' });
  if (typeof s.questsOn !== 'boolean') s.questsOn = true;
  // changedAt = 0 значит, что кнопку в панели никто не нажимал, а запись
  // в базе — след старого умолчания: db.saveAll() пишет все загруженные
  // коллекции, в том числе созданные из значения по умолчанию. Решением
  // владельца такую запись считать нельзя.
  if (!s.changedAt) s.questsOn = true;
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
    // Сколько условий настроено всего: обе шкалы и парные задания
    questCount: (config.REFERRAL_QUESTS.inviter || []).length
      + (config.REFERRAL_QUESTS.newbie || []).length
      + (config.REFERRAL_QUESTS.pairDaily || []).length
      + (config.REFERRAL_QUESTS.pairOnce || []).length,
    invited,
  };
}

export = { settings, questsEnabled, linkFor, appUrl, invitedList, setQuests, adminView };
