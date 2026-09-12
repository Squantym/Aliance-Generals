// ===================================================================
// src/services/discounts.ts — глобальные скидки и бонусы от админа
// Хранятся в коллекции 'discounts' одним объектом:
//   { unit: {pct:20, expires:1234}, building: {...}, ... }
// Категории (ключи) — см. CATEGORIES ниже.
// Скидки уменьшают цену; бонус «gold» увеличивает количество золота
// при покупке (когда вкладка покупки золота будет добавлена).
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');

// Категории скидок: id → человекочитаемое название
const CATEGORIES: Record<string, string> = {
  unit:        'Покупка техники',
  building:    'Постройки (доходные и оборонительные)',
  modernize:   'Производство (модернизация Mk1/Mk2)',
  workshop:    'Покупка цехов производства',
  market:      'Чёрный рынок: допинг и падлянки',
  container:   'Контейнеры контрабанды',
  trophy:      'Прокачка трофеев',
  alliance:    'Создание альянса',
  legion:      'Создание легиона',
  gold:        'Бонус к покупаемому золоту',
  mine:        'Шахты (золотодобыча)',
  silo:        'Ракетные шахты',
  saboteur:    'Диверсанты (пачки, смертники, лимиты)',
  laser:       'Лазерные установки',
};

function store(): Record<string, any> { return db.load('discounts', {}); }

// Активные скидки на сейчас: ТОЛЬКО те, что уже наступили (startAt <= now)
// и ещё не истекли (expires > now). Запланированные на будущее скидки
// сюда не попадают — applyTo() их не учитывает, пока не наступит время.
function getActive(): Record<string, { pct: number; expires: number }> {
  const now = Date.now();
  const all = store();
  const out: Record<string, { pct: number; expires: number }> = {};
  for (const cat of Object.keys(CATEGORIES)) {
    const d = all[cat];
    if (d && d.expires > now && d.pct > 0 && (d.startAt || 0) <= now) {
      out[cat] = { pct: d.pct, expires: d.expires };
    }
  }
  return out;
}

// Текущая скидка по категории — число в процентах (0..99) либо 0
function pctOf(category: string): number {
  const a = getActive();
  return a[category] ? a[category].pct : 0;
}

// Применить скидку к цене. price * (1 - pct/100), округление вниз до целого
// user необязателен: если передан и у игрока действует VIP, к акции
// добавляется его скидка. Итог ограничен 50%, но если администрация
// сама выставила больше — её значение остаётся, надбавка не идёт.
function applyTo(category: string, price: number, user?: any): number {
  let pct = pctOf(category);
  if (user && (category === 'market' || category === 'container')) {
    try { pct = require('./vip').marketDiscountPct(user, pct); } catch (e) {}
  }
  if (pct <= 0) return Math.round(price);
  return Math.max(0, Math.floor(price * (1 - pct / 100)));
}

// Множитель бонуса (для категории gold — увеличивает покупаемое золото)
function bonusMul(category: string, user?: any): number {
  let pct = pctOf(category);
  // VIP: +15% к покупаемому золоту поверх акции (акция 50% → итого 65%)
  if (user && category === 'gold') {
    try { pct = require('./vip').goldPurchaseBonusPct(user, pct); } catch (e) {}
  }
  return 1 + pct / 100;
}

// Установить скидку: pct% на durationHours часов, с возможностью отложенного
// старта через delayHours (по умолчанию 0 — начинается сразу).
// pct=0 или duration<=0 — снять скидку немедленно.
// Срок задаётся ЛИБО длительностью в часах (старый способ, им пользуются
// быстрые правки и тесты), ЛИБО точными датами начала и конца — их удобнее
// задавать под праздник, который начинается в конкретный день и час.
function set(category: string, pct: number, durationHours: number, delayHours?: number,
             when?: { startAt?: number; endAt?: number }) {
  if (!CATEGORIES[category]) throw new u.ApiError('Неизвестная категория скидки');
  pct = Math.max(0, Math.min(99, u.toInt(pct, 0)));
  const hours = Math.max(0, Number(durationHours) || 0);
  const delay = Math.max(0, Number(delayHours) || 0);
  const endAt = Math.max(0, Number(when && when.endAt) || 0);
  const startAt = Math.max(0, Number(when && when.startAt) || 0);
  const byDates = endAt > 0;
  if (byDates) {
    const from = startAt || Date.now();
    if (endAt <= from) throw new u.ApiError('Окончание скидки раньше её начала');
  }
  const all = store();
  if (pct === 0 || (!byDates && hours === 0)) {
    delete all[category];
  } else if (byDates) {
    all[category] = { pct, startAt: startAt || Date.now(), expires: endAt };
  } else {
    const from = Date.now() + Math.round(delay * 3600 * 1000);
    all[category] = { pct, startAt: from, expires: from + Math.round(hours * 3600 * 1000) };
  }
  db.save('discounts');
  return all[category] || null;
}

// Получить список всех категорий для админки (для формы выбора)
function categories() {
  return Object.entries(CATEGORIES).map(([id, name]) => ({ id, name }));
}

// Все запланированные/активные скидки (включая ещё не наступившие) — для
// отображения в админке полного расписания
function allScheduled() {
  const now = Date.now();
  const all = store();
  return Object.entries(all)
    .filter(([cat, d]) => d && d.expires > now)
    .map(([cat, d]) => ({
      category: cat, label: CATEGORIES[cat] || cat,
      pct: d.pct, startAt: d.startAt || 0, expires: d.expires,
      pending: (d.startAt || 0) > now,
    }));
}

// Куда ведёт акция: игрок из общего списка должен попадать сразу в тот
// раздел, где скидка действует, а не искать его по меню.
const SCREEN_OF: Record<string, string> = {
  unit: 'units', building: 'buildings', modernize: 'production/workshops',
  workshop: 'production/workshops', market: 'market/buffs', container: 'market/containers',
  trophy: 'trophies', alliance: 'alliance', legion: 'legion', gold: 'bank',
  mine: 'production/mines', silo: 'production/silos', saboteur: 'saboteurs',
  laser: 'production/lasers',
};

// Короткая строка для полосы над разделом: «Скидка на … — 50%».
// «Золото» стоит особняком: там не скидка, а надбавка к покупке, и
// назвать её скидкой значит соврать игроку на самом видном месте.
function headline(category: string, pct: number): string {
  const label = CATEGORIES[category] || category;
  return category === 'gold'
    ? `Бонус +${pct}% к покупаемому золоту`
    : `Скидка на «${label}» — ${pct}%`;
}

// Все действующие акции разом — для полосы со списком внизу страницы
function activeList() {
  const a = getActive();
  const items = Object.keys(a).map((cat) => ({
    category: cat,
    label: CATEGORIES[cat] || cat,
    headline: headline(cat, a[cat].pct),
    pct: a[cat].pct,
    expiresAt: a[cat].expires,
    screen: SCREEN_OF[cat] || '',
  }));
  // Раньше кончается — выше в списке: по нему решают, куда бежать
  items.sort((x, y) => x.expiresAt - y.expiresAt);
  return { items };
}

// Информация об активной скидке для отображения в UI (или null)
function info(category: string) {
  const a = getActive();
  if (!a[category]) return null;
  return {
    pct: a[category].pct,
    expiresAt: a[category].expires,
    label: CATEGORIES[category] || category,
    headline: headline(category, a[category].pct),
    screen: SCREEN_OF[category] || '',
  };
}

export = { getActive, info, activeList, headline, pctOf, applyTo, bonusMul, set, categories, allScheduled, CATEGORIES };
