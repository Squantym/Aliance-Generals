// ═══════════════════════════════════════════════════════════════════
// test/newsblocks.test.js — оформление обновлений и окно при входе
//
// Повод: владелец показал письмо об обновлении из другой игры — текст,
// иконки рядом с текстом, картинки-баннеры, ссылки в разделы игры. Часть
// этого уже была (разметка, картинки, кнопки), не хватало блока «иконка
// и текст», кликабельных картинок, выравнивания и самого окна.
//
// Что стережётся:
//  1. Сервер принимает новые поля и НЕ принимает чужие: блоки приходят
//     из браузера, и пропущенное поле — это чужой html в чужой игре.
//  2. Окно показывается один раз: закрыл — не всплывает, но остаётся
//     в ленте. Сняли и снова поставили пометку — покажется заново.
//  3. Разметка рисуется: иконка с текстом, картинка-ссылка, выравнивание,
//     переходы в разделы игры.
//
// Запуск: node test/newsblocks.test.js   (после npm run build)
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
const news = require('../dist/src/services/news');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  const nx = [];
  let ip = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `nb${++ip}@t.ru`, 'ru', '10.0.16.' + ip);
    return Object.values(player.users()).find((x) => x.name === name);
  };
  const O = await reg('Редактор'); O.role = 'owner';
  const P = await reg('Игрок');

  console.log('\n[1] Сервер принимает новое оформление');
  const made = news.create(O, {
    title: 'Большое обновление', emoji: '🏴‍☠️', tag: 'Патч', popup: true,
    blocks: [
      { type: 'image', url: 'https://site/ban.png', caption: 'Баннер', action: 'war', lie: '<script>' },
      { type: 'iconrow', url: 'https://site/i.png', text: 'Заполучи **Трезубец** и [загляни в лавку](market)', side: 'right', size: 96, action: 'market' },
      { type: 'text', text: 'По центру', align: 'center' },
      { type: 'heading', text: 'Заголовок', level: 2, align: 'center' },
    ],
  }, nx).post;
  const [img, icon, text, head] = made.blocks;
  ok(img.action === 'war' && img.lie === undefined, 'у картинки есть переход, лишние поля отброшены');
  ok(icon.type === 'iconrow' && icon.side === 'right' && icon.size === 96 && icon.action === 'market',
     `блок «иконка и текст»: сторона ${icon.side}, размер ${icon.size}`);
  ok(text.align === 'center' && head.align === 'center', 'выравнивание сохранено у текста и заголовка');
  const bad = news.update(O, made.id, { blocks: [
    { type: 'iconrow', url: 'x', text: 'y', side: 'вверх', size: 999 },
    { type: 'script', text: 'нет' },
  ] }, nx).post;
  ok(bad.blocks.length === 1, 'неизвестный вид блока отброшен целиком');
  ok(bad.blocks[0].side === 'left' && bad.blocks[0].size === 64, 'чужие сторона и размер заменены на обычные');

  console.log('\n[2] Окно обновления при входе');
  const pop = news.popup(P);
  ok(pop && pop.id === made.id && pop.blocks.length === 1, 'игроку выдано окно с блоками поста');
  ok(player.mePayload(P).newsPopup !== null, 'окно едет вместе с остальным состоянием игрока');
  news.closePopup(P, made.id);
  ok(news.popup(P) === null, 'закрыл — больше не всплывает');
  ok(news.list(P).posts.some((x) => x.id === made.id), 'но пост остался в ленте новостей');
  const other = await reg('Второй');
  ok(news.popup(other) !== null, 'другому игроку окно всё ещё показывается');

  news.update(O, made.id, { popup: false }, nx);
  ok(news.popup(other) === null, 'сняли пометку — окно не показывается никому');
  news.update(O, made.id, { popup: true }, nx);
  ok(news.popup(other) !== null, 'вернули пометку — окно снова в очереди');
  ok(news.popup(P) === null, 'а тому, кто уже закрыл, второй раз не навязывается');

  console.log('\n[3] Рисование в игре');
  const src = fs.readFileSync(path.join(ROOT, 'public/js/screens/news.js'), 'utf8');
  ok(/case 'iconrow': {/.test(src), 'блок «иконка и текст» рисуется');
  ok(/flex-direction:\$\{dir\}/.test(src), 'иконка становится слева или справа');
  ok(/function actionAttr/.test(src), 'переход у картинки разбирается тем же правилом, что у кнопки');
  ok(/App\.renderNewsBlocks = renderBlocks;/.test(src), 'рисовальщик отдан окну обновления');
  ok(/alignPicker/.test(src) && /data-align/.test(src), 'в редакторе есть выбор выравнивания');
  ok(/data-side/.test(src) && /data-size/.test(src), 'и выбор стороны и размера иконки');
  ok(!/id="news-popup"[^-]/.test(src), 'id окна не занят галочкой в редакторе — иначе окно молча не открывается');
  const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  ok(/_showNewsPopup\(post\)/.test(app) && /news-popup/.test(app), 'окно обновления есть в игре');
  ok(/await App\._loadScreen\('news'\)/.test(app), 'перед показом подгружается экран новостей — иначе окно пустое');
  ok(/close-popup/.test(app), 'закрытие окна уходит на сервер');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  ok(/\.news-popup-body img \{ max-height/.test(css), 'баннер в окне ограничен по высоте');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
