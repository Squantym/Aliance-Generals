// ===================================================================
// src/core/db.ts — база данных
//
// Два режима, оба на своём железе:
//   sqlite — боевой. Файл data/generals.db, транзакции, WAL, свои копии,
//            история состояния игроков, упаковка журнала.
//   json   — локальные файлы в /data. Только для разработки и тестов:
//            ничего поднимать не нужно, база — это папка с .json.
//
// Облачной MongoDB в проекте БОЛЬШЕ НЕТ. Она была снята вместе со всеми
// ветками кода: каждая такая ветка — это второй, никем не проверяемый
// путь записи в самом опасном файле проекта (именно в такой ветке жила
// потеря прогресса в flushUsers). Один путь записи — один путь ошибок.
// Если в окружении остался MONGODB_URI, сервер об этом скажет и всё
// равно поднимется на своей базе.
//
// ВАЖНО: интерфейс load()/save() СИНХРОННЫЙ — все игровые сервисы
// (player, battle и т.д.) переписывать не нужно. Запись в базу идёт
// асинхронно «под капотом» через debounce.
// ===================================================================

import fs = require('fs');
import path = require('path');

// Папка данных — относительно корня проекта (откуда запущен node),
// а не относительно расположения файла. Иначе при запуске из dist/
// путь уехал бы в dist/data вместо ./data.
const DATA_DIR = path.join(process.cwd(), 'data');

// Кэш коллекций в памяти (как и раньше) — отсюда всё читается синхронно.
// Коллекции разнородны (объекты игроков, мир, рынок...), поэтому any.
const store: Record<string, any> = {};
const dirty = new Set<string>();
const dirtyUsers = new Set<string>();   // id игроков для точечного сохранения
let allUsersDirty = false;               // флаг «сохранить всех игроков»
let saveTimer: NodeJS.Timeout | null = null;

// Режим работы: 'sqlite' (боевой) или 'json' (разработка и тесты)
let mode: 'json' | 'sqlite' = 'json';
let periodicTimer: NodeJS.Timeout | null = null;
// Идёт остановка процесса: новые записи больше не планируем. Без этого
// автосохранение (раз в 30 с) успевало запланировать запись ПОСЛЕ того, как
// финальное сохранение уже закрыло соединение с базой, и коллекция терялась
// с ошибкой «client was closed» — при каждом рестарте.
let shuttingDown = false;

let sqlite: any = null;          // модуль SQLite-хранилища (если выбран драйвер)
let backupTimer: any = null;
let lightTimer: any = null;
let lockFile = '';

// ═══ ЗАЩИТА ОТ ВТОРОГО ПРОЦЕССА ═══════════════════════════════════
// Сервер держит всю базу в памяти и сохраняет коллекции целиком. Если
// запустить два процесса на одних данных, каждый работает со своей копией
// в памяти: первый сохраняет устаревшее состояние поверх изменений
// второго. save('users') пишет ВСЕХ игроков, поэтому одним сохранением
// можно откатить прогресс всей базы — именно так теряются данные, когда
// в pm2 случайно остаётся дубль процесса.
// Поэтому при старте ставим замок с PID. Если процесс из замка ещё жив —
// отказываемся запускаться и объясняем, что делать.
function acquireLock(dir: string): void {
  // Служебные скрипты (grant-admin, диагностика, миграция) работают с той
  // же базой, что и запущенная игра. Замок нужен для защиты от ВТОРОГО
  // СЕРВЕРА, а не от одноразовой команды: раньше скрипт натыкался на
  // замок, падал в JSON-режим и видел пустую базу — «игроков: 0».
  // DB_TOOL_MODE=1 выставляют сами скрипты.
  if (process.env.DB_TOOL_MODE === '1') return;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    lockFile = path.join(dir, '.db-lock');

    // АТОМАРНО: 'wx' создаёт файл и падает, если он уже есть, одной
    // операцией ядра. Раньше здесь были existsSync, а затем writeFileSync
    // отдельно — между двумя вызовами оба процесса успевали увидеть
    // «замка нет» и оба его создавали. Именно этот зазор и приводит к
    // двум процессам на одной базе, а два процесса затирают данные друг
    // друга целиком: каждый сохраняет свою копию памяти поверх чужой.
    try {
      fs.writeFileSync(lockFile, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
      return;                                     // замок наш
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;           // не «занято» — разбираем ниже
    }

    // Файл есть. Смотрим, жив ли владелец.
    const raw = fs.readFileSync(lockFile, 'utf8').trim();
    const oldPid = Number(String(raw).split(/\s+/)[0]);
    if (oldPid && oldPid !== process.pid && isAlive(oldPid)) {
      throw new Error(
        `База уже используется процессом PID ${oldPid}.\n` +
        `Два процесса на одной базе затирают данные друг друга — запуск прерван.\n` +
        `Проверьте: pm2 list — и оставьте ОДИН процесс игры (pm2 delete <лишний>; pm2 save).\n` +
        `Если процесс ${oldPid} уже мёртв, удалите файл замка: ${lockFile}`
      );
    }
    // Замок остался от упавшего процесса — забираем себе
    fs.writeFileSync(lockFile, `${process.pid} ${new Date().toISOString()}\n`);
  } catch (e: any) {
    if (String(e.message).includes('База уже используется')) throw e;
    // Не смогли поставить замок по другой причине: нет прав на папку,
    // диск только для чтения. В РАБОТЕ это повод остановиться — без
    // замка нельзя гарантировать, что процесс один, а цена ошибки —
    // потеря данных всех игроков. Раньше здесь было предупреждение в
    // лог и запуск продолжался: защита выглядела включённой, но не
    // работала. В разработке остаётся мягкое поведение.
    if (String(process.env.NODE_ENV) === 'production') {
      throw new Error(
        `Не удалось поставить замок базы (${e.message}).\n` +
        'Запуск прерван: без замка два процесса на одной базе затрут данные.\n' +
        `Проверьте права на папку ${dir}.`
      );
    }
    console.warn('⚠️  Не удалось поставить замок базы:', e.message);
    lockFile = '';
  }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }     // сигнал 0 не убивает, только проверяет
  catch (e: any) { return e && e.code === 'EPERM'; }  // EPERM = процесс есть, но чужой
}

