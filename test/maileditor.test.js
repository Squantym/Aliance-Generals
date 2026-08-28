// ═══════════════════════════════════════════════════════════════════
// test/maileditor.test.js — визуальный редактор письма и чистка разметки
//
// Зачем он появился: раньше письмо правилось голой разметкой, и владелец
// писал теги руками. Оттуда и взялась поломка — человек увидел фигурные
// скобки, решил, что так задаётся любое значение, написал в теме
// {{Альянс Генералов}}, и почтовый сервис отклонил письмо целиком.
//
// Значит проверять надо не «кнопки нарисовались», а превращение туда и
// обратно: разметка → редактор → разметка. Если оно теряет ссылку или
// подстановку, письмо ломается ровно так же, только молча.
//
// Редактор гоняем в НАСТОЯЩЕМ DOM (jsdom), чистку — на модуле сервера.
//
// Запуск: node test/maileditor.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) {}
if (!JSDOM) { console.log('⛔ jsdom не установлен — проверка редактора невозможна'); process.exit(1); }

const mailJs = fs.readFileSync(path.join(ROOT, 'public/js/admin2/mail.js'), 'utf8');
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
const win = dom.window;
// Экрану нужны соседи по панели; для этой проверки хватит заглушек
win.A2 = { screens: {} };
win.UI = { esc: (s) => String(s), toast() {}, prompt: async () => null, confirm: async () => false };
win.API = { get: async () => ({}), post: async () => ({}) };
win.eval(mailJs);
const ME = win.MailEdit;

const editorWith = (html) => {
  const d = win.document.createElement('div');
  d.innerHTML = ME.toEditor(html);
  return d;
};
const roundTrip = (html) => ME.toHtml(editorWith(html));

