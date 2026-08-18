// ═══════════════════════════════════════════════════════════════════
// Разбирательство после сбоя: что было у игрока и сколько возвращать.
// Проверяем весь путь — срез счёта в журнале, чтение копии, разница.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-recovery-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const sqlite = require(ROOT + '/dist/src/core/sqliteStore');
const audit = require(ROOT + '/dist/src/services/auditLog');

sqlite.open(TEST_CWD + '/data', 'generals.db');

const BEFORE = {
  id: 'p1', name: 'Абдурахман', dollars: 5_000_000_000, gold: 27865, level: 300, exp: 120238,
  units: { ground_1: { 0: 5000, 1: 200, 2: 50 }, air_9: { 0: 120, 1: 0, 2: 0 } },
  buildings: { sklad: 40, kazarmy: 12 },
  passHash: 'ХЭШ-ПАРОЛЯ', salt: 'СОЛЬ', resetToken: 'ТОКЕН',
};

console.log('\n── 1. Срез счёта пишется рядом с действием ──');
const bal = audit.balanceOf(BEFORE);
ok(bal.d === 5_000_000_000, `деньги: ${bal.d}`);
ok(bal.g === 27865, `золото: ${bal.g}`);
ok(bal.lv === 300 && bal.xp === 120238, 'уровень и опыт');
ok(bal.u === 5370, `техника посчитана по всем Mk: ${bal.u} (5000+200+50+120)`);
ok(bal.b === 52, `здания: ${bal.b} (40+12)`);
ok(audit.balanceOf(null) === undefined, 'без игрока среза нет — пустышку не пишем');
ok(audit.balanceOf({}).u === 0, 'у новичка без техники ноль, а не сбой');

console.log('\n── 2. Ключи короткие — журнал не раздувается ──');
ok(Object.keys(bal).join(',') === 'd,g,lv,xp,u,b', `ключи: ${Object.keys(bal).join(',')}`);
const withBal = JSON.stringify({ at: 1, userId: 'p1', path: '/api/war/attack', bal }).length;
const without = JSON.stringify({ at: 1, userId: 'p1', path: '/api/war/attack' }).length;
ok(withBal - without < 90, `срез добавляет ${withBal - without} байт на запись`);

console.log('\n── 3. В журнале виден баланс на момент действия ──');
sqlite.writeBatch([{ id: 'p1', obj: BEFORE }], []);
const T0 = Date.now();
for (let i = 0; i < 3; i++) {
  sqlite.appendLog({ at: T0 - (3 - i) * 60000, userId: 'p1', userName: 'Абдурахман',
    path: '/api/war/attack', desc: '⚔️ Атаковал — ✅ ПОБЕДА', bal: audit.balanceOf(BEFORE) });
}
const logs = sqlite.tailLogs(10, 'p1');
ok(logs.length === 3, `записей в журнале: ${logs.length}`);
ok(logs.every((l) => l.bal && l.bal.d === 5_000_000_000), 'в каждой записи баланс до сбоя');
ok(logs.every((l) => l.desc && !/\/api\//.test(l.desc)), 'описания человекочитаемые');

console.log('\n── 4. Копия базы сделана ──');
const bkPath = sqlite.backup('auto', 14);
const bkFile = path.basename(bkPath);
ok(fs.existsSync(bkPath), `копия создана: ${bkFile}`);

console.log('\n── 5. СБОЙ: часть добра пропала ──');
const AFTER = { ...BEFORE, dollars: 0, gold: 1200,
  units: { ground_1: { 0: 1000, 1: 0, 2: 0 } }, buildings: { sklad: 5 } };
sqlite.writeBatch([{ id: 'p1', obj: AFTER }], []);
const nowBal = audit.balanceOf(AFTER);
ok(nowBal.d === 0 && nowBal.u === 1000, 'текущее состояние обеднело');

console.log('\n── 6. Игрок находится в копии по позывному ──');
const was = sqlite.playerFromBackup(bkFile, 'Абдурахман');
ok(!!was && was.id === 'p1', `найден: ${was && was.name}`);
const byLower = sqlite.playerFromBackup(bkFile, 'абдурахман');
ok(!!byLower, 'регистр позывного не важен');
const byId = sqlite.playerFromBackup(bkFile, 'p1');
ok(!!byId, 'по id тоже находится');
ok(sqlite.playerFromBackup(bkFile, 'НетТакого') === null, 'несуществующий — null, а не ошибка');

console.log('\n── 7. Секреты из копии не выдаются ──');
ok(was.passHash === undefined, 'хэш пароля вырезан');
ok(was.salt === undefined, 'соль вырезана');
ok(was.resetToken === undefined, 'токен восстановления вырезан');
ok(was.dollars === 5_000_000_000, 'игровые данные при этом на месте');

console.log('\n── 8. Разница показывает, сколько возвращать ──');
const a = audit.expandBalance(audit.balanceOf(was));
const b = audit.expandBalance(audit.balanceOf(AFTER));
ok(a.dollars - b.dollars === 5_000_000_000, `к возврату денег: ${a.dollars - b.dollars}`);
ok(a.gold - b.gold === 26665, `золота: ${a.gold - b.gold}`);
ok(a.units - b.units === 4370, `техники: ${a.units - b.units}`);
ok(a.buildings - b.buildings === 47, `зданий: ${a.buildings - b.buildings}`);

console.log('\n── 9. Подстановка пути отбивается ──');
for (const bad of ['../../../etc/passwd', '../generals.db', '/etc/hosts', 'generals.db/../../x']) {
  let blocked = false;
  try { sqlite.playerFromBackup(bad, 'p1'); } catch (e) { blocked = true; }
  ok(blocked, `отклонено: «${bad}»`);
}

console.log('\n── 10. Маршрут и интерфейс на месте ──');
const rt = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/api\/admin\/db\/player-at/.test(rt), 'маршрут сверки с копией добавлен');
// Ищем закрывающую скобку регистрации именно ЭТОГО маршрута, а не окно
// фиксированной длины: обработчик может вырасти, и проверка по окну
// начнёт врать — она уже соврала, когда я дописал разбор ошибок.
const decl = rt.indexOf("app.add('GET', '/api/admin/db/player-at'");
const end = rt.indexOf('{ admin: true }', decl);
const nextAdd = rt.indexOf('app.add(', decl + 10);
ok(decl > 0 && end > 0 && (nextAdd < 0 || end < nextAdd),
   'маршрут закрыт правами администратора');
ok(/function unitDiff/.test(rt) && /function buildDiff/.test(rt), 'поимённая разница считается');
const adm = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/_recoverHtml/.test(adm) && /_recoverResultHtml/.test(adm), 'форма и вывод сверки есть');
ok(/Что было у игрока до сбоя/.test(adm), 'раздел подписан понятно');
ok(/rec-lost/.test(adm), 'пропажи выделяются отдельно');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(/\.rec-row\.rec-lost/.test(css), 'стиль для строк с потерями добавлен');

console.log('\n── 11. Срез счёта уходит в журнал из обработчика запросов ──');
const httpSrc = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
ok(/user: reqCtx\.user/.test(httpSrc), 'объект игрока передаётся в журнал');
const auditSrc = fs.readFileSync(path.join(ROOT, 'src/services/auditLog.ts'), 'utf8');
ok(/bal: entry\.user \? balanceOf/.test(auditSrc), 'срез считается при записи');
ok(!/passHash|salt/.test(auditSrc.slice(auditSrc.indexOf('function balanceOf'),
   auditSrc.indexOf('function expandBalance'))), 'в срез не попадают секреты');

sqlite.close();
console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
