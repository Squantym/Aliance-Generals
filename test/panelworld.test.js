// ═══════════════════════════════════════════════════════════════════
// test/panelworld.test.js — панель говорит, в каком она мире
//
// Панели боевого и тестового мира выглядели ОДИНАКОВО. Различить их
// можно было только по адресу в строке браузера — а вкладки у владельца
// открыты обе, и обе называются «Альянс Генералов».
//
// В самой игре полоса «ТЕСТОВЫЙ МИР» есть давно, но панель грузит свои
// файлы, app.js в неё не попадает, и пометка до неё не доходила вовсе.
// При этом цена ошибки в панели выше всего: выдать ресурсы, забанить
// или обнулить мир не в той вкладке — это не опечатка, а происшествие.
//
// Запуск: node test/panelworld.test.js
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

// Мир отдаёт /api/world; ошибка запроса не должна ронять панель.
function boot(worldAnswer, shouldThrow) {
  const dom = new JSDOM('<!doctype html><body><div id="a2-root"></div></body>',
    { url: 'https://test.aliance-general.ru/admin2.html', runScripts: 'outside-only' });
  const win = dom.window;
  win.UI = { esc: ESC, toast: () => {} };
  win.API = {
    get: async () => { if (shouldThrow) throw new Error('сеть недоступна'); return worldAnswer; },
  };
  win.Admin = { me: { name: 'Хозяин', staffRole: 'owner' } };
  win.A2Router = { parse: () => ({ name: 'queue' }), build: () => '#', go: () => {} };
  const A2 = win.eval(fs.readFileSync(path.join(ROOT, 'public/js/admin2/shell.js'), 'utf8') + '\n;A2');
  win.A2 = A2;
  return { win, A2 };
}

(async () => {
  console.log('\n── 1. В тестовом мире панель кричит об этом ──');
  let { win, A2 } = boot({ test: { on: true, name: 'Полигон' } });
  await A2.markWorld();
  const bar = () => win.document.getElementById('a2-world-bar');
  ok('полоса появилась', !!bar());
  ok('названо имя мира', /Полигон/.test(bar().textContent));
  ok('и прямо сказано, что это не боевая игра', /НЕ боевая/.test(bar().textContent));
  ok('телу проставлена метка для стилей', win.document.body.classList.contains('a2-is-test'));

  console.log('\n── 2. Дважды не рисуем ──');
  // markWorld зовётся из boot, а панель перерисовывает оболочку при
  // смене прав — гирлянда из полос выглядела бы поломкой.
  await A2.markWorld();
  await A2.markWorld();
  ok('полоса по-прежнему одна', win.document.querySelectorAll('#a2-world-bar').length === 1);

  console.log('\n── 3. На боевом полосы нет ──');
  // Отсутствие полосы и означает «это боевой мир». Рисовать её там —
  // приучать не читать: пометка, которая висит всегда, перестаёт
  // замечаться ровно тогда, когда важна.
  ({ win, A2 } = boot({ test: { on: false, name: '' } }));
  await A2.markWorld();
  ok('полосы нет', !win.document.getElementById('a2-world-bar'));
  ok('и метки на теле тоже', !win.document.body.classList.contains('a2-is-test'));

  console.log('\n── 4. Сервер не ответил — панель работает дальше ──');
  ({ win, A2 } = boot(null, true));
  let threw = false;
  try { await A2.markWorld(); } catch (e) { threw = true; }
  ok('markWorld не бросает наружу', !threw);
  ok('полосы нет, но панель цела', !win.document.getElementById('a2-world-bar'));

  console.log('\n── 5. Стили полосы есть и она поверх всего ──');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/admin2.css'), 'utf8');
  // Селектор именно по КЛАССУ, а не по идентификатору: все стили панели
  // обязаны быть ограничены .a2, иначе они протекут в игру. За этим
  // следит admin2.test.js — и поймал эту полосу, когда я описал её
  // через #id.
  ok('полоса описана классом', /\.a2-world-bar\s*\{/.test(css));
  ok('она закреплена сверху', /\.a2-world-bar[\s\S]{0,200}position:\s*fixed/.test(css));
  ok('и панель сдвинута, чтобы полоса ничего не закрыла',
     /body\.a2-is-test\s+#a2-root[\s\S]{0,80}padding-top/.test(css));

  console.log('\n── 6. Панель действительно зовёт пометку при запуске ──');
  // Иначе метод есть, тест зелёный, а в живой панели полосы нет.
  const shell = fs.readFileSync(path.join(ROOT, 'public/js/admin2/shell.js'), 'utf8');
  ok('markWorld вызывается из оболочки', /A2\.markWorld\(\);/.test(shell));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
