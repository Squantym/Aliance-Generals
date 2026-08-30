// ═══════════════════════════════════════════════════════════════════
// test/security2fa.test.js — экран «Защита входа» в живом DOM
//
// Повод для этого теста — настоящая поломка на боевом сервере.
// Владелец включил второй фактор, ввёл код, увидел коды восстановления —
// и остался перед шапкой «Второй фактор: НЕ ЗАВЕРШЁН» с кнопкой
// «Показать ключ заново». На сервере фактор был уже включён; врал
// экран. Обработчик стирал форму подтверждения и дорисовывал коды, но
// шапку не перерисовывал, а кнопки «готово» не было вовсе.
//
// Отсюда и то, что стережётся:
//
//  1. ПОСЛЕ ВКЛЮЧЕНИЯ ЭКРАН ГОВОРИТ «ВКЛЮЧЁН». Экран, который врёт про
//     состояние защиты, хуже отсутствующего: человек идёт включать
//     заново и упирается в «второй фактор уже включён».
//
//  2. КОДЫ ПРИ ЭТОМ НЕ ПРОПАДАЮТ. Показать их повторно не может никто —
//     в базе только хеши. Перерисовка, смывающая коды, отняла бы у
//     сотрудника единственный запасной путь.
//
//  3. ЕСТЬ ЯВНОЕ «Я СОХРАНИЛ КОДЫ». Без него не понять, что дело
//     кончено, — ровно то, на чём споткнулся владелец.
//
//  4. САМ ЭКРАН НЕ ЗАКРЫВАЕТСЯ, ПОКА КОДЫ НЕ ПОДТВЕРЖДЕНЫ.
//
// Запуск: node test/security2fa.test.js
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

const CODES = ['AAAA1-BBBB1', 'AAAA2-BBBB2', 'AAAA3-BBBB3', 'AAAA4-BBBB4'];

// Поддельный сервер: держит состояние второго фактора и ведёт себя как
// настоящий — enable проверяет код и переводит состояние в «включён».
function boot(startState) {
  const dom = new JSDOM('<!doctype html><body><div id="content"></div></body>',
    { url: 'https://aliance-general.ru/', runScripts: 'outside-only' });
  const win = dom.window;
  const toasts = [];
  let st = Object.assign({ enabled: false, pending: false, recoveryLeft: 0, enabledAt: 0 }, startState);
  const calls = [];

  win.UI = { esc: ESC, toast: (t) => toasts.push(String(t)), confirm: async () => true };
  win.navigator.clipboard = { writeText: async () => {} };
  win.API = {
    get: async (url) => { calls.push(url); return Object.assign({}, st); },
    post: async (url, body) => {
      calls.push(url);
      if (/setup/.test(url)) { st.pending = true; return { secret: 'ABCDEFGHIJKLMNOP', digits: 6, step: 30 }; }
      if (/enable/.test(url)) {
        if (body.code !== '123456') throw new Error('Код не подошёл');
        st = { enabled: true, pending: false, recoveryLeft: CODES.length, enabledAt: Date.now() };
        return { enabled: true, recoveryCodes: CODES.slice() };
      }
      if (/recovery/.test(url)) { st.recoveryLeft = CODES.length; return { recoveryCodes: CODES.slice() }; }
      return {};
    },
  };
  win.A2 = { screens: {}, refresh() {} };
  win.eval(fs.readFileSync(path.join(ROOT, 'public/js/admin2/security.js'), 'utf8'));
  const el = win.document.getElementById('content');
  return {
    win, el, toasts, calls,
    state: () => st,
    render: () => win.A2.screens.security(el),
    q: (id) => win.document.getElementById(id),
    text: () => el.textContent,
  };
}

(async () => {
  console.log('\n── 1. Фактор ещё не подключён ──');
  const p = boot({ enabled: false, pending: false });
  await p.render();
  ok('сказано, что выключен', /выключен/i.test(p.text()));
  ok('есть кнопка «Подключить»', !!p.q('sec-start'));
  ok('кодов восстановления пока нет', !p.q('sec-copy'));

  console.log('\n── 2. Ключ выдан, ждём подтверждения ──');
  await p.q('sec-start').onclick();
  ok('ключ показан', /[A-Z]{4}/.test(p.text()));
  ok('есть поле для кода', !!p.q('sec-confirm'));
  ok('и кнопка «Включить»', !!p.q('sec-enable'));

  console.log('\n── 3. Неверный код ничего не включает ──');
  p.q('sec-confirm').value = '000000';
  await p.q('sec-enable').onclick();
  ok('фактор не включился', p.state().enabled === false);
  ok('и сказано почему', /не подошёл/i.test(p.toasts.join(' ')));
  ok('коды не показаны', !p.q('sec-copy'));

  console.log('\n── 4. Верный код: экран обязан сказать «включён» ──');
  // Вот это и было сломано на боевом: фактор включался, а шапка
  // продолжала показывать «не завершён» с кнопкой «Показать ключ заново».
  p.q('sec-confirm').value = '123456';
  await p.q('sec-enable').onclick();
  ok('на сервере фактор включён', p.state().enabled === true);
  ok('и экран это показывает', /включён/.test(p.text()));
  ok('слов «не завершён» на экране больше нет', !/не завершён/i.test(p.text()));
  ok('кнопки «Показать ключ заново» больше нет', !p.q('sec-start'));
  ok('формы подтверждения тоже', !p.q('sec-enable') && !p.q('sec-confirm'));
  ok('видно явное подтверждение, что всё готово', /Готово/.test(p.text()));

  console.log('\n── 5. Коды при этом на месте ──');
  // Повторить показ не может никто: в базе только хеши. Перерисовка,
  // смывающая коды, отняла бы единственный запасной путь.
  for (const c of CODES) ok(`код показан: ${c}`, p.text().indexOf(c) >= 0);
  ok('есть «Скопировать все»', !!p.q('sec-copy'));
  ok('и предупреждение не фотографировать экран', /фотографируйте/i.test(p.text()));

  console.log('\n── 6. Есть кнопка «Я сохранил коды» ──');
  ok('кнопка на месте', !!p.q('sec-saved'));
  await p.q('sec-saved').onclick();
  // Даём перерисовке дойти до конца — она спрашивает состояние у сервера.
  await new Promise((r) => setTimeout(r, 0));
  ok('после неё коды убраны с экрана', p.text().indexOf(CODES[0]) < 0);
  ok('а фактор так и показан включённым', /включён/.test(p.text()));
  ok('и осталось видно, сколько кодов', /4/.test(p.text()));

  console.log('\n── 7. Новые коды взамен утёкших ──');
  // Снимок кодов равен снятому второму фактору. Выпуск новых обязан
  // сразу обесценить старые и показать новые — иначе человек, у
  // которого коды утекли, останется вообще без запасного пути.
  ok('есть кнопка выпуска новых', !!p.q('sec-newcodes'));
  await p.q('sec-newcodes').onclick();
  ok('без кода из приложения новые не выдаются',
     /Введите код/i.test(p.toasts.join(' ')));
  p.q('sec-code').value = '123456';
  await p.q('sec-newcodes').onclick();
  await new Promise((r) => setTimeout(r, 0));
  ok('новые коды показаны', p.text().indexOf(CODES[0]) >= 0);
  ok('и сказано, что старые больше не работают',
     /не работают/i.test(p.toasts.join(' ')));
  ok('и снова есть «Я сохранил коды»', !!p.q('sec-saved'));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
