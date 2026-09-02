#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// НАЗНАЧЕНИЕ ПРАВ АДМИНИСТРАТОРА
//
// Единственный способ получить права: запустить эту команду НА СЕРВЕРЕ.
// Через сайт, регистрацию или API права выдать нельзя — именно поэтому
// первый зарегистрировавшийся больше не становится администратором.
//
// Использование:
//   node tools/grant-admin.js "Позывной"             — администратор
//   node tools/grant-admin.js "Позывной" --owner     — владелец (все права)
//   node tools/grant-admin.js "Позывной" --moderator — модератор «Дозор»
//   node tools/grant-admin.js user@mail.ru      — можно по email
//   node tools/grant-admin.js "Позывной" --off  — снять права
//   node tools/grant-admin.js --list            — показать всех админов
//
// После изменения прав игроку нужно перезайти в игру.
// ═══════════════════════════════════════════════════════════════════
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');

// Загружаем .env — скрипт запускается напрямую, окружение сервера ему не досталось
(function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  // Файл может СУЩЕСТВОВАТЬ и при этом не читаться: .env держат в режиме
  // 600, и запуск не от владельца файла упирался в EACCES. Голый
  // readFileSync выбрасывал стектрейс на двадцать строк, из которого
  // причина «прав не хватает» не следует никак.
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch (e) {
    console.error(`\n⛔ Файл ${envPath} есть, но прочитать его не удалось: ${e.code || e.message}.`);
    console.error('   Запускайте от того же пользователя, которому принадлежит .env (обычно root).\n');
    process.exit(1);
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
})();

// Режим служебного скрипта: работаем с той же базой, что и игра,
// не претендуя на замок процесса (иначе база откроется пустой)
process.env.DB_TOOL_MODE = '1';
const db = require(path.join(ROOT, 'dist/src/core/db'));

const args = process.argv.slice(2);
const OFF = args.includes('--off');
const OWNER = args.includes('--owner');
const MOD = args.includes('--moderator') || args.includes('--mod');
const LIST = args.includes('--list');
const YES = args.includes('--yes');
const who = args.find((a) => !a.startsWith('--'));

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(String(answer || '').trim()); });
  });
}

// Работает ли сейчас сервер игры на этой же базе.
// Это КРИТИЧНО: сервер держит всех игроков в памяти и при остановке
// записывает память на диск целиком. Правка, сделанная скриптом в файле
// базы «на живую», будет затёрта этим сохранением — роль молча
// откатится к прежней, и человек не поймёт, почему ничего не изменилось.
function serverRunning() {
  try {
    const lock = path.join(process.env.SQLITE_DIR || path.join(ROOT, 'data'), '.db-lock');
    if (!fs.existsSync(lock)) return 0;
    const pid = Number(String(fs.readFileSync(lock, 'utf8')).trim().split(/\s+/)[0]);
    if (!pid) return 0;
    try { process.kill(pid, 0); return pid; }        // сигнал 0 только проверяет
    catch (e) { return e && e.code === 'EPERM' ? pid : 0; }
  } catch (e) { return 0; }
}

