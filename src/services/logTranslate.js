// ===================================================================
// src/services/logTranslate.js — перевод действий в понятный текст
// Превращает (маршрут + тело запроса + результат) в строку вида
// «Купил 5× танк за $150 000» для журнала администратора.
// ===================================================================

const config = require('../../config/gameConfig');

// Формат денег как в игре (1 200 000 -> "1.2 M")
function money(n) {
  n = Number(n) || 0;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' Tr';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' Bn';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (n >= 1e3) return n.toLocaleString('ru');
  return String(n);
}

// Имя юнита по id
function unitName(id) {
  const cu = config.UNIT_BY_ID[id];
  return cu ? cu.name : id;
}

// Основная функция: path — маршрут, body — тело запроса, result — ответ сервера
function describe(path, body, result) {
  body = body || {};
  result = result || {};
  try {
    switch (path) {
      case '/api/register':
        return `Регистрация (страна: ${body.country || '?'}, email: ${body.email || '?'})`;
      case '/api/login':
        return 'Вход в игру';
      case '/api/verify-email':
        return 'Подтвердил почту';

      case '/api/units/buy':
        return `Купил ${body.qty || 1}× «${unitName(body.unitId)}» за $${money(result.spent)}`;
      case '/api/units/sell':
        return `Продал ${body.qty || 1}× «${unitName(body.unitId)}» (возврат $${money(result.refund)})`;

      case '/api/buildings/build':
        return `Построил ${body.qty || 1}× постройку «${body.buildingId}»`;

      case '/api/production/workshop':
        return 'Построил цех';
      case '/api/production/start':
        return `Запустил модернизацию ${body.qty || 1}× «${unitName(body.unitId)}» до Mk${(Number(body.fromMk) || 0) + 1}`;
      case '/api/production/boost':
        return 'Ускорил модернизацию за золото';

      case '/api/war/attack':
        return `Атаковал цель${result.win ? ' — ПОБЕДА' : ' — поражение'}${result.loot ? `, награбил $${money(result.loot)}` : ''}`;
      case '/api/war/fatality':
        return body.choice === 'ear' ? 'Фаталити: отрезал ухо' : 'Фаталити: помиловал (жетон)';

      case '/api/missions/start':
        return `Начал шаг спецоперации (конфликт «${body.confId}»)`;
      case '/api/missions/boost':
        return 'Ускорил шаг миссии за золото';

      case '/api/market/buy':
        return `Купил на чёрном рынке «${body.itemId}»${body.victimName ? ` против «${body.victimName}»` : ''}`;
      case '/api/market/container':
        return `Открыл контейнер (тир ${body.tier})`;
      case '/api/market/bid':
        return `Ставка на аукционе: 🪙 ${money(body.amount)}`;

      case '/api/trophies/start':
        return `Начал прокачку трофея «${body.id}»`;
      case '/api/trophies/boost':
        return `Ускорил прокачку трофея «${body.id}»`;

      case '/api/hospital/heal':
        return `Лечение в госпитале за $${money(result.spent)}`;

      case '/api/bank':
        if (body.action === 'deposit') return `Вклад в банк: $${money(body.amount)}`;
        if (body.action === 'withdraw') return `Снятие из банка: $${money(body.amount)}`;
        return 'Операция в банке';
      case '/api/bank/buy-gold':
        return `Покупка золота: пакет «${body.packId}»`;

      case '/api/skills/upgrade':
        return `Прокачал навык «${body.skill}»`;

      case '/api/club/play':
        return `Клуб офицеров: игра «${body.game}»`;

      case '/api/group/alliance/create': return `Создал альянс «${body.name}»`;
      case '/api/group/legion/create':   return `Создал легион «${body.name}»`;
      case '/api/legion/deposit':         return `Внёс в казну легиона: $${money(body.amount)}`;
      case '/api/legion/build':           return `Прокачал клановую постройку «${body.buildingId}»`;
      case '/api/legion/war':             return 'Объявил кланвойну';

      case '/api/chat':
        return `Сообщение в чат: «${(body.text || '').slice(0, 40)}»`;
      case '/api/mail':
        return `Письмо для «${body.toName}»`;

      default:
        return null; // нет специального перевода — покажем сырой путь
    }
  } catch (e) {
    return null;
  }
}

module.exports = { describe };
