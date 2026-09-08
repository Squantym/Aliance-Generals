// ═══════════════════════════════════════════════════════════════════
// Панель должна отрисовываться при ЛЮБОМ наборе прав. Скрытые по зонам
// разделы отсутствуют в разметке, и обращение к ним роняло весь рендер:
// «Cannot set properties of null» — панель открывалась пустой.
//
// Панель в проекте одна — v2 (public/js/admin2/). Каркас и список
// разделов держит её оболочка, admin.js остался набором экранов.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

let JSDOM;
try { JSDOM = require('jsdom').JSDOM; } catch (e) {
  console.log('  ⚠ jsdom не установлен — проверяем только исходник');
}

const src = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
const shell = fs.readFileSync(path.join(ROOT, 'public/js/admin2/shell.js'), 'utf8');
const router = fs.readFileSync(path.join(ROOT, 'public/js/admin2/router.js'), 'utf8');

console.log('\n── 1. В разметку попадают только доступные разделы ──');
ok(/item\.zones \? item\.zones\.some\(\(z\) => A2\.can\(z\)\)/.test(shell),
   'видимость раздела считает предикат по зонам');
ok(/allowed\(\) \{ return A2\.NAV\.filter\(A2\.visible\); \}/.test(shell),
   'список разделов фильтруется по правам');
ok(/A2\.allowed\(\)\.filter\(\(n\) => n\.group === name/.test(shell),
   'и меню собирается из отфильтрованного списка');
ok(!/const tabs = \[/.test(src), 'своей строки вкладок в admin.js не осталось');

if (JSDOM) {
  console.log('\n── 2. Рендер при разных ролях ──');
  const roleZones = {
    'owner': ['players','moderation','security','support','legions','news','event','economy','discounts','database','roles','season','analytics'],
    'admin': ['players','moderation','security','support','legions','event','news'],
  };
  for (const [roleName, zones] of Object.entries(roleZones)) {
    const dom = new JSDOM('<div id="content"></div>', { url: 'http://localhost/admin', runScripts: 'outside-only' });
    const w = dom.window;
    global.window = w; global.document = w.document; global.location = w.location;
    const UIStub = { esc: (x) => String(x == null ? '' : x), toast: () => {}, fmtNum: (n) => String(n), confirm: async () => false };
    const APIStub = { token: () => 'x', get: async () => ({}), post: async () => ({}), setToken: () => {} };
    w.UI = UIStub; w.API = APIStub; global.UI = UIStub; global.API = APIStub;
    try {
      eval(src.replace(/^const Admin = /m, 'Admin = '));
      global.Admin = Admin; w.Admin = Admin;
      eval(router.replace(/^const A2Router = /m, 'A2Router = '));
      global.A2Router = A2Router; w.A2Router = A2Router;
      eval(shell.replace(/^const A2 = /m, 'A2 = '));
      global.A2 = A2; w.A2 = A2;

      Admin.me = { name: 'Тест', staffRole: roleName, staffZones: zones };
      Admin.zones = zones;
      A2.render();
      const tabs = [...w.document.querySelectorAll('#a2-side [data-nav]')].map((a) => a.dataset.nav);
      ok(tabs.length > 0, `${roleName}: панель отрисовалась, разделов ${tabs.length}`);
      ok(tabs.includes('queue'), `${roleName}: очередь работ на месте — с неё начинается смена`);
      if (roleName === 'admin') {
        ok(!tabs.includes('econ') && !tabs.includes('gold'),
           'у администратора скрыты владельческие разделы (экономика, журнал золота)');
        ok(tabs.includes('players') && tabs.includes('support'), 'а свои разделы на месте');
      } else {
        ok(tabs.includes('gold') && tabs.includes('econ'),
           'у владельца доступны все разделы, включая экономику и журнал золота');
      }
    } catch (e) {
      ok(false, `${roleName}: рендер упал — ${e.message}`);
    }
  }
}

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
