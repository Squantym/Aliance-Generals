// ═══════════════════════════════════════════════════════════════════
// ПОСТОЯННАЯ ПРОВЕРКА БЕЗОПАСНОСТИ И ЦЕЛОСТНОСТИ
//
// Это не разовый аудит, а тест: он падает, если в код вернётся любая из
// закрытых дыр. Проверяет права на роутах, утечку секретов, реестр полей
// игрока (защита от коллизий, из-за которых обнулился сезон), защиту от
// багоюза и настройки хранения.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
const fields = require(path.join(ROOT, 'dist/src/core/playerFields'));

console.log('\n── 1. Права доступа на роутах ──');
// Каждый /api/admin/* обязан быть либо помечен admin:true, либо проверять
// права внутри сервиса. Разбираем объявления роутов целиком.
const decls = [];
const re = /app\.add\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*'([^']+)'/g;
let m;
while ((m = re.exec(routes))) {
  // Берём текст объявления до следующего app.add — там же и флаги
  const start = m.index;
  const nextIdx = routes.indexOf('app.add(', start + 8);
  const body = routes.slice(start, nextIdx === -1 ? routes.length : nextIdx);
  decls.push({ method: m[1], route: m[2], body });
}
ok(decls.length > 100, `разобрано объявлений роутов: ${decls.length}`);

const adminRoutes = decls.filter((d) => d.route.startsWith('/api/admin'));
const unguarded = adminRoutes.filter((d) => !/admin:\s*true/.test(d.body));
ok(adminRoutes.length > 20, `админских роутов: ${adminRoutes.length}`);
if (unguarded.length) {
  // Допустимо, если внутри вызывается функция с проверкой isAdmin —
  // проверяем это по имени вызываемого сервиса
  for (const d of unguarded) {
    const callsGuarded = /admin\.(claimGift)/.test(d.body);
    ok(callsGuarded, `${d.method} ${d.route} — без флага admin:true${callsGuarded ? ' (действие самого игрока, права не нужны)' : ' ⚠ ДЫРА'}`);
  }
} else {
  ok(true, 'у всех админских роутов выставлен admin:true');
}

// Роуты базы данных — самое чувствительное
const dbRoutes = decls.filter((d) => d.route.includes('/api/admin/db'));
ok(dbRoutes.length >= 5, `роутов управления базой: ${dbRoutes.length}`);
ok(dbRoutes.every((d) => /admin:\s*true/.test(d.body)), 'ВСЕ роуты базы требуют прав администратора');

console.log('\n── 2. Произвольный SQL не выставлен наружу ──');
ok(!/app\.add\([^)]*db\.sql\(/s.test(routes), 'нет эндпоинта, принимающего SQL-запрос от клиента');
const dbSrc = fs.readFileSync(path.join(ROOT, 'src/core/db.ts'), 'utf8');
ok(dbSrc.includes('function sql('), 'функция sql существует для внутренней аналитики');
const servicesWithSql = fs.readdirSync(path.join(ROOT, 'src/services'))
  .filter((f) => f.endsWith('.ts'))
  .filter((f) => /db\.sql\(\s*(`[^`]*\$\{|[a-z]|String)/.test(fs.readFileSync(path.join(ROOT, 'src/services', f), 'utf8')));
ok(servicesWithSql.length === 0, `нет мест, где в SQL подставляются переменные строкой${servicesWithSql.length ? ': ' + servicesWithSql.join(', ') : ''}`);

console.log('\n── 3. Секреты не утекают в API ──');
for (const secret of fields.SECRET_FIELDS) {
  // Ищем возврат секрета из роутов/профиля
  const leakInRoutes = new RegExp(`(return|\\.\\.\\.)[^;]*\\b${secret}\\b`).test(routes);
  ok(!leakInRoutes, `${secret} не возвращается из роутов`);
}
const playerSrc = fs.readFileSync(path.join(ROOT, 'src/services/player.ts'), 'utf8');
const pubStart = playerSrc.indexOf('function publicProfile');
const pubBody = playerSrc.slice(pubStart, playerSrc.indexOf('\nfunction ', pubStart + 10));
ok(!/passHash|\.salt|resetToken/.test(pubBody), 'публичный профиль не содержит хэш пароля, соль и токены');
ok(!/\bemail\b\s*:/.test(pubBody), 'публичный профиль не раскрывает почту других игроков');

console.log('\n── 4. Реестр полей игрока (защита от коллизий) ──');
const auth = require(path.join(ROOT, 'dist/src/services/auth'));
const fresh = auth.newUser('probe', 'Проба', 'p@t.ru', 'h', 's', 'ru', false, true);
const unknown = fields.unknownFields(fresh);
ok(unknown.length === 0, `все поля нового игрока зарегистрированы${unknown.length ? ' ⚠ НЕ в реестре: ' + unknown.join(', ') : ''}`);
ok(fields.ownerOf('weekly') === 'seasons', `weekly принадлежит сезону (${fields.ownerOf('weekly')})`);
ok(fields.ownerOf('weeklyQuests') === 'dailyQuests', `weeklyQuests принадлежит поручениям (${fields.ownerOf('weeklyQuests')})`);
ok(fields.isFieldTaken('weekly') && fields.isFieldTaken('daily'), 'занятые поля определяются — новый модуль не займёт их молча');
// Реестр обязан покрывать ВСЕ поля, которым код что-либо присваивает, а не
// только поля нового игрока. Первая версия проверяла лишь newUser(), и из-за
// этого seasonId/seasonRating оставались незарегистрированными — то есть
// дыра, из-за которой пострадал сезон, была закрыта не до конца.
const assigned = new Set();
const scanAssign = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  for (const mm of src.matchAll(/\b(?:user|target|victim|p|player|found|fresh|u)(?:\s+as\s+any)?\)?\.([a-zA-Z][a-zA-Z0-9_]*)\s*=(?!=)/g)) assigned.add(mm[1]);
  for (const mm of src.matchAll(/players\[[^\]]+\]\.([a-zA-Z][a-zA-Z0-9_]*)/g)) assigned.add(mm[1]);
};
for (const f of fs.readdirSync(path.join(ROOT, 'src/services'))) {
  if (f.endsWith('.ts')) scanAssign(path.join(ROOT, 'src/services', f));
}
scanAssign(path.join(ROOT, 'server.ts'));
const notRegistered = [...assigned].filter((k) => !fields.isFieldTaken(k)).sort();
ok(notRegistered.length === 0,
   `реестр покрывает все ${assigned.size} полей, которым присваивает код${notRegistered.length ? ' ⚠ НЕ в реестре: ' + notRegistered.join(', ') : ''}`);
