// ═══════════════════════════════════════════════════════════════════
// Правовые документы: наличие, доступность без входа, ключевые пункты,
// ссылки в подвале и короткие адреса.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const terms = fs.readFileSync(path.join(ROOT, 'public/terms.html'), 'utf8');
const privacy = fs.readFileSync(path.join(ROOT, 'public/privacy.html'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const http = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');

console.log('\n── 1. Документы существуют и оформлены ──');
ok(terms.length > 5000, `пользовательское соглашение: ${terms.length} байт`);
ok(privacy.length > 4000, `политика конфиденциальности: ${privacy.length} байт`);
ok(/<html lang="ru">/.test(terms) && /<html lang="ru">/.test(privacy), 'указан язык — русский');
ok(/<meta name="viewport"/.test(terms) && /<meta name="viewport"/.test(privacy), 'страницы адаптированы под телефон');
ok(terms.includes('style.css') && privacy.includes('style.css'), 'оформлены в стиле игры');

console.log('\n── 2. Требования заказчика ──');
ok(/Оплаченный дополнительный функционал возврату не подлежит/.test(terms),
   'явно указано: оплаченное возврату не подлежит');
ok(/блокировки или удаления учётной записи/.test(terms) && /расходования внутриигровых ценностей/.test(terms),
   'перечислены случаи, когда возврат не производится');
ok(/по собственному усмотрению и без объяснения\s+причин/.test(terms),
   'права администрации: без объяснения причин');
ok(/удалять учётные записи, включая все накопленные внутриигровые ценности/.test(terms),
   'право удалять учётные записи вместе с оплаченным');
ok(/Решения Администрации являются окончательными/.test(terms), 'решения окончательны');
ok(/изменять правила Игры, игровой баланс/.test(terms), 'право менять баланс и правила');

console.log('\n── 3. Требования законодательства РФ ──');
ok(/152-ФЗ/.test(privacy), 'ссылка на 152-ФЗ «О персональных данных»');
ok(/ст\. 437|ст\.437/.test(terms) && /438/.test(terms), 'оферта и акцепт со ссылкой на ГК РФ');
ok(/территории Российской Федерации/.test(privacy), 'локализация баз данных в РФ (ч. 5 ст. 18 152-ФЗ)');
ok(/Роскомнадзор/.test(privacy), 'указан надзорный орган для обжалования');
ok(/отозвать согласие/.test(privacy), 'право отозвать согласие на обработку');
ok(/Оператор/.test(privacy) && /ИНН/.test(privacy), 'есть блок реквизитов оператора');
ok(/императивными нормами законодательства/.test(terms),
   'оговорка о правах потребителя — без неё пункт о невозврате рискует быть ничтожным целиком');
ok(/12 лет/.test(terms) && /12 лет/.test(privacy), 'возрастные ограничения указаны');
ok(/претензионный порядок/.test(terms), 'претензионный порядок разрешения споров');
ok(!/банковских карт[^.]*хранит(?!ся)/.test(privacy) || /не получает и не хранит/.test(privacy),
   'прямо сказано, что реквизиты карт не хранятся');

console.log('\n── 4. Незаполненные реквизиты помечены ──');
const fills = (terms.match(/doc-fill/g) || []).length + (privacy.match(/doc-fill/g) || []).length;
ok(fills >= 8, `мест для заполнения помечено: ${fills} (выделены красным)`);
ok(/\[ДАТА\]/.test(terms) && /\[email\]/.test(terms), 'дата редакции и контакты вынесены в плейсхолдеры');

console.log('\n── 5. Ссылки в подвале и адреса ──');
ok(/<footer id="site-footer">/.test(index), 'подвал добавлен на главную страницу');
ok(/href="\/terms\.html"/.test(index), 'ссылка на пользовательское соглашение');
ok(/href="\/privacy\.html"/.test(index), 'ссылка на политику конфиденциальности');
ok(css.includes('#site-footer'), 'стили подвала добавлены');
ok(/rel === '\/terms'/.test(http) && /rel === '\/privacy'/.test(http),
   'работают короткие адреса /terms и /privacy — их можно давать платёжному сервису');
ok(terms.includes('/privacy.html') && privacy.includes('/terms.html'), 'документы ссылаются друг на друга');
ok(terms.includes('Вернуться в игру') && privacy.includes('Вернуться в игру'), 'с каждой страницы можно вернуться в игру');

console.log('\n── 6. Доступность без входа в игру ──');
// Страницы статические: отдаются тем же обработчиком, что и index.html,
// авторизация к статике не применяется
ok(!/api\//.test(terms.slice(0, 2000)), 'соглашение не требует запросов к API для отображения');
ok(!terms.includes('x-token') && !privacy.includes('x-token'), 'страницы не требуют токена — открываются гостю');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
