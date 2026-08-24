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

// Роли и улучшения групповых боёв: в журнале должно стоять «Защитник»,
// а не «guardian» — иначе владелец читает журнал как программист.
const GB_ROLES: Record<string, string> = {
  fighter: 'Штурмовик', guardian: 'Защитник', medic: 'Медик',
};
function gbRole(id: string): string { return GB_ROLES[id] || id || '?'; }

const GB_SKILLS: Record<string, string> = {
  hp: 'запас HP', energy: 'запас энергии', ammo: 'боеприпасы',
  crit: 'шанс крита', dodge: 'уворот', armor: 'броня',
  healCrit: 'крит лечения', reward: 'прибавка к награде',
};
function gbSkill(id: string): string { return GB_SKILLS[id] || id || '?'; }

const GB_BUFFS: Record<string, string> = {
  attack: 'усиление урона', energy: 'запас энергии',
  crit: 'шанс крита', dodge: 'уворот',
};
function gbBuff(id: string): string { return GB_BUFFS[id] || id || '?'; }

// Что именно восстанавливали в бою легиона
const RESTORE_RU: Record<string, string> = {
  hp: 'здоровье', energy: 'энергия', ammo: 'боеприпасы',
};

// Перечень выданного/изъятого администратором — только непустое
function resourceList(b: any): string {
  const NAMES: Record<string, string> = {
    dollars: '$', gold: '🪙', exp: 'опыт', energy: 'энергия',
    health: 'здоровье', ammo: 'боеприпасы', tokens: 'жетоны',
  };
  const parts: string[] = [];
  for (const k of Object.keys(NAMES)) {
    const v = Number(b && b[k]);
    if (v) parts.push(`${NAMES[k]} ${money(Math.abs(v))}`);
  }
  return parts.length ? parts.join(', ') : 'ничего';
}
function unitName(id: string): string { const x = config.UNIT_BY_ID[id]; return x ? x.name : id; }
function buildingName(id: string): string { const x = config.BUILDING_BY_ID[id]; return x ? x.name : id; }
function itemName(id: string): string { const x = config.MARKET_ITEM_BY_ID[id]; return x ? x.name : id; }
function conflictName(id: string): string {
  if (!id) return 'спецоперация';
  const x = config.CONFLICT_BY_ID[id];
  return x ? x.name : String(id);
}
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
    // Пути с динамическим :id внутри (не совпадают с switch по строке) —
    // нормализуем ДО переключателя. /api/group/:kind/* сюда не попадает,
    // потому что :kind — это буквально 'alliance'/'legion' в реальном
    // запросе, и там switch матчится по строке напрямую.
    if (/^\/api\/notifications\/[^/]+\/read$/.test(path)) {
      return '🔔 Прочитал уведомление';
    }

    // ── Пути с подстановкой в середине ──────────────────────────
    // Объединения: один и тот же набор действий для альянса и легиона,
    // в адресе :kind подставляется буквально ('alliance' / 'legion').
    const gm = /^\/api\/group\/(alliance|legion)\/([a-z-]+)$/.exec(path);
    if (gm) {
      const what = gm[1] === 'legion' ? 'легион' : 'альянс';
      // Родительный падеж — для «исключил ИЗ легионА». Без него в журнале
      // получалось «Исключил из легион», что читается как машинный перевод.
      const whatGen = gm[1] === 'legion' ? 'легиона' : 'альянса';
      const who = body.name || body.targetName || body.userName || body.userId || '';
      switch (gm[2]) {
        case 'create':   return `🏛 Создал ${what} «${body.name || '—'}»`;
        case 'apply':    return `📨 Подал заявку в ${what}${body.name ? ` «${body.name}»` : ''}`;
        case 'decide':   return `${body.accept ? '✅ Принял' : '❌ Отклонил'} заявку в ${what}${who ? `: ${who}` : ''}`;
        case 'invite':   return `✉️ Пригласил в ${what}${who ? `: ${who}` : ''}`;
        case 'diplomat': return `🕊 Назначил дипломата в ${what}${who ? `: ${who}` : ''}`;
        case 'respond':  return `${body.accept ? '✅ Принял' : '❌ Отклонил'} приглашение в ${what}`;
        case 'kick':     return `👢 Исключил из ${whatGen}${who ? `: ${who}` : ''}`;
        case 'leave':    return `🚪 Покинул ${what}`;
        default:         return `🏛 Действие в ${what}: ${gm[2]}`;
      }
    }
    if (/^\/api\/admin\/tournaments\/[^/]+\/cancel$/.test(path)) {
      return '🏆 Отменил турнир';
    }
    if (/^\/api\/rewards\/[^/]+\/claim$/.test(path)) {
      return '🎁 Забрал начисленную награду';
    }
    if (/^\/api\/rewards\/[^/]+\/delete$/.test(path)) {
      return '🗑 Удалил награду из списка';
    }
    if (/^\/api\/mail\/[^/]+\/delete$/.test(path)) {
      return '🗑 Удалил письмо';
    }
    // Лоты дня и подписка: без этих строк журнал показывал сырые адреса
    // вида «/api/lots/buy», по которым ничего не понять
    if (path === '/api/lots/bid') {
      return `🔨 Ставка на лот «${body.devName || body.devId || '—'}» — 🪙 ${body.gold || 0}`;
    }
    if (path === '/api/lots/buy') {
      return `🛒 Купил на лотах: ${body.itemName || body.itemId || '—'}` +
             `${body.qty ? ' ×' + body.qty : ''} за 🪙 ${body.gold || 0}` +
             `${body.discountPct ? ` (скидка ${body.discountPct}%)` : ''}`;
    }
    if (path === '/api/admin/vip/grant') {
      return `👑 Выдал VIP игроку ${body.targetName || '—'} на ${body.days || 0} дн.`;
    }
    if (path === '/api/admin/vip/revoke') {
      return `👑 Снял VIP с игрока ${body.targetName || '—'}`;
    }
    if (path === '/api/vip/buy') {
      return `👑 Купил VIP на ${body.days || 7} дн. за 🪙 ${body.gold || 0}`;
    }
    if (path === '/system/lot-win') {
      return `🏆 Выиграл лот «${body.devName || body.devId || '—'}» за 🪙 ${body.gold || 0}`;
    }
    if (path === '/system/lot-refund') {
      return `↩️ Возврат ставки за лот «${body.devName || body.devId || '—'}» — 🪙 ${body.gold || 0}`;
    }
    // Группы (альянс/легион) — общая логика для обоих :kind, чтобы не
    // дублировать 8 действий × 2 вида группы. targetName берём из body,
    // если роут его передаёт (сейчас — нет, тогда просто id).
    const groupMatch = path.match(/^\/api\/group\/(alliance|legion)\/([a-z]+)$/);
    if (groupMatch) {
      const kindLabel = groupMatch[1] === 'alliance' ? 'альянс' : 'легион';
      const action = groupMatch[2];
      switch (action) {
        case 'create':   return `⭐ Создал ${kindLabel} «${body.name}»`;
        case 'apply':    return `📨 Подал заявку в ${kindLabel}`;
        case 'decide':
          return body.accept ? `✅ Принял заявку в ${kindLabel} (игрок ${body.userId})` : `❌ Отклонил заявку в ${kindLabel} (игрок ${body.userId})`;
        case 'invite':   return `📩 Пригласил в ${kindLabel} (игрок ${body.userId})`;
        case 'diplomat': return `🎖 Нанял дипломата для ${kindLabel === 'альянс' ? 'альянса' : 'легиона'}`;
        case 'respond':  return body.accept ? `✅ Принял приглашение в ${kindLabel}` : `❌ Отклонил приглашение в ${kindLabel}`;
        case 'kick':     return `🚫 Исключил из ${kindLabel === 'альянс' ? 'альянса' : 'легиона'} (игрок ${body.userId})`;
        case 'leave':    return `🚪 Покинул ${kindLabel === 'альянс' ? 'альянс' : 'легион'}`;
        default: return null;
      }
    }
    switch (path) {
      // ── Авторизация ────────────────────────────────────────────
      case '/api/register':
        return `📝 Регистрация (страна: ${body.country || '?'}, email: ${body.email || '?'})`;
      case '/api/login':
        return '🔑 Вход в игру';
      // Второй фактор. Сами коды в журнал не попадают и попасть не
      // должны: тело запроса вычищается при записи, а описание строится
      // без него — иначе в журнале лежал бы годный код.
      case '/api/login/2fa-required':
        return '🔐 Вход: запрошен код второго фактора';
      case '/api/login/totp':
        return '🔐 Вход подтверждён вторым фактором';
      case '/api/2fa/setup':
        return '🔐 Получил ключ для приложения-аутентификатора';
      case '/api/2fa/enable':
        return '🔐 Включил второй фактор входа';
      case '/api/2fa/disable':
        return '🔓 Выключил второй фактор входа';
      case '/api/2fa/recovery':
        return '🔐 Перевыпустил коды восстановления';
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
      case '/api/war/mine-defuse':
        return result.exploded ? '💥 Провалил разминирование — взрыв!' : '✂️ Успешно разминировал растяжку';
      case '/api/war/mine-sacrifice':
        return '💀 Пожертвовал смертником, избежав взрыва';
      case '/api/saboteurs/buy':
        return `🥷 Купил диверсантов (${body.type}) ×${(body.packs || 1) * 10}`;
      case '/api/saboteurs/suicide/buy':
        return `💀 Купил смертников ×${body.qty || 1}`;
      case '/api/saboteurs/upgrade':
        return `📈 Повысил лимит диверсантов (${body.type})`;

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
      case '/api/club/arty/start': return '🎯 Клуб: занял позицию (пристрелка)';
      case '/api/club/arty/shoot': return '🎯 Клуб (пристрелка): выстрел';
      case '/api/club/dice/start':  return '🎲 Клуб: бросил военные кости';
      case '/api/club/dice/reroll': return '🎲 Клуб (кости): переброс';
      case '/api/club/dice/finish': return '🎲 Клуб (кости): забрал результат';
      case '/api/club/bids/play':  return '💼 Клуб: сделал ставки на штабном аукционе';

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
      // ── Альянс / Легион: см. groupMatch выше (regex перехватывает раньше) ──

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

      // ── Действия АДМИНА (свой аудит-лог) ────────────────────────
      case '/api/admin/ban':
        return body.banned ? `🚫 Забанил игрока (${body.userId}): ${body.reason || 'без причины'}` : `✅ Разбанил игрока (${body.userId})`;
      case '/api/admin/grant':
        return `🎁 Выдал ресурсы игроку ${body.userId}`;
      case '/api/admin/grant-all':
        return '🌍 Выдал ресурсы всем игрокам';
      case '/api/admin/discount':
        return (body.pct > 0)
          ? `🏷 Установил скидку «${body.category}»: ${body.pct}% на ${body.hours} ч.`
          : `🏷 Снял скидку «${body.category}»`;
      case '/api/admin/global-buff':
        return (body.pct > 0)
          ? `🎉 Включил глобальный бонус «${body.key}»: +${body.pct}% на ${body.hours} ч.`
          : `🎉 Выключил глобальный бонус «${body.key}»`;
      case '/api/admin/reset':
        return `♻️ Полностью обнулил аккаунт игрока ${body.userId}`;
      case '/api/admin/reset-param':
        return `♻️ Сбросил параметр «${body.param}»${body.userId ? ` у игрока ${body.userId}` : ' у ВСЕХ игроков'}`;
      case '/api/admin/reset-missions':
        return '📋 Сбросил миссии у всех игроков';
      case '/api/admin/wipe-groups':
        return `🧹 Очистил группы: ${body.what || 'все'}`;
      case '/api/admin/fame/reset-snapshot':
        return '🏆 Сбросил снимок зала славы';
      case '/api/admin/email/test':
        return `📧 Отправил тестовое письмо на ${body.to}`;
      case '/api/admin/support/reply':
        return `🛟 Ответил в тикет поддержки (${body.ticketId})${body.close ? ' и закрыл его' : ''}`;
      case '/api/admin/event/start':
        return `🐉 Запустил босса «${body.name || '?'}» (HP ${body.hp || '?'})`;
      case '/api/admin/event/stop':
        return '🛑 Остановил текущее событие-босса';
      case '/api/admin/event/drops':
        return '🪙 Изменил настройки дропа золота у босса';
      case '/api/admin/event/hp':
        return `❤️ Установил здоровье босса: ${body.hp}`;
      case '/api/admin/season/config':
        return '🏆 Изменил награды рейтингового сезона';
      case '/api/admin/season/end':
        return '🏁 Принудительно завершил рейтинговую неделю';
      case '/api/admin/legion/deposit':
        return `💰 Пополнил казну легиона ${body.legionId} на $${money(body.amount)} (админ)`;

      // ══════════════════════════════════════════════════════════
      // Ниже — действия, которые до этого показывались сырым адресом
      // вида «/api/lasers/fuel-power». Разбирать по ним жалобы было
      // невозможно: видно, что игрок что-то нажал, а что именно — нет.
      // ══════════════════════════════════════════════════════════

      // ── Учётная запись и вход ──────────────────────────────────
      case '/api/logout':                 return '🚪 Вышел из игры';
      case '/api/change-password':        return '🔑 Сменил пароль';
      case '/api/reset-password':         return '🔑 Задал новый пароль по ссылке восстановления';
      case '/api/request-password-reset': return '✉️ Запросил восстановление пароля';
      case '/api/resend-verification':    return '✉️ Запросил повторное письмо подтверждения';
      case '/api/verify-human':           return '🤖 Прошёл проверку «не бот»';
      case '/api/avatar':                 return '🖼 Сменил аватар';
      case '/api/rename':                 return `✏️ Сменил позывной на «${body.name || '—'}»`;
      case '/api/passport/name':          return `📇 Изменил имя в паспорте на «${body.name || '—'}»`;
      case '/api/passport/country':       return `🏳 Сменил страну на «${body.country || '—'}»`;
      case '/api/account/create':         return `👥 Создал нового персонажа «${body.nick || body.name || '—'}»`;
      case '/api/account/switch':         return '🔄 Переключился на другого персонажа';
      case '/api/account/login':          return `🆔 Задал логин аккаунта «${body.login || '—'}»`;
      case '/api/skill/reset':            return '♻️ Сбросил навыки';

      // ── Уведомления, почта, награды ────────────────────────────
      case '/api/notifications/read-all': return '🔔 Отметил все уведомления прочитанными';
      case '/api/mail/read-all':          return '📬 Прочитал всю почту';
      case '/api/push/subscribe':         return '📲 Включил push-уведомления';
      case '/api/push/unsubscribe':       return '📴 Отключил push-уведомления';
      case '/api/login-reward/claim':     return '🎁 Забрал награду за вход';
      case '/api/war-report/ack':         return '📄 Закрыл сводку «пока вас не было»';
      case '/api/achievements/ack':       return '🏅 Закрыл окно достижения';
      case '/api/rockets/dismiss-hit':    return '🚀 Закрыл отчёт о ракетном ударе';

      // ── Война и разведка ───────────────────────────────────────
      case '/api/spy':
        return `🔍 Разведал игрока${result.targetName ? ` «${result.targetName}»` : ''}`;
      case '/api/war/bank-hack/guess':
        return `🔐 Взлом сейфа: назвал ${body.digit != null ? `цифру ${body.digit}` : 'вариант'}`;
      case '/api/war/bank-hack/skip':     return '🔐 Пропустил попытку взлома сейфа';
      case '/api/war/bank-hack/cancel':   return '🔐 Отказался от взлома сейфа';
      case '/api/war/ear-message':        return '👂 Отправил сообщение вместе с ухом';
      case '/api/sanctions/declare':
        return `⚖️ Объявил санкции против «${body.targetName || body.targetId || '—'}»`;
      case '/api/reinforcements/send':
        return `🤝 Отправил подкрепление «${body.targetName || body.targetId || '—'}»`;
      case '/api/missions/buy-required':
        return '🛒 Докупил технику, которой не хватало для спецоперации';

      // ── Ракетные шахты и лазеры ────────────────────────────────
      case '/api/silos/build':      return '🚀 Заложил ракетную шахту';
      case '/api/silos/boost':      return '⚡ Ускорил постройку ракеты за золото';
      case '/api/silos/fuel-power':
        return `💪 Залил ${body.amount || 0} боеприпасов в мощность ракеты`;
      case '/api/silos/launch':
        return `🚀 Запустил ракету по «${result.targetName || body.targetId || '—'}»` +
               `${result.powerPct != null ? ` (мощность ${result.powerPct}%)` : ''}`;
      case '/api/lasers/build':     return '🔦 Построил лазерную установку';
      case '/api/lasers/boost':     return '⚡ Ускорил постройку лазера за золото';
      case '/api/lasers/fuel-ready':
        return `🔋 Залил ${body.amount || 0} энергии в готовность лазера`;
      case '/api/lasers/fuel-power':
        return `🎯 Залил ${body.amount || 0} боеприпасов в точность лазера`;
      case '/api/lasers/intercept':
        return result.hit ? '🎯 Сбил ракету лазером' : '💨 Промахнулся лазером по ракете';

      // ── Шахты ──────────────────────────────────────────────────
      case '/api/mines/buy-plot':   return '⛏ Купил участок под шахту';
      case '/api/mines/build':      return '⛏ Заложил шахту';
      case '/api/mines/rebuild':    return '🔨 Восстановил разрушенную шахту';
      case '/api/mines/descend':    return '⬇️ Спустился на уровень глубже в шахте';
      case '/api/mines/fight':      return '👊 Бой с охраной в шахте';
      case '/api/mines/dismiss':    return '🚪 Закрыл окно шахты';
      case '/api/market/mines/buy': return '⛏ Купил снаряжение для шахт';

      // ── Поручения ──────────────────────────────────────────────
      case '/api/daily/accept':     return '📋 Взял ежедневное поручение';
      case '/api/daily/accept-all': return '📋 Взял все ежедневные поручения разом';
      case '/api/daily/claim-all':  return '🎁 Забрал награды за ежедневные поручения';
      case '/api/daily/reroll':     return '🎲 Заменил ежедневное поручение';
      case '/api/weekly/accept':    return '🗓 Взял недельное задание';
      case '/api/weekly/claim':     return '🎁 Забрал награду за недельное задание';
      case '/api/weekly/bonus':     return '🎁 Забрал недельный бонус';

      // ── Арена ──────────────────────────────────────────────────
      case '/api/arena/register':   return `🏟 Записался на арену (дивизион ${body.div || '—'})`;
      case '/api/arena/unregister': return '🏟 Снялся с записи на арену';
      case '/api/arena/enter':      return '🏟 Вышел на арену';
      case '/api/arena/attack':     return '⚔️ Удар на арене';
      case '/api/arena/switch':     return '🎯 Сменил цель на арене';
      case '/api/arena/skill':      return `✨ Применил умение на арене${body.skill ? ` «${body.skill}»` : ''}`;
      case '/api/arena/leave':      return '🚪 Покинул бой на арене';

      // ── Групповые бои ──────────────────────────────────────────
      case '/api/group/register':
        return `🤝 Записался на групповой бой${body.role ? ` (роль: ${gbRole(body.role)})` : ''}`;
      case '/api/group/unregister': return '🤝 Снялся с записи на групповой бой';
      case '/api/group/role':       return `🤝 Сменил роль в групповом бою на «${gbRole(body.role)}»`;
      case '/api/group/enter':      return '⚔️ Открыл комнату подготовки группового боя';
      case '/api/group/leave':      return '🚪 Покинул групповой бой';
      case '/api/group/act': {
        const A: Record<string, string> = {
          attack: '⚔️ Атаковал в групповом бою',
          heal:   '➕ Лечил союзника в групповом бою',
          guard:  '🛡 Прикрыл союзника в групповом бою',
        };
        return A[String(body.action)] || `🤝 Действие в групповом бою: ${body.action || '?'}`;
      }
      case '/api/group/upgrade':
        return `📈 Прокачал улучшение групповых боёв «${gbSkill(body.id || body.skill)}»`;
      case '/api/group/supply/buy':
        return `📦 Купил усиление в базе снабжения «${gbBuff(body.kind || body.id)}»`;

      // ── Легион ─────────────────────────────────────────────────
      case '/api/legion/rank':
        return `🎖 Изменил звание в легионе${body.targetName ? `: ${body.targetName}` : ''}`;
      case '/api/legion/chat':          return '💬 Написал в чат легиона';
      case '/api/legion/admin-join':    return '🛡 Вступил в легион (админ)';
      case '/api/legion/admin-deposit': return `💰 Пополнил казну легиона на $${money(body.amount)}`;
      case '/api/legion/battle/direction':
        return `🧭 Перешёл на направление «${body.dirName || body.direction || '—'}»`;
      case '/api/legion/battle/chat':    return '💬 Написал в чат боя легиона';
      case '/api/legion/battle/leave':   return '🚪 Покинул бой легиона';
      case '/api/legion/battle/restore':
        return `♻️ Восстановил в бою: ${RESTORE_RU[String(body.kind)] || body.kind || '—'}`;

      // ── Форум ──────────────────────────────────────────────────
      case '/api/forum/topic':          return `📝 Создал тему «${body.title || '—'}»`;
      case '/api/forum/comment':        return '💬 Оставил комментарий на форуме';
      case '/api/forum/close':          return '🔒 Закрыл тему на форуме';
      case '/api/forum/pin':            return '📌 Закрепил тему на форуме';
      case '/api/forum/delete':         return '🗑 Удалил тему с форума';
      case '/api/forum/delete-comment': return '🗑 Удалил комментарий на форуме';
      case '/api/forum/ban':            return `⛔ Запретил писать на форуме: ${body.targetName || body.userId || '—'}`;
      case '/api/forum/unban':          return `✅ Вернул право писать на форуме: ${body.targetName || body.userId || '—'}`;

      // ── Новости ────────────────────────────────────────────────
      case '/api/news/create': return `📰 Опубликовал новость «${body.title || '—'}»`;
      case '/api/news/update': return `📰 Изменил новость «${body.title || body.id || '—'}»`;
      case '/api/news/delete': return '🗑 Удалил новость';
      case '/api/news/pin':    return '📌 Закрепил новость';

      // ── Поддержка и модерация ──────────────────────────────────
      case '/api/support/create': return `🛟 Создал обращение в поддержку «${body.subject || '—'}»`;
      case '/api/support/reply':  return '🛟 Ответил в своём обращении';
      case '/api/reports/create':
        return `📨 Пожаловался на игрока ${body.targetName || body.targetId || '—'}`;
      case '/api/mod/report/resolve':
        return body.accept ? '✅ Подтвердил жалобу' : '📭 Отклонил жалобу';
      case '/api/mod/report/resolve-all':
        return `${body.accept ? '✅ Подтвердил' : '📭 Отклонил'} все жалобы на игрока ` +
               `${body.targetName || body.targetId || '—'}`;
      case '/api/mod/chat-ban':
        return `🔇 Заблокировал чат игроку ${body.targetName || body.userId || '—'}` +
               `${body.minutes ? ` на ${body.minutes} мин` : ''}`;
      case '/api/mod/chat-unban':
        return `🔊 Снял блокировку чата с ${body.targetName || body.userId || '—'}`;
      case '/api/staff/role':
        return `👔 Назначил роль «${body.role || '—'}» сотруднику ${body.targetName || body.userId || '—'}`;
      case '/api/staff/permissions':
        return `🔧 Изменил права сотрудника ${body.targetName || body.userId || '—'}`;
      case '/api/staff/permissions/reset':
        return `♻️ Сбросил права сотрудника ${body.targetName || body.userId || '—'} к роли`;

      // ── Альянс (личный) ────────────────────────────────────────
      case '/api/alliance/invite':     return `✉️ Позвал в альянс ${body.targetName || body.userId || '—'}`;
      case '/api/alliance/invite-bot': return '🤖 Добавил бота в альянс';
      case '/api/alliance/accept':     return '✅ Принял приглашение в альянс';
      case '/api/alliance/decline':    return '❌ Отклонил приглашение в альянс';
      case '/api/alliance/remove':     return `👢 Убрал из альянса ${body.targetName || body.userId || '—'}`;
      case '/api/alliance/diplomat':   return '🕊 Назначил дипломата альянса';

      // ── Администрирование ──────────────────────────────────────
      case '/api/admin/take':
        return `➖ Изъял у «${body.targetName || body.userId || '—'}»: ${resourceList(body)}`;
      case '/api/admin/rewards/grant':
        return `🎁 Начислил награду «${body.title || body.kind || '—'}»` +
               `${body.targetName ? ` игроку ${body.targetName}` : ' всем'}`;
      case '/api/admin/account-ban':
        return `⛔ Заблокировал аккаунт ${body.targetName || body.userId || '—'}` +
               `${body.minutes ? ` на ${body.minutes} мин` : ' навсегда'}` +
               `${body.reason ? ` — ${body.reason}` : ''}`;
      case '/api/admin/account-unban':
        return `✅ Разблокировал аккаунт ${body.targetName || body.userId || '—'}`;
      case '/api/admin/verify-email':
        return `✉️ Подтвердил почту игроку ${body.targetName || body.userId || '—'}`;
      case '/api/admin/sessions/kick':
        return body.all
          ? `🚪 Выкинул из кабинетов ВСЕХ (закрыто сессий: ${body.killed || 0})`
          : (body.token
            ? `🚪 Закрыл одну сессию${body.target ? ` игрока ${body.target}` : ''} (${body.token})`
            : `🚪 Выкинул из кабинета ${body.name || body.userId || '—'} (закрыто сессий: ${body.killed || 0})`);
      case '/api/admin/mail/template':
        return `✉️ Изменил шаблон письма «${body.id || '—'}»`;
      case '/api/admin/mail/template/default':
        return `↩️ Вернул заводской текст письма «${body.id || '—'}»`;
      case '/api/admin/mail/diagnose':
        return '🔎 Проверил площадку почтового сервиса';
      case '/api/admin/mail/preview':
        return `✉️ Отправил образец письма «${body.id || '—'}» на ${body.to || '—'}`;
      case '/api/admin/mail/broadcast':
        return body.stop ? '⏹ Остановил рассылку писем' : '✉️ Запустил рассылку писем всем игрокам';
      case '/api/admin/set-password':
        return `🔑 Назначил новый пароль игроку ${body.targetName || body.userId || '—'}`;
      case '/api/admin/delete-account':
        return `🗑 Удалил аккаунт ${body.targetName || body.userId || '—'}`;
      case '/api/admin/mines/wipe':
        return `🗑 Очистил шахты игрока ${body.targetName || body.userId || '—'}`;
      case '/api/admin/lobby-reset':
        return '🔄 Сбросил очередь записи на бои';
      case '/api/admin/merc/grant':
        return `⭐ Выдал наёмника «${body.mercName || body.mercId || '—'}» игроку ${body.targetName || '—'}`;
      case '/api/admin/merc/revoke':
        return `⭐ Забрал наёмника у ${body.targetName || body.userId || '—'}`;
      case '/api/admin/event/look':   return '🐉 Изменил внешний вид события-босса';
      case '/api/admin/event/image':  return '🖼 Заменил картинку события-босса';
      case '/api/admin/legion/set':   return `🛡 Изменил настройки легиона ${body.legionId || '—'}`;
      case '/api/admin/legion/battle': return '⚔️ Вмешался в бой легионов';
      case '/api/admin/tournaments/create':
        return `🏆 Создал турнир «${body.name || '—'}»`;
      case '/api/admin/push/broadcast':
        return `📣 Разослал push всем: «${body.title || body.text || '—'}»`;
      case '/api/admin/support/claim':   return `🛟 Взял в работу тикет ${body.ticketId || '—'}`;
      case '/api/admin/support/release': return `🛟 Вернул тикет ${body.ticketId || '—'} в общую очередь`;
      case '/api/admin/db/backup':   return '🗄 Создал копию базы вручную';
      case '/api/admin/db/snapshot':
        return `📸 Сделал снимок коллекции «${body.collection || '—'}»`;
      case '/api/admin/db/restore':
        return `♻️ Откатил коллекцию «${body.collection || '—'}» из снимка #${body.seq || '—'}`;

      default:
        return null;
    }
  } catch (e) {
    return null;
  }
}

export = { describe };
