// ═══════════════════════════════════════════════════════════════════
// test/passwordeye.test.js — кнопка «показать пароль»
//
// Проверяется в настоящем DOM, а не поиском строк в исходнике: смысл
// кнопки в том, что она ПЕРЕКЛЮЧАЕТ поле, а не в том, что она нарисована.
//
// Отдельно стережётся то, что кнопка появляется и на полях, добавленных
// ПОЗЖЕ. Формы с паролем рисуются в десятке мест — вход, регистрация,
// смена пароля, восстановление, — и если бы обход делался списком, одно
// из них однажды осталось бы без кнопки, причём молча.
//
// Запуск: node test/passwordeye.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) {}
if (!JSDOM) { console.log('⛔ jsdom не установлен'); process.exit(1); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>',
    { url: 'https://aliance-general.ru/', runScripts: 'outside-only' });
  const win = dom.window;
  // ui.js объявлен как `const UI = {...}` в глобальной области — в window
  // он не попадает, забираем значение из самого eval.
  const UI = win.eval(fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8') + '\n;UI');
  win.UI = UI;
  const app = win.document.getElementById('app');

  console.log('\n── 1. Кнопка появляется у поля пароля ──');
  app.innerHTML = '<input type="password" id="p1" value="секрет123">';
  UI.eyes(win.document);
  const p1 = win.document.getElementById('p1');
  const wrap = p1.parentElement;
  ok('поле обёрнуто', wrap && wrap.classList.contains('pw-wrap'));
  const btn = wrap.querySelector('.pw-eye');
  ok('кнопка добавлена', !!btn);
  ok('кнопка не отправляет форму', btn.type === 'button');
  ok('у кнопки есть подпись для чтения с экрана', !!btn.getAttribute('aria-label'));
  ok('значок свой, а не системный', /<svg/.test(btn.innerHTML));

  console.log('\n── 2. Она действительно переключает поле ──');
  // Главная проверка файла: нарисованная, но ничего не делающая кнопка
  // выглядит рабочей и на скриншоте, и в поиске по исходнику.
  ok('до нажатия пароль скрыт', p1.type === 'password');
  btn.onclick();
  ok('после нажатия виден', p1.type === 'text');
  ok('значок сменился', btn.classList.contains('on'));
  ok('и подпись тоже', /Скрыть/.test(btn.getAttribute('aria-label')));
  btn.onclick();
  ok('повторное нажатие снова прячет', p1.type === 'password');
  ok('и значок вернулся', !btn.classList.contains('on'));
  ok('значение поля не пострадало', p1.value === 'секрет123');

  console.log('\n── 3. Дважды одно поле не оборачивается ──');
  // Наблюдатель срабатывает на каждую перерисовку экрана; без отметки
  // на поле нарастала бы гирлянда из кнопок.
  UI.eyes(win.document);
  UI.eyes(win.document);
  ok('кнопка по-прежнему одна', wrap.querySelectorAll('.pw-eye').length === 1);
  ok('и обёртка одна', win.document.querySelectorAll('.pw-wrap').length === 1);

  console.log('\n── 4. Поля, появившиеся позже, тоже получают кнопку ──');
  UI.watchPasswords();
  app.innerHTML += '<input type="password" id="p2">';
  await wait(80);                       // наблюдателю дана пачка в 30 мс
  const p2 = win.document.getElementById('p2');
  ok('новое поле обёрнуто', p2.parentElement.classList.contains('pw-wrap'));
  ok('и у него своя кнопка', !!p2.parentElement.querySelector('.pw-eye'));

  console.log('\n── 5. Обычные поля не трогаем ──');
  app.innerHTML += '<input type="text" id="t1"><input type="email" id="e1">';
  await wait(80);
  ok('у текстового поля кнопки нет',
     !win.document.getElementById('t1').parentElement.classList.contains('pw-wrap'));
  ok('у почты тоже нет',
     !win.document.getElementById('e1').parentElement.classList.contains('pw-wrap'));

  console.log('\n── 6. Стили для кнопки есть ──');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  ok('обёртка описана', /\.pw-wrap\s*\{/.test(css));
  ok('кнопка описана', /\.pw-eye\s*\{/.test(css));
  ok('поле оставляет место под кнопку', /\.pw-wrap\s*>\s*input\s*\{[^}]*padding-right/.test(css));

  console.log('\n── 7. Браузерный глаз погашен ──');
  // Edge рисует свой значок прямо в поле. Рядом с нашим получалось два
  // глаза подряд, и хуже того — браузерный переключал поле мимо нашей
  // кнопки, после чего она показывала не то состояние.
  ok('::-ms-reveal скрыт', /::-ms-reveal[^{]*\{[^}]*display:\s*none/.test(css));
  ok('::-ms-clear тоже', /::-ms-clear/.test(css));
  ok('значок автозаполнения Safari убран',
     /::-webkit-(credentials|strong-password)-auto-fill-button/.test(css));

  console.log('\n── 8. Значок один и тот же везде ──');
  // Просили «крутой кастомный, а не системный». Эмодзи 👁 — системный:
  // его рисует шрифт устройства, и на Android, Windows и iOS это три
  // разных картинки. Проверяем, что ни одна кнопка показа пароля к нему
  // не вернулась.
  const uiSrc = fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8');
  const withEye = ['public/js/admin.js', 'public/js/admin2/player.js', 'public/js/screens/core.js']
    .map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
  const emojiBtns = withEye
    .filter(([, src]) => /id="[a-z0-9-]*-eye"[^>]*>\s*👁/.test(src))
    .map(([f]) => f);
  ok(emojiBtns.length ? `эмодзи-глаз вернулся в: ${emojiBtns.join(', ')}` : 'кнопки показа пароля рисуют свой значок',
     emojiBtns.length === 0);
  ok('панель берёт значок из общего места (UI.EYE_ON)',
     withEye.filter(([, src]) => /UI\.EYE_ON/.test(src)).length >= 2);
  ok('значок описан ровно в одном файле',
     /EYE_ON:/.test(uiSrc) && withEye.every(([, src]) => !/EYE_ON:/.test(src)));

  // И проверка на слом: правило обязано отличать эмодзи от значка.
  ok('образец с эмодзи распознаётся',
     /id="[a-z0-9-]*-eye"[^>]*>\s*👁/.test('<button id="x-eye" title="a">👁</button>'));
  ok('образец со значком — нет',
     !/id="[a-z0-9-]*-eye"[^>]*>\s*👁/.test('<button id="x-eye">${UI.EYE_ON}</button>'));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
