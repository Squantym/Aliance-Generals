// ═══════════════════════════════════════════════════════════════════
// test/chatpages.test.js — чат страницами и обращение к игроку
//
// Две просьбы владельца по чату:
//   • история не одной длинной лентой, а страницами: 15 сообщений на
//     странице, около 15 страниц всего, переключатель внизу;
//   • когда к игроку обращаются по позывному, он должен видеть это
//     сразу — свой позывной другим цветом.
//
// Что стережётся:
//  1. Размер страницы и глубина истории берутся из настроек, а лента
//     хранит ровно столько, сколько листалка может показать.
//  2. Страница 1 — самая свежая, дальше вглубь; номер за пределами
//     диапазона прижимается, а не роняет запрос.
//  3. Обращение видит ТОЛЬКО адресат: пометка считается под каждого
//     читателя отдельно, и своё сообщение обращением к себе не бывает.
//  4. Позывной опознаётся отдельным словом: «Барс» не подсвечивается
//     внутри «Барсука».
//  5. Комнаты листаются независимо друг от друга.
//
// Запуск: node test/chatpages.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const social = require('../dist/src/services/social');
const config = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Барс', 'пароль123', 'b@t.ru', 'ru', '1.1.1.1');
  await auth.register('Барсук', 'пароль123', 'bs@t.ru', 'ru', '2.2.2.2');
  await auth.register('Радист', 'пароль123', 'r@t.ru', 'ru', '3.3.3.3');
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const bars = by('Барс'), barsuk = by('Барсук'), radist = by('Радист');
  // Ограничение «не чаще раза в 3 секунды» мешает набить историю
  const say = (who, text, room) => { who.lastChatAt = 0; social.chatPost(who, text, room); };

  console.log('\n[1] Настройки страницы и глубины истории');
  eq('на странице 15 сообщений', config.CHAT.PAGE_SIZE, 15);
  eq('страниц истории 15', config.CHAT.PAGES, 15);
  eq('лента хранит ровно столько, сколько листается',
     config.CHAT.KEEP, config.CHAT.PAGE_SIZE * config.CHAT.PAGES);

  console.log('\n[2] Лента бьётся на страницы, свежее — первое');
  for (let i = 1; i <= 40; i++) say(radist, 'Сообщение ' + i);
  const p1 = social.chatGet(bars, 0, 'global', 1);
  eq('на первой странице ровно 15', p1.messages.length, 15);
  eq('всего страниц по 40 сообщениям', p1.pages, 3);
  eq('первая страница — самая свежая', p1.messages[14].text, 'Сообщение 40');
  eq('и её начало идёт следом за второй', p1.messages[0].text, 'Сообщение 26');
  const p2 = social.chatGet(bars, 0, 'global', 2);
  eq('вторая страница — предыдущие 15', p2.messages[14].text, 'Сообщение 25');
  const p3 = social.chatGet(bars, 0, 'global', 3);
  eq('на последней остаток', p3.messages.length, 10);
  eq('и это самое начало истории', p3.messages[0].text, 'Сообщение 1');
  eq('номер больше последнего прижимается', social.chatGet(bars, 0, 'global', 99).page, 3);
  eq('ноль и мусор — первая страница', social.chatGet(bars, 0, 'global', 'ерунда').page, 1);
  eq('без номера — тоже первая', social.chatGet(bars, 0, 'global').page, 1);

  console.log('\n[3] История обрезается по глубине листалки');
  for (let i = 0; i < config.CHAT.KEEP + 30; i++) say(radist, 'Забивка ' + i);
  const deep = social.chatGet(bars, 0, 'global', 1);
  eq('страниц ровно столько, сколько задано', deep.pages, config.CHAT.PAGES);
  eq('и в ленте не больше', deep.total, config.CHAT.KEEP);

  console.log('\n[4] Обращение видит только адресат');
  say(barsuk, 'Барс, прикрой слева');
  const forBars = social.chatGet(bars, 0, 'global', 1).messages.slice(-1)[0];
  const forOther = social.chatGet(radist, 0, 'global', 1).messages.slice(-1)[0];
  ok('адресату сообщение помечено', forBars.toMe === true);
  ok('постороннему — нет', forOther.toMe === false);
  say(bars, 'Барс сам себе командир');
  const mine = social.chatGet(bars, 0, 'global', 1).messages.slice(-1)[0];
  ok('своё сообщение обращением к себе не считается', mine.toMe === false);

  console.log('\n[5] Позывной опознаётся отдельным словом');
  say(radist, 'Барсук, ты где?');
  const last = () => social.chatGet(bars, 0, 'global', 1).messages.slice(-1)[0];
  ok('«Барсук» не подсвечивается у «Барса»', last().toMe === false);
  const forBarsuk = social.chatGet(barsuk, 0, 'global', 1).messages.slice(-1)[0];
  ok('а самому Барсуку — подсвечивается', forBarsuk.toMe === true);
  say(radist, 'эй @Барс приём');
  ok('обращение через собаку тоже считается', last().toMe === true);
  say(radist, 'нужен барс на фланге');
  ok('регистр не важен', last().toMe === true);
  say(radist, 'у нас тут Барсы бегают');
  ok('а падеж внутри другого слова — не обращение', last().toMe === false);

  console.log('\n[6] Комнаты листаются отдельно');
  for (let i = 1; i <= 20; i++) say(radist, 'Позывные ' + i, 'recruit');
  const rec = social.chatGet(bars, 0, 'recruit', 1);
  eq('у «Позывных» своя история', rec.messages[14].text, 'Позывные 20');
  eq('и свои страницы', rec.pages, 2);
  ok('общий чат при этом не задет',
     social.chatGet(bars, 0, 'global', 1).messages.every((m) => !/Позывные/.test(m.text)));

  console.log('\n[7] Экран: подсветка и листалка');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/screens/social.js'), 'utf8');
  ok('страница запрашивается у сервера', /'&page=' \+ \(App\._chatPage \|\| 1\)/.test(js));
  ok('сообщение с обращением получает свой класс', /msg\.toMe \? ' chat-msg-tome' : ''/.test(js));
  ok('и позывной внутри текста подсвечивается', /markMe\(UI\.esc\(msg\.text\)\)/.test(js));
  ok('подсветка экранирует позывной, а не вставляет как есть', /UI\.esc\(name\)\.replace/.test(js));
  ok('листалка рисуется под чатом', /id="chat-pager"/.test(js) && /function drawPager/.test(js));
  ok('после отправки возвращаемся на свежую страницу', /App\._chatPage = 1;\s*\/\/ своё сообщение/.test(js));
  ok('смена комнаты сбрасывает страницу', /App\._chatRoom = t\.dataset\.croom; App\._chatPage = 1;/.test(js));
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  ok('стиль обращения задан', /\.chat-msg-tome\s*\{/.test(css) && /\.chat-me\s*\{/.test(css));
  ok('и листалки тоже', /\.chat-pager\s*\{/.test(css));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
