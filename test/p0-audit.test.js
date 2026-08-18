// ═══════════════════════════════════════════════════════════════════
// P0-исправления по внешнему аудиту. Каждая проверка соответствует
// НАЙДЕННОМУ и ВОСПРОИЗВЕДЁННОМУ дефекту, а не пожеланию:
//
//  1. Пароли уходили в журнал открытым текстом (oldPassword/newPassword)
//     и лежали там 90 дней, попадая в копии и в вывоз наружу.
//  2. /api/admin/logs отдавал сырое тело запроса — то есть уже
//     записанные пароли мог прочитать сотрудник с зоной «Игроки».
//  3. КОРЕНЬ: flush() очищал dirtyUsers ДО вызова flushUsers(), а тот
//     читал уже очищенный набор. Точечное сохранение игрока не работало
//     вообще; прогресс доживал до диска только за счёт сохранения «всех»
//     при штатной остановке. При падении процесса терялось ВСЁ с момента
//     старта, а не только админская выдача.
//  4. grant/grantAll не помечали цель на запись (из восьми админских
//     действий дыра была ровно в этих двух — тех, что выдают деньги).
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const WORK = '/tmp/generals-p0-test';
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK + '/data', { recursive: true });
process.chdir(WORK);
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = WORK + '/data';
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const db = require(ROOT + '/dist/src/core/db');
const audit = require(ROOT + '/dist/src/services/auditLog');

// Отдельный процесс: выдать ресурсы и УБИТЬ себя без штатной остановки.
// Иначе дефект не воспроизводится — при graceful shutdown пишутся все.
const CRASH = WORK + '/crash.js';
fs.writeFileSync(CRASH, `
process.env.DB_DRIVER='sqlite';
const db=require(${JSON.stringify(ROOT)}+'/dist/src/core/db');
(async()=>{
  await db.init();
  const player=require(${JSON.stringify(ROOT)}+'/dist/src/services/player');
  const admin=require(${JSON.stringify(ROOT)}+'/dist/src/services/admin');
  const U=player.users();
  const by=(n)=>Object.values(U).find(p=>p.name===n);
  const owner=by('Владелец'), victim=by('Жертва');
  admin.grant(owner,{userId:victim.id,gold:10000,dollars:7777},[]);
  // Игрок сам что-то делает — прогресс тоже должен уцелеть
  victim.xp = 424242;
  db.markUser(victim.id);
  // Ровно то, что делает http.ts после запроса: помечает только автора
  db.markUser(owner.id);
  db.saveAll();
  setTimeout(()=>process.kill(process.pid,'SIGKILL'), 1300);
})();
`);

