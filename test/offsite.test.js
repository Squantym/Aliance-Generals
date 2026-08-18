// ═══════════════════════════════════════════════════════════════════
// Вывоз копий за пределы сервера: скрипт запускается по-настоящему,
// на настоящей базе, и проверяется не «отработал без ошибки», а
//   • доехала ли копия и совпала ли сумма;
//   • ВОССТАНАВЛИВАЕТСЯ ли она обратно в рабочую базу;
//   • пишется ли отчёт при КАЖДОМ исходе, включая аварийный;
//   • видит ли панель, что вывоз сломался.
// Без sqlite3 в системе тест честно сообщает, что пропущен.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const HAS_SQLITE = (() => {
  try { cp.execSync('command -v sqlite3', { stdio: 'pipe' }); return true; } catch (e) { return false; }
})();

const WORK = '/tmp/generals-offsite-test';
const DEST = WORK + '/dest';
const DATA = WORK + '/data';
const SCRIPT = path.join(ROOT, 'tools/backup-offsite.sh');
const STATUS = DATA + '/backups/offsite-status.json';

// Запуск скрипта: возвращает { code, out, status }
function run(env) {
  let code = 0, out = '';
  try {
    // 2>&1: предупреждения скрипт пишет в stderr, а execSync при успехе
    // возвращает только stdout — без слияния часть вывода терялась
    out = cp.execSync(`bash ${SCRIPT} 2>&1`, {
      env: { ...process.env, GAME_DIR: WORK, ...env },
      stdio: 'pipe', encoding: 'utf8',
    });
  } catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
  let status = null;
  try { status = JSON.parse(fs.readFileSync(STATUS, 'utf8')); } catch (e) {}
  return { code, out, status };
}
const sq = (db, q) => cp.execSync(`sqlite3 ${db} ${JSON.stringify(q)}`, { encoding: 'utf8' }).trim();

async function main() {
console.log('\n── 0. Скрипт на месте и корректен ──');
const src = fs.readFileSync(SCRIPT, 'utf8');
ok(fs.existsSync(SCRIPT), 'tools/backup-offsite.sh существует');
try {
  cp.execSync(`bash -n ${SCRIPT}`, { stdio: 'pipe' });
  ok(true, 'синтаксис скрипта верен');
} catch (e) { ok(false, 'синтаксис скрипта верен: ' + e.message); }
ok(/set -euo pipefail/.test(src), 'скрипт падает на первой ошибке, а не идёт дальше молча');
ok(/\.backup '\$OUT'/.test(src), 'копия делается через .backup — корректно при включённом WAL');
ok(!/^\s*cp "\$DB_FILE"/m.test(src), 'простого cp базы «на горячую» нет — он даёт копию без последних транзакций');
ok(/sha256sum/.test(src), 'сумма считается');
ok(/REMOTE_SUM.*=.*SUM|\[ "\$REMOTE_SUM" = "\$SUM" \]/.test(src), 'и сверяется с приёмником');
ok(/integrity_check/.test(src), 'целостность проверяется ДО отправки');
ok(/json_valid/.test(src), 'данные игроков проверяются на читаемость');
ok(/KEEP_REMOTE/.test(src), 'на приёмнике тоже есть ротация — иначе диск заполнится');
ok(/ConnectTimeout/.test(src), 'висящий ssh не держит скрипт вечно');
ok(/crontab -e/.test(src), 'в шапке написано, как поставить в расписание');
ok(/КОДЫ ВЫХОДА/.test(src), 'коды выхода описаны — по ним cron различает беду и полбеды');
ok(/list_copies\(\)/.test(src) && /\|\| true; \}/.test(src),
   'перечисление копий не роняет скрипт на несовпавшей маске (включён pipefail)');
ok(/BACKUP_KEY_FILE/.test(src), 'шифрование настраивается ключом');
ok(/openssl enc -d[\s\S]{0,200}BACK_SUM/.test(src) || /BACK_SUM=/.test(src),
   'расшифровка проверяется до отправки');

