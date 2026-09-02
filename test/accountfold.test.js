// ═══════════════════════════════════════════════════════════════════
// test/accountfold.test.js — смена логина и пароля в настройках
//
// Что стережётся:
//
//  1. СВЁРНУТО В ДВЕ КНОПКИ. Логин и пароль меняют раз в год, а семь
//     полей стояли развёрнутыми всегда: экран настроек начинался с
//     длинной формы, и тема, уведомления и согласия оказывались под ней.
//
//  2. В ТЕСТОВОМ МИРЕ ЭТОГО НЕТ ВОВСЕ. Аккаунты там раздаёт владелец, и
//     тестировщик, сменивший пароль, просто потеряет выданный доступ.
//
//  3. ГЛАЗ У ПОЛЯ ОДИН. Свой общий переключатель на три поля убран:
//     теперь кнопка появляется у каждого поля сама, и рядом со старой
//     они выглядели как две одинаковые кнопки подряд.
//
// Запуск: node test/accountfold.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');

console.log('\n── 1. Блок свёрнут в две кнопки ──');
ok('смена пароля — раскрывающийся блок', /<summary class="acc-sum">🔑 Сменить пароль<\/summary>/.test(core));
ok('смена логина — тоже', /<summary class="acc-sum">🔑 Сменить логин аккаунта<\/summary>/.test(core));
ok('оба на <details>, а не на своём коде', (core.match(/<details class="acc-fold">/g) || []).length === 2);
// Поля остались внутри — иначе «свернули» превратилось бы в «удалили».
ok('поле текущего пароля на месте', /id="pw-old"/.test(core));
ok('поля нового пароля на месте', /id="pw-new1"/.test(core) && /id="pw-new2"/.test(core));
ok('поле нового логина на месте', /id="al-new"/.test(core));
ok('кнопки действий на месте', /id="pw-go"/.test(core) && /id="al-go"/.test(core));

console.log('\n── 2. В тестовом мире блока нет ──');
// Проверка идёт по состоянию мира, а не по роли: тестировщик не должен
// суметь сменить выданные ему логин и пароль ни при каких правах.
ok('блок закрыт признаком тестового мира',
   /App\._world && App\._world\.test && App\._world\.test\.on\) \? '' :/.test(core));

console.log('\n── 3. Обработчики не падают, когда полей нет ──');
// Раньше здесь было безусловное document.getElementById('pw-go').onclick
// — на экране без блока это уронило бы всю вкладку настроек.
ok('вход в обработчики проверяет наличие поля',
   /tab === 'account' && document\.getElementById\('pw-old'\)/.test(core));
ok('кнопка смены пароля берётся с проверкой', /const pwGo = document\.getElementById\('pw-go'\);/.test(core));
ok('и кнопка смены логина тоже', /const alGo = document\.getElementById\('al-go'\);/.test(core));

console.log('\n── 4. Двойного глаза больше нет ──');
ok('свой общий переключатель убран', !/id="pw-eye"/.test(core));
ok('и его обработчик тоже', !/getElementById\('pw-eye'\)/.test(core));

console.log('\n── 5. Стили свёрнутых блоков ──');
ok('блок описан', /\.acc-fold\s*\{/.test(css));
ok('заголовок-кнопка описан', /\.acc-fold > \.acc-sum\s*\{/.test(css));
ok('системный треугольник скрыт', /acc-sum::-webkit-details-marker/.test(css));
ok('и нарисована своя стрелка', /\.acc-fold > \.acc-sum::after/.test(css));

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
