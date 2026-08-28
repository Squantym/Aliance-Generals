// ═══════════════════════════════════════════════════════════════════
// Сборка единственной SPF-записи домена.
//
// Зачем отдельный тест. Каждый почтовый сервис при подключении просит
// «добавьте TXT-запись SPF». Если добавить её как новую — в домене
// окажется ДВЕ записи SPF, а это по стандарту ошибка: почтовики
// перестают проходить проверку по ВСЕМ письмам сразу, включая те, что
// уходили годами. Ломается не новый сервис, а вся почта домена.
//
// Поэтому проверка не просто ругается на дубль, а печатает готовую
// объединённую строку. Здесь проверяется именно она — вызовом настоящей
// функции, без похода в DNS.
//
// Живёт функция в src/services/maildns.ts: одно место на панель
// («Письма» → «Проверить домен») и на tools/check-dns.js. Два списка
// требуемых записей разъехались бы, и панель с инструментом начали бы
// говорить владельцу разное.
// ═══════════════════════════════════════════════════════════════════
const path = require('path');
const { mergedSpf, PROVIDERS } = require(path.join(__dirname, '..', 'dist', 'src', 'services', 'maildns.js'));

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const INC = PROVIDERS.map((p) => p.spf);
const count = (s, re) => (s.match(re) || []).length;

console.log('\n── 1. Список сервисов ──');
ok(PROVIDERS.length === 1 && PROVIDERS[0].id === 'smtpbz', 'сервис один — SMTP.BZ');
const bz = PROVIDERS[0];
ok(bz.spf === 'include:spf.smtp.bz', 'его SPF известен проверке');
ok(bz.dkim[0] === 'smtpbz', 'селектор DKIM — smtpbz._domainkey');
ok(!!bz.cname && bz.cname.name === 'stats' && bz.cname.value === 'smtp.bz',
   'знает про CNAME stats → smtp.bz');
ok(!/\u0055nisender/i.test(JSON.stringify(PROVIDERS)), 'прежнего сервиса в требованиях не осталось');

console.log('\n── 2. Домен без SPF ──');
const fresh = mergedSpf('', INC);
ok(/^v=spf1 /.test(fresh), 'строка начинается с v=spf1');
ok(/ ~all$/.test(fresh), 'заканчивается на ~all');
ok(INC.every((i) => fresh.includes(i)), `оба сервиса внутри: ${fresh}`);

console.log('\n── 3. Уже есть чужая запись ──');
// Ровно ситуация владельца: в зоне лежит SPF от прежнего сервиса, а
// новый просит добавить свою рядом. Добавить — сломать почту домена.
const wasOld = 'v=spf1 include:spf.example-mail.ru ~all';
const merged = mergedSpf(wasOld, INC);
ok(count(merged, /v=spf1/gi) === 1, 'v=spf1 остаётся один — иначе запись невалидна');
ok(count(merged, /~all|[-+?]all/gi) === 1, 'all ровно один');
ok(merged.includes('include:spf.example-mail.ru'), 'старая запись не выброшена');
ok(merged.includes('include:spf.smtp.bz'), 'новый добавлен');
ok(merged.trim().endsWith('~all'), `all стоит последним — всё после него игнорируется: ${merged}`);

console.log('\n── 4. Чужие механизмы сохраняются ──');
// Если владелец шлёт почту ещё и с самого сервера (a) или через
// почтовик домена (mx), выбросив их мы сломаем ту почту.
const rich = mergedSpf('v=spf1 a mx ip4:5.6.7.8 include:_spf.yandex.net ~all', INC);
ok(rich.includes(' a ') && rich.includes(' mx '), 'a и mx на месте');
ok(rich.includes('ip4:5.6.7.8'), 'прямой адрес сервера сохранён');
ok(rich.includes('include:_spf.yandex.net'), 'сторонний include сохранён');
ok(count(rich, /v=spf1/gi) === 1 && count(rich, /all/gi) === 1, 'структура не сломана');
// Правило SPF: не больше 10 DNS-запросов, иначе permerror и провал
// проверки. Считаем: a, mx и каждый include.
const lookups = (rich.match(/(^|\s)(a|mx)(\s|$)|include:/g) || []).length;
ok(lookups <= 10, `запросов DNS в записи ${lookups} — предел 10`);

console.log('\n── 5. Повторный прогон ничего не портит ──');
const twice = mergedSpf(merged, INC);
ok(twice === merged, 'объединение уже объединённого не меняет строку');
ok(count(twice, /include:spf\.smtp\.bz/g) === 1, 'дубликата include не появилось');

console.log('\n── 6. Мелочи регистра и мусора ──');
const upper = mergedSpf('v=SPF1 INCLUDE:SPF.SMTP.BZ -all', INC);
ok(count(upper, /include:spf\.smtp\.bz/gi) === 1, 'тот же include в другом регистре не задваивается');
ok(count(upper, /all/gi) === 1, 'старый -all не остался вторым');
const spaced = mergedSpf('v=spf1    include:spf.example-mail.ru    ~all', INC);
ok(!/\s{2,}/.test(spaced), 'лишние пробелы вычищены');
ok(spaced.includes('include:spf.smtp.bz'), 'и при кривых пробелах сервис добавлен');

console.log('\n── 7. Запись из кабинета SMTP.BZ ──');
// Дословно то, что сервис показывает в инструкции по подтверждению.
const asked = 'v=spf1 a mx include:spf.smtp.bz ~all';
const final = mergedSpf(asked, INC);
ok(final === 'v=spf1 a mx include:spf.smtp.bz ~all',
   `итоговая строка для домена: ${final}`);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
