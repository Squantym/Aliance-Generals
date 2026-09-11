// ===================================================================
// src/services/offers.ts — «Спецпредложения»: наборы, которые владелец
// собирает сам в админ-панели и выставляет в банк.
//
// ЗАЧЕМ ТАК. Раньше всё, что продаётся за деньги, было прибито к коду:
// пакеты золота в payments.ts, подписка в vip.ts, наёмники на аукционе.
// Чтобы предложить игрокам «набор новичка» или «за 199 ₽ — контейнер,
// наёмник и VIP на неделю», приходилось править код и выкатывать сборку.
// Теперь набор — это ЗАПИСЬ: состав, цена, срок и лимит на игрока.
//
// ЧТО ВАЖНО В УСТРОЙСТВЕ:
//  • Состав хранится списком «тип + сколько», а не готовым текстом:
//    выдача и витрина читают один и тот же список, и разойтись им негде.
//  • Выдача идёт ЧУЖИМИ руками — vip.grant, market.grantCommanderDays,
//    player.addGold. Своей выдачи здесь нет: иначе набор стал бы вторым
//    источником золота мимо статистики и лимитов.
//  • Цена может быть в золоте, в рублях или в обоих. Рубли идут через
//    payments: реальная оплата включится вместе с провайдером, набор
//    выдаётся в confirmPayment — то есть после подтверждения, а не при
//    создании заказа.
//
// Хранение: коллекция 'offers' = { [id]: Offer }.
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import type { User, Notices } from '../types';

// Что может лежать в наборе. Список намеренно закрытый: на каждый тип
// есть выдача и человеческое описание, и «просто добавить строку» в
// админке нельзя — иначе игрок купил бы то, что некому выдать.
type ItemType = 'gold' | 'dollars' | 'tokens' | 'skill' | 'xp'
              | 'vip' | 'merc' | 'container' | 'unit';

interface OfferItem {
  type: ItemType;
  id?: string;      // наёмник / техника — что именно
  tier?: number;    // контейнер — какой
  qty?: number;     // количество
  days?: number;    // VIP и наёмник — на сколько суток
}

interface Offer {
  id: string;
  title: string;
  note: string;
  emoji: string;
  items: OfferItem[];
  priceGold: number;      // 0 — за золото не продаётся
  priceRub: number;       // 0 — за рубли не продаётся
  oldPriceGold: number;   // перечёркнутая цена, 0 — не показывать
  oldPriceRub: number;
  startAt: number;        // 0 — сразу
  endAt: number;          // 0 — бессрочно
  limitPerPlayer: number; // 0 — без ограничения
  enabled: boolean;
  sold: number;
  createdAt: number;
  createdBy: string;
}

function store(): Record<string, Offer> {
  return db.load<Record<string, Offer>>('offers', {});
}

// ── Разбор состава ────────────────────────────────────────────────
const ITEM_TYPES: Array<{ id: ItemType; name: string; needs: string }> = [
  { id: 'gold',      name: 'Золото',            needs: 'qty' },
  { id: 'dollars',   name: 'Деньги',            needs: 'qty' },
  { id: 'tokens',    name: 'Жетоны',            needs: 'qty' },
  { id: 'skill',     name: 'Очки навыков',      needs: 'qty' },
  { id: 'xp',        name: 'Опыт',              needs: 'qty' },
  { id: 'vip',       name: 'VIP-подписка',      needs: 'days' },
  { id: 'merc',      name: 'Наёмник',           needs: 'id+days' },
  { id: 'container', name: 'Контейнер',         needs: 'tier+qty' },
  { id: 'unit',      name: 'Техника',           needs: 'id+qty' },
];

// Всё, из чего можно собрать набор — для выпадающих списков в панели
function palette() {
  return {
    types: ITEM_TYPES,
    mercs: (config.COMMANDERS as any[]).map((m) => ({ id: m.id, name: m.name })),
    containers: (config.CONTAINERS as any[]).map((c) => ({ tier: c.tier, id: c.id, name: c.name, gold: c.gold })),
    units: (config.UNITS as any[]).map((x) => ({ id: x.id, name: x.name, type: x.type, unlock: x.unlock })),
  };
}

