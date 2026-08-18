// ═══════════════════════════════════════════════════════════════════
// test/twofactor.test.js — второй фактор входа для сотрудников
//
// Проверяем не «есть ли функция», а то, ради чего она написана:
//   • знания пароля недостаточно, если фактор включён;
//   • токен не выдаётся ДО проверки кода (иначе фактор — украшение);
//   • чужой/просроченный/подобранный код не проходит;
//   • подсмотренный код не работает второй раз;
//   • потеря телефона не означает потерю доступа (коды восстановления),
//     и использованный код восстановления сгорает;
//   • сами коды в базе не лежат — только их хеши.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-2fa-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => {
  try { const r = fn(); if (r && r.then) return r.then(() => ok(false, n + ' (ошибки не было)'),
    (e) => ok(String(e.message).includes(part), `${n} → «${e.message}»`));
    ok(false, n + ' (ошибки не было)');
  } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message}»`); }
};

const totp = require(ROOT + '/dist/src/services/totp');
const tf = require(ROOT + '/dist/src/services/twoFactor');

async function main() {

console.log('\n── 1. Сам алгоритм совместим со стандартом ──');
// Контрольные значения RFC 6238 (ключ «12345678901234567890», SHA-1).
// Если однажды кто-то «оптимизирует» усечение, приложения перестанут
// сходиться с сервером, и понять это будет неоткуда.
const rfcSecret = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const vectors = [[59000, '287082'], [1111111109000, '081804'], [1234567890000, '005924']];
for (const [ms, code] of vectors) {
  ok(totp.codeAt(rfcSecret, ms) === code, `контрольный вектор RFC на ${ms} мс → ${code}`);
}
ok(totp.DIGITS === 6 && totp.STEP_SEC === 30, 'формат обычный: 6 цифр, шаг 30 секунд');

console.log('\n── 2. Base32 ходит туда и обратно ──');
const raw = crypto.randomBytes(20);
ok(Buffer.compare(totp.base32Decode(totp.base32Encode(raw)), raw) === 0, 'ключ переживает кодирование');
ok(/^[A-Z2-7]+$/.test(totp.newSecret()), 'секрет состоит из допустимых символов base32');

console.log('\n── 3. Допуск на часы: ±1 шаг, не больше ──');
const s3 = totp.newSecret();
const now = Date.now();
ok(totp.verify(s3, totp.codeAt(s3, now), now), 'текущий код подходит');
ok(totp.verify(s3, totp.codeAt(s3, now - 30000), now), 'код предыдущего шага ещё подходит (часы отстают)');
ok(totp.verify(s3, totp.codeAt(s3, now + 30000), now), 'код следующего шага подходит (часы спешат)');
ok(!totp.verify(s3, totp.codeAt(s3, now - 120000), now), 'код четырёхминутной давности НЕ подходит');
ok(!totp.verify(s3, '000000', now) || totp.codeAt(s3, now) === '000000', 'случайные шесть нулей не открывают');
ok(!totp.verify(s3, '12345', now), 'код неверной длины отклонён');

console.log('\n── 4. Подключение: сначала проверка, потом включение ──');
const notices = [];
const user = { id: 'u_staff', name: 'Помощник' };
const setup = tf.setup(user, 'Генералы');
ok(!!setup.secret && setup.otpauth.startsWith('otpauth://totp/'), 'выдан ключ и ссылка для приложения');
ok(/issuer=/.test(setup.otpauth), 'в ссылке есть подпись игры — иначе в приложении три записи без имени');
ok(tf.status(user).enabled === false && tf.status(user).pending === true,
   'пока код не введён, фактор НЕ включён — иначе можно запереть себя опечаткой');
fails(() => tf.enable(user, '000000', notices), 'Код не подошёл', 'неверный код не включает фактор');
ok(tf.status(user).enabled === false, 'после неудачи фактор по-прежнему выключен');

const enabled = tf.enable(user, totp.codeAt(setup.secret), notices);
ok(tf.status(user).enabled === true, 'верный код включил фактор');
ok(Array.isArray(enabled.recoveryCodes) && enabled.recoveryCodes.length === 8,
   `выдано ${enabled.recoveryCodes.length} кодов восстановления`);

console.log('\n── 5. В базе лежат хеши, а не сами коды ──');
// Копии базы уезжают на чужой хост. Список одноразовых паролей в них
// свёл бы второй фактор на нет.
const stored = JSON.stringify(user.totp.recovery);
ok(enabled.recoveryCodes.every((c) => !stored.includes(c)), 'ни один код не хранится открытым текстом');
ok(user.totp.recovery.every((h) => /^[0-9a-f]{64}$/.test(h)), 'хранятся хеши sha256');

console.log('\n── 6. Вход: пароля мало ──');
const users = { u_staff: user };
const ch = tf.startChallenge(user);
ok(typeof ch === 'string' && ch.length >= 16, 'выдан одноразовый пропуск на второй шаг');
fails(() => tf.completeChallenge(ch, '000000', users), 'Код не подошёл', 'неверный код не пускает');
const uid = tf.completeChallenge(ch, totp.codeAt(user.totp.secret), users);
ok(uid === 'u_staff', 'верный код пропускает');
fails(() => tf.completeChallenge(ch, totp.codeAt(user.totp.secret), users), 'истекло',
      'использованный пропуск не работает второй раз');

console.log('\n── 7. Перебор кода упирается в потолок ──');
const ch2 = tf.startChallenge(user);
for (let i = 0; i < 5; i++) { try { tf.completeChallenge(ch2, '111111', users); } catch (e) {} }
fails(() => tf.completeChallenge(ch2, totp.codeAt(user.totp.secret), users), 'Войдите заново',
      'после пяти промахов пропуск сгорает — даже с верным кодом');

console.log('\n── 8. Просроченный пропуск ──');
const ch3 = tf.startChallenge(user);
const rec3 = tf._challenges.get(ch3);
rec3.at = Date.now() - tf.CHALLENGE_TTL_MS - 1000;      // как будто прошло больше пяти минут
fails(() => tf.completeChallenge(ch3, totp.codeAt(user.totp.secret), users), 'истекло',
      'пропуск старше пяти минут не действует');

console.log('\n── 9. Потеря телефона: коды восстановления ──');
const codes = enabled.recoveryCodes.slice();
const ch4 = tf.startChallenge(user);
const uid4 = tf.completeChallenge(ch4, codes[0], users);
ok(uid4 === 'u_staff', 'код восстановления пускает вместо приложения');
ok(user.totp.recovery.length === 7, `использованный код вычеркнут: осталось ${user.totp.recovery.length}`);
const ch5 = tf.startChallenge(user);
fails(() => tf.completeChallenge(ch5, codes[0], users), 'Код не подошёл',
      'тот же код восстановления второй раз не работает');
// Регистр и дефисы не должны иметь значения: код переписывают с бумажки
const ch6 = tf.startChallenge(user);
const uid6 = tf.completeChallenge(ch6, codes[1].toLowerCase().replace('-', ' '), users);
ok(uid6 === 'u_staff', 'код принимается в любом регистре и с любыми разделителями');

console.log('\n── 10. Выключение требует подтверждения ──');
fails(() => tf.disable(user, '000000', notices), 'действующий код',
      'без кода фактор не выключить — иначе хватило бы чужой открытой вкладки');
tf.disable(user, totp.codeAt(user.totp.secret), notices);
ok(tf.status(user).enabled === false, 'с верным кодом фактор выключается');
ok(tf.required(user) === false, 'выключенный фактор больше не требуется при входе');

console.log('\n── 11. Вход через HTTP: два шага ──');
// Здесь проверяется главное: /api/login при включённом факторе НЕ
// отдаёт токен. Это ровно та ошибка, из-за которой второй фактор
// в чужих проектах оказывается декоративным.
const routesSrc = fs.readFileSync(path.join(ROOT, 'src/services/auth.ts'), 'utf8');
const loginBody = routesSrc.slice(routesSrc.indexOf('async function login('), routesSrc.indexOf('async function loginTotp('));
const tfIdx = loginBody.indexOf('tf.required(found)');
const tokenIdx = loginBody.indexOf('return { token: issueToken(found.id), isAdmin: !!found.isAdmin }');
ok(tfIdx > 0 && tokenIdx > tfIdx, 'проверка фактора стоит ДО выдачи токена');
ok(/needTotp: true/.test(loginBody), 'вместо токена возвращается признак «нужен код»');
ok(!/token: issueToken[\s\S]{0,200}needTotp/.test(loginBody), 'токен не выдаётся вместе с требованием кода');

const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/'\/api\/login\/totp'/.test(routes), 'есть отдельный роут второго шага');
ok(/staffOnly2fa/.test(routes), 'подключение доступно только сотрудникам');
const secBlock = routes.slice(routes.indexOf('/api/2fa/status'), routes.indexOf('/api/2fa/status') + 900);
ok((secBlock.match(/staffOnly2fa\(req\.user\)/g) || []).length >= 3,
   'проверка прав стоит в каждом обработчике второго фактора, а не в одном');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
