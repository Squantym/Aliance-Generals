// Клуб офицеров после обновления:
// оставлены «Военный преферанс», «Сейф штаба» и «Тактическая дуэль»,
// удалены минное поле, полоса препятствий, штабная партия, артиллерия,
// ночной рейд, кости и аукцион. Добавлены три новые игры:
//   3) Ночной караван — маршрут против засад живых игроков
//   4) Сапёрная тропа — идти дальше или забрать набранное
//   5) Полевой тотализатор — ставка на одно из трёх отделений
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');   // не даёт стереть боевую data/
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const club = require('../dist/src/services/club');
const utils = require('../dist/src/core/utils');
// Пульс клуба меряет РИТМ действий, и тесты правил гоняют партии пачками
// в один и тот же миллисекунд — для детектора это, справедливо, скрипт.
// Здесь проверяются правила игры, а не детектор, поэтому пульс глушим
// целиком и явно. За сам детектор отвечает test/clubbot.test.js.
require('../dist/src/services/antibot').track = () => ({ ok: true, suspicion: 0 });
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Игрок', 'password1', 'p@a.com', 'ru', '1.1.1.1');
  await auth.register('Второй', 'password1', 'p2@a.com', 'ru', '1.1.1.2');
  const p = Object.values(player.users()).find(x => x.name === 'Игрок');
  const p2 = Object.values(player.users()).find(x => x.name === 'Второй');
  // Сбрасываем заодно суточный расход золота. Этот файл проверяет
  // ПРАВИЛА игр — добычу каравана, шаг сапёра, коэффициенты конторы.
  // Суточный потолок клуба до них не относится и, накопившись за
  // предыдущие разделы, обрезал бы награды: проверка стала бы зависеть
  // от того, сколько золота выпало выше. За сам потолок отвечает
  // отдельный тест clubcap.
  const clearCd = (who) => { const w = who || p; w.club.cd = {}; w.club.dayGold = 0; w.behavior = null; };

  console.log('\n[1] Состав клуба: старые игры убраны, новые на месте');
  const v = club.view(p);
  ok('преферанс остался', !!v.pref);
  ok('сейф остался', !!v.safe);
  ok('тактическая дуэль осталась', !!v.tactic);
  ok('минного поля нет', v.mine === undefined);
  ok('полосы препятствий нет', v.run === undefined);
  ok('штабной партии нет', v.duel === undefined);
  ok('артиллерии больше нет', v.arty === undefined);
  ok('ночного рейда больше нет', v.raid === undefined);
  ok('костей больше нет', v.dice === undefined);
  ok('аукциона больше нет', v.bids === undefined);
  ok('караван добавлен', !!v.convoy);
  ok('сапёрная тропа добавлена', !!v.sapper);
  ok('тотализатор добавлен', !!v.bookie);
  ok('старых функций нет в API',
     !club.mineStart && !club.runStart && !club.duelStart && !club.artyStart && !club.safeStart
     && !club.raidStart && !club.diceStart && !club.bidsPlay);
  ok('новые функции есть',
     !!club.convoyGo && !!club.sapperStart && !!club.sapperStep && !!club.sapperTake && !!club.bookieBet);

  console.log('\n[2] Караван: чистый маршрут, добыча и своя засада');
  clearCd();
  eq('маршрутов три', v.convoy.routes.length, c.CLUB.CONVOY_ROUTES.length);
  throws('без маршрута выйти нельзя', () => club.convoyGo(p, '', 'coast', []));
  throws('без засады выйти нельзя', () => club.convoyGo(p, 'mountain', '', []));
  throws('выдуманный маршрут отклонён', () => club.convoyGo(p, 'metro', 'coast', []));
  const g0 = p.gold;
  const go1 = club.convoyGo(p, 'mountain', 'coast', []);
  eq('засад в мире не было — караван прошёл', go1.result, 'through');
  eq('добыча начислена', go1.reward, c.CLUB.CONVOY_LOOT);
  eq('золото выросло ровно на добычу', p.gold, g0 + c.CLUB.CONVOY_LOOT);
  const cv1 = club.view(p).convoy;
  eq('после выхода кулдаун', cv1.state, 'cooldown');
  eq('своя засада поставлена на побережье', cv1.myAmbush.route, 'coast');
  eq('засад в округе — одна', cv1.ambushes, 1);
  throws('второй выход по кулдауну отклонён', () => club.convoyGo(p, 'steppe', 'steppe', []));

  console.log('\n[3] Караван: сводка выходов анонимна');
  const log0 = cv1.log[0];
  eq('в сводке верный маршрут', log0.route, 'mountain');
  eq('и отметка «прошёл»', log0.hit, false);
  ok('метка анонимная, а не имя игрока', /^К-\d\d$/.test(log0.tag));
  ok('имени владельца каравана в сводке нет', JSON.stringify(log0).indexOf(p.name) < 0);
  ok('видно не больше положенного', club.view(p).convoy.log.length <= c.CLUB.CONVOY_LOG);

  console.log('\n[4] Караван: чужая засада срабатывает и расходуется');
  clearCd(p2);
  const g2 = p2.gold, gOwner = p.gold;
  const go2 = club.convoyGo(p2, 'coast', 'steppe', []);
  eq('напоролся на засаду', go2.result, 'ambushed');
  eq('добычи нет', go2.reward, 0);
  eq('и золото не тронуто — платит игра, а не проигравший', p2.gold, g2);
  eq('владельцу засады заплачено', p.gold, gOwner + c.CLUB.CONVOY_AMBUSH_PAY);
  const cv2 = club.view(p2).convoy;
  eq('сработавшая засада снята, осталась только новая', cv2.ambushes, 1);
  eq('и новая — своя', cv2.myAmbush.route, 'steppe');
  // На своей засаде не подрываются: иначе ставить её было бы нельзя
  clearCd(p2);
  const go3 = club.convoyGo(p2, 'steppe', 'steppe', []);
  eq('на собственной засаде караван проходит', go3.result, 'through');

  console.log('\n[5] Сапёр: шаг, рост добычи, отход');
  clearCd();
  const sv = club.sapperStart(p);
  eq('поле открыто', sv.state, 'active');
  eq('клеток столько, сколько задано', sv.cells, c.CLUB.SAPPER_CELLS);
  eq('мин столько, сколько задано', sv.mines, c.CLUB.SAPPER_MINES);
  eq('пока не открыто ничего', sv.opened.length, 0);
  eq('уносить нечего', sv.loot, 0);
  ok('риск первого шага показан заранее', sv.nextRiskPct > 0);
  eq('добыча за первый шаг показана заранее', sv.nextLoot, c.CLUB.SAPPER_LOOT[0]);
  const s1 = club.sapperStep(p, 0, []);
  eq('первый шаг всегда чистый', s1.result, 'clear');
  eq('добыча за одну клетку', s1.loot, c.CLUB.SAPPER_LOOT[0]);
  ok('риск следующего шага вырос', s1.nextRiskPct > sv.nextRiskPct);
  ok('и добыча тоже', s1.nextLoot > s1.loot);
  throws('дважды одну клетку не открыть', () => club.sapperStep(p, 0, []));
  throws('клетки вне поля нет', () => club.sapperStep(p, c.CLUB.SAPPER_CELLS, []));
  // Уводим мины в дальний угол: проверяем расчёт добычи, а не везение
  p.club.sapper.mines = [7, 8];
  club.sapperStep(p, 1, []);
  const gS = p.gold;
  const take = club.sapperTake(p, []);
  eq('отход засчитан', take.result, 'taken');
  eq('унесено две клетки', take.opened, 2);
  eq('добыча по второй клетке', take.reward, c.CLUB.SAPPER_LOOT[1]);
  eq('золото начислено ровно на добычу', p.gold, gS + c.CLUB.SAPPER_LOOT[1]);
  eq('после отхода кулдаун', club.view(p).sapper.state, 'cooldown');
  throws('без начатой тропы шага нет', () => club.sapperStep(p, 3, []));

  console.log('\n[6] Сапёр: подрыв и конец тропы');
  clearCd();
  club.sapperStart(p);
  club.sapperStep(p, 0, []);
  p.club.sapper.mines = [5];
  const gB = p.gold;
  const boom = club.sapperStep(p, 5, []);
  eq('подрыв', boom.result, 'boom');
  eq('потеряна вся набранная добыча', boom.lostLoot, c.CLUB.SAPPER_LOOT[0]);
  eq('золота не прибавилось', p.gold, gB);
  eq('после подрыва кулдаун', club.view(p).sapper.state, 'cooldown');
  throws('после подрыва идти некуда', () => club.sapperStep(p, 1, []));
  // Проходим тропу до конца
  clearCd();
  club.sapperStart(p);
  club.sapperStep(p, 0, []);
  p.club.sapper.mines = [7, 8];
  let last = null;
  for (let n = 1; n < c.CLUB.SAPPER_LOOT.length; n++) last = club.sapperStep(p, n, []);
  eq('дошёл до конца тропы', last.result, 'maxed');
  eq('дальше рисковать нечем', last.nextRiskPct, null);
  const gM = p.gold;
  const full = club.sapperTake(p, []);
  eq('унесена полная добыча', full.reward, c.CLUB.SAPPER_LOOT[c.CLUB.SAPPER_LOOT.length - 1]);
  eq('золото начислено', p.gold, gM + full.reward);
  // Уйти, не сделав ни шага, можно — но пусто и без кулдауна
  clearCd();
  club.sapperStart(p);
  const emptyTake = club.sapperTake(p, []);
  eq('ушёл без единого шага — пусто', emptyTake.result, 'empty');
  eq('и без золота', emptyTake.reward, 0);
  eq('кулдаун за несыгранное не ставится', club.view(p).sapper.state, 'ready');
  // Первый шаг обязан быть чистым ВСЕГДА, а не в среднем: подорваться
  // первым же щелчком, ничего не решив, — не игра. Проверять это одним
  // выходом бесполезно: при 2 минах на 9 клеток сломанная расстановка
  // прошла бы четыре раза из пяти.
  let firstBoom = 0;
  for (let i = 0; i < 40; i++) {
    clearCd();
    club.sapperStart(p);
    if (club.sapperStep(p, i % c.CLUB.SAPPER_CELLS, []).result === 'boom') firstBoom++;
    else club.sapperTake(p, []);
  }
  eq('за 40 выходов ни одного подрыва первым шагом', firstBoom, 0);

  console.log('\n[7] Тотализатор: коэффициенты, ставка, выплата');
  clearCd();
  const bv = club.view(p).bookie;
  eq('отделений три', bv.squads.length, c.CLUB.BOOKIE_SQUADS.length);
  eq('ставка из конфига', bv.stake, c.CLUB.BOOKIE_STAKE);
  ok('шансы наружу не отдаются', bv.squads.every(s => s.chance === undefined));
  // Коэффициент занижен относительно честного ровно на маржу
  for (const sq of c.CLUB.BOOKIE_SQUADS) {
    const shown = bv.squads.find(s => s.id === sq.id);
    const fair = 100 / sq.chance;
    ok(`коэффициент ${sq.id} ниже честного`, shown.odds < fair);
    eq(`маржа ${sq.id} учтена`, shown.odds, Math.round(fair * (1 - c.CLUB.BOOKIE_MARGIN) * 100) / 100);
    eq(`выплата ${sq.id} посчитана сервером`, shown.payout, Math.round(c.CLUB.BOOKIE_STAKE * shown.odds));
  }
  // Дом в плюсе на КАЖДОМ отделении: шанс × фактическая выплата меньше
  // ставки. Иначе нашлось бы одно отделение, на которое можно ставить
  // бесконечно и в плюс — ровно то, что сделает скрипт.
  for (const sq of c.CLUB.BOOKIE_SQUADS) {
    const shown = bv.squads.find(s => s.id === sq.id);
    ok(`ставка на ${sq.id} в минус игроку`,
       (sq.chance / 100) * shown.payout < c.CLUB.BOOKIE_STAKE);
  }
  eq('шансы отделений дают полную сотню',
     c.CLUB.BOOKIE_SQUADS.reduce((s, sq) => s + sq.chance, 0), 100);
  throws('выдуманное отделение отклонено', () => club.bookieBet(p, 'delta', []));

  // Забег разыгрывается броском u.rnd — подменяем его, чтобы проверить
  // обе ветки расчёта, а не ловить их случайностью.
  const realRnd = utils.rnd;
  utils.rnd = () => 1;              // roll = 1 → побеждает первое отделение
  try {
    clearCd();
    const gWin = p.gold;
    const win = club.bookieBet(p, 'alpha', []);
    eq('ставка сыграла', win.result, 'win');
    eq('выплата по коэффициенту', win.reward,
       Math.round(c.CLUB.BOOKIE_STAKE * bv.squads.find(s => s.id === 'alpha').odds));
    eq('золото: минус ставка, плюс выплата', p.gold, gWin - c.CLUB.BOOKIE_STAKE + win.reward);
    eq('после ставки кулдаун', club.view(p).bookie.state, 'cooldown');
    clearCd();
    const gLose = p.gold;
    const lose = club.bookieBet(p, 'charlie', []);
    eq('ставка не сыграла', lose.result, 'lose');
    eq('выплаты нет', lose.reward, 0);
    eq('ставка удержана', p.gold, gLose - c.CLUB.BOOKIE_STAKE);
    // Без золота на ставку игра не пускает
    clearCd();
    const keep = p.gold;
    p.gold = c.CLUB.BOOKIE_STAKE - 1;
    throws('без золота ставку не принимают', () => club.bookieBet(p, 'alpha', []));
    p.gold = keep;
  } finally { utils.rnd = realRnd; }

  console.log('\n[8] Игры засчитываются в ежедневное поручение');
  const daily = require('../dist/src/services/dailyQuests');
  const before = daily.ensureDaily(p).counters.clubPlayed || 0;
  clearCd(); club.convoyGo(p, 'mountain', 'mountain', []);
  clearCd(); club.sapperStart(p); club.sapperStep(p, 0, []); club.sapperTake(p, []);
  clearCd(); club.bookieBet(p, 'bravo', []);
  eq('счётчик clubPlayed вырос на три игры',
     (daily.ensureDaily(p).counters.clubPlayed || 0) - before, 3);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
