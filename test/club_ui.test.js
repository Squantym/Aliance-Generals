// ═══════════════════════════════════════════════════════════════════
// test/club_ui.test.js — экран клуба рисуется во всех состояниях
//
// Экран переписан целиком: общий сейф с маской и анонимной историей,
// ночной рейд вместо артиллерии, тактическая дуэль, «Военный займ» и
// полоса суточного предела. Каждое из них имеет несколько состояний —
// открыт / закрыт / на таймере, — и любое из них может не отрисоваться
// молча: шаблон падает, экран остаётся пустым, а сервер при этом
// отвечает исправно, и по логам всё в порядке.
//
// Поэтому рендерим НАСТОЯЩИЙ экран в jsdom и проверяем, что в разметке
// оказалось то, что игрок должен увидеть.
//
// Запуск: node test/club_ui.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage; global.location = dom.window.location;
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');

function load(file, name) {
  let c = fs.readFileSync(__dirname + '/../' + file, 'utf8');
  c += `\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`;
  eval(c);
  return globalThis.__x;
}
global.UI = load('public/js/ui.js', 'UI');
global.API = load('public/js/api.js', 'API');
UI.toast = () => {}; UI.confirm = async () => true;
global.App = load('public/js/app.js', 'App');
App.refreshMe = async () => {}; App.rerender = () => {}; App.go = () => {};
load('public/js/screens/market.js', 'App');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Заготовки ответов сервера. Меняем только то, что проверяем.
const baseClub = () => ({
  budget: { cap: 100, spent: 40, left: 60 },
  sharedCooldownSec: 0,
  pref: { state: 'ready', target: 21, dealerStop: 17, entry: 10, win: 20, cdMin: 5 },
  safe: {
    state: 'open', digits: 6, maxRepeat: 2, reward: 20,
    mask: '*41***', opened: 2, attempts: 7, crackers: 3,
    history: [
      { guess: '141690', tag: 'Ж42', at: Date.now() },
      { guess: '341111', tag: 'К07', at: Date.now() - 60000 },
    ],
    lockedSec: 0, myCooldownSec: 0, tryCdSec: 60, last: null,
  },
  raid: { state: 'ready', total: 6, firstRisk: 12, firstLoot: 3, maxLoot: 32 },
  dice: { state: 'ready', count: 5, rerolls: 2, payouts: [{ id: 'five', name: 'Полный залп', gold: 20 }], rewardMax: 20, rewardMin: 8 },
  bids: { state: 'ready', points: 20, lots: ['Лот А', 'Лот Б', 'Лот В'], rivals: 3, perLot: 6, sweepBonus: 4, rewardMax: 22 },
  tactic: {
    state: 'ready', needed: 3, rewardMin: 6, rewardMax: 12,
    kinds: [
      { id: 'ground', icon: '🛡', name: 'Наземные', beats: 'air', note: 'ПВО сбивает авиацию' },
      { id: 'air', icon: '✈', name: 'Авиация', beats: 'sea', note: 'авиация топит флот' },
      { id: 'sea', icon: '🚢', name: 'Флот', beats: 'ground', note: 'флот накрывает берег' },
    ],
  },
});
const baseLot = () => ({
  drawId: '2026-09-06-1', ticketGold: 15, maxTickets: 1000, maxPerPlayer: 100,
  sold: 40, left: 960, pot: 600, myTickets: 2, myChancePct: 5, myLeft: 98,
  players: 6, drawAt: Date.now() + 3600000, secondsLeft: 3600,
  last: { id: '2026-09-05-2', winnerName: 'Соседний', pot: 900, sold: 60, winnerTickets: 12 },
});