async function main() {
await db.init();
const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
for (const [n, e] of [['Владелец', 'o@t.ru'], ['Жертва', 'v@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => Object.values(U).find((p) => p.name === n);
const owner = by('Владелец'), victim = by('Жертва');
owner.role = 'owner'; owner.isAdmin = true;

console.log('\n── 1. Секреты не попадают в журнал ──');
const SECRET = 'НОВЫЙ-пароль-777';
audit.record({ userId: victim.id, userName: victim.name, path: '/api/change-password',
  desc: 'Сменил пароль', user: victim,
  body: { oldPassword: 'СТАРЫЙ-999', newPassword: SECRET, newPassword2: SECRET } });
audit.record({ userId: victim.id, userName: victim.name, path: '/api/reset-password',
  desc: 'Сброс', user: victim, body: { token: 'секретный-токен', password: SECRET } });
// Вложенность и разные написания — новое поле не должно создавать новую дыру
audit.record({ userId: victim.id, userName: victim.name, path: '/api/test',
  desc: 'Вложенный', user: victim,
  body: { outer: { new_password: SECRET, NewPassword2: SECRET },
          list: [{ apiKey: 'ключ' }], qty: 5, giftNote: 'компенсация' } });
// НЕ flushAllNow: он выставляет «идёт остановка» и глушит фоновые записи
// до конца процесса — а нам ниже нужно проверить именно их
await new Promise((r) => setTimeout(r, 700));

const rows = db.logsBetween(0, Date.now() + 1000, victim.id, 50);
const dump = JSON.stringify(rows);
ok(!dump.includes(SECRET), 'пароля в журнале нет');
ok(!dump.includes('СТАРЫЙ-999'), 'старого пароля тоже нет');
ok(!dump.includes('секретный-токен'), 'токен вырезан');
ok(!dump.includes('"ключ"'), 'ключ во вложенном массиве вырезан');
ok(dump.includes('[скрыто]'), 'на месте секрета стоит пометка, а не пустота');
const nested = rows.find((r) => r.path === '/api/test');
ok(nested.body.qty === 5 && nested.body.giftNote === 'компенсация',
   'обычные поля сохранены — вырезано только секретное');
ok(nested.body.outer.new_password === '[скрыто]' && nested.body.outer.NewPassword2 === '[скрыто]',
   'разные написания и вложенность покрыты одним правилом');

console.log('\n── 2. Сырое тело не отдаётся наружу ──');
// Вырезание при записи закрывает будущее; это — доступ к уже записанному
const rt = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
const hIdx = rt.indexOf('function humanizeLogs');
const hFn = rt.slice(hIdx, hIdx + 700);
ok(/const \{ body, params, \.\.\.safe \} = l;/.test(hFn), 'body и params снимаются с записи');
ok(!/\.\.\.l,\s*\n\s*human:/.test(hFn), 'прежнего «...l» с телом запроса больше нет');
ok(/translate\.describe\(l\.path, body/.test(hFn),
   'внутри тело всё ещё используется — человеческое описание не пострадало');

console.log('\n── 3. Точечное сохранение игрока реально пишет на диск ──');
// Это корень: раньше flushUsers получала пустой список и молча выходила
victim.dollars = 12345;
db.markUser(victim.id);
await new Promise((r) => setTimeout(r, 900));
const seen = db.sql("SELECT json_extract(data,'$.dollars') d FROM players WHERE id = ?", [victim.id]);
ok(seen.length === 1 && seen[0].d === 12345,
   `изменение дошло до базы без остановки сервера: ${seen[0] && seen[0].d}`);
const dbSrc = fs.readFileSync(path.join(ROOT, 'src/core/db.ts'), 'utf8');
ok(/flushUsers\(needAllUsers, userIds\)/.test(dbSrc), 'список изменённых передаётся явно');
ok(/async function flushUsers\(allUserIds: boolean, ids\?: string\[\]\)/.test(dbSrc),
   'flushUsers принимает список, а не читает уже очищенный набор');
ok(/markUser\(\) не\s*\n\/\/ работал вообще/.test(dbSrc) || /markUser\(\) не/.test(dbSrc),
   'причина записана в коде — чтобы не вернули как было');

console.log('\n── 5. Выдача помечает цель на запись ──');
const adminSrc = fs.readFileSync(path.join(ROOT, 'src/services/admin.ts'), 'utf8');
const fnBody = (name) => {
  const i = adminSrc.indexOf(`function ${name}(`);
  const rest = adminSrc.slice(i + 10);
  const m = rest.search(/\n(async )?function /);
  return rest.slice(0, m > 0 ? m : 5000);
};
for (const fn of ['grant', 'grantAll', 'take', 'setBan', 'resetAccount', 'deleteAccount', 'setPassword']) {
  const b = fnBody(fn);
  ok(/markUser|save\('users'\)/.test(b), `${fn}: цель сохраняется`);
}
ok(/kill -9, OOM/.test(adminSrc), 'в коде записано, почему это важно');

console.log('\n── 6. Откат снимка привязан к своей коллекции ──');
// Раньше снимок брался по одному seq и писался в любую названную
// коллекцию: перепутанная пара портила обе сразу
db.load('worldTest', { где: 'мир' });
db.load('marketTest', { где: 'рынок' });
ok(db.snapshotCollection('worldTest', 'проверка'), 'снимок коллекции сделан');
const snaps = db.snapshotsList('worldTest', 5);
ok(snaps.length >= 1, `снимков: ${snaps.length}`);
const seq = snaps[0].seq;
let refused = '';
try { db.snapshotRestore(seq, 'marketTest'); }
catch (e) { refused = e.message; }
ok(/сделан с коллекции «worldTest»/.test(refused), `чужая коллекция отклонена: «${refused.slice(0, 60)}…»`);
ok(db.load('marketTest', {}).где === 'рынок', 'данные рынка не испорчены');
ok(db.snapshotRestore(seq, 'worldTest') === true, 'в свою коллекцию откат проходит');

console.log('\n── 7. Замок базы атомарен и не fail-open в проде ──');
ok(/flag: 'wx'/.test(dbSrc), 'замок создаётся атомарно (wx), а не existsSync + write');
ok(/e\.code !== 'EEXIST'/.test(dbSrc), 'занятость отличается от прочих ошибок');
ok(/NODE_ENV\) === 'production'/.test(dbSrc), 'в проде без замка запуск прерывается');
// Раньше здесь проверялось, что небезопасное TLS-подключение к облаку
// возможно только по явному согласию. Теперь облачной базы нет вовсе —
// проверка сильнее: подключаться просто нечем.
ok(!/require\(['"]mongodb['"]\)/.test(dbSrc), 'драйвер mongodb не подключается — облачной базы в коде нет');
ok(!/tlsInsecure/.test(dbSrc), 'ослабления проверки сертификата в коде не осталось');

console.log('\n── 8. Дефекты интерфейса из аудита ──');
const aj = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
// Дубль id: у владельца рендерились ДВА блока почты, вторая кнопка мертва
ok((aj.match(/id="mail-box"/g) || []).length === 1, 'блок почты один — дублирующихся id нет');
ok((aj.match(/id="mail-check"/g) || []).length === 1, 'и кнопка одна');
ok(/Admin\.can\('security'\) \|\| \(Admin\.me && Admin\.me\.staffRole === 'owner'\)/.test(aj),
   'условие показа одно, а не два перекрывающихся');
// Устаревшая подсказка на удалённую вкладку
ok(!/во вкладке «🛠 Инструменты»/.test(aj), 'подсказка больше не отправляет в удалённую вкладку');
ok(/во вкладке «🛠 Экономика»/.test(aj), 'и указывает на существующую');
// Фильтр журнала — на сервере
const adminSrv = fs.readFileSync(path.join(ROOT, 'src/services/admin.ts'), 'utf8');
ok(/LOG_CATEGORIES/.test(adminSrv), 'категории журнала заданы на сервере');
ok(/category=\$\{encodeURIComponent\(cat\)\}/.test(aj), 'панель передаёт категорию на сервер');
ok(!/logs\.filter\(filterFn/.test(aj), 'браузерной фильтрации по 200 строкам больше нет');
ok(/scanned/.test(adminSrv) && /отобрано из/.test(aj),
   'видно, из скольких записей отобрано — «пусто» больше не выглядит как «не было»');
ok(/data-filter="admin"/.test(aj), 'добавлена категория действий сотрудников');
// Право «Акции» без «Ресурсов» теперь имеет вход
ok(/zones:\['economy', 'discounts'\]/.test(aj), 'вкладка «Экономика» открывается по любому из прав');
ok(/t\.zones \? t\.zones\.some/.test(aj), 'проверка прав понимает список зон');
// Пустой userId больше не означает «у всех»
ok(/applyToAll/.test(adminSrv), 'массовость требует явного флага');
ok(/это отдельная массовая операция/.test(adminSrv), 'пустое поле объясняется, а не срабатывает');
ok(/applyToAll: true/.test(aj), 'панель ставит флаг только при осознанном выборе');
// Двойной клик
const apiJs = fs.readFileSync(path.join(ROOT, 'public/js/api.js'), 'utf8');
ok(/_inFlight/.test(apiJs), 'повторная отправка того же запроса не уходит на сервер дважды');
ok(/Двойной клик по\s*\n\s*\/\/ «Выдать» — две выдачи/.test(apiJs) || /две выдачи/.test(apiJs),
   'причина записана в коде');

console.log('\n── 10. Ничего не сломано ──');
ok(Object.keys(player.users()).length >= 2, 'игроки на месте');
const rows2 = db.logsBetween(0, Date.now() + 1000, undefined, 20);
ok(rows2.length > 0, 'журнал читается');
ok(rows2.every((r) => r.desc || r.path), 'записи осмысленны');

console.log('\n── 9. Выдача переживает АВАРИЙНОЕ завершение ──');
await db.flushAllNow();
db.closeDb();
try { fs.rmSync(WORK + '/data/.db-lock'); } catch (e) {}
// Дочерний процесс выдаёт ресурсы и падает без штатной остановки
try {
  cp.execSync(`node ${CRASH}`, { stdio: 'pipe', env: { ...process.env }, timeout: 30000 });
} catch (e) { /* SIGKILL — ожидаемо */ }
try { fs.rmSync(WORK + '/data/.db-lock'); } catch (e) {}

// Читаем базу заново, уже третьим процессом
const check = cp.execSync(
  `node -e "process.env.DB_DRIVER='sqlite';` +
  `const db=require('${ROOT}/dist/src/core/db');` +
  `(async()=>{await db.init();` +
  `const p=Object.values(require('${ROOT}/dist/src/services/player').users()).find(x=>x.name==='Жертва');` +
  `console.log(JSON.stringify({gold:p.gold,dollars:p.dollars,xp:p.xp}));db.closeDb();})();"`,
  { encoding: 'utf8', env: { ...process.env } });
const state = JSON.parse((check.match(/\{"gold".*\}/) || ['{}'])[0]);
ok(state.gold === 10000, `выданное золото уцелело: ${state.gold}`);
// 12 345 записаны в разделе 3, выдача добавила 7 777 — итог 20 122.
// Проверяем именно сумму: так видно, что уцелело И прежнее состояние,
// И выданное сверху, а не что-то одно перезаписало другое.
ok(state.dollars === 12345 + 7777,
   `выданные деньги легли поверх прежних: ${state.dollars} = 12 345 + 7 777`);
ok(state.xp === 424242, `обычный прогресс игрока тоже уцелел: ${state.xp}`);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
