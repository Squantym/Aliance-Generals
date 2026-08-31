// ═══════════════════════════════════════════════════════════════════
// test/maintwindow.test.js — отложенное окно обслуживания в живом DOM
//
// Серверную часть стережёт test/release.test.js. Здесь проверяется то,
// что владелец НАЖИМАЕТ и что игрок ВИДИТ, — в настоящем jsdom, а не
// поиском строк в исходнике. Разница принципиальная: проверка «в файле
// есть слово delayMin» останется зелёной, даже если поле перестали
// читать при отправке.
//
// Что именно стережётся:
//
//  1. ДВЕ КНОПКИ РАЗЛИЧАЮТСЯ. «Закрыть сейчас» обязана отправить
//     delayMin=0, даже если поле задержки заполнено. Человек, набравший
//     480 и нажавший не ту кнопку, не должен обнаружить, что игра
//     открыта, а окно тихо назначено на восемь часов вперёд.
//
//  2. НАЗНАЧЕННОЕ ОКНО ВЫГЛЯДИТ ИНАЧЕ, ЧЕМ ЗАКРЫТАЯ ИГРА. Увидев
//     «игра закрыта», владелец начал бы выкатывать — а игроки ещё в игре.
//
//  3. ПОЛОСА У ИГРОКА — ЭТО ПОЛОСА, А НЕ ЗАПЕРТАЯ ДВЕРЬ. И она
//     возвращается за пять минут до начала, даже если её закрыли
//     крестиком: это единственный момент, когда она решает, успеет
//     игрок доиграть бой или вылетит из него.
//
// Запуск: node test/maintwindow.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) {}
if (!JSDOM) { console.log('⛔ jsdom не установлен'); process.exit(1); }

const ESC = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Панель владельца ───────────────────────────────────────────────
function bootPanel(release) {
  const dom = new JSDOM('<!doctype html><body><div id="content"></div></body>',
    { url: 'https://aliance-general.ru/', runScripts: 'outside-only' });
  const win = dom.window;
  const sent = [];
  const toasts = [];
  let answer = true;

  win.UI = { esc: ESC, toast: (t) => toasts.push(String(t)), confirm: async () => answer };
  win.API = {
    get: async () => release,
    post: async (url, body) => { sent.push({ url, body }); return {}; },
  };
  win.A2 = { screens: {} };
  win.eval(fs.readFileSync(path.join(ROOT, 'public/js/admin2/release.js'), 'utf8'));
  return {
    win, sent, toasts,
    say: (v) => { answer = v; },
    el: win.document.getElementById('content'),
    render: () => win.A2.screens.release(win.document.getElementById('content')),
  };
}

const REL_OPEN = {
  maintenance: { on: false, pending: false, planned: false, reason: '', until: 0, at: 0, auto: false, startAt: 0, by: '' },
  current: { isGit: true, commit: 'a'.repeat(40), short: 'aaaaaaa', branch: 'main', subject: 'правка', at: '2026-08-30T10:00:00Z' },
  deploy: null, world: { on: false }, canDeploy: true, log: '', why: '',
};

