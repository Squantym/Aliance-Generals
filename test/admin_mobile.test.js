// Адаптив админ-панели под телефоны:
// (1) таблица игроков превращается в карточки на узком экране;
// (2) кнопки действий переносятся, а не уезжают за экран;
// (3) у ресурсных ячеек есть подписи (шапка на мобильном скрыта);
// (4) журнал прокручивается горизонтально (переносы там не ломают колонки);
// (5) поля/гриды не шире экрана.
const assert = require('assert');
const path = require('path'), fs = require('fs');
const ROOT = process.cwd();
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
const js  = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');

console.log('\n[1] Разметка таблицы игроков размечена классами');
ok('таблица имеет класс adm-players', /class="adm-players"/.test(js));
ok('обёртка имеет класс adm-players-wrap', /adm-players-wrap/.test(js));
ok('ячейка действий помечена adm-acts', /class="adm-acts"/.test(js));
ok('ресурсные ячейки помечены adm-stat', (js.match(/class="adm-stat"/g) || []).length === 4);
ok('у ресурсных ячеек есть подписи data-l', /data-l="💵"/.test(js) && /data-l="🪙"/.test(js) && /data-l="👂"/.test(js) && /data-l="🎖"/.test(js));
ok('ячейка имени помечена adm-p-name', /class="adm-p-name"/.test(js));

console.log('\n[2] CSS: карточная раскладка на узком экране');
ok('есть медиазапрос max-width 760px', /@media \(max-width: 760px\)/.test(css));
ok('строки таблицы становятся блоками', /\.adm-players tr, \.adm-players td \{ display: block/.test(css));
ok('шапка таблицы скрыта на мобильном', /\.adm-players thead \{ display: none/.test(css));
ok('подписи ресурсов выводятся через ::before', /\.adm-players \.adm-stat::before/.test(css) && /content: attr\(data-l\)/.test(css));

console.log('\n[3] Кнопки действий переносятся, а не уезжают');
ok('adm-acts: white-space normal', /\.adm-players \.adm-acts \{[^}]*white-space: normal/.test(css));
ok('adm-acts: flex-wrap', /\.adm-players \.adm-acts \{[^}]*flex-wrap: wrap/.test(css));
ok('кнопки тянутся и имеют минимальную ширину', /\.adm-players \.adm-acts \.btn \{[^}]*min-width/.test(css));

console.log('\n[4] Журнал: горизонтальная прокрутка сохранена');
ok('журнал помечен adm-log-wrap', /adm-log-wrap/.test(js));
ok('журнал прокручивается по горизонтали', /\.adm-log-wrap \{ overflow-x: auto/.test(css));
ok('журнал исключён из правила переноса nowrap', /:not\(\.adm-log-wrap \*\)/.test(css));

console.log('\n[5] Поля и гриды не шире экрана');
ok('инпуты/селекты ограничены шириной', /#content input, #content select, #content textarea \{ max-width: 100%/.test(css));
ok('инлайновые flex-ряды переносятся', /#content \[style\*="display:flex"\]/.test(css) && /flex-wrap: wrap/.test(css));
ok('трёхколоночные гриды сужаются на узком экране', /grid-template-columns:1fr 1fr 1fr"\] \{ grid-template-columns: 1fr 1fr/.test(css));
ok('есть медиазапрос для очень узких (480px)', /@media \(max-width: 480px\)/.test(css));

console.log('\n[6] Синтаксис CSS сбалансирован');
const open = (css.match(/\{/g) || []).length, close = (css.match(/\}/g) || []).length;
ok(`скобки CSS сбалансированы (${open}/${close})`, open === close);

console.log(`\n✅ Все проверки пройдены: ${passed}`);
process.exit(0);