function releaseLock(): void {
  if (!lockFile) return;
  try {
    const raw = fs.readFileSync(lockFile, 'utf8').trim();
    if (Number(String(raw).split(/\s+/)[0]) === process.pid) fs.unlinkSync(lockFile);
  } catch (e) {}
  lockFile = '';
}

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function fileOf(name: string): string {
  return path.join(DATA_DIR, `${name}.json`);
}

// ---------- Инициализация ----------
// Вызывается один раз при старте сервера (до app.listen).
//
// Выбор режима:
//   1. DB_DRIVER=sqlite      — своя база, явно. Не открылась → падаем.
//   2. рядом лежит .db-файл  — своя база, без переменных. Это защита от
//      самой дорогой ошибки: раньше при потерянном окружении сервер
//      молча поднимался в JSON-режиме на ПУСТОЙ базе и начинал в неё
//      писать, а игроки видели «все аккаунты пропали».
//   3. иначе                 — JSON-файлы (разработка, тесты).
async function init(): Promise<void> {
  // ── SQLite: своя база на своём сервере ────────────────────────────
  const driver = String(process.env.DB_DRIVER || '').toLowerCase();
  const sqliteDir = process.env.SQLITE_DIR || path.join(process.cwd(), 'data');
  const sqliteFile = process.env.SQLITE_FILE || 'generals.db';
  // Файл базы на месте — работаем с ним, даже если DB_DRIVER не задан.
  const dbFileExists = (() => {
    try { return fs.existsSync(path.join(sqliteDir, sqliteFile)); } catch (e) { return false; }
  })();
  const explicit = driver === 'sqlite';

  if (explicit || (driver === '' && dbFileExists)) {
    if (!explicit) {
      console.log(`💾 DB_DRIVER не задан, но рядом найден ${sqliteFile} — открываю свою базу (а не пустую JSON).`);
    }
    try {
      sqlite = require('./sqliteStore');
      const dir = sqliteDir;
      acquireLock(dir);                         // один процесс на базу
      sqlite.open(dir, sqliteFile);
      store.users = sqlite.loadAllPlayers();
      const colls = sqlite.loadAllCollections();
      for (const k of Object.keys(colls)) store[k] = colls[k];
      mode = 'sqlite';
      const st = sqlite.stats();
      console.log(`💾 База данных: SQLite (${st.file}). Игроков: ${st.players}, прочих коллекций: ${st.collections}, журнал: ${st.walMode}, целостность: ${st.integrity}.`);
      startPeriodicFlush();
      startPeriodicBackup();
      return;
    } catch (e: any) {
      // Тихий переход в JSON-режим опасен: сервер поднялся бы на ПУСТОЙ
      // базе и начал писать в неё, а служебные скрипты показывали бы
      // «игроков: 0». Если драйвер выбран явно — падаем с внятной причиной.
      console.error('\n⛔ Не удалось открыть базу SQLite:', e.message);
      console.error(explicit
        ? '   DB_DRIVER=sqlite задан явно, поэтому переход на пустую'
        : `   Рядом лежит ${sqliteFile}, поэтому переход на пустую`);
      console.error('   JSON-базу отменён — иначе данные игроков были бы перезаписаны.\n');
      throw e;
    }
  }

  // ── Осталась переменная от облачной базы ──────────────────────────
  // MongoDB из проекта убрана. Молча игнорировать переменную нельзя:
  // владелец думал бы, что игра работает на облаке, и не понимал бы,
  // почему копии и история лежат на сервере.
  if (process.env.MONGODB_URI) {
    console.warn('\n⚠️  В окружении осталась переменная MONGODB_URI.');
    console.warn('   MongoDB из проекта убрана — игра работает на своей базе.');
    console.warn('   Уберите строку из .env: пока она там, утёкший пароль');
    console.warn('   продолжает лежать открытым текстом на сервере.\n');
  }

  mode = 'json';
  acquireLock(DATA_DIR);                        // один процесс на файлы базы
  console.log('💾 База данных: локальные JSON-файлы (папка /data)');
}

