// ═══════════════════════════════════════════════════════════════════
// src/services/holidays.ts — праздники и акции по расписанию
//
// Раньше праздник собирался руками и в день праздника: зайти в панель,
// поставить скидку, включить бонус опыта, опубликовать новость, а вечером
// вернуться и всё снять. Новый год с восемью днями каникул так не
// поставишь: нужно сидеть у панели каждый день.
//
// Здесь праздник — ЗАПИСЬ: название, начало и конец, и список акций.
// У каждой акции свой тип, свои параметры и свои даты ВНУТРИ праздника —
// поэтому «акция на каждый день каникул» это просто восемь акций подряд.
// Мир проверяет расписание сам (tick) и включает то, чему пришло время.
//
// ЧТО ВАЖНО ПОНИМАТЬ ПРО ОТКЛЮЧЕНИЕ. Скидки и бонусы опыта мы не
// выключаем по таймеру — им отдаётся точное окно, и они гаснут сами
// (discounts.set / globalBuffs.set принимают startAt и endAt). Так
// надёжнее: выключение по тику промахнулось бы, если сервер в эту минуту
// перезапускали, а запись со сроком переживает и перезапуск, и простой.
//
// Пропущенное не навёрстываем: если сервер лежал весь день акции, она
// помечается «не состоялась», а не включается задним числом на час.
//
// Хранение: коллекция 'holidays' — { id: праздник }.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import type { User, Notices } from '../types';

type PromoType = 'discount' | 'xp' | 'giveaway' | 'news';
type PromoState = 'wait' | 'live' | 'done' | 'missed' | 'error';

interface Promo {
  id: string;
  type: PromoType;
  startAt: number;
  endAt: number;
  category?: string;      // скидка: какая категория
  pct?: number;           // скидка и бонус опыта: проценты
  giveawayId?: string;    // раздача: какую включить
  title?: string;         // новость: заголовок
  text?: string;          // новость: текст
  pinned?: boolean;       // новость: закрепить полосой
  popup?: boolean;        // новость: показать окном при входе
  state: PromoState;
  firedAt?: number;
  error?: string;
}

interface Holiday {
  id: string;
  name: string;
  note: string;
  startAt: number;
  endAt: number;
  enabled: boolean;
  promos: Promo[];
  createdAt: number;
  byId: string;
  byName: string;
}

// Типы акций. Раздача и новость — ссылки на то, что уже есть в игре:
// раздачу собирают в своём разделе (там состав награды и «по дням»),
// здесь только назначается её окно.
const TYPES: Record<PromoType, string> = {
  discount: 'Скидка на категорию',
  xp:       'Бонус опыта всем',
  giveaway: 'Включить раздачу наград',
  news:     'Новость',
};

const MAX_PROMOS = 40;          // Новый год с акцией на каждый день — 8
const DAY_MS = 24 * 3600 * 1000;

function store(): Record<string, Holiday> { return db.load<Record<string, Holiday>>('holidays', {}); }
function users(): Record<string, User> { return require('./player').users(); }

// Зона «Акции» — та же, что у скидок и бонусов к покупкам: праздник
// раздаёт ровно то же самое, только по расписанию.
function assertZone(actor: User): void {
  require('./roles').assertZone(actor, 'discounts', 'праздники и акции');
}

