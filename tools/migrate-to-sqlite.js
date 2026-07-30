#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// ПЕРЕЕЗД С ОБЛАКА НА СВОЮ БАЗУ (SQLite)
//
// Читает данные из MongoDB (или из локальных JSON-файлов) и переносит их
// в data/generals.db. Источник НЕ изменяется — если что-то не понравится,
// просто не переключайте драйвер, старая база останется как была.
//
// Порядок действий на сервере:
//   1) pm2 stop generals-game            # останавливаем игру
//   2) node tools/migrate-to-sqlite.js   # переносим данные
//   3) сверяем цифры в отчёте скрипта
//   4) в .env: DB_DRIVER=sqlite
//   5) pm2 start generals-game && pm2 logs generals-game
//
// Откат: убрать DB_DRIVER=sqlite и перезапустить — снова работает Mongo.
// Файл generals.db при этом никуда не денется.
//
// Флаги:
//   --from=mongo|json   откуда читать (по умолчанию mongo, если есть URI)
//   --dry               только показать, что будет перенесено
//   --force             перезаписать уже существующую базу
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (n) => args.some((a) => a === '--' + n);
const opt = (n, def) => {
  const a = args.find((x) => x.startsWith('--' + n + '='));
  return a ? a.split('=')[1] : def;
};

const DRY = flag('dry');
const FORCE = flag('force');
const DATA_DIR = process.env.SQLITE_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, process.env.SQLITE_FILE || 'generals.db');

function human(n) { return (n / 1024 / 1024).toFixed(1) + ' МБ'; }

async function readFromMongo(uri) {
  const { MongoClient } = require('mongodb');
  let client;
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
  } catch (e) {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, tlsInsecure: true });
    await client.connect();
  }
  const dbName = process.env.MONGODB_DB || 'generals';
  const database = client.db(dbName);

  const users = {};
  for (const doc of await database.collection('users').find({}).toArray()) {
    const { _id, ...rest } = doc;
    users[_id] = { ...rest, id: _id };
  }
  const colls = {};
  for (const doc of await database.collection('collections').find({}).toArray()) {
    colls[doc._id] = doc.data;
  }
  // Аудит-лог переносим частично: он capped и нужен только свежий
  let logs = [];
  try {
    logs = await database.collection('actionLogs').find({}).sort({ at: -1 }).limit(20000).toArray();
  } catch (e) {}
  await client.close();
  return { users, colls, logs, source: `MongoDB (${dbName})` };
}

function readFromJson() {
  const dir = path.join(process.cwd(), 'data');
  const users = {};
  const colls = {};
  if (!fs.existsSync(dir)) return { users, colls, logs: [], source: 'JSON (папки data нет)' };
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const name = f.replace(/\.json$/, '');
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    if (name === 'users') Object.assign(users, parsed || {});
    else colls[name] = parsed;
  }
  return { users, colls, logs: [], source: `JSON-файлы (${dir})` };
}