if (!HAS_SQLITE) {
  console.log('\n  ⚠ sqlite3 в системе нет — живые прогоны пропущены (на сервере он обязателен)');
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
}

// ── Живая база ─────────────────────────────────────────────────────
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = DATA;
process.env.DISABLE_RATE_LIMIT = '1';
process.chdir(WORK);
const db = require(ROOT + '/dist/src/core/db');
await db.init();
const auth = require(ROOT + '/dist/src/services/auth');
for (let i = 0; i < 6; i++) await auth.register('Боец' + i, 'пароль123', `b${i}@t.ru`, 'ru', '1.1.1.1');
await db.flushAllNow();
const DB_FILE = DATA + '/generals.db';

console.log('\n── 1. Обычный вывоз ──');
const r1 = run({ DB_FILE, REMOTE: 'local:' + DEST });
ok(r1.code === 0, `код выхода 0 (получили ${r1.code})`);
ok(/доехал и сверен по sha256/.test(r1.out), 'сказано, что копия доехала и сверена');
const files = fs.readdirSync(DEST).filter((f) => f.endsWith('.db.gz'));
ok(files.length === 1, `на приёмнике один файл: ${files.length}`);
ok(r1.status && r1.status.ok === true, 'отчёт говорит «работает»');
ok(r1.status.players === 6, `в отчёте число игроков: ${r1.status.players}`);
ok(r1.status.bytes > 0 && r1.status.bytes === fs.statSync(DEST + '/' + files[0]).size,
   'размер в отчёте совпадает с размером доехавшего файла');
ok(!r1.status.error, 'ошибки в отчёте нет');

console.log('\n── 2. Копия действительно восстанавливается ──');
// Самое важное. Копия, которую никто не пробовал развернуть, —
// это не копия, а надежда.
const REST = WORK + '/restored.db';
cp.execSync(`gunzip -c ${DEST}/${files[0]} > ${REST}`);
ok(sq(REST, 'PRAGMA integrity_check;') === 'ok', 'развёрнутая база целостна');
ok(sq(REST, 'SELECT COUNT(*) FROM players;') === '6', 'все шесть игроков на месте');
const names = sq(REST, "SELECT json_extract(data,'$.name') FROM players ORDER BY 1;").split('\n');
ok(names.includes('Боец0') && names.includes('Боец5'), `позывные читаются: ${names.slice(0, 2).join(', ')}…`);
ok(sq(REST, "SELECT COUNT(*) FROM players WHERE json_valid(data)=0;") === '0', 'ни у кого не испорчены данные');
ok(sq(REST, "SELECT COUNT(*) FROM players WHERE json_extract(data,'$.passHash') IS NOT NULL;") === '6',
   'пароли тоже в копии — игроки смогут войти после восстановления');

console.log('\n── 3. Приёмник недоступен: копия остаётся, но об этом ГОВОРЯТ ──');
const r2 = run({ DB_FILE, REMOTE: 'local:/proc/сюда-нельзя' });
ok(r2.code === 2, `код выхода 2 — «сделано, но не вывезено» (получили ${r2.code})`);
ok(r2.status.ok === false, 'отчёт говорит «сломан»');
ok(/не удалось отправить/.test(r2.status.error), `в отчёте причина: «${r2.status.error.slice(0, 40)}…»`);
ok(r2.status.file && r2.status.players === 6, 'при этом видно, что сама копия сделана и не пуста');
ok(fs.readdirSync(DATA + '/backups').some((f) => f.endsWith('.db.gz')), 'локальная копия сохранена');

console.log('\n── 4. Базы нет: отчёт всё равно пишется ──');
const r3 = run({ DB_FILE: WORK + '/нет-такой.db', REMOTE: 'local:' + DEST });
ok(r3.code === 1, `код выхода 1 (получили ${r3.code})`);
ok(r3.status.ok === false && /базы нет/.test(r3.status.error), 'в отчёте написано, что базы нет');
ok(r3.status.players === 0, 'липовых цифр в отчёте нет');

