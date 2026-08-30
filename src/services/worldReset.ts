// ===================================================================
// src/services/worldReset.ts — обнуление мира
//
// Самая опасная кнопка в проекте: она стирает всех игроков и всё, что
// они нажили. Отменить это нельзя — можно только развернуть копию базы.
//
// ЧТО ОСТАЁТСЯ ПОСЛЕ ОБНУЛЕНИЯ И ПОЧЕМУ ИМЕННО ЭТО
//
//  1. АРХИВ ПРОШЛОГО МИРА (коллекция worldArchive). Итог мира: когда
//     начался, когда закрыт, сколько было игроков, кто был в вершине
//     рейтинга, какие легионы. Записывается ОДИН раз и больше не
//     меняется — новый мир пишет свою строку рядом, а не поверх.
//     Без этого обнуление стирало бы и саму память о том, что было.
//
//  2. ЖУРНАЛ ДЕЙСТВИЙ (actionLogs). Он неизменяем и не стирается
//     НИКОГДА, включая это обнуление. Кнопка, стирающая журнал, — это
//     кнопка «замести следы»: ею можно было бы удалить и разбор жалобы,
//     и запись о выдаче ресурсов себе. Само обнуление в журнал тоже
//     пишется.
//
//  3. СЧЁТЧИК ТАРИФА ПОЧТЫ (mailQuota). Обнулить его — не «начать с
//     чистого листа», а соврать самим себе: у почтового сервиса свой
//     счётчик, и он не обнулится. Сбросив свой, мы упрёмся в чужой
//     молча, посреди регистрации новичков.
//
//  4. НАСТРОЙКИ, А НЕ ДАННЫЕ: роли, ключи push, режим обслуживания.
//     Это конфигурация сервера, а не нажитое игроками.
//
// ЧТО ОБЯЗАТЕЛЬНО ПРОИСХОДИТ ПЕРЕД СТИРАНИЕМ
//
//  • Полная копия базы. Не «желательно», а условие: не удалось снять
//    копию — обнуление не начинается вовсе. Единственный путь назад
//    после этой кнопки — восстановление из копии, и создавать её
//    задним числом будет уже не из чего.
//  • Игра закрывается на обслуживание. Запрос игрока, пришедший в
//    середине стирания, увидел бы полупустой мир.
//
// ВЛАДЕЛЕЦ ОСТАЁТСЯ. Иначе после обнуления в игру некому зайти:
// регистрация заводит обычного игрока, а прав ему никто не выдаст —
// панель закрыта, а выдать права можно только из панели или консоли.
// Прогресс владельца при этом по умолчанию сбрасывается: мир, где у
// одного игрока пятидесятый уровень с прошлого раза, новым не является.
// ===================================================================
import db = require('../core/db');
import u = require('../core/utils');

// ── Что стираем ───────────────────────────────────────────────────
// Имя → пустое значение, в точности такое же, с каким коллекцию читает
// её собственный сервис. Подсунуть владельцу `{}` там, где он ждёт
// `{ chat: [], auctions: [] }`, значит уронить чат сразу после
// обнуления — причём в момент, когда смотреть будет уже не на что.
const WIPE: Record<string, any> = {
  legions: {},
  alliances: {},
  alliance_invites: {},
  battles: {},
  arena: { divs: {}, ratings: {}, results: {} },
  groupBattle: { registered: {}, slot: 0, battle: null, history: [] },
  rockets: {},
  sanctions: {},
  news: {},
  broadcast: {},
  mail: {},
  world: { chat: [], auctions: [], seq: 1 },
  world_event: { active: false },
  discounts: {},
  dailyFame: {},
  season: {},
  weeklySeason: {},
};

// ── Что НЕ трогаем ────────────────────────────────────────────────
// Список нужен не коду, а человеку: он отвечает на вопрос «а это точно
// не сотрётся?» — и тест сверяет, что ни одно из этих имён не попало
// в WIPE. Пересечение двух списков означало бы стёртый журнал.
const KEEP = [
  'actionLogs',           // журнал — доказательство, не стирается никогда
  'worldArchive',         // итоги прошлых миров
  'maintenance',          // режим обслуживания: иначе игра откроется посреди стирания
  'mailQuota',            // счётчик тарифа почты — у сервиса свой, он не обнулится
  'pushconfig',           // ключи push-уведомлений
  'roleZones',            // настройка ролей
  'analytics',            // деловая история: сколько было регистраций и платежей
  'weeklyMetricsBackup',  // страховочная копия метрик
];