// ── Проверка и чистка одной акции ─────────────────────────────────
// Границы акции прижимаем к празднику: акция, которая идёт после конца
// праздника, — это не акция праздника, а забытая строка в расписании.
function cleanPromo(raw: any, hol: { startAt: number; endAt: number }, prev: Promo | null, actor: User): Promo {
  const b = raw || {};
  const type = (Object.keys(TYPES).indexOf(String(b.type)) >= 0 ? String(b.type) : '') as PromoType;
  if (!type) throw new u.ApiError('У акции не указан тип');

  let startAt = Math.max(0, u.toInt(b.startAt, 0)) || hol.startAt;
  let endAt = Math.max(0, u.toInt(b.endAt, 0)) || hol.endAt;
  startAt = Math.max(startAt, hol.startAt);
  endAt = Math.min(endAt, hol.endAt);
  if (endAt <= startAt) throw new u.ApiError(`«${TYPES[type]}»: окончание акции раньше её начала`);

  const promo: Promo = {
    id: prev ? prev.id : u.uid(8),
    type, startAt, endAt,
    state: prev ? prev.state : 'wait',
    firedAt: prev ? prev.firedAt : 0,
  };

  if (type === 'discount') {
    const cats = require('./discounts').categories().map((c: any) => c.id);
    promo.category = String(b.category || '');
    if (cats.indexOf(promo.category) === -1) throw new u.ApiError('У скидки не выбрана категория');
    // Проверяем ВВЕДЁННОЕ, а не приведённое: подожми сначала к
    // допустимому диапазону — и ноль превратился бы в единицу, то есть
    // пустое поле молча стало бы скидкой в один процент.
    const pct = u.toInt(b.pct, 0);
    if (pct <= 0) throw new u.ApiError('Укажите процент скидки');
    promo.pct = Math.min(99, pct);
  } else if (type === 'xp') {
    const pct = u.toInt(b.pct, 0);
    if (pct <= 0) throw new u.ApiError('Укажите процент бонуса опыта');
    promo.pct = Math.min(1000, pct);
  } else if (type === 'giveaway') {
    promo.giveawayId = String(b.giveawayId || '');
    const list = require('./giveaways').listBrief();
    if (!list.some((g: any) => g.id === promo.giveawayId)) {
      throw new u.ApiError('Выберите раздачу — её сначала нужно собрать в разделе «Раздачи наград»');
    }
  } else {
    promo.title = String(b.title || '').trim().slice(0, 200);
    promo.text = String(b.text || '').trim().slice(0, 4000);
    if (!promo.title || !promo.text) throw new u.ApiError('У новости нужны заголовок и текст');
    promo.pinned = !!b.pinned;
    promo.popup = !!b.popup;
    // Новость публикуется от имени того, кто завёл праздник. Если права
    // на новости у него нет, публиковать будет некому — и узнать об этом
    // лучше сейчас, а не в день праздника из журнала ошибок.
    if (!require('./roles').canAccessZone(actor, 'news')) {
      throw new u.ApiError('Новости публикует тот, у кого есть раздел «Новости». Уберите акцию-новость или попросите добавить право.');
    }
  }
  // Изменение параметров уже отработавшей акции — это новая акция:
  // иначе правка задним числом молча не сработала бы.
  if (prev && prev.state !== 'wait' && changed(prev, promo)) { promo.state = 'wait'; promo.firedAt = 0; }
  return promo;
}

// Сравниваем то, что влияет на срабатывание, а не служебные поля
function changed(a: Promo, b: Promo): boolean {
  const key = (promo: Promo) => [promo.type, promo.startAt, promo.endAt, promo.category || '', promo.pct || 0,
    promo.giveawayId || '', promo.title || '', promo.text || '', promo.pinned ? 1 : 0, promo.popup ? 1 : 0].join('|');
  return key(a) !== key(b);
}

// ── Панель: список праздников и справочники для формы ─────────────
function adminList(actor: User) {
  assertZone(actor);
  const now = Date.now();
  const all = store();
  const holidays = Object.values(all)
    .sort((a, b) => a.startAt - b.startAt)
    .map((h) => ({
      ...h,
      status: !h.enabled ? 'off' : (now < h.startAt ? 'wait' : (now < h.endAt ? 'live' : 'done')),
      // Сработавшую акцию с прошедшим сроком показываем как завершённую:
      // в записи она остаётся 'live', чтобы её не включили второй раз.
      promos: (h.promos || []).map((promo) => ({
        ...promo,
        typeName: TYPES[promo.type] || promo.type,
        shown: promo.state === 'live' && now >= promo.endAt ? 'done' : promo.state,
      })),
    }));
  // Список раздач короткий и без прав на сам раздел: выбрать готовую
  // раздачу по названию должен уметь и тот, у кого есть только «Акции».
  const giveaways = require('./giveaways').listBrief();
  return {
    holidays,
    types: Object.entries(TYPES).map(([id, name]) => ({ id, name })),
    categories: require('./discounts').categories(),
    giveaways,
    canNews: require('./roles').canAccessZone(actor, 'news'),
    now,
  };
}

