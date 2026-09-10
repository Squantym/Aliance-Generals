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

console.log('\n── 8. Новые механики описаны в документах ──');
// Механика, которой нет в документах, — это условие, о котором игрок
// не предупреждён. Особенно когда за неё берут золото.
const rules = read('rules.html');
const pay = read('payments.html');
ok(/не являются азартными играми и лотереями/.test(rules),
   'клубные игры со взносом названы прямо и отграничены от азартных');
ok(/Возврат взноса производится/.test(rules), 'сказано, когда взнос возвращается');
ok(/Наборы .спецпредложения/.test(pay), 'наборы описаны в правилах платежей');
ok(/начислен <b>весь<\/b> его состав/.test(pay), 'набор считается выданным только целиком');
ok(/Перечёркнутая цена — цена, фактически действовавшая/.test(pay),
   'перечёркнутая цена обязана быть настоящей — иначе это недостоверная реклама');
ok(/может удаляться раньше по решению Оператора/.test(read('privacy.html')),
   'досрочная очистка журнала предусмотрена политикой');
ok(/Служебные начисления Оператора/.test(pay),
   'служебная выдача отнесена к бонусному золоту — она не увеличивает возвращаемое');

console.log('\n── 9. Памятки владельца: есть, не опубликованы, ссылки живые ──');
const SHEET = 'docs/ЮРИДИЧЕСКАЯ-ШПАРГАЛКА.md';
const FILL = 'docs/ЗАПОЛНИТЬ-ПЕРЕД-ЗАПУСКОМ.md';
ok(fs.existsSync(path.join(ROOT, SHEET)), 'шпаргалка на месте');
ok(fs.existsSync(path.join(ROOT, FILL)), 'список к заполнению на месте');
ok(!fs.existsSync(path.join(PUB, 'ЮРИДИЧЕСКАЯ-ШПАРГАЛКА.md')), 'шпаргалка не выложена игрокам');
// Шпаргалка ссылается на пункты документов. Разделы уже сдвигались при
// дополнении — ссылка на несуществующий пункт хуже её отсутствия:
// владелец покажет её игроку и потеряет лицо.
const sheet = fs.readFileSync(path.join(ROOT, SHEET), 'utf8');
const DOCTEXT = { 'Платежи': pay, 'Правила': rules, 'Соглашение': terms, 'ПДн': privacy };
const refRe = new RegExp('`(Платежи|Правила|Соглашение|ПДн) ([0-9]+(?:\\.[0-9]+)*)', 'g');
const refs = [...sheet.matchAll(refRe)];
ok(refs.length >= 20, `ссылок на пункты в шпаргалке: ${refs.length}`);
let deadRefs = [];
for (const r of refs) {
  const body = DOCTEXT[r[1]].replace(/<[^>]*>/g, ' ');
  const pat = new RegExp('(^|[^0-9])' + r[2].split('.').join('\\.') + '[.\\s]');
  if (!pat.test(body)) deadRefs.push(r[1] + ' ' + r[2]);
}
ok(deadRefs.length === 0, `все ссылки указывают на существующие пункты${deadRefs.length ? ': нет ' + deadRefs.join(', ') : ''}`);
console.log('── 10. Документы готовы к модерации платёжного сервиса ──');
// Модератор эквайера открывает документы как посторонний человек. Красная
// подсказка на месте ИНН или цена, которую видно только после входа в
// игру, — отказ в подключении.
const WS = new RegExp(String.fromCharCode(92) + 's+', 'g');
const legalSrc = read('js/legal.js');
const legalBlock = legalSrc.slice(legalSrc.indexOf('var LEGAL = {'), legalSrc.indexOf('var HINT'));
const emptyKeys = legalBlock.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => /^[a-zA-Z]+: '',/.test(l)).map((l) => l.split(':')[0]);
ok(emptyKeys.length === 0, `в LEGAL не осталось пустых значений${emptyKeys.length ? ': ' + emptyKeys.join(', ') : ''}`);
ok(/phone: '[^']+'/.test(legalBlock), 'телефон для связи указан');
ok(legalSrc.includes('<tr><th>Телефон</th>'), 'и выводится в блоке реквизитов каждого документа');

// Проверка по отрисованной странице, а не по исходнику: подсказка
// появляется только когда legal.js реально подставил значения.
const { JSDOM } = require('jsdom');
for (const f of ['terms.html', 'rules.html', 'payments.html', 'privacy.html', 'cookies.html',
                 'consent-pdn.html', 'consent-public.html', 'consent-ads.html']) {
  const dom = new JSDOM(read(f), { runScripts: 'outside-only' });
  dom.window.eval(legalSrc);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const holes = dom.window.document.querySelectorAll('.doc-fill').length;
  ok(holes === 0, `${f}: на странице нет незаполненных реквизитов${holes ? ' (пропусков: ' + holes + ')' : ''}`);
}

const payDoc = read('payments.html');
const payFlat = payDoc.replace(WS, ' ');
ok(!/Платежи пока не запущены/.test(payDoc) && !/приём платежей в Игре не запущен/.test(terms),
   'плашки «платежи не запущены» заменены на «подключается»');
// Цены пакетов публикуются для любого посетителя и обязаны совпадать с
// тем, что продаёт игра: иначе цена в оферте и цена при оплате разойдутся.
const PK = require(path.join(ROOT, 'dist/src/services/payments')).packages().packages;
const table = payDoc.slice(payDoc.indexOf('2.6.'), payDoc.indexOf('2.7.'));
ok(table.split('<tr><td>').length - 1 === PK.length, `в таблице цен ровно ${PK.length} пакета`);
for (const p of PK) {
  const row = '<tr><td>' + p.label + (p.bonus ? ' (' + p.bonus + ')' : '') + '</td><td>' + p.gold + '</td><td>' + p.priceRub + ' ₽</td></tr>';
  ok(table.includes(row), `пакет «${p.label}» опубликован по цене игры: ${p.priceRub} ₽`);
}
const VIP = require(path.join(ROOT, 'dist/src/services/vip'));
ok(payFlat.includes(VIP.PRICE_GOLD + ' Золота за ' + VIP.PRICE_DAYS + ' дней'),
   `цена VIP в документе совпадает с игрой: ${VIP.PRICE_GOLD} за ${VIP.PRICE_DAYS} дней`);
ok(/Налог на профессиональный доход/.test(payDoc) && /Мой налог/.test(payDoc),
   'раздел чеков описывает режим самозанятого');
ok(!/кассовой моделью/.test(payDoc), 'кассовых терминов 54-ФЗ в нём не осталось');
// Номер редакции на странице и версия в согласиях — одна и та же цифра.
// Разойдутся — игрок увидит «редакция 1.1», а спрашивать его не станут.
const DOCS = require(path.join(ROOT, 'dist/src/services/consent')).DOCS;
const redaction = (legalBlock.match(/redaction: '([^']+)'/) || [])[1];
ok(DOCS.terms.v === redaction, `редакция на странице (${redaction}) совпадает с версией соглашения в согласиях (${DOCS.terms.v})`);
const priv = read('privacy.html');
ok(!priv.includes('текст уведомления</td>') && /текст сервису доставки недоступен/.test(priv),
   'push-сети не названы получателями текста уведомлений');
ok(!/шифрование резервных копий, вывозимых/.test(priv), 'политика не обещает шифрование несуществующего вывоза копий');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
