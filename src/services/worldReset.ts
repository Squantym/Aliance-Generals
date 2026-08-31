// ===================================================================
// src/services/worldReset.ts — обнуление мира
//
// Самая опасная кнопка в проекте: она стирает игру начисто. Отменить
// это нельзя — можно только поднять замороженный мир из файла.
//
// ПОРЯДОК, И ОН ВАЖНЕЕ ВСЕГО ОСТАЛЬНОГО
//
//  1. Игра закрывается на обслуживание. Запрос игрока, пришедший в
//     середине стирания, увидел бы полупустой мир.
//
//  2. МИР ЗАМОРАЖИВАЕТСЯ. Полный слепок базы — все игроки, весь журнал,
//     вся история состояний — ложится в data/worlds/ отдельным файлом,
//     которого не касается никакая ротация. Проверяется, что файл
//     записался и не пуст.
//
//     Это условие, а не пожелание: не заморозили — не стёрли НИЧЕГО.
//     После обнуления делать слепок будет уже не из чего, а именно на
//     него опирается решение стирать журнал и историю.
//
//  3. И только теперь — стирание.
//
// ПРАВИЛО СТИРАНИЯ: «не перечислил — значит стёрлось». Список того, что
// ОСТАЁТСЯ, — ниже, и он короткий. Обратный список — «что стереть» —
// пришлось бы дописывать при каждой новой коллекции и каждой новой
// таблице, и однажды его бы не дописали: в «обнулённой» игре молча
// остались бы данные игроков, которых уже нет.
//
// Стирается в том числе то, о чём код снаружи обычно не помнит: журнал
// действий, упакованный журнал, история состояний игроков, снимки
// коллекций. Всё это целиком лежит в замороженном мире — доказательство
// не исчезает, оно перестаёт лежать в живой базе. Заодно снимается
// вопрос по 152-ФЗ: персональные данные игроков, которых больше нет, не
// должны оставаться в работающей игре.
//
// ВЛАДЕЛЕЦ ОСТАЁТСЯ. Иначе после обнуления в игру некому зайти:
// регистрация заводит обычного игрока, а прав ему никто не выдаст —
// панель закрыта, а выдать права можно только из панели или консоли.
// Прогресс владельца при этом по умолчанию сбрасывается: мир, где у
// одного игрока пятидесятый уровень с прошлого раза, новым не является.
// ===================================================================
import db = require('../core/db');
import u = require('../core/utils');

// ── ЧТО ОСТАЁТСЯ. Всё остальное стирается ─────────────────────────
//
// Список именно такой стороной — «что остаётся», а не «что стереть», —
// и это главное решение во всём файле. Список стираемого пришлось бы
// дописывать при каждой новой коллекции, при каждой новой таблице. И
// однажды его бы не дописали: в «обнулённой» игре остались бы данные
// игроков, которых уже нет, причём молча.
//
// Здесь наоборот: не перечислил — значит стёрлось. Забывчивость играет
// в сторону чистоты, а не в сторону мусора.
//
// Каждая строка — отдельное решение, и ни одна не «на всякий случай»:
const KEEP = [
  // Указатель на замороженные миры. Без него файлы в data/worlds/
  // остаются лежать, но найти их и понять, что в каком, будет нечем.
  'worldArchive',
  // Режим обслуживания. Сотрём — игра откроется посреди стирания, и
  // игроки увидят полупустой мир.
  'maintenance',
  // Счётчик тарифа почты. У SMTP.BZ свой счётчик, и он не обнулится.
  // Сбросив свой, мы упрёмся в чужой молча — посреди регистрации
  // новичков нового мира, то есть в худший возможный момент.
  'mailQuota',
  // Настройки сервера, а не нажитое игроками: ключи push-уведомлений и
  // раскладка прав по ролям. Стирать их — значит заставить владельца
  // настраивать сервер заново после каждого сезона.
  'pushconfig',
  'roleZones',
];

