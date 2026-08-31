// ═══════════════════════════════════════════════════════════════════
// test/wipescreen.test.js — экран «Обнуление мира» в живом DOM
//
// Серверную часть стережёт test/worldreset.test.js. Здесь — то, что
// видит и нажимает владелец, в настоящем jsdom.
//
// Экран одной кнопки, которую нельзя нажать случайно, поэтому и
// проверяется именно «нельзя»:
//
//  1. КНОПКА МЁРТВАЯ, ПОКА ФРАЗА НЕ СОВПАЛА. Проверка есть и на
//     сервере — здесь она бережёт от нажатия раньше, чем человек
//     прочитал, что произойдёт.
//  2. ЧИСЛА ПОКАЗАНЫ ДО. Вопрос «вы уверены?» без цифр подтверждают не
//     думая; «удалить 143 игроков» — уже нет.
//  3. ОТКАЗ В ПОДТВЕРЖДЕНИИ НИЧЕГО НЕ ОТПРАВЛЯЕТ.
//  4. ВИДНО, ЧТО ОСТАНЕТСЯ. Иначе решение принимается вслепую.
//
// Запуск: node test/wipescreen.test.js
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

// Текст экрана со схлопнутыми пробелами. Без этого проверка «сказано
// „журнал действий“» падала бы от переноса строки в вёрстке: в
// textContent между словами оказывается перевод строки с отступом.
// Проверять надо смысл, а не то, где вёрстка перенесла слово.
const flat = (el) => el.textContent.replace(/\s+/g, ' ').trim();

const PREVIEW = {
  world: 3,
  phrase: 'обнулить мир 3',
  players: 143,
  legions: 7,
  alliances: 4,
  counts: { legions: 7, alliances: 4, battles: 900, world: 3 },
  human: { legions: 'легионы', alliances: 'альянсы', battles: 'бои', world: 'мир: чат и аукцион' },
  logs: 48210,
  history: 9033,
  keep: ['worldArchive', 'maintenance', 'mailQuota', 'pushconfig', 'roleZones'],
  archive: [
    { n: 1, endedAt: Date.now() - 86400000 * 90, players: 60, by: 'Хозяин', reason: 'первый сезон', file: 'mir-01-2026-06-01.db', bytes: 5242880 },
    { n: 2, endedAt: Date.now() - 86400000 * 10, players: 210, by: 'Хозяин', reason: 'второй сезон', file: 'mir-02-2026-08-20.db', bytes: 20971520 },
  ],
  frozen: [{ file: 'mir-02-2026-08-20.db', bytes: 20971520, at: Date.now() }],
  canFreeze: true,
};

function boot(preview) {
  const dom = new JSDOM('<!doctype html><body><div id="content"></div></body>',
    { url: 'https://aliance-general.ru/', runScripts: 'outside-only' });
  const win = dom.window;
  const sent = [];
  const toasts = [];
  let answer = true;
  let fail = null;

  win.UI = { esc: ESC, toast: (t) => toasts.push(String(t)), confirm: async () => answer };
  win.API = {
    get: async () => preview,
    post: async (url, body) => {
      sent.push({ url, body });
      if (fail) throw new Error(fail);
      return {
        ok: true, world: preview.world, removed: preview.players, kept: 1,
        file: 'mir-03-2026-08-30.db', bytes: 31457280,
        wiped: { players: 143, collections: 12, action_logs: 48210, player_history: 9033 },
      };
    },
  };
  win.A2 = { screens: {} };
  win.eval(fs.readFileSync(path.join(ROOT, 'public/js/admin2/wipe.js'), 'utf8'));
  const el = win.document.getElementById('content');
  return {
    win, sent, toasts, el,
    say: (v) => { answer = v; },
    breakServer: (m) => { fail = m; },
    q: (id) => win.document.getElementById(id),
    render: () => win.A2.screens.wipe(el),
  };
}