// ── Создать или изменить праздник ─────────────────────────────────
function adminSave(actor: User, data: any, notices: Notices) {
  assertZone(actor);
  const b = data || {};
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw new u.ApiError('Назовите праздник');
  const startAt = Math.max(0, u.toInt(b.startAt, 0));
  const endAt = Math.max(0, u.toInt(b.endAt, 0));
  if (!startAt || !endAt) throw new u.ApiError('Укажите начало и конец праздника');
  if (endAt <= startAt) throw new u.ApiError('Праздник заканчивается раньше, чем начинается');
  if (endAt - startAt > 90 * DAY_MS) throw new u.ApiError('Праздник дольше 90 дней — это уже не праздник');

  const all = store();
  const prev = b.id ? all[String(b.id)] : null;
  const raw = Array.isArray(b.promos) ? b.promos.slice(0, MAX_PROMOS) : [];
  const promos = raw.map((r: any) => cleanPromo(
    r, { startAt, endAt }, prev ? (prev.promos || []).find((x) => x.id === r.id) || null : null, actor));

  const id = prev ? prev.id : u.uid(10);
  all[id] = {
    id, name,
    note: String(b.note || '').trim().slice(0, 300),
    startAt, endAt,
    enabled: b.enabled !== false,
    promos,
    createdAt: prev ? prev.createdAt : Date.now(),
    // Автор нужен не для красоты: от его имени публикуется новость
    byId: prev ? prev.byId : actor.id,
    byName: prev ? prev.byName : String(actor.name || ''),
  };
  db.save('holidays');
  notices.push(`📅 Праздник «${name}» ${prev ? 'изменён' : 'создан'}: акций ${promos.length}.`);
  return adminList(actor);
}

function adminRemove(actor: User, id: string, notices: Notices) {
  assertZone(actor);
  const all = store();
  const h = all[String(id || '')];
  if (!h) throw new u.ApiError('Праздник не найден');
  delete all[h.id];
  db.save('holidays');
  // Уже включённые акции живут своим сроком: их выдали игрокам, и
  // отнимать задним числом нельзя. Удаление отменяет только будущее.
  notices.push(`🗑 Праздник «${h.name}» удалён. Уже начатые акции доработают свой срок.`);
  return adminList(actor);
}

function adminToggle(actor: User, id: string, on: boolean, notices: Notices) {
  assertZone(actor);
  const all = store();
  const h = all[String(id || '')];
  if (!h) throw new u.ApiError('Праздник не найден');
  h.enabled = !!on;
  db.save('holidays');
  notices.push(h.enabled
    ? `✅ Праздник «${h.name}» включён — акции пойдут по расписанию.`
    : `🚫 Праздник «${h.name}» выключен. Ещё не начатые акции не сработают.`);
  return adminList(actor);
}

// ── Включение одной акции ─────────────────────────────────────────
// Скидке и бонусу отдаём точное окно: дальше они гаснут сами.
function fire(h: Holiday, promo: Promo): void {
  if (promo.type === 'discount') {
    require('./discounts').set(promo.category, promo.pct, 0, 0, { startAt: promo.startAt, endAt: promo.endAt });
    return;
  }
  if (promo.type === 'xp') {
    require('./globalBuffs').set('xp', promo.pct, 0, { startAt: promo.startAt, endAt: promo.endAt });
    return;
  }
  if (promo.type === 'giveaway') {
    const ok = require('./giveaways').schedule(promo.giveawayId, promo.startAt, promo.endAt);
    if (!ok) throw new u.ApiError('Раздача удалена — включать нечего');
    return;
  }
  const author = users()[h.byId];
  if (!author) throw new u.ApiError('Автор праздника удалён — новость публиковать не от кого');
  require('./news').create(author, {
    title: promo.title, emoji: '🎉', tag: h.name,
    blocks: [{ type: 'text', text: promo.text }],
    pinned: !!promo.pinned, popup: !!promo.popup,
  }, []);
}

// ── Расписание: что пора включать ─────────────────────────────────
// Зовётся хозяйственной половиной мирового тика — той, что работает и
// при закрытой игре: праздник, начавшийся во время обновления, не должен
// пропасть из-за того, что мир стоял.
function tick(): number {
  const now = Date.now();
  const all = store();
  let fired = 0, dirty = false;
  for (const h of Object.values(all)) {
    if (!h || !h.enabled || !Array.isArray(h.promos)) continue;
    for (const promo of h.promos) {
      if (promo.state !== 'wait') continue;
      if (now < promo.startAt) continue;
      if (now >= promo.endAt) {
        // Окно прошло целиком, пока никто не смотрел
        promo.state = 'missed';
        dirty = true;
        continue;
      }
      try {
        fire(h, promo);
        promo.state = 'live';
        promo.firedAt = now;
        delete promo.error;
        fired++;
      } catch (e: any) {
        // Одна сломанная акция не должна останавливать остальные
        promo.state = 'error';
        promo.error = String((e && e.message) || e).slice(0, 200);
        console.error(`Акция праздника «${h.name}» не включилась:`, promo.error);
      }
      dirty = true;
    }
  }
  if (dirty) db.save('holidays');
  return fired;
}

export = { adminList, adminSave, adminRemove, adminToggle, tick, TYPES, MAX_PROMOS };
