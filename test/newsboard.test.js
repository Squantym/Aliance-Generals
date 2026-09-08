// ═══════════════════════════════════════════════════════════════════
// test/newsboard.test.js — новости на виду и акции на виду
//
// Три вещи, которые легко сломать и трудно заметить:
//
//  1. Лента новостей в «Общении» и в разделе «Новости» — ОДНА. Своя
//     вёрстка во вкладке уже была: она склеивала блоки поста в абзац, и
//     игрок читал сырую разметку **жирного** вместо оформления, а
//     картинки, списки и выноски пропадали вовсе.
//  2. Полоса закреплённой новости висит над игрой, пока игрок её не
//     закроет. Закрытие адресное: следующее объявление обязано показаться
//     снова, иначе один крестик выключает способ докричаться навсегда.
//  3. Акция объявляется В ТОМ разделе, где действует, и попадает в общий
//     список внизу страницы. Скидка, о которой знает только код, —
//     деньги игрока, потраченные мимо неё.
//
// Запуск: node test/newsboard.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const roles = require('../dist/src/services/roles');
const news = require('../dist/src/services/news');
const discounts = require('../dist/src/services/discounts');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const fails = (n, fn, part) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

(async () => {
  await db.init();
  await auth.register('Редактор', 'пароль123', 'e@t.ru', 'ru', '1.1.1.1');
  await auth.register('Боец', 'пароль123', 'p@t.ru', 'ru', '2.2.2.2');
  const U = player.users();
  const E = Object.values(U).find((x) => x.name === 'Редактор');
  const P = Object.values(U).find((x) => x.name === 'Боец');
  E.role = 'owner';
  const nx = [];

  console.log('\n[1] Полоса закреплённой новости');
  const first = news.create(E, {
    title: 'Официальный запуск игры', emoji: '🎉', tag: 'Старт', pinned: true,
    blocks: [{ type: 'text', text: 'Товарищи офицеры!' }],
  }, nx);
  const plain = news.create(E, {
    title: 'Обычная новость', blocks: [{ type: 'text', text: 'Без закрепления' }],
  }, nx);
  const b1 = news.banner(P);
  ok('закреплённая новость показывается игроку', !!b1 && b1.id === first.id);
  eq('в полосе — краткий заголовок', b1.title, 'Официальный запуск игры');
  eq('и значок новости', b1.emoji, '🎉');
  ok('незакреплённая в полосу не попадает', b1.id !== plain.id);

  console.log('\n[2] Закрыл — больше не показывается');
  news.hideBanner(P, first.id);
  ok('после закрытия полосы нет', news.banner(P) === null);
  ok('но у другого игрока она осталась', !!news.banner(E));
  fails('закрыть несуществующую нельзя', () => news.hideBanner(P, 'нет-такой'), 'не найдена');

  console.log('\n[3] Следующее объявление показывается снова');
  const second = news.create(E, {
    title: 'Второе объявление', emoji: '📢', pinned: true,
    blocks: [{ type: 'text', text: 'Важное' }],
  }, nx);
  const b2 = news.banner(P);
  ok('новая закреплённая новость видна закрывшему прошлую', !!b2 && b2.id === second.id);
  news.hideBanner(P, second.id);
  ok('и её тоже можно закрыть', news.banner(P) === null);
  // Открепили — полоса уходит у всех, даже у тех, кто её не закрывал
  news.togglePin(E, first.id, nx);
  news.togglePin(E, second.id, nx);
  ok('открепление убирает полосу у всех', news.banner(E) === null);

  console.log('\n[4] Полоса едет вместе с игроком, а не отдельным запросом');
  news.togglePin(E, second.id, nx);          // снова закрепили
  const me = player.mePayload(E);
  ok('mePayload несёт закреплённую новость', me.newsPin && me.newsPin.id === second.id);
  const fields = read('src/core/playerFields.ts');
  ok('поле закрытых полос заявлено в реестре', /newsHidden:/.test(fields));

  console.log('\n[5] Лента новостей — одна на оба экрана');
  const socialJs = read('public/js/screens/social.js');
  ok('вкладка «Общение» зовёт общий рендер', /NewsRender\.renderFeed/.test(socialJs));
  ok('своей склейки блоков в абзац больше нет', !/bodyOf/.test(socialJs));
  const newsJs = read('public/js/screens/news.js');
  ok('рендер ленты вынесен и экспортирован', /renderFeed, newsCard/.test(newsJs));
  ok('раздел «Новости» пользуется им же', /App\.screens\.news = async \(c\) => \{[\s\S]{0,120}renderFeed\(c/.test(newsJs));
  ok('в карточке — блоки поста, а не сырой текст', /newsCard[\s\S]{0,400}renderBlocks/.test(newsJs));

  console.log('\n[6] Картинку в новость можно загрузить файлом');
  ok('кнопка загрузки есть в редакторе', /data-img-pick/.test(newsJs));
  ok('файл уходит на сервер', /api\/news\/image/.test(newsJs));
  ok('перед отправкой картинка ужимается', /_resizeImage/.test(newsJs));
  const appJs = read('public/js/app.js');
  ok('ужиматель переехал в ядро — он нужен двум экранам', /App\._resizeImage = /.test(appJs));
  ok('в «Общении» своей копии не осталось', !/App\._resizeImage = /.test(socialJs));
  eq('адрес загрузки размечен зоной «Новости»', roles.zoneOfPath('/api/news/image'), 'news');
  const routes = read('src/routes.ts');
  ok('маршрут загрузки объявлен', /api\/news\/image/.test(routes));
  ok('и маршрут закрытия полосы тоже', /api\/news\/hide-banner/.test(routes));

  console.log('\n[7] Акции: объявление и общий список');
  discounts.set('container', 50, 2);          // 50% на два часа
  discounts.set('unit', 40, 24);
  const list = discounts.activeList().items;
  eq('обе акции в списке', list.length, 2);
  eq('первой идёт та, что кончается раньше', list[0].category, 'container');
  ok('строка объявления собрана', /Скидка на .*Контейнеры/.test(list[0].headline));
  eq('и ведёт в свой раздел', list[0].screen, 'market/containers');
  ok('срок отдан временем, а не «осталось»', list[0].expiresAt > Date.now());
  const goldLine = discounts.headline('gold', 100);
  ok('надбавка к золоту не названа скидкой', /Бонус/.test(goldLine) && !/Скидка/.test(goldLine));

  console.log('\n[8] Акция видна в каждом разделе, где действует');
  // Категория «лазеры» применялась к цене, но в списке категорий её не
  // было: назначить такую акцию было невозможно в принципе.
  ok('лазеры теперь можно ставить на акцию', !!discounts.CATEGORIES.laser);
  discounts.set('laser', 30, 3);
  eq('и скидка считается', discounts.pctOf('laser'), 30);
  const mines = require('../dist/src/services/mines');
  const silos = require('../dist/src/services/silos');
  const lasers = require('../dist/src/services/lasers');
  discounts.set('mine', 25, 3); discounts.set('silo', 20, 3);
  P.level = 60;
  ok('шахты отдают свою акцию экрану', !!mines.view(P).discount);
  ok('ракетные шахты тоже', !!silos.view(P).discount);
  ok('и лазеры', !!lasers.view(P).discount);
  const econ = read('public/js/screens/economy.js');
  // Техника, постройки, цехи, модернизация, шахты, ракетные шахты, лазеры
  eq('в «Экономике» полоса акции у каждого платного раздела',
     (econ.match(/UI\.saleBanner\(/g) || []).length, 7);
  const sab = read('public/js/screens/saboteurs.js');
  ok('диверсанты показывают общую полосу, а не свою самоделку',
     /UI\.saleBanner\(data\.discount\)/.test(sab) && !/Акция: −\$\{data\.discount\.pct\}%/.test(sab));
  const core = read('public/js/screens/core.js');
  ok('в банке видна надбавка к золоту', /UI\.saleBanner\(data\.discount\)/.test(core));

  console.log('\n[9] Полоса и список акций живут вне экрана');
  const html = read('public/index.html');
  ok('место под полосу новости есть в разметке', /id="pin-news"/.test(html));
  ok('и под список акций', /id="sales-strip"/.test(html));
  ok('обе рисуются на каждом переходе', /renderPinnedNews\(\);[\s\S]{0,80}renderSalesStrip\(\)/.test(appJs));
  ok('список показывается, когда акций больше одной', /live\.length < 2/.test(appJs));
  ok('отсчёт обновляется одним тикером', /_tickSales/.test(appJs) && /data-sale-until/.test(appJs));
  const uiJs = read('public/js/ui.js');
  ok('в полосе акции есть крупная строка', /sale-banner-title/.test(uiJs));
  ok('и живой отсчёт под ней', /data-sale-until/.test(uiJs));
  const css = read('public/css/style.css');
  for (const cls of ['.pin-news', '.pin-news-x', '.sales-strip', '.sale-banner-title']) {
    ok(`стиль ${cls} добавлен`, css.includes(cls));
  }

  console.log('\n[10] Иконки в окне выдачи вместо квадратиков');
  const adminJs = read('public/js/admin.js');
  const grant = adminJs.slice(adminJs.indexOf('renderGrantForm(p, target)'), adminJs.indexOf('async submitGrantAll'));
  ok('гербы — своим значком', /ic-crest/.test(grant));
  ok('жетоны — своим значком', /ic-token/.test(grant));
  ok('там, где значка нет, стоит подпись', /g-ic-txt/.test(grant));
  ok('эмодзи-квадратиков в форме не осталось', !/👂|🎖|📈|🎚|🏦/.test(grant));
  ok('стиль подписи-заменителя есть', css.includes('.g-ic-txt'));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