function cleanItem(raw: any): OfferItem | null {
  const type = String((raw && raw.type) || '') as ItemType;
  if (!ITEM_TYPES.some((t) => t.id === type)) return null;
  const qty = Math.max(0, u.toInt(raw.qty, 0));
  const days = u.clamp(u.toInt(raw.days, 0), 0, 3650);
  switch (type) {
    case 'gold': case 'dollars': case 'tokens': case 'skill': case 'xp':
      return qty > 0 ? { type, qty } : null;
    case 'vip':
      return days > 0 ? { type, days } : null;
    case 'merc': {
      const m = (config.COMMANDERS as any[]).find((x) => x.id === String(raw.id || ''));
      return m && days > 0 ? { type, id: m.id, days } : null;
    }
    case 'container': {
      const c = (config.CONTAINERS as any[]).find((x) => x.tier === u.toInt(raw.tier, 0));
      return c && qty > 0 ? { type, tier: c.tier, qty } : null;
    }
    case 'unit': {
      const un = (config.UNITS as any[]).find((x) => x.id === String(raw.id || ''));
      return un && qty > 0 ? { type, id: un.id, qty } : null;
    }
    default: return null;
  }
}

// Человеческая строка состава — одна на панель и на витрину, чтобы
// владелец видел ровно то же, что увидит игрок
function describeItem(it: OfferItem): string {
  const n = (v: any) => Number(v || 0).toLocaleString('ru-RU');
  switch (it.type) {
    case 'gold':    return `🪙 ${n(it.qty)} золота`;
    case 'dollars': return `$ ${n(it.qty)}`;
    case 'tokens':  return `🎖 ${n(it.qty)} жетонов`;
    case 'skill':   return `✨ ${n(it.qty)} очков навыков`;
    case 'xp':      return `📈 ${n(it.qty)} опыта`;
    case 'vip':     return `👑 VIP на ${n(it.days)} дн.`;
    case 'merc': {
      const m = (config.COMMANDERS as any[]).find((x) => x.id === it.id);
      return `🥷 ${m ? m.name : it.id} на ${n(it.days)} дн.`;
    }
    case 'container': {
      const c = (config.CONTAINERS as any[]).find((x) => x.tier === it.tier);
      return `📦 ${c ? c.name : 'контейнер'} ×${n(it.qty)}`;
    }
    case 'unit': {
      const un = (config.UNITS as any[]).find((x) => x.id === it.id);
      return `🚜 ${un ? un.name : it.id} ×${n(it.qty)}`;
    }
    default: return '—';
  }
}

// Картинка позиции для витрины. Берём ТЕ ЖЕ файлы, что игрок видит в
// игре: значок золота из шапки, коробку контейнера с чёрного рынка,
// портрет наёмника. Набор должен выглядеть набором вещей, а не
// списком строк — по нему решают, платить или нет.
//
// Где своей картинки нет (опыт, VIP), возвращаем null: в описании
// позиции уже стоит эмодзи, и подсовывать чужую картинку хуже, чем
// не показать никакой.
const ICON_OF: Record<string, string> = {
  gold:    '/img/icons/gold.webp',
  dollars: '/img/icons/dollar.webp',
  tokens:  '/img/icons/truce.webp',      // жетоны перемирия
  skill:   '/img/tabs/profile_skills.webp',
};
function itemIcon(it: OfferItem): string | null {
  if (ICON_OF[it.type]) return ICON_OF[it.type];
  if (it.type === 'unit') return `/img/units/${it.id}.webp`;
  if (it.type === 'container') {
    const c = (config.CONTAINERS as any[]).find((x) => x.tier === it.tier);
    return c ? `/img/containers/${c.id}.webp` : null;
  }
  if (it.type === 'merc') return `/img/mercenaries/${it.id}.webp`;
  return null;
}