// ---------- Чтение ----------
// Возвращает коллекцию из кэша. Если коллекции нет ни в кэше, ни на
// диске/в базе — создаёт её со значением def (например, {} или []).
function load<T = any>(name: string, def?: T): T {
  // null считаем «сброшенным» — позволяет переинициализировать коллекцию
  if (store[name] !== undefined && store[name] !== null) return store[name];

  // Режим json: читаем файл с диска
  ensureDir();
  try {
    const parsed = JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
    store[name] = (parsed !== null ? parsed : (def !== undefined ? def : {}));
  } catch (e) {
    store[name] = (def !== undefined ? def : {});
  }
  return store[name];
}

// Что уже прочитано в память, и что там лежит. Только для чтения:
// обнуление обязано знать, какие коллекции существуют, а load() их бы
// создавал — то есть сам плодил бы то, что собирается стирать.
function loadedNames(): string[] { return Object.keys(store); }
function peek(name: string): any { return store[name]; }

// ---------- Запись (отложенная) ----------
// Помечает коллекцию «грязной» и планирует сохранение через 400 мс.
// Несколько вызовов save() подряд склеиваются в одну запись.
//
// ВАЖНО про users: вызов save('users') помечает «сохранить ВСЕХ игроков».
// Это дорого при большом числе игроков. Для точечного сохранения одного
// игрока используйте markUser(id) — он запишет только одного.
function save(name: string): void {
  if (store[name] === undefined) return;
  if (name === 'users') {
    // Полное сохранение всех игроков нужно редко (миграции, массовые
    // изменения). Обычные действия должны звать markUser(id).
    allUsersDirty = true;
    scheduleFlush();
    return;
  }
  dirty.add(name);
  scheduleFlush();
}

// ═══ УДАЛЕНИЕ ИГРОКА ИЗ БАЗЫ ════════════════════════════════════════
// КРИТИЧНО: flushUsers только перезаписывает существующие записи и
// НИКОГДА не удаляет. Раньше admin.deleteAccount делал только
// `delete players[id]` — в JSON-режиме этого хватало (файл перезаписывается
// целиком), а в настоящей базе строка игрока оставалась, и после рестарта
// процесса db.load() поднимал удалённого игрока обратно. Отсюда «воскресшие»
// аккаунты и одинаковые позывные на нескольких местах в рейтинге: игрок
// освобождал имя, регистрировался заново, и в базе оказывались две записи
// с разными id и одним именем.
function dropUser(id: string): void {
  if (mode === 'sqlite') {
    const players = store.users || {};
    delete players[id];
    dirtyUsers.delete(id);
    try { sqlite.deletePlayer(id); } catch (e) { console.error('SQLite: не удалось удалить игрока', id, e); }
    return;
  }
  if (!id) return;
  const usersObj = store.users || {};
  delete usersObj[id];
  dirtyUsers.delete(id);
  // JSON-режим: файл игроков перезаписывается целиком, поэтому достаточно
  // пометить «сохранить всех» — удалённого в новом файле просто не будет.
  allUsersDirty = true;
  scheduleFlush();
}

