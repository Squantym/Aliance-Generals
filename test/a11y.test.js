// ═══════════════════════════════════════════════════════════════════
// Доступность модальных окон и клавиатуры.
//
// Зачем это не косметика: сотрудник, работающий с клавиатуры, раньше
// не мог пользоваться панелью. Tab уводил фокус на страницу ПОД окном,
// диктор не объявлял, что окно вообще открылось, а после закрытия фокус
// терялся в начале документа — человек каждый раз искал своё место
// заново. Плюс результат действия жил 1,8 секунды и только визуально.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const dom = new JSDOM('<!DOCTYPE html><body><div id="toasts"></div>' +
  '<button id="src">откуда открыли</button><div id="content"></div></body>', { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
const load = (f, n) => eval(fs.readFileSync(path.join(ROOT, f), 'utf8') + ';' + n);
const UI = load('public/js/ui.js', 'UI');
global.UI = UI;
global.API = load('public/js/api.js', 'API');
global.App = {};
const Admin = load('public/js/admin.js', 'Admin');
global.Admin = Admin;

async function main() {
console.log('\n── 1. Окно подтверждения объявляется как окно ──');
const src = document.getElementById('src');
src.focus();
const p1 = UI.confirm('Точно?', { title: 'Проверка' });
let dlg = document.querySelector('.game-dialog');
ok(dlg.getAttribute('role') === 'dialog', 'role=dialog проставлен');
ok(dlg.getAttribute('aria-modal') === 'true', 'aria-modal=true');
ok(dlg.getAttribute('aria-label') === 'Проверка', 'у окна есть название для диктора');
ok(document.activeElement.id === 'gd-ok', 'фокус переведён внутрь окна');

console.log('\n── 2. Tab не уходит из окна ──');
const overlay = document.getElementById('game-dialog');
const listFocusable = () => Array.from(dlg.querySelectorAll('button, input, textarea, select'));
ok(listFocusable().length >= 2, `внутри окна элементов для обхода: ${listFocusable().length}`);
// Tab с последнего элемента должен вернуть на первый, а не уйти на страницу
const items = listFocusable();
items[items.length - 1].focus();
const ev = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
overlay.dispatchEvent(ev);
ok(ev.defaultPrevented, 'уход за пределы окна перехвачен');
ok(document.activeElement === items[0], 'фокус вернулся на первый элемент окна');
// Shift+Tab с первого — на последний
const ev2 = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
overlay.dispatchEvent(ev2);
ok(document.activeElement === items[items.length - 1], 'Shift+Tab с первого уводит на последний');

console.log('\n── 3. После закрытия фокус возвращается ──');
document.getElementById('gd-cancel').click();
ok((await p1) === false, 'окно вернуло ответ');
ok(document.activeElement.id === 'src', 'фокус вернулся туда, откуда окно открыли');

console.log('\n── 4. Окно ввода — то же самое ──');
src.focus();
const p2 = UI.prompt('Причина?', { title: 'Комментарий' });
dlg = document.querySelector('.game-dialog');
ok(dlg.getAttribute('role') === 'dialog' && dlg.getAttribute('aria-modal') === 'true',
   'окно ввода тоже объявлено как модальное');
ok(dlg.getAttribute('aria-label') === 'Комментарий', 'и названо');
document.getElementById('gd-cancel').click();
await p2;
ok(document.activeElement.id === 'src', 'фокус вернулся');

console.log('\n── 5. Окно необратимого действия ──');
src.focus();
const p3 = Admin.danger({ title: 'Стереть легионы', what: 'Всё пропадёт', word: 'СТЕРЕТЬ' });
dlg = document.querySelector('.game-dialog');
ok(dlg.getAttribute('role') === 'dialog', 'самое опасное окно тоже доступно с клавиатуры');
ok(dlg.getAttribute('aria-label') === 'Стереть легионы', 'и объявляет, что именно произойдёт');
document.getElementById('dg-cancel').click();
ok((await p3) === false, 'отмена работает');
ok(document.activeElement.id === 'src', 'фокус вернулся');

console.log('\n── 6. Результат действия слышен, а не только виден ──');
UI.toast('Выдано игроку');
const box = document.getElementById('toasts');
ok(box.getAttribute('aria-live') === 'polite', 'область тостов объявляется диктором');
ok(box.getAttribute('role') === 'status', 'и помечена как статус');
ok(box.getAttribute('aria-atomic') === 'true', 'сообщение читается целиком');
ok(box.textContent.includes('Выдано игроку'), 'текст на месте');

console.log('\n── 7. Видимый фокус в стилях ──');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(/:focus-visible\s*\{/.test(css), 'обводка фокуса для клавиатуры задана');
ok(/\.game-dialog :focus-visible/.test(css), 'в модальных окнах она поконтрастнее');
ok(/при клике мышью она не появляется/.test(css), 'объяснено, почему focus-visible, а не focus');
ok(/\[role="button"\]/.test(css), 'элементы-кнопки без тега button тоже учтены');


console.log('\n── 8. Браузерных окон в проекте не осталось ──');
// confirm()/alert()/prompt() выглядят как окна операционной системы,
// подтверждаются случайным Enter и не объясняют последствий. В панели
// их вычистили раньше; последними были два в бою — растяжка.
const frontFiles = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.js')) frontFiles.push(p);
  }
})(path.join(ROOT, 'public/js'));
const nativeDialog = [];
for (const f of frontFiles) {
  // Комментарии вырезаем: в них это слово встречается как раз там, где
  // объясняется, почему нативного окна больше нет.
  const src = fs.readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  // Считаем только настоящие вызовы: UI.confirm и определение самой
  // функции в ui.js не в счёт.
  const hits = (src.match(/(^|[^.\w])(confirm|alert|prompt)\s*\(/g) || [])
    .filter((h) => !/\.(confirm|alert|prompt)/.test(h));
  const own = /public\/js\/ui\.js$/.test(f.replace(/\\/g, '/'));
  if (hits.length && !own) nativeDialog.push(path.relative(ROOT, f) + ' ×' + hits.length);
}
ok(nativeDialog.length === 0,
   `нативных окон нет ни в одном из ${frontFiles.length} файлов фронтенда`
   + (nativeDialog.length ? ' — найдены: ' + nativeDialog.join(', ') : ''));

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