// Журнал, аналитика, история состояний игроков, снимки коллекций — всё
// это ТЕПЕРЬ СТИРАЕТСЯ. Раньше журнал был исключением: стереть его
// значило бы «замести следы».
//
// Что изменилось: появилась заморозка мира. Полный слепок базы — со
// всем журналом, всей историей и всеми игроками — ложится в
// data/worlds/ отдельным файлом, который не трогает никакая ротация.
// Доказательство никуда не девается, оно просто перестаёт лежать в
// живой базе. А заодно снимается вопрос по 152-ФЗ: персональные данные
// игроков, которых больше нет, не должны оставаться в работающей игре.
//
// Отсюда жёсткое условие в run(): не удалось заморозить мир — не
// стираем ничего.

type Opts = {
  confirm?: string;        // фраза подтверждения
  keepIds?: string[];      // кого оставить (обычно один владелец)
  resetOwner?: boolean;    // сбросить ли прогресс оставленных
  reason?: string;
  allowNoFreeze?: boolean; // разрешить стирание без слепка (только файловая база)
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

// Понятные имена коллекций — владельцу нужны не служебные ключи, а то,
// что он узнаёт: «легионы», «бои», «чат». Нет в списке — покажем ключ
// как есть, но это лучше, чем не показать вовсе.
const HUMAN: Record<string, string> = {
  legions: 'легионы', alliances: 'альянсы', alliance_invites: 'приглашения в альянс',
  battles: 'бои', arena: 'арена', groupBattle: 'групповые бои', rockets: 'ракеты',
  sanctions: 'санкции', news: 'новости', broadcast: 'рассылки', mail: 'почта в игре',
  world: 'мир: чат и аукцион', world_event: 'событие мира', discounts: 'скидки',
  dailyFame: 'слава за день', season: 'сезон', weeklySeason: 'недельный сезон',
  sessions: 'открытые входы', analytics: 'аналитика', actionLogs: 'журнал действий',
  weeklyMetricsBackup: 'копия недельных метрик',
};

// ── Что будет стёрто: показываем ДО, а не после ───────────────────
function preview() {
  const users = db.load<Record<string, any>>('users', {});
  const known = db.loadedNames().filter((n) => !KEEP.includes(n) && n !== 'users');
  const counts: Record<string, number> = {};
  for (const name of known) {
    const c = db.peek(name);
    const n = Array.isArray(c) ? c.length : (c && typeof c === 'object' ? Object.keys(c).length : 0);
    if (n > 0) counts[name] = n;
  }
  let hist: any = null;
  try { hist = db.historyStats(); } catch (e) {}
  let logs: any = null;
  try { logs = db.logStats(); } catch (e) {}

  return {
    world: worldNo(),
    phrase: phrase(),
    players: Object.keys(users).length,
    counts,
    human: HUMAN,
    // Таблицы, о которых код снаружи не знает, — но стираются и они.
    logs: logs && logs.total ? Number(logs.total) : 0,
    history: hist && hist.rows ? Number(hist.rows) : 0,
    keep: KEEP,
    archive: archive().map((a: any) => ({
      n: a.n, endedAt: a.endedAt, players: a.players, by: a.by, reason: a.reason,
      file: a.file || '', bytes: a.bytes || 0,
    })),
    frozen: db.frozenWorlds(),
    canFreeze: db.mode === 'sqlite',
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

  // 2. ЗАМОРОЗКА МИРА. Полный слепок базы — со всеми игроками, журналом
  //    и историей — ложится в data/worlds/ отдельным файлом, которого не
  //    касается никакая ротация.
  //
  //    Это не «желательно», а условие: не заморозили — не стираем
  //    вообще ничего. После обнуления создавать копию будет уже не из
  //    чего, а именно на неё опирается решение стереть журнал.
  //
  //    Проверяем и размер: VACUUM INTO может оставить пустой файл при
  //    нехватке места на диске, и «копия есть» превратилось бы в ложь
  //    ровно в тот момент, когда на неё рассчитывают.
  let frozen: { file: string; bytes: number } | null = null;
  if (db.mode === 'sqlite') {
    frozen = db.freezeWorld(worldNo());
    if (!frozen || !frozen.file || frozen.bytes < 4096) {
      throw new u.ApiError('Не удалось заморозить мир — обнуление отменено, ничего не стёрто. '
        + (frozen && frozen.bytes < 4096
          ? 'Файл копии получился пустым: проверьте место на диске.'
          : 'Проверьте права на папку data/worlds и место на диске.'));
    }
  } else if (!opts.allowNoFreeze) {
    // Файловая база — это разработка. Стирать там без слепка можно, но
    // только по отдельному согласию: молча уничтожать данные, потому что
    // «тут всё равно тесты», — привычка, которая однажды сработает на
    // боевом сервере.
    throw new u.ApiError('База файловая: заморозить мир в отдельный файл нечем. '
      + 'Скопируйте папку data вручную и повторите с подтверждением.');
  }
  const backup = frozen ? frozen.file : '';

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
    file: frozen ? frozen.file.split(/[\\/]/).pop() : '',
    bytes: frozen ? frozen.bytes : 0,
    backup,
  };

  // 4. Оставленных пересобираем ДО стирания: после него читать из чего
  //    будет уже нечего.
  const resetOwner = opts.resetOwner !== false;
  const keepers: Record<string, any> = {};
  for (const id of keepIds) {
    keepers[id] = resetOwner ? freshenKeeper(users[id]) : users[id];
  }
  // Сессии оставленных — тоже: иначе владельца выбросило бы из панели
  // ровно тогда, когда надо посмотреть, что получилось.
  const oldSess = db.load<Record<string, any>>('sessions', {});
  const keptSess: Record<string, any> = {};
  for (const t of Object.keys(oldSess)) {
    if (keepIds.includes(String(oldSess[t] && oldSess[t].u))) keptSess[t] = oldSess[t];
  }

  // 5. СТИРАНИЕ. Одним движением и по правилу «не перечислил — значит
  //    стёрлось»: игроки, все коллекции, журнал, упакованный журнал,
  //    история состояний, снимки. Перечислять то, что уходит, значило бы
  //    дописывать список при каждой новой таблице — и однажды не
  //    дописать.
  //    Считаем удалённых ДО вызова: `users` — это живой объект из
  //    хранилища, и стирание опустошит его же. Посчитав после, мы
  //    отчитались бы нулём при любом числе удалённых.
  const wasPlayers = Object.keys(users).length;
  const wiped = db.wipeEverything(keepIds, KEEP);
  const removed = Math.max(0, wasPlayers - keepIds.length);

  // 6. Возвращаем на место то немногое, что решили оставить.
  const freshUsers = db.load<Record<string, any>>('users', {});
  for (const id of Object.keys(keepers)) {
    freshUsers[id] = keepers[id];
    db.markUser(id);
  }
  const sess = db.load<Record<string, any>>('sessions', {});
  Object.assign(sess, keptSess);
  db.save('sessions');

  // 7. Архив пишем ПОСЛЕ стирания: он в списке остающегося, но порядок
  //    важнее списка — запись, сделанная до, ушла бы вместе со всем
  //    остальным, если бы кто-то однажды убрал worldArchive из KEEP.
  const arch = db.load<any[]>('worldArchive', []);
  arch.push(rec);
  db.save('worldArchive');

  // 8. Первая запись нового журнала — само обнуление. Старый журнал ушёл
  //    вместе со всем остальным, и целиком лежит в замороженном мире;
  //    здесь остаётся отметка «кто и когда обнулил», чтобы новый журнал
  //    начинался не с пустоты.
  try {
    require('./auditLog').record({
      userId: actor && actor.id, userName: actor && actor.name,
      path: '/api/admin/world-reset',
      body: {
        world: rec.n, removed, kept: keepIds.length,
        resetOwner, backup: rec.file || 'нет (файловая база)',
        reason: rec.reason,
      },
    });
  } catch (e) {}

  console.log(`💥 МИР №${rec.n} ОБНУЛЁН (${rec.by}): удалено игроков ${removed}, `
    + `оставлено ${keepIds.length}, заморожен в ${rec.file || '—'} `
    + `(${Math.round((rec.bytes || 0) / 1024)} КБ), стёрто: `
    + Object.entries(wiped).map(([k, v]) => `${k}=${v}`).join(', '));

  return {
    ok: true, world: rec.n, removed, kept: keepIds.length,
    resetOwner, backup, file: rec.file, bytes: rec.bytes,
    wiped, archived: rec,
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

export = { preview, run, phrase, worldNo, archive, KEEP, HUMAN };
