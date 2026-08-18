// ═══════════════════════════════════════════════════════════════════
// Журнал администратора: человекочитаемые записи вместо сырых адресов,
// хранение 3 месяца, история сохранений базы.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-adminlogs-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const tr = require(ROOT + '/dist/src/services/logTranslate');
const db = require(ROOT + '/dist/src/core/db');

console.log('\n── 1. Все POST-действия переводятся ──');
// Главная проверка: берём КАЖДЫЙ боевой маршрут и убеждаемся, что журнал
// покажет фразу, а не адрес. Раньше так показывалось 137 маршрутов.
const routesSrc = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
const posts = [...routesSrc.matchAll(/app\.add\('POST',\s*'([^']+)'/g)].map((m) => m[1]);
const sample = (p) => p.replace('/:kind/', '/legion/').replace(/:id/g, 'abc123').replace(/:[a-zA-Z]+/g, 'x1');
const BODY = { qty: 2, amount: 100, gold: 50, dollars: 1000, name: 'Тест', title: 'Заголовок',
  targetName: 'Жертва', userId: 'u1', role: 'guardian', action: 'attack', kind: 'attack',
  id: 'hp', collection: 'users', seq: 3, minutes: 60, reason: 'причина', digit: 4,
  country: 'ru', email: 'a@b.ru', login: 'komandir', nick: 'Новый', legionId: 'l1',
  ticketId: 't1', accept: true, direction: 2, skill: 'x', mercName: 'Барс', subject: 'Тема' };
const untranslated = posts.filter((p) => !tr.describe(sample(p), BODY, { targetName: 'Цель', win: true, hit: true, powerPct: 80 }));
ok(untranslated.length === 0,
   untranslated.length ? `без перевода осталось ${untranslated.length}: ${untranslated.slice(0, 5).join(', ')}`
                       : `все ${posts.length} POST-маршрутов переводятся`);

console.log('\n── 2. В записях нет технического мусора ──');
const samples = posts.map((p) => tr.describe(sample(p), BODY, { targetName: 'Цель', win: true, hit: true, powerPct: 80 })).filter(Boolean);
const withPath = samples.filter((s) => /\/api\//.test(s));
ok(withPath.length === 0, withPath.length ? `адрес просочился в текст: ${withPath[0]}` : 'ни в одной записи нет адреса /api/...');
const withCamel = samples.filter((s) => /\b(targetId|userId|unitId|buildingId|itemId|siloId|laserId)\b/.test(s));
ok(withCamel.length === 0, withCamel.length ? `имя поля просочилось: ${withCamel[0]}` : 'имён полей вроде targetId в тексте нет');
ok(samples.every((s) => s.trim().length > 3), 'все записи непустые');

console.log('\n── 3. Идентификаторы развёрнуты в названия ──');
ok(/Защитник/.test(tr.describe('/api/group/register', { role: 'guardian' })), 'роль guardian → «Защитник»');
ok(/броня/.test(tr.describe('/api/group/upgrade', { id: 'armor' })), 'улучшение armor → «броня»');
ok(/боеприпасы/.test(tr.describe('/api/legion/battle/restore', { kind: 'ammo' })), 'ресурс ammo → «боеприпасы»');
ok(!/guardian|armor/.test(
   tr.describe('/api/group/register', { role: 'guardian' }) + tr.describe('/api/group/upgrade', { id: 'armor' })),
   'английских идентификаторов в тексте не осталось');

console.log('\n── 4. Русский язык без машинных склеек ──');
ok(/из легиона/.test(tr.describe('/api/group/legion/kick', { name: 'Х' })), 'родительный падеж: «из легиона»');
ok(/из альянса/.test(tr.describe('/api/group/alliance/kick', { name: 'Х' })), '«из альянса»');
ok(/Покинул легион/.test(tr.describe('/api/group/legion/leave', {})), 'именительный там, где он нужен');

console.log('\n── 5. Смысл действия виден целиком ──');
const launch = tr.describe('/api/silos/launch', {}, { targetName: 'Мишень', powerPct: 87 });
ok(/Мишень/.test(launch) && /87/.test(launch), `пуск ракеты: «${launch}»`);
const ban = tr.describe('/api/admin/account-ban', { targetName: 'Бот', minutes: 1440, reason: 'ботоводство' });
ok(/Бот/.test(ban) && /1440/.test(ban) && /ботоводство/.test(ban), `бан: «${ban}»`);
const take = tr.describe('/api/admin/take', { targetName: 'Читер', dollars: 5000000, gold: 300 });
ok(/Читер/.test(take) && /5\.00 M/.test(take) && /300/.test(take), `изъятие: «${take}»`);
ok(/ничего/.test(tr.describe('/api/admin/take', { targetName: 'Х' })), 'пустое изъятие не печатает список нулей');

console.log('\n── 6. Пароли в журнал не попадают ──');
const audit = require(ROOT + '/dist/src/services/auditLog');
const clean = audit.sanitizeBody({ login: 'x', password: 'секрет123' });
// Значение затирается, а поле ОСТАЁТСЯ с пометкой: по журналу должно быть
// видно, что пароль в запросе был, иначе непонятно, что произошло.
ok(clean.password === '[скрыто]', 'значение пароля затёрто, поле помечено');
ok(clean.login === 'x', 'обычные поля не тронуты');
// Главное — самого секрета в журнале нет ни в каком виде
ok(!JSON.stringify(clean).includes('секрет123'), 'секрета в записи нет');
// Раньше вырезалось ТОЛЬКО поле password верхнего уровня, из-за чего
// oldPassword/newPassword с маршрута смены пароля уходили открытым текстом
const deep = audit.sanitizeBody({
  oldPassword: 'старый', newPassword: 'новый', newPassword2: 'новый',
  nested: { api_token: 'т', inner: { passHash: 'х' } }, qty: 3,
});
ok(!JSON.stringify(deep).includes('старый') && !JSON.stringify(deep).includes('новый'),
   'oldPassword/newPassword тоже вырезаны — это была дыра на 90 дней журнала');
ok(deep.nested.api_token === '[скрыто]' && deep.nested.inner.passHash === '[скрыто]',
   'секреты вырезаются и во вложенных объектах');
ok(deep.qty === 3, 'вырезано только секретное');
ok(clean.login === 'x', 'остальные поля сохраняются');

console.log('\n── 7. Срок хранения журнала — 3 месяца ──');
ok(db.LOG_KEEP_MS === 90 * 24 * 3600 * 1000, `константа: ${Math.round(db.LOG_KEEP_MS / 86400000)} дней`);
const sq = fs.readFileSync(path.join(ROOT, 'src/core/sqliteStore.ts'), 'utf8');
ok(/LOG_KEEP_MS = 90 \* 24 \* 3600 \* 1000/.test(sq), 'в своей базе тот же срок');
ok(/DELETE FROM action_logs WHERE at < \?/.test(sq), 'вытеснение идёт ПО ДАТЕ');
ok(!/MAX\(seq\) - \?/.test(sq), 'старое вытеснение по числу записей убрано');
ok(/idx_logs_at/.test(sq), 'есть индекс по времени — чистка не сканирует всю таблицу');

console.log('\n── 8. Старые записи уходят, свежие остаются ──');
db.appendLog({ at: Date.now() - 100 * 24 * 3600 * 1000, userId: 'u1', path: '/api/login' });  // 100 дней
db.appendLog({ at: Date.now() - 10 * 24 * 3600 * 1000, userId: 'u1', path: '/api/login' });   // 10 дней
db.appendLog({ at: Date.now(), userId: 'u1', path: '/api/login' });
const arr = db.load('actionLogs', []);
const tooOld = arr.filter((e) => e.at < Date.now() - db.LOG_KEEP_MS);
ok(tooOld.length === 0, `записей старше срока не осталось (было 1 из 3)`);
ok(arr.length === 2, `свежие сохранены: ${arr.length}`);

console.log('\n── 9. Сводка по журналу для админки ──');
const ls = db.logStats();
ok(ls && typeof ls.count === 'number', `записей в журнале: ${ls.count}`);
ok(ls.keepDays === 90, `срок хранения отдаётся клиенту: ${ls.keepDays} дн.`);
ok(ls.oldestAt > 0 && ls.newestAt >= ls.oldestAt, 'границы периода посчитаны');

console.log('\n── 10. Выборка за период ──');
const from = Date.now() - 30 * 24 * 3600 * 1000;
const got = db.logsBetween(from, Date.now(), 'u1');
ok(Array.isArray(got) && got.length === 2, `за 30 дней найдено записей: ${got.length}`);
ok(db.logsBetween(from, Date.now(), 'нет-такого').length === 0, 'фильтр по игроку работает');

console.log('\n── 11. История сохранений в админке ──');
const adm = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/_backupHistoryHtml/.test(adm), 'список копий вынесен в отдельную функцию');
ok(/История сохранений/.test(adm), 'раздел подписан');
ok(/по расписанию/.test(adm) && /вручную/.test(adm) && /перед откатом/.test(adm),
   'видно, чем создана каждая копия');
ok(/Копий пока нет/.test(adm), 'пустой список объяснён, а не показан пустотой');
ok(/_logKeepHtml/.test(adm), 'срок хранения журнала показан владельцу');
const rt = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/kindOf/.test(rt), 'сервер размечает копии по происхождению');
ok(/logs: db\.logStats/.test(rt), 'сводка по журналу отдаётся вместе со статистикой базы');
const cssSrc = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(/\.bk-row/.test(cssSrc), 'стили списка копий добавлены');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