// ── Админ: список, сохранение, удаление ───────────────────────────
function adminList(actor: User) {
  require('./roles').assertZone(actor, 'economy', 'спецпредложения');
  const all = store();
  const list = Object.values(all)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((o) => Object.assign({}, o, {
      itemsText: o.items.map(describeItem),
      active: isActive(o),
    }));
  return { offers: list, palette: palette() };
}

function isActive(o: Offer): boolean {
  const now = Date.now();
  if (!o.enabled) return false;
  if (o.startAt && now < o.startAt) return false;
  if (o.endAt && now > o.endAt) return false;
  return true;
}

function adminSave(actor: User, data: any, notices: Notices) {
  require('./roles').assertZone(actor, 'economy', 'спецпредложения');
  const all = store();
  const id = String((data && data.id) || '').trim() || u.uid(10);
  const prev = all[id];

  const title = String((data && data.title) || '').trim().slice(0, 60);
  if (!title) throw new u.ApiError('Введите название набора');
  const items = (Array.isArray(data.items) ? data.items : []).map(cleanItem).filter(Boolean) as OfferItem[];
  if (!items.length) throw new u.ApiError('Добавьте в набор хотя бы одну позицию');

  const priceGold = Math.max(0, u.toInt(data.priceGold, 0));
  const priceRub = Math.max(0, u.toInt(data.priceRub, 0));
  if (!priceGold && !priceRub) throw new u.ApiError('Укажите цену — в золоте, в рублях или в обоих');
  // Предел из оферты: одна покупка за деньги — не дороже 9 990 ₽. Без
  // проверки здесь документ обещал бы одно, а конструктор позволял другое.
  const maxRub: number = require('./payments').MAX_PRICE_RUB;
  if (priceRub > maxRub) {
    const shown = String(maxRub).slice(0, -3) + ' ' + String(maxRub).slice(-3);
    throw new u.ApiError(`Цена набора в рублях — не больше ${shown} ₽: этот предел записан в Правилах платежей`);
  }

  const startAt = Math.max(0, u.toInt(data.startAt, 0));
  const endAt = Math.max(0, u.toInt(data.endAt, 0));
  if (startAt && endAt && endAt <= startAt) throw new u.ApiError('Конец показа раньше начала');

  const offer: Offer = {
    id, title,
    note: String((data && data.note) || '').trim().slice(0, 300),
    emoji: String((data && data.emoji) || '🎁').slice(0, 4) || '🎁',
    items, priceGold, priceRub,
    oldPriceGold: Math.max(0, u.toInt(data.oldPriceGold, 0)),
    oldPriceRub: Math.max(0, u.toInt(data.oldPriceRub, 0)),
    startAt, endAt,
    limitPerPlayer: Math.max(0, u.toInt(data.limitPerPlayer, 0)),
    enabled: data.enabled === undefined ? true : !!data.enabled,
    sold: prev ? prev.sold : 0,
    createdAt: prev ? prev.createdAt : Date.now(),
    createdBy: prev ? prev.createdBy : actor.name,
  };
  all[id] = offer;
  db.save('offers');
  try {
    require('./auditLog').record({
      userId: actor.id, userName: actor.name, path: '/api/admin/offers/save',
      body: { id, title, priceGold, priceRub, items: items.length },
    });
  } catch (e) {}
  notices.push(prev ? `🎁 Набор «${title}» обновлён.` : `🎁 Набор «${title}» создан.`);
  return { id, offer };
}

function adminRemove(actor: User, id: string, notices: Notices) {
  require('./roles').assertZone(actor, 'economy', 'спецпредложения');
  const all = store();
  const o = all[String(id || '')];
  if (!o) throw new u.ApiError('Набор не найден');
  delete all[o.id];
  db.save('offers');
  notices.push(`🗑 Набор «${o.title}» удалён.`);
  return { ok: true };
}

// ── Витрина игрока ────────────────────────────────────────────────
function boughtCount(user: User, offerId: string): number {
  const box = (user as any).offersBought || {};
  return Math.max(0, u.toInt(box[offerId], 0));
}