// Диагностика: игроки с одинаковыми позывными или email — следствие старой
// ошибки удаления. Возвращает группы, чтобы владелец решил, кого убрать.
function findDuplicateUsers(): any {
  const usersObj: Record<string, any> = store.users || {};
  const byName: Record<string, any[]> = {};
  const byEmail: Record<string, any[]> = {};
  for (const id of Object.keys(usersObj)) {
    const p = usersObj[id];
    if (!p || p.isBot) continue;
    const nameKey = String(p.name || '').trim().toLowerCase();
    const mailKey = String(p.email || '').trim().toLowerCase();
    const info = {
      id, name: p.name, email: p.email, level: p.level,
      createdAt: p.createdAt || 0, lastSeen: p.lastSeen || 0,
      ears: p.ears || 0,
      weeklyEars: (p.weekly && p.weekly.ears) || 0,
      hasSeasonWeekly: !!(p.weekly && p.weekly.weekId),
    };
    if (nameKey) (byName[nameKey] = byName[nameKey] || []).push(info);
    if (mailKey) (byEmail[mailKey] = byEmail[mailKey] || []).push(info);
  }
  const dupNames = Object.keys(byName).filter((k) => byName[k].length > 1).map((k) => ({ key: k, accounts: byName[k] }));
  const dupEmails = Object.keys(byEmail).filter((k) => byEmail[k].length > 1).map((k) => ({ key: k, accounts: byEmail[k] }));
  const usersArr: any[] = Object.values(usersObj);
  return {
    total: usersArr.length,
    dupNames, dupEmails,
    noSeasonWeekly: usersArr.filter((p: any) => p && !p.isBot && !(p.weekly && p.weekly.weekId)).length,
  };
}

// Точечно пометить одного игрока на сохранение (дёшево при 1000+ игроков).
function markUser(id: string): void {
  if (!id) return;
  dirtyUsers.add(id);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (shuttingDown) return;   // идёт финальное сохранение — не мешаем
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    flush().catch((e: any) => console.error('Ошибка фонового сохранения:', e.message));
  }, 400);
}

// Записать одну «прочую» коллекцию (не users) в backend
async function flushOne(name: string): Promise<void> {
  if (mode === 'sqlite') {
    sqlite.writeBatch([], [{ id: name, obj: store[name] }]);
    return;
  }
  ensureDir();
  fs.writeFileSync(fileOf(name), JSON.stringify(store[name]));
}

// Записать игроков. Если allUserIds=true — пишем всех (миграции),
// иначе только тех, кто помечен через markUser (обычный случай).
// ВАЖНО про параметр ids.
// Раньше эта функция сама читала dirtyUsers — но flush() очищает его
// ДО вызова, чтобы не потерять пометки, пришедшие во время записи. В
// результате на точечном пути список всегда оказывался ПУСТЫМ, и
// flushUsers молча выходила, ничего не записав. То есть markUser() не
// работал вообще: прогресс игроков доживал до диска только за счёт
// сохранения «всех» при штатной остановке сервера.
//
// Наружу это вылезало как «после падения процесса пропала выдача» — но
// пропадало не только она, а ВСЁ, что игроки сделали с момента старта.
// Поэтому список теперь передаётся явно, а чтение dirtyUsers оставлено
// лишь как страховка для прямых вызовов.
async function flushUsers(allUserIds: boolean, ids?: string[]): Promise<void> {
  const usersObj = store.users || {};
  const targetIds = allUserIds
    ? Object.keys(usersObj)
    : (ids && ids.length ? ids : Array.from(dirtyUsers));
  if (mode === 'sqlite') {
    // Точечно: только те игроки, что менялись (или все — при миграциях).
    // Всё уходит одной транзакцией внутри writeBatch.
    const ids = targetIds;
    if (!ids.length) return;
    sqlite.writeBatch(ids.filter((id) => usersObj[id]).map((id) => ({ id, obj: usersObj[id] })), []);
    return;
  }
  // JSON-режим: пишем весь файл (один файл на коллекцию). Дёшево до
  // ~неск. тысяч игроков; в бою работает ветка sqlite выше.
  ensureDir();
  fs.writeFileSync(fileOf('users'), JSON.stringify(usersObj));
}

// Сбросить все «грязные» коллекции на диск/в базу
async function flush(): Promise<void> {
  saveTimer = null;
  const names = Array.from(dirty);
  dirty.clear();

  // Игроки — отдельной веткой (точечно или все)
  const needAllUsers = allUsersDirty;
  const hadDirtyUsers = dirtyUsers.size > 0 || needAllUsers;
  allUsersDirty = false;
  const userIds = Array.from(dirtyUsers);
  dirtyUsers.clear();

  for (const name of names) {
    try {
      await flushOne(name);
    } catch (e: any) {
      console.error(`Не удалось сохранить «${name}»:`, e.message);
      dirty.add(name);
      scheduleFlush();
    }
  }

  if (hadDirtyUsers) {
    try {
      await flushUsers(needAllUsers, userIds);
    } catch (e: any) {
      console.error('Не удалось сохранить игроков:', e.message);
      // Возвращаем id обратно в очередь
      if (needAllUsers) allUsersDirty = true;
      else userIds.forEach((id) => dirtyUsers.add(id));
      scheduleFlush();
    }
  }
}

