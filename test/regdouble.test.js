// ═══════════════════════════════════════════════════════════════════
// test/regdouble.test.js — регистрация не заводит аккаунт дважды
//
// Владелец заподозрил, что при нажатии на «Подписать контракт» аккаунт
// создаётся дважды. Проверено: сервер защищён — повторная проверка
// занятости стоит ПОСЛЕ медленного хеширования пароля, и второй запрос
// упирается в «позывной занят». Здесь эта защита и стережётся: она
// неочевидна, и любая перестановка строк её ломает молча.
//
// Что стережётся:
//  1. Два одновременных запроса с одним позывным дают ОДИН аккаунт.
//  2. То же с одной почтой и разными именами.
//  3. Пять одновременных — всё равно один.
//  4. Кнопка гасится на время отправки: игрок не должен видеть
//     «позывной занят» после собственного второго нажатия.
//  5. Незавершённые регистрации видно в панели: они держат позывной и
//     адрес, а со стороны выглядят как «аккаунт создался дважды».
//
// Запуск: node test/regdouble.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
process.env.ALLOW_UNVERIFIED_EMAIL = '1';   // почты в тестах нет
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const admin = require('../dist/src/services/admin');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

const byName = (n) => Object.values(player.users()).filter((u) => u.name === n);
const byMail = (m) => Object.values(player.users()).filter((u) => (u.email || '').toLowerCase() === m);
// Регистрация возвращает ошибку промисом — считаем, чем кончилась каждая
const tryReg = (n, m) => auth.register(n, 'пароль123', m, 'ru', '10.0.0.1')
  .then(() => 'ok').catch((e) => String(e.message));

(async () => {
  await db.init();

  console.log('\n[1] Двойное нажатие: два одновременных запроса');
  const two = await Promise.all([tryReg('Дубль', 'd@t.ru'), tryReg('Дубль', 'd@t.ru')]);
  eq('аккаунт с этим позывным ровно один', byName('Дубль').length, 1);
  eq('и с этой почтой ровно один', byMail('d@t.ru').length, 1);
  eq('одна попытка прошла', two.filter((r) => r === 'ok').length, 1);
  ok(`вторая получила внятный отказ: «${two.find((r) => r !== 'ok')}»`,
     two.some((r) => /занят|использ/i.test(String(r))));

  console.log('\n[2] Одна почта, разные позывные — тоже один аккаунт');
  const five = await Promise.all([1, 2, 3, 4, 5].map((i) => tryReg('Почта' + i, 'same@t.ru')));
  eq('аккаунт с этой почтой один', byMail('same@t.ru').length, 1);
  eq('и прошла ровно одна попытка', five.filter((r) => r === 'ok').length, 1);

  console.log('\n[3] Один позывной, разная почта — тоже один');
  const five2 = await Promise.all([1, 2, 3, 4, 5].map((i) => tryReg('Одноимённый', 'u' + i + '@t.ru')));
  eq('аккаунт с этим позывным один', byName('Одноимённый').length, 1);
  eq('и прошла ровно одна попытка', five2.filter((r) => r === 'ok').length, 1);

  console.log('\n[4] Защита стоит ПОСЛЕ хеширования пароля');
  // Хеширование медленное, и всё это время обработчик стоит на await.
  // Проверка занятости ДО него ничего не даёт: на тот момент в базе
  // пусто у обоих запросов. Стережём именно порядок строк.
  const src = fs.readFileSync(path.join(ROOT, 'src/services/auth.ts'), 'utf8');
  const hashAt = src.indexOf('await u.hashPassword(password, salt)');
  const recheck = src.indexOf('const takenName = require(\'./names\').findClash(login)');
  const writeAt = src.indexOf('const newU = newUser(id, login, emailAddr');
  ok('хеширование найдено', hashAt > 0);
  ok('повторная проверка занятости — ПОСЛЕ него', recheck > hashAt);
  ok('и ДО записи игрока в базу', recheck < writeAt);
  ok('между проверкой и записью нет ожиданий',
     !/await/.test(src.slice(recheck, writeAt)));

  console.log('\n[5] Кнопка гасится на время отправки');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  const at = js.indexOf("document.getElementById('rg-go').onclick");
  const block = js.slice(at, at + 4000);
  ok('повторное нажатие отсекается сразу', /if \(btn\.disabled\) return;/.test(block));
  ok('кнопка гаснет перед отправкой', /btn\.disabled = true;[\s\S]{0,60}btn\.textContent = 'Отправляем…';/.test(block));
  ok('и возвращается при отказе — иначе форма запиралась бы навсегда',
     /unlock\(\);\s*\/\/ отказ/.test(block));

  console.log('\n[6] Незавершённые регистрации видно в панели');
  const users = player.users();
  const first = Object.values(users)[0];
  first.emailVerified = false;                 // как будто код из письма не ввели
  first.createdAt = Date.now() - 50 * 3600000; // и висит третьи сутки
  const list = admin.listPlayers('pending');
  ok('фильтр показывает только незавершённые', list.pending === true);
  eq('и находит нашу запись', list.players.filter((p) => p.id === first.id).length, 1);
  ok('завершённые в этот список не попадают',
     list.players.length < Object.keys(users).length);
  const all = admin.listPlayers('');
  ok('в обычном списке они по-прежнему есть — из игры их никто не удалял',
     all.players.some((p) => p.id === first.id));
  const queue = fs.readFileSync(path.join(ROOT, 'public/js/admin2/queue.js'), 'utf8');
  ok('очередь работ показывает их строкой', /Незавершённых регистраций/.test(queue));
  ok('и ведёт по ссылке в список', /A2Router\.build\('players', '', \{ q: 'pending' \}\)/.test(queue));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
