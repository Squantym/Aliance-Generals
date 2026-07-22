// Правки:
// (1) в санкциях видно, КТО объявил охоту (имя при одном заказчике,
//     кликабельный список при нескольких);
// (2) фраза босса после атаки не перебивается перерисовкой;
// (3) иконки диверсантов: ×3 в разделе, мелкие в окне боя.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const sanctions = require('../dist/src/services/sanctions');
const ROOT = process.cwd();
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Заказчик1', 'password1', 'z1@a.com', 'ru', '1.1.1.1');
  await auth.register('Заказчик2', 'password1', 'z2@a.com', 'ru', '1.1.1.2');
  await auth.register('Жертва', 'password1', 'v@a.com', 'ru', '1.1.1.3');
  const z1 = Object.values(player.users()).find(x => x.name === 'Заказчик1');
  const z2 = Object.values(player.users()).find(x => x.name === 'Заказчик2');
  const v  = Object.values(player.users()).find(x => x.name === 'Жертва');
  [z1, z2, v].forEach(p => { p.level = 50; p.dollars = 1e12; });
  // Жертва отрезала уши обоим — иначе санкцию объявить нельзя
  z1.earCutters = [{ id: v.id, name: v.name }];
  z2.earCutters = [{ id: v.id, name: v.name }];

  console.log('\n[1] Один заказчик — его имя видно в списке');
  sanctions.declare(z1, v.id, 1e6, []);
  let l = sanctions.list(z1).sanctions.find(s => s.targetId === v.id);
  eq('заказчик один', l.ordererCount, 1);
  eq('имя заказчика отдаётся', l.ordererNames[0], 'Заказчик1');

  console.log('\n[2] Несколько заказчиков — счётчик и список');
  sanctions.declare(z2, v.id, 2e6, []);
  l = sanctions.list(z1).sanctions.find(s => s.targetId === v.id);
  eq('заказчиков двое', l.ordererCount, 2);
  ok('в именах оба', l.ordererNames.includes('Заказчик1') && l.ordererNames.includes('Заказчик2'));
  // Повторная ставка того же заказчика не увеличивает число ЗАКАЗЧИКОВ
  sanctions.declare(z1, v.id, 5e5, []);
  l = sanctions.list(z1).sanctions.find(s => s.targetId === v.id);
  eq('повторная ставка не плодит заказчиков', l.ordererCount, 2);
  ok('но общее число заказов выросло', l.orderCount >= 3);

  console.log('\n[3] Разбивка по заказчикам доступна отдельным запросом');
  const brk = sanctions.orders(z1, v.id);
  eq('в разбивке 2 заказчика', brk.orders.length, 2);
  ok('у каждого есть имя, сумма и доля', brk.orders.every(o => o.byName && o.amount > 0 && 'pct' in o));
  ok('свой вклад помечен isMe', brk.orders.some(o => o.isMe));

  console.log('\n[4] Фронт: показ заказчика и раскрытие списка');
  const warSrc = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
  ok('при одном заказчике выводится имя', /ordererNames && s\.ordererNames\[0\]/.test(warSrc));
  ok('при нескольких — кликабельный счётчик', /data-sanc-orders="\$\{s\.targetId\}"/.test(warSrc));
  ok('подпись «Охоту объявил»', /Охоту объявил/.test(warSrc));

  console.log('\n[5] Фраза босса не перебивается перерисовкой');
  const coreSrc = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok('фраза запоминается в App._bossTaunt', /App\._bossTaunt = r\.taunt/.test(coreSrc));
  ok('рендер использует запомненную фразу', /App\._bossTaunt \|\| d\.taunt/.test(coreSrc));
  ok('при смене босса память сбрасывается', /App\._bossTauntFor !== d\.name/.test(coreSrc));

  console.log('\n[6] Иконки диверсантов: ×3 в разделе, мелкие в бою');
  const sabSrc = fs.readFileSync(path.join(ROOT, 'public/js/screens/saboteurs.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  const uiSrc = fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8');
  ok('в разделе иконка 156px (×3 от 52)', /App\.sabImg\(tab, 156\)/.test(sabSrc) && /App\.sabImg\('suicide', 156\)/.test(sabSrc));
  ok('CSS карточки — 156px', /\.sab-head \.ic-sab \{ width: 156px; height: 156px;/.test(css));
  ok('в окне боя иконки мелкие (≤26px)', /max-width:26px;max-height:26px/.test(uiSrc));
  ok('в бою ячейка компактная (42px)', /width:42px;text-align:center/.test(uiSrc));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