// Пометить все «прочие» загруженные коллекции на сохранение.
// НЕ трогает users — игроки сохраняются точечно через markUser(id),
// чтобы не писать тысячи документов после каждого запроса.
function saveAll(): void {
  Object.keys(store).forEach((name) => {
    // users сохраняются точечно (markUser); actionLogs — append-only коллекция
    if (name !== 'users' && name !== 'actionLogs') save(name);
  });
}

// Периодическая подстраховка: раз в 30 с сбрасываем ИЗМЕНЁННЫЕ прочие
// коллекции. Раньше saveAll() звался после КАЖДОГО POST и переписывал все
// коллекции целиком в Atlas — это давало терабайты трафика. Теперь per-request
// saveAll убран; точечные save()/markUser() пишут сразу, а этот таймер — лишь
// страховка от мутаций без явного save (не чаще 2 раз/мин).
// ── Автобэкап: целостная копия файла базы по расписанию ───────────
// VACUUM INTO работает на живой базе, игру останавливать не нужно.
// Копии лежат в data/backups с ротацией; частота — BACKUP_HOURS
// (по умолчанию каждые 6 часов), число копий — BACKUP_KEEP.
function startPeriodicBackup(): void {
  if (mode !== 'sqlite' || backupTimer) return;
  const hours = Math.max(1, Number(process.env.BACKUP_HOURS || 6));
  const keep = Math.max(2, Number(process.env.BACKUP_KEEP || 14));
  backupTimer = setInterval(() => {
    try { console.log(`🗄  Бэкап базы: ${sqlite.backup('auto', keep)}`); }
    catch (e: any) { console.error('⚠️  Бэкап не удался:', e.message); }
  }, hours * 3600 * 1000);
  if (backupTimer.unref) backupTimer.unref();

  // ── Лёгкие копии: только прогресс игроков, без журнала ───────────
  // Полная копия весит сотни мегабайт из-за журнала, поэтому её нельзя
  // делать часто — и точность восстановления упиралась в 6 часов.
  // Прогресс игроков весит единицы мегабайт: такую копию можно снимать
  // каждые 15 минут. Именно она нужна почти во всех разборах.
  const lightMin = Math.max(5, Number(process.env.BACKUP_LIGHT_MINUTES || 15));
  const lightKeep = Math.max(4, Number(process.env.BACKUP_LIGHT_KEEP || 192));  // 48 часов
  lightTimer = setInterval(() => {
    try { sqlite.backupLight('light', lightKeep); }
    catch (e: any) { console.error('⚠️  Лёгкая копия не удалась:', e.message); }
  }, lightMin * 60 * 1000);
  if (lightTimer.unref) lightTimer.unref();
}

// Копия базы прямо сейчас (админка, перед миграцией). Возвращает путь.
function backupNow(label = 'manual'): string | null {
  if (mode !== 'sqlite') return null;
  return sqlite.backup(label, Number(process.env.BACKUP_KEEP || 14));
}

// Снимок ОДНОЙ коллекции перед рискованной операцией. Дешевле полного
// бэкапа, поэтому вызывается автоматически — например, перед сбросом
// недельного сезона: если что-то пойдёт не так, метрики можно вернуть.
function backupLightNow(): string | null {
  if (mode !== 'sqlite') return null;
  try { return sqlite.backupLight('light', Number(process.env.BACKUP_LIGHT_KEEP || 192)); }
  catch (e) { return null; }
}

// ═══ ЗАМОРОЗКА МИРА И ПОЛНОЕ ОБНУЛЕНИЕ ══════════════════════════════
// Обёртки над своей базой. В файловом режиме заморозка невозможна —
// возвращаем null, и worldReset честно скажет об этом владельцу вместо
// того, чтобы стереть всё «вроде бы с копией».
function freezeWorld(n: number): { file: string; bytes: number } | null {
  if (mode !== 'sqlite') return null;
  try { return sqlite.freezeWorld(n); } catch (e) { return null; }
}

function frozenWorlds(): any[] {
  if (mode !== 'sqlite') return [];
  try { return sqlite.frozenWorlds(); } catch (e) { return []; }
}