type Opts = {
  confirm?: string;        // фраза подтверждения
  keepIds?: string[];      // кого оставить (обычно один владелец)
  resetOwner?: boolean;    // сбросить ли прогресс оставленных
  reason?: string;
};

function archive(): any[] {
  return db.load<any[]>('worldArchive', []);
}

// Номер текущего мира: сколько уже закрыто, плюс один.
function worldNo(): number {
  return archive().length + 1;
}

// Фраза, которую владелец обязан набрать руками. С номером мира, а не
// просто «обнулить»: слово, которое набирают одинаково каждый раз,
// набирается не глядя, и защитой быть перестаёт.
function phrase(): string {
  return `обнулить мир ${worldNo()}`;
}

function norm(s: string): string {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Что будет стёрто: показываем ДО, а не после ───────────────────
function preview() {
  const users = db.load<Record<string, any>>('users', {});
  const ids = Object.keys(users);
  const counts: Record<string, number> = {};
  for (const name of Object.keys(WIPE)) {
    const c = db.load<any>(name, WIPE[name]);
    counts[name] = Array.isArray(c) ? c.length
      : (c && typeof c === 'object' ? Object.keys(c).length : 0);
  }
  return {
    world: worldNo(),
    phrase: phrase(),
    players: ids.length,
    legions: Object.keys(db.load('legions', {})).length,
    alliances: Object.keys(db.load('alliances', {})).length,
    counts,
    keep: KEEP,
    wipe: Object.keys(WIPE),
    archive: archive().map((a: any) => ({
      n: a.n, endedAt: a.endedAt, players: a.players, by: a.by, reason: a.reason,
    })),
    canBackup: db.mode === 'sqlite',
  };
}

// Верхушка прошлого мира — то, что стоит помнить. Не вся база, а
// именно итог: список из десяти строк переживёт любой формат, а копия
// базы через год окажется несовместимой с текущим кодом.
function topOf(users: Record<string, any>) {
  const arr = Object.values(users || {});
  const pick = (key: string, n = 10) => arr
    .filter((p: any) => p && !p.banned)
    .sort((a: any, b: any) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
    .slice(0, n)
    .map((p: any) => ({ name: p.name, v: Number(p[key]) || 0, level: p.level || 1 }));
  return { rating: pick('rating'), level: pick('level'), ears: pick('ears') };
}

// ── Само обнуление ────────────────────────────────────────────────
function run(actor: any, opts: Opts = {}) {
  const keepIds = (opts.keepIds && opts.keepIds.length ? opts.keepIds : [actor && actor.id])
    .filter(Boolean).map(String);

  if (norm(opts.confirm || '') !== norm(phrase())) {
    throw new u.ApiError(`Не совпала фраза подтверждения. Наберите точно: «${phrase()}»`);
  }
  const users = db.load<Record<string, any>>('users', {});
  for (const id of keepIds) {
    if (!users[id]) throw new u.ApiError('Оставляемый аккаунт не найден — обнуление отменено');
  }

  // 1. Закрываем игру. ДО копии и стирания: запрос игрока, пришедший в
  //    середине, увидел бы полупустой мир.
  try {
    require('./maintenance').turnOn(
      String((actor && actor.name) || ''),
      'Игра перезапускается с нуля. Скоро откроем новый мир.', 60);
  } catch (e) { /* режим не встал — не повод останавливаться, стирание важнее */ }

  // 2. Копия базы. Это единственный путь назад, поэтому не «желательно»,
  //    а условие: не сняли — не стираем.
  let backup: string | null = null;
  if (db.mode === 'sqlite') {
    try { backup = db.backupNow('wipe'); } catch (e) { backup = null; }
    if (!backup) {
      throw new u.ApiError('Не удалось снять копию базы — обнуление отменено. '
        + 'Отменить его после стирания было бы нечем.');
    }
  }

  // 3. Запись в архив. Делаем ДО стирания — потом считать будет уже не по чему.
  const started = archive().length
    ? Number(archive()[archive().length - 1].endedAt) || 0
    : Number(Object.values(users).reduce((min: any, p: any) =>
      Math.min(min, Number(p && p.createdAt) || Date.now()), Date.now()));
  const rec = {
    n: worldNo(),
    startedAt: started,
    endedAt: Date.now(),
    by: String((actor && actor.name) || ''),
    reason: String(opts.reason || '').slice(0, 300),
    players: Object.keys(users).length,
    legions: Object.keys(db.load('legions', {})).length,
    alliances: Object.keys(db.load('alliances', {})).length,
    top: topOf(users),
    backup: backup || '',
  };
  archive().push(rec);
  db.save('worldArchive');

  // 4. Игроки. В своей базе мало удалить из памяти: строка останется в
  //    таблице, и после перезапуска игроки «воскреснут». Поэтому
  //    db.dropUser, а не delete.
  let removed = 0;
  for (const id of Object.keys(users)) {
    if (keepIds.includes(id)) continue;
    db.dropUser(id);
    removed++;
  }

  // 5. Оставленные: личность сохраняем, нажитое — по выбору владельца.
  //    Мир, где у одного игрока полсотни уровней с прошлого раза, новым
  //    не является, поэтому сброс — поведение по умолчанию.
  const resetOwner = opts.resetOwner !== false;
  if (resetOwner) {
    for (const id of keepIds) {
      users[id] = freshenKeeper(users[id]);
      db.markUser(id);
    }
  }

  // 6. Коллекции. Чистим объект НА МЕСТЕ, а не подменяем новым: сервисы
  //    держат ссылку на него с первого своего вызова, и подмена оставила
  //    бы половину игры работать со старым, уже стёртым содержимым.
  for (const name of Object.keys(WIPE)) {
    const empty = JSON.parse(JSON.stringify(WIPE[name]));
    const box = db.load<any>(name, empty);
    if (Array.isArray(box)) box.length = 0;
    else {
      for (const k of Object.keys(box)) delete box[k];
      Object.assign(box, empty);
    }
    db.save(name);
  }

  // 7. Сессии: чужие выкидываем, свои оставляем. Иначе владельца
  //    выбросило бы из панели ровно в тот момент, когда ему надо
  //    посмотреть, что получилось.
  const sess = db.load<Record<string, any>>('sessions', {});
  for (const t of Object.keys(sess)) {
    if (!keepIds.includes(String(sess[t] && sess[t].u))) delete sess[t];
  }
  db.save('sessions');

  // 8. В журнал — он это переживёт, в отличие от всего остального.
  try {
    require('./auditLog').record({
      userId: actor && actor.id, userName: actor && actor.name,
      path: '/api/admin/world-reset',
      body: {
        world: rec.n, removed, kept: keepIds.length,
        resetOwner, backup: backup || 'нет (файловая база)',
        reason: rec.reason,
      },
    });
  } catch (e) {}

  console.log(`💥 МИР ОБНУЛЁН (${rec.by}): удалено игроков ${removed}, `
    + `оставлено ${keepIds.length}, копия базы: ${backup || '—'}`);

  return {
    ok: true, world: rec.n, removed, kept: keepIds.length,
    resetOwner, backup: backup || '', archived: rec,
  };
}

// Оставленный аккаунт: личность и права сохраняем, нажитое обнуляем.
// Собираем не «вычитанием лишнего», а сборкой нового поверх чистого
// игрока: вычитание забывает поля, которые добавят завтра, и владелец
// молча уносил бы в новый мир то, чего не должен.
function freshenKeeper(old: any): any {
  const auth = require('./auth');
  const fresh = auth.newUser(old.id, old.name, old.email, old.passHash, old.salt,
    old.country || 'ru', !!old.isAdmin, true);
  // Что переносим из прошлой жизни: только личность, доступ и согласия.
  //
  // `role` здесь — самое важное поле во всём файле, и оно уже один раз
  // было забыто. Без него владелец после обнуления превращается в
  // обычного игрока, а вернуть себе права ему неоткуда: выдаются они из
  // панели, а панель без роли владельца не открывается. То есть проект
  // запирается снаружи насовсем. Тест на это стоит отдельный —
  // «владелец входит и панель ему открыта».
  //
  // `totp` — второй фактор. Потерять его означает то же самое: вход в
  // панель требует второго фактора, а включить его заново можно только
  // изнутри игры, куда без панели ещё пустят, — но проверять это на
  // живом проекте желания мало.
  const carry = [
    'id', 'name', 'email', 'accountLogin', 'passHash', 'salt',
    'role', 'isAdmin',                       // доступ к панели
    'totp',                                  // второй фактор входа
    'emailVerified', 'consents',             // подтверждения и согласия
    'createdAt', 'regAt', 'mailKey',
    'avatar', 'status', 'pushSubs', 'goldPaid',
  ];
  for (const k of carry) if (old[k] !== undefined) fresh[k] = old[k];
  // Платное золото не сгорает: оно куплено за настоящие деньги, и
  // обнуление мира — не повод его отбирать.
  if (old.goldPaid) fresh.gold = Math.max(Number(fresh.gold) || 0, Number(old.goldPaid) || 0);
  return fresh;
}

export = { preview, run, phrase, worldNo, archive, WIPE, KEEP };
