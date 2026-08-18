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
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

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
ok(/ПК \(Windows\)/.test(v1.registered.device), `устройство: ${v1.registered.device}`);
ok(v1.email === 'a@t.ru', `почта: ${v1.email}`);
ok(typeof v1.emailVerified === 'boolean', 'видно, подтверждена ли почта');
ok(v1.logins.length === 1 && v1.logins[0].kind === 'регистрация', 'первая запись помечена как регистрация');
const asrc = fs.readFileSync(ROOT + '/src/services/auth.ts', 'utf8');
ok(/recordLogin\(newU, ip, ua, 'регистрация'/.test(asrc),
   'запись идёт по ссылке на нового игрока');
ok(asrc.indexOf('recordLogin(newU') < asrc.indexOf('if (autoVerified)'),
   'запись стоит ДО развилки — иначе аккаунты с подтверждением почты остались бы без данных');

console.log('\n── 3. История входов ──');
access.recordLogin(p1, '77.88.5.5', UA_ANDROID, 'вход');
const v2 = access.view(p1);
ok(v2.last.ip === '77.88.5.5', 'последний адрес обновился');
ok(/SM-A536E/.test(v2.last.device), `последнее устройство обновилось: ${v2.last.device}`);
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

console.log('\n── 7. Учёт на каждом запросе ──');
// Главная причина, по которой данных не появлялось: запись велась только
// при входе по паролю, а игрок с действующим токеном не логинится месяцами
const httpSrc = fs.readFileSync(ROOT + '/src/core/http.ts', 'utf8');
ok(/\.touch\(user, reqCtx\.ip, reqCtx\.ua/.test(httpSrc),
   'учёт вызывается на каждом запросе игрока, а не только при входе');
ok(/ua: String\(req\.headers\['user-agent'\] \|\| ''\)/.test(httpSrc),
   'строка браузера попадает в объект запроса');
ok(/ua: string;/.test(httpSrc), 'поле описано в типе — иначе сборка молча теряла бы его');

const p9 = by('Третий');
const before = access.view(p9).logins.length;
// Тот же адрес и устройство — новой записи быть не должно
access.touch(p9, '188.44.9.2', UA_IPHONE);
access.touch(p9, '188.44.9.2', UA_IPHONE);
ok(access.view(p9).logins.length === before,
   'повторные запросы с того же устройства не плодят записи');
// Смена адреса — запись появляется
access.touch(p9, '5.5.5.5', UA_IPHONE);
const afterIp = access.view(p9);
ok(afterIp.logins.length === before + 1, 'смена адреса записывается');
ok(afterIp.logins[0].kind === 'смена адреса', `помечено как «${afterIp.logins[0].kind}»`);
ok(afterIp.last.ip === '5.5.5.5', 'последний адрес обновился');
// Смена устройства — тоже
access.touch(p9, '5.5.5.5', UA_PC);
const afterDev = access.view(p9);
ok(afterDev.logins[0].kind === 'смена устройства', `помечено как «${afterDev.logins[0].kind}»`);
ok(/ПК \(Windows\)/.test(afterDev.last.device), `устройство обновилось: ${afterDev.last.device}`);
// Долгое молчание — отметка сессии
const a9 = p9.access;
a9.lastAt = Date.now() - access.TOUCH_INTERVAL_MS - 1000;
const beforeLong = access.view(p9).logins.length;
access.touch(p9, '5.5.5.5', UA_PC);
ok(access.view(p9).logins.length === beforeLong + 1, 'спустя час активность отмечается заново');

console.log('\n── 8. Данные доходят до панели ──');
const v9 = access.view(p9);
ok(v9.last.ip && v9.last.ip !== '—', `последний адрес заполнен: ${v9.last.ip}`);
ok(v9.last.device && v9.last.device !== '—', `устройство заполнено: ${v9.last.device}`);
ok(v9.registered.ip !== '—', 'адрес регистрации на месте');
ok(v9.ips.length >= 2, `адресов в сводке: ${v9.ips.length}`);

console.log('\n── 9. Модель устройства ──');
for (const [ua, expect] of [
  ['Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36', 'SM-A536E'],
  ['Mozilla/5.0 (Linux; Android 14; Redmi Note 12 Pro) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', 'Redmi Note 12 Pro'],
  ['Mozilla/5.0 (Linux; Android 13; 23021RAA2Y) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36', '23021RAA2Y'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1 Safari/604.1', 'iPhone'],
  ['Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1 Safari/604.1', 'iPad'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'ПК (Windows)'],
]) {
  ok(access.parseModel(ua) === expect, `модель: «${access.parseModel(ua)}»`);
}
// Служебная пометка wv (встроенный браузер приложения) не должна попадать в модель
ok(!/wv/.test(access.parseModel('Mozilla/5.0 (Linux; Android 13; SM-A536E; wv) AppleWebKit/537.36 Chrome/119')),
   'служебные пометки отсекаются');
const lbl = access.parseDevice('Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36 YaBrowser/23.11').label;
ok(lbl === 'SM-A536E, Android 13, Яндекс', `подпись целиком: «${lbl}»`);
ok(lbl.indexOf('SM-A536E') === 0, 'модель стоит первой — по ней устройство узнаётся быстрее');
ok(access.parseDevice('').label === 'неизвестное устройство', 'пустая строка не ломает разбор');

console.log('\n── 10. Настоящий адрес за прокси ──');
// Причина, по которой у всех игроков был 127.0.0.1: читался только
// один заголовок, а nginx часто передаёт адрес другим
const httpSrc2 = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
ok(/function clientIp\(req: any\)/.test(httpSrc2), 'определение адреса вынесено в одну функцию');
for (const h of ['cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-forwarded-for']) {
  ok(httpSrc2.includes(h), `учитывается заголовок «${h}»`);
}
ok(/function isUsableIp/.test(httpSrc2), 'внутренние адреса отбрасываются');
// В коде диапазоны записаны как регулярные выражения с экранированием
const ipFn = httpSrc2.slice(httpSrc2.indexOf('function isUsableIp'), httpSrc2.indexOf('function clientIp'));
for (const [needle, label] of [
  ['127.', 'локальный 127.x'],
  ['192', 'домашний 192.168.x'],
  ['10', 'внутренний 10.x'],
  ['169', 'служебный 169.254.x'],
  ['172', 'корпоративный 172.16-31.x'],
  ['f[cd]', 'приватный IPv6'],
]) {
  ok(ipFn.includes(needle), `отбрасывается ${label}`);
}
ok(/replace\(\/\^::ffff:\/, ''\)/.test(httpSrc2), 'адреса IPv4 в обёртке IPv6 приводятся к обычному виду');
// Раньше здесь стояло «ровно две точки». Точек стало больше (панель v2
// тоже пишет в лог, кто стучится по стандартному адресу), а жёсткое
// число ловило бы не подмену адреса, а сам факт правки. Проверяем то,
// ради чего оно писалось: адрес нигде не достают в обход общей функции.
ok((httpSrc2.match(/clientIp\(req\)/g) || []).length >= 2,
   'все точки получения адреса используют общую функцию');
const ipRaw = (httpSrc2.match(/remoteAddress/g) || []).length;
const ciAt = httpSrc2.indexOf('function clientIp');
const inClientIp = (httpSrc2.slice(ciAt, ciAt + 900).match(/remoteAddress/g) || []).length;
// Одно обращение вне clientIp законно: сырой адрес кладётся в rawHeaders
// для проверки доверенного прокси. Больше — значит кто-то снова достаёт
// адрес руками, а вместе с ним теряет отбрасывание внутренних диапазонов.
ok(ipRaw - inClientIp <= 1, `сырой socket.remoteAddress вне общей функции: ${ipRaw - inClientIp} раз`);
// Проверяем саму логику отбора
const pick = (chain) => {
  const usable = (v) => v && v !== 'unknown' && !/^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\./.test(v);
  return chain.map((x) => String(x).trim().replace(/^::ffff:/, '')).find(usable) || 'unknown';
};
ok(pick(['95.24.180.7']) === '95.24.180.7', 'обычный адрес принимается');
ok(pick(['10.0.0.5', '188.44.9.2']) === '188.44.9.2',
   'внутренний адрес прокси пропускается, берётся внешний');
ok(pick(['127.0.0.1']) === 'unknown', 'адрес самого сервера не считается адресом игрока');
ok(pick(['::ffff:77.88.5.5']) === '77.88.5.5', 'обёртка IPv6 снимается');

console.log('\n── 11. Модель у современного Chrome ──');
// Chrome с версии 110 подставляет «Android 10; K» вместо настоящей
// модели — это защита приватности. Настоящая приходит подсказкой.
const modernUA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
ok(access.parseModel(modernUA) === 'K', 'из строки Chrome достаётся только заглушка «K»');
ok(!/(^|,) ?K,/.test(access.parseDevice(modernUA).label),
   `заглушка не показывается администратору: «${access.parseDevice(modernUA).label}»`);
const withHint = access.parseDevice(modernUA, { model: 'SM-S911B', platform: 'Android', platformVersion: '14.0.0' });
ok(withHint.model === 'SM-S911B', `по подсказке модель определяется: ${withHint.model}`);
ok(withHint.label === 'SM-S911B, Android 14, Chrome', `подпись целиком: «${withHint.label}»`);
ok(withHint.os === 'Android 14',
   'версия системы берётся из подсказки — в строке Chrome пишет всем «Android 10»');
// Старые браузеры по-прежнему разбираются из строки
ok(access.parseDevice('Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A) AppleWebKit/537.36 Chrome/119 Mobile').model === 'SM-A536E',
   'старый формат строки читается как раньше');

console.log('\n── 12. Запрос подсказок у браузера ──');
const httpSrc3 = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
ok(/'Accept-CH': 'Sec-CH-UA-Model/.test(httpSrc3), 'сервер просит присылать модель устройства');
ok(/'Critical-CH': 'Sec-CH-UA-Model'/.test(httpSrc3), 'помечено как важное — придёт быстрее');
ok(/sec-ch-ua-platform-version/.test(httpSrc3), 'запрашивается и версия системы');
ok(/replace\(\/\^"\|"\$\/g, ''\)/.test(httpSrc3), 'кавычки вокруг значений снимаются');
const authSrc2 = fs.readFileSync(path.join(ROOT, 'src/services/auth.ts'), 'utf8');
ok(/recordLogin\(newU, ip, ua, 'регистрация', hints\)/.test(authSrc2),
   'подсказки доходят до регистрации');
ok(/recordLogin\(found, ip, ua, 'вход', hints\)/.test(authSrc2), 'и до входа');
ok(/touch\(user, reqCtx\.ip, reqCtx\.ua, reqCtx\.hints\)/.test(httpSrc3),
   'и до учёта на каждом запросе');

console.log('\n── 13. Диагностика сети ──');
const routesSrc2 = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/'\/api\/admin\/net-check'/.test(routesSrc2), 'есть проверка того, что приходит от прокси');
const netBlock = routesSrc2.slice(routesSrc2.indexOf("'/api/admin/net-check'"), routesSrc2.indexOf('УЧЁТ ВХОДОВ'));
ok(/isOwner\(req\.user\)/.test(netBlock), 'доступна только владельцу');
ok(/proxy_set_header X-Real-IP/.test(netBlock),
   'при отсутствии заголовков подсказывает готовую настройку nginx');
ok(/Модель устройства придёт со следующего/.test(netBlock),
   'объясняет, почему модель появляется не сразу');
const adminSrc2 = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/id="net-check"/.test(adminSrc2), 'кнопка проверки есть в панели');
ok(/Если у всех игроков[\s\S]{0,40}один и тот же адрес/.test(adminSrc2),
   'подписано, когда ей пользоваться');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
