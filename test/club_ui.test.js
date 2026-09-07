// ═══════════════════════════════════════════════════════════════════
// test/club_ui.test.js — экран клуба рисуется во всех состояниях
//
// Экран переписан целиком: общий сейф с маской и анонимной историей,
// ночной караван, сапёрная тропа и полевой тотализатор вместо рейда,
// костей и аукциона, тактическая дуэль, «Военный займ» и полоса
// суточного предела. Каждое из них имеет несколько состояний —
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
  // ranks приходят с сервера готовыми — вместе с картинками карт:
  // считать стоимость на клиенте значило бы держать вторую копию правил.
  pref: {
    state: 'ready', target: 21, dealerStop: 17, entry: 10, win: 20, cdMin: 5,
    ranks: [
      { rank: '6', value: 6, soft: false, img: '/img/cards/06-spades.webp', suit: '♠', red: false },
      { rank: '7', value: 7, soft: false, img: '/img/cards/07-clubs.webp', suit: '♣', red: false },
      { rank: '8', value: 8, soft: false, img: '/img/cards/08-hearts.webp', suit: '♥', red: true },
      { rank: '9', value: 9, soft: false, img: '/img/cards/09-diamonds.webp', suit: '♦', red: true },
      { rank: '10', value: 10, soft: false, img: '/img/cards/10-spades.webp', suit: '♠', red: false },
      { rank: 'В', value: 2, soft: false, img: '/img/cards/jack-clubs.webp', suit: '♣', red: false },
      { rank: 'Д', value: 3, soft: false, img: '/img/cards/queen-hearts.webp', suit: '♥', red: true },
      { rank: 'К', value: 4, soft: false, img: '/img/cards/king-diamonds.webp', suit: '♦', red: true },
      { rank: 'Т', value: 11, soft: true, img: '/img/cards/ace-spades.webp', suit: '♠', red: false },
    ],
  },
  safe: {
    state: 'open', digits: 6, maxRepeat: 2, rewardMin: 15, rewardMax: 20,
    fund: { total: 250, spent: 90, left: 160 },
    mask: '*41***', opened: 2, attempts: 7, crackers: 3,
    history: [
      { guess: '141690', tag: 'Ж42', at: Date.now() },
      { guess: '341111', tag: 'К07', at: Date.now() - 60000 },
    ],
    lockedSec: 0, myCooldownSec: 0, tryCdSec: 60, last: null,
  },
  convoy: {
    state: 'ready', loot: 8, ambushPay: 10, ambushes: 4, myAmbush: null,
    routes: [
      { id: 'mountain', name: 'Горный перевал', icon: '⛰' },
      { id: 'coast', name: 'Побережье', icon: '🌊' },
      { id: 'steppe', name: 'Степь', icon: '🌾' },
    ],
    log: [
      // by в ответе — приманка: даже если сервер однажды начнёт присылать
      // имя, показывать его в общей сводке нельзя, иначе маршруты
      // читаются по знакомым позывным, а не по риску.
      { route: 'coast', hit: true, at: Date.now(), tag: 'К-42', by: 'Соседний' },
      { route: 'steppe', hit: false, at: Date.now() - 60000, tag: 'К-07', by: 'Дальний' },
    ],
  },
  sapper: { state: 'ready', cells: 9, mines: 2, firstLoot: 2, maxLoot: 35, maxSteps: 7 },
  bookie: {
    state: 'ready', stake: 10, last: null,
    squads: [
      { id: 'alpha', name: 'Отделение «Альфа»', icon: '🔴', odds: 1.7, payout: 17 },
      { id: 'bravo', name: 'Отделение «Браво»', icon: '🔵', odds: 2.83, payout: 28 },
      { id: 'charlie', name: 'Отделение «Чарли»', icon: '🟢', odds: 4.25, payout: 43 },
    ],
  },
  intercept: {
    state: 'ready', entry: 5, win: 15, cells: 6, guesses: 2,
    moveSec: 180, cdMin: 10, ttlMin: 10, waiting: 1, last: null,
  },
  sniper: {
    state: 'ready', entry: 10, win: 25, turns: 7, turnSec: 30,
    accStart: 20, accStep: 10, accMax: 80, roundsMax: 3,
    cdMin: 10, ttlMin: 10, waiting: 0, last: null,
  },
  thimble: { state: 'ready', pots: 3, entry: 10, win: 20, cdMin: 5, last: null },
  tactic: {
    state: 'ready', needed: 3, rewardMin: 6, rewardMax: 12,
    kinds: [
      // Круг тот же, что на наставлении клуба: пехота › флот › авиация › пехота
      { id: 'ground', icon: '🪖', name: 'Пехота', beats: 'sea', beatsRu: 'флот',
        img: '/img/club/kind-ground.webp', note: 'десант берёт корабли у берега' },
      { id: 'sea', icon: '🚢', name: 'Флот', beats: 'air', beatsRu: 'авиацию',
        img: '/img/club/kind-sea.webp', note: 'корабельное ПВО сбивает авиацию' },
      { id: 'air', icon: '✈', name: 'Авиация', beats: 'ground', beatsRu: 'пехоту',
        img: '/img/club/kind-air.webp', note: 'авиация накрывает пехоту с воздуха' },
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
  ok('вилка награды показана', /15–20/.test(html));
  ok('общий суточный фонд виден числом', /90 \/ 250/.test(html));
  ok('и полосой', c.querySelectorAll('.cap-bar').length >= 1);

  console.log('\n── 2б. Фонд сейфа исчерпан ──');
  // Скрытое исчерпание читается как поломка: «вскрыл, а золота не дали».
  const clEmpty = baseClub();
  clEmpty.safe.fund = { total: 250, spent: 250, left: 0 };
  html = await render(clEmpty, baseLot(), 'safe');
  ok('сказано, что фонд выбран', /Фонд на сегодня выбран/.test(html));
  ok('но вскрывать по-прежнему можно', !!c.querySelector('#safe-guess'));

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

  console.log('\n── 5. Ночной караван ──');
  html = await render(baseClub(), baseLot(), 'convoy');
  ok('маршрут выбирается кнопкой', c.querySelectorAll('.cv-go').length === 3);
  ok('и место засады тоже', c.querySelectorAll('.cv-amb').length === 3);
  // Пока не выбраны оба, выводить караван нельзя: иначе игрок отправлял
  // бы его, не поставив засаду, и терял половину игры.
  ok('пока не выбрано — кнопка выхода заперта', c.querySelector('#cv-send').disabled === true);
  ok('видно, сколько засад в округе', /засад: <b>4<\/b>/.test(html));
  ok('но не видно, на каких маршрутах', !/Побережье[^<]*засад/.test(html));
  ok('чужие выходы видны', c.querySelectorAll('.cv-row').length === 2);
  ok('и они анонимны — только метка каравана',
     /К-42/.test(html) && !/Соседний/.test(html) && !/Дальний/.test(html));
  cl = baseClub(); cl.convoy = { state: 'cooldown', cooldownSec: 480, routes: [], log: [] };
  html = await render(cl, baseLot(), 'convoy');
  ok('на перерыве выйти нельзя', !c.querySelector('#cv-send') && /Доступно через 8:00/.test(html));

  console.log('\n── 5б. Сапёрная тропа ──');
  html = await render(baseClub(), baseLot(), 'sapper');
  ok('до выхода — только кнопка старта',
     !!c.querySelector('#sp-start') && c.querySelectorAll('.sp-cell').length === 0);
  ok('края добычи названы заранее', /span> 2,/.test(html) && /span> 35,/.test(html));
  cl = baseClub();
  cl.sapper = { state: 'active', cells: 9, mines: 2, opened: [0, 3], loot: 5, nextLoot: 9, nextRiskPct: 29 };
  html = await render(cl, baseLot(), 'sapper');
  ok('поле разложено целиком', c.querySelectorAll('.sp-cell').length === 9);
  ok('открытые клетки повторно не нажать', c.querySelectorAll('.sp-cell[disabled]').length === 2);
  ok('риск следующего шага показан ДО решения', /29%/.test(html));
  ok('и добыча за него тоже', /<b>9<\/b>/.test(html));
  ok('забрать можно в любой момент', !!c.querySelector('#sp-take'));
  cl.sapper = { state: 'active', cells: 9, mines: 2, opened: [0, 1, 2, 3, 4, 5, 6], loot: 35, nextLoot: null, nextRiskPct: null };
  html = await render(cl, baseLot(), 'sapper');
  ok('в конце тропы рисковать не предлагают', /Дальше идти некуда/.test(html));
  ok('а забрать — по-прежнему да', !!c.querySelector('#sp-take'));

  console.log('\n── 5в. Полевой тотализатор ──');
  html = await render(baseClub(), baseLot(), 'bookie');
  ok('три отделения — три кнопки', c.querySelectorAll('.bk-bet').length === 3);
  ok('коэффициент виден', /×1\.7/.test(html) && /×4\.25/.test(html));
  ok('и готовая выплата тоже', /17<\/b>/.test(html) && /43<\/b>/.test(html));
  ok('шанс отделения игроку не показывают', !/50%/.test(html) && !/шанс/.test(html));
  cl = baseClub();
  cl.bookie = { state: 'cooldown', cooldownSec: 360, stake: 10, squads: [],
                last: { winner: 'bravo', winnerName: 'Отделение «Браво»', mine: 'alpha', won: false } };
  html = await render(cl, baseLot(), 'bookie');
  ok('на перерыве ставок не принимают', c.querySelectorAll('.bk-bet').length === 0);
  ok('но итог прошлого забега виден', /Браво/.test(html) && /не сыграла/.test(html));

  console.log('\n── 6. Тактическая дуэль ──');
  cl = baseClub();
  cl.tactic = {
    state: 'active', my: 2, foe: 1, needed: 3,
    kinds: baseClub().tactic.kinds,
    rounds: [{ mine: 'ground', foe: 'air', res: 'win' }, { mine: 'sea', foe: 'air', res: 'lose' }],
  };
  html = await render(cl, baseLot(), 'tactic');
  ok('счёт показан', /<b class="gold">2<\/b> : <b>1<\/b>/.test(html));
  ok('история раундов видна', /Пехота против/.test(html));
  ok('и роды войск в ней — картинками, а не буквами',
     c.querySelectorAll('.tac-row .kind-mini').length === 4);
  ok('подсказки про привычку генерала больше нет — читать нечего',
     !/повторяет то, чем выиграл/.test(html) && /выбирает вслепую/.test(html));
  ok('три кнопки родов войск', c.querySelectorAll('.tactic-kind').length === 3);

  console.log('\n── 5г. Радиоперехват: очередь и ход ──');
  html = await render(baseClub(), baseLot(), 'intercept');
  ok('до очереди — кнопка входа', !!c.querySelector('[data-queue="intercept"]'));
  ok('взнос и выигрыш названы монетой, а не квадратом',
     /Взнос<\/span>\s*<b><span class="ic-gold"><\/span> 5<\/b>/.test(html) && html.indexOf('🪙') < 0);
  ok('сетки квадратов до боя нет', c.querySelectorAll('.ic-cell').length === 0);
  cl = baseClub();
  cl.intercept = Object.assign({}, cl.intercept, {
    state: 'queue', queue: { waitedSec: 20, ttlSec: 580 }, waiting: 2 });
  html = await render(cl, baseLot(), 'intercept');
  ok('в очереди видно ожидание и выход', /Ищем соперника/.test(html) && !!c.querySelector('[data-leave="intercept"]'));
  ok('и сколько ещё ждать', /9:40/.test(html));
  cl = baseClub();
  cl.intercept = Object.assign({}, cl.intercept, {
    state: 'match', match: { id: 'i1', foeName: 'Сосед', deadlineSec: 175, moved: false } });
  html = await render(cl, baseLot(), 'intercept');
  ok('в бою видно соперника и время хода', /Сосед/.test(html) && /2:55/.test(html));
  ok('две сетки по шесть квадратов',
     c.querySelectorAll('.ic-hide').length === 6 && c.querySelectorAll('.ic-aim').length === 6);
  // Полдхода отправить нельзя: жребий доделал бы его за игрока
  ok('кнопка отправки заперта до полного хода', c.querySelector('#ic-send').disabled === true);
  c.querySelector('.ic-hide[data-cell="0"]').onclick();
  c.querySelector('.ic-aim[data-cell="1"]').onclick();
  ok('с одной наводкой всё ещё заперта', c.querySelector('#ic-send').disabled === true);
  c.querySelector('.ic-aim[data-cell="2"]').onclick();
  ok('с укрытием и двумя наводками — открыта', c.querySelector('#ic-send').disabled === false);
  // Третья наводка вытесняет первую, а не добавляется к ним
  c.querySelector('.ic-aim[data-cell="3"]').onclick();
  ok('наводок остаётся ровно две', c.querySelectorAll('.ic-aim.on').length === 2);
  ok('и отправка по-прежнему открыта', c.querySelector('#ic-send').disabled === false);
  cl.intercept.match.moved = true;
  html = await render(cl, baseLot(), 'intercept');
  ok('после хода полей выбора нет', c.querySelectorAll('.ic-cell').length === 0);
  ok('но сказано, чего ждём', /Ждём хода соперника/.test(html));

  console.log('\n── 5д. Снайперская дуэль ──');
  cl = baseClub();
  cl.sniper = Object.assign({}, cl.sniper, {
    state: 'match',
    match: { id: 's1', foeName: 'Сосед', round: 1, turn: 3, deadlineSec: 18,
             myAcc: 40, foeAcc: 40, sure: false, acted: null, canAim: true,
             aimLabel: 'Сделать поправку на ветер', log: [{ round: 1, turn: 2, text: 'Оба выжидают.' }] },
  });
  html = await render(cl, baseLot(), 'sniper');
  ok('видно раунд и ход', /Раунд 1 · ход 3 из 7/.test(html));
  // Точность соперника видна: дуэль симметричная, и решение «стрелять
  // или ждать» принимается по обоим числам, а не по своему одному.
  const snSides = [...c.querySelectorAll('.sn-side')];
  ok('и точность обоих', snSides.length === 2 && snSides.every((s) => /\d+%/.test(s.textContent)));
  ok('под чужим числом — имя соперника', /Сосед/.test(snSides[1].textContent));
  ok('подпись прицела — с сервера, по ходу', /Сделать поправку на ветер/.test(html));
  ok('выстрел показывает свой шанс', /Выстрелить · 40%/.test(html));
  ok('обе кнопки на месте', !!c.querySelector('#sn-aim') && !!c.querySelector('#sn-shoot'));
  ok('журнал дуэли виден', /Оба выжидают/.test(html));
  cl.sniper.match.acted = 'aim';
  html = await render(cl, baseLot(), 'sniper');
  ok('после хода кнопок нет', !c.querySelector('#sn-aim') && !c.querySelector('#sn-shoot'));
  cl.sniper.match.acted = null;
  cl.sniper.match.turn = 7; cl.sniper.match.canAim = false; cl.sniper.match.myAcc = 80;
  html = await render(cl, baseLot(), 'sniper');
  ok('на последнем ходу прицела нет', !c.querySelector('#sn-aim') && !!c.querySelector('#sn-shoot'));
  cl.sniper.match.turn = 4; cl.sniper.match.canAim = true; cl.sniper.match.sure = true; cl.sniper.match.myAcc = 100;
  html = await render(cl, baseLot(), 'sniper');
  ok('открывшегося соперника видно', /следующий выстрел наверняка/.test(html) && /100%/.test(html));

  console.log('\n── 5е. Напёрстки полевой кухни ──');
  html = await render(baseClub(), baseLot(), 'thimble');
  ok('три котелка', c.querySelectorAll('.th-pot').length === 3);
  ok('ставка и выигрыш монетой', /<span class="ic-gold"><\/span> 10/.test(html)
     && /<span class="ic-gold"><\/span> 20/.test(html));
  cl = baseClub();
  cl.thimble = Object.assign({}, cl.thimble, { state: 'cooldown', cooldownSec: 240,
    last: { pot: 0, hidden: 2, won: false } });
  html = await render(cl, baseLot(), 'thimble');
  ok('на перерыве котелков нет', c.querySelectorAll('.th-pot').length === 0);
  ok('но видно, где был паёк', /№3/.test(html) && /4:00/.test(html));

  console.log('\n── 5ж. Картинки клуба на месте ──');
  // Ссылка на несуществующий файл — это пустой прямоугольник у игрока и
  // 404 в логах, а в разметке всё «правильно». Поэтому каждый путь
  // проверяется по диску.
  const seenPics = new Set();
  for (const g of ['', 'pref', 'safe', 'lottery', 'tactic', 'intercept', 'sniper', 'thimble']) {
    const cl2 = baseClub();
    if (g === 'tactic') { cl2.tactic.state = 'ready'; }
    const h = await render(cl2, baseLot(), g || undefined);
    for (const m of h.matchAll(/\/img\/club\/[a-z0-9-]+\.webp/g)) seenPics.add(m[0]);
  }
  ok(`картинок клуба в разметке (${seenPics.size})`, seenPics.size >= 8);
  const missing = [...seenPics].filter((u) => !fs.existsSync(__dirname + '/../public' + u));
  ok(missing.length ? `нет файлов: ${missing.join(', ')}` : 'все картинки клуба лежат на диске',
     missing.length === 0);

  console.log('\n── 5з. Тактическая дуэль: наставление и роды войск ──');
  html = await render(baseClub(), baseLot(), 'tactic');
  ok('наставление показано картинкой, а не пересказом', /\/img\/club\/tactic\.webp/.test(html));
  // Текст под наставлением обязан совпадать с ним: игрок, прочитавший
  // картинку, не должен обнаружить в игре обратный круг.
  ok('пехота бьёт флот', /<b>Пехота<\/b> бьёт флот/.test(html));
  ok('флот бьёт авиацию', /<b>Флот<\/b> бьёт авиацию/.test(html));
  ok('авиация бьёт пехоту', /<b>Авиация<\/b> бьёт пехоту/.test(html));
  ok('сказано и про ничью', /Одинаковый выбор — ничья/.test(html));
  cl = baseClub();
  cl.tactic = Object.assign({}, cl.tactic, { state: 'active', my: 0, foe: 0, rounds: [] });
  html = await render(cl, baseLot(), 'tactic');
  ok('род войск выбирается картинкой', c.querySelectorAll('.tac-kinds .tactic-kind img').length === 3);
  ok('и у каждой кнопки своя', new Set([...c.querySelectorAll('.tac-kinds img')]
     .map((i) => i.getAttribute('src'))).size === 3);

  console.log('\n── 5и. Радиоперехват: клетки — куски карты ──');
  cl = baseClub();
  cl.intercept = Object.assign({}, cl.intercept, {
    state: 'match', match: { id: 'i2', foeName: 'Сосед', deadlineSec: 120, moved: false } });
  html = await render(cl, baseLot(), 'intercept');
  const icCells = [...c.querySelectorAll('.ic-hide')];
  ok('клетки подписаны квадратами', icCells.map((b) => b.textContent.trim().slice(0, 2)).join(',')
     .indexOf('А1') === 0);
  // Каждая клетка показывает СВОЙ кусок карты — иначе это шесть
  // одинаковых плиток, а не поле.
  ok('у каждой клетки свой участок карты',
     new Set(icCells.map((b) => b.style.backgroundPosition)).size === 6);
  ok('метки укрытия и наводки разные',
     c.querySelector('.ic-hide .ic-mark').textContent === '🏴'
     && c.querySelector('.ic-aim .ic-mark').textContent === '🎯');
  ok('до выбора не подсвечено ничего', c.querySelectorAll('.ic-cell.on').length === 0);
  c.querySelector('.ic-hide[data-cell="2"]').onclick();
  c.querySelector('.ic-aim[data-cell="4"]').onclick();
  ok('выбранные клетки подсвечены', c.querySelectorAll('.ic-cell.on').length === 2);
  ok('и подсветка стоит именно на выбранных',
     c.querySelector('.ic-hide[data-cell="2"]').classList.contains('on')
     && c.querySelector('.ic-aim[data-cell="4"]').classList.contains('on'));

  console.log('\n── 7. Военный займ ──');
  html = await render(baseClub(), baseLot(), 'lottery');
  ok('банк крупно', /lot-pot-num/.test(html) && /600/.test(html));
  ok('продано билетов видно', /40 \/ 1000/.test(html));
  ok('свои билеты и шанс', /<b class="gold">2<\/b>/.test(html) && /шанс 5%/.test(html));
  // Билет — картинкой, число куплённых — в углу самого билета
  ok('билет показан картинкой', c.querySelectorAll('.lot-ticket img').length >= 1);
  ok('и число билетов стоит в углу', c.querySelector('.lot-ticket-num').textContent === '2');
  ok('до пяти билетов стопка в один слой', c.querySelectorAll('.lot-ticket img').length === 1);
  let lt = baseLot(); lt.myTickets = 7;
  html = await render(baseClub(), lt, 'lottery');
  ok('от пяти — стопка в два слоя', c.querySelectorAll('.lot-ticket img').length === 2);
  lt = baseLot(); lt.myTickets = 40;
  html = await render(baseClub(), lt, 'lottery');
  ok('от двадцати — в три', c.querySelectorAll('.lot-ticket img').length === 3);
  ok('и число прежнее — точное', c.querySelector('.lot-ticket-num').textContent === '40');
  lt = baseLot(); lt.myTickets = 0; lt.myChancePct = 0;
  html = await render(baseClub(), lt, 'lottery');
  ok('без билетов картинки нет', c.querySelectorAll('.lot-ticket').length === 0);
  ok('и сказано, что билетов нет', /Ваши билеты[\s\S]{0,80}нет/.test(html));
  ok('кнопка покупки есть', !!c.querySelector('#lot-buy'));
  ok('прошлый тираж показан', /Соседний/.test(html));

  console.log('\n── 8. Билеты кончились ──');
  lt = baseLot(); lt.left = 0; lt.sold = 1000; lt.pot = 15000;
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
  ok('награда названа', /\+<span class="ic-gold"><\/span> 15/.test(html));
  ok('обе руки всё ещё на столе', c.querySelectorAll('.pf-card').length === 5);
  ok('и таймер до следующей партии', /Доступно через/.test(html));


  console.log('\n── 14. Вход в клуб — кнопки, а не простыня ──');
  // Семь игр на одной странице не помещались на экран телефона, а
  // правила платной игры показать в такой простыне было негде.
  html = await render(baseClub(), baseLot());        // без адреса игры
  ok('заголовок клуба', /Клуб офицеров/.test(html));
  ok('кнопок ровно десять — по числу игр', c.querySelectorAll('.club-btn').length === 10);
  ok('каждая ведёт на свою страницу',
     ['pref', 'safe', 'lottery', 'tactic', 'convoy', 'sapper', 'bookie',
      'intercept', 'sniper', 'thimble']
       .every((g) => !!c.querySelector('.club-btn[href="#club/' + g + '"]')));
  ok('на кнопке видно состояние игры — заходить ради проверки не надо',
     /банк <span class="ic-gold"><\/span> 600/.test(html)
     && /ставка <span class="ic-gold"><\/span> 10/.test(html));
  // Квадратик вместо монеты — это шрифт без эмодзи у игрока, поэтому
  // золото везде рисуется картинкой.
  ok('эмодзи-монеты на входе в клуб не осталось', html.indexOf('🪙') < 0);
  ok('суточный предел показан и здесь', /cap-bar/.test(html));
  ok('столов и карт на входе нет', c.querySelectorAll('.pf-card').length === 0);
  ok('в шапке клуба есть картинка', c.querySelectorAll('.club-hero img').length === 1);
  ok('и это отдельный баннер, а не иконка меню',
     /\/img\/club\/hero\.webp/.test(html));
  // Внутри игры своя картинка, а не общая шапка клуба: иначе на всех
  // десяти страницах висел бы один и тот же баннер.
  html = await render(baseClub(), baseLot(), 'pref');
  ok('у страницы игры своя картинка', /\/img\/club\/pref\.webp/.test(html));
  ok('и это не общая шапка клуба', !/\/img\/club\/hero\.webp/.test(html));
  html = await render(baseClub(), baseLot(), 'sniper');
  ok('и у каждой игры она своя', /\/img\/club\/sniper\.webp/.test(html));
  html = await render(baseClub(), baseLot());   // возвращаемся ко входу

  console.log('\n── 15. Страница преферанса: правила до игры ──');
  // Игра платная, значит правила и цена должны быть видны ДО того, как
  // с игрока спишут золото.
  App._prefLast = null;
  html = await render(baseClub(), baseLot(), 'pref');
  ok('стоимость КАЖДОЙ карты расписана', c.querySelectorAll('.pref-val').length === 9);
  // Карты показаны картинками из колоды, а не буквами: подпись «В2»
  // игроку ничего не говорит, а сама карта — говорит.
  ok('каждая карта — картинка из колоды',
     c.querySelectorAll('.pref-val img').length === 9
     && [...c.querySelectorAll('.pref-val img')].every((i) => /\/img\/cards\//.test(i.getAttribute('src'))));
  ok('валет 2, дама 3, король 4, туз 11',
     /title="В — 2 очк\."/.test(html) && /title="Д — 3 очк\."/.test(html)
     && /title="К — 4 очк\."/.test(html) && /title="Т — 11 очк\."/.test(html));
  ok('правило туза объяснено', /туз.{0,80}за 1/i.test(html));
  ok('сказано, что ничья — проигрыш', /Ничья считается его победой/.test(html));
  ok('ставка названа до начала',
     /Ставка за партию<\/span><b><span class="ic-gold"><\/span> 10<\/b>/.test(html));
  ok('выигрыш назван', /Выигрыш<\/span><b class="gold"><span class="ic-gold"><\/span> 20<\/b>/.test(html));
  ok('эмодзи-монеты на странице игры не осталось', html.indexOf('🪙') < 0);
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
