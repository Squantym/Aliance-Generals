// ═══════════════════════════════════════════════════════════════════
// test/regform.test.js — форма регистрации в живом DOM
//
// Здесь проверяется то, что игрок ВИДИТ и НАЖИМАЕТ, а не то, что
// написано в исходнике. Разница принципиальная: проверка вида
// «в файле есть строка rg-age» останется зелёной, даже если отметку
// перестали показывать, перестали читать при отправке или проставили
// заранее — а это ровно те три способа, которыми согласие превращается
// в пустую формальность.
//
// Поэтому экран отрисовывается в настоящем jsdom, отметки нажимаются, а
// запрос перехватывается и разбирается: ушёл ли он вообще и что в нём.
//
// Отдельно про предустановленные галки. Согласие, проставленное за
// человека, согласием не является — молчание и заранее отмеченный
// чекбокс закон прямо не признаёт. Это первая проверка ниже.
//
// Запуск: node test/regform.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) {}
if (!JSDOM) { console.log('⛔ jsdom не установлен'); process.exit(1); }

const coreSrc = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');

// Поднимаем экран входа в чистом DOM. В сеть не ходим: нас интересует
// одно — какой запрос форма СОБЕРЁТСЯ отправить.
function boot() {
  const dom = new JSDOM('<!doctype html><body><div id="content"></div></body>',
    { url: 'https://aliance-general.ru/', runScripts: 'outside-only' });
  const win = dom.window;
  const toasts = [];
  const sent = [];

  win.UI = {
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    toast: (t) => toasts.push(String(t)),
    confirm: async () => true, prompt: async () => null,
  };
  win.API = {
    token: () => '',
    setToken() {},
    // Экран запрашивает список стран прежде, чем что-либо нарисовать.
    get: async (url) => (/countries/.test(url)
      ? { countries: [{ id: 'ru', name: 'Россия', flag: '🇷🇺', bonus: 'бонус', desc: 'бонус', gold: 10 }] }
      : {}),
    post: async (url, body) => { sent.push({ url, body }); return { needCode: true }; },
  };
  win.App = {
    screens: {},
    me: null,
    theme: () => 'classic',
    go() {}, rerender() {}, route() {},
    refreshMe: async () => {},
    _flagImg: () => '',
    isStandalone: () => false, canInstall: () => false, pushSupported: () => false,
    isIOS: () => false,
  };
  win.eval(coreSrc);
  return { win, toasts, sent, App: win.App };
}

async function renderAuth() {
  const b = boot();
  const c = b.win.document.getElementById('content');
  await b.App.screens.auth(c);
  // Экран открывается на вкладке входа — переключаемся на регистрацию.
  const tab = c.querySelector('[data-tab="reg"]') || c.querySelector('#tab-reg');
  if (tab && tab.click) tab.click();
  return { ...b, c };
}

(async () => {
  const { win, c, toasts, sent } = await renderAuth();

  console.log('\n── 1. Отметки есть и ни одна не проставлена заранее ──');
  const boxes = {
    age: c.querySelector('#rg-age'),
    terms: c.querySelector('#rg-terms'),
    pdn: c.querySelector('#rg-pdn'),
    pub: c.querySelector('#rg-public'),
    ads: c.querySelector('#rg-ads'),
  };
  for (const [k, el] of Object.entries(boxes)) {
    ok(`отметка «${k}» есть в форме`, !!el && el.type === 'checkbox');
  }
  for (const [k, el] of Object.entries(boxes)) {
    ok(`отметка «${k}» пустая по умолчанию`, !!el && el.checked === false);
  }

  console.log('\n── 2. Документы доступны прямо из формы ──');
  // Прочитать документ игрок должен ДО того, как согласится, а не
  // разыскивая ссылку в подвале страницы.
  const links = Array.from(c.querySelectorAll('#rg-consents a')).map((a) => a.getAttribute('href'));
  for (const href of ['/terms.html', '/privacy.html', '/consent-pdn.html', '/consent-public.html', '/consent-ads.html']) {
    ok(`ссылка на ${href} рядом с отметкой`, links.includes(href));
  }
  ok('ссылки открываются в новой вкладке — заполненная форма не теряется',
     Array.from(c.querySelectorAll('#rg-consents a')).every((a) => a.getAttribute('target') === '_blank'));

  console.log('\n── 3. Без отметок форма ничего не отправляет ──');
  const fill = () => {
    c.querySelector('#rg-name').value = 'Боец';
    c.querySelector('#rg-email').value = 'a@t.ru';
    c.querySelector('#rg-pass').value = 'пароль123';
  };
  fill();
  const go = c.querySelector('#rg-go');
  await go.onclick();
  ok('запрос не ушёл', sent.length === 0);
  ok(`сказано про возраст: «${toasts[toasts.length - 1]}»`, /18 лет/.test(toasts[toasts.length - 1] || ''));

  boxes.age.checked = true;
  await go.onclick();
  ok('всё ещё не ушёл — нет принятия соглашения', sent.length === 0);
  ok('и названо, чего не хватает', /Соглашение/i.test(toasts[toasts.length - 1] || ''));

  boxes.terms.checked = true;
  await go.onclick();
  ok('и без согласия на обработку данных не ушёл', sent.length === 0);
  ok('сказано про персональные данные', /персональн/i.test(toasts[toasts.length - 1] || ''));

  console.log('\n── 4. С обязательными отметками запрос уходит ──');
  boxes.pdn.checked = true;
  await go.onclick();
  ok('запрос ушёл', sent.length === 1);
  const body = sent[0].body || {};
  ok('на нужный адрес', sent[0].url === '/api/register');
  ok('согласия приложены', !!body.consents);
  ok('обязательные помечены', body.consents.age18 === true && body.consents.terms === true
     && body.consents.pdn === true);
  // Необязательные не должны «подтянуться» заодно: их игрок не отмечал.
  ok('реклама НЕ включена сама собой', body.consents.ads === false);
  ok('публичный профиль НЕ включён сам собой', body.consents.public === false);

  console.log('\n── 5. Категории публичности спрашиваются отдельно ──');
  const parts = c.querySelector('#rg-public-parts');
  ok('блок категорий есть', !!parts);
  ok('и спрятан, пока разрешение не дано', parts.style.display === 'none');
  boxes.pub.checked = true;
  boxes.pub.onchange();
  ok('раскрывается по отметке', parts.style.display !== 'none');
  const partBoxes = Array.from(parts.querySelectorAll('input[data-pub]'));
  ok(`категорий четыре (${partBoxes.length})`, partBoxes.length === 4);
  ok('перечислены поимённо',
     ['nick', 'flag', 'stats', 'ally'].every((id) => partBoxes.some((el) => el.getAttribute('data-pub') === id)));

  partBoxes.find((el) => el.getAttribute('data-pub') === 'flag').checked = false;
  await go.onclick();
  const body2 = sent[sent.length - 1].body;
  ok('публичный профиль разрешён', body2.consents.public === true);
  ok('снятая категория ушла как запрет', body2.consents.publicScope.flag === false);
  ok('остальные — как разрешение', body2.consents.publicScope.nick === true
     && body2.consents.publicScope.stats === true);

  console.log('\n── 6. Реклама на регистрацию не влияет ──');
  // Согласие на рекламу не может быть условием регистрации. Проверяем
  // прямо: без него запрос уходит, с ним — тоже.
  ok('без рекламы регистрация прошла', sent.some((x) => x.body.consents.ads === false));
  boxes.ads.checked = true;
  await go.onclick();
  ok('с рекламой — тоже', sent[sent.length - 1].body.consents.ads === true);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
