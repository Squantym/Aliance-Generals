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
ok(/const isConfigured = provider !== 'none'/.test(fs.readFileSync(path.join(ROOT, 'src/services/email.ts'), 'utf8')),
   'признак настройки — выбранный сервис отправки');
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
ok(/Нажмите «Отправить повторно»/.test(authSrc), 'игроку подсказано, что делать');
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
ok(/Задайте UNISENDER_API_KEY/.test(chk), 'при выключенной отправке объясняет, как включить');
ok(/отправитель тестовый/.test(chk),
   'предупреждает о тестовом отправителе — с ним письма игрокам не уходят');
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

console.log('\n── 7. Отправка через Unisender Go ──');
const emailSrc = fs.readFileSync(path.join(ROOT, 'src/services/email.ts'), 'utf8');
ok(/async function sendViaUnisender/.test(emailSrc), 'отправка через Unisender реализована');
ok(/go1\.unisender\.ru/.test(emailSrc), 'по умолчанию российская площадка');
ok(/'X-API-KEY': UNISENDER_API_KEY/.test(emailSrc), 'ключ передаётся заголовком, как требует сервис');
ok(/from_email: from\.email/.test(emailSrc) && /from_name: from\.name/.test(emailSrc),
   'отправитель разбирается на имя и адрес — Unisender требует их отдельно');
// Служебное письмо просим отправить без ссылки отписки, но право на это
// выдаётся аккаунту отдельно. Без запасного пути сервис отклонял письмо
// целиком — игрок не получал подтверждение и не мог войти. Поэтому
// проверяем оба: и что флаг просим, и что отказ по нему не хоронит
// письмо. Само поведение разобрано в test/mailskip.test.js.
ok(/skip_unsubscribe = 1/.test(emailSrc),
   'служебное письмо просим без ссылки отписки');
ok(/isSkipUnsubscribeRefusal/.test(emailSrc),
   'отказ по этому флагу не отменяет письмо — повторяем без него');
// Главная тонкость этого сервиса
ok(/failed && failed\[to\]/.test(emailSrc),
   'проверяется failed_emails: сервис отвечает 200 даже при отказе по адресу');
ok(/parsed\.status === 'error'/.test(emailSrc), 'разбирается и общая ошибка в теле ответа');

console.log('\n── 8. Выбор сервиса ──');
ok(/const provider: 'unisender' \| 'resend' \| 'none'/.test(emailSrc), 'сервис определяется признаком');
ok(/UNISENDER_API_KEY \? 'unisender' : \(RESEND_API_KEY \? 'resend' : 'none'\)/.test(emailSrc),
   'Unisender главный, Resend запасной — переход не ломает настроенные серверы');
ok(/async function sendMail\(/.test(emailSrc), 'есть единая точка отправки');
const directCalls = (emailSrc.match(/await sendViaResend\(/g) || []).length;
ok(directCalls === 0, 'ни одно письмо не идёт мимо общей точки');
ok((emailSrc.match(/await sendMail\(/g) || []).length >= 3,
   'подтверждение, восстановление пароля и проверка идут через неё');
// Разбор отправителя
const splitTest = /function splitFrom/.test(emailSrc);
ok(splitTest, 'разбор строки «Имя <адрес>» вынесен отдельно');

console.log('\n── 9. Сервис виден в панели ──');
const chk2Start = routes.indexOf("'/api/admin/email-check'");
const chk2 = routes.slice(chk2Start, routes.indexOf('}, { admin: true });', chk2Start));
ok(/providerName/.test(chk2), 'проверка сообщает, какой сервис работает');
ok(/Unisender Go \(Россия\)/.test(chk2), 'название по-русски');
ok(/чаще[\s\S]{0,30}попадают в спам/.test(chk2),
   'при Resend предупреждает о проблемах с российской почтой');
const adminJs2 = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/r\.providerName/.test(adminJs2), 'сервис показан в панели');

console.log('\n── 10. Настройки описаны ──');
const envEx = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
ok(/UNISENDER_API_KEY/.test(envEx), 'ключ описан в примере настроек');
ok(/UNISENDER_URL/.test(envEx), 'адрес площадки тоже');
ok(/SPF, DKIM и DMARC/.test(envEx), 'указано про записи домена — без них спам у любого сервиса');
ok(/go\.unisender\.ru/.test(envEx), 'дана ссылка на регистрацию');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
