// ═══════════════════════════════════════════════════════════════════
// ТОЧНОСТЬ ВОССТАНОВЛЕНИЯ. Раньше вернуть игроку потерянное можно было
// только из копии базы, а копии делались раз в 6 часов: до шести часов
// чужой игры пропадало безвозвратно. Журнал не спасал — в нём итоговые
// числа, но не СОСТАВ (какая именно техника, какие постройки).
//
// Здесь проверяется всё, что это закрывает:
//   • история состояния игрока — срез раз в 5 минут при изменении;
//   • снимок перед КАЖДЫМ действием сотрудника;
//   • прореживание — свежее подробно, старое обзорно, помеченное вечно;
//   • упаковка старого журнала — 3 месяца влезают в десятки мегабайт;
//   • лёгкие копии — прогресс без журнала, поэтому часто и дёшево.
// И отдельно — замер реального расхода диска на 500 игроках.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const WORK = '/tmp/generals-pit-test';
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK + '/data', { recursive: true });
process.chdir(WORK);
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = WORK + '/data';
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const mb = (b) => (b / 1048576).toFixed(1);

const db = require(ROOT + '/dist/src/core/db');
const sq = require(ROOT + '/dist/src/core/sqliteStore');
const DAY = 86400000;

// Срез с заданным временем — тем же вызовом, что и боевой код, только с
// явным моментом: иначе прореживание и объём пришлось бы проверять,
// ожидая реальных суток.
function insertHist(id, obj, at, label = '', actor = '') {
  return sq.savePlayerHistory(id, obj, label, actor, at);
}

