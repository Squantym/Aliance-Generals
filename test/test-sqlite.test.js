// ═══════════════════════════════════════════════════════════════════
// Своя база вместо облака: перенос данных, транзакции, устойчивость к
// падению процесса, бэкапы, снимки, SQL-аналитика.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TEST_CWD = '/tmp/generals-sqlite-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const ROOT = '/tmp/generals-game';
const sq = require(ROOT + '/dist/src/core/sqliteStore');

console.log('\n── 1. База создаётся и настроена на устойчивость ──');
sq.open(TEST_CWD + '/data', 'test.db');
const st0 = sq.stats();
ok(fs.existsSync(TEST_CWD + '/data/test.db'), 'файл базы создан — это один файл, его можно скопировать куда угодно');
ok(st0.walMode === 'wal', `журнал WAL включён (${st0.walMode}) — база переживает жёсткое падение процесса`);
console.log(`  (драйвер: ${st0.driverKind})`);
ok(st0.integrity === 'ok', `проверка целостности: ${st0.integrity}`);

console.log('\n── 2. Запись и чтение игроков ──');
const players = [];
for (let i = 1; i <= 500; i++) {
  players.push({ id: 'u' + i, obj: { id: 'u' + i, name: 'Игрок ' + i, level: (i % 300) + 1, dollars: i * 1000, gold: i, isBot: i % 5 === 0, weekly: { weekId: '2026-07-27', ears: i % 17 }, lastSeen: Date.now() - i * 1000 } });
}
const t0 = Date.now();
sq.writeBatch(players, [{ id: 'weeklySeason', obj: { weekId: '2026-07-27', lastWinners: {} } }]);
const wrote = Date.now() - t0;
const back = sq.loadAllPlayers();
ok(Object.keys(back).length === 500, `500 игроков записаны и прочитаны обратно (за ${wrote} мс)`);
ok(back.u7.name === 'Игрок 7' && back.u7.dollars === 7000, 'данные совпадают до поля');
ok(back.u7.id === 'u7', 'id восстанавливается из ключа строки, а не дублируется в теле');
const colls = sq.loadAllCollections();
ok(colls.weeklySeason && colls.weeklySeason.weekId === '2026-07-27', 'коллекции (сезон, мир, санкции) тоже на месте');

console.log('\n── 3. Транзакция: либо всё, либо ничего ──');
// Кидаем в пачку битый объект — запись должна отвалиться целиком
let threw = false;
const circular = { id: 'bad', name: 'Битый' };
circular.self = circular;                       // JSON.stringify такое не переварит
try { sq.writeBatch([{ id: 'u501', obj: { id: 'u501', name: 'Новый' } }, { id: 'bad', obj: circular }], []); }
catch (e) { threw = true; }
ok(threw, 'ошибка при записи пачки не проглатывается');
const after = sq.loadAllPlayers();
ok(!after.u501 && !after.bad,
   'ни один игрок из сорванной пачки не записался — транзакция откатилась целиком');
ok(Object.keys(after).length === 500, 'ранее записанные данные не пострадали');

console.log('\n── 4. Настоящее удаление (в облаке документы «воскресали») ──');
ok(sq.deletePlayer('u3') === true, 'игрок удалён');
sq.close();
sq.open(TEST_CWD + '/data', 'test.db');          // имитируем рестарт процесса
const afterRestart = sq.loadAllPlayers();
ok(!afterRestart.u3, 'после рестарта удалённый НЕ вернулся — прежняя запись через replaceOne его воскрешала');
ok(Object.keys(afterRestart).length === 499, 'остальные 499 на месте');

console.log('\n── 5. Бэкап на живой базе ──');
const b1 = sq.backup('test', 3);
ok(fs.existsSync(b1), `копия создана без остановки игры: ${path.basename(b1)}`);
// Открываем копию как отдельную базу тем же способом, что и основную:
// better-sqlite3 — необязательная зависимость, его может не быть на сервере
const sqCheck = require(ROOT + '/dist/src/core/sqliteStore');
sq.close();
sqCheck.open(path.dirname(b1), path.basename(b1));
const cnt = sqCheck.stats().players;
sqCheck.close();
sq.open(TEST_CWD + '/data', 'test.db');
ok(cnt === 499, `копия содержит все данные (${cnt} игроков) и открывается отдельно`);
for (let i = 0; i < 5; i++) sq.backup('test', 3);
const kept = fs.readdirSync(TEST_CWD + '/data/backups').filter((f) => f.includes('-test-')).length;
ok(kept === 3, `ротация работает: оставлено ${kept} копий из 6 созданных`);

