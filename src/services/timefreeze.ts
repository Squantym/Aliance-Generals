// ===================================================================
// src/services/timefreeze.ts — заморозка игровых таймеров на обновление
//
// ЗАДАЧА. Игра закрыта на полчаса. У легиона бой был назначен через пять
// минут. Без заморозки бой либо стартует в закрытой игре (и все его
// проигрывают, не сделав ни одного хода), либо стартует сразу после
// открытия — за пять минут до того, как люди успеют вернуться. И то и
// другое — отнятая у игроков война.
//
// РЕШЕНИЕ. Пока игра закрыта, мировой тик не двигает события (см.
// server.ts). А в момент открытия все назначенные сроки сдвигаются
// вперёд ровно на длительность простоя: было «через 5 минут» — снова
// стало «через 5 минут».
//
// ЧТО ИМЕННО СДВИГАЕМ И ПОЧЕМУ ИМЕННО ЭТО
//
//   Замораживаем то, что игрок ПРОПУСТИЛ БЫ: назначенные бои, подготовку,
//   долёт ракет, спуск в шахту, окончание турнира, срок брони, срок бана.
//
//   НЕ замораживаем то, что копится В ЕГО ПОЛЬЗУ без него: доход,
//   регенерация, лечение в госпитале, отрастание уха. Иначе обновление
//   превращалось бы в наказание — игрока и из игры выгнали, и час
//   лечения ему не засчитали.
//
//   Это и есть правило: сдвигаются ТОЧКИ В БУДУЩЕМ (когда что-то
//   случится), а не ЯКОРЯ В ПРОШЛОМ (когда что-то случилось и от чего
//   идёт отсчёт накопления).
//
// КАК ОТЛИЧАЕМ ОДНО ОТ ДРУГОГО. По имени поля и по значению:
//
//   1. Имя оканчивается на At / Until / Till — в проекте так называют
//      моменты времени, и только их.
//   2. Имя НЕ из списка прошлого (createdAt, startedAt, bannedAt …) и не
//      начинается с last… — это записи о случившемся.
//   3. Значение похоже на метку времени в миллисекундах.
//   4. Значение БОЛЬШЕ момента начала простоя — то есть событие ещё не
//      наступило. Прошедшие сроки не трогаем никогда: сдвинуть их значит
//      воскресить уже закончившееся.
//
// Почему по имени, а не по списку конкретных полей. Список конкретных
// полей протух бы на первом же новом таймере: кто-то добавит осаду со
// сроком, забудет вписать её сюда — и она одна поедет мимо заморозки,
// причём молча. Соглашение об именах в проекте выдержано, и правило
// «оканчивается на At» ловит новые поля само.
//
// ПРЕДЕЛ. Простой дольше двенадцати часов не сдвигаем вовсе: окно,
// забытое включённым на трое суток, отодвинуло бы все сроки на трое
// суток вперёд — это уже не заморозка, а порча базы. В таком случае
// пишем в журнал и выходим.
// ===================================================================
import db = require('../core/db');

// Коллекции, в которых живут игровые сроки, и их ПУСТЫЕ ЗНАЧЕНИЯ —
// в точности те же, с какими их читают собственные сервисы.
//
// Перечислены явно по двум причинам. Первая: пройтись «по всему подряд»
// нельзя — в журнале, аналитике и истории лежат записи о прошлом, и
// сдвигать их значит врать истории. Вторая: коллекцию, которую в этом
// процессе ещё никто не читал, придётся прочитать здесь, а прочитать её
// с чужим пустым значением — значит подсунуть владельцу `{}` там, где он
// ждёт `{ chat: [], auctions: [] }`. Поэтому пустое значение указано
// рядом с именем, а тест сверяет эту таблицу с настоящими вызовами.
const COLLECTIONS: Record<string, any> = {
  users: {},
  legions: {},
  alliances: {},
  alliance_invites: {},
  arena: { divs: {}, ratings: {}, results: {} },
  battles: {},
  groupBattle: { registered: {}, slot: 0, battle: null, history: [] },
  rockets: {},
  sanctions: {},
  world: { chat: [], auctions: [], seq: 1 },
  world_event: { active: false },
  discounts: {},
  news: {},
  broadcast: {},
  mail: {},
  sessions: {},
  mailQuota: {},
  dailyFame: {},
};

