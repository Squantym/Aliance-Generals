// ═══════════════════════════════════════════════════════════════════
// Компактность панели: меньше вкладок, выдача ресурсов раскрывается
// под игроком, база данных свёрнута в блок вместо отдельной вкладки.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const adminJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');

console.log('\n── 1. Вкладок стало меньше ──');
const tabsBlock = /const tabs = \[([\s\S]*?)\];/.exec(adminJs)[1];
const count = (tabsBlock.match(/id:'/g) || []).length;
ok(count === 11, `вкладок в панели: ${count} (было 14)`);
ok(/id:'econ'/.test(tabsBlock), 'экономические разделы объединены во вкладку «Экономика»');
for (const gone of ["id:'tools'", "id:'mercs'", "id:'discounts'", "id:'buffs'", "id:'db'"]) {
  ok(!tabsBlock.includes(gone), `отдельной вкладки ${gone} больше нет`);
}
ok(/renderEcon\(c\)/.test(adminJs), 'у «Экономики» свой экран с подвкладками');
ok(/data-econ=/.test(adminJs), 'подвкладки переключаются');
ok(/\]\.filter\(\(x\) => Admin\.can\(x\.zone\)\)/.test(adminJs),
   'недоступные подвкладки скрыты — акции отдельно от остального');

console.log('\n── 2. Выдача раскрывается под игроком ──');
ok(/class="grant-row" id="grant-row-\$\{p\.id\}"/.test(adminJs),
   'под каждой строкой игрока есть место для формы');
ok(/toggleGrantRow/.test(adminJs), 'форма открывается по кнопке рядом с игроком');
ok(/document\.querySelectorAll\('\.grant-row'\)\.forEach/.test(adminJs),
   'открытая форма всегда одна — прочие закрываются');
ok(/btn\.classList\.add\('btn-green'\)/.test(adminJs), 'кнопка выбранного игрока подсвечивается');
ok(/renderGrantForm\(p, target\)/.test(adminJs) || /renderGrantForm\(p, cell\)/.test(adminJs),
   'форма рисуется в переданное место, а не в конец страницы');

console.log('\n── 3. Форма компактнее ──');
const formStart = adminJs.indexOf('renderGrantForm(p, target)');
const form = adminJs.slice(formStart, formStart + 4200);
ok(/grant-grid/.test(form), 'поля выстроены сеткой');
ok(/details class="grant-more"/.test(form), 'редкие поля (уровень, ресурсы, банк) убраны под раскрытие');
ok(/grant-quick/.test(form), 'есть кнопки быстрых сумм');
ok(/data-q="gold:100"/.test(form) && /data-q="dollars:1000000"/.test(form),
   'быстрые суммы для золота и денег');
ok(/data-q="clear"/.test(form), 'и сброс введённого');
ok(/g-rw-toggle/.test(form), 'блок награды письмом скрыт до нажатия');
ok(!/Или отправить наградой-письмом \(игрок заберёт сам/.test(form),
   'длинное пояснение убрано — оно занимало треть формы');

console.log('\n── 4. База данных — блок вместо вкладки ──');
ok(/renderDbBlock/.test(adminJs), 'есть компактный блок базы');
ok(!/async renderDb\(c\)/.test(adminJs), 'прежняя вкладка удалена');
const dbStart = adminJs.indexOf('async renderDbBlock()');
const dbEnd = adminJs.indexOf('\n  renderTech(c) {', dbStart);
const dbBlock = adminJs.slice(dbStart, dbEnd > 0 ? dbEnd : dbStart + 4000);
ok(dbBlock.split('\n').length < 80, `блок ужат до ${dbBlock.split('\n').length} строк (было 118)`);
ok(/id="db-block"/.test(adminJs), 'блок живёт внутри вкладки «Техника»');
ok(/Admin\.can\('database'\)/.test(dbBlock), 'виден только при праве на базу');
ok(/db-backup/.test(dbBlock), 'кнопка копии осталась');
ok(/data-restore/.test(dbBlock), 'откат из снимка остался');
ok(/Копии создаются сами каждые 6 часов/.test(dbBlock),
   'объяснено, что копии делаются автоматически — кнопка нужна редко');

console.log('\n── 5. Оформление ──');
ok(/#tab-content \.card \{ padding: 11px 13px/.test(css), 'карточки панели ужаты');
ok(css.includes('.grant-panel'), 'стили формы выдачи добавлены');
ok(/\.grant-grid \{[\s\S]{0,140}minmax\(110px/.test(css), 'поля выдачи выстроены плотной сеткой');
ok(css.includes('.db-line'), 'блок базы оформлен одной строкой');
ok(/@media \(max-width: 480px\)[\s\S]{0,200}grant-grid/.test(css), 'на телефоне форма перестраивается');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
