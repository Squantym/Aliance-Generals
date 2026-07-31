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
process.env.DB_TOOL_MODE = '1';   // служебный скрипт: не берём замок базы
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── Загружаем .env вручную ────────────────────────────────────────
// Сервер читает .env через dotenv при старте, а этот скрипт запускается
// напрямую — без этого MONGODB_URI не виден, скрипт молча считает, что
// облака нет, и переносит пустую локальную папку data вместо боевой базы.
(function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
})();

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
  console.log(`Источник: ${from}` + (from === 'mongo'
    ? ` (база «${process.env.MONGODB_DB || 'generals'}»)`
    : ' — локальные файлы data/*.json'));
  if (from === 'json' && !process.env.MONGODB_URI) {
    console.log('⚠️  MONGODB_URI не найден ни в окружении, ни в .env.');
    console.log('   Если боевые данные в облаке — перенос НЕ отсюда. Проверьте .env.');
  }

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

  if (!userIds.length) {
    console.error('\n⛔ В источнике НЕТ НИ ОДНОГО ИГРОКА. Перенос отменён.');
    console.error('   Иначе получилась бы пустая база, и после переключения драйвера');
    console.error('   игра стартовала бы с нуля игроков.');
    console.error('');
    if (from === 'json') {
      console.error('   Источником выбраны локальные JSON-файлы. Если боевые данные лежат');
      console.error('   в MongoDB, проверьте, что в .env есть MONGODB_URI, и запустите снова.');
      console.error('   Пустые json-файлы в data/ можно удалить: rm -f data/*.json');
    } else {
      console.error('   Источник — MongoDB, но коллекция users пуста. Проверьте MONGODB_DB:');
      console.error(`   сейчас «${process.env.MONGODB_DB || 'generals'}».`);
    }
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
