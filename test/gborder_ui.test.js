// jsdom: переключатель порядка блоков в ГРУППОВОМ БОЮ (не в боях легиона).
// Проверяем фактический порядок в разметке, надпись, запоминание выбора,
// что действия не ломаются и что в ГБ не появилось арсенала.
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"><div id="gb-box"></div></div></body>', { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) }); localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API'); UI.toast = () => {}; UI.confirm = async () => true;
global.App = load('public/js/app.js', 'App'); App.refreshMe = async () => {}; App.rerender = () => {}; App.go = () => {};
load('public/js/screens/war.js', 'App');
App.me = { id: 'me', level: 40 };

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const fighter = (id, name, hp, extra) => Object.assign({
  id, name, hp, maxHp: 100, alive: true, roleIcon: '⚔', roleLabel: 'Боец', isMe: false,
}, extra || {});

const BATTLE = {
  active: true, finished: false, state: 'fighting', entered: true,
  me: { id: 'me', name: 'Я', hp: 74, maxHp: 100, energy: 60, maxEnergy: 100,
        ammo: 8, maxAmmo: 30, alive: true, team: 0, roleIcon: '➕', roleLabel: 'Медик',
        cooldownLeftMs: 0, targetId: null },
  canHeal: true, canGuard: false,
  allies: [fighter('me', 'Я', 74, { isMe: true }), fighter('a1', 'Соратник', 58)],
  enemies: [fighter('e1', 'Головорез', 88), fighter('e2', 'Санитар', 35)],
  log: [{ kind: 'attack', text: 'Головорез бьёт Соратника' }],
  watchable: [], enterLeftSec: 0,
};

const posOf = (html) => ({ foes: html.indexOf('gb-side-foes'), allies: html.indexOf('gb-side-allies') });

(async () => {
  const box = document.getElementById('gb-box');
  API.get = async () => JSON.parse(JSON.stringify(BATTLE));

  console.log('\n[1] По умолчанию — противники сверху');
  localStorage.removeItem('gbAlliesFirst');
  App._resetSign('gbBattle');
  await App.renderGroupBattle();
  let p = posOf(box.innerHTML);
  ok('оба блока отрисованы', p.foes > -1 && p.allies > -1);
  ok('противники выше своей команды', p.foes < p.allies);
  ok('кнопка предлагает поставить союзников первыми', /Сначала союзники/.test(box.innerHTML));
  ok('обеих надписей одновременно нет', !/Сначала враги/.test(box.innerHTML));

  console.log('\n[2] Нажатие переставляет блоки');
  const btn = document.getElementById('gb-order-toggle');
  ok('кнопка найдена', !!btn);
  await btn.onclick();
  p = posOf(box.innerHTML);
  ok('своя команда выше противников', p.allies < p.foes);
  ok('надпись сменилась на «Сначала враги»', /Сначала враги/.test(box.innerHTML));

  console.log('\n[3] Выбор запомнился и переживает опрос сервера');
  ok('записан в хранилище', localStorage.getItem('gbAlliesFirst') === '1');
  App._resetSign('gbBattle');
  await App.renderGroupBattle();          // как будто пришёл новый 5-сек опрос
  p = posOf(box.innerHTML);
  ok('порядок сохранился', p.allies < p.foes);

  console.log('\n[4] Повторное нажатие возвращает как было');
  await document.getElementById('gb-order-toggle').onclick();
  p = posOf(box.innerHTML);
  ok('противники снова сверху', p.foes < p.allies);
  ok('в хранилище обратный выбор', localStorage.getItem('gbAlliesFirst') === '0');

  console.log('\n[5] Действия не ломаются');
  await document.getElementById('gb-order-toggle').onclick();   // союзники сверху
  ok('кнопки атаки по каждому противнику', box.querySelectorAll('[data-act="attack"]').length === 2);
  ok('кнопка лечения союзника есть', box.querySelectorAll('[data-act="heal"]').length >= 1);
  ok('оба противника перечислены', /Головорез/.test(box.innerHTML) && /Санитар/.test(box.innerHTML));
  ok('союзник перечислен', /Соратник/.test(box.innerHTML));
  ok('кнопка выхода на месте', !!document.getElementById('gb-leave'));

  console.log('\n[6] Клик по атаке уходит на сервер после перестановки');
  let posted = null;
  API.post = async (url, body) => { posted = { url, body }; return {}; };
  const atk = box.querySelector('[data-act="attack"]');
  ok('у кнопки атаки есть обработчик', typeof atk.onclick === 'function');
  await atk.onclick();
  ok('запрос ушёл на /api/group/act', posted && posted.url === '/api/group/act');
  ok('передан верный тип действия', posted && posted.body.action === 'attack');

  console.log('\n[7] ГБ — это не бои легиона: арсенала быть не должно');
  ok('арсенала нет', !/Арсенал/i.test(box.innerHTML));
  ok('слотов снаряжения нет', !/gear-slot|bw-gear/.test(box.innerHTML));

  console.log('\n[8] В боях легиона переключатель не появился');
  const appSrc = fs.readFileSync(__dirname + '/../public/js/app.js', 'utf8');
  ok('в окне боёв легиона кнопки порядка нет', !/bw-order-toggle/.test(appSrc));
  ok('порядок блоков легиона прежний (враги, затем свои)',
     /html \+= enemiesHtml \+ alliesHtml;/.test(appSrc));

  console.log('\n[9] Дубликат renderGroupBattle удалён');
  const warSrc = fs.readFileSync(__dirname + '/../public/js/screens/war.js', 'utf8');
  const copies = (warSrc.match(/App\.renderGroupBattle = async/g) || []).length;
  ok(`определение ровно одно (было две копии), сейчас: ${copies}`, copies === 1);

  console.log('\n[10] Хранилище недоступно — не падаем');
  const realLS = global.localStorage;
  Object.defineProperty(global, 'localStorage', { configurable: true, get() { throw new Error('заблокировано'); } });
  let err = null;
  try { App._gbSetAlliesFirst(true); App._resetSign('gbBattle'); await App.renderGroupBattle(); }
  catch (e) { err = e; }
  Object.defineProperty(global, 'localStorage', { configurable: true, value: realLS });
  ok('рендер пережил закрытое хранилище', !err);

  console.log('\n[11] Стили переключателя ГБ добавлены');
  const css = fs.readFileSync(__dirname + '/../public/css/style.css', 'utf8');
  ok('класс строки описан', /\.gb-order-row/.test(css));
  ok('класс кнопки описан', /\.gb-order-btn/.test(css));
  ok('старых стилей боёв легиона не осталось', !/\.bw-order-row/.test(css));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})();
