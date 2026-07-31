// ═══════════════════════════════════════════════════════════════════
// Панель должна отрисовываться при ЛЮБОМ наборе прав. Скрытые по зонам
// вкладки отсутствуют в разметке, и обращение к ним роняло весь рендер:
// «Cannot set properties of null» — панель открывалась пустой.
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

console.log('\n── 1. Обработчики только на существующие кнопки ──');
ok(/const btn = document\.getElementById\('tab-' \+ t\.id\);\s*\n\s*if \(btn\) btn\.onclick/.test(src),
   'перед назначением обработчика вкладки проверяется её наличие');
ok(/tabs\.filter\(t=>!t\.zone\|\|Admin\.can\(t\.zone\)\)/.test(src), 'в разметку попадают только доступные вкладки');
ok(/Admin\._tabIds = tabs\.filter/.test(src), 'список активных вкладок тоже фильтруется по правам');

if (JSDOM) {
  console.log('\n── 2. Рендер при разных ролях ──');
  const roleZones = {
    'владелец': ['players','moderation','security','support','legions','news','event','economy','discounts','database','roles','season'],
    'администратор': ['players','moderation','security','support','legions','event','roles','news'],
  };
  for (const [roleName, zones] of Object.entries(roleZones)) {
    const dom = new JSDOM('<div id="content"></div>', { runScripts: 'outside-only' });
    const w = dom.window;
    global.window = w; global.document = w.document;
    const UIStub = { esc: (x) => String(x == null ? '' : x), toast: () => {}, fmtNum: (n) => String(n), confirm: async () => false };
    const APIStub = { token: () => 'x', get: async () => ({}), post: async () => ({}), setToken: () => {} };
    w.UI = UIStub; w.API = APIStub; global.UI = UIStub; global.API = APIStub;
    let Admin;
    try {
      eval(src.replace(/^const Admin = /m, 'Admin = '));
      Admin.me = { staffRole: roleName, staffZones: zones };
      Admin.zones = zones;
      for (const m of ['renderPlayers','renderTools','renderEvents','renderTournament','renderLegions',
                       'renderMercs','renderDiscounts','renderBuffs','renderLogs','renderSupport','renderTech','renderDb']) {
        Admin[m] = () => {};
      }
      Admin.render();
      const tabs = [...w.document.querySelectorAll('[id^="tab-"]')]
        .filter((b) => b.id !== 'tab-content').map((b) => b.id.replace('tab-', ''));
      ok(tabs.length > 0, `${roleName}: панель отрисовалась, вкладок ${tabs.length}`);
      if (roleName === 'администратор') {
        ok(!tabs.includes('tools') && !tabs.includes('db') && !tabs.includes('discounts'),
           'у администратора скрыты владельческие разделы (ресурсы, скидки, база)');
        ok(tabs.includes('players') && tabs.includes('support'), 'а свои разделы на месте');
      } else {
        ok(tabs.includes('db') && tabs.includes('tools'), 'у владельца доступны все разделы');
      }
    } catch (e) {
      ok(false, `${roleName}: рендер упал — ${e.message}`);
    }
  }
} 

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
