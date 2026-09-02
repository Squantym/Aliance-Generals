// ═══════════════════════════════════════════════════════════════════
// test/consentgate.test.js — окно подтверждения согласий
//
// Серверную часть стережёт test/consents.test.js. Здесь — то, что видит
// и нажимает человек, в настоящем jsdom.
//
// Что именно стережётся:
//
//  1. ОКНО ЗАКРЫВАЕТ ИГРУ. Оно появляется у тех, кто регистрировался до
//     появления отметок. Продолжать обработку данных «по умолчанию»
//     нельзя, поэтому игра под ним прячется целиком.
//
//  2. БЕЗ ОБЯЗАТЕЛЬНЫХ ОТМЕТОК КНОПКА НЕ ОТПРАВЛЯЕТ. Клиентская проверка
//     не заменяет серверную, но человек должен узнать о нехватке сразу,
//     а не после запроса.
//
//  3. ЗНАЧКИ СВОИ. Эмодзи рисуется шрифтом системы: где-то цветная
//     картинка, где-то чёрный контур, а на части Android — пустой
//     квадрат. То же и с системной галочкой: accent-color на iOS
//     оставляет её синей.
//
// Запуск: node test/consentgate.test.js
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

(async () => {
  const dom = new JSDOM('<!doctype html><body><div id="wrap"></div><div id="toasts"></div></body>',
    { url: 'https://aliance-general.ru/', runScripts: 'outside-only' });
  const win = dom.window;
  const toasts = [];
  const sent = [];
  win.UI = { esc: ESC, toast: (t) => toasts.push(String(t)) };
  win.API = { token: () => 'x', get: async () => ({}), post: async (u, b) => { sent.push({ u, b }); return {}; } };
  win.setInterval = () => 1; win.clearInterval = () => {};
  win.fetch = async () => ({ json: async () => ({}) });
  const App = win.eval(fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8') + '\n;App');
  win.App = App;

  console.log('\n── 1. Окно появляется и закрывает игру ──');
  App.showConsentGate(['age18', 'terms', 'pdn']);
  const gate = () => win.document.getElementById('consent-gate');
  ok('окно показано', !!gate());
  ok('игра под ним спрятана', win.document.getElementById('wrap').style.display === 'none');
  ok('это отдельный экран, а не окно внутри игры', gate().parentElement === win.document.body);

  console.log('\n── 2. Значок свой, а не эмодзи ──');
  const icon = gate().querySelector('.cg-icon');
  ok('значок на месте', !!icon);
  ok('нарисован разметкой, а не символом шрифта', !!icon.querySelector('svg'));
  ok('эмодзи в заголовке не осталось', !/[\u{1F300}-\u{1FAFF}]/u.test(icon.textContent || ''));

  console.log('\n── 3. Обязательное отделено от необязательного ──');
  // Человек проглядывает окно за пару секунд, и по одному слову
  // «необязательно» непонятно, к строке выше оно или ниже.
  const req = gate().querySelector('.cg-req');
  const opt = gate().querySelector('.cg-opt');
  ok('обязательные вынесены в свой блок', !!req);
  ok('необязательные — в свой', !!opt);
  ok('в обязательных ровно три отметки', req.querySelectorAll('input[type="checkbox"]').length === 3);
  ok('в необязательных две', opt.querySelectorAll('input[type="checkbox"]').length === 2);
  for (const id of ['age18', 'terms', 'pdn']) {
    ok(`«${id}» среди обязательных`, !!req.querySelector(`[data-cg="${id}"]`));
  }
  for (const id of ['public', 'ads']) {
    ok(`«${id}» среди необязательных`, !!opt.querySelector(`[data-cg="${id}"]`));
  }

  console.log('\n── 4. Пока обязательное не отмечено, запрос не уходит ──');
  const go = win.document.getElementById('cg-go');
  ok('кнопка есть', !!go);
  await go.onclick();
  ok('запрос не отправлен', sent.length === 0);
  ok('и сказано, чего не хватает', /18 лет/.test(toasts.join(' ')));

  gate().querySelector('[data-cg="age18"]').checked = true;
  await go.onclick();
  ok('после первой отметки всё ещё держит', sent.length === 0);
  ok('и называет следующее недостающее', /соглашение/i.test(toasts.join(' ')));

  console.log('\n── 5. Со всеми обязательными — отправляет ──');
  gate().querySelector('[data-cg="terms"]').checked = true;
  gate().querySelector('[data-cg="pdn"]').checked = true;
  gate().querySelector('[data-cg="ads"]').checked = true;
  await go.onclick();
  ok('запрос ушёл', sent.length === 1);
  const body = (sent[0].b || {}).consents || {};
  ok('адрес верный', sent[0].u === '/api/consents/accept-all');
  ok('обязательные переданы как принятые', body.age18 === true && body.terms === true && body.pdn === true);
  ok('отмеченное необязательное передано', body.ads === true);
  ok('неотмеченное — как отказ, а не молчанием', body.public === false);

  console.log('\n── 6. Галочка нарисована своя ──');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  ok('системный вид отключён', /\.rg-check input\[type="checkbox"\][\s\S]{0,200}appearance:\s*none/.test(css));
  ok('и accent-color больше не используется', !/\.rg-check input\[type="checkbox"\][\s\S]{0,200}accent-color/.test(css));
  ok('галочка рисуется псевдоэлементом', /\.rg-check input\[type="checkbox"\]:checked::after/.test(css));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
