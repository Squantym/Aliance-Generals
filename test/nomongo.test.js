// ===================================================================
// test/nomongo.test.js — MongoDB убрана из проекта целиком
//
// Проверяем не «мы удалили строчки», а последствия, ради которых
// удаляли:
//   1. драйвера mongodb нет ни в коде, ни в зависимостях;
//   2. оставшийся в окружении MONGODB_URI ничего не ломает и не
//      уводит сервер в тихий JSON-режим;
//   3. главное — сервер НЕ поднимается на пустой базе, если рядом
//      лежит настоящая. Это самая дорогая из возможных ошибок:
//      игра начинает писать в пустоту поверх живых данных.
// ===================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
}

const dbSrc = fs.readFileSync(path.join(ROOT, 'src/core/db.ts'), 'utf8');

console.log('\n── 1. Драйвера нет в коде ──');
ok(!/require\(['"]mongodb['"]\)/.test(dbSrc), 'db.ts не подключает пакет mongodb');
ok(!/new MongoClient/.test(dbSrc), 'MongoClient не создаётся');
ok(!/mode === 'mongo'/.test(dbSrc), 'веток «если режим mongo» не осталось');
ok(!/usersColl|collColl|logsColl/.test(dbSrc), 'ссылок на коллекции облака не осталось');
ok(!/bulkWrite|updateOne|insertOne|deleteOne/.test(dbSrc), 'вызовов API монги не осталось');

// Тип режима: два значения вместо трёх. Лишний вариант в типе — это
// приглашение вернуть ветку обратно.
ok(/let mode: 'json' \| 'sqlite'/.test(dbSrc), 'режимов ровно два: json и sqlite');

console.log('\n── 2. Драйвера нет в зависимостях ──');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const allDeps = Object.assign({}, pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies);
ok(!allDeps.mongodb, 'mongodb убран из package.json');
ok(!!allDeps['better-sqlite3'], 'better-sqlite3 на месте (своя база)');

console.log('\n── 3. Ни один сервис не тянет mongodb ──');
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}
const tsFiles = walk(path.join(ROOT, 'src'), []).concat([path.join(ROOT, 'server.ts')]);
const importers = tsFiles.filter((f) => /(require\(['"]mongodb['"]\)|from ['"]mongodb['"])/.test(fs.readFileSync(f, 'utf8')));
ok(importers.length === 0, `ни один из ${tsFiles.length} .ts-файлов не импортирует mongodb`);

console.log('\n── 4. Сборка не ищет пакет ──');
const distDb = path.join(ROOT, 'dist/src/core/db.js');
if (fs.existsSync(distDb)) {
  ok(!/require\(["']mongodb["']\)/.test(fs.readFileSync(distDb, 'utf8')), 'в собранном db.js пакета нет');
} else {
  ok(true, 'dist не собран — пропускаем (проверено на исходнике)');
}

// ── Ниже — поведенческие проверки: запускаем настоящий процесс ──
// Отдельный процесс, а не require в этом же: db держит замок базы и
// глобальное состояние, повторная инициализация внутри одного процесса
// проверяла бы не то.
function runInit(env, cwd) {
  const code = `
    const db = require(${JSON.stringify(path.join(ROOT, 'dist/src/core/db.js'))});
    db.init().then(async () => {
      const users = db.load('users', {});
      console.log('RESULT:' + JSON.stringify({ mode: db.mode, players: Object.keys(users).length }));
      await db.flushAllNow();
      try { db.closeDb(); } catch (e) {}
      process.exit(0);
    }).catch((e) => { console.log('THROWN:' + e.message); process.exit(3); });
  `;
  // spawnSync, а не execFileSync: предупреждение о MONGODB_URI идёт
  // через console.warn, то есть в stderr, а execFileSync возвращает
  // только stdout — проверка «сервер предупредил» молча провалилась бы
  // на пустой строке, хотя предупреждение есть.
  const r = require('child_process').spawnSync(process.execPath, ['-e', code], {
    cwd, env: Object.assign({}, process.env, env), encoding: 'utf8',
  });
  return { out: String(r.stdout || '') + String(r.stderr || ''), code: r.status };
}

const built = fs.existsSync(path.join(ROOT, 'dist/src/core/db.js'));

console.log('\n── 5. Оставшийся MONGODB_URI не ломает запуск ──');
if (!built) {
  ok(true, 'dist не собран — поведенческие проверки пропущены (npm run build)');
} else {
  const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), 'nomongo-json-'));
  const r1 = runInit({
    MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.net/generals',
    DB_DRIVER: '', SQLITE_DIR: '', SQLITE_FILE: '',
  }, tmp1);
  ok(r1.code === 0, 'процесс со старой переменной поднимается, а не падает');
  ok(/RESULT:/.test(r1.out) && JSON.parse(r1.out.split('RESULT:')[1].split('\n')[0]).mode === 'json',
     'режим json — к облаку никто не идёт');
  ok(/MONGODB_URI/.test(r1.out) && /Уберите строку из \.env/.test(r1.out),
     'сервер прямо говорит убрать переменную (пароль лежит открытым текстом)');

  console.log('\n── 6. Файл базы рядом — открывается он, а не пустая JSON ──');
  // Готовим настоящую базу с одним игроком через тот же код.
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nomongo-db-'));
  const dataDir = path.join(tmp2, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const seed = `
    const db = require(${JSON.stringify(path.join(ROOT, 'dist/src/core/db.js'))});
    db.init().then(async () => {
      const users = db.load('users', {});
      users['u1'] = { id: 'u1', name: 'Комдив', money: 777 };
      db.markUser('u1');
      await db.flushAllNow();
      try { db.closeDb(); } catch (e) {}
      process.exit(0);
    }).catch((e) => { console.error(e); process.exit(3); });
  `;
  execFileSync(process.execPath, ['-e', seed], {
    cwd: tmp2, encoding: 'utf8',
    env: Object.assign({}, process.env, { DB_DRIVER: 'sqlite', MONGODB_URI: '' }),
  });
  ok(fs.existsSync(path.join(dataDir, 'generals.db')), 'база создана и игрок записан');

  // Главное: DB_DRIVER ПОТЕРЯН (как при кривом .env или ручном запуске),
  // но файл базы на месте. Раньше здесь был бы json-режим и ноль игроков.
  const r2 = runInit({ DB_DRIVER: '', MONGODB_URI: '' }, tmp2);
  ok(r2.code === 0, 'без DB_DRIVER процесс поднимается');
  const res2 = /RESULT:/.test(r2.out) ? JSON.parse(r2.out.split('RESULT:')[1].split('\n')[0]) : {};
  ok(res2.mode === 'sqlite', `режим sqlite, а не json (получено: ${res2.mode})`);
  ok(res2.players === 1, `игрок на месте: ${res2.players} шт. (пустая база означала бы 0)`);
  ok(/рядом найден generals\.db/.test(r2.out), 'в консоли написано, почему выбрана своя база');

  // И проверка, что это не случайность: без файла базы — честный json.
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'nomongo-empty-'));
  const r3 = runInit({ DB_DRIVER: '', MONGODB_URI: '' }, tmp3);
  const res3 = /RESULT:/.test(r3.out) ? JSON.parse(r3.out.split('RESULT:')[1].split('\n')[0]) : {};
  ok(res3.mode === 'json', 'на чистой папке по-прежнему json — разработка не сломана');

  console.log('\n── 7. Данные не потерялись после перезапуска ──');
  // Пишем ещё раз уже в автоопределённом режиме и читаем третьим запуском:
  // если бы автоопределение открывало другую базу, деньги не сошлись бы.
  const bump = `
    const db = require(${JSON.stringify(path.join(ROOT, 'dist/src/core/db.js'))});
    db.init().then(async () => {
      const users = db.load('users', {});
      users['u1'].money = 1234;
      db.markUser('u1');
      await db.flushAllNow();
      try { db.closeDb(); } catch (e) {}
      process.exit(0);
    }).catch((e) => { console.error(e); process.exit(3); });
  `;
  execFileSync(process.execPath, ['-e', bump], {
    cwd: tmp2, encoding: 'utf8',
    env: Object.assign({}, process.env, { DB_DRIVER: '', MONGODB_URI: '' }),
  });
  const check = `
    const db = require(${JSON.stringify(path.join(ROOT, 'dist/src/core/db.js'))});
    db.init().then(async () => {
      console.log('MONEY:' + (db.load('users', {})['u1'] || {}).money);
      await db.flushAllNow();
      try { db.closeDb(); } catch (e) {}
      process.exit(0);
    });
  `;
  const outC = execFileSync(process.execPath, ['-e', check], {
    cwd: tmp2, encoding: 'utf8',
    env: Object.assign({}, process.env, { DB_DRIVER: 'sqlite', MONGODB_URI: '' }),
  });
  ok(/MONEY:1234/.test(outC), 'запись в автоопределённом режиме видна при явном DB_DRIVER — база одна и та же');

  try { fs.rmSync(tmp1, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(tmp3, { recursive: true, force: true }); } catch (e) {}
}

console.log(`\n═══ Итог: ${pass} прошло, ${fail} упало ═══`);
process.exit(fail ? 1 : 0);
