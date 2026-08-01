#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// СКРЫТИЕ АДМИН-ПАНЕЛИ ЗА СЕКРЕТНЫМ АДРЕСОМ
//
// Что делает:
//   • придумывает случайный трудноугадываемый адрес;
//   • прописывает его в .env (со страховочной копией файла);
//   • показывает, что делать дальше.
//
// После этого /admin отвечает 404 — панели по нему как будто нет, —
// а открыть её можно кнопкой в игре («Настройки» → «Служебный доступ»)
// или по секретному адресу напрямую.
//
// Использование:
//   node tools/hide-admin.js              — сгенерировать и прописать
//   node tools/hide-admin.js /мой-путь    — задать свой адрес
//   node tools/hide-admin.js --show       — показать текущий
//   node tools/hide-admin.js --off        — вернуть обычный /admin
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ENV = path.join(ROOT, '.env');

const args = process.argv.slice(2);
const SHOW = args.includes('--show');
const OFF = args.includes('--off');
const custom = args.find((a) => !a.startsWith('--'));

// Занятые игрой пути — панель на них ставить нельзя
const RESERVED = ['/', '/api', '/admin', '/index.html', '/js', '/css', '/img', '/terms', '/privacy'];

function readEnv() {
  if (!fs.existsSync(ENV)) return { lines: [], map: {} };
  const lines = fs.readFileSync(ENV, 'utf8').split('\n');
  const map = {};
  for (const l of lines) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) map[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return { lines, map };
}

function writeEnv(lines) {
  // Копия перед правкой: .env содержит доступы, терять его нельзя
  if (fs.existsSync(ENV)) {
    fs.copyFileSync(ENV, ENV + '.bak-' + Date.now());
  }
  // Завершающий перенос строки обязателен: без него следующая правка
  // приклеится к последней строке и переменная сломается
  const text = lines.join('\n').replace(/\n*$/, '') + '\n';
  fs.writeFileSync(ENV, text);
}

function setVar(lines, key, value) {
  let found = false;
  const out = lines.map((l) => {
    if (l.trim().startsWith(key + '=')) { found = true; return `${key}=${value}`; }
    return l;
  });
  if (!found) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push(`${key}=${value}`);
  }
  return out;
}

function removeVar(lines, key) {
  return lines.filter((l) => !l.trim().startsWith(key + '='));
}

// Адрес из случайных букв и цифр: угадать перебором нереально,
// при этом он остаётся читаемым и его можно продиктовать
function generatePath() {
  const words = ['shtab', 'komandir', 'bunker', 'operativ', 'zvezda', 'kontur', 'rubezh', 'dozor'];
  const word = words[crypto.randomInt(words.length)];
  const tail = crypto.randomBytes(6).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return `/${word}-${tail}`;
}

const { lines, map } = readEnv();
const current = map.ADMIN_PATH || '';

console.log('═══════════════════════════════════════════════════');
console.log('АДРЕС АДМИН-ПАНЕЛИ');
console.log('═══════════════════════════════════════════════════');

if (SHOW) {
  console.log(current
    ? `\nСейчас панель скрыта за адресом: ${current}\n/admin при этом отвечает 404.`
    : '\nМаскировка выключена: панель открывается по /admin.');
  process.exit(0);
}

if (OFF) {
  if (!current) {
    console.log('\nМаскировка и так выключена — панель на /admin.');
    process.exit(0);
  }
  writeEnv(removeVar(lines, 'ADMIN_PATH'));
  console.log(`\n✅ Маскировка снята. Панель снова открывается по /admin.`);
  console.log('   Примените: pm2 restart generals-game --update-env');
  process.exit(0);
}

// Новый адрес
let target = custom || generatePath();
if (!target.startsWith('/')) target = '/' + target;
if (target.length > 1 && target.endsWith('/')) target = target.slice(0, -1);

if (RESERVED.includes(target)) {
  console.error(`\n⛔ Путь ${target} занят игрой — выберите другой.`);
  console.error('   Занятые: ' + RESERVED.join(', '));
  process.exit(1);
}
if (!/^\/[a-zA-Z0-9._~-]+$/.test(target)) {
  console.error(`\n⛔ Недопустимый путь: ${target}`);
  console.error('   Разрешены латинские буквы, цифры, дефис, точка и подчёркивание.');
  console.error('   Кириллица не подойдёт — в адресной строке она превращается в набор символов.');
  process.exit(1);
}
if (target.length < 8) {
  console.error(`\n⛔ Слишком короткий путь: ${target}`);
  console.error('   Короткие адреса подбираются перебором. Нужно минимум 8 символов.');
  process.exit(1);
}

writeEnv(setVar(lines, 'ADMIN_PATH', target));

console.log(`\n✅ Панель скрыта за адресом:\n`);
console.log(`      ${target}\n`);
if (current && current !== target) console.log(`   (прежний адрес был: ${current})`);
console.log('   Что изменится после перезапуска:');
console.log('     • /admin начнёт отвечать 404 — для постороннего панели «не существует»;');
console.log('     • обращения к /admin будут писаться в лог (видно сканирование);');
console.log('     • панель откроется по адресу выше либо кнопкой в игре:');
console.log('       «Настройки» → «Служебный доступ» → «Открыть панель управления».');
console.log('\n   Примените изменения:');
console.log('     pm2 restart generals-game --update-env');
console.log('\n   Вернуть обычный /admin: node tools/hide-admin.js --off');
process.exit(0);