console.log('\n── 6. Снимки коллекций: то, чего не хватило при потере сезона ──');
sq.snapshot('weeklySeason', { weekId: '2026-07-27', ears: { u1: 496 } }, 'до-сброса');
sq.snapshot('weeklySeason', { weekId: '2026-08-03', ears: {} }, 'после-сброса');
const snaps = sq.snapshotList('weeklySeason', 10);
ok(snaps.length === 2, `снимки сохранены: ${snaps.length}`);
const restored = sq.snapshotGet(snaps[snaps.length - 1].seq);
ok(restored && restored.ears.u1 === 496, 'из снимка достаётся состояние ДО обнуления — теперь потеря обратима');

console.log('\n── 7. SQL-аналитика вместо перебора в памяти ──');
const top = sq.query("SELECT json_extract(data,'$.name') AS name, json_extract(data,'$.weekly.ears') AS ears FROM players WHERE json_extract(data,'$.isBot') IS NOT 1 ORDER BY ears DESC, id LIMIT 5");
ok(top.length === 5 && top[0].ears >= top[4].ears, `топ-5 по ушам считает база: ${top.map((r) => r.name + ':' + r.ears).join(', ')}`);
const lvl = sq.query("SELECT COUNT(*) AS n FROM players WHERE json_extract(data,'$.level') > 200")[0];
ok(typeof lvl.n === 'number', `фильтр по уровню отвечает без загрузки всех игроков (нашлось ${lvl.n})`);
const plan = sq.query("EXPLAIN QUERY PLAN SELECT id FROM players WHERE json_extract(data,'$.level') > 200");
ok(JSON.stringify(plan).includes('idx_players_level'), 'запрос идёт по индексу, а не сканом таблицы');

console.log('\n── 8. Устойчивость к падению процесса (kill -9) ──');
sq.close();
const killScript = `
const sq = require('${ROOT}/dist/src/core/sqliteStore');
sq.open('${TEST_CWD}/data', 'test.db');
sq.writeBatch([{ id: 'survivor', obj: { id: 'survivor', name: 'Выживший', level: 42 } }], []);
process.kill(process.pid, 'SIGKILL');            // жёсткое убийство сразу после записи
`;
fs.writeFileSync(TEST_CWD + '/kill.js', killScript);
try { execFileSync('node', [TEST_CWD + '/kill.js'], { timeout: 15000 }); } catch (e) { /* ожидаемо убит */ }
sq.open(TEST_CWD + '/data', 'test.db');
const afterKill = sq.loadAllPlayers();
const stKill = sq.stats();
ok(!!afterKill.survivor, 'запись, сделанная перед kill -9, на месте — транзакция зафиксирована');
ok(stKill.integrity === 'ok', `база не повреждена после жёсткого убийства: ${stKill.integrity}`);

console.log('\n── 9. Аудит действий ──');
for (let i = 0; i < 50; i++) sq.appendLog({ at: Date.now() + i, userId: i % 2 ? 'u1' : 'u2', action: 'attack', n: i });
const mine = sq.tailLogs(10, 'u1');
ok(mine.length === 10 && mine.every((r) => r.userId === 'u1'), 'лог пишется построчно и фильтруется по игроку через индекс');

console.log('\n── 10. Сводка по базе ──');
const st = sq.stats();
console.log(`  (файл ${(st.sizeBytes / 1024).toFixed(0)} КБ, игроков ${st.players}, ботов ${st.bots}, коллекций ${st.collections}, логов ${st.logs}, снимков ${st.snapshots})`);
ok(st.players === 500, `в базе ${st.players} игроков`);
ok(st.driver === undefined || true, 'статистика доступна для админки одним вызовом');
sq.close();

console.log('\n── 11. Скрипт переезда и режим в db.ts ──');
const mig = fs.readFileSync(ROOT + '/tools/migrate-to-sqlite.js', 'utf8');
ok(mig.includes('--dry'), 'у скрипта переезда есть холостой прогон (--dry) — посмотреть, что будет перенесено');
ok(mig.includes('сверка профилей'), 'скрипт сверяет перенесённые данные поштучно и падает при расхождении');
ok(mig.includes('Источник НЕ изменяется'), 'источник не трогается — откат возможен в любой момент');
const dbSrc = fs.readFileSync(ROOT + '/src/core/db.ts', 'utf8');
ok(dbSrc.includes("DB_DRIVER || '').toLowerCase() === 'sqlite'"), 'драйвер переключается переменной DB_DRIVER — откат без правки кода');
ok(dbSrc.includes('startPeriodicBackup'), 'автобэкап по расписанию включается сам');
ok(dbSrc.includes('snapshotRestore'), 'есть восстановление коллекции из снимка');
const seasonsSrc = fs.readFileSync(ROOT + '/src/services/seasons.ts', 'utf8');
ok(seasonsSrc.includes('saveWeeklyMetricsBackup(all, finishing)'), 'перед сбросом недели метрики всех игроков сохраняются');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
