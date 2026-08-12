// ═══════════════════════════════════════════════════════════════════
// Порядок роутов. Маршрутизатор берёт ПЕРВОЕ совпадение, поэтому
// шаблон с параметром (:kind, :id) перехватывает конкретные адреса,
// объявленные после него.
//
// Так сломались улучшения: '/api/group/upgrades' попадал в
// '/api/group/:kind' и уходил в альянсы с видом «upgrades» —
// «Неизвестный тип группы».
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const src = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
// Собираем роуты в порядке объявления
const routes = [...src.matchAll(/app\.add\('(\w+)',\s*'([^']+)'/g)]
  .map((m) => ({ method: m[1], path: m[2], at: m.index }));

console.log('\n── 1. Конкретные адреса не перехватываются шаблонами ──');
const toRegex = (p) => new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/') + '$');
const shadowed = [];
for (let i = 0; i < routes.length; i++) {
  const r = routes[i];
  if (r.path.includes(':')) continue;           // сам шаблон пропускаем
  for (let j = 0; j < i; j++) {
    const earlier = routes[j];
    if (!earlier.path.includes(':')) continue;
    if (earlier.method !== r.method) continue;
    if (toRegex(earlier.path).test(r.path)) {
      shadowed.push(`${r.method} ${r.path} ← перехватывает ${earlier.path}`);
    }
  }
}
ok(shadowed.length === 0,
   shadowed.length ? `перехваченные роуты:\n     ${shadowed.join('\n     ')}`
                   : `ни один из ${routes.length} роутов не перехвачен шаблоном`);

console.log('\n── 2. Групповые бои объявлены до шаблона альянсов ──');
const gbAt = routes.find((r) => r.path === '/api/group/upgrades');
const kindAt = routes.find((r) => r.path === '/api/group/:kind');
ok(!!gbAt && !!kindAt, 'оба роута существуют');
ok(gbAt.at < kindAt.at, 'улучшения объявлены раньше шаблона :kind');
for (const p of ['/api/group/register', '/api/group/unregister', '/api/group/role',
                 '/api/group/enter', '/api/group/battle', '/api/group/act', '/api/group/upgrade']) {
  const r = routes.find((x) => x.path === p);
  ok(!!r && r.at < kindAt.at, `«${p}» не перехватывается`);
}
ok(/ВАЖНО: групповые бои объявлены ДО шаблона/.test(src),
   'в коде оставлено пояснение, чтобы порядок не сломали снова');

console.log('\n── 3. Альянсы и легионы не пострадали ──');
for (const p of ['/api/group/:kind', '/api/group/:kind/create', '/api/group/:kind/invite']) {
  ok(routes.some((r) => r.path === p), `роут групп «${p}» на месте`);
}
// Виды групп не должны совпадать с адресами боёв
const groupsSrc = fs.readFileSync(path.join(ROOT, 'src/services/groups.ts'), 'utf8');
const kinds = [...groupsSrc.matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]);
const clash = ['upgrades', 'register', 'battle', 'enter', 'act', 'role'].filter((x) => kinds.includes(x));
ok(clash.length === 0, clash.length ? `виды групп конфликтуют: ${clash}` : 'имена видов групп не пересекаются с адресами боёв');

console.log('\n── 4. Раздел улучшений не запрашивает себя по кругу ──');
const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
// Раздел вынесен на отдельную страницу: внутри витрины он мигал при
// каждом её обновлении и повторял запрос к серверу
ok(/App\.renderUpgradesPage = async/.test(war), 'улучшения — отдельная страница');
ok(!/gb-section-box/.test(war), 'внутри витрины раздела больше нет');
ok(/id="gb-up-retry"/.test(war), 'при ошибке даётся кнопка «Повторить», а не голый текст');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