console.log('\n── 5. Испорченные данные наружу не уезжают ──');
const BAD = WORK + '/bad.db';
// Берём РАЗВЁРНУТУЮ копию, а не рабочий файл: при включённом WAL
// последние записи живут в generals.db-wal, и простой copyFileSync даёт
// базу без таблицы players. Это, кстати, ровно та причина, по которой
// сам скрипт делает копию через .backup, а не через cp.
fs.copyFileSync(REST, BAD);
// Индексы по json_extract не дают записать битый JSON — снимаем их,
// чтобы воспроизвести именно повреждение файла
sq(BAD, 'DROP INDEX IF EXISTS idx_players_level; DROP INDEX IF EXISTS idx_players_name; '
      + 'DROP INDEX IF EXISTS idx_players_seen; DROP INDEX IF EXISTS idx_players_bot;');
sq(BAD, "UPDATE players SET data='{сломано' WHERE rowid=1;");
const before = fs.readdirSync(DEST).length;
const r4 = run({ DB_FILE: BAD, REMOTE: 'local:' + DEST });
ok(r4.code === 1, `вывоз прерван (код ${r4.code})`);
ok(/испорчены данные/.test(r4.status.error), 'причина названа прямо');
ok(fs.readdirSync(DEST).length === before, 'на приёмник ничего не попало');

console.log('\n── 5б. Шифрование перед отправкой ──');
// В копии почты и хеши паролей ВСЕХ игроков, а лежит она на чужом хосте:
// незашифрованная копия там — это утечка, просто отложенная
const KEY = WORK + '/backup.key';
cp.execSync(`openssl rand -base64 48 > ${KEY} && chmod 600 ${KEY}`);
const ENCDEST = WORK + '/dest-enc';
const re = run({ DB_FILE, REMOTE: 'local:' + ENCDEST, BACKUP_KEY_FILE: KEY });
ok(re.code === 0, `вывоз с шифрованием прошёл (код ${re.code})`);
ok(/зашифровано \(AES-256\), расшифровка проверена/.test(re.out),
   'расшифровка проверяется ДО отправки — копия, которая не открывается, бесполезна');
ok(re.status.encrypted === true, 'в отчёте помечено, что копия зашифрована');
const encFiles = fs.readdirSync(ENCDEST).filter((f) => f.endsWith('.db.gz.enc'));
ok(encFiles.length === 1, `на приёмник уехал зашифрованный файл: ${encFiles[0] || '—'}`);
ok(!fs.readdirSync(ENCDEST).some((f) => f.endsWith('.db.gz')),
   'открытой версии рядом не осталось');
// Файл действительно шифр, а не переименованный архив
const head = fs.readFileSync(ENCDEST + '/' + encFiles[0]).slice(0, 8).toString('binary');
ok(head.startsWith('Salted__'), 'внутри действительно шифр с солью');
// И он разворачивается обратно ТЕМ ЖЕ способом, что написан в инструкции
const BACK = WORK + '/from-enc.db';
cp.execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ${ENCDEST}/${encFiles[0]} ` +
            `-pass file:${KEY} | gunzip > ${BACK}`);
ok(sq(BACK, 'PRAGMA integrity_check;') === 'ok', 'расшифрованная копия целостна');
ok(sq(BACK, 'SELECT COUNT(*) FROM players;') === '6', 'все игроки на месте');
// Чужим ключом не открывается
const WRONG = WORK + '/wrong.key';
cp.execSync(`openssl rand -base64 48 > ${WRONG}`);
let opened = true;
try {
  cp.execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ${ENCDEST}/${encFiles[0]} ` +
              `-pass file:${WRONG} > /dev/null`, { stdio: 'pipe' });
} catch (e) { opened = false; }
ok(!opened, 'чужим ключом копия не открывается');
// Нет ключа — предупреждение, а не тихий вывоз открытой копии
const openDest = WORK + '/dest-open';
const ro = run({ DB_FILE, REMOTE: 'local:' + openDest });
ok(/БЕЗ ШИФРОВАНИЯ/.test(ro.out), 'без ключа скрипт предупреждает прямо');
ok(ro.status.encrypted === false, 'и честно помечает это в отчёте');
// Указан несуществующий ключ — отказ, а не молчаливый вывоз открытым
const rbad = run({ DB_FILE, REMOTE: 'local:' + openDest, BACKUP_KEY_FILE: WORK + '/нет-ключа' });
ok(rbad.code === 1 && /файл ключа не найден/.test(rbad.status.error),
   'ошибка в пути к ключу не превращается в открытую копию');

