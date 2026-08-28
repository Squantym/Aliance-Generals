// ═══════════════════════════════════════════════════════════════════
// test/mailvars.test.js — выдуманные подстановки не должны ронять письмо
//
// Двойные фигурные скобки — это не только наш синтаксис, но и синтаксис
// самого почтового сервиса. Если владелец напишет в теме {{Альянс Генералов}},
// думая, что так задаётся название игры, мы такую подстановку не знаем,
// и она уезжает к сервису как есть. Сервис видит СВОЮ подстановку с
// кириллицей и отклоняет письмо целиком:
//
//   Error in 'subject' field. Invalid substitution format 'Альянс Генералов'.
//
// Снаружи это выглядит как «регистрация сломалась»: игрок не получает
// подтверждение, а причина написана на языке чужого сервиса и про его
// правила. Отсюда два рубежа, оба проверяем:
//   1. при сохранении — отказать и объяснить, пока владелец у поля;
//   2. при отправке — снять скобки и всё равно отправить, потому что
//      шаблон мог быть сохранён до появления первой проверки.
//
// Запуск: node test/mailvars.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Своя папка: модуль пишет шаблоны в базу рядом с рабочей директорией
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mailvars-'));
fs.mkdirSync(path.join(work, 'data'), { recursive: true });
process.chdir(work);
process.env.APP_URL = 'https://aliance-general.ru';

const db = require(path.join(ROOT, 'dist/src/core/db.js'));
const mailer = require(path.join(ROOT, 'dist/src/services/mailer.js'));

(async () => {
  await db.init();
  const notices = [];

  console.log('\n── 1. Сохранить выдуманную подстановку нельзя ──');
  let err = null;
  try {
    mailer.save('Squantym', 'verify',
      'Подтверждение почты — {{Альянс Генералов}}',
      '<p>Привет, {{имя}}! <a href="{{ссылка}}">Подтвердить</a></p>', notices);
  } catch (e) { err = e; }
  ok('панель отказала', !!err);
  ok('назвала виноватую подстановку', /Альянс Генералов/.test(err && err.message));
  ok('перечислила разрешённые', /\{\{имя\}\}/.test(err && err.message) && /\{\{ссылка\}\}/.test(err && err.message));
  ok('подсказала, что делать', /без фигурных скобок/.test(err && err.message));

  console.log('\n── 2. Опечатка в известной подстановке — тоже ловится ──');
  err = null;
  try {
    // {{имяя}} — лишняя буква. Раньше уехало бы в сервис как есть.
    mailer.save('Squantym', 'verify', 'Тема',
      '<p>Привет, {{имяя}}! <a href="{{ссылка}}">Подтвердить</a></p>', notices);
  } catch (e) { err = e; }
  ok('опечатка не сохраняется', !!err && /имяя/.test(err.message));

  console.log('\n── 3. Правильный шаблон сохраняется как раньше ──');
  err = null;
  try {
    mailer.save('Squantym', 'verify',
      'Подтверждение почты — {{игра}}',
      '<p>Привет, {{имя}}! <a href="{{ссылка}}">Подтвердить</a> · {{сайт}}</p>', notices);
  } catch (e) { err = e; }
  ok('отказа нет', !err);
  const good = mailer.render('verify', { имя: 'Боец', код: '123456', ссылка: 'https://aliance-general.ru/#verify/abc' });
  ok('название игры подставилось', good.subject === 'Подтверждение почты — Альянс Генералов');
  ok('имя подставилось', /Привет, Боец!/.test(good.html));
  ok('ссылка не сломана экранированием', good.html.includes('https://aliance-general.ru/#verify/abc'));
  ok('скобок в готовом письме не осталось', !/\{\{|\}\}/.test(good.subject + good.html));

  console.log('\n── 4. Старый плохой шаблон письмо больше не рушит ──');
  // Кладём в базу напрямую — как будто он сохранён до появления проверки
  const store = db.load('mailTemplates', {});
  store.verify = {
    subject: 'Подтверждение почты — {{Альянс Генералов}}',
    html: '<p>Привет, {{имя}}! <a href="{{ссылка}}">Подтвердить</a> {{непонятно}}</p>',
    changedAt: 1, changedBy: 'старая версия',
  };
  db.save('mailTemplates');
  const r = mailer.render('verify', { имя: 'Генерал', ссылка: 'https://aliance-general.ru/#verify/xyz' });
  ok('в теме не осталось скобок — сервис такое больше не отклонит', !/\{\{|\}\}/.test(r.subject));
  ok('текст сохранён, потерялись только скобки', r.subject === 'Подтверждение почты — Альянс Генералов');
  ok('в письме тоже чисто', !/\{\{|\}\}/.test(r.html));
  ok('известные подстановки при этом работают', /Привет, Генерал!/.test(r.html));
  ok('ссылка цела', r.html.includes('https://aliance-general.ru/#verify/xyz'));

  console.log('\n── 5. Разметку в выдуманной подстановке не пропускаем ──');
  // Иначе через шаблон письма можно было бы протащить чужой тег
  store.verify = {
    subject: 'Тема',
    html: '<p>{{<script>alert(1)</script>}} <a href="{{ссылка}}">Тут</a></p>',
    changedAt: 1, changedBy: 'x',
  };
  db.save('mailTemplates');
  const r2 = mailer.render('verify', { имя: 'И', ссылка: 'https://x.ru/#a' });
  ok('тег обезврежен', !/<script>/.test(r2.html));
  ok('и виден как текст', /&lt;script&gt;/.test(r2.html));

  console.log('\n── 6. Служебные функции отвечают честно ──');
  ok('находит все скобки', mailer.leftovers('a {{раз}} b {{два}} c').length === 2);
  ok('на чистом тексте молчит', mailer.leftovers('без скобок вовсе').length === 0);
  ok('повторы не считает дважды', mailer.leftovers('{{раз}} и ещё {{раз}}').length === 1);

  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + e.message); process.exit(1); });