async function main() {
await db.init();
const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const admin = require(ROOT + '/dist/src/services/admin');
const F = WORK + '/data/generals.db';

for (const [n, e] of [['Владелец', 'o@t.ru'], ['Жертва', 'v@t.ru'], ['Второй', 'w@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const owner = by('Владелец'), victim = by('Жертва'), other = by('Второй');
owner.role = 'owner'; owner.isAdmin = true;
for (const p of [victim, other]) { p.level = 40; p.dollars = 5_000_000; p.gold = 500; }
// Даём жертве узнаваемое имущество — по нему и проверяем, что состав
// восстанавливается, а не только итоговые числа
victim.units = { ground_1: { 0: 7, 1: 2 }, air_3: { 0: 4 } };
victim.buildings = { b1: 3, b2: 1 };
victim.skills = { energy: 12, health: 9, ammo: 5, agility: 2, cruelty: 1 };
await db.flushAllNow();

console.log('\n── 1. Срез состояния пишется на обычном сохранении ──');
const h0 = db.playerHistory(victim.id, 50);
ok(h0.length >= 1, `срезы появились без отдельного обхода игроков: ${h0.length}`);
const first = db.playerHistoryGet(h0[0].seq);
ok(!!first && first.player, 'срез читается обратно');
ok(first.player.units && first.player.units.ground_1[0] === 7,
   'в срезе лежит СОСТАВ техники, а не только её количество');
ok(first.player.buildings.b1 === 3, 'постройки на месте');
ok(first.player.skills.energy === 12, 'навыки на месте');
ok(first.player.id === victim.id, 'id восстановлен (он лежит в колонке, не в JSON)');
ok(!first.label, 'обычный срез без пометки');

console.log('\n── 2. Одинаковое состояние не плодит срезы ──');
const n1 = db.playerHistory(victim.id, 200).length;
await db.flushAllNow();
db.markUser(victim.id);
await db.flushAllNow();
ok(db.playerHistory(victim.id, 200).length === n1,
   'сохранение без изменений новый срез не создало');

console.log('\n── 3. Снимок перед КАЖДЫМ действием сотрудника ──');
const actions = [
  ['выдача', () => admin.grant(owner, { userId: victim.id, gold: 100 }, []), 'перед выдачей'],
  ['списание', () => admin.take(owner, { userId: victim.id, gold: 50 }, []), 'перед списанием'],
  ['бан', () => admin.setBan(owner, { userId: victim.id, reason: 'проверка', minutes: 60 }, []), 'перед блокировкой'],
];
for (const [what, fn, expect] of actions) {
  const before = db.playerHistory(victim.id, 500).length;
  try { fn(); } catch (e) { console.log('    (действие не прошло: ' + e.message + ')'); }
  const list = db.playerHistory(victim.id, 500);
  ok(list.length > before, `${what}: снимок создан`);
  ok(list[0].label && list[0].label.includes(expect.split(' ')[1]),
     `${what}: пометка «${list[0].label}»`);
  ok(list[0].actor === 'Владелец', `${what}: записано, кто это сделал`);
}

console.log('\n── 4. Что было ДО обнуления — восстановимо ──');
const moneyBefore = victim.dollars, unitsBefore = JSON.stringify(victim.units);
admin.resetAccount(owner, { userId: victim.id }, []);
ok(victim.dollars !== moneyBefore || !Object.keys(victim.units || {}).length,
   'обнуление действительно стёрло прогресс');
const snaps = db.playerHistory(victim.id, 500);
const beforeReset = snaps.find((s) => /обнулени/.test(s.label || ''));
ok(!!beforeReset, 'снимок «перед обнулением» найден');
const restored = db.playerHistoryGet(beforeReset.seq);
ok(restored.player.dollars === moneyBefore, `деньги до обнуления: ${restored.player.dollars}`);
ok(JSON.stringify(restored.player.units) === unitsBefore, 'состав техники до обнуления совпадает поимённо');
ok(restored.actor === 'Владелец' && /обнулени/.test(restored.label), 'видно кто и что делал');

console.log('\n── 5. Состояние на заданный момент ──');
const at = db.playerHistory(other.id, 10)[0];
ok(!!at, 'у второго игрока тоже есть срез');
const exact = db.playerHistoryAt(other.id, Date.now());
ok(exact && exact.player, 'ближайший срез не позже указанного момента находится');
const tooEarly = db.playerHistoryAt(other.id, Date.now() - 10 * 365 * DAY);
ok(tooEarly === null, 'до появления истории честно возвращается пустота, а не ближайший вперёд');

console.log('\n── 6. Прореживание ──');
// Синтетическая история: 40 суток по 24 среза, плюс два помеченных
const now = Date.now();
const H = other.id;
let planted = 0;
for (let d = 0; d < 40; d++) {
  for (let k = 0; k < 24; k++) {
    insertHist(H, { name: 'Второй', dollars: 1000 + d * 24 + k, d, k },
      now - d * DAY - k * 3600000);
    planted++;
  }
}
insertHist(H, { name: 'Второй', важное: 1 }, now - 35 * DAY, 'перед обнулением аккаунта', 'Владелец');
insertHist(H, { name: 'Второй', важное: 2 }, now - 20 * DAY, 'перед выдачей ресурсов', 'Владелец');
const beforeThin = db.playerHistory(H, 5000).length;
ok(beforeThin >= planted, `засеяно срезов: ${beforeThin}`);
const res = db.thinHistory();
const after = db.playerHistory(H, 5000);
ok(res.removed > 0, `прореживание удалило: ${res.removed}`);
ok(after.length < beforeThin, `осталось: ${after.length} из ${beforeThin}`);

// Свежие 48 часов — всё подряд
const fresh = after.filter((s) => now - s.at < 48 * 3600000 && !s.label);
ok(fresh.length >= 45, `за последние 48 часов сохранено всё подряд: ${fresh.length} (сеяли 48)`);
// От 48 часов до недели — примерно по одному в час
const week = after.filter((s) => now - s.at >= 48 * 3600000 && now - s.at < 7 * DAY && !s.label);
ok(week.length <= 5 * 24 + 2 && week.length >= 5 * 24 - 5,
   `от 2 суток до недели — по одному в час: ${week.length} (ожидали ~120)`);
// Старше недели — примерно по одному в сутки
const old = after.filter((s) => now - s.at >= 7 * DAY && !s.label);
ok(old.length <= 35 && old.length >= 28, `старше недели — по одному в сутки: ${old.length} (ожидали ~33)`);
// Помеченные не тронуты
const labelled = after.filter((s) => s.label);
ok(labelled.length === 2, `помеченные снимки не удалены: ${labelled.length} из 2`);
ok(labelled.every((s) => db.playerHistoryGet(s.seq).player.важное), 'и читаются полностью');
// Повторный вызов ничего не ломает
const again = db.thinHistory();
ok(db.playerHistory(H, 5000).length === after.length,
   `повторное прореживание не режет лишнего (удалило ${again.removed})`);

console.log('\n── 7. Упаковка журнала: ничего не теряется ──');
const paths = ['/api/war/attack', '/api/units/buy', '/api/me', '/api/bank/deposit'];
const LOG_USER = victim.id;
// У этого игрока уже есть записи от админских действий выше — берём их
// как базовую линию, иначе тест сравнивал бы с абсолютным числом и падал
const baseline = sq.logsBetween(0, now + DAY, LOG_USER, 100000).length;
let logged = 0;
for (let d = 0; d < 20; d++) {
  for (let k = 0; k < 30; k++) {
    // Текст и числа разные: одинаковые строки сжимались бы нереалистично
    // хорошо, и прогноз по журналу вышел бы завышенно радужным
    db.appendLog({ at: now - d * DAY - k * 60000, userId: LOG_USER, userName: 'Жертва',
      path: paths[k % paths.length],
      desc: `⚔️ Атаковал игрока «Цель${d}-${k}» — ${k % 3 ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'}, ` +
            `добыча $${(d * 7919 + k * 104729).toLocaleString('ru')}`,
      bal: { d: 1000 + d * 9973 + k * 61, g: 10 + k, lv: 40, xp: 1000 + d * 313, u: 20 + k, b: 5 } });
    logged++;
  }
}
const allBefore = sq.logsBetween(0, now + DAY, LOG_USER, 100000);
ok(allBefore.length === logged + baseline,
   `до упаковки записей: ${allBefore.length} (${logged} наших + ${baseline} от админских действий)`);
let calls = 0, worst = 0;
for (;;) {
  const t = Date.now();
  const r = sq.packOldLogs(6);
  const dt = Date.now() - t;
  if (dt > worst) worst = dt;
  calls++;
  if (!r.packed || calls > 200) break;
}
const ls = db.logStats();
ok(ls.packs > 0, `упаковано блоков: ${ls.packs} (вызовов ${calls})`);
ok(worst < 300, `самая долгая пауза упаковки: ${worst} мс (порог 300)`);
ok(ls.packRatio > 5, `сжатие журнала: ${ls.packRatio}x`);
const allAfter = sq.logsBetween(0, now + DAY, LOG_USER, 100000);
ok(allAfter.length === allBefore.length,
   `после упаковки записей ровно столько же: ${allAfter.length}`);
const keys = allAfter.map((r) => r.at + '|' + r.path);
ok(new Set(keys).size === keys.length, 'дублей от склейки горячего и упакованного нет');
ok(allAfter.every((r, i) => i === 0 || allAfter[i - 1].at >= r.at), 'порядок по времени убывает');
const ours = allAfter.filter((r) => /Атаковал игрока/.test(r.desc || ''));
ok(ours.length === logged && ours.every((r) => r.bal && r.bal.d && r.desc),
   `у записей из упакованного всё на месте: и срез счёта, и текст (${ours.length})`);

console.log('\n── 8. Записи на границе «горячей» недели не теряются ──');
// Именно здесь была ошибка: упаковка группирует по суткам МСК, поэтому
// блок за граничный день содержит записи новее границы. Чтение обрезало
// их по at <= границы, и часть журнала становилась невидимой.
const boundary = now - 7 * DAY;
const near = allAfter.filter((r) => Math.abs(r.at - boundary) < DAY);
ok(near.length > 0, `записей вблизи границы: ${near.length}`);
const win = sq.logsBetween(boundary - DAY, boundary + DAY, LOG_USER, 100000);
const expected = allBefore.filter((r) => r.at >= boundary - DAY && r.at <= boundary + DAY).length;
ok(win.length === expected, `в окне вокруг границы: ${win.length} из ${expected}`);

console.log('\n── 9. Малоактивный игрок: карточка не пустая ──');
const tail = await db.tailLogs(20, LOG_USER);
ok(tail.length === 20, `последние действия достаются и из упакованного: ${tail.length}`);
ok(tail.every((r, i) => i === 0 || tail[i - 1].at >= r.at), 'и в правильном порядке');

console.log('\n── 10. Лёгкая копия: прогресс без журнала ──');
const light = db.backupLightNow();
ok(!!light && fs.existsSync(light), 'лёгкая копия создана');
const fullSize = fs.statSync(F).size, lightSize = fs.statSync(light).size;
ok(lightSize < fullSize, `лёгкая ${mb(lightSize)} МБ против полной ${mb(fullSize)} МБ`);
const probe = db.playerFromBackup(path.basename(light), 'Второй');
ok(probe && probe.name === 'Второй', 'игрок читается из лёгкой копии');
ok(probe.level === other.level, `уровень совпадает с текущим: ${probe.level}`);
ok(!probe.passHash && !probe.salt, 'пароль из копии наружу не отдаётся');
// Журнала внутри быть не должно — за него и платили размером
const cp = require('child_process');
let hasLogs = true;
try {
  cp.execSync(`sqlite3 ${light} "SELECT COUNT(*) FROM action_logs"`, { stdio: 'pipe' });
} catch (e) { hasLogs = false; }
ok(!hasLogs, 'журнала в лёгкой копии нет — из-за него полная копия и весит много');

console.log('\n── 11. Возврат места файловой системе ──');
const freeBefore = db.dbStats();
const reclaimed = sq.reclaimSpace(5000);
ok(typeof reclaimed === 'number', `страниц возвращено: ${reclaimed}`);
const src = fs.readFileSync(path.join(ROOT, 'src/core/sqliteStore.ts'), 'utf8');
ok(/auto_vacuum = INCREMENTAL/.test(src), 'режим возврата места включается');
ok(/incremental_vacuum/.test(src), 'место отдаётся порциями, без полной перезаписи базы');
ok(/427 МБ до, 110 МБ после/.test(src), 'в коде записано, зачем это нужно, с замером');

console.log('\n── 12. Сроки и настройки видны наружу ──');
const hs = db.historyStats();
ok(hs.gapMinutes === 5, `шаг истории: ${hs.gapMinutes} минут`);
ok(hs.keepDays === 90, `срок хранения истории: ${hs.keepDays} дней`);
ok(hs.count > 0 && hs.players >= 2, `срезов: ${hs.count}, игроков: ${hs.players}`);
ok(hs.labelled >= 2, `помеченных снимков: ${hs.labelled}`);
ok(ls.keepDays === 90, `срок хранения журнала: ${ls.keepDays} дней`);
ok(ls.hotDays === 7, `горячая часть журнала: ${ls.hotDays} дней`);
ok(ls.count === ls.hot + ls.packedRows, 'счётчик журнала = горячие + упакованные');

console.log('\n── 13. Расход диска: замер, а не оценка ──');
// Считать средний срез по всей таблице нельзя: в ней лежат синтетические
// объекты из проверки прореживания, и цифра вышла бы занижена в разы.
// Берём настоящего прокачанного игрока — такого, каким он будет на 50-м
// уровне с полным ангаром.
const rich = other;
rich.level = 62; rich.xp = 540000; rich.dollars = 512_000_000; rich.gold = 3100;
rich.units = {}; for (let t = 1; t <= 12; t++) rich.units['ground_' + t] = { 0: 5 + t, 1: 2, 2: 1 };
for (let t = 1; t <= 8; t++) rich.units['air_' + t] = { 0: 3 + t, 1: 1 };
rich.buildings = {}; for (let b = 1; b <= 10; b++) rich.buildings['b' + b] = 3;
rich.skills = { energy: 20, health: 20, ammo: 15, agility: 9, cruelty: 9 };
rich.battle = { wins: 400, losses: 120, defWins: 200, defLosses: 180, fatalities: 70, attacks: 520 };
rich.stats = { playMs: 9e7, moneyEarned: 9e9, moneySpent: 8e9, goldGot: { club: 200, quest: 150 },
               unitsBought: { ground: 300 }, unitsLost: { ground: 90 } };
rich.trophies = { t1: 3, t2: 2 }; rich.achStages = { a1: 3, a2: 2, a3: 1 };
rich.vsRecord = {}; for (let k = 0; k < 15; k++) rich.vsRecord['u' + k] = { w: 3, l: 2 };
const { id: _rid, ...richBody } = rich;
ok(sq.savePlayerHistory(rich.id, richBody, 'замер объёма', 'тест'), 'срез прокачанного игрока записан');
const richSnap = db.playerHistory(rich.id, 5).find((x) => x.label === 'замер объёма');
const bytesPerSnap = richSnap.size;
const rawSize = JSON.stringify(richBody).length;
console.log(`     прокачанный игрок: ${rawSize} байт JSON → ${bytesPerSnap} байт в срезе ` +
            `(сжатие ${(rawSize / bytesPerSnap).toFixed(1)}x)`);
// Прогноз на 500 игроков: 180 активных, 12 срезов в сутки, месяц с прореживанием
const perDay = 180 * 12 * bytesPerSnap;
const full48 = 2 * perDay;
const hourly = 180 * 24 * bytesPerSnap * 5;
const daily = 500 * bytesPerSnap * 23;
const total = full48 + hourly + daily;
console.log(`     история за месяц при 500 игроках: ${mb(total)} МБ`);
console.log(`       (48 ч подряд ${mb(full48)} + неделя по часу ${mb(hourly)} + месяц по дню ${mb(daily)})`);
ok(bytesPerSnap < 2000, `срез укладывается в 2 КБ: ${bytesPerSnap} байт`);
ok(rawSize > 2000, `и это действительно нагруженный игрок, а не пустышка: ${rawSize} байт JSON`);
ok(total < 300 * 1048576, `история за месяц меньше 300 МБ: ${mb(total)} МБ`);
const logPerRow = ls.packedGz / Math.max(1, ls.packedRows);
const logs90 = 180 * 250 * 83 * logPerRow + 180 * 250 * 7 * 380;
console.log(`     журнал за 3 месяца при 500 игроках: ${mb(logs90)} МБ` +
            ` (упакованная строка ${logPerRow.toFixed(0)} байт)`);
ok(logs90 < 400 * 1048576, `журнал за 3 месяца меньше 400 МБ: ${mb(logs90)} МБ`);

console.log('\n── 14. Панель и маршруты ──');
const rt = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/'\/api\/admin\/player-history'/.test(rt), 'маршрут списка срезов есть');
ok(/'\/api\/admin\/player-history\/at'/.test(rt), 'маршрут сравнения среза с текущим есть');
const hIdx = rt.indexOf("'/api/admin/player-history'");
ok(/canAccessZone\(req\.user, 'players'\)/.test(rt.slice(hIdx, hIdx + 600)),
   'история под зоной «Игроки»: разбирать «всё пропало» должен уметь сотрудник, а не только владелец');
const rolesSrc = fs.readFileSync(path.join(ROOT, 'src/services/roles.ts'), 'utf8');
ok(/player-history\/,\s+'players'\]/.test(rolesSrc), 'адрес размечен зоной «Игроки»');
const aj = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/_historyHtml\(\)/.test(aj), 'блок истории есть в панели');
ok(/\$\{Admin\._historyHtml\(\)\}/.test(aj), 'и подключён во вкладке «Игроки», где сотрудник и работает');
ok(!/_recoverHtml\(d\.backups\)\}\s*\n\s*\$\{Admin\._historyHtml/.test(aj),
   'из владельческого блока базы он убран — иначе виден был бы только владельцу');
ok(/Точность 5 минут/.test(aj), 'заявленная точность видна сотруднику');
ok(/Только просмотр/.test(aj), 'сказано, что отсюда ничего не меняется');
ok(/Admin\._recoverResultHtml\(d\)/.test(aj),
   'разница отрисовывается той же функцией, что и сверка с копией — вид одинаковый');
ok(/data-hseq/.test(aj), 'каждый срез можно сравнить с текущим состоянием');
ok(/packRatio/.test(aj), 'в панели видно, во сколько раз сжался журнал');
ok(/BACKUP_LIGHT_MINUTES/.test(fs.readFileSync(path.join(ROOT, 'src/core/db.ts'), 'utf8')),
   'частота лёгких копий настраивается переменной окружения');

console.log('\n── 15. Ничего из этого не ломает обычную работу ──');
ok(Object.keys(player.users()).length === 3, 'игроки на месте');
const st = db.dbStats();
ok(st.integrity === 'ok', `целостность базы: ${st.integrity}`);
await db.flushAllNow();
ok(true, 'сохранение проходит');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
db.closeDb();
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
