// ═══════════════════════════════════════════════════════════════════
// test/regrace.test.js — два одновременных запроса не создают двойника
//
// Node однопоточный, и синхронный обработчик атомарен: между проверкой
// и записью в нём ничего не проходит. Но регистрация ЖДЁТ — хеширование
// пароля намеренно медленное, это его работа. Всё это время сервер
// обслуживает другие запросы.
//
// Из-за этого два обращения с одним позывным проходили проверку ОБА: на
// тот момент в базе ещё ничего нет. Оба доходили до записи, и в игре
// появлялись два аккаунта с одним именем. Последствия тихие и разные:
// findByName возвращает произвольного из двух, восстановление пароля по
// почте становится неоднозначным, а имя в чате перестаёт указывать на
// конкретного человека. Хватало двойного нажатия по кнопке.
//
// Здесь запросы запускаются ОДНОВРЕМЕННО, без ожидания первого — иначе
// гонки не будет и тест окажется зелёным ни на чём.
//
// Запуск: node test/regrace.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

process.env.MONGODB_URI = '';
// Ограничитель «пять аккаунтов с одного адреса в час» — правильное
// поведение, но здесь мешает: сценарий нарочно заводит больше.
process.env.DISABLE_RATE_LIMIT = '1';
require('./_guard');   // не даёт стереть боевую data/
const DATA = path.join(process.cwd(), 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const byName = (n) => Object.values(player.users()).filter((x) => x.name === n);
const byMail = (m) => Object.values(player.users())
  .filter((x) => String(x.email || '').toLowerCase() === m);

(async () => {
  await db.init();

  console.log('\n── 1. Один позывной, два одновременных запроса ──');
  // Промисы создаются ДО первого await: обе регистрации стартуют и
  // встают на хешировании пароля примерно в один момент.
  const r1 = auth.register('Двойник', 'пароль123', 'd1@t.ru', 'ru', '1.1.1.1');
  const r2 = auth.register('Двойник', 'пароль123', 'd2@t.ru', 'ru', '1.1.1.1');
  const res = await Promise.allSettled([r1, r2]);

  const okCount = res.filter((x) => x.status === 'fulfilled').length;
  const errCount = res.filter((x) => x.status === 'rejected').length;
  ok('одна регистрация прошла', okCount === 1);
  ok('вторая отклонена', errCount === 1);
  const err = res.find((x) => x.status === 'rejected');
  ok('и сказано, что позывной занят',
     !!err && /занят/i.test(String(err.reason && err.reason.message)));

  const dubles = byName('Двойник');
  ok(`в базе ровно один «Двойник» (сейчас ${dubles.length})`, dubles.length === 1);

  console.log('\n── 2. Одна почта, два одновременных запроса ──');
  // Тот же узор, но сталкиваются адреса: восстановление пароля по
  // неоднозначной почте — отдельная беда.
  const m1 = auth.register('Первый', 'пароль123', 'same@t.ru', 'ru', '1.1.1.1');
  const m2 = auth.register('Второй', 'пароль123', 'same@t.ru', 'ru', '1.1.1.1');
  const resM = await Promise.allSettled([m1, m2]);
  ok('прошла одна', resM.filter((x) => x.status === 'fulfilled').length === 1);
  ok('вторая отклонена', resM.filter((x) => x.status === 'rejected').length === 1);
  const errM = resM.find((x) => x.status === 'rejected');
  ok('и сказано, что адрес занят',
     !!errM && /email|почт/i.test(String(errM.reason && errM.reason.message)));
  ok(`в базе ровно один адрес same@t.ru (сейчас ${byMail('same@t.ru').length})`,
     byMail('same@t.ru').length === 1);

  console.log('\n── 3. Разные имена по-прежнему заводятся ──');
  // Проверка не должна стать слишком строгой: одновременная регистрация
  // РАЗНЫХ людей — обычное дело в час пик.
  const a1 = auth.register('Альфа', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
  const a2 = auth.register('Браво', 'пароль123', 'b@t.ru', 'ru', '1.1.1.1');
  const resA = await Promise.allSettled([a1, a2]);
  ok('обе регистрации прошли', resA.every((x) => x.status === 'fulfilled'));
  ok('оба игрока в базе', byName('Альфа').length === 1 && byName('Браво').length === 1);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
