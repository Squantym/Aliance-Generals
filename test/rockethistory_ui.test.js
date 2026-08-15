// jsdom: история ракет внизу вкладки «Ракетные шахты» — две подвкладки,
// переключение, кнопка «Подробнее» и содержимое окна (потери / кем сбита).
const assert = require('assert'); const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) }); localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API'); UI.toast = () => {}; UI.confirm = async () => true;
global.App = load('public/js/app.js', 'App'); App.refreshMe = async () => {}; App.rerender = () => {}; App.go = () => {};
load('public/js/screens/economy.js', 'App');
App.me = { id: 'me', level: 99 };

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Заготовки записей журнала
const HIT_OUT = {
  id: 'r1', role: 'attack', outcome: 'hit', at: Date.now() - 60000, launchedAt: Date.now() - 660000,
  attackerId: 'me', attackerName: 'Я', targetId: 'v', targetName: 'Мишень', powerPct: 87,
  techDestroyedCount: 412, buildingsDestroyedCount: 9,
  techLost: { 'Т-54': 300, 'МиГ-15': 112 }, destroyedBuildings: { 'Военные склады': 9 },
  lostSaboteurs: { ground: 4 },
};
const SHOT_OUT = {
  id: 'r2', role: 'attack', outcome: 'intercepted', at: Date.now() - 30000, launchedAt: Date.now() - 300000,
  attackerId: 'me', attackerName: 'Я', targetId: 'v', targetName: 'Мишень', powerPct: 50,
  interceptedById: 's', interceptedByName: 'Спасатель',
};
const HIT_IN = {
  id: 'r3', role: 'defense', outcome: 'hit', at: Date.now() - 120000, launchedAt: Date.now() - 720000,
  attackerId: 'z', attackerName: 'Агрессор', targetId: 'me', targetName: 'Я', powerPct: 100,
  techDestroyedCount: 950, buildingsDestroyedCount: 21,
  techLost: { 'Т-72': 950 }, destroyedBuildings: { 'Казармы': 21 },
};
const SHOT_IN = {
  id: 'r4', role: 'defense', outcome: 'intercepted', at: Date.now() - 5000, launchedAt: Date.now() - 400000,
  attackerId: 'z', attackerName: 'Агрессор', targetId: 'me', targetName: 'Я', powerPct: 30,
  interceptedById: 'me', interceptedByName: 'Мой Союзник',
};

const HIST = { launched: [SHOT_OUT, HIT_OUT], incoming: [SHOT_IN, HIT_IN] };