// Полная очистка. Чистит и таблицы, о которых код снаружи не знает:
// журнал, упакованный журнал, историю состояний игроков, снимки. Кэш в
// памяти сбрасывается здесь же — иначе сервер продолжил бы отдавать
// стёртые данные до перезапуска.
function wipeEverything(keepPlayers: string[], keepCollections: string[]): Record<string, number> {
  const keptP = new Set((keepPlayers || []).map(String));
  const keptC = new Set((keepCollections || []).map(String));

  let stats: Record<string, number> = {};
  if (mode === 'sqlite') {
    stats = sqlite.wipeEverything(keepPlayers || [], keepCollections || []);
  }

  // Память. Объекты коллекций чистим НА МЕСТЕ: сервисы держат ссылку на
  // них с первого своего вызова, и подмена оставила бы половину игры
  // работать со старым, уже стёртым содержимым.
  const users = store.users || {};
  let removed = 0;
  for (const id of Object.keys(users)) {
    if (keptP.has(id)) continue;
    delete users[id];
    dirtyUsers.delete(id);
    removed++;
  }
  if (!stats.players) stats.players = removed;

  for (const name of Object.keys(store)) {
    if (name === 'users' || keptC.has(name)) continue;
    const box = store[name];
    if (Array.isArray(box)) box.length = 0;
    else if (box && typeof box === 'object') for (const k of Object.keys(box)) delete box[k];
    dirty.add(name);
  }
  allUsersDirty = true;
  scheduleFlush();
  return stats;
}

function snapshotCollection(name: string, label: string): boolean {
  if (mode !== 'sqlite' || store[name] === undefined) return false;
  try { sqlite.snapshot(name, store[name], label); return true; } catch (e) { return false; }
}

function snapshotsList(name?: string, limit = 20): any[] {
  if (mode !== 'sqlite') return [];
  try { return sqlite.snapshotList(name, limit); } catch (e) { return []; }
}

// Восстановить коллекцию из снимка. Игроков не трогает — только
// коллекции (сезон, мир, санкции), чтобы случайно не откатить прогресс.
// Откат коллекции из снимка.
//
// СВЕРКА КОЛЛЕКЦИИ обязательна. Раньше снимок брался по одному seq и
// писался в ту коллекцию, которую назвал вызывающий, без проверки, что
// снимок вообще от неё. Одним запросом с перепутанной парой можно было
// записать данные мира в рынок и испортить обе коллекции сразу.
// Теперь несовпадение — отказ с внятной причиной, а не тихая порча.
function snapshotRestore(seq: number, name: string): boolean {
  if (mode !== 'sqlite' || name === 'users') return false;
  const snap = sqlite.snapshotGetFull(seq);
  if (!snap || snap.data === null || snap.data === undefined) return false;
  if (snap.collection !== name) {
    throw new Error(
      `Снимок #${seq} сделан с коллекции «${snap.collection}», а восстановить просят в «${name}». ` +
      'Откат отменён: запись снимка в чужую коллекцию испортила бы обе.'
    );
  }
  store[name] = snap.data;
  save(name);
  return true;
}

// SQL для аналитики: топы и статистика без перебора всех игроков в памяти
function sql(query: string, params: any[] = []): any[] {
  if (mode !== 'sqlite') return [];
  try { return sqlite.query(query, params); }
  catch (e: any) { console.error('SQL ошибка:', e.message); return []; }
}

// Закрыть базу перед выходом: чекпойнт WAL + закрытие файла. Вызывается
// из shutdown, чтобы после остановки сервера база лежала одним файлом,
// пригодным для копирования.
function closeDb(): void {
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
  if (lightTimer) { clearInterval(lightTimer); lightTimer = null; }
  if (mode === 'sqlite' && sqlite) { try { sqlite.close(); } catch (e) {} }
  releaseLock();
}

// Список имеющихся копий базы — для админки
// Состояние игрока на момент копии — главный инструмент разбирательства
// после сбоя. Копия открывается только на чтение, боевая база не трогается.
function playerFromBackup(fileName: string, query: string): any {
  if (mode !== 'sqlite') throw new Error('Доступно только на своей базе (DB_DRIVER=sqlite)');
  return sqlite.playerFromBackup(fileName, query);
}

function backupsList(): any[] {
  if (mode !== 'sqlite') return [];
  try {
    const dir = path.join(process.env.SQLITE_DIR || path.join(process.cwd(), 'data'), 'backups');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.db') || f.endsWith('.db.gz'))
      .map((f) => { const st = fs.statSync(path.join(dir, f)); return { file: f, size: st.size, at: st.mtimeMs }; })
      .sort((a, b) => b.at - a.at)
      .slice(0, 40);
  } catch (e) { return []; }
}