(async () => {
  const runningPid = serverRunning();
  await db.init();
  const users = db.load('users', {});
  const all = Object.values(users);

  console.log('═══════════════════════════════════════════════════');
  console.log('ПРАВА АДМИНИСТРАТОРА');
  console.log('═══════════════════════════════════════════════════');
  console.log(`База: ${db.mode}, игроков: ${all.length}`);

  const admins = all.filter((p) => p.isAdmin || p.role);
  console.log(`Действующих администраторов: ${admins.length}`);
  for (const a of admins) {
    const r = a.role === 'owner' ? 'владелец' : a.role === 'moderator' ? 'Дозор' : 'администратор';
    console.log(`  • ${a.name}${a.email ? ` <${a.email}>` : ''} — ${r} (id ${a.id}, ур. ${a.level})`);
  }

  if (LIST) { process.exit(0); }

  if (!who) {
    console.log('\nУкажите позывной или email игрока:');
    console.log('  node tools/grant-admin.js "Позывной"');
    console.log('  node tools/grant-admin.js "Позывной" --off   (снять права)');
    console.log('  node tools/grant-admin.js --list             (только список)');
    process.exit(1);
  }

  // Ищем по позывному (без учёта регистра) или по email
  const needle = who.toLowerCase();
  const found = all.filter((p) =>
    String(p.name || '').toLowerCase() === needle ||
    String(p.email || '').toLowerCase() === needle);

  if (!found.length) {
    console.error(`\n⛔ Игрок «${who}» не найден.`);
    // Подсказываем похожие
    const similar = all
      .filter((p) => String(p.name || '').toLowerCase().includes(needle.slice(0, 4)))
      .slice(0, 5);
    if (similar.length) {
      console.error('   Возможно, вы имели в виду:');
      for (const p of similar) console.error(`     ${p.name}`);
    }
    process.exit(1);
  }
  if (found.length > 1) {
    console.error(`\n⛔ Найдено несколько игроков (${found.length}) — уточните по email:`);
    for (const p of found) console.error(`     ${p.name} <${p.email || 'без почты'}> id ${p.id}`);
    process.exit(1);
  }

  const target = found[0];
  // Сравниваем ЖЕЛАЕМУЮ роль с текущей, а не просто «есть ли права».
  // Раньше проверка была по флагу isAdmin, и попытка повысить
  // администратора до владельца отклонялась с «уже администратор» —
  // роль при этом не менялась.
  const currentRole = target.role || (target.isAdmin ? 'admin' : null);
  const wantRole = OFF ? null : (OWNER ? 'owner' : (MOD ? 'moderator' : 'admin'));
  const ruName = (r) => r === 'owner' ? 'владелец' : r === 'moderator' ? 'модератор («Дозор»)' : r === 'admin' ? 'администратор' : 'без роли';

  if (currentRole === wantRole) {
    console.log(`\n✓ «${target.name}» уже ${ruName(currentRole)}. Ничего не меняю.`);
    process.exit(0);
  }
  const already = !!currentRole;
  if (OFF && !already) {
    console.log(`\n✓ «${target.name}» и так без роли. Ничего не меняю.`);
    process.exit(0);
  }

  console.log(`\nИгрок:    ${target.name}${target.email ? ` <${target.email}>` : ''}`);
  console.log(`ID:       ${target.id}`);
  console.log(`Уровень:  ${target.level}`);
  const roleName = OFF ? 'СНЯТЬ все роли' : (OWNER ? 'назначить ВЛАДЕЛЬЦЕМ' : (MOD ? 'назначить МОДЕРАТОРОМ («Дозор»)' : 'назначить АДМИНИСТРАТОРОМ'));
  console.log(`Сейчас:   ${ruName(currentRole)}`);
  console.log(`Действие: ${roleName}`);

  if (!OFF) {
    console.log('\n⚠️  Администратор получает полный доступ: выдача ресурсов, изменение');
    console.log('   любых данных игроков, удаление аккаунтов, управление базой.');
  }
  if (OFF && admins.length === 1 && already) {
    console.log('\n⚠️  Это ПОСЛЕДНИЙ администратор. После снятия прав войти в панель');
    console.log('   будет некому — вернуть доступ можно только этой же командой.');
  }

  if (runningPid) {
    console.log(`\n⛔ СЕЙЧАС РАБОТАЕТ СЕРВЕР ИГРЫ (PID ${runningPid}).`);
    console.log('   Он держит игроков в памяти и при остановке перезапишет базу');
    console.log('   своей копией — изменение роли будет молча отменено.');
    console.log('\n   Сделайте так:');
    console.log('     pm2 stop generals-game');
    console.log(`     node tools/grant-admin.js "${target.name}"${OWNER ? ' --owner' : (MOD ? ' --moderator' : (OFF ? ' --off' : ''))}`);
    console.log('     pm2 start generals-game --update-env');
    process.exit(1);
  }

  if (!YES) {
    const answer = await ask('\nПродолжить? (да/нет): ');
    if (!/^(да|yes|y|д)$/i.test(answer)) {
      console.log('Отменено.');
      process.exit(0);
    }
  }

  // Роль: владелец / модератор / администратор (по умолчанию)
  if (OFF) {
    target.role = null;
    target.isAdmin = false;
  } else if (OWNER) {
    target.role = 'owner';
    target.isAdmin = true;
  } else if (MOD) {
    target.role = 'moderator';
    target.isAdmin = false;
  } else {
    target.role = 'admin';
    target.isAdmin = true;
  }
  db.markUser(target.id);
  await db.flushAllNow();

  console.log(`\n✅ Готово: «${target.name}» — ${OFF ? 'роли сняты' : (target.role === 'owner' ? 'владелец' : target.role === 'moderator' ? 'модератор («Дозор»)' : 'администратор')}.`);
  console.log('   Игроку нужно перезайти в игру, чтобы изменения вступили в силу.');
  if (!OFF) {
    // Адрес панели: свой из ADMIN_PATH либо стандартный /admin.
    // Раньше здесь говорилось, что без ADMIN_PATH панель недоступна —
    // это перестало быть правдой, когда /admin вернули как запасной путь.
    const adminPath = process.env.ADMIN_PATH;
    console.log(adminPath
      ? `   Панель открывается по адресу: ${adminPath}`
      : '   Панель открывается по адресу: /admin (задайте ADMIN_PATH в .env, чтобы скрыть её за своим путём)');
  }
  process.exit(0);
})().catch((e) => { console.error('\n💥 Ошибка:', e); process.exit(1); });