// Карточка набора в том виде, в каком её рисует витрина. Одна сборка
// на две стороны: игроку в банк и владельцу в предпросмотр. Иначе
// предпросмотр показывал бы «примерно то же», а расходиться он начал
// бы с первой правки витрины.
// Значок в начале описания нужен там, где картинки нет: в письмах и
// уведомлениях. В карточке он лишний — рядом уже стоит настоящая
// картинка, а на части систем эмодзи вдобавок рисуется квадратиком.
function withoutLeadIcon(text: string): string {
  return text.replace(/^[^0-9A-Za-zА-Яа-яЁё]+/u, '').trim() || text;
}

function showcase(o: Offer, mine: number) {
  const left = o.limitPerPlayer ? Math.max(0, o.limitPerPlayer - mine) : null;
  return {
    id: o.id, title: o.title, note: o.note, emoji: o.emoji,
    items: o.items.map((it) => {
      const icon = itemIcon(it);
      const text = describeItem(it);
      return { text: icon ? withoutLeadIcon(text) : text, icon };
    }),
    priceGold: o.priceGold, priceRub: o.priceRub,
    oldPriceGold: o.oldPriceGold, oldPriceRub: o.oldPriceRub,
    endsInSec: o.endAt ? Math.max(0, Math.ceil((o.endAt - Date.now()) / 1000)) : null,
    limitPerPlayer: o.limitPerPlayer, boughtByMe: mine, leftForMe: left,
    canBuyGold: o.priceGold > 0 && (left === null || left > 0),
    canBuyRub: o.priceRub > 0 && (left === null || left > 0),
  };
}

function catalog(user: User) {
  const all = store();
  const offers = Object.values(all)
    .filter(isActive)
    .sort((a, b) => (a.endAt || Infinity) - (b.endAt || Infinity) || b.createdAt - a.createdAt)
    .map((o) => showcase(o, boughtCount(user, o.id)));
  return { offers };
}

// ── Предпросмотр для панели ───────────────────────────────────────
// Владелец видит карточку ДО сохранения — ровно ту же, что увидит
// игрок: собирает её тот же showcase из того же очищенного состава.
// Черновик не сохраняется и в базу не попадает.
function adminPreview(actor: User, data: any) {
  require('./roles').assertZone(actor, 'economy', 'спецпредложения');
  const d = data || {};
  const draft: Offer = {
    id: 'preview', title: String(d.title || '').trim().slice(0, 60) || 'Без названия',
    note: String(d.note || '').trim().slice(0, 300),
    emoji: String(d.emoji || '🎁').slice(0, 4) || '🎁',
    items: (Array.isArray(d.items) ? d.items : []).map(cleanItem).filter(Boolean) as OfferItem[],
    priceGold: Math.max(0, u.toInt(d.priceGold, 0)), priceRub: Math.max(0, u.toInt(d.priceRub, 0)),
    oldPriceGold: Math.max(0, u.toInt(d.oldPriceGold, 0)), oldPriceRub: Math.max(0, u.toInt(d.oldPriceRub, 0)),
    startAt: Math.max(0, u.toInt(d.startAt, 0)), endAt: Math.max(0, u.toInt(d.endAt, 0)),
    limitPerPlayer: Math.max(0, u.toInt(d.limitPerPlayer, 0)),
    enabled: d.enabled !== false, sold: 0, createdAt: Date.now(), createdBy: actor.id,
  } as Offer;
  return { offer: showcase(draft, 0), active: isActive(draft) };
}