(async () => {
  const box = document.createElement('div'); box.id = 'rocket-history';
  document.getElementById('content').appendChild(box);
  API.get = async (p) => (p === '/api/silos/history' ? HIST : {});

  console.log('\n[1] Блок истории и две подвкладки');
  App._siloHistTab = 'launched';
  await App._renderRocketHistory();
  ok('заголовок «История ракет» есть', /История ракет/.test(box.innerHTML));
  const tabs = box.querySelectorAll('[data-histtab]');
  ok('ровно две подвкладки', tabs.length === 2);
  ok('вкладка «Мои пуски» с счётчиком', /Мои пуски \(2\)/.test(box.innerHTML));
  ok('вкладка «По мне» с счётчиком', /По мне \(2\)/.test(box.innerHTML));
  ok('подвкладки помечены отдельным классом (мельче основных)', /rk-log-tab/.test(box.innerHTML));

  console.log('\n[2] Вкладка «Мои пуски»: строки и итоги');
  ok('две строки', box.querySelectorAll('.rk-log-row').length === 2);
  ok('показана цель удара', /Мишень/.test(box.innerHTML));
  ok('у сбитой видно КЕМ сбита прямо в строке', /🛡 сбита — Спасатель/.test(box.innerHTML));
  ok('у попадания видны потери в строке', /−412 техн\., −9 зд\./.test(box.innerHTML));
  ok('у каждой строки кнопка «Подробнее»', box.querySelectorAll('[data-rkdetail]').length === 2);

  console.log('\n[3] Переключение на «По мне»');
  tabs[1].onclick();
  await new Promise((r) => setTimeout(r, 10));
  ok('активна вторая вкладка', /rk-log-tab active[^>]*data-histtab="incoming"|data-histtab="incoming"[^>]*/.test(box.innerHTML) && App._siloHistTab === 'incoming');
  ok('показан атаковавший', /Агрессор/.test(box.innerHTML));
  ok('строк снова две', box.querySelectorAll('.rk-log-row').length === 2);
  ok('целей своих пусков тут нет', !/Мишень/.test(box.innerHTML));

  console.log('\n[4] Окно «Подробнее»: прилёт по игроку (потери)');
  App._showRocketLogDetail(HIT_IN);
  let w = document.getElementById('rocket-log-window');
  ok('окно открылось', !!w);
  ok('заголовок про удар по игроку', /По вам нанесён ракетный удар/.test(w.innerHTML));
  ok('видно кто атаковал', /Кто атаковал[\s\S]*?Агрессор/.test(w.innerHTML));
  ok('счётчик техники', />950</.test(w.innerHTML));
  ok('счётчик зданий', />21</.test(w.innerHTML));
  ok('поимённая техника', /Т-72/.test(w.innerHTML));
  ok('поимённые постройки', /Казармы/.test(w.innerHTML));
  ok('мощность показана', /100%/.test(w.innerHTML));
  w.querySelector('#rocket-log-close').onclick();
  ok('окно закрывается', !document.getElementById('rocket-log-window'));

  console.log('\n[5] Окно «Подробнее»: моя ракета сбита');
  App._showRocketLogDetail(SHOT_OUT);
  w = document.getElementById('rocket-log-window');
  ok('заголовок про сбитие', /Вашу ракету сбили/.test(w.innerHTML));
  ok('показано КЕМ сбита', /Кто сбил[\s\S]*?Спасатель/.test(w.innerHTML));
  ok('показано по кому запускалась', /По кому запущена[\s\S]*?Мишень/.test(w.innerHTML));
  ok('сказано что урона не было', /не нанесла урона/.test(w.innerHTML));
  ok('счётчиков потерь нет', !/единиц техники/.test(w.innerHTML));
  w.querySelector('#rocket-log-close').onclick();

  console.log('\n[6] Окно «Подробнее»: мой успешный удар');
  App._showRocketLogDetail(HIT_OUT);
  w = document.getElementById('rocket-log-window');
  ok('заголовок про поражение цели', /Ваша ракета поразила цель/.test(w.innerHTML));
  ok('формулировки со стороны атакующего', /Уничтожено техники врага/.test(w.innerHTML));
  ok('диверсанты врага показаны', /диверсант/i.test(w.innerHTML));
  w.querySelector('#rocket-log-close').onclick();

  console.log('\n[7] Кнопка «Подробнее» открывает запись ТОЙ ЖЕ вкладки');
  App._siloHistTab = 'launched';
  await App._renderRocketHistory();
  box.querySelector('[data-rkdetail="1"]').onclick();   // вторая запись = HIT_OUT
  w = document.getElementById('rocket-log-window');
  ok('открылась вторая запись вкладки «Мои пуски»', /Ваша ракета поразила цель/.test(w.innerHTML));
  w.querySelector('#rocket-log-close').onclick();

  console.log('\n[8] Пустая история');
  API.get = async () => ({ launched: [], incoming: [] });
  await App._renderRocketHistory();
  ok('подсказка при пустом списке', /Вы ещё не запускали ракет/.test(box.innerHTML));
  ok('строк нет', box.querySelectorAll('.rk-log-row').length === 0);
  App._siloHistTab = 'incoming';
  await App._renderRocketHistory();
  ok('своя подсказка для вкладки «По мне»', /По вам ещё не запускали ракет/.test(box.innerHTML));

  console.log('\n[9] Экранирование: позывной с разметкой не ломает страницу');
  API.get = async () => ({
    launched: [{ ...HIT_OUT, targetName: '<img src=x onerror=alert(1)>' }], incoming: [],
  });
  App._siloHistTab = 'launched';
  await App._renderRocketHistory();
  ok('тег не попал в разметку как есть', !/<img src=x/.test(box.innerHTML));
  ok('экранированная форма присутствует', /&lt;img/.test(box.innerHTML));

  console.log('\n[10] Стили истории добавлены');
  const css = fs.readFileSync(__dirname + '/../public/css/style.css', 'utf8');
  ok('класс строки описан', /\.rk-log-row/.test(css));
  ok('подвкладки мельче основных', /\.rk-log-tabs \.rk-log-tab/.test(css));
  ok('на телефоне кнопка на всю ширину', /max-width:\s*420px[\s\S]{0,200}\.rk-log-btn/.test(css));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})();