(async () => {
  console.log('\n── 1. Панель: форма назначения ──');
  let p = bootPanel(REL_OPEN);
  await p.render();
  const q = (id) => p.win.document.getElementById(id);
  ok('есть поле «начать через»', !!q('m-delay'));
  ok('есть поле длительности', !!q('m-min'));
  ok('есть галочка самооткрытия', !!q('m-auto'));
  ok('галочка снята по умолчанию', q('m-auto').checked === false);
  ok('есть кнопка «закрыть сейчас»', !!q('m-on'));
  ok('есть кнопка «назначить на потом»', !!q('m-plan'));

  console.log('\n── 2. «Назначить» без времени ничего не делает ──');
  // Пустая задержка означала бы «закрыть прямо сейчас» — то есть кнопка
  // делала бы противоположное тому, что на ней написано.
  q('m-delay').value = '0';
  await q('m-plan').onclick();
  ok('запрос не ушёл', p.sent.length === 0);
  ok('и объяснено почему', /через сколько/i.test(p.toasts.join(' ')));

  console.log('\n── 3. Назначение уходит целиком ──');
  q('m-delay').value = '90';
  q('m-min').value = '25';
  q('m-auto').checked = true;
  q('m-reason').value = 'Плановая профилактика';
  await q('m-plan').onclick();
  ok('запрос ушёл', p.sent.length === 1);
  const b = p.sent[0].body || {};
  ok('адрес тот же, что и у обычного закрытия', p.sent[0].url === '/api/admin/maintenance');
  ok('задержка передана', b.delayMin === 90);
  ok('длительность передана', b.durationMin === 25);
  ok('галочка самооткрытия передана', b.auto === true);
  ok('причина передана', b.reason === 'Плановая профилактика');

  console.log('\n── 4. «Закрыть сейчас» игнорирует поле задержки ──');
  // Вот это главное в разделе. Человек набрал 480 и нажал не ту
  // кнопку — игра обязана закрыться сейчас, а не через восемь часов.
  p = bootPanel(REL_OPEN);
  await p.render();
  p.win.document.getElementById('m-delay').value = '480';
  p.win.document.getElementById('m-min').value = '15';
  await p.win.document.getElementById('m-on').onclick();
  ok('запрос ушёл', p.sent.length === 1);
  ok('задержка обнулена', p.sent[0].body.delayMin === 0);
  ok('длительность сохранена', p.sent[0].body.durationMin === 15);

  console.log('\n── 5. Отказ в подтверждении ничего не отправляет ──');
  p = bootPanel(REL_OPEN);
  await p.render();
  p.say(false);
  p.win.document.getElementById('m-delay').value = '60';
  await p.win.document.getElementById('m-plan').onclick();
  await p.win.document.getElementById('m-on').onclick();
  ok('ни одного запроса', p.sent.length === 0);

  console.log('\n── 6. Назначенное окно выглядит не как закрытая игра ──');
  const startAt = Date.now() + 3600000;
  const relPending = Object.assign({}, REL_OPEN, {
    maintenance: {
      on: false, pending: true, planned: true, startAt, until: startAt + 1800000,
      reason: 'Плановая профилактика', at: Date.now(), auto: true, by: 'Хозяин',
    },
  });
  p = bootPanel(relPending);
  await p.render();
  const html = p.el.innerHTML;
  ok('сказано, что окно назначено', /назначено/i.test(html));
  ok('и что игроки пока играют', /играют как обычно/i.test(html));
  ok('не сказано, что игра закрыта', !/Игра закрыта на обновление/.test(html));
  ok('видно, что откроется сама', /откроется сама/i.test(html));
  ok('кнопка называется «отменить», а не «открыть»',
     /Отменить назначенное окно/.test(html));
  ok('формы повторного закрытия нет — сначала отмена',
     !p.win.document.getElementById('m-plan'));
  await p.win.document.getElementById('m-off').onclick();
  ok('отмена шлёт то же on:false', p.sent.length === 1 && p.sent[0].body.on === false);

  console.log('\n── 7. Действующее окно: старый вид на месте ──');
  const relOn = Object.assign({}, REL_OPEN, {
    maintenance: {
      on: true, pending: false, planned: true, startAt: 0, until: Date.now() + 600000,
      reason: 'Ставим новые пушки', at: Date.now(), auto: false, by: 'Хозяин',
    },
  });
  p = bootPanel(relOn);
  await p.render();
  ok('сказано, что игра закрыта', /Игра закрыта на обновление/.test(p.el.innerHTML));
  ok('кнопка открывает игру', /Открыть игру для игроков/.test(p.el.innerHTML));

  // ── Полоса у игрока ──────────────────────────────────────────────
  console.log('\n── 8. Полоса «скоро обновление» у игрока ──');
  const dom = new JSDOM('<!doctype html><body><div id="wrap"></div></body>',
    { url: 'https://aliance-general.ru/', runScripts: 'outside-only' });
  const win = dom.window;
  win.UI = { esc: ESC, toast: () => {} };
  win.API = { token: () => '', get: async () => ({}) };
  win.localStorage.clear();
  // Таймеры перехватываем: ждать по пятнадцать секунд в тесте незачем,
  // а вот проверить, что именно тикает, — нужно.
  const ticks = [];
  win.setInterval = (fn) => { ticks.push(fn); return ticks.length; };
  win.clearInterval = () => {};
  let worldAnswer = { maintenance: { on: false, soon: null } };
  win.fetch = async () => ({ json: async () => worldAnswer });
  // `const App = {...}` в глобальной области не становится свойством
  // window — забираем значение из самого eval.
  const App = win.eval(fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8') + '\n;App');
  win.App = App;
  const bar = () => win.document.getElementById('maint-soon');

  App.showMaintenanceSoon({ startAt: Date.now() + 3600000, until: Date.now() + 5400000, reason: 'Плановая профилактика' });
  ok('полоса появилась', !!bar());
  ok('игра при этом не закрыта', !win.document.getElementById('maint-screen'));
  ok('обратный отсчёт в часах и минутах', /Через 1 ч/.test(bar().textContent));
  ok('причина показана', /профилактика/i.test(bar().textContent));
  ok('страница подвинута под полосу', win.document.body.classList.contains('has-maint-soon'));

  // Причина приходит от владельца, но в разметку она попадает как текст.
  App.showMaintenanceSoon({ startAt: Date.now() + 3600000, until: 0, reason: '<img src=x onerror=alert(1)>' });
  ok('разметка в причине экранируется', !bar().querySelector('img'));

  console.log('\n── 9. Крестик и последние пять минут ──');
  App.showMaintenanceSoon({ startAt: Date.now() + 3600000, until: 0, reason: 'Профилактика' });
  bar().querySelector('.ms-x').onclick();
  ok('крестик прячет полосу', bar().style.display === 'none');
  ok('и возвращает страницу на место', !win.document.body.classList.contains('has-maint-soon'));

  // Полоса, висящая восемь часов, перестаёт восприниматься. Но за пять
  // минут до начала она снова важнее, чем нежелание её видеть.
  App._maintSoonHidden = true;
  App.showMaintenanceSoon({ startAt: Date.now() + 4 * 60000, until: 0, reason: 'Профилактика' });
  ok('за пять минут до начала полоса возвращается сама', bar().style.display !== 'none');
  ok('и выглядит тревожнее', bar().classList.contains('is-near'));
  ok('отсчёт в минутах', /Через 4 мин/.test(bar().textContent));

  console.log('\n── 10. Время пришло — спрашиваем сервер ──');
  // Ждать, пока игрок наткнётся на ошибку, значит показать ему поломку
  // вместо объяснения.
  ticks.length = 0;
  App._maintSoonHidden = false;
  App.showMaintenanceSoon({ startAt: Date.now() - 1000, until: 0, reason: 'Профилактика' });
  ok('полоса говорит, что обновление начинается', /начинается/i.test(bar().textContent));
  // Опрос обязан жить в СВОЁМ таймере: положи его туда же, где
  // перерисовка, — и она его затрёт, а игрок останется сидеть под
  // полосой «начинается» и никогда не узнает, что игру уже закрыли.
  ok('заведён отдельный опрос сервера', ticks.length === 2);
  const poll = ticks[0];

  worldAnswer = { maintenance: { on: true, reason: 'Плановая профилактика', until: 0, soon: null } };
  await poll();
  ok('полоса убрана', !bar());
  ok('и показан закрывающий экран', !!win.document.getElementById('maint-screen'));
  ok('с причиной от сервера',
     /профилактика/i.test(win.document.getElementById('maint-screen').textContent));

  console.log('\n── 11. Окно отменили, пока игрок ждал ──');
  win.document.getElementById('maint-screen').remove();
  ticks.length = 0;
  App.showMaintenanceSoon({ startAt: Date.now() - 1000, until: 0, reason: 'Профилактика' });
  worldAnswer = { maintenance: { on: false, soon: null } };
  await ticks[0]();
  ok('полоса ушла сама', !bar());
  ok('и запертой двери не появилось', !win.document.getElementById('maint-screen'));
  ok('страница вернулась на место', !win.document.body.classList.contains('has-maint-soon'));

  console.log('\n── 12. Само окно обновления ──');
  // Отдельный экран, а не всплывающее окно поверх игры: игра в этот
  // момент не работает, и оставлять её видимой под полупрозрачным
  // слоем значит показывать интерфейс, который ни на что не отвечает.
  win.document.getElementById('maint-screen') && win.document.getElementById('maint-screen').remove();
  App.showMaintenance({ on: true, reason: 'Ставим новые пушки.\nБудет лучше.', until: Date.now() + 20 * 60000 });
  const scr = () => win.document.getElementById('maint-screen');
  ok('экран показан', !!scr());
  ok('игра под ним спрятана, а не просвечивает',
     win.document.getElementById('wrap').style.display === 'none');
  ok('это отдельный экран, а не окно внутри игры',
     scr().parentElement === win.document.body);

  console.log('\n── 13. Текст владельца ──');
  const reason = scr().querySelector('.maint-reason');
  ok('текст показан целиком', /новые пушки/.test(reason.textContent));
  ok('перенос строки сохранён', /\n/.test(reason.textContent));
  ok('и второй абзац на месте', /Будет лучше/.test(reason.textContent));
  ok('срок показан', /20 мин/.test(scr().querySelector('.maint-left').textContent));

  // Текст пишет владелец, но разметка из него в страницу попадать не
  // должна: одна кривая вставка — и экран недоступности сломан у всех.
  scr().remove();
  App.showMaintenance({ on: true, reason: '<img src=x onerror=alert(1)><b>жирно</b>', until: 0 });
  ok('разметка в тексте не исполняется', !scr().querySelector('.maint-reason b'));
  ok('и показана как текст', /жирно/.test(scr().querySelector('.maint-reason').textContent));
  ok('срок не назван — строки про остаток нет', scr().querySelector('.maint-left').hidden === true);

  console.log('\n── 14. Окно не закрывается руками ──');
  // Кнопка на экране есть ровно одна — «Проверить сейчас». Она не
  // закрывает окно, а спрашивает сервер: закрыть его может только сам
  // сервер, сказав «игра работает».
  const btns = Array.from(scr().querySelectorAll('button'));
  ok('единственная кнопка — «Проверить сейчас»',
     btns.length === 1 && /Проверить сейчас/.test(btns[0].textContent));
  ok('и крестика тоже', !scr().querySelector('.ms-x'));
  scr().click();
  ok('клик по экрану его не убирает', !!scr());
  win.document.body.click();
  ok('и клик мимо тоже', !!scr());

  console.log('\n── 15. Карусель ──');
  scr().remove();
  ticks.length = 0;
  App.showMaintenance({ on: true, reason: 'Обновление', until: 0 });
  const imgs = scr().querySelectorAll('.maint-slides img');
  const pips = scr().querySelectorAll('.maint-pips i');
  ok('картинок несколько', imgs.length === App._MAINT_PICS.length && imgs.length > 1);
  ok('и столько же отметок', pips.length === imgs.length);
  ok('ровно одна показана', scr().querySelectorAll('.maint-slides img.on').length === 1);
  ok('остальные грузятся лениво — окно не тянет всё сразу',
     Array.from(imgs).filter((i) => i.getAttribute('loading') === 'lazy').length === imgs.length - 1);

  const shown = () => Array.from(imgs).findIndex((i) => i.classList.contains('on'));
  const first = shown();
  const rotate = ticks[0];              // первый заведённый таймер — карусель
  await rotate();
  ok('картинка сменилась', shown() !== first);
  ok('отметка переехала за ней', pips[shown()].classList.contains('on'));
  ok('и по-прежнему показана ровно одна',
     scr().querySelectorAll('.maint-slides img.on').length === 1);
  // Полный круг: карусель обязана вернуться к началу, а не упереться
  // в конец списка и застыть.
  for (let i = 0; i < imgs.length; i++) await rotate();
  ok('после полного круга снова первая', shown() === (first + imgs.length + 1) % imgs.length
     || shown() === first);

  console.log('\n── 16. Окно закрывается само ──');
  // Именно перезагрузкой: за время обновления поменялись и код, и
  // разметка, так что «просто спрятать окно» оставило бы игрока на
  // старой версии игры.
  // location.reload() в jsdom не подменяется ничем, поэтому в app.js
  // перезагрузка вынесена в App._reload() — один шов ради проверяемости.
  let reloaded = 0;
  App._reload = () => { reloaded++; };
  const askServer = ticks[2];           // третий таймер — опрос сервера
  worldAnswer = { maintenance: { on: true, reason: 'Ещё идёт', until: 0, soon: null } };
  await askServer();
  ok('пока игра закрыта — окно на месте', !!scr() && reloaded === 0);
  ok('и текст обновился с сервера', /Ещё идёт/.test(scr().querySelector('.maint-reason').textContent));

  worldAnswer = { maintenance: { on: false, soon: null } };
  await askServer();
  ok('игру открыли — страница перезагрузилась сама', reloaded === 1);

  console.log('\n── 17. Застрявшее окно чинится кнопкой ──');
  // «Страница откроется сама» иногда не выполняется — кэш, спящая
  // вкладка, чужая ошибка. Тогда у человека должен быть выход, не
  // требующий знать про Ctrl+Shift+R.
  scr() && scr().remove();
  ticks.length = 0;
  reloaded = 0;
  worldAnswer = { maintenance: { on: true, reason: 'Идёт', until: 0, soon: null } };
  App.showMaintenance({ on: true, reason: 'Идёт', until: 0 });
  const again = scr().querySelector('.maint-again');
  ok('кнопка есть', !!again);
  // Именно «нажимается», а не «нарисована»: кнопка без обработчика
  // выглядит на скриншоте так же, а человеку не помогает ничем.
  ok('и она живая', !!again && typeof again.onclick === 'function');
  if (!again || typeof again.onclick !== 'function') {
    ok('нажатие спросило сервер и перезагрузило', false);
  } else {
  worldAnswer = { maintenance: { on: false, soon: null } };
  await again.onclick();
  await new Promise((r) => setTimeout(r, 0));
  ok('нажатие спросило сервер и перезагрузило', reloaded === 1);
  }

  console.log('\n── 18. Ошибка перезагрузки не хоронит окно навсегда ──');
  // Раньше ловушка стояла вокруг ВСЕГО блока, включая перезагрузку.
  // Стоило App._reload оказаться недоступным — исключение молча
  // съедалось, и окно висело над работающей игрой вечно.
  scr() && scr().remove();
  ticks.length = 0;
  let attempts = 0;
  App._reload = () => { attempts++; throw new TypeError('App._reload is not a function'); };
  worldAnswer = { maintenance: { on: true, reason: 'Идёт', until: 0, soon: null } };
  App.showMaintenance({ on: true, reason: 'Идёт', until: 0 });
  worldAnswer = { maintenance: { on: false, soon: null } };
  let blew = false;
  try { await ticks[2](); } catch (e) { blew = true; }
  ok('поломка перезагрузки видна, а не проглочена', blew === true && attempts === 1);
  // И следующая попытка всё равно случится: таймер живёт своей жизнью.
  App._reload = () => { attempts++; };
  await ticks[2]();
  ok('следующая проверка всё равно перезагружает', attempts === 2);

  console.log('\n── 19. pollMe тоже умеет убрать окно ──');
  // Ветки «обновление сняли» в pollMe не было вовсе: окно умело
  // появиться, но не умело исчезнуть.
  scr() && scr().remove();
  reloaded = 0;
  App._reload = () => { reloaded++; };
  App.showMaintenance({ on: true, reason: 'Идёт', until: 0 });
  ok('окно показано', !!scr());
  win.API.get = async () => ({ name: 'Боец', gold: 1 });   // maintenance больше нет
  win.API.token = () => 'токен';
  await App.pollMe();
  ok('pollMe увидел, что обновление снято, и перезагрузил', reloaded === 1);

  console.log('\n── 20. Окно честно признаётся, что устарело ──');
  // Главный изъян прошлой версии: экран одинаково выглядел и когда
  // обновление правда идёт, и когда связи нет полчаса, а игра давно
  // работает. Человек не мог отличить «ждём» от «врёт».
  scr() && scr().remove();
  ticks.length = 0;
  App._maintSeen = Date.now();
  App._reload = () => {};
  App.showMaintenance({ on: true, reason: 'Идёт', until: 0 });
  const staleLine = () => scr().querySelector('.maint-stale');
  ok('пока связь есть — про устаревание молчим', staleLine().hidden === true);

  // Связь пропала: сервер не отвечает.
  win.fetch = async () => { throw new Error('сеть недоступна'); };
  App._maintSeen = Date.now() - 5 * 60000;      // последний ответ пять минут назад
  await ticks[2]();
  ok('сказано, что связи нет', staleLine().hidden === false);
  ok('и сколько именно минут', /5 мин/.test(staleLine().textContent));
  ok('и что окно могло устареть', /устарело/i.test(staleLine().textContent));
  ok('окно при этом не убрано — решает сервер, а не догадка', !!scr());

  // Связь вернулась — признание убирается.
  win.fetch = async () => ({ json: async () => ({ maintenance: { on: true, reason: 'Идёт', until: 0, soon: null } }) });
  await ticks[2]();
  ok('связь вернулась — строка про устаревание убрана', staleLine().hidden === true);

  console.log('\n── 21. Если перезагрузка не сработала — окно всё равно уходит ──');
  // Пусть игрок окажется на старой разметке, чем перед вечной заглушкой
  // над работающей игрой.
  scr() && scr().remove();
  ticks.length = 0;
  const realTimeout = win.setTimeout;
  const delayed = [];
  win.setTimeout = (fn, ms) => { delayed.push({ fn, ms }); return delayed.length; };
  App._reload = () => {};                        // «перезагрузка» ничего не делает
  App.showMaintenance({ on: true, reason: 'Идёт', until: 0 });
  worldAnswer = { maintenance: { on: false, soon: null } };
  win.fetch = async () => ({ json: async () => worldAnswer });
  await ticks[2]();
  ok('окно ещё на месте — даём перезагрузке шанс', !!scr());
  const fallback = delayed.find((d) => d.ms === 3000);
  ok('подстраховка заведена', !!fallback);
  fallback.fn();
  ok('через три секунды окно убрано', !scr());
  ok('и игра показана обратно', win.document.getElementById('wrap').style.display === '');
  win.setTimeout = realTimeout;

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