(async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('ПЕРЕЕЗД НА СВОЮ БАЗУ (SQLite)');
  console.log('═══════════════════════════════════════════════════');

  if (fs.existsSync(DB_FILE) && !FORCE && !DRY) {
    console.error(`\n⛔ База уже существует: ${DB_FILE}`);
    console.error('   Если хотите перенести заново — запустите с --force');
    console.error('   (существующий файл будет сохранён рядом с суффиксом .bak)');
    process.exit(1);
  }

  const from = opt('from', process.env.MONGODB_URI ? 'mongo' : 'json');
  console.log(`Источник: ${from}`);

  let data;
  if (from === 'mongo') {
    if (!process.env.MONGODB_URI) {
      console.error('⛔ Нет MONGODB_URI в окружении. Укажите --from=json, если переносите из файлов.');
      process.exit(1);
    }
    data = await readFromMongo(process.env.MONGODB_URI);
  } else {
    data = readFromJson();
  }

  const userIds = Object.keys(data.users);
  const collNames = Object.keys(data.colls);
  const bots = userIds.filter((id) => data.users[id] && data.users[id].isBot).length;

  console.log(`\nПрочитано из ${data.source}:`);
  console.log(`  игроков:          ${userIds.length} (из них ботов: ${bots})`);
  console.log(`  коллекций:        ${collNames.length}${collNames.length ? ' → ' + collNames.join(', ') : ''}`);
  console.log(`  записей аудита:   ${data.logs.length}`);

  if (!userIds.length && !collNames.length) {
    console.error('\n⛔ Источник пуст. Перенос отменён (чтобы не создать пустую базу вместо рабочей).');
    process.exit(1);
  }

  if (DRY) {
    console.log('\n--dry: ничего не записано. Уберите флаг, чтобы выполнить перенос.');
    process.exit(0);
  }

  if (fs.existsSync(DB_FILE) && FORCE) {
    const bak = DB_FILE + '.bak-' + Date.now();
    fs.renameSync(DB_FILE, bak);
    console.log(`\nСтарый файл базы сохранён: ${bak}`);
  }

  const sqliteStore = require(path.join(ROOT, 'dist/src/core/sqliteStore'));
  sqliteStore.open(DATA_DIR, process.env.SQLITE_FILE || 'generals.db');

  console.log('\nПеренос...');
  const players = userIds.map((id) => ({ id, obj: data.users[id] }));
  const colls = collNames.map((name) => ({ id: name, obj: data.colls[name] }));
  sqliteStore.writeBatch(players, colls);          // одна транзакция
  for (const entry of data.logs.reverse()) {
    const { _id, ...rest } = entry;
    sqliteStore.appendLog(rest);
  }

  // Снимок сразу после переноса — точка, к которой можно вернуться
  for (const name of collNames) sqliteStore.snapshot(name, data.colls[name], 'после-переезда');

  // Сверка: читаем обратно и сравниваем
  const back = sqliteStore.loadAllPlayers();
  const backColls = sqliteStore.loadAllCollections();
  const st = sqliteStore.stats();

  console.log('\n── Сверка ──');
  console.log(`  игроков записано:  ${Object.keys(back).length} из ${userIds.length} ${Object.keys(back).length === userIds.length ? '✓' : '⛔ РАСХОЖДЕНИЕ'}`);
  console.log(`  коллекций:         ${Object.keys(backColls).length} из ${collNames.length} ${Object.keys(backColls).length === collNames.length ? '✓' : '⛔ РАСХОЖДЕНИЕ'}`);

  // Поштучная проверка ключевых полей у каждого игрока
  let mismatch = 0;
  for (const id of userIds) {
    const a = data.users[id], b = back[id];
    if (!b) { mismatch++; continue; }
    if (a.name !== b.name || a.level !== b.level || (a.dollars || 0) !== (b.dollars || 0) || (a.gold || 0) !== (b.gold || 0)) mismatch++;
  }
  console.log(`  сверка профилей:   ${mismatch === 0 ? 'все совпали ✓' : '⛔ расхождений: ' + mismatch}`);
  console.log(`  целостность базы:  ${st.integrity}`);
  console.log(`  файл:              ${st.file} (${human(st.sizeBytes)}), журнал: ${st.walMode}`);

  // Контрольная копия
  const bkp = sqliteStore.backup('после-переезда', 14);
  console.log(`  первый бэкап:      ${bkp}`);
  sqliteStore.close();

  if (mismatch === 0 && Object.keys(back).length === userIds.length) {
    console.log('\n✅ Перенос завершён. Теперь в .env: DB_DRIVER=sqlite и pm2 restart generals-game');
    console.log('   Откат: убрать DB_DRIVER и перезапустить — вернётся Mongo.');
  } else {
    console.log('\n⛔ Есть расхождения — НЕ переключайте драйвер. Пришлите этот вывод.');
    process.exit(1);
  }
})().catch((e) => { console.error('\n💥 Ошибка переноса:', e); process.exit(1); });