// ── Состояние вывоза копий за пределы сервера ─────────────────────
// tools/backup-offsite.sh пишет отчёт в data/backups/offsite-status.json.
// Читаем его здесь, чтобы панель показывала состояние вывоза, а не
// молчала. Молчание — худший вид отчёта о бэкапах: пока никто не
// смотрит, вывоз может не работать месяцами, и это выясняется ровно
// в тот момент, когда копия понадобилась.
function offsiteStatus(): any {
  const dir = path.join(process.env.SQLITE_DIR || path.join(process.cwd(), 'data'), 'backups');
  const file = path.join(dir, 'offsite-status.json');
  try {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ageMs = Date.now() - (st.at || 0);
    return {
      configured: true,
      ok: !!st.ok,
      at: st.at || 0,
      ageHours: Math.floor(ageMs / 3600000),
      // Вывоз раз в сутки: 48 часов без отчёта — расписание не работает
      stale: ageMs > 48 * 3600 * 1000,
      file: String(st.file || ''),
      bytes: Number(st.bytes || 0),
      players: Number(st.players || 0),
      remote: String(st.remote || ''),
      // Зашифрована ли вывезенная копия. В ней почты и хеши паролей всех
      // игроков, а лежит она на чужом хосте — незашифрованная копия там
      // это утечка, просто отложенная.
      encrypted: !!st.encrypted,
      error: String(st.error || ''),
    };
  } catch (e) {
    // Отчёта нет вообще — значит скрипт ни разу не отработал
    return { configured: false, ok: false, at: 0, ageHours: 0, stale: true,
             file: '', bytes: 0, players: 0, remote: '', encrypted: false, error: '' };
  }
}

// Упаковка старого журнала. Зовётся из фонового тика небольшими порциями:
// разом ужать двухмесячный хвост — это секунды работы в единственном
// потоке, то есть заметная для игроков пауза.
function packLogs(maxPacks = 6): any {
  if (mode !== 'sqlite') return { packed: 0, rows: 0 };
  try {
    const r = sqlite.packOldLogs(maxPacks);
    // Упаковка освобождает страницы внутри базы. Отдаём их файловой
    // системе тут же, порциями: иначе файл остаётся прежнего размера и
    // экономия видна только внутри базы, а не на диске и в копиях.
    if (r.packed) r.reclaimed = sqlite.reclaimSpace(2000);
    return r;
  } catch (e) { return { packed: 0, rows: 0 }; }
}

// ── История состояния игрока ──────────────────────────────────────
// Ответ на вопрос «что было у игрока до сбоя» с точностью до 5 минут, а
// не до последней копии базы. Копии остаются — они про другое: про
// потерю базы целиком.
function playerHistory(id: string, limit = 200): any[] {
  if (mode !== 'sqlite') return [];
  try { return sqlite.playerHistoryList(String(id), limit); } catch (e) { return []; }
}
function playerHistoryGet(seq: number): any | null {
  if (mode !== 'sqlite') return null;
  try { return sqlite.playerHistoryGet(Number(seq)); } catch (e) { return null; }
}
function playerHistoryAt(id: string, at: number): any | null {
  if (mode !== 'sqlite') return null;
  try { return sqlite.playerHistoryAt(String(id), Number(at)); } catch (e) { return null; }
}
// Снимок ПЕРЕД действием сотрудника: пишется всегда, минуя задержку в
// 5 минут, и прореживание его не удаляет. Именно по нему разбираются,
// когда сотрудник ошибся.
function snapshotPlayer(user: any, label: string, actor = ''): boolean {
  if (mode !== 'sqlite' || !user || !user.id) return false;
  try {
    const { id, ...rest } = user;
    return sqlite.savePlayerHistory(user.id, rest, label || 'до изменения', actor);
  } catch (e) { return false; }
}
function thinHistory(): any {
  if (mode !== 'sqlite') return { removed: 0 };
  try { return sqlite.thinPlayerHistory(); } catch (e) { return { removed: 0 }; }
}
function historyStats(): any {
  if (mode !== 'sqlite') return null;
  try { return sqlite.historyStats(); } catch (e) { return null; }
}

function dbStats(): any {
  if (mode !== 'sqlite') return { driver: mode };
  return { driver: 'sqlite', ...sqlite.stats() };
}

function startPeriodicFlush(): void {
  if (periodicTimer) return;
  periodicTimer = setInterval(() => {
    try { saveAll(); } catch (e) {}
  }, 30000);
  if (periodicTimer.unref) periodicTimer.unref();
}

// ── Аудит-лог: append-only (одна запись = один документ) ───────────
// СРОК ХРАНЕНИЯ — 3 МЕСЯЦА. Раньше держали последние 50 000 записей, а это
// при живой игре всего несколько дней: разобраться по жалобе недельной
// давности было уже не по чему. Теперь вытесняем по дате.
const LOG_KEEP_MS = 90 * 24 * 3600 * 1000;

