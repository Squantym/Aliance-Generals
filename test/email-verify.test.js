// ═══════════════════════════════════════════════════════════════════
// Обязательное подтверждение почты: регистрация, запрет входа до
// подтверждения, проверка настройки и ручное подтверждение админом.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-mail-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 46)}»`); } };
// Вход считает scrypt в пуле потоков — ошибка приходит отклонённым промисом.
const failsA = async (fn, part, n) => { try { await fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 46)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const email = require(ROOT + '/dist/src/services/email');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
const authSrc = fs.readFileSync(path.join(ROOT, 'src/services/auth.ts'), 'utf8');

async function main() {
console.log('\n── 1. Почта обязательна при регистрации ──');
let e1 = null;
try { await auth.register('Безпочты', 'пароль123', '', 'ru', '1.1.1.1', 'UA'); } catch (e) { e1 = e; }
ok(e1 && /email/i.test(e1.message), `пустая почта отклонена: «${e1 && e1.message}»`);
let e2 = null;
try { await auth.register('Кривая', 'пароль123', 'не-почта', 'ru', '1.1.1.1', 'UA'); } catch (e) { e2 = e; }
ok(e2 && /email/i.test(e2.message), 'некорректный адрес отклонён');
ok(/EMAIL_RE\.test\(emailAddr\)/.test(authSrc), 'адрес проверяется по образцу');
const html = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
ok(/id="rg-email"[^>]*required/.test(html), 'поле почты обязательно и в форме');

console.log('\n── 2. Как включается подтверждение ──');
ok(/const autoVerified = !email\.isConfigured/.test(authSrc),
   'подтверждение требуется, когда настроена отправка писем');
ok(/const isConfigured = CHAIN\.length > 0/.test(fs.readFileSync(path.join(ROOT, 'src/services/email.ts'), 'utf8')),
   'признак настройки — есть ли хоть один сервис в цепочке');
ok(/emailVerifyToken: emailVerified \? null : u\.uid\(32\)/.test(authSrc),
   'неподтверждённому выдаётся код подтверждения');

console.log('\n── 3. Вход до подтверждения закрыт ──');
// В этой среде отправка не настроена, поэтому подтверждаем поведение
// напрямую: снимаем отметку и пробуем войти
await auth.register('Игрок', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1', 'UA');
const U = player.users();
const p1 = U[Object.keys(U).find((id) => U[id].name === 'Игрок')];
p1.emailVerified = false;
await failsA(() => auth.login('Игрок', 'пароль123', '1.1.1.1', 'UA'), 'Подтвердите почту',
      'без подтверждения вход не выполняется');
ok(/if \(!found\.emailVerified\) \{/.test(authSrc), 'проверка стоит на сервере');
// Фразу ловит клиент и открывает поле для кода. Разъедутся — игрок
// упрётся в вечное «подтвердите» без способа что-то ввести.
ok(/Подтвердите почту — введите код из письма/.test(authSrc), 'игроку подсказано, что делать');
ok(/Подтвердите почту/.test(fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8')),
   'клиент ищет эту же фразу и открывает поле кода');
p1.emailVerified = true;
let entered = false;
try { await auth.login('Игрок', 'пароль123', '1.1.1.1', 'UA'); entered = true; } catch (e) {}
ok(entered, 'после подтверждения вход открывается');

console.log('\n── 4. Повторная отправка письма ──');
ok(/'\/api\/resend-verification'/.test(routes), 'есть повторная отправка');
ok(/\{ open: true \}/.test(routes.slice(routes.indexOf('resend-verification'), routes.indexOf('resend-verification') + 200)),
   'доступна без входа — иначе игрок в ловушке: войти нельзя, письмо не запросить');

console.log('\n── 5. Проверка настройки в панели ──');
ok(/'\/api\/admin\/email-check'/.test(routes), 'есть проверка состояния почты');
// Берём блок по его собственным границам: порядок роутов в файле
// может измениться, и привязка к соседу сломала бы проверку
const chkStart = routes.indexOf("'/api/admin/email-check'");
const chk = routes.slice(chkStart, routes.indexOf('}, { admin: true });', chkStart));
ok(/isOwner\(req\.user\)/.test(chk), 'доступна только владельцу');
ok(/unverified/.test(chk), 'показывает, кто не подтвердил');
ok(/Задайте SMTPBZ_API_KEY/.test(chk), 'при выключенной отправке объясняет, как включить');
ok(/не ваш домен/.test(chk),
   'предупреждает про чужой домен в EMAIL_FROM — с ним письма игрокам не уходят');
const adminJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/id="mail-check"/.test(adminJs), 'кнопка проверки есть в панели');
ok((adminJs.match(/const mailGo = /g) || []).length === 1, 'обработчик объявлен один раз');

console.log('\n── 6. Ручное подтверждение ──');
ok(/'\/api\/admin\/verify-email'/.test(routes), 'админ может подтвердить вручную');
const vfyStart = routes.indexOf("app.add('POST', '/api/admin/verify-email'");
const vfy = routes.slice(vfyStart, routes.indexOf('}), { admin: true });', vfyStart));
ok(/canAccessZone\(req\.user, 'security'\)/.test(vfy), 'требуется право «Безопасность» — это доступ к чужому аккаунту');
ok(/Почта уже подтверждена/.test(vfy), 'повторное подтверждение отклоняется');
ok(/auditLog\.record/.test(vfy), 'действие пишется в журнал — это доступ к чужому аккаунту');
ok(/data-verify=/.test(adminJs), 'кнопка есть у каждого в списке');

console.log('\n── 7. Отправка через SMTP.BZ ──');
const emailSrc = fs.readFileSync(path.join(ROOT, 'src/services/email.ts'), 'utf8');
ok(/async function sendViaSmtpBz/.test(emailSrc), 'отправка через SMTP.BZ реализована');
ok(/Authorization: SMTPBZ_API_KEY/.test(emailSrc), 'ключ передаётся заголовком, как требует сервис');
ok(/application\/x-www-form-urlencoded/.test(emailSrc),
   'тело — форма, а не JSON: сервис принимает только так');
ok(/form\.set\('from', from\.email\)/.test(emailSrc) && /form\.set\('name', from\.name\)/.test(emailSrc),
   'отправитель разбирается на имя и адрес — сервис требует их отдельно');
ok(/form\.set\('text'/.test(emailSrc),
   'у письма есть текстовая версия — без неё спам-фильтры строже');
// Самая коварная разновидность отказа: HTTP 200, а в теле success:false.
// Принять это за успех — потерять письмо молча: игрок ждёт код, которого
// не будет, а в панели горит «отправлено».
ok(/parsed\.success === false/.test(emailSrc),
   'разбирается отказ при 200 OK — иначе потеря письма выглядела бы успехом');
ok(/parsed\.status === 'error'/.test(emailSrc), 'и вторая форма отказа в теле ответа');

console.log('\n── 8. Сервис отправки ──');
// Российский сервис принципиально: письма с зарубежных серверов mail.ru
// и Яндекс кладут в спам охотнее, а почта у аудитории в основном там.
ok(/'smtpbz'/.test(emailSrc), 'сервис на месте');
// Владелец потребовал стереть прежние сервисы полностью. Забытая строка
// обещает запасной путь, которого нет: в день отказа владелец будет
// искать поломку не там.
ok(!/resend/i.test(emailSrc) && !/\u0055nisender/i.test(emailSrc),
   'прежних сервисов в коде не осталось');
// Цепочка остаётся списком, хотя сервис один: понадобится запасной —
// добавится строкой в CHAIN и строкой в SENDERS, без правки вызовов.
ok(/const CHAIN: ProviderId\[\]/.test(emailSrc), 'порядок сервисов — список, а не развилка');
ok(/const SENDERS: Record<ProviderId, SendFn>/.test(emailSrc), 'кто чем шлёт — таблица');
ok(/async function sendMail\(/.test(emailSrc), 'есть единая точка отправки');
ok((emailSrc.match(/await sendMail\(/g) || []).length >= 3,
   'подтверждение, восстановление пароля и проверка идут через неё');
ok(/function splitFrom/.test(emailSrc), 'разбор строки «Имя <адрес>» вынесен отдельно');

console.log('\n── 9. Сервис виден в панели ──');
const chk2Start = routes.indexOf("'/api/admin/email-check'");
const chk2 = routes.slice(chk2Start, routes.indexOf('}, { admin: true });', chk2Start));
ok(/providerName/.test(chk2), 'проверка сообщает, какой сервис работает');
ok(/SMTP\.BZ \(Россия\)/.test(chk2), 'название с пометкой страны');
// Сервис один — он же одна точка отказа: кончится тариф или случится
// сбой, и регистрация встанет целиком. Панель обязана сказать про это
// заранее, а не в день, когда новые игроки перестанут получать коды.
ok(/Сервис один/.test(chk2), 'панель предупреждает про единственную точку отказа');
const adminJs2 = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/r\.providerName/.test(adminJs2), 'сервис показан в панели');

console.log('\n── 10. Настройки описаны ──');
const envEx = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
ok(/SMTPBZ_API_KEY/.test(envEx), 'ключ основного сервиса описан в примере настроек');
ok(/SPF, DKIM/.test(envEx), 'указано про записи домена — без них письма падают в спам');
ok(/check-dns/.test(envEx), 'и как их проверить');
ok(/smtp\.bz/.test(envEx), 'дана ссылка на регистрацию');
ok(/MAIL_LIMIT_MONTH/.test(envEx) && /MAIL_RESERVE/.test(envEx),
   'лимиты и неприкосновенный запас описаны — иначе про них никто не узнает');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
