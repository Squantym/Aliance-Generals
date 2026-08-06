// ═══════════════════════════════════════════════════════════════════
// Учёт входов: адрес, устройство, почта, история и поиск аккаунтов
// с общего адреса.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-access-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const access = require(ROOT + '/dist/src/services/access');
const roles = require(ROOT + '/dist/src/services/roles');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');

const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Mobile Safari/537.36';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1 Version/17.0 Mobile/15E148 Safari/604.1';
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1 Version/16.0 Safari/604.1';

async function main() {
console.log('\n── 1. Разбор устройства ──');
for (const [ua, kind, os] of [
  [UA_PC, 'компьютер', 'Windows 10/11'],
  [UA_ANDROID, 'телефон', 'Android 13'],
  [UA_IPHONE, 'телефон', 'iOS'],
  [UA_IPAD, 'планшет', 'iOS'],
]) {
  const d = access.parseDevice(ua);
  ok(d.kind === kind && d.os === os, `${d.label}`);
}
ok(access.parseDevice('').label === 'неизвестное устройство', 'пустая строка не ломает разбор');
// Порядок проверки браузеров: Edge и Opera представляются как Chrome
ok(access.parseDevice('Mozilla/5.0 Chrome/120 Edg/120').browser === 'Edge', 'Edge не принимается за Chrome');
ok(access.parseDevice('Mozilla/5.0 Chrome/120 YaBrowser/23').browser === 'Яндекс', 'Яндекс определяется');

console.log('\n── 2. Запись при регистрации ──');
await auth.register('Первый', 'пароль123', 'a@t.ru', 'ru', '95.24.1.7', UA_PC);
await auth.register('Второй', 'пароль123', 'b@t.ru', 'ru', '95.24.1.7', UA_ANDROID);
await auth.register('Третий', 'пароль123', 'c@t.ru', 'ru', '188.44.9.2', UA_IPHONE);
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const p1 = by('Первый'), p2 = by('Второй'), p3 = by('Третий');

const v1 = access.view(p1);
ok(v1.registered.ip === '95.24.1.7', `адрес регистрации: ${v1.registered.ip}`);
ok(/компьютер/.test(v1.registered.device), `устройство: ${v1.registered.device}`);
ok(v1.email === 'a@t.ru', `почта: ${v1.email}`);
ok(typeof v1.emailVerified === 'boolean', 'видно, подтверждена ли почта');
ok(v1.logins.length === 1 && v1.logins[0].kind === 'регистрация', 'первая запись помечена как регистрация');
const asrc = fs.readFileSync(ROOT + '/src/services/auth.ts', 'utf8');
ok(/recordLogin\(newU, ip, ua, 'регистрация'\)/.test(asrc),
   'запись идёт по ссылке на нового игрока');
ok(asrc.indexOf('recordLogin(newU') < asrc.indexOf('if (autoVerified)'),
   'запись стоит ДО развилки — иначе аккаунты с подтверждением почты остались бы без данных');

console.log('\n── 3. История входов ──');
access.recordLogin(p1, '77.88.5.5', UA_ANDROID, 'вход');
const v2 = access.view(p1);
ok(v2.last.ip === '77.88.5.5', 'последний адрес обновился');
ok(/телефон/.test(v2.last.device), 'последнее устройство обновилось');
ok(v2.registered.ip === '95.24.1.7', 'адрес регистрации не затирается');
ok(v2.ips.length === 2, `помним оба адреса: ${v2.ips.map((x) => x.ip).join(', ')}`);
ok(v2.logins.length === 2, 'история пополнилась');
// Повторный вход с того же адреса считается, а не плодит записи в сводке
access.recordLogin(p1, '77.88.5.5', UA_ANDROID, 'вход');
const v3 = access.view(p1);
ok(v3.ips.length === 2, 'адресов по-прежнему два');
ok(v3.ips.find((x) => x.ip === '77.88.5.5').count === 2, 'счётчик входов с адреса растёт');
// История не растёт бесконечно
for (let i = 0; i < 40; i++) access.recordLogin(p1, '10.0.0.' + i, UA_PC, 'вход');
ok(access.view(p1).logins.length === access.KEEP_LOGINS,
   `история ограничена ${access.KEEP_LOGINS} записями — иначе база разрастётся`);

console.log('\n── 4. Аккаунты с общего адреса ──');
const rel = access.related(p2, U);
ok(rel.length >= 1, `у «Второго» найдены связанные: ${rel.map((r) => r.name).join(', ')}`);
ok(rel.some((r) => r.name === 'Первый'), 'совпадение по адресу регистрации найдено');
ok(rel.every((r) => r.id !== p2.id), 'сам игрок в список не попадает');
ok(access.related(p3, U).length === 0, 'у игрока с уникальным адресом связей нет');
const groups = access.ipSummary(U, 2);
ok(groups.length >= 1, 'сводка по адресам собирается');
const g = groups.find((x) => x.ip === '95.24.1.7');
ok(g && g.count === 2, `на адресе ${g.ip} два аккаунта: ${g.players.map((p) => p.name).join(', ')}`);
ok(access.ipSummary(U, 5).length === 0, 'порог в 5 аккаунтов отсекает мелкие совпадения');

console.log('\n── 5. Права доступа ──');
ok(/canAccessZone\(req\.user, 'players'\)/.test(routes.slice(routes.indexOf("'/api/admin/access/:id'"),
   routes.indexOf("'/api/admin/multi-check'"))), 'данные о входах требуют зону «Игроки»');
ok(/canAccessZone\(req\.user, 'security'\)/.test(routes.slice(routes.indexOf("'/api/admin/multi-check'"),
   routes.indexOf("'/api/admin/multi-check'") + 500)), 'поиск мультоводов требует зону «Безопасность»');
for (const [p, zone] of [['/api/admin/access/x', 'players'], ['/api/admin/multi-check', 'security']]) {
  ok(roles.zoneOfPath(p) === zone, `адрес ${p} отнесён к зоне «${zone}»`);
}
const noRights = { id: 'x', role: 'moderator' };
ok(!roles.canAccessZone(noRights, 'players'), 'без выданных прав данные закрыты');

console.log('\n── 6. Интерфейс ──');
ok(/data-act="access"/.test(adminJs), 'в карточке игрока есть кнопка «Входы и устройства»');
ok(/async showAccess\(userId\)/.test(adminJs), 'окно реализовано');
ok(/При регистрации/.test(adminJs) && /Последний вход/.test(adminJs), 'показаны оба ключевых момента');
ok(/История входов/.test(adminJs), 'есть история');
ok(/Заходят с тех же адресов/.test(adminJs), 'показаны связанные аккаунты');
ok(/Совпадение адреса — не доказательство/.test(adminJs),
   'предупреждение о ложных совпадениях на месте');
ok(/id="mc-go"/.test(adminJs), 'есть поиск нескольких аккаунтов с одного адреса');
ok(/Admin\.can\('security'\)/.test(adminJs), 'он виден только с правом «Безопасность»');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(css.includes('.access-table'), 'стили таблицы добавлены');
ok(css.includes('.mc-group'), 'стили сводки добавлены');
const fields = fs.readFileSync(ROOT + '/src/core/playerFields.ts', 'utf8');
ok(/access:\s+\{ owner: 'access'/.test(fields), 'поле зарегистрировано в реестре');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