// Записи о прошлом. Значение у них почти всегда меньше начала простоя, и
// проверка по времени отсеяла бы их сама, — но сотрудник, работавший в
// закрытой игре, мог создать запись прямо во время окна. Тогда её
// createdAt оказался бы «в будущем» и уехал бы вперёд.
const PAST = new Set([
  'at', 'createdAt', 'regAt', 'startedAt', 'finishedAt', 'updatedAt',
  'bannedAt', 'offAt', 'paidAt', 'changedAt', 'resolvedAt', 'collapsedAt',
  'withdrawnAt', 'claimedAt', 'assignedAt', 'launchedAt', 'enabledAt',
  'peakAt', 'firstAt', 'oldestAt', 'newestAt', 'recoveryUsedAt',
  'emailVerifySentAt', 'earsLostAt', 'joinedAt', 'leftAt', 'diedAt',
  'killedAt', 'deletedAt', 'sentAt', 'readAt', 'usedAt', 'seenAt',
  'shownAt', 'openedAt', 'closedAt', 'wonAt', 'lostAt', 'ackAt',
  'frozenFrom',
]);

// Похоже на метку времени в миллисекундах: 2014 год … 2096 год. Отсекает
// и секундные метки (в тысячу раз меньше), и обычные числа вроде цены.
const MIN_MS = 1400000000000;
const MAX_MS = 4000000000000;

const MAX_FREEZE_MS = 12 * 3600 * 1000;
const MIN_FREEZE_MS = 20 * 1000;   // короче — просто шум перезапуска

function isFutureKey(key: string): boolean {
  if (PAST.has(key)) return false;
  if (/^last[A-Z]/.test(key)) return false;  // lastAttackAt и родня — прошлое
  if (/^prev[A-Z]/.test(key)) return false;
  return /(?:At|Until|Till)$/.test(key);
}

type Stat = { moved: number; scanned: number };

// Обход дерева. Глубина ограничена: данные игрока — это объекты в
// объектах на несколько уровней, а не бесконечная структура, и упереться
// в стек на неожиданной ссылке нам тут совершенно ни к чему.
function walk(node: any, from: number, delta: number, st: Stat, seen: Set<any>, depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const v of node) walk(v, from, delta, st, seen, depth + 1);
    return;
  }

  for (const key of Object.keys(node)) {
    const v = (node as any)[key];
    if (typeof v === 'number') {
      st.scanned++;
      if (!isFutureKey(key)) continue;
      if (v < MIN_MS || v > MAX_MS) continue;
      if (v <= from) continue;               // срок уже прошёл — не воскрешаем
      (node as any)[key] = v + delta;
      st.moved++;
    } else if (v && typeof v === 'object') {
      walk(v, from, delta, st, seen, depth + 1);
    }
  }
}

// Сдвинуть все будущие сроки на delta миллисекунд вперёд.
// from — момент, когда игра закрылась: всё, что назначено раньше него,
// уже наступило и не двигается.
//
// Возвращает сводку — её пишут в журнал и показывают в панели: «сколько
// именно сроков переехало» это единственный способ увидеть, что
// заморозка вообще сработала.
function shiftFuture(from: number, delta: number) {
  const res = { ok: false, delta, moved: 0, scanned: 0, collections: [] as string[], why: '' };

  if (!(from > 0) || !(delta > 0)) { res.why = 'нечего сдвигать'; return res; }
  if (delta < MIN_FREEZE_MS) { res.why = 'простой меньше двадцати секунд'; return res; }
  if (delta > MAX_FREEZE_MS) {
    res.why = `простой ${Math.round(delta / 3600000)} ч — больше предела в 12 ч, сроки не трогаем`;
    console.warn(`⏳ Заморозка ПРОПУЩЕНА: ${res.why}`);
    return res;
  }

  for (const name of Object.keys(COLLECTIONS)) {
    let data: any = null;
    try { data = db.load(name, COLLECTIONS[name]); } catch (e) { continue; }
    if (!data || typeof data !== 'object') continue;
    const st: Stat = { moved: 0, scanned: 0 };
    // Свой seen на коллекцию: один и тот же объект в разных коллекциях
    // (игрок в кэше и он же в списке) — это одна и та же ссылка, и
    // сдвинуть его дважды нельзя.
    walk(data, from, delta, st, new Set());
    res.scanned += st.scanned;
    if (st.moved) {
      res.moved += st.moved;
      res.collections.push(`${name}:${st.moved}`);
      try { db.save(name); } catch (e) {}
    }
  }

  res.ok = true;
  console.log(`⏳ Заморозка снята: сроки сдвинуты на ${Math.round(delta / 1000)} с, `
    + `переехало ${res.moved} из ${res.scanned} чисел [${res.collections.join(', ')}]`);
  return res;
}

export = { shiftFuture, isFutureKey, COLLECTIONS, MAX_FREEZE_MS, MIN_FREEZE_MS };