(async () => {
  console.log('\n── 1. Что показано до нажатия ──');
  const p = boot(PREVIEW);
  await p.render();
  const t = flat(p.el);
  ok('назван номер текущего мира', /мир №3/i.test(t));
  ok('названо число игроков', /143/.test(t));
  ok('и что их удалят', /удал|стира/i.test(t));
  ok('сказано, что отменить нельзя', /нельзя/i.test(t));
  ok('сказано про заморозку мира', /заморажива|слепок/i.test(t));
  ok('названо число записей журнала', /48210/.test(t));
  ok('и срезов истории', /9033/.test(t));
  // Журнал теперь СТИРАЕТСЯ — он целиком уходит в замороженный мир.
  // Экран обязан сказать это прямо, а не умолчать.
  ok('сказано, что журнал стирается', /журнал действий/i.test(t));
  ok('и что аккаунт владельца сохранится', /ваш аккаунт/i.test(t));
  ok('видно, что список остающегося короткий', /Останется только это/i.test(t));

  console.log('\n── 2. Кнопка мертва, пока фраза не совпала ──');
  const go = p.q('w-go');
  const conf = p.q('w-confirm');
  ok('кнопка изначально не нажимается', go.disabled === true);

  for (const bad of ['', 'обнулить', 'обнулить мир', 'обнулить мир 2', 'да']) {
    conf.value = bad;
    conf.oninput();
    ok(`не оживает на «${bad || '(пусто)'}»`, go.disabled === true);
  }

  conf.value = PREVIEW.phrase;
  conf.oninput();
  ok('оживает на точной фразе', go.disabled === false);
  // Регистр и лишние пробелы прощаем: это защита от бездумного клика, а
  // не проверка на аккуратность набора.
  conf.value = '  ОБНУЛИТЬ   Мир 3 ';
  conf.oninput();
  ok('и на ней же в другом регистре', go.disabled === false);

  console.log('\n── 3. Отказ в подтверждении ничего не шлёт ──');
  p.say(false);
  await go.onclick();
  ok('запроса не было', p.sent.length === 0);
  ok('кнопка осталась рабочей', go.disabled === false);

  console.log('\n── 4. Согласие — запрос уходит целиком ──');
  p.say(true);
  p.q('w-reason').value = 'конец третьего сезона';
  ok('галочка «обнулить и мой прогресс» стоит по умолчанию', p.q('w-self').checked === true);
  await go.onclick();
  ok('запрос ушёл', p.sent.length === 1);
  ok('на нужный адрес', p.sent[0].url === '/api/admin/world-reset');
  ok('фраза передана', /обнулить\s+мир\s+3/i.test(p.sent[0].body.confirm || ''));
  ok('причина передана', p.sent[0].body.reason === 'конец третьего сезона');
  ok('и решение про свой прогресс', p.sent[0].body.resetOwner === true);

  console.log('\n── 5. После обнуления ──');
  const done = flat(p.el);
  ok('сказано, что мир закрыт', /закрыт/i.test(done));
  ok('названо число удалённых', /143/.test(done));
  ok('показан файл замороженного мира', /mir-03-2026-08-30\.db/.test(done));
  ok('и его размер', /МБ/.test(done));
  ok('и сколько стёрто журнала', /48210/.test(done));
  // Игра остаётся закрытой намеренно: смотреть на результат должен
  // человек, а не игроки.
  ok('сказано, что игра закрыта на обслуживание', /обслуживани/i.test(done));
  ok('и что открывать её вручную', /открыва/i.test(done));

  console.log('\n── 6. Сервер отказал — экран не врёт ──');
  const p2 = boot(PREVIEW);
  await p2.render();
  p2.breakServer('Не удалось заморозить мир — обнуление отменено, ничего не стёрто');
  p2.q('w-confirm').value = PREVIEW.phrase;
  p2.q('w-confirm').oninput();
  await p2.q('w-go').onclick();
  ok('причина показана', /заморозить мир/i.test(p2.toasts.join(' ')));
  ok('и экран не сделал вид, что всё получилось',
     !/мир №3 закрыт/i.test(flat(p2.el)));
  ok('кнопку можно нажать снова', p2.q('w-go').disabled === false);

  console.log('\n── 7. Архив прошлых миров виден прямо здесь ──');
  // Видеть его при принятии решения важно: становится понятно, что
  // стирается не всё, и решение принимается спокойнее.
  const p3 = boot(PREVIEW);
  await p3.render();
  const a = flat(p3.el);
  ok('прошлые миры перечислены', /Прошлые миры/i.test(a));
  ok('первый мир на месте', /первый сезон/i.test(a));
  ok('второй тоже', /второй сезон/i.test(a));
  ok('видно, где лежат замороженные миры', /data\/worlds/.test(a));
  ok('и их файлы', /mir-01-2026-06-01\.db/.test(a));
  ok('и размеры', /5\.0 МБ|5 МБ/.test(a));

  console.log('\n── 8. Файловая база: без слепка — только по согласию ──');
  // Молча уничтожать данные, потому что «тут всё равно разработка», —
  // привычка, которая однажды сработает на боевом сервере.
  const p4 = boot(Object.assign({}, PREVIEW, { canFreeze: false }));
  await p4.render();
  ok('сказано, что заморозить нечем', /вручную/i.test(flat(p4.el)));
  ok('и есть отдельная галочка согласия', !!p4.q('w-nofreeze'));
  ok('снятая по умолчанию', p4.q('w-nofreeze').checked === false);
  p4.q('w-confirm').value = PREVIEW.phrase;
  p4.q('w-confirm').oninput();
  await p4.q('w-go').onclick();
  ok('без галочки согласие не уходит', p4.sent[0].body.allowNoFreeze === false);
  const p5 = boot(Object.assign({}, PREVIEW, { canFreeze: false }));
  await p5.render();
  p5.q('w-nofreeze').checked = true;
  p5.q('w-confirm').value = PREVIEW.phrase;
  p5.q('w-confirm').oninput();
  await p5.q('w-go').onclick();
  ok('с галочкой — уходит', p5.sent[0].body.allowNoFreeze === true);
  ok('на своей базе галочки нет вовсе', !p.q('w-nofreeze'));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
