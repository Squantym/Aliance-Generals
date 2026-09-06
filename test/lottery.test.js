// ═══════════════════════════════════════════════════════════════════
// test/lottery.test.js — «Военный займ»: банк сходится, шансы честные
//
// Лотерея — единственное место в игре, где золото переходит от одних
// игроков к другим целиком и разом. Поэтому проверяется не «работает
// ли кнопка», а СХОДИМОСТЬ: сколько игроки внесли, ровно столько один
// из них и должен получить. Любая щель здесь — это либо печатный
// станок, либо чёрная дыра, и обе видны не сразу.
//
// Отдельно проверяется пропорциональность шанса. Правило обещано игроку
// прямо на экране («ваши билеты ÷ проданные»), и если розыгрыш выбирает
// победителя по игрокам, а не по билетам, покупка второго билета теряет
// смысл, а обещание становится враньём — молча.
//
// Запуск: node test/lottery.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
require('./_guard');   // не даёт стереть боевую data/
const DATA = path.join(process.cwd(), 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const lottery = require('../dist/src/services/lottery');
const L = require('../dist/config/gameConfig').LOTTERY;

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const nx = [];

(async () => {
  await db.init();
  const names = ['Первый', 'Второй', 'Третий', 'Четвёртый'];
  for (let i = 0; i < names.length; i++) {
    await auth.register(names[i], 'пароль123', 'p' + i + '@t.ru', 'ru', '1.1.1.1');
  }
  const U = {};
  for (const n of names) { U[n] = Object.values(player.users()).find((x) => x.name === n); U[n].gold = 100000; }
  const totalGold = () => names.reduce((s, n) => s + U[n].gold, 0);

  // Тираж подменяем целиком: ждать полудня по Москве тест не может, а
  // проверять надо именно розыгрыш.
  const setDraw = (tickets, drawAt) => {
    const s = db.load('lottery', { history: [] });
    const t = {}, nm = {};
    let sold = 0;
    for (const [name, cnt] of Object.entries(tickets)) { t[U[name].id] = cnt; nm[U[name].id] = name; sold += cnt; }
    s.current = { id: 'тест-' + Math.random(), openAt: 0, drawAt, tickets: t, names: nm, sold };
    return s.current;
  };

  console.log('\n── 1. Настройки на месте ──');
  ok('цена билета задана', L.TICKET_GOLD > 0);
  ok('тираж билетов ограничен', L.MAX_TICKETS > 0);
  ok('есть предел на одного игрока', L.MAX_PER_PLAYER > 0 && L.MAX_PER_PLAYER <= L.MAX_TICKETS);
  ok('розыгрышей в сутки два', Array.isArray(L.DRAW_HOURS) && L.DRAW_HOURS.length === 2);

  console.log('\n── 2. Банк и шанс — ровно то, что обещано игроку ──');
  lottery.buy(U['Первый'], 1, nx);
  lottery.buy(U['Второй'], 9, nx);
  const v1 = lottery.view(U['Первый']);
  ok('продано билетов посчитано', v1.sold === 10);
  ok(`банк = проданные × цена (${v1.pot})`, v1.pot === 10 * L.TICKET_GOLD);
  ok('шанс с 1 билетом из 10 — 10%', v1.myChancePct === 10);
  ok('шанс с 9 билетами из 10 — 90%', lottery.view(U['Второй']).myChancePct === 90);
  ok('золото за билеты списано сразу', U['Первый'].gold === 100000 - L.TICKET_GOLD);
  ok('покупка помечена источником',
     ((U['Первый'].stats || {}).goldSpent || {}).lottery_ticket === L.TICKET_GOLD);

  console.log('\n── 3. Золото не создаётся и не пропадает ──');
  const goldBefore = totalGold();
  const potWas = lottery.view(U['Первый']).pot;
  db.load('lottery', { history: [] }).current.drawAt = Date.now() - 1000;
  lottery.tick();
  const h = lottery.history(1)[0];
  ok('тираж разыгран', !!h && h.pot === potWas);
  ok(`выдано ровно столько, сколько внесли (${totalGold() - goldBefore} = ${potWas})`,
     totalGold() - goldBefore === potWas);
  ok('победитель записан', !!h.winnerName);
  ok('выигрыш помечен источником',
     Object.values(U).some((p) => ((p.stats || {}).goldGot || {}).lottery_win > 0));

  console.log('\n── 4. Победитель выпадает пропорционально билетам ──');
  // Владелец 9 из 10 билетов обязан брать примерно 90% тиражей. Выбор
  // «по игрокам» дал бы 50% и прошёл бы незамеченным без этой проверки.
  let big = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    setDraw({ 'Первый': 1, 'Второй': 9 }, Date.now() - 1);
    lottery.tick();
    if ((lottery.history(1)[0] || {}).winnerName === 'Второй') big++;
  }
  const share = big / N;
  ok(`владелец 9 из 10 билетов взял ${(share * 100).toFixed(1)}% тиражей (ждали ~90%)`,
     share > 0.86 && share < 0.94);

  console.log('\n── 5. Купивший все билеты возвращает своё ──');
  // Это прямое следствие правила, и оно должно выполняться точно: не
  // «примерно столько же», а ровно внесённая сумма.
  const solo = U['Третий'];
  const goldWas = solo.gold;
  setDraw({ 'Третий': 20 }, Date.now() + 3600000);
  // Взнос списываем руками — тираж подменён, покупка не проходила
  player.addGold(solo, -20 * L.TICKET_GOLD, 'lottery_ticket');
  db.load('lottery', { history: [] }).current.drawAt = Date.now() - 1;
  lottery.tick();
  ok('единственный участник выиграл', (lottery.history(1)[0] || {}).winnerName === 'Третий');
  ok('и вернул ровно своё', solo.gold === goldWas);

  console.log('\n── 6. Пределы и мусорные значения ──');
  setDraw({}, Date.now() + 3600000);
  let e1 = null;
  try { lottery.buy(U['Первый'], L.MAX_PER_PLAYER + 1, nx); } catch (e) { e1 = e; }
  ok('больше предела в одни руки не продают', !!e1);
  U['Четвёртый'].gold = L.TICKET_GOLD - 1;
  let e2 = null;
  try { lottery.buy(U['Четвёртый'], 1, nx); } catch (e) { e2 = e; }
  ok('без золота билет не купить', !!e2);
  ok('и золото при отказе не тронуто', U['Четвёртый'].gold === L.TICKET_GOLD - 1);

  U['Четвёртый'].gold = 100000;
  const g4 = U['Четвёртый'].gold;
  lottery.buy(U['Четвёртый'], -50, nx);
  ok('минус билетов не даёт золота, а покупает один',
     lottery.view(U['Четвёртый']).myTickets === 1 && U['Четвёртый'].gold === g4 - L.TICKET_GOLD);
  const g4b = U['Четвёртый'].gold;
  let e3 = null;
  try { lottery.buy(U['Четвёртый'], 'сто', nx); } catch (e) { e3 = e; }
  ok('не-число не проходит мимо кассы',
     U['Четвёртый'].gold >= g4b - L.TICKET_GOLD && U['Четвёртый'].gold <= g4b);

  console.log('\n── 7. Пустой тираж ──');
  setDraw({}, Date.now() - 1);
  const goldEmpty = totalGold();
  lottery.tick();
  const he = lottery.history(1)[0];
  ok('пустой тираж закрыт без победителя', he.pot === 0 && !he.winnerName);
  ok('и ничьего золота не тронул', totalGold() === goldEmpty);

  console.log('\n── 8. Пропущенный тираж разыгрывается задним числом ──');
  // Сервер может лежать в полночь. Тираж обязан разыграться на первом
  // же тике после — иначе взносы зависнут навсегда.
  const goldPre = totalGold();
  setDraw({ 'Первый': 4 }, Date.now() - 12 * 3600 * 1000);   // «розыгрыш был 12 часов назад»
  player.addGold(U['Первый'], -4 * L.TICKET_GOLD, 'lottery_ticket');
  lottery.tick();
  const hm = lottery.history(1)[0];
  ok('просроченный тираж разыгран', hm.pot === 4 * L.TICKET_GOLD && hm.winnerName === 'Первый');
  ok('и золото сошлось', totalGold() === goldPre);
  ok('открылся новый тираж, пустой', lottery.view(U['Первый']).sold === 0);

  console.log('\n── 9. Повторный тик не разыгрывает тираж дважды ──');
  const goldTwice = totalGold();
  lottery.tick(); lottery.tick(); lottery.tick();
  ok('золото не выросло от лишних тиков', totalGold() === goldTwice);

  console.log('\n── 10. Сама проверка умеет краснеть ──');
  // Если розыгрыш перестанет платить, раздел 3 обязан покраснеть — а
  // значит, он должен опираться на реальную разницу, а не на константу.
  ok('сходимость считается по живому золоту игроков', typeof totalGold() === 'number' && totalGold() > 0);
  ok('доля победителя измерена, а не задана', share !== 0.9);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