function appendLog(entry: any): void {
  if (mode === 'sqlite') { try { sqlite.appendLog(entry); } catch (e) {} return; }
  // JSON-режим (локальная разработка): срок тот же, но остаётся и потолок по
  // числу записей — здесь журнал целиком лежит в памяти процесса, и
  // трёхмесячная история боевого сервера её бы не пережила.
  const arr = load<any[]>('actionLogs', []);
  arr.push(entry);
  const cutoff = Date.now() - LOG_KEEP_MS;
  let cut = 0;
  while (cut < arr.length && (arr[cut].at || 0) < cutoff) cut++;
  if (cut) arr.splice(0, cut);
  if (arr.length > 20000) arr.splice(0, arr.length - 20000);
  save('actionLogs');
}

// Сводка по журналу: сколько записей и за какой срок. Нужна админке, чтобы
// владелец видел, что история действительно копится, а не подрезается.
function logStats(): any {
  if (mode === 'sqlite') {
    try { return sqlite.logStats(); } catch (e) { /* дальше общий путь */ }
  }
  const arr = load<any[]>('actionLogs', []) as any[];
  let oldest = 0, newest = 0;
  for (const e of arr) {
    const t = e && e.at ? e.at : 0;
    if (!t) continue;
    if (!oldest || t < oldest) oldest = t;
    if (t > newest) newest = t;
  }
  return { count: arr.length, oldestAt: oldest, newestAt: newest, keepDays: Math.round(LOG_KEEP_MS / 86400000) };
}

// Записи за период — для разбирательств по давним жалобам
function logsBetween(from: number, to: number, userId?: string, limit?: number): any[] {
  const n = Math.max(1, Math.min(5000, limit || 1000));
  if (mode === 'sqlite') { try { return sqlite.logsBetween(from, to, userId, n); } catch (e) { return []; } }
  const arr = load<any[]>('actionLogs', []) as any[];
  return arr
    .filter((e) => (e.at || 0) >= from && (e.at || 0) <= to && (!userId || e.userId === userId))
    .slice(-n).reverse();
}

// Последние N записей лога (опционально по игроку). Async — читает из БД.
async function tailLogs(limit: number, userId?: string): Promise<any[]> {
  if (mode === 'sqlite') { try { return sqlite.tailLogs(limit, userId); } catch (e) { return []; } }
  const n = Math.max(1, Math.min(1000, limit || 200));
  const arr = load<any[]>('actionLogs', []) as any[];
  const filtered = userId ? arr.filter((e) => e.userId === userId) : arr;
  return filtered.slice(-n).reverse();
}

// Немедленное сохранение всего и аккуратное закрытие соединения —
// используется при остановке сервера (SIGINT/SIGTERM).
// Финальное сохранение при остановке. Возвращает список коллекций, которые
// сохранить НЕ удалось, — чтобы сервер написал правду, а не «всё сохранено».
async function flushAllNow(): Promise<string[]> {
  // Первым делом глушим все таймеры и запрещаем планировать новые записи:
  // иначе автосохранение вклинится в середину и упадёт на закрытом клиенте
  shuttingDown = true;
  if (periodicTimer) { clearInterval(periodicTimer); periodicTimer = null; }
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
  if (lightTimer) { clearInterval(lightTimer); lightTimer = null; }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const failed: string[] = [];
  dirty.clear();
  dirtyUsers.clear();
  allUsersDirty = false;
  for (const name of Object.keys(store)) {
    if (name === 'users') continue;
    try {
      await flushOne(name);
    } catch (e: any) {
      failed.push(name);
      console.error(`Не удалось сохранить «${name}» при выходе:`, e.message);
    }
  }
  // Всех игроков — гарантированно при выходе
  try {
    await flushUsers(true);
  } catch (e: any) {
    failed.push('users');
    console.error('Не удалось сохранить игроков при выходе:', e.message);
  }
  return failed;
}

export = {
  init, load, save, markUser, saveAll, loadedNames, peek, flushAllNow, appendLog, tailLogs, DATA_DIR,
  logStats, logsBetween, LOG_KEEP_MS, playerFromBackup,
  dropUser, findDuplicateUsers,
  // Своя база: защита данных и аналитика
  backupNow, backupsList, snapshotCollection, snapshotsList, snapshotRestore, sql, dbStats, closeDb,
  offsiteStatus, packLogs, backupLightNow, freezeWorld, frozenWorlds, wipeEverything,
  playerHistory, playerHistoryGet, playerHistoryAt, snapshotPlayer, thinHistory, historyStats,
  get mode() { return mode; },
};