(async () => {
  const c = document.getElementById('content');
  // Клуб теперь маршрутизируется: #club — кнопки, #club/<игра> —
  // отдельная страница. Второй аргумент экрана и есть эта часть адреса.
  const render = async (club, lot, game) => {
    API.get = async (url) => (url === '/api/club' ? club : (url === '/api/lottery' ? lot : {}));
    await App.screens.club(c, game);
    return c.innerHTML;
  };

  console.log('\n── 1. Обычное состояние ──');
  let html = await render(baseClub(), baseLot());
  ok('заголовок на месте', /Клуб офицеров/.test(html));
  ok('суточный предел показан числом', /40 \/ 100/.test(html));
  ok('и полосой', /cap-bar/.test(html));
  ok('остаток назван', /Осталось <b>60<\/b>/.test(html));

  console.log('\n── 2. Общий сейф ──');
  html = await render(baseClub(), baseLot(), 'safe');
  ok('маска нарисована по цифрам', c.querySelectorAll('.sf-d').length === 6);
  ok('открытые цифры видны', /<span class="sf-d">4<\/span>/.test(html));
  ok('закрытые помечены как скрытые', c.querySelectorAll('.sf-d.sf-hidden').length === 4);
  ok('счётчики мира показаны', /попыток мира <b>7<\/b>/.test(html) && /взломщиков <b>3<\/b>/.test(html));
  ok('история попыток видна', /141690/.test(html) && /341111/.test(html));
  ok('метки анонимные, без позывных', /взломщик Ж42/.test(html));
  ok('поле ввода на 6 цифр', (c.querySelector('#safe-guess') || {}).maxLength === 6);

  console.log('\n── 3. Сейф на личном таймере ──');
  let cl = baseClub(); cl.safe.myCooldownSec = 45;
  html = await render(cl, baseLot(), 'safe');
  ok('вместо поля — таймер', !c.querySelector('#safe-guess') && /Отмычки остывают/.test(html));

  console.log('\n── 4. Сейф вскрыт: закрыт для всех ──');
  cl = baseClub();
  cl.safe.state = 'locked'; cl.safe.lockedSec = 1500; cl.safe.mask = '341274';
  cl.safe.last = { name: 'Взломщик', at: Date.now(), attempts: 23 };
  html = await render(cl, baseLot(), 'safe');
  ok('сказано, что вскрыт', /Сейф вскрыт/.test(html));
  ok('назван тот, кто взял', /Взломщик/.test(html) && /23-й попытки/.test(html));
  ok('видно, сколько ждать нового', /Новый сейф привезут/.test(html));
  ok('ввода нет', !c.querySelector('#safe-guess'));

  console.log('\n── 5. Ночной рейд ──');
  cl = baseClub();
  cl.raid = { state: 'active', step: 2, total: 6, loot: 6, nextRisk: 28, nextLoot: 10, atEnd: false };
  html = await render(cl, baseLot(), 'raid');
  ok('видно взятые рубежи', /Взято рубежей: <b class="gold">2<\/b>/.test(html));
  ok('цена следующего шага названа ДО решения', /28%/.test(html) && /10<\/b>/.test(html));
  ok('обе кнопки есть', !!c.querySelector('#raid-push') && !!c.querySelector('#raid-pull'));
  cl.raid = { state: 'active', step: 6, total: 6, loot: 32, nextRisk: null, nextLoot: null, atEnd: true };
  html = await render(cl, baseLot(), 'raid');
  ok('на последнем рубеже кнопки «дальше» нет', !c.querySelector('#raid-push'));
  ok('а отойти можно', !!c.querySelector('#raid-pull'));

  console.log('\n── 6. Тактическая дуэль ──');
  cl = baseClub();
  cl.tactic = {
    state: 'active', my: 2, foe: 1, needed: 3,
    kinds: baseClub().tactic.kinds,
    rounds: [{ mine: 'ground', foe: 'air', res: 'win' }, { mine: 'sea', foe: 'air', res: 'lose' }],
  };
  html = await render(cl, baseLot(), 'tactic');
  ok('счёт показан', /<b class="gold">2<\/b> : <b>1<\/b>/.test(html));
  ok('история раундов видна — это и есть подсказка', /Наземные против/.test(html));
  ok('три кнопки родов войск', c.querySelectorAll('.tactic-kind').length === 3);

  console.log('\n── 7. Военный займ ──');
  html = await render(baseClub(), baseLot(), 'lottery');
  ok('банк крупно', /lot-pot-num/.test(html) && /600/.test(html));
  ok('продано билетов видно', /40 \/ 1000/.test(html));
  ok('свои билеты и шанс', /<b class="gold">2<\/b>/.test(html) && /шанс 5%/.test(html));
  ok('кнопка покупки есть', !!c.querySelector('#lot-buy'));
  ok('прошлый тираж показан', /Соседний/.test(html));

  console.log('\n── 8. Билеты кончились ──');
  let lt = baseLot(); lt.left = 0; lt.sold = 1000; lt.pot = 15000;
  html = await render(baseClub(), lt, 'lottery');
  ok('покупку убрали', !c.querySelector('#lot-buy'));
  ok('и объяснили почему', /Билеты кончились/.test(html));

  console.log('\n── 9. Предел выбран и общий перерыв ──');
  cl = baseClub();
  cl.budget = { cap: 100, spent: 100, left: 0 };
  cl.sharedCooldownSec = 300;
  html = await render(cl, baseLot());
  ok('сказано, что предел исчерпан', /Предел исчерпан/.test(html));
  ok('и что играть всё равно можно', /Играть можно/.test(html));
  ok('перерыв показан таймером', /Перерыв после выигрыша/.test(html));

  console.log('\n── 11. Военный преферанс: карты видны обе руки ──');
  const card = (id, rank, suit) => ({ id, rank, suit: '♠', suitName: suit, red: false, value: 10, img: '/img/cards/' + id + '.webp' });
  cl = baseClub();
  cl.pref = {
    state: 'active', target: 21, dealerStop: 17,
    hand: [card('10-spades', '10', 'пики'), card('07-hearts', '7', 'червы')], sum: 17,
    foe: [card('king-clubs', 'К', 'трефы'), card('09-diamonds', '9', 'бубны')], foeSum: 13,
  };
  App._prefLast = null; App._prefSeen = null;
  html = await render(cl, baseLot(), 'pref');
  ok('карты нарисованы картинками', c.querySelectorAll('.pf-card img').length === 4);
  ok('пути ведут в /img/cards', /src="\/img\/cards\/10-spades\.webp"/.test(html));
  ok('рука генерала показана отдельно', /Генерал/.test(html));
  ok('и его сумма видна', /<b class="gold">13<\/b>/.test(html));
  ok('своя сумма тоже', /<b class="gold">17<\/b>/.test(html));
  ok('сказано, до скольки он добирает', /меньше 17/.test(html));
  ok('обе кнопки на месте', !!c.querySelector('#pref-hit') && !!c.querySelector('#pref-stand'));
  ok('у каждой карты есть рубашка для раздачи', c.querySelectorAll('.pf-back').length === 4);
  ok('карты помечены id — по нему и анимируем только новые',
     [...c.querySelectorAll('.pf-card')].every((el) => !!el.dataset.cid));
  ok('новые карты получили анимацию раздачи', c.querySelectorAll('.pf-card.pf-deal').length === 4);

  console.log('\n── 12. Добор анимируется только для новой карты ──');
  cl.pref.hand.push(card('06-clubs', '6', 'трефы'));
  cl.pref.sum = 23;
  html = await render(cl, baseLot(), 'pref');
  ok('всего карт стало пять', c.querySelectorAll('.pf-card').length === 5);
  ok('анимируется ровно одна — только что пришедшая',
     c.querySelectorAll('.pf-card.pf-deal').length === 1);
  ok('и это именно она', (c.querySelector('.pf-card.pf-deal') || {}).dataset.cid === '06-clubs');

  console.log('\n── 13. Итог партии остаётся на экране ──');
  // Иначе вскрытие мелькнёт на долю секунды и пропадёт вместе с
  // перерисовкой, а посмотреть, чем кончилось, игрок как раз и хочет.
  cl = baseClub();
  cl.pref = { state: 'cooldown', cooldownSec: 900 };
  App._prefLast = {
    result: 'win', mySum: 20, foeSum: 18, reward: 15,
    hand: [card('10-spades', '10', 'пики'), card('10-hearts', '10', 'червы')],
    foe: [card('king-clubs', 'К', 'трефы'), card('ace-diamonds', 'Т', 'бубны'), card('07-spades', '7', 'пики')],
  };
  html = await render(cl, baseLot(), 'pref');
  ok('исход назван', /Партия ваша/.test(html));
  ok('счёт показан', /<b>20<\/b> против <b>18<\/b>/.test(html));
  ok('награда названа', /\+🪙 15/.test(html));
  ok('обе руки всё ещё на столе', c.querySelectorAll('.pf-card').length === 5);
  ok('и таймер до следующей партии', /Доступно через/.test(html));


  console.log('\n── 14. Вход в клуб — кнопки, а не простыня ──');
  // Семь игр на одной странице не помещались на экран телефона, а
  // правила платной игры показать в такой простыне было негде.
  html = await render(baseClub(), baseLot());        // без адреса игры
  ok('заголовок клуба', /Клуб офицеров/.test(html));
  ok('кнопок ровно семь — по числу игр', c.querySelectorAll('.club-btn').length === 7);
  ok('каждая ведёт на свою страницу',
     ['pref', 'safe', 'lottery', 'tactic', 'raid', 'dice', 'bids']
       .every((g) => !!c.querySelector('.club-btn[href="#club/' + g + '"]')));
  ok('на кнопке видно состояние игры — заходить ради проверки не надо',
     /банк 🪙 600/.test(html) && /ставка 🪙 10/.test(html));
  ok('суточный предел показан и здесь', /cap-bar/.test(html));
  ok('столов и карт на входе нет', c.querySelectorAll('.pf-card').length === 0);

  console.log('\n── 15. Страница преферанса: правила до игры ──');
  // Игра платная, значит правила и цена должны быть видны ДО того, как
  // с игрока спишут золото.
  App._prefLast = null;
  html = await render(baseClub(), baseLot(), 'pref');
  ok('стоимость КАЖДОЙ карты расписана', c.querySelectorAll('.pref-val').length === 9);
  ok('валет 2, дама 3, король 4, туз 11',
     /<b>В<\/b>2/.test(html) && /<b>Д<\/b>3/.test(html) && /<b>К<\/b>4/.test(html) && /<b>Т<\/b>11/.test(html));
  ok('правило туза объяснено', /туз.{0,80}за 1/i.test(html));
  ok('сказано, что ничья — проигрыш', /Ничья считается его победой/.test(html));
  ok('ставка названа до начала', /Ставка за партию/.test(html) && /🪙 10/.test(html));
  ok('выигрыш назван', /🪙 20/.test(html));
  ok('перерыв назван', /5 мин/.test(html));
  ok('игра НЕ началась сама — есть кнопка старта', !!c.querySelector('#pref-start'));
  ok('и карт на столе ещё нет', c.querySelectorAll('.pf-card').length === 0);
  ok('шанс на выигрыш игроку не показан',
     !/40\s*%/.test(html) && !/шанс/i.test(html) && !/вероятн/i.test(html));
  ok('есть возврат в клуб', !!c.querySelector('a[href="#club"]'));


  console.log('\n── 10. Сама проверка умеет краснеть ──');
  // Если экран перестанет рисоваться, разметка будет пустой — на этом и
  // держатся все проверки выше.
  ok('разметка не пустая', html.length > 500);
  ok('проверки смотрят в живой DOM', c.querySelectorAll('.card').length >= 1);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
