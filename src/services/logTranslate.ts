// ===================================================================
// src/services/logTranslate.ts — перевод действий игрока в понятный
// человекочитаемый текст для журнала администратора.
// Разворачивает id в названия («ammo» → «Цинк боеприпасов»,
// «cruelty» → «жестокость») и подписывает точные действия интерфейса.
// ===================================================================

import config = require('../../config/gameConfig');

function money(n: number | string): string {
  const num = Number(n) || 0;
  if (num >= 1e12) return (num / 1e12).toFixed(2) + ' Tr';
  if (num >= 1e9)  return (num / 1e9).toFixed(2)  + ' Bn';
  if (num >= 1e6)  return (num / 1e6).toFixed(2)  + ' M';
  if (num >= 1e3)  return num.toLocaleString('ru');
  return String(num);
}

// ── Разворачивание id → названий ──────────────────────────────────
const SKILL_NAMES: Record<string, string> = {
  energy: 'энергия', health: 'здоровье', ammo: 'боеприпасы',
  cruelty: 'жестокость', agility: 'ловкость',
};
function skillName(id: string): string { return SKILL_NAMES[id] || id || '?'; }
function unitName(id: string): string { const x = config.UNIT_BY_ID[id]; return x ? x.name : id; }
function buildingName(id: string): string { const x = config.BUILDING_BY_ID[id]; return x ? x.name : id; }
function itemName(id: string): string { const x = config.MARKET_ITEM_BY_ID[id]; return x ? x.name : id; }
function conflictName(id: string): string { const x = config.CONFLICT_BY_ID[id]; return x ? x.name : id; }
function trophyName(id: string): string {
  const x = (config.TROPHIES || []).find((t: any) => t.id === id);
  return x ? x.name : id;
}
function legionShopName(id: string): string { const x = config.LEGION_SHOP_ITEM_BY_ID[id]; return x ? x.name : id; }
function legionTechName(id: string): string { const x = config.LEGION_TECH_BY_ID[id]; return x ? x.name : id; }
function legionBuildName(id: string): string {
  const x = config.LEGION_BUILDING_BY_ID[id] || config.LEGION_BATTLE_BUILDING_BY_ID[id];
  return x ? x.name : id;
}