ok(fields.ownerOf('seasonRating') === 'seasons', 'сезонный рейтинг закреплён за сезоном');
// Ключевой инвариант: сезонное поле не пишется из поручений
const dq = fs.readFileSync(path.join(ROOT, 'src/services/dailyQuests.ts'), 'utf8');
ok((dq.match(/\.weekly\s*=\s*\{/g) || []).length === 0, 'поручения не создают объект в поле сезона');
const seasons = fs.readFileSync(path.join(ROOT, 'src/services/seasons.ts'), 'utf8');
ok(!/weeklyQuests/.test(seasons), 'сезон не трогает поле поручений');

console.log('\n── 5. Защита от потери данных ──');
ok(dbSrc.includes('startPeriodicBackup'), 'автоматические копии по расписанию');
ok(dbSrc.includes('function closeDb'), 'база корректно закрывается при остановке сервера');
ok(seasons.includes('saveWeeklyMetricsBackup'), 'метрики сезона снимаются ПЕРЕД обнулением недели');
ok(routes.includes('перед-восстановлением'), 'перед восстановлением из снимка делается копия базы');
const sqSrc = fs.readFileSync(path.join(ROOT, 'src/core/sqliteStore.ts'), 'utf8');
ok(sqSrc.includes("journal_mode = WAL"), 'журнал WAL — база переживает падение процесса');
ok(sqSrc.includes('db.transaction'), 'запись идёт транзакцией — либо всё, либо ничего');
ok(sqSrc.includes("function makeDriver"), 'драйвер с запасным вариантом — нативный модуль не может уронить установку');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
ok(!!(pkg.optionalDependencies && pkg.optionalDependencies['better-sqlite3']),
   'нативный драйвер — необязательная зависимость (иначе сбой сборки ломает весь npm install)');
ok(fs.existsSync(path.join(ROOT, 'tools/backup-offsite.sh')), 'есть скрипт вывоза копий на другой сервер');
ok(dbSrc.includes('function acquireLock'), 'замок базы: второй процесс на тех же данных не запустится');
ok(dbSrc.includes('function isAlive'), 'замок от упавшего процесса не блокирует запуск (проверяется, жив ли PID)');
ok(dbSrc.includes('releaseLock'), 'замок снимается при остановке сервера');
// Замок защищает от второго СЕРВЕРА, но не должен мешать служебным
// скриптам: раньше grant-admin натыкался на замок, молча уходил в
// JSON-режим и показывал пустую базу — «игроков: 0»
ok(dbSrc.includes("process.env.DB_TOOL_MODE === '1'"), 'служебные скрипты не берут замок и читают базу игры');
const fsTools = fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => f.endsWith('.js'));
const withMode = fsTools.filter((f) => fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8').includes("DB_TOOL_MODE = '1'"));
ok(withMode.length >= 3, `режим инструмента включён в скриптах: ${withMode.join(', ')}`);
ok(!/падаю в JSON-режим/.test(dbSrc), 'тихий переход на пустую JSON-базу убран');
ok(/DB_DRIVER=sqlite задан явно/.test(dbSrc), 'при сбое открытия базы процесс падает с внятной причиной, а не работает на пустой');
// Потеря данных при остановке: автосохранение вклинивалось в финальную
// запись и падало на закрытом соединении («client was closed»), а сервер
// всё равно писал «Данные сохранены»
ok(dbSrc.includes('let shuttingDown'), 'при остановке новые записи не планируются');
ok(/scheduleFlush\(\): void \{\s*\n\s*if \(shuttingDown\) return;/.test(dbSrc),
   'планировщик записи отключается на время выхода');
ok(/if \(periodicTimer\) \{ clearInterval\(periodicTimer\); periodicTimer = null; \}/.test(dbSrc),
   'автосохранение глушится перед финальной записью');
ok(/async function flushAllNow\(\): Promise<string\[\]>/.test(dbSrc),
   'финальное сохранение возвращает список несохранённых коллекций');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
ok(serverSrc.includes('ВЫХОД С ПОТЕРЕЙ'), 'сервер сообщает о потере, а не рапортует об успехе вслепую');
ok(/const failed = await db\.flushAllNow\(\)/.test(serverSrc), 'результат финальной записи проверяется');
const offsite = fs.readFileSync(path.join(ROOT, 'tools/backup-offsite.sh'), 'utf8');
ok(offsite.includes('integrity_check'), 'вывозимая копия проверяется перед отправкой');

console.log('\n── 6. Защита от багоюза ──');
// Суммы, приходящие от клиента, обязаны проверяться на положительность
const money = [
  ['player.ts', 'вклад/снятие в банке'],
  ['sanctions.ts', 'объявление санкции'],
  ['legion.ts', 'взносы в легион'],
  ['market.ts', 'ставки на аукционе'],
];
for (const [file, what] of money) {
  const src = fs.readFileSync(path.join(ROOT, 'src/services', file), 'utf8');
  // Сумму можно отсекать по-разному: сравнением с нулём, с единицей или
  // с минимальной ставкой (MIN_BOUNTY и подобные) — все варианты валидны,
  // важно лишь, что отрицательные значения и ноль не проходят.
  const hasCheck = /(amount|amt|qty|bet)\s*(<=?\s*0|<\s*1|<\s*MIN_|<\s*[a-z]*\.?MIN|<\s*(config|C)\.)/.test(src)
    || /clamp\(/.test(src);
  ok(hasCheck, `${what}: сумма проверяется (отрицательные и ноль отклоняются)`);
}
const utils = fs.readFileSync(path.join(ROOT, 'src/core/utils.ts'), 'utf8');
ok(/Number\.isFinite/.test(utils), 'toInt отсекает NaN и бесконечность — подстановка "1e999" не пройдёт');
// Антифлуд
const battleSrc = fs.readFileSync(path.join(ROOT, 'src/services/battle.ts'), 'utf8');
ok(/lastAttackAt/.test(battleSrc), 'между атаками есть минимальный интервал (антифлуд)');
const social = fs.readFileSync(path.join(ROOT, 'src/services/social.ts'), 'utf8');
ok(/lastChatAt/.test(social), 'в чате есть антифлуд');
// Награды выдаются один раз
const dqSrc = dq;
ok(/claimed\[questId\]/.test(dqSrc), 'повторное получение награды за поручение отклоняется');
const features = fs.readFileSync(path.join(ROOT, 'src/services/features.ts'), 'utf8');
ok(/pendingLoginReward\s*=\s*null/.test(features), 'награда за вход обнуляется после выдачи — дважды не забрать');

console.log('\n── 7. Вход и сессии ──');
const authSrc = fs.readFileSync(path.join(ROOT, 'src/services/auth.ts'), 'utf8');
ok(/checkRateLimit/.test(authSrc), 'вход защищён лимитом попыток (брутфорс)');
ok(/WRONG_CREDS/.test(authSrc), 'ошибка входа не раскрывает, существует ли позывной');
ok(/verifyPassword/.test(authSrc), 'пароль проверяется хэшем, а не сравнением строк');
ok(/scrypt|pbkdf2|bcrypt|argon/i.test(utils + authSrc), 'пароли хэшируются медленной функцией с солью');

console.log('\n── 8. Экранирование в интерфейсе ──');
const ui = fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8');
ok(/esc\(/.test(ui), 'есть функция экранирования');
// html:true — только с экранированными подстановками
const jsFiles = ['public/js/app.js', 'public/js/admin.js', 'public/js/screens/war.js', 'public/js/screens/core.js', 'public/js/screens/social.js'];
let rawInterp = [];
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const idx = src.indexOf('html: true');
  if (idx === -1) continue;
  // В окне докупки техники и в окнах результата подстановки идут через UI.esc/UI.fmt
  const around = src.slice(Math.max(0, idx - 2500), idx);
  if (/\$\{(?!UI\.|App\.|[a-zA-Z]+\.(esc|fmt))[a-z]+\.(name|text|message)\}/.test(around)) rawInterp.push(f);
}
ok(rawInterp.length === 0, `нет окон с html:true, где имя игрока подставляется без экранирования${rawInterp.length ? ': ' + rawInterp.join(', ') : ''}`);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