(async () => {
  console.log('\n── 1. Подстановка в тексте становится меткой ──');
  const e1 = editorWith('<p>Привет, {{имя}}!</p>');
  const chips = e1.querySelectorAll('.mail-var');
  ok('метка появилась', chips.length === 1);
  ok('метка знает своё имя', chips[0].getAttribute('data-var') === 'имя');
  ok('метка не редактируется посимвольно', chips[0].getAttribute('contenteditable') === 'false');
  ok('фигурных скобок в тексте не осталось', !/\{\{/.test(e1.textContent));

  console.log('\n── 2. Ссылка кнопки не подменяется ──');
  // href="{{ссылка}}" — это адрес перехода. Если превратить его в метку,
  // кнопка в письме перестанет вести куда бы то ни было.
  const e2 = editorWith('<a href="{{ссылка}}">Подтвердить</a>');
  ok('адрес остался адресом', e2.querySelector('a').getAttribute('href') === '{{ссылка}}');
  ok('метки внутри ссылки не появилось', e2.querySelectorAll('.mail-var').length === 0);

  console.log('\n── 3. Туда и обратно ничего не теряется ──');
  const original = '<h2>Привет, {{имя}}!</h2>'
    + '<p>Игра «{{игра}}» ждёт. <a href="{{ссылка}}">Подтвердить почту</a></p>'
    + '<p>Или ссылкой: {{ссылка}} · {{сайт}}</p>';
  const back = roundTrip(original);
  ok('подстановка в тексте вернулась', back.includes('{{имя}}'));
  ok('и в адресе тоже', back.includes('href="{{ссылка}}"'));
  ok('видимая ссылка на месте', back.includes('{{ссылка}} · {{сайт}}'));
  ok('название игры сохранилось', back.includes('{{игра}}'));
  ok('меток в готовой разметке нет', !/mail-var/.test(back));
  ok('заголовок и абзацы целы', /<h2>/.test(back) && (back.match(/<p>/g) || []).length === 2);

  console.log('\n── 4. Заводской шаблон переживает круг ──');
  // Он со стилями на тегах — почтовые клиенты общий CSS вырезают
  const mailer = require(path.join(ROOT, 'dist/src/services/mailer.js'));
  for (const id of Object.keys(mailer.DEFAULTS)) {
    const src = mailer.DEFAULTS[id].html;
    const out = roundTrip(src);
    const varsIn = (src.match(/\{\{[^{}]+\}\}/g) || []).sort().join(',');
    const varsOut = (out.match(/\{\{[^{}]+\}\}/g) || []).sort().join(',');
    ok(`«${mailer.DEFAULTS[id].name}»: подстановки те же`, varsIn === varsOut);
    ok(`«${mailer.DEFAULTS[id].name}»: оформление кнопки цело`,
       !/background:#d9a546/.test(src) || /background:#d9a546/.test(out));
  }

  console.log('\n── 5. Кнопка перехода собирается со стилем ──');
  const btn = ME.linkButton('{{ссылка}}', 'Подтвердить почту');
  ok('это ссылка', btn.tagName === 'A');
  ok('ведёт куда просили', btn.getAttribute('href') === '{{ссылка}}');
  ok('стиль на самом теге — иначе почта его срежет', /background:#d9a546/.test(btn.getAttribute('style')));
  ok('надпись на месте', btn.textContent === 'Подтвердить почту');

  console.log('\n── 6. Правка текста рядом с меткой не ломает её ──');
  const e6 = editorWith('<p>Привет, {{имя}}!</p>');
  e6.querySelector('p').appendChild(win.document.createTextNode(' Рад видеть.'));
  const out6 = ME.toHtml(e6);
  ok('дописанный текст сохранился', out6.includes('Рад видеть.'));
  ok('подстановка не пострадала', out6.includes('{{имя}}'));

  console.log('\n── 7. Сервер чистит мусорную разметку ──');
  // Вставка из Word и с сайтов тащит теги, которые почтовые клиенты
  // режут по-своему: в панели письмо выглядит одним, у игрока — другим.
  const dirty = '<p style="color:#333">Текст</p>'
    + '<script>alert(1)</script>'
    + '<font face="Comic Sans">Ворд</font>'
    + '<p onclick="alert(2)">Клик</p>'
    + '<a href="javascript:alert(3)">Плохая</a>'
    + '<a href="https://aliance-general.ru">Хорошая</a>'
    + '<a href="{{ссылка}}">Наша</a>';
  const clean = mailer.sanitizeHtml(dirty);
  ok('скрипт вырезан вместе с содержимым', !/alert\(1\)/.test(clean) && !/<script/i.test(clean));
  ok('обработчик события снят', !/onclick/i.test(clean));
  ok('javascript-ссылка обезврежена', !/javascript:/i.test(clean));
  ok('чужой тег убран, а текст остался', !/<font/i.test(clean) && /Ворд/.test(clean));
  ok('нормальная ссылка цела', clean.includes('href="https://aliance-general.ru"'));
  ok('наша подстановка в адресе цела', clean.includes('href="{{ссылка}}"'));
  ok('стиль на абзаце сохранён', /style="color:#333"/.test(clean));
  ok('текст письма не потерян', /Текст/.test(clean) && /Клик/.test(clean));

  console.log('\n── 8. Чистка не портит заводские шаблоны ──');
  for (const id of Object.keys(mailer.DEFAULTS)) {
    const src = mailer.DEFAULTS[id].html;
    const out = mailer.sanitizeHtml(src);
    const varsIn = (src.match(/\{\{[^{}]+\}\}/g) || []).sort().join(',');
    const varsOut = (out.match(/\{\{[^{}]+\}\}/g) || []).sort().join(',');
    ok(`«${mailer.DEFAULTS[id].name}»: подстановки на месте`, varsIn === varsOut);
  }

  console.log('\n── 9. Экран панели собирается целиком ──');
  // Отдельные функции могут быть верны, а экран — падать на первой же
  // строке рендера, и тогда владелец видит пустую страницу.
  win.API.get = async () => ({
    templates: Object.keys(mailer.DEFAULTS).map((id) => ({
      id, name: mailer.DEFAULTS[id].name, about: mailer.DEFAULTS[id].about,
      vars: mailer.DEFAULTS[id].vars,
      subject: mailer.DEFAULTS[id].subject, html: mailer.DEFAULTS[id].html,
      isDefault: true, changedAt: 0, changedBy: '',
    })),
    mail: {
      configured: true, provider: 'smtpbz', from: 'Aliance Generals <noreply@aliance-general.ru>', hint: '',
      chain: [{ id: 'smtpbz', name: 'SMTP.BZ' }],
      hasBackup: false,
      quota: {
        limits: { day: 500, month: 15000, reserve: 300 },
        used: { day: 12, month: 480 },
        left: { day: 488, month: 14520, broadcast: 488 },
        byKind: { verify: 300, news: 180 },
        resetsAt: '1 сентября',
      },
    },
    audience: {
      ready: 69, total: 80, unverified: 8, noEmail: 3, banned: 0, canSend: 488,
      groups: [
        { id: 'all', name: 'Всем', about: 'все с подтверждённой почтой', count: 69, fits: true },
        { id: 'active', name: 'Активные', about: 'заходили за 14 дней', count: 40, fits: true },
        { id: 'sleeping', name: 'Спящие', about: 'не заходили 14 дней', count: 29, fits: true },
        { id: 'newbies', name: 'Новички', about: 'за 7 дней', count: 5, fits: true },
      ],
    },
    broadcast: { running: false, last: null },
  });
  const host = win.document.createElement('div');
  win.document.body.appendChild(host);
  let renderErr = null;
  try { await win.A2.screens.mail(host); } catch (e) { renderErr = e; }
  ok('экран отрисовался без ошибки', !renderErr);
  const editors = host.querySelectorAll('.mail-editor');
  ok(`редактор у каждого шаблона (${editors.length})`, editors.length === 4);
  ok('панель кнопок на месте', host.querySelectorAll('.mail-toolbar').length === 4);
  ok('метки подстановок вставлены в редактор', host.querySelectorAll('.mail-editor .mail-var').length > 0);
  ok('окно разметки спрятано за кнопкой «Код»', Array.from(host.querySelectorAll('.mail-code')).every((c) => c.hidden));
  // Проверка домена нужна при любом сервисе: письма чаще всего не
  // доходят из-за непрописанных записей DNS, а не из-за ключа.
  ok('кнопка проверки домена на месте', !!host.querySelector('#mail-diag'));

  console.log('\n── 11. Расход лимита и выбор получателей ──');
  ok('видно расход за сутки и за месяц', host.querySelectorAll('.mail-bar').length >= 2);
  ok('показан остаток рассылке', /Доступно рассылке/.test(host.textContent));
  ok('и неприкосновенный запас', /Запас на служебные/.test(host.textContent));
  ok('видна цепочка сервисов', host.querySelectorAll('.mail-chain-item').length === 1);
  // Сервис один — панель обязана сказать про единственную точку отказа,
  // а не молчать до дня, когда новые игроки перестанут получать коды.
  ok('и предупреждение, что запасного нет', /Сервис один/.test(host.textContent));
  ok('основной помечен', !!host.querySelector('.mail-chain-item.is-main'));
  const groups = host.querySelectorAll('.mail-group');
  ok(`группы получателей на выбор (${groups.length})`, groups.length === 4);
  ok('по умолчанию выбрано «Всем»', host.querySelector('input[name="bc-group"]:checked').value === 'all');
  ok('у каждой группы видно число', /Активные/.test(host.textContent) && /40/.test(host.textContent));
  const first = host.querySelector('.mail-editor');
  ok('в редакторе виден текст письма, а не теги', !/</.test(first.textContent));

  console.log('\n── 10. Кнопка «Код» переносит правку в обе стороны ──');
  const card = host.querySelector('[data-tpl]');
  const ed = card.querySelector('.mail-editor');
  const codeBox = card.querySelector('.mail-code');
  ed.appendChild(win.document.createTextNode(' ДОПИСАНО'));
  card.querySelector('.tpl-codetoggle').click();
  ok('правка видна в разметке', codeBox.value.includes('ДОПИСАНО'));
  ok('подстановки в разметке снова в скобках', codeBox.value.includes('{{имя}}'));
  codeBox.value = codeBox.value.replace('ДОПИСАНО', 'ИЗМЕНЕНО В КОДЕ');
  card.querySelector('.tpl-codetoggle').click();
  ok('правка из разметки вернулась в редактор', ed.textContent.includes('ИЗМЕНЕНО В КОДЕ'));
  ok('метки снова стали метками', ed.querySelectorAll('.mail-var').length > 0);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
