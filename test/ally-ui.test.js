// ═══════════════════════════════════════════════════════════════════
// test/ally-ui.test.js — союзник в списке целей (jsdom, 18.09.2026)
//
// Что стережётся:
//  1. Ник союзника — своим цветом (класс opp-ally), без звёзд и букв.
//  2. «Атака» по союзнику открывает окно игры «Это союзник» с кнопками
//     «Выбрать другую цель» и «Атаковать союзника».
//  3. «Атаковать союзника» повторяет удар с allyOk: true.
//  4. «Выбрать другую цель» закрывает окно, удара нет.
//  5. Случайный Enter — это «Выбрать другую цель», а не атака.
//  6. Из профиля — то же окно.
//
// Запуск: node test/ally-ui.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { JSDOM } = require(ROOT + '/node_modules/jsdom');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const wait = async (n) => { for (let i = 0; i < (n || 10); i++) await new Promise((r) => setImmediate(r)); };

const OPPONENTS = { opponents: [
  { id: 'ally1', name: 'Друг', level: 40, flag: '', isBot: false, online: true, allianceMembers: 3, inMyAlliance: true },
  { id: 'foe1', name: 'Чужой', level: 40, flag: '', isBot: false, online: true, allianceMembers: 0, inMyAlliance: false },
] };
const allyErr = () => { const e = new Error('«Друг» — союзник из вашего альянса'); e.code = 'ALLY_TARGET'; e.status = 409; return e; };
const WIN = { win: true, targetId: 'ally1', targetName: 'Друг', targetLevel: 40, targetHpPct: 50, dealt: 10, received: 5, loot: 0, xp: 1 };

function setup() {
  const dom = new JSDOM('<div id="content"></div>', { url: 'https://x.test/#war/targets', runScripts: 'outside-only' });
  const w = dom.window;
  global.window = w; global.document = w.document; global.location = w.location; global.history = w.history;
  global.setInterval = () => 0; global.clearInterval = () => {};
  global.setTimeout = (fn) => { fn(); return 0; }; global.requestAnimationFrame = (fn) => { fn(); return 0; };
  global.localStorage = w.localStorage;
  w.HTMLElement.prototype.scrollIntoView = function () { this.__scrolled = true; };
  w.scrollTo = () => {};
  eval(fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8').replace(/^const UI = /m, 'UI = '));
  UI.toast = () => {};
  global.UI = UI; w.UI = UI;
  const posts = [];
  global.API = { token: () => 't', setToken() {},
    get: async (u) => (u.startsWith('/api/war/opponents') ? JSON.parse(JSON.stringify(OPPONENTS)) : {}),
    post: async (u, body) => {
      posts.push({ u, body });
      if (u === '/api/war/attack' && body.targetId === 'ally1' && !body.allyOk) throw allyErr();
      return JSON.parse(JSON.stringify(WIN));
    } };
  w.API = global.API;
  let App;
  eval(fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8').replace(/^const App = /m, 'App = '));
  global.App = App; w.App = App;
  App.me = { id: 'me', level: 40, res: { hp: { cur: 100 }, en: { cur: 1 }, am: { cur: 5 } }, maxHp: 100, name: 'Я' };
  App.refreshMe = async () => {};
  App.rerender = () => {}; App.rerenderTo = () => {};
  App.go = (x) => { App._went = x; };
  eval(fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8'));
  eval(fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8'));
  App._warTab = 'targets';
  return { w, App, doc: w.document, posts };
}

(async () => {
  console.log('\n[1] Список целей');
  const env = setup();
  await env.App.screens.war(env.doc.getElementById('content'));
  await wait();
  const rows = [...env.doc.querySelectorAll('#war-list .list-row')];
  const allyRow = rows.find((r) => /Друг/.test(r.textContent));
  const foeRow = rows.find((r) => /Чужой/.test(r.textContent));
  ok(!!allyRow.querySelector('.opp-ally') && /Союзник/.test(allyRow.querySelector('.opp-ally').title), 'ник союзника — своим цветом и с подсказкой');
  ok(!foeRow.querySelector('.opp-ally'), 'у чужого — обычный ник');
  ok(!env.doc.querySelector('.ally-star') && !env.doc.querySelector('.pack-mark'), 'ни звёзд, ни букв');

  console.log('\n[2] «Атака» по союзнику → окно');
  const allyBtn = allyRow.querySelector('[data-target]');
  const p1 = allyBtn.onclick();
  await wait();
  const dlg = env.doc.getElementById('game-dialog');
  ok(!!dlg && /Это союзник/.test(dlg.textContent) && /«Друг» — союзник из вашего альянса/.test(dlg.textContent), 'открылось окно «Это союзник»');
  ok(env.doc.getElementById('gd-cancel').textContent === 'Выбрать другую цель', 'кнопка «Выбрать другую цель»');
  ok(env.doc.getElementById('gd-ok').textContent === 'Атаковать союзника', 'кнопка «Атаковать союзника»');
  ok(env.doc.activeElement === env.doc.getElementById('gd-cancel'), 'фокус — на безопасной кнопке');

  console.log('\n[3] «Атаковать союзника»');
  env.doc.getElementById('gd-ok').onclick();
  await p1; await wait();
  const attacks = env.posts.filter((p) => p.u === '/api/war/attack');
  ok(attacks.length === 2 && attacks[1].body.allyOk === true && attacks[1].body.targetId === 'ally1', 'повторный удар ушёл с allyOk: true');
  ok(!env.doc.getElementById('game-dialog'), 'окно закрылось');

  console.log('\n[4] «Выбрать другую цель»');
  env.posts.length = 0;
  const p2 = allyBtn.onclick();
  await wait();
  env.doc.getElementById('gd-cancel').onclick();
  await p2; await wait();
  ok(env.posts.filter((p) => p.u === '/api/war/attack').length === 1, 'второго удара нет');
  ok(env.doc.getElementById('war-list').__scrolled === true, 'экран вернулся к списку целей');

  console.log('\n[5] Случайный Enter');
  env.posts.length = 0;
  const p3 = allyBtn.onclick();
  await wait();
  env.doc.getElementById('game-dialog').dispatchEvent(new env.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await p3; await wait();
  ok(env.posts.filter((p) => p.u === '/api/war/attack').length === 1, 'Enter не нападает на союзника');

  console.log('\n[6] По чужому — без окна');
  env.posts.length = 0;
  await foeRow.querySelector('[data-target]').onclick();
  await wait();
  ok(!env.doc.getElementById('game-dialog') && env.posts.filter((p) => p.u === '/api/war/attack').length === 1, 'удар сразу');

  console.log('\n[7] Из профиля');
  const src = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(/if \(e\.code === 'ALLY_TARGET'\) \{\s*\n\s*if \(!await App\._confirmAllyAttack\(e\.message\)\)/.test(src), 'профиль спрашивает то же окно');
  ok(typeof env.App._confirmAllyAttack === 'function' && typeof env.App._pickOtherTarget === 'function',
     'окно доступно без захода на войну (живёт в core.js)');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