function describe(path: string, body?: any, result?: any): string | null {
  body   = body   || {};
  result = result || {};
  try {
    switch (path) {
      // ── Авторизация ────────────────────────────────────────────
      case '/api/register':
        return `📝 Регистрация (страна: ${body.country || '?'}, email: ${body.email || '?'})`;
      case '/api/login':
        return '🔑 Вход в игру';
      case '/api/verify-email':
        return '✉️ Подтвердил почту';

      // ── Техника ────────────────────────────────────────────────
      case '/api/units/buy':
        return `🛒 Купил ${body.qty || 1}× «${unitName(body.unitId)}» за $${money(result.spent)}`;
      case '/api/units/sell':
        return `💸 Продал ${body.qty || 1}× «${unitName(body.unitId)}» (возврат $${money(result.refund)})`;

      // ── Постройки ──────────────────────────────────────────────
      case '/api/buildings/build':
        return `🏗 Построил ${body.qty || 1}× «${buildingName(body.buildingId)}»`;

      // ── Модернизация ───────────────────────────────────────────
      case '/api/production/workshop':
        return '🔧 Открыл цех';
      case '/api/production/start':
        return `⚙️ Модернизация ${body.qty || 1}× «${unitName(body.unitId)}» → Mk${(Number(body.fromMk) || 0) + 1}`;
      case '/api/production/boost':
        return '⚡ Ускорил модернизацию за золото';

      // ── Навыки ─────────────────────────────────────────────────
      case '/api/skill':
        return `📈 Прокачал навык «${skillName(body.stat)}»`;

      // ── Бои ────────────────────────────────────────────────────
      case '/api/war/attack': {
        const who = result.targetName ? ` «${result.targetName}»` : '';
        const outcome = result.win ? '✅ ПОБЕДА' : '❌ поражение';
        const loot = result.loot ? `, награбил $${money(result.loot)}` : '';
        return `⚔️ Атаковал${who} — ${outcome}${loot}`;
      }
      case '/api/war/fatality':
        return body.choice === 'ear'
          ? '💀 Фаталити: отрезал ухо противнику'
          : '🤝 Фаталити: помиловал (получил жетон)';
      case '/api/ears/restore':
        return `👂 Восстановил ухо${result.cost ? ` за 🪙 ${money(result.cost)}` : ''}`;

      // ── Миссии (спецоперации) ──────────────────────────────────
      case '/api/missions/start':
        return `🎯 Начал шаг спецоперации «${conflictName(body.confId)}»`;
      case '/api/missions/boost':
        return '⚡ Ускорил шаг миссии за золото';

      // ── Ракетные шахты ─────────────────────────────────────────
      case '/api/silos/fuel-ready':
        return `🚀 Заправка шахты (+${money(body.amount)})`;

      // ── Чёрный рынок ───────────────────────────────────────────
      case '/api/market/buy':
        return `🛒 Купил на рынке «${itemName(body.itemId)}»${body.targetName ? ` (жертва: «${body.targetName}»)` : ''}`;
      case '/api/market/open':
        return `📦 Открыл контейнер (тир ${body.tier}${(body.qty || 1) > 1 ? `, ${body.qty} шт.` : ''})${result.devName ? ` → «${result.devName}»` : ''}`;
      case '/api/market/bid':
        return `🔨 Ставка на аукционе: 🪙 ${money(body.amount)}`;

      // ── Клуб офицеров ──────────────────────────────────────────
      case '/api/club/pref/start': return '🃏 Клуб: начал военный преферанс';
      case '/api/club/pref/hit':   return '🃏 Клуб (преферанс): взял карту';
      case '/api/club/pref/stand': return '🃏 Клуб (преферанс): остановился';
      case '/api/club/safe/start': return '🔐 Клуб: подошёл к сейфу';
      case '/api/club/safe/try':   return '🔐 Клуб (сейф): попытка кода';
      case '/api/club/mine/start': return '💣 Клуб: начал «Минёр»';
      case '/api/club/mine/open':  return '💣 Клуб (минёр): открыл ячейку';
      case '/api/club/mine/cashout': return '💣 Клуб (минёр): забрал выигрыш';
      case '/api/club/run/start':  return '🏃 Клуб: начал забег';
      case '/api/club/run/step':   return '🏃 Клуб (забег): сделал шаг';
      case '/api/club/run/cashout': return '🏃 Клуб (забег): забрал выигрыш';
      case '/api/club/duel/start': return '⚔️ Клуб: начал тактическую дуэль';
      case '/api/club/duel/move':  return '⚔️ Клуб (дуэль): сделал ход';

      // ── Трофеи ─────────────────────────────────────────────────
      case '/api/trophies/start':
        return `🏆 Начал прокачку трофея «${trophyName(body.id)}»`;
      case '/api/trophies/boost':
        return `⚡ Ускорил трофей «${trophyName(body.id)}» за золото`;

      // ── Госпиталь ──────────────────────────────────────────────
      case '/api/hospital/heal':
        return `❤️ Лечение в госпитале за $${money(result.spent)}`;

      // ── Банк / покупка золота ──────────────────────────────────
      case '/api/bank':
        if (body.action === 'deposit')  return `🏦 Вклад в банк: $${money(body.amount)}`;
        if (body.action === 'withdraw') return `🏦 Снятие из банка: $${money(body.amount)}`;
        return '🏦 Операция в банке';
      case '/api/bank/reserve':
        return `💱 Обмен $${money(body.dollars)} → Резервы легиона`;
      case '/api/bank/buy-gold':
        return `🪙 Покупка золота (пакет «${body.packId}»)`;
      case '/api/payments/create':
        return `🪙 Заказ на покупку золота (пакет «${body.packageId}»)`;

      // ── Ежедневки и контракты ──────────────────────────────────
      case '/api/daily/claim':
        return '🎯 Забрал награду за ежедневное задание';
      case '/api/daily/bonus':
        return '🎉 Забрал бонус за все ежедневные задания';
      case '/api/contracts/claim':
        return '📑 Забрал награду за контракт';

      // ── Косметика / титулы / рефералы ──────────────────────────
      case '/api/cosmetics/buy':     return `🎨 Купил косметику «${body.id}»`;
      case '/api/cosmetics/equip':   return `🎨 Надел косметику «${body.id}»`;
      case '/api/cosmetics/unequip': return `🎨 Снял косметику (${body.type})`;
      case '/api/titles/set':        return `🏅 Установил титул «${body.titleId}»`;
      case '/api/referral/apply':    return `🎁 Активировал реферальный код «${body.code}»`;

      // ── Альянс / Легион ────────────────────────────────────────
      case '/api/group/alliance/create': return `⭐ Создал альянс «${body.name}»`;
      case '/api/group/alliance/invite': return `📩 Пригласил в альянс (${body.targetId})`;
      case '/api/group/alliance/respond':
        return body.accept ? '✅ Принял приглашение в альянс' : '❌ Отклонил приглашение в альянс';
      case '/api/group/alliance/kick':   return `🚫 Исключил из альянса (${body.memberId})`;
      case '/api/group/alliance/leave':  return '🚪 Покинул альянс';
      case '/api/group/legion/create':   return `🏛 Создал легион «${body.name}»`;
      case '/api/group/legion/invite':   return '📩 Отправил приглашение в легион';
      case '/api/group/legion/leave':    return '🚪 Покинул легион';

      // ── Легион: казна, постройки, технологии, магазин ──────────
      case '/api/legion/deposit':          return `💰 Внёс в казну легиона: $${money(body.amount)}`;
      case '/api/legion/exchange':         return `💱 Обменял $${money(body.dollars)} → Резервы`;
      case '/api/legion/deposit-resources':return `📦 Внёс в казначейство: ${body.ears ? body.ears + ' 👂 ' : ''}${body.tokens ? body.tokens + ' 🎖' : ''}`;
      case '/api/legion/build':            return `🏛 Улучшил постройку легиона «${legionBuildName(body.buildingId)}»`;
      case '/api/legion/build-battle':     return `⚔️ Улучшил боевую постройку «${legionBuildName(body.buildingId)}»`;
      case '/api/legion/tech/start':       return `🔬 Начал изучение технологии «${legionTechName(body.techId)}»`;
      case '/api/legion/shop/buy':         return `🛒 Купил в магазин легиона «${legionShopName(body.itemId)}» ×${body.qty || 1}`;
      case '/api/legion/war':              return '⚔️ Объявил кланвойну';
      case '/api/legion/challenge':        return `⚔️ Бросил вызов легиону (ID: ${body.enemyId})`;
      case '/api/legion/challenge/accept': return '✅ Принял вызов на бой легионов';
      case '/api/legion/challenge/decline':return '❌ Отклонил вызов на бой';
      case '/api/legion/battle/join':      return `⚔️ Вступил в бой легиона (роль: ${body.role})`;
      case '/api/legion/battle/attack':    return `⚔️ Атаковал в бою легиона (цель: ${body.targetId})`;
      case '/api/legion/battle/heal':      return '💊 Вылечил союзника в бою легиона';
      case '/api/legion/battle/guard':     return '🛡️ Прикрыл союзника в бою легиона';
      case '/api/legion/battle/ready':     return `⚔️ Готовность к бою легиона: ${body.ready ? 'да' : 'нет'}`;
      case '/api/legion/battle/item':      return `🎒 Применил предмет «${legionShopName(body.itemId)}» в бою`;
      case '/api/legion/gear/pick':        return `🎒 Взял в боевой пояс: «${legionShopName(body.itemId)}»`;

      // ── Событие (босс) ─────────────────────────────────────────
      case '/api/event/attack':
        return `🐉 Атаковал босса${result.dealtDamage ? ` (урон ${money(result.dealtDamage)}${result.crit ? ' 🔥крит' : ''})` : ''}${result.finished ? ' — ДОБИЛ!' : ''}`;

      // ── Чат и почта ────────────────────────────────────────────
      case '/api/chat':
        return `💬 Чат: «${(body.text || '').slice(0, 60)}»`;
      case '/api/mail':
        return `📧 Письмо для «${body.toName}»`;

      // ── Профиль ────────────────────────────────────────────────
      case '/api/status':
        return `📝 Сменил статус: «${(body.text || '').slice(0, 60)}»`;

      // ── Подарки администратора ─────────────────────────────────
      case '/api/admin/claim-gift':
        return '🎁 Забрал подарок администратора';

      default:
        return null;
    }
  } catch (e) {
    return null;
  }
}

export = { describe };
