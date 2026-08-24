// ═══════════════════════════════════════════════════════════════════
// test/tplstale.test.js — сохранённый шаблон письма отстаёт от заводского
//
// Ловушка, из-за которой игрокам уходило письмо без кода:
//
//   Владелец однажды нажал «Сохранить» на шаблоне подтверждения — тогда
//   ещё старом, с одной кнопкой. Текст лёг в базу. Дальше заводской
//   шаблон получил код из шести цифр, а сохранённая копия осталась
//   прежней: тексты из базы заводские улучшения не догоняют.
//   В итоге форма регистрации требовала код, а в письме кода не было.
//   Тупик, и главное — молчаливый: снаружи это выглядело как «игра
//   зачем-то просит то, чего никто не присылал».
//
// Три рубежа, все проверяем:
//   1. письмо всё равно уходит с кодом, даже если шаблон устарел;
//   2. «Сохранить» без единой правки больше не отцепляет от заводского;
//   3. панель прямо говорит, чего шаблону не хватает.
//
// Запуск: node test/tplstale.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-'));
fs.mkdirSync(path.join(work, 'data'), { recursive: true });
process.chdir(work);
process.env.APP_URL = 'https://aliance-general.ru';

const db = require(path.join(ROOT, 'dist/src/core/db.js'));
const mailer = require(path.join(ROOT, 'dist/src/services/mailer.js'));

// Ровно тот текст, что лежал в базе на живом сервере: кнопка, никакого кода
const OLD_VERIFY = '<h2>Привет, {{имя}}!</h2>'
  + '<p>Чтобы активировать аккаунт в игре «{{игра}}», подтвердите почту по кнопке ниже:</p>'
  + '<p><a href="{{ссылка}}">Подтвердить почту</a></p>';

(async () => {
  await db.init();
  const notices = [];
  const store = () => db.load('mailTemplates', {});

  console.log('\n── 1. Устаревший шаблон не оставляет игрока без кода ──');
  const s = store();
  s.verify = { subject: 'Подтверждение почты — {{игра}}', html: OLD_VERIFY, changedAt: 1, changedBy: 'старая версия' };
  db.save('mailTemplates');

  const r = mailer.render('verify', { имя: 'Апчихба', код: '482913', ссылка: 'https://aliance-general.ru/#verify/abc' });
  ok('код всё-таки попал в письмо', /482913/.test(r.html));
  ok('текст владельца не затёрт', /подтвердите почту по кнопке ниже/i.test(r.html));
  ok('ссылка на месте', r.html.includes('https://aliance-general.ru/#verify/abc'));
  ok('имя подставлено', /Апчихба/.test(r.html));

  console.log('\n── 2. Панель показывает, чего не хватает ──');
  const t = mailer.list().templates.find((x) => x.id === 'verify');
  ok('шаблон помечен как изменённый', t.isDefault === false);
  ok('названа недостающая подстановка', (t.missing || []).includes('{{код}}'));
  const reset = mailer.list().templates.find((x) => x.id === 'reset');
  ok('у нетронутого шаблона претензий нет', (reset.missing || []).length === 0);
  // Панель обязана это показать, иначе предупреждение некому прочитать
  const mailJs = fs.readFileSync(path.join(ROOT, 'public/js/admin2/mail.js'), 'utf8');
  ok('панель рисует предупреждение', /t\.missing/.test(mailJs) && /устарел/i.test(mailJs));

  console.log('\n── 3. «Вернуть заводской» чинит ──');
  mailer.resetToDefault('verify', notices);
  const back = mailer.list().templates.find((x) => x.id === 'verify');
  ok('шаблон снова заводской', back.isDefault === true);
  ok('претензий больше нет', (back.missing || []).length === 0);
  const r2 = mailer.render('verify', { имя: 'Апчихба', код: '111222', ссылка: 'https://x.ru/#verify/z' });
  ok('код в письме стоит крупно, из шаблона', /111222/.test(r2.html));
  ok('и дописка-спасатель больше не нужна',
     (r2.html.match(/111222/g) || []).length === 1);

  console.log('\n── 4. «Сохранить» без правок не замораживает шаблон ──');
  // Именно так владелец и попал в ловушку: открыл, ничего не менял,
  // нажал «Сохранить» — и отцепился от заводской ветки навсегда.
  const d = mailer.DEFAULTS.verify;
  const res = mailer.save('Squantym', 'verify', d.subject, d.html, notices);
  ok('панель сообщает, что оставила заводским', res.isDefault === true);
  ok('в базе копия не появилась', !store().verify);
  const t4 = mailer.list().templates.find((x) => x.id === 'verify');
  ok('и шаблон по-прежнему числится заводским', t4.isDefault === true);

  console.log('\n── 5. Настоящая правка сохраняется как раньше ──');
  mailer.save('Squantym', 'verify', 'Моя тема — {{игра}}',
    d.html.replace('Привет', 'Здравия желаю'), notices);
  const t5 = mailer.list().templates.find((x) => x.id === 'verify');
  ok('правка сохранилась', t5.isDefault === false && /Здравия желаю/.test(t5.html));
  ok('автор записан', t5.changedBy === 'Squantym');
  ok('претензий нет — {{код}} на месте', (t5.missing || []).length === 0);
  const r5 = mailer.render('verify', { имя: 'Боец', код: '777888', ссылка: 'https://x.ru/#v/a' });
  ok('письмо собирается по правке владельца', /Здравия желаю/.test(r5.html) && /777888/.test(r5.html));

  console.log('\n── 6. Шаблон без {{код}} сохранить всё-таки можно ──');
  // Если владелец сознательно оставляет только ссылку — это его право,
  // код в письмо допишется сам. Запрещать нечего, предупредить достаточно.
  let err = null;
  try {
    mailer.save('Squantym', 'verify', 'Тема — {{игра}}',
      '<p>Привет, {{имя}}! <a href="{{ссылка}}">Подтвердить</a></p>', notices);
  } catch (e) { err = e; }
  ok('сохранение прошло', !err);
  const t6 = mailer.list().templates.find((x) => x.id === 'verify');
  ok('но панель предупреждает', (t6.missing || []).includes('{{код}}'));

  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