console.log('\n── 6. Ротация ──');
for (const f of fs.readdirSync(DATA + '/backups')) {
  if (f.endsWith('.db.gz')) fs.rmSync(DATA + '/backups/' + f);
}
for (let i = 0; i < 3; i++) {
  run({ DB_FILE, REMOTE: 'local:' + DEST, KEEP_LOCAL: '2', KEEP_REMOTE: '2' });
  cp.execSync('sleep 1.1');
}
ok(fs.readdirSync(DATA + '/backups').filter((f) => f.endsWith('.db.gz')).length === 2,
   'локально держится ровно KEEP_LOCAL копий');
ok(fs.readdirSync(DEST).filter((f) => f.endsWith('.db.gz')).length === 2,
   'и на приёмнике — ровно KEEP_REMOTE');

console.log('\n── 7. Игра читает отчёт и отдаёт его панели ──');
const st = db.offsiteStatus();
ok(st.configured === true, 'вывоз опознан как настроенный');
ok(st.ok === true, 'состояние — «работает»');
ok(st.players === 6 && st.bytes > 0, 'цифры проброшены');
ok(typeof st.ageHours === 'number' && st.ageHours === 0, `давность в часах: ${st.ageHours}`);
ok(st.stale === false, 'свежий отчёт не помечен просроченным');
ok(/local:/.test(st.remote), 'видно, куда вывозим');

// Старый отчёт = расписание не работает
const old = JSON.parse(fs.readFileSync(STATUS, 'utf8'));
old.at = Date.now() - 5 * 24 * 3600 * 1000;
fs.writeFileSync(STATUS, JSON.stringify(old));
const st2 = db.offsiteStatus();
ok(st2.stale === true, 'отчёт пятидневной давности помечен просроченным');
ok(st2.ageHours >= 120, `давность посчитана: ${st2.ageHours} ч`);

// Отчёта нет вовсе — скрипт ни разу не запускался
fs.rmSync(STATUS);
const st3 = db.offsiteStatus();
ok(st3.configured === false, 'без отчёта вывоз считается ненастроенным');
ok(st3.stale === true, 'и это тоже тревога, а не «нет данных»');
ok(st3.ok === false, 'молчание не выдаётся за успех');

console.log('\n── 8. Состояние доходит до панели ──');
const rt = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/offsite: db\.offsiteStatus/.test(rt), 'маршрут статистики базы отдаёт состояние вывоза');
const adminJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/_offsiteHtml\(o\)/.test(adminJs), 'в панели есть блок вывоза');
ok(/Admin\._offsiteHtml\(d\.offsite\)/.test(adminJs), 'он подключён к блоку базы');
ok(/Вывоз копий не настроен/.test(adminJs), 'ненастроенный вывоз показывается красным предупреждением');
ok(/Умрёт диск — потеряется всё сразу/.test(adminJs), 'объяснено, чем это грозит');
ok(/cron\) не срабатывает/.test(adminJs), 'просроченный отчёт объясняется прямо');
ok(/o\.error/.test(adminJs), 'текст ошибки из отчёта показывается сотруднику');

console.log('\n── 9. Инструкция по восстановлению упоминает вывоз ──');
const doc = fs.readFileSync(path.join(ROOT, 'ВОССТАНОВЛЕНИЕ.md'), 'utf8');
ok(/backup-offsite/.test(doc), 'в инструкции есть ссылка на скрипт вывоза');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
