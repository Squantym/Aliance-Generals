// ═══════════════════════════════════════════════════════════════════
// Кнопки внутри окон должны нажиматься. Две типовые ошибки:
//   • обработчики вешают ПОСЛЕ `await UI.confirm` — окно уже закрыто,
//     разметки нет, кнопки мертвы;
//   • обработчик стоит в ветке, которая для этих кнопок не выполняется.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { JSDOM } = require(ROOT + '/node_modules/jsdom');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

function makeDom() {
  const dom = new JSDOM('<div id="content"></div>', { url: 'https://x.test/', runScripts: 'outside-only' });
  const w = dom.window;
  global.window = w; global.document = w.document;
  global.requestAnimationFrame = (fn) => { fn(); return 0; };
  global.setTimeout = () => 0; global.setInterval = () => 0; global.clearInterval = () => {};
  global.localStorage = w.localStorage;
  eval(fs.readFileSync(ROOT + '/public/js/ui.js', 'utf8').replace(/^const UI = /m, 'UI = '));
  // Окно рисуется и остаётся открытым — как в жизни
  UI.confirm = (body) => {
    const d = w.document.createElement('div');
    d.className = 'ui-dialog';
    d.innerHTML = body;
    w.document.body.appendChild(d);
    return new Promise(() => {});
  };
  UI.toast = () => {};
  global.UI = UI; w.UI = UI;
  return w;
}

async function main() {
console.log('\n── 1. Карточка игрока в панели ──');
{
  const w = makeDom();
  global.API = {
    token: () => 't', setToken() {},
    get: async (u) => u.includes('player-card')
      ? { id: 'p1', name: 'Боец', level: 10, online: true, dollars: 1, gold: 1,
          createdAt: 1, lastSeen: 1, recent: [], chatBan: null, accountBan: null,
          can: { chatBan: true, accountBan: true, resources: true, password: true } }
      : {},
    post: async () => ({}),
  };
  w.API = global.API;
  let Admin;
  eval(fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8').replace(/^const Admin = /m, 'Admin = '));
  Admin.me = { staffRole: 'owner', staffZones: ['players', 'moderation', 'chat', 'security'] };
  Admin.zones = Admin.me.staffZones;
  global.Admin = Admin; w.Admin = Admin;

  Admin.showPlayerCard('p1');
  await new Promise((r) => process.nextTick(r));
  await new Promise((r) => process.nextTick(r));
  const btns = [...w.document.querySelectorAll('.adm-card [data-act]')];
  ok(btns.length >= 4, `кнопок в карточке: ${btns.length}`);
  for (const b of btns) ok(!!b.onclick, `кнопка «${b.dataset.act}» нажимается`);
}

console.log('\n── 2. Кнопки подписки в профиле ──');
{
  const w = makeDom();
  const prof = { id: 'me', name: 'Я', vip: true, level: 50, online: true, rank: 'Генерал', flag: '🇷🇺',
    units: [], buildings: [], stats: {}, battle: {}, achievements: [], titles: [], counters: {},
    avatar: null, profileFrame: null, profileBg: null, status: '', canAttack: true,
    spyIntel: null, hideArmy: false, isBot: false, accountBan: null, staffRole: null, powerStats: null };
  global.API = { token: () => 't', setToken() {},
    get: async (u) => u.startsWith('/api/profile') ? { profile: prof } : {},
    post: async () => ({}) };
  w.API = global.API;
  let App;
  eval(fs.readFileSync(ROOT + '/public/js/app.js', 'utf8').replace(/^const App = /m, 'App = '));
  global.App = App; w.App = App;
  App.me = { id: 'me', name: 'Я', vip: true, level: 50, staffRole: null, staffZones: [], alliance: null, legion: null };
  App.rerender = () => {}; App.refreshMe = async () => {}; App.go = () => {};
  eval(fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8'));

  await App.screens.profile(w.document.getElementById('content'), 'me');
  for (const [id, label] of [
    ['pf-stats', 'Полная статистика'],
    ['pf-spied', 'Кто меня разведал'],
    ['pf-rename', 'Сменить позывной'],
    ['pf-avatar-btn', 'Сменить аватар'],
    ['pf-vip', 'Подписка'],
  ]) {
    const el = w.document.getElementById(id);
    ok(el && !!el.onclick, `«${label}» нажимается`);
  }
}

console.log('\n── 3. Ошибка не повторится ──');
// Ищем во всём интерфейсе места, где обработчики вешают после закрытия окна
const files = ['public/js/admin.js', 'public/js/app.js']
  .concat(fs.readdirSync(path.join(ROOT, 'public/js/screens')).map((f) => 'public/js/screens/' + f));
const offenders = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /await UI\.confirm\([\s\S]{0,900}?\);\s*(\/\/[^\n]*\n\s*)*requestAnimationFrame/g;
  let m;
  while ((m = re.exec(src))) offenders.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
}
ok(offenders.length === 0,
   offenders.length ? `обработчики после закрытия окна: ${offenders.join(', ')}`
                    : 'нигде обработчики не вешаются после закрытия окна');

const adminSrc = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/const dlg = UI\.confirm\(body, \{ title: 'Карточка игрока'/.test(adminSrc),
   'карточка игрока не ждёт закрытия перед навешиванием');
ok(/await dlg;/.test(adminSrc), 'ожидание закрытия перенесено в конец');
const coreSrc = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
const ownBlock = coreSrc.indexOf('if (own) {');
const notOwnBlock = coreSrc.indexOf('if (!own) {');
const statsHandler = coreSrc.indexOf("getElementById('pf-stats')");
ok(statsHandler < notOwnBlock,
   'обработчики кнопок подписки стоят вне ветки «чужой профиль»');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
