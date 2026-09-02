// ═══════════════════════════════════════════════════════════════════
// test/testaccount_ui.test.js — выдача аккаунтов в панели
//
// Форма существовала и раньше, но жила на экране «Обновление». Искать
// её приходили в «Игроки» — и не находили, потому что заводить аккаунты
// это работа с игроками, а не с выкатом. Функция была, пользы не было.
//
// Здесь стережётся:
//   1. Форма на экране «Игроки» и только в ТЕСТОВОМ мире.
//   2. На боевом её нет вовсе — там регистрация без подтверждения почты
//      была бы дырой. Запрет стоит и на сервере, но рисовать кнопку,
//      которая всегда отказывает, незачем.
//   3. Пароль показывается ОДИН раз после создания: в базе он лежит
//      только хешем, а передать тестировщику его надо.
//
// Запуск: node test/testaccount_ui.test.js
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

async function boot(isTest) {
  const dom = new JSDOM('<!doctype html><body><div id="c"></div></body>',
    { url: 'https://test.aliance-general.ru/admin', runScripts: 'outside-only' });
  const win = dom.window;
  const posted = [];
  const toasts = [];
  win.UI = { esc: ESC, toast: (t) => toasts.push(String(t)) };
  win.API = {
    get: async (url) => {
      if (url === '/api/world') return { test: { on: isTest, name: 'Тестовый мир' } };
      return { players: [] };
    },
    post: async (url, body) => {
      posted.push({ url, body });
      return { login: body.login, password: body.password, note: 'Почта подтверждена.' };
    },
  };
  win.A2 = { screens: {}, crumbs: () => {}, refresh: () => {} };
  win.A2Router = { go: () => {}, build: () => '#', setQuery: () => {} };
  win.Admin = {};
  win.eval(fs.readFileSync(path.join(ROOT, 'public/js/admin2/players.js'), 'utf8'));
  win.A2.screens.players(win.document.getElementById('c'), { query: {} });
  await new Promise((r) => setTimeout(r, 40));   // мир узнаётся отдельным запросом
  return { win, posted, toasts };
}

(async () => {
  console.log('\n── 1. В тестовом мире форма есть, и она в «Игроках» ──');
  const t = await boot(true);
  const d = t.win.document;
  ok('карточка выдачи показана', !!d.getElementById('pls-new').innerHTML.trim());
  ok('поле позывного', !!d.getElementById('ta-login'));
  ok('поле пароля', !!d.getElementById('ta-pass'));
  ok('кнопка создания', !!d.getElementById('ta-go'));
  ok('кнопка «придумать за меня»', !!d.getElementById('ta-rand'));
  ok('и она на экране игроков, а не выката',
     d.getElementById('pls-new').closest('#c') === d.getElementById('c'));

  console.log('\n── 2. «Придумать за меня» заполняет оба поля ──');
  d.getElementById('ta-rand').onclick();
  ok('позывной подставлен', /^Тестер\d{3}$/.test(d.getElementById('ta-login').value));
  ok('пароль подставлен и не короче восьми',
     d.getElementById('ta-pass').value.length >= 8);

  console.log('\n── 3. Короткий пароль не уходит на сервер ──');
  d.getElementById('ta-login').value = 'Боец';
  d.getElementById('ta-pass').value = 'abc';
  await d.getElementById('ta-go').onclick();
  ok('запрос не отправлен', t.posted.length === 0);
  ok('и объяснено почему', /8 символов/.test(t.toasts.join(' ')));

  console.log('\n── 4. Создание и показ пароля ──');
  d.getElementById('ta-login').value = 'Командир';
  d.getElementById('ta-pass').value = 'parol12345';
  await d.getElementById('ta-go').onclick();
  ok('запрос ушёл', t.posted.length === 1);
  ok('адрес верный', t.posted[0].url === '/api/admin/test-account');
  ok('позывной передан', t.posted[0].body.login === 'Командир');
  const out = d.getElementById('ta-out').innerHTML;
  ok('пароль показан один раз', /parol12345/.test(out));
  ok('и сказано, что больше его не увидеть', /хеш/i.test(out));
  ok('поля очищены — второй аккаунт не создастся случайно',
     d.getElementById('ta-login').value === '' && d.getElementById('ta-pass').value === '');

  console.log('\n── 5. На боевом форму не рисуем вовсе ──');
  const p = await boot(false);
  ok('карточки нет', !p.win.document.getElementById('pls-new').innerHTML.trim());
  ok('и полей тоже', !p.win.document.getElementById('ta-login'));

  console.log('\n── 6. Со старого места убрана, но след оставлен ──');
  // Иначе тот, кто помнит её на «Обновлении», решит, что функция пропала.
  const rel = fs.readFileSync(path.join(ROOT, 'public/js/admin2/release.js'), 'utf8');
  ok('формы на экране выката больше нет', !/id="ta-login"/.test(rel));
  ok('обработчиков тоже', !/'ta-go'/.test(rel));
  ok('но указано, куда она переехала', /Игроки/.test(rel));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
