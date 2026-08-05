// ═══════════════════════════════════════════════════════════════════
// src/services/vip.ts — VIP-подписка
//
// Единая точка для всех преимуществ. Остальной код спрашивает отсюда
// «действует ли VIP» и «какой множитель применить», а не проверяет
// поля игрока сам — иначе при изменении условий пришлось бы править
// два десятка мест.
//
// Суточные счётчики (лечение, иммунитет к фаталити, замены поручений)
// сбрасываются в 00:00 по московскому времени — как и остальные
// суточные механики игры.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import config = require('../../config/gameConfig');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

const V = config.VIP;

// ---------- Признак подписки ----------
function isVip(user: any): boolean {
  if (!user) return false;
  const until = Number(user.vipUntil || 0);
  return until > Date.now();
}

// Сколько осталось (для интерфейса)
function vipInfo(user: any): { active: boolean; until: number; daysLeft: number } {
  const until = Number((user && user.vipUntil) || 0);
  const active = until > Date.now();
  return {
    active,
    until: active ? until : 0,
    daysLeft: active ? Math.ceil((until - Date.now()) / 86400000) : 0,
  };
}

// ---------- Суточные счётчики ----------
// Отдельный набор от dailyQuests: там свои сбросы и своя логика,
// смешивать их значило бы связать несвязанное.
function mskDayKey(ts?: number): string {
  const d = new Date((ts || Date.now()) + 3 * 3600 * 1000);   // МСК = UTC+3
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function daily(user: any): any {
  const key = mskDayKey();
  if (!user.vipDaily || user.vipDaily.day !== key) {
    user.vipDaily = { day: key, heal: 0, immunity: 0, reroll: 0 };
  }
  return user.vipDaily;
}

// Осталось использований у суточного преимущества
function left(user: any, kind: 'heal' | 'immunity' | 'reroll'): number {
  if (!isVip(user)) return 0;
  const caps: any = {
    heal: V.HOSPITAL_FREE_PER_DAY,
    immunity: V.FATALITY_IMMUNITY_PER_DAY,
    reroll: V.QUEST_REROLLS_PER_DAY,
  };
  return Math.max(0, caps[kind] - (daily(user)[kind] || 0));
}

// Потратить одно использование. Возвращает true, если получилось.
function spend(user: any, kind: 'heal' | 'immunity' | 'reroll'): boolean {
  if (left(user, kind) <= 0) return false;
  const d = daily(user);
  d[kind] = (d[kind] || 0) + 1;
  db.markUser(user.id);
  return true;
}

// ---------- Преимущества ----------

// 1. Восстановление: минус 30% от ТЕКУЩЕГО значения, то есть уже
// после ускорения трофеями. Порядок важен — сначала трофеи, потом VIP.
function regenSeconds(user: any, seconds: number): number {
  if (!isVip(user)) return seconds;
  return Math.max(1, Math.round(seconds * (1 - V.REGEN_CUT_PCT / 100)));
}

// 3 и 19. Ускорение стройки шахт с ракетами и улучшения трофеев
function siloRocketSeconds(user: any, seconds: number): number {
  if (!isVip(user)) return seconds;
  return Math.max(1, Math.round(seconds * (1 - V.SILO_ROCKET_SPEED_PCT / 100)));
}
function trophyUpgradeSeconds(user: any, seconds: number): number {
  if (!isVip(user)) return seconds;
  return Math.max(1, Math.round(seconds * (1 - V.TROPHY_UPGRADE_SPEED_PCT / 100)));
}

// 5, 6, 7. Лимиты
function spyFreePerDay(user: any): number {
  return isVip(user) ? V.SPY_FREE_PER_DAY : config.SPY.freePerDay;
}
function reinforcePerDay(user: any): number {
  return isVip(user) ? V.REINFORCE_PER_DAY : config.REINFORCE.PER_DAY;
}
function contractsPerDay(user: any): number {
  return isVip(user) ? V.CONTRACTS_PER_DAY : config.CONTRACTS_PER_DAY;
}

// 12. Скидка на чёрном рынке. Складывается со скидкой администрации,
// но итог не превышает 50% — если только сам админ не выставил больше:
// его значение тогда остаётся как есть, надбавка не применяется.
function marketDiscountPct(user: any, adminPct: number): number {
  const base = Math.max(0, Number(adminPct) || 0);
  if (!isVip(user)) return base;
  if (base >= V.MARKET_DISCOUNT_CAP_PCT) return base;      // админская скидка и так больше предела
  return Math.min(V.MARKET_DISCOUNT_CAP_PCT, base + V.MARKET_DISCOUNT_PCT);
}

// 13. Прибавка к покупаемому золоту: складывается с акцией.
// Акция +50% и VIP +15% дают +65%.
function goldPurchaseBonusPct(user: any, promoPct: number): number {
  const base = Math.max(0, Number(promoPct) || 0);
  return isVip(user) ? base + V.GOLD_PURCHASE_BONUS_PCT : base;
}

// 14. Содержание техники и доход построек
function upkeepMul(user: any): number {
  return isVip(user) ? 1 - V.UPKEEP_CUT_PCT / 100 : 1;
}
function incomeMul(user: any): number {
  return isVip(user) ? 1 + V.INCOME_BONUS_PCT / 100 : 1;
}

// 15. Гарантированный уход от фаталити. Расходует одно использование.
function tryFatalityImmunity(user: any): boolean {
  return spend(user, 'immunity');
}

// 16, 17. Опыт и потери техники
function xpMul(user: any): number {
  return isVip(user) ? 1 + V.XP_BONUS_PCT / 100 : 1;
}
function unitLossMul(user: any): number {
  return isVip(user) ? 1 - V.UNIT_LOSS_CUT_PCT / 100 : 1;
}

// 20. Мины VIP-игрока срабатывают чаще
function mineTriggerBonusPct(user: any): number {
  return isVip(user) ? V.MINE_TRIGGER_BONUS_PCT : 0;
}

// 18. Смена позывного: бесплатно раз в 30 дней
function canRenameFree(user: any): boolean {
  if (!isVip(user)) return false;
  const last = Number(user.lastFreeRenameAt || 0);
  return Date.now() - last >= V.RENAME_FREE_DAYS * 86400000;
}
function markRenameUsed(user: any): void {
  user.lastFreeRenameAt = Date.now();
  db.markUser(user.id);
}

// ---------- Выдача подписки ----------
// Продлевает, а не перетирает: если VIP ещё действует, дни прибавляются
// к остатку — иначе покупка второй подписки сжигала бы первую.
function grant(actor: User | null, target: any, days: number, reason: string, notices: Notices) {
  const d = u.clamp(u.toInt(days, 0), 1, 3650);
  const base = Math.max(Date.now(), Number(target.vipUntil || 0));
  target.vipUntil = base + d * 86400000;
  db.markUser(target.id);
  db.save('users');
  if (actor) {
    auditLog.record({
      userId: actor.id, userName: actor.name, path: '/api/admin/vip/grant',
      body: { targetId: target.id, targetName: target.name, days: d, reason: String(reason || '') },
    });
  }
  const info = vipInfo(target);
  notices.push(`👑 VIP для «${target.name}»: +${d} дн. Действует до ${new Date(info.until).toLocaleDateString('ru-RU')}`);
  return { id: target.id, name: target.name, until: info.until, daysLeft: info.daysLeft };
}

function revoke(actor: User, target: any, notices: Notices) {
  if (!isVip(target)) throw new u.ApiError('У игрока нет активной подписки');
  target.vipUntil = 0;
  db.markUser(target.id);
  db.save('users');
  auditLog.record({
    userId: actor.id, userName: actor.name, path: '/api/admin/vip/revoke',
    body: { targetId: target.id, targetName: target.name },
  });
  notices.push(`👑 VIP у «${target.name}» снят`);
  return { ok: true };
}

// Сводка преимуществ — для страницы подписки в игре
function benefits() {
  return [
    { icon: '⚡', title: 'Быстрое восстановление', text: `Здоровье, энергия и боеприпасы восстанавливаются на ${V.REGEN_CUT_PCT}% быстрее — поверх ускорения от трофеев.` },
    { icon: '🏥', title: 'Госпиталь без очереди', text: `${V.HOSPITAL_FREE_PER_DAY} мгновенных лечений в сутки, дальше — как обычно.` },
    { icon: '🚀', title: 'Стройка вдвое быстрее', text: `Шахты и ракеты возводятся на ${V.SILO_ROCKET_SPEED_PCT}% быстрее.` },
    { icon: '📋', title: 'Всё одной кнопкой', text: 'Принять все задания и сдать все выполненные — по одному нажатию.' },
    { icon: '🔭', title: 'Больше разведки', text: `${V.SPY_FREE_PER_DAY} бесплатных разведок в сутки вместо ${config.SPY.freePerDay}.` },
    { icon: '🎖', title: 'Больше подкреплений', text: `${V.REINFORCE_PER_DAY} отправок в сутки вместо ${config.REINFORCE.PER_DAY}.` },
    { icon: '📜', title: 'Больше контрактов', text: `${V.CONTRACTS_PER_DAY} контрактов в день вместо ${config.CONTRACTS_PER_DAY}.` },
    { icon: '🔄', title: 'Замена поручений', text: `${V.QUEST_REROLLS_PER_DAY} бесплатные замены в сутки.` },
    { icon: '📊', title: 'Полная статистика', text: 'Отдельный раздел в профиле: время в игре, все доходы и расходы, техника и диверсанты по типам.' },
    { icon: '🕵', title: 'Кто вас разведал', text: 'Список тех, кто изучал вашу армию. Обнуляется в полночь по Москве.' },
    { icon: '👑', title: 'Золотой значок', text: 'В чате, в списке целей и в профиле.' },
    { icon: '🏷', title: `Скидка ${V.MARKET_DISCOUNT_PCT}%`, text: `На весь чёрный рынок. Складывается с акциями, но не больше ${V.MARKET_DISCOUNT_CAP_PCT}%.` },
    { icon: '🪙', title: `+${V.GOLD_PURCHASE_BONUS_PCT}% золота`, text: 'К любой покупке золота, поверх действующей акции.' },
    { icon: '🏭', title: 'Выгодная экономика', text: `Содержание техники дешевле на ${V.UPKEEP_CUT_PCT}%, доход построек выше на ${V.INCOME_BONUS_PCT}%.` },
    { icon: '🛡', title: 'Защита от фаталити', text: `${V.FATALITY_IMMUNITY_PER_DAY} гарантированных уходов в сутки — независимо от ловкости.` },
    { icon: '⭐', title: `+${V.XP_BONUS_PCT}% опыта`, text: 'За любые действия.' },
    { icon: '🚛', title: `Потери меньше на ${V.UNIT_LOSS_CUT_PCT}%`, text: 'Техника в бою гибнет реже.' },
    { icon: '✏️', title: 'Смена позывного', text: `Бесплатно раз в ${V.RENAME_FREE_DAYS} дней.` },
    { icon: '🏆', title: 'Трофеи быстрее', text: `Улучшение трофеев на ${V.TROPHY_UPGRADE_SPEED_PCT}% быстрее.` },
    { icon: '💣', title: 'Мины надёжнее', text: `Растяжки срабатывают чаще на ${V.MINE_TRIGGER_BONUS_PCT} процентных пункта.` },
  ];
}

export = {
  isVip, vipInfo, left, spend, benefits, grant, revoke,
  regenSeconds, siloRocketSeconds, trophyUpgradeSeconds,
  spyFreePerDay, reinforcePerDay, contractsPerDay,
  marketDiscountPct, goldPurchaseBonusPct,
  upkeepMul, incomeMul, xpMul, unitLossMul,
  tryFatalityImmunity, mineTriggerBonusPct,
  canRenameFree, markRenameUsed, mskDayKey,
};
