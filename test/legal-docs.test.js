// ═══════════════════════════════════════════════════════════════════
// test/legal-docs.test.js — комплект правовых документов
//
// Что здесь проверяется и почему именно это.
//
// Прежняя версия этого теста закрепляла формулировки, которые пришлось
// убрать: безусловное «оплаченное возврату не подлежит», возраст «12
// лет» и согласие «выраженное путём регистрации». Тест был зелёным
// ровно потому, что стерёг неверные условия — и падал бы при их
// исправлении. Поэтому он переписан целиком, а не подправлен.
//
// Проверяются три вещи, которые ломаются молча:
//   1. КОМПЛЕКТНОСТЬ и СВЯЗНОСТЬ. Документ, на который никто не
//      ссылается, для игрока не существует.
//   2. ГРАНИЦА ПУБЛИЧНОСТИ. Внутренние акты содержат матрицу доступа и
//      порядок реагирования на инциденты. В public/ им не место.
//   3. ФАКТИЧЕСКАЯ ПРАВДА. Документ называет получателей персональных
//      данных. Названный не тот сервис — это не опечатка, а неверное
//      заявление об обработке.
//
// Запуск: node test/legal-docs.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

// Публичные документы: файл → что в нём обязано быть по существу
const PUBLIC_DOCS = {
  'terms.html': 'Пользовательское соглашение',
  'rules.html': 'Правила игры и модерации',
  'payments.html': 'Правила платежей и возвратов',
  'privacy.html': 'Политика обработки персональных данных',
  'cookies.html': 'Политика cookie',
  'consent-pdn.html': 'Согласие на обработку персональных данных',
  'consent-public.html': 'Согласие на распространение персональных данных',
  'consent-ads.html': 'Согласие на рекламные',
  'unsubscribe.html': 'Отписка от рассылки',
};

console.log('\n── 1. Комплект на месте ──');
for (const [f, must] of Object.entries(PUBLIC_DOCS)) {
  const exists = fs.existsSync(path.join(PUB, f));
  ok(exists, `${f} существует`);
  if (!exists) continue;
  const t = read(f);
  ok(t.includes(must), `${f}: это действительно «${must}»`);
  ok(/<html lang="ru">/.test(t), `${f}: язык указан`);
  ok(/<meta name="viewport"/.test(t), `${f}: читается с телефона`);
}

console.log('\n── 2. Две точки входа, остальное — ссылками ──');
// Владелец просил не выкладывать одиннадцать документов столбиком.
// В подвале ровно два адреса, всё прочее достижимо из них.
const index = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const footer = (index.match(/<footer[\s\S]*?<\/footer>/) || [''])[0];
const footerDocs = (footer.match(/href="\/[a-z-]+\.html"/g) || []);
ok(footerDocs.length === 2, `в подвале ровно две ссылки на документы (${footerDocs.length})`);
ok(/href="\/terms\.html"/.test(footer), 'первая — Пользовательское соглашение');
ok(/href="\/privacy\.html"/.test(footer), 'вторая — Политика обработки ПДн');

const terms = read('terms.html');
const privacy = read('privacy.html');
// Из двух точек входа должно быть достижимо всё остальное — иначе
// документ формально опубликован, а найти его нельзя.
const reachable = new Set(['terms.html', 'privacy.html']);
for (const src of [terms, privacy]) {
  for (const m of src.matchAll(/href="\/([a-z-]+\.html)"/g)) reachable.add(m[1]);
}
for (const f of Object.keys(PUBLIC_DOCS)) {
  if (f === 'unsubscribe.html') continue;   // адрес приходит в письме, ссылка на сайте не нужна
  ok(reachable.has(f), `${f} достижим из соглашения или политики`);
}

console.log('\n── 3. Внутренние документы не опубликованы ──');
// Матрица доступа, контакты ответственных и порядок реагирования на
// инциденты — сведения, облегчающие обход защиты. Публиковать их нельзя.
const INTERNAL = ['09-положение-об-обработке-ПДн.md', '10-план-реагирования-на-инциденты.md',
  '11-перечень-сроков-хранения.md'];
for (const f of INTERNAL) {
  ok(fs.existsSync(path.join(ROOT, 'docs/внутренние', f)), `${f} лежит в docs/внутренние`);
}
const pubFiles = fs.readdirSync(PUB);
ok(!pubFiles.some((f) => /положение|инцидент|перечень-сроков/i.test(f)),
   'ни один внутренний акт не попал в public/');
