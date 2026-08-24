// ═══════════════════════════════════════════════════════════════════
// test/access2.test.js — устройства, сессии, журнал безопасности, письма
//
// Проверяем ПОВЕДЕНИЕ модулей, а не текст исходников.
//
// Отдельно проверяется дыра, найденная при этой работе: сброс пароля по
// письму НЕ закрывал чужие сессии. Сессия давно хранится объектом, а
// сравнение осталось строковым — цикл не удалял ничего, и угонщик
// оставался внутри после того, как хозяин сменил пароль.
//
// Запуск: node test/access2.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.DISABLE_RATE_LIMIT = '1';

const db     = require('../dist/src/core/db');
const player = require('../dist/src/services/player');
const access = require('../dist/src/services/access');
const auth   = require('../dist/src/services/auth');
const mailer = require('../dist/src/services/mailer');

let passed = 0;
const ok = (n, c) => { assert.ok(c, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (=${a})`); };

const um = player.users();
const reset = () => { for (const k of Object.keys(um)) delete um[k]; };
const mk = (id) => ({ id, name: id, level: 10, email: id + '@test.ru', emailVerified: true, access: {} });

const UA_PC   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const FP_A = '1920x1080|24bit|1.00|Europe/Moscow|ru-RU|cpu8|mem8|Win32|0tp';
const FP_B = '1366x768|24bit|1.00|Asia/Almaty|ru-RU|cpu4|mem4|Win32|0tp';

// ───────────────────────────────────────────────────────────────────
console.log('\n[1] Одинаковый браузер, разные машины — разные устройства');
// Ради этого и добавлен отпечаток: строка браузера у половины игроков
// совпадает дословно, и без отпечатка два человека выглядели одним.
const k1 = access.deviceKey(UA_PC, null, FP_A);
const k2 = access.deviceKey(UA_PC, null, FP_B);
const k3 = access.deviceKey(UA_PC, null, FP_A);
ok('один и тот же компьютер даёт один ключ', k1 === k3);
ok('другой экран и часовой пояс — другой ключ', k1 !== k2);
ok('телефон отличается от компьютера', access.deviceKey(UA_PHONE, null, FP_A) !== k1);

// ───────────────────────────────────────────────────────────────────
console.log('\n[2] Сводка устройств: что, когда и с каких адресов');
reset();
const A = mk('a'); um['a'] = A;
access.recordLogin(A, '95.24.1.7', UA_PC, 'регистрация', null, FP_A);
access.recordLogin(A, '95.24.1.7', UA_PC, 'вход', null, FP_A);
access.recordLogin(A, '2.60.5.5', UA_PHONE, 'вход', null, FP_A);

const v = access.view(A);
eq('устройств в сводке', v.devices.length, 2);
const pc = v.devices.find((x) => x.key === k1);
ok('компьютер найден в сводке', !!pc);
eq('входов с компьютера', pc.count, 2);
ok('устройство регистрации помечено', pc.isReg === true);
eq('адрес компьютера в его же карточке', pc.ips[0].ip, '95.24.1.7');
const ph = v.devices.find((x) => x.key !== k1);
eq('у телефона свой адрес', ph.ips[0].ip, '2.60.5.5');

console.log('\n    вход с нового устройства попал в журнал безопасности');
const newDev = v.security.filter((s) => s.kind === 'new_device');
eq('событий «новое устройство»', newDev.length, 1);
ok('в событии записано устройство', /SM-A536E|телефон/.test(newDev[0].device));
ok('первый вход в жизни аккаунта событием не считается',
   !v.security.some((s) => s.kind === 'new_device' && s.device === pc.label));

// ───────────────────────────────────────────────────────────────────
console.log('\n[3] Кто ещё заходил с этого устройства');
reset();
const P1 = mk('p1'); const P2 = mk('p2'); const P3 = mk('p3');
um['p1'] = P1; um['p2'] = P2; um['p3'] = P3;
access.recordLogin(P1, '95.24.1.7', UA_PC, 'регистрация', null, FP_A);
access.recordLogin(P2, '77.1.1.1', UA_PC, 'регистрация', null, FP_A);   // тот же компьютер, другой адрес
access.recordLogin(P3, '95.24.1.7', UA_PC, 'регистрация', null, FP_B);   // тот же адрес, другая машина

const same = access.byDevice(k1, um).map((x) => x.id).sort();
eq('нашлись оба с одного устройства', same.join(','), 'p1,p2');
ok('другая машина в список не попала', same.indexOf('p3') === -1);
ok('видно, что оба на нём регистрировались', access.byDevice(k1, um).every((x) => x.isReg));

console.log('\n    и это НЕ то же самое, что совпадение адреса');
const byIp = access.related(P1, um).map((x) => x.id);
ok('по адресу находится и тот, у кого другая машина', byIp.indexOf('p3') >= 0);

// ───────────────────────────────────────────────────────────────────
console.log('\n[4] Активные сессии и выброс из кабинета');
reset();
const S = mk('s'); um['s'] = S;
const t1 = auth.issueToken('s', { ip: '95.24.1.7', ua: UA_PC, fp: FP_A });
const t2 = auth.issueToken('s', { ip: '2.60.5.5', ua: UA_PHONE, fp: FP_A });
const list = auth.sessionsOf('s');
eq('открытых сессий', list.length, 2);
ok('у сессии записано устройство', list.every((x) => !!x.device));
ok('у сессии записан адрес', list.map((x) => x.ip).sort().join(',') === '2.60.5.5,95.24.1.7');

ok('закрыли одну сессию', auth.killOne(t1) === true);
eq('осталась одна', auth.sessionsOf('s').length, 1);
ok('повторное закрытие той же — уже нечего закрывать', auth.killOne(t1) === false);
eq('вторая сессия жива', auth.sessionsOf('s')[0].token, t2);

console.log('\n    выброс всех сессий игрока');
auth.issueToken('s', { ip: '1.1.1.1', ua: UA_PC, fp: FP_A });
eq('перед выбросом сессий', auth.sessionsOf('s').length, 2);
eq('закрыто', auth.killSessions('s'), 2);
eq('после выброса', auth.sessionsOf('s').length, 0);

console.log('\n    выброс вообще всех');
auth.issueToken('s', { ip: '1.1.1.1', ua: UA_PC });
const O = mk('o'); um['o'] = O;
auth.issueToken('o', { ip: '2.2.2.2', ua: UA_PC });
ok('счётчик видит обоих', Object.keys(auth.sessionCounts()).length >= 2);
const killedAll = auth.killEverySession();
ok(`закрыто всё разом (${killedAll})`, killedAll >= 2);
eq('ни у кого не осталось', Object.keys(auth.sessionCounts()).length, 0);

// ───────────────────────────────────────────────────────────────────
console.log('\n[5] Сброс пароля закрывает чужие сессии (была дыра)');
(async () => {
  reset();
  const u2 = require('../dist/src/core/utils');
  const salt = u2.uid(16);
  const V = mk('v');
  V.salt = salt;
  V.passHash = await u2.hashPassword('старый123', salt);
  V.resetToken = 'reset-token-test';
  V.resetTokenExp = Date.now() + 3600000;
  um['v'] = V;

  // Угонщик сидит в кабинете со своим токеном
  const stolen = auth.issueToken('v', { ip: '203.0.113.9', ua: UA_PC, fp: FP_B });
  eq('до сброса сессия угонщика жива', auth.sessionsOf('v').length, 1);

  await auth.resetPassword('reset-token-test', 'новый12345', '95.24.1.7');

  eq('после сброса пароля сессий не осталось', auth.sessionsOf('v').length, 0);
  ok('токен угонщика больше не действует', !auth.sessionsOf('v').some((x) => x.token === stolen));
  const sec = access.view(V).security.filter((s) => s.kind === 'password_reset');
  eq('сброс попал в журнал безопасности', sec.length, 1);

  // ─────────────────────────────────────────────────────────────────
  console.log('\n[6] Шаблоны писем');
  const before = mailer.list().templates.find((t) => t.id === 'verify');
  ok('заводской шаблон подтверждения на месте', before.isDefault === true);

  const r = mailer.render('verify', { имя: 'Абдурахман', ссылка: 'https://x.test/#verify/abc' });
  ok('в теме подставилось название игры', /Альянс Генералов/.test(r.subject));
  ok('в тексте подставилось имя', r.html.indexOf('Абдурахман') >= 0);
  ok('в тексте подставилась ссылка', r.html.indexOf('https://x.test/#verify/abc') >= 0);
  ok('незаполненных подстановок не осталось', !/\{\{[а-яa-z]+\}\}/i.test(r.html));

  console.log('\n    шаблон без ссылки сохранить нельзя');
  let threw = '';
  try { mailer.save('владелец', 'verify', 'Тема', '<p>Просто текст без ссылки</p>', []); }
  catch (e) { threw = e.message; }
  ok(`отказ с объяснением: «${threw}»`, /ссылка/.test(threw));

  console.log('\n    правка сохраняется и возвращается к заводской');
  mailer.save('владелец', 'verify', 'Своя тема {{игра}}', '<p>Привет, {{имя}}! <a href="{{ссылка}}">Подтвердить</a></p>', []);
  const saved = mailer.list().templates.find((t) => t.id === 'verify');
  ok('шаблон помечен как изменённый', saved.isDefault === false);
  eq('автор правки записан', saved.changedBy, 'владелец');
  ok('письмо собирается по новой правке',
     mailer.render('verify', { имя: 'Боец', ссылка: 'L' }).html.indexOf('Привет, Боец!') >= 0);

  mailer.resetToDefault('verify', []);
  ok('после возврата снова заводской',
     mailer.list().templates.find((t) => t.id === 'verify').isDefault === true);

  console.log('\n    имя игрока в письме экранируется');
  const evil = mailer.render('verify', { имя: '<script>alert(1)</script>', ссылка: 'L' });
  ok('тега script в письме нет', evil.html.indexOf('<script>') === -1);

  console.log('\n    рассылка знает своих получателей');
  reset();
  const R1 = mk('r1'); const R2 = mk('r2'); const R3 = mk('r3');
  R2.emailVerified = false;              // не подтвердил почту
  R3.email = '';                         // почты нет вовсе
  um['r1'] = R1; um['r2'] = R2; um['r3'] = R3;
  const aud = mailer.audience(um);
  eq('получателей с подтверждённой почтой', aud.ready, 1);
  eq('без подтверждения', aud.unverified, 1);
  eq('без почты', aud.noEmail, 1);
  ok('в список рассылки попал только подтверждённый',
     mailer.recipients(um).map((x) => x.id).join(',') === 'r1');

  console.log(`\n═══ Всего проверок: ${passed} ═══`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