// ── Выдача содержимого ────────────────────────────────────────────
// Каждая позиция выдаётся тем же кодом, что и обычная выдача в игре:
// у набора нет своей кассы и своих правил.
function grant(user: User, offer: Offer, notices: Notices): string[] {
  const player = require('./player');
  const given: string[] = [];
  for (const it of offer.items) {
    switch (it.type) {
      case 'gold':
        player.addGold(user, it.qty, 'offer');
        break;
      case 'dollars':
        player.addMoney(user, it.qty, false);
        break;
      case 'tokens':
        (user as any).tokens = (Number((user as any).tokens) || 0) + (it.qty || 0);
        break;
      case 'skill':
        user.skillPoints = Math.max(0, (user.skillPoints || 0) + (it.qty || 0));
        break;
      case 'xp':
        player.addXp(user, it.qty, notices);
        break;
      case 'vip':
        require('./vip').grant(null, user, it.days, 'спецпредложение', notices);
        break;
      case 'merc':
        require('./market').grantCommanderDays(user, it.id, it.days, notices);
        break;
      case 'container': {
        const c = (config.CONTAINERS as any[]).find((x) => x.tier === it.tier);
        if (c) require('./market').openContainersFree(user, c, it.qty || 1, notices);
        break;
      }
      case 'unit': {
        const box = player.ensureUnit(user, it.id);
        box[0] = (Number(box[0]) || 0) + (it.qty || 0);
        break;
      }
      default: break;
    }
    given.push(describeItem(it));
  }
  db.markUser(user.id);
  return given;
}

// Отметка «куплено» — по ней считается лимит на игрока
function markBought(user: User, offer: Offer): void {
  const box = ((user as any).offersBought = (user as any).offersBought || {});
  box[offer.id] = (Number(box[offer.id]) || 0) + 1;
  offer.sold = (Number(offer.sold) || 0) + 1;
  db.save('offers');
  db.markUser(user.id);
}

// Общие проверки перед покупкой: набор существует, идёт, лимит не выбран
function assertBuyable(user: User, id: string): Offer {
  const o = store()[String(id || '')];
  if (!o) throw new u.ApiError('Набор не найден');
  if (!isActive(o)) throw new u.ApiError('Предложение больше не действует');
  if (o.limitPerPlayer && boughtCount(user, o.id) >= o.limitPerPlayer) {
    throw new u.ApiError(`Этот набор можно купить ${o.limitPerPlayer} раз(а)`);
  }
  return o;
}

// Покупка за золото — сразу и целиком
function buyForGold(user: User, id: string, notices: Notices) {
  const o = assertBuyable(user, id);
  if (!o.priceGold) throw new u.ApiError('Этот набор за золото не продаётся');
  if ((user.gold || 0) < o.priceGold) {
    throw new u.ApiError(`Не хватает золота: нужно 🪙 ${o.priceGold}, у вас ${user.gold || 0}`);
  }
  require('./player').spendGold(user, o.priceGold, 'offer');
  const given = grant(user, o, notices);
  markBought(user, o);
  notices.push(`🎁 Набор «${o.title}» ваш: ${given.join(', ')}`);
  return { ok: true, id: o.id, given };
}

// Покупка за рубли — заказ уходит в платёжную систему. Набор выдаётся
// ПОСЛЕ подтверждения оплаты (payments.confirmPayment), а не сейчас.
function orderForRub(user: User, id: string, notices: Notices) {
  const o = assertBuyable(user, id);
  if (!o.priceRub) throw new u.ApiError('Этот набор за рубли не продаётся');
  return require('./payments').createOfferOrder(user, {
    id: o.id, title: o.title, priceRub: o.priceRub,
  }, notices);
}

// Выдача по оплаченному заказу: зовёт платёжный модуль
function grantPaid(user: User, offerId: string, notices: Notices): string[] {
  const o = store()[String(offerId || '')];
  if (!o) return [];
  const given = grant(user, o, notices);
  markBought(user, o);
  return given;
}

// Состав набора для квитанции о покупке: те же строки и картинки, что на
// витрине. Снимок берётся в момент оплаты — набор потом могут изменить
// или удалить, а квитанция должна остаться такой, какой была покупка.
function receiptItems(offerId: string): Array<{ text: string; icon: string | null }> {
  const o = store()[String(offerId || '')];
  return o ? showcase(o, 0).items : [];
}

export = {
  palette, describeItem, itemIcon,
  adminList, adminSave, adminRemove, adminPreview, showcase,
  catalog, buyForGold, orderForRub, grantPaid, receiptItems,
};
