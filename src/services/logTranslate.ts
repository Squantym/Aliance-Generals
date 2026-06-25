// ===================================================================
// src/services/logTranslate.ts — перевод действий в понятный текст
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

function unitName(id: string): string {
  const cu = config.UNIT_BY_ID[id];
  return cu ? cu.name : id;
}

function buildingName(id: string): string {
  const b = config.BUILDING_BY_ID[id];
  return b ? b.name : id;
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

      // ── Миссии ─────────────────────────────────────────────────
      case '/api/missions/start':
        return `🎯 Начал шаг спецоперации (конфликт «${body.confId}»)`;
      case '/api/missions/boost':
        return '⚡ Ускорил шаг миссии за золото';

      // ── Чёрный рынок ───────────────────────────────────────────
      case '/api/market/buy':
        return `🛒 Купил на рынке «${body.itemId}»${body.victimName ? ` против «${body.victimName}»` : ''}`;
      case '/api/market/container':
        return `📦 Открыл контейнер тир ${body.tier}${result.devName ? ` → «${result.devName}»` : ''}`;
      case '/api/market/bid':
        return `🔨 Ставка на аукционе: 🪙 ${money(body.amount)}`;

      // ── Трофеи ─────────────────────────────────────────────────
      case '/api/trophies/start':
        return `🏆 Начал прокачку трофея «${body.id}»`;
      case '/api/trophies/boost':
        return `⚡ Ускорил трофей «${body.id}»`;

      // ── Госпиталь ──────────────────────────────────────────────
      case '/api/hospital/heal':
        return `❤️ Лечение в госпитале за $${money(result.spent)}`;

      // ── Банк ───────────────────────────────────────────────────
      case '/api/bank':
        if (body.action === 'deposit')  return `🏦 Вклад в банк: $${money(body.amount)}`;
        if (body.action === 'withdraw') return `🏦 Снятие из банка: $${money(body.amount)}`;
        return '🏦 Операция в банке';
      case '/api/bank/buy-gold':
        return `🪙 Покупка золота: пакет «${body.packId}»`;

      // ── Навыки ─────────────────────────────────────────────────
      case '/api/skills/upgrade':
        return `📈 Прокачал навык «${body.skill}»`;

      // ── Клуб ───────────────────────────────────────────────────
      case '/api/club/play':
        return `🎲 Клуб офицеров: игра «${body.game}»`;

      // ── Альянс / Легион ────────────────────────────────────────
      case '/api/group/alliance/create': return `⭐ Создал альянс «${body.name}»`;
      case '/api/group/alliance/invite': return `📩 Отправил приглашение в альянс (цель: ${body.targetId})`;
      case '/api/group/alliance/respond':
        return body.accept ? `✅ Принял приглашение в альянс` : `❌ Отклонил приглашение в альянс`;
      case '/api/group/alliance/kick':   return `🚫 Исключил из альянса (${body.memberId})`;
      case '/api/group/alliance/leave':  return `🚪 Покинул альянс`;
      case '/api/group/legion/create':   return `🏛 Создал легион «${body.name}»`;
      case '/api/group/legion/invite':   return `📩 Отправил приглашение в легион`;
      case '/api/group/legion/leave':    return `🚪 Покинул легион`;

      // ── Легион: казна и постройки ──────────────────────────────
      case '/api/legion/deposit':          return `💰 Внёс в казну легиона: $${money(body.amount)}`;
      case '/api/legion/exchange':         return `💱 Обменял $${money(body.dollars)} → Резервы`;
      case '/api/legion/deposit-resources':return `📦 Внёс в казначейство: ${body.ears ? body.ears + ' 👂 ' : ''}${body.tokens ? body.tokens + ' 🎖' : ''}`;
      case '/api/legion/build':            return `🏛 Улучшил постройку легиона «${body.buildingId}»`;
      case '/api/legion/build-battle':     return `⚔️ Улучшил боевую постройку «${body.buildingId}»`;
      case '/api/legion/tech/start':       return `🔬 Начал изучение технологии «${body.techId}»`;
      case '/api/legion/shop/buy':         return `🛒 Купил в магазин легиона «${body.itemId}» ×${body.qty || 1}`;
      case '/api/legion/war':              return `⚔️ Объявил кланвойну`;
      case '/api/legion/challenge':        return `⚔️ Бросил вызов легиону (ID: ${body.enemyId})`;
      case '/api/legion/challenge/accept': return `✅ Принял вызов на бой легионов`;
      case '/api/legion/challenge/decline':return `❌ Отклонил вызов на бой`;
      case '/api/legion/battle/join':      return `⚔️ Вступил в бой легиона (роль: ${body.role})`;
      case '/api/legion/battle/attack':    return `⚔️ Атаковал в бою легиона (цель: ${body.targetId})`;
      case '/api/legion/battle/heal':      return `💊 Вылечил союзника в бою легиона`;
      case '/api/legion/battle/guard':     return `🛡️ Прикрыл союзника в бою легиона`;
      case '/api/legion/battle/item':      return `🎒 Применил предмет «${body.itemId}» в бою`;
      case '/api/legion/gear/pick':        return `🎒 Взял предмет в боевой пояс: «${body.itemId}»`;

      // ── Чат и почта ────────────────────────────────────────────
      case '/api/chat':
        return `💬 Чат: «${(body.text || '').slice(0, 60)}»`;
      case '/api/mail':
        return `📧 Письмо для «${body.toName}»`;

      // ── Профиль ────────────────────────────────────────────────
      case '/api/status':
        return `📝 Статус: «${(body.text || '').slice(0, 60)}»`;
      case '/api/ear/restore':
        return `👂 Восстановил ухо за 🪙 ${result.cost || ''}`;

      // ── Уши ────────────────────────────────────────────────────
      case '/api/admin/claim-gift':
        return `🎁 Забрал подарок администратора`;

      default:
        return null;
    }
  } catch (e) {
    return null;
  }
}

export = { describe };
