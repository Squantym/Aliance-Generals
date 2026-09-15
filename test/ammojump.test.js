// ═══════════════════════════════════════════════════════════════════
// test/ammojump.test.js — боеприпас в шапке ведёт к целям атаки
//
// Жалоба владельца: стоишь на экране войны с карточкой «ПОБЕДА», жмёшь
// на боеприпас — и ничего не происходит. Причина: кнопка звала
// App.go('war'), а адрес УЖЕ был #war. Смены хэша нет — значит нет и
// перерисовки, и карточка итога прошлого боя продолжала висеть поверх
// списка целей.
//
// Что стережётся:
//  1. Нажатие на боеприпас снимает карточку итога боя и открывает
//     вкладку целей.
//  2. Работает и с самого экрана войны (адрес не меняется), и с любого
//     другого раздела.
//  3. Соседние показатели шапки ведут туда же, куда и вели: здоровье —
//     в госпиталь, энергия — в спецоперации.
//
// Запуск: node test/ammojump.test.js
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert'); const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM(`<!DOCTYPE html><body>
  <header id="header"></header><div id="pin-news"></div>
  <main id="content"></main><div id="sales-strip"></div><div id="toasts"></div>
</body>`, { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location,
  history: dom.window.history, requestAnimationFrame: (fn) => setTimeout(fn, 0) });
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API');
UI.toast = () => {};
global.App = load('public/js/app.js', 'App');
let passed = 0;
const ok = (n, c) => { assert.ok(c, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

// Экран войны подгружается отдельным файлом; здесь берём из него только
// переключатель вкладок — ровно то, что зовёт шапка.
let rerenders = 0;
App.rerender = () => { rerenders++; };
App._setWarTab = (tab) => {
  App._warTab = tab;
  const want = '#war/' + tab;
  if (location.hash !== want) history.replaceState(null, '', want);
  App.rerender();
};

(async () => {
  console.log('\n[1] На экране войны: карточка итога уходит, открываются цели');
  location.hash = '#war';
  App._lastBattle = { win: true, targetName: 'Кобра', targetHpPct: 92 };
  App._warTab = 'arena';
  rerenders = 0;
  App.goAttack();
  ok('карточка прошлого боя снята', App._lastBattle === null);
  eq('вкладка — цели атаки', App._warTab, 'targets');
  ok('экран перерисован (адрес не менялся — сам бы он не обновился)', rerenders === 1);
  eq('и вкладка записана в адрес', location.hash, '#war/targets');

  console.log('\n[2] Из другого раздела — переход на войну');
  location.hash = '#market';
  App._lastBattle = { win: false, targetName: 'Кто-то' };
  App._warTab = 'group';
  App.goAttack();
  ok('карточка снята и здесь', App._lastBattle === null);
  eq('вкладка выставлена заранее', App._warTab, 'targets');
  eq('и адрес ведёт к целям', location.hash, '#war/targets');

  console.log('\n[3] Когда экран войны ещё не загружен');
  // war.js подгружается при первом заходе — до него переключателя нет
  const saved = App._setWarTab;
  delete App._setWarTab;
  location.hash = '#home';
  App._lastBattle = { win: true };
  App.goAttack();
  eq('всё равно ведём к целям', location.hash, '#war/targets');
  eq('и вкладку запоминаем', App._warTab, 'targets');
  App._setWarTab = saved;

  console.log('\n[4] Шапка: что куда ведёт');
  const src = fs.readFileSync(__dirname + '/../public/js/app.js', 'utf8');
  ok('боеприпас зовёт переход к целям', /onclick="App\.goAttack\(\)"[^>]*ic-ammo|ic-ammo[\s\S]{0,80}st-am/.test(src));
  ok('и именно у боеприпаса', /App\.goAttack\(\)" title="К целям атаки"><span class="ic-ammo">/.test(src));
  ok('здоровье по-прежнему в госпиталь', /App\.go\('hospital'\)[\s\S]{0,60}ic-health/.test(src));
  ok('энергия — в спецоперации', /App\.go\('missions'\)[\s\S]{0,60}ic-energy/.test(src));
  ok('прежнего App.go(\'war\') на боеприпасе не осталось',
     !/App\.go\('war'\)" title="В бой"/.test(src));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
