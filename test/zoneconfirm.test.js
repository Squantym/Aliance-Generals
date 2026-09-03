// ═══════════════════════════════════════════════════════════════════
// test/zoneconfirm.test.js — опасные разделы выдаются с подтверждением
//
// Роли настраиваются галочками, и по умолчанию у сотрудников НЕТ ничего:
// всё выдаёт владелец явно. Значит единственная защита от «выдал больше,
// чем думал» — честный вопрос в момент нажатия.
//
// Он есть, но список опасных разделов — обычный объект в разметке, и
// новую зону в него легко не добавить. Тогда галочка, открывающая
// удаление аккаунтов или доступ к персональным данным, ставится молча.
//
// Этот тест сверяет два списка: зоны, объявленные в roles.ts, и те, для
// которых панель спрашивает подтверждение. Безобидные перечислены здесь
// поимённо — чтобы добавить зону в «безобидные» пришлось осознанно, а
// не забыв про подтверждение.
//
// Запуск: node test/zoneconfirm.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const rolesSrc = fs.readFileSync(path.join(ROOT, 'src/services/roles.ts'), 'utf8');
const adminSrc = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');

console.log('\n── 1. Списки разбираются ──');
const infoBody = rolesSrc.slice(rolesSrc.indexOf('const ZONE_INFO'),
                                rolesSrc.indexOf('];', rolesSrc.indexOf('const ZONE_INFO')));
const zones = [...infoBody.matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);
ok(`зоны найдены (${zones.length})`, zones.length >= 10);

const dangBody = adminSrc.slice(adminSrc.indexOf('const DANGEROUS = {'),
                                adminSrc.indexOf('};', adminSrc.indexOf('const DANGEROUS = {')));
const dangerous = [...dangBody.matchAll(/^\s*([a-z]+)\s*:/gm)].map((m) => m[1]);
ok(`опасные зоны найдены (${dangerous.length})`, dangerous.length >= 5);

console.log('\n── 2. Каждая зона либо спрашивает, либо признана безобидной ──');
// Безобидные — те, что не дают власти над людьми, деньгами и данными.
// Список нарочно поимённый: новая зона по умолчанию считается опасной,
// и тест заставит либо добавить подтверждение, либо явно решить иначе.
const HARMLESS = new Set([
  'chat',      // блокировка чата — мера мягкая и обратимая
  'forum',     // то же для форума
  'support',   // ответы на обращения
  'legions',   // управление легионами и турнирами
  'news',      // публикация новостей
  'event',     // запуск мирового события
  'analytics', // только просмотр сводок, без персональных данных
]);
// База данных не выдаётся никому — подтверждать нечего.
const NEVER_GRANTED = new Set(
  [...rolesSrc.matchAll(/OWNER_ONLY_ZONES:\s*Zone\[\]\s*=\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])));
ok(`зоны, не выдаваемые никому: ${[...NEVER_GRANTED].join(', ') || 'нет'}`, NEVER_GRANTED.size >= 1);

const unguarded = zones.filter((z) => !dangerous.includes(z) && !HARMLESS.has(z) && !NEVER_GRANTED.has(z));
ok(unguarded.length ? `выдаются без подтверждения: ${unguarded.join(', ')}` : 'ни одна опасная зона не выдаётся молча',
   unguarded.length === 0);

console.log('\n── 3. Подтверждение называет последствия, а не «вы уверены» ──');
// Вопрос «вы уверены?» подтверждают не читая. Полезен только тот, что
// говорит, ЧТО именно сможет делать роль.
for (const z of ['moderation', 'economy', 'players']) {
  const m = new RegExp(z + ":\\s*'([^']{20,})'").exec(dangBody);
  ok(`${z}: последствия названы словами`, !!m);
}
// Классы \w и \b в JS кириллицу НЕ покрывают: /удал\w*/ совпадёт только
// с «удал», дальше нужен латинский символ. Пишем диапазон явно — иначе
// проверка выглядит строгой, а на деле пропускает.
ok('про удаление аккаунтов сказано прямо', /удал[а-яё]* аккаунт/i.test(dangBody));
ok('про персональные данные — тоже', /адрес[а-яё]*|устройств[а-яё]*|почт[а-яё]*/i.test(dangBody));

console.log('\n── 4. Описание зоны не расходится с подтверждением ──');
// В roles.ts у «Баны аккаунтов» в описании стоит «удаление аккаунтов».
// Если подтверждение об этом молчит, владелец узнаёт о полномочии уже
// после выдачи.
const modNote = /id:\s*'moderation'[^}]*note:\s*'([^']+)'/.exec(infoBody);
ok('описание зоны «Баны аккаунтов» найдено', !!modNote);
ok('и в нём тоже сказано про удаление', !!modNote && /удал/i.test(modNote[1]));

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