const inc = fs.readFileSync(path.join(ROOT, 'docs/внутренние/10-план-реагирования-на-инциденты.md'), 'utf8');
ok(/ВНУТРЕННИЙ ДОКУМЕНТ/.test(inc), 'внутренние помечены прямо в тексте, чтобы не выложили по ошибке');

console.log('\n── 4. Убранные условия не вернулись ──');
// Безусловный отказ от возврата — ничтожное условие: закон о защите
// прав потребителей его не признаёт, а в документе оно означает
// публично обещанные игрокам условия хуже законных.
ok(!/возврату не подлежит/i.test(terms) && !/возврату не подлежит/i.test(read('payments.html')),
   'безусловного «возврату не подлежит» больше нет');
ok(/абсолютного запрета возврата нет|Безусловного запрета возврата нет/i.test(read('payments.html')),
   'вместо него сказано прямо: безусловного запрета нет');
ok(!/12 лет/.test(terms) && !/12 лет/.test(privacy), 'старое ограничение «12 лет» убрано');
ok(/18 лет/.test(terms) && /18 лет/.test(privacy), 'действует ограничение 18+');
// Молчаливое согласие регистрацией — ровно та модель, которую новые
// документы сами запрещают.
ok(!/выраженное путём регистрации/i.test(privacy),
   'согласие больше не «выражается регистрацией»');
ok(/отдельн/i.test(privacy) && /согласие/i.test(privacy), 'согласия оформляются отдельно');

console.log('\n── 5. Получатели данных названы верно ──');
// Документ называет, кому уходят персональные данные. Названный не тот
// сервис — неверное заявление об обработке, а не опечатка.
for (const f of Object.keys(PUBLIC_DOCS)) {
  const t = read(f);
  ok(!/unisender/i.test(t), `${f}: прежнего почтового сервиса нет`);
  ok(!/resend/i.test(t), `${f}: зарубежного сервиса нет`);
}
ok(/SMTP\.BZ/.test(privacy), 'политика называет действующий почтовый сервис');
ok(/не осуществляется/.test(privacy) && /пределы Российской Федерации/.test(privacy),
   'сказано, что трансграничной передачи нет');
ok(!/mongodb|Atlas/i.test(privacy), 'облачной базы в политике не заявлено');

console.log('\n── 6. Реквизиты заполняются в одном месте ──');
// Одиннадцать значений повторялись в каждом документе — так их не
// заполняют, а заполнив, не поддерживают.
const legal = fs.readFileSync(path.join(PUB, 'js/legal.js'), 'utf8');
ok(/var LEGAL = \{/.test(legal), 'есть единый объект с данными Оператора');
for (const key of ['operator', 'inn', 'address', 'mailSupport', 'mailPayments', 'mailPrivacy', 'redaction']) {
  ok(new RegExp(key + ':').test(legal), `в нём есть ${key}`);
}
ok(/doc-fill/.test(legal), 'незаполненное подсвечивается красным прямо на странице');
for (const f of Object.keys(PUBLIC_DOCS)) {
  if (f === 'unsubscribe.html') continue;
  const t = read(f);
  ok(t.includes('/js/legal.js'), `${f} берёт реквизиты оттуда`);
  ok(t.includes('id="legal-req"'), `${f}: блок реквизитов на месте`);
}
// Разъехавшиеся реквизиты — худший вид ошибки: документ начинает
// противоречить сам себе, и заметить это можно только сверкой всех
// файлов подряд.
let hardcoded = 0;
for (const f of Object.keys(PUBLIC_DOCS)) {
  if (/ИНН\s*\d{10}/.test(read(f))) hardcoded++;
}
ok(hardcoded === 0, 'ни в одном документе реквизиты не вписаны намертво');

console.log('\n── 7. Короткие адреса ──');
const http = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
ok(/SHORT_DOCS/.test(http), 'короткие адреса документов заданы списком');
for (const short of ['terms', 'rules', 'payments', 'privacy', 'cookies']) {
  ok(new RegExp(`${short}: '`).test(http), `/${short} открывается без .html`);
}
// Открытый список позволил бы дописывать .html к любому пути и
// вытаскивать файлы, для показа не предназначенные.
ok(/Список закрытый/.test(http), 'список закрытый — и это объяснено в коде');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
