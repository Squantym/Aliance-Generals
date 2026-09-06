// ═══════════════════════════════════════════════════════════════════
// test/cards.test.js — колода «Военного преферанса»
//
// Игра перестала быть случайным числом от 2 до 11 и стала настоящей
// колодой из 36 карт с картинками. Отсюда три новых способа сломаться,
// и все три тихие:
//
//  1. КАРТА БЕЗ КАРТИНКИ. Имя файла выводится из id, поэтому опечатка в
//     таблице рангов не уронит сервер — она даст битую картинку на
//     экране у одного игрока из тридцати шести. Открываем каждый файл.
//
//  2. КАРТА ДВАЖДЫ НА СТОЛЕ. Раньше генерал тянул из воздуха, и та же
//     карта могла лежать у обоих. Колода одна на партию, и карты из неё
//     уходят.
//
//  3. ТУЗ. Он стоит 11, но при переборе считается за 1. Разойдись это
//     правило между сервером и экраном — игрок увидел бы «21» и
//     проигрыш одновременно. Поэтому сумму считает только сервер, а
//     тест проверяет именно его арифметику.
//
// Запуск: node test/cards.test.js  (после npm run build)
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
const club = require('../dist/src/services/club');
// Пульс клуба меряет РИТМ действий, и тесты правил гоняют партии пачками
// в один и тот же миллисекунд — для детектора это, справедливо, скрипт.
// Здесь проверяются правила игры, а не детектор, поэтому пульс глушим
// целиком и явно. За сам детектор отвечает test/clubbot.test.js.
require('../dist/src/services/antibot').track = () => ({ ok: true, suspicion: 0 });
const cfg = require('../dist/config/gameConfig');
const C = cfg.CLUB;

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const nx = [];

(async () => {
  await db.init();
  await auth.register('Картёжник', 'пароль123', 'k@t.ru', 'ru', '1.1.1.1');
  const U = Object.values(player.users()).find((x) => x.name === 'Картёжник');
  U.level = 100;
  // Игра платная: без золота не начнётся ни одна партия, а разделы про
  // колоду проверяют карты, а не кассу.
  U.gold = 1000000;
  const free = () => {
    if (U.club && U.club.cd) for (const k of Object.keys(U.club.cd)) U.club.cd[k] = 0;
    if (U.club) U.club.dayGold = 0;
    U.gold = 1000000;
    // Пачка партий подряд — машинный ритм, и пульс клуба справедливо
    // его тормозит. Здесь проверяются правила игры, а не детектор:
    // профиль поведения сбрасываем, как и кулдауны. За детектор
    // отвечает test/clubbot.
    U.behavior = null;
  };

  console.log('\n── 1. Колода собрана целиком ──');
  ok('в колоде 36 карт', cfg.CARD_DECK.length === 36);
  ok('все id разные', new Set(cfg.CARD_DECK).size === 36);
  ok('рангов девять', cfg.CARD_RANKS.length === 9);
  ok('мастей четыре', cfg.CARD_SUITS.length === 4);
  ok('каждый ранг в каждой масти',
     cfg.CARD_RANKS.every((r) => cfg.CARD_SUITS.every((s) => cfg.CARD_DECK.includes(r.id + '-' + s.id))));

  console.log('\n── 2. У каждой карты есть своя картинка ──');
  // Самая вероятная поломка: карта есть, файла нет. На экране это битая
  // картинка у одной карты из тридцати шести — заметят игроки, не мы.
  const missing = [];
  const empty = [];
  for (const id of cfg.CARD_DECK) {
    const info = cfg.cardInfo(id);
    if (!info) { missing.push(id + ' (не разбирается)'); continue; }
    const file = path.join(ROOT, 'public', info.img.replace(/^\//, ''));
    if (!fs.existsSync(file)) { missing.push(info.img); continue; }
    if (fs.statSync(file).size < 512) empty.push(info.img);
  }
  ok(missing.length ? `нет файлов: ${missing.join(', ')}` : 'все 36 картинок на месте', missing.length === 0);
  ok(empty.length ? `подозрительно пустые: ${empty.join(', ')}` : 'и ни одна не пустая', empty.length === 0);
  const back = path.join(ROOT, 'public', String(cfg.CARD_BACK).replace(/^\//, ''));
  ok('рубашка на месте', fs.existsSync(back) && fs.statSync(back).size > 512);
  // Имя файла обязано выводиться из id, а не лежать отдельным полем:
  // иначе список карт и список картинок разъедутся молча.
  ok('путь к картинке выводится из id',
     cfg.CARD_DECK.every((id) => cfg.cardInfo(id).img === '/img/cards/' + id + '.webp'));

  console.log('\n── 3. Стоимость карт ──');
  const val = (id) => cfg.cardInfo(id).value;
  ok('шестёрка стоит 6', val('06-spades') === 6);
  ok('десятка стоит 10', val('10-hearts') === 10);
  ok('валет стоит 2', val('jack-clubs') === 2);
  ok('дама стоит 3', val('queen-diamonds') === 3);
  ok('король стоит 4', val('king-spades') === 4);
  ok('туз стоит 11', val('ace-hearts') === 11);
  ok('масть на стоимость не влияет',
     cfg.CARD_SUITS.every((s) => val('king-' + s.id) === val('king-spades')));
  ok('ранги подписаны по-русски',
     cfg.cardInfo('jack-spades').rank === 'В' && cfg.cardInfo('ace-spades').rank === 'Т');
  ok('битый id не роняет разбор', cfg.cardInfo('черти-что') === null && cfg.cardInfo('') === null);

  console.log('\n── 4. Туз: 11, а при переборе 1 ──');
  const sum = cfg.handSum;
  ok('туз и девятка = 20', sum(['ace-spades', '09-hearts']) === 20);
  ok('два туза = 12, а не 22', sum(['ace-spades', 'ace-hearts']) === 12);
  ok('туз, десятка, десятка = 21', sum(['ace-spades', '10-hearts', '10-clubs']) === 21);
  ok('шестёрка, шестёрка, туз = 13, а не перебор',
     sum(['06-spades', '06-hearts', 'ace-clubs']) === 13);
  ok('три туза = 13', sum(['ace-spades', 'ace-hearts', 'ace-clubs']) === 13);
  ok('перебор без тузов остаётся перебором',
     sum(['10-spades', '10-hearts', '09-clubs']) === 29);
  ok('пустая рука — ноль', sum([]) === 0);
  ok('мусор в руке не ломает счёт', sum(['10-spades', 'ерунда']) === 10);

  console.log('\n── 5. Раздача: игрок видит обе руки ──');
  free();
  const v = club.prefStart(U);
  ok('у игрока две карты', v.hand.length === 2);
  ok('у генерала тоже две', v.foe.length === 2);
  ok('карты генерала ОТКРЫТЫ, а не спрятаны',
     v.foe.every((c) => c && c.id && c.img && typeof c.value === 'number'));
  ok('его сумма посчитана и показана', v.foeSum === cfg.handSum(v.foe.map((c) => c.id)));
  ok('своя сумма тоже', v.sum === cfg.handSum(v.hand.map((c) => c.id)));
  ok('у каждой карты есть путь к картинке', v.hand.concat(v.foe).every((c) => /^\/img\/cards\/.+\.webp$/.test(c.img)));
  ok('сказано, до скольки добирает генерал', v.dealerStop === C.PREF_DEALER_STOP);

  console.log('\n── 6. Одна карта не может лежать дважды ──');
  // Проверка не на одной партии: повтор — событие редкое, и на единичном
  // прогоне его легко не поймать.
  let dupes = 0, rounds = 0;
  for (let i = 0; i < 400; i++) {
    free();
    club.prefStart(U);
    let alive = true;
    for (let k = 0; k < 3 && alive; k++) {
      const r = club.prefHit(U, nx);
      if (r.result === 'bust') { alive = false; check(r.hand.concat(r.foe)); }
    }
    if (alive) { const r = club.prefStand(U, nx); check(r.hand.concat(r.foe)); }
  }
  function check(cards) {
    rounds++;
    const ids = cards.map((c) => c.id);
    if (new Set(ids).size !== ids.length) dupes++;
  }
  ok(`сыграно партий: ${rounds}`, rounds > 300);
  ok(`повторов на столе нет (${dupes})`, dupes === 0);

  console.log('\n── 7. Генерал добирает по правилу ──');
  let below = 0, over = 0, checked = 0;
  for (let i = 0; i < 300; i++) {
    free();
    club.prefStart(U);
    const r = club.prefStand(U, nx);
    checked++;
    if (r.foeSum < C.PREF_DEALER_STOP) below++;          // остановился рано — нельзя
    if (r.foeSum > C.PREF_TARGET) over++;                // перебрал — можно
  }
  ok(`ни разу не остановился раньше ${C.PREF_DEALER_STOP} (${below} из ${checked})`, below === 0);
  ok(`иногда перебирает — значит правда тянет (${over} из ${checked})`, over > 0);

  console.log('\n── 8. Итог партии показывает обе руки ──');
  free();
  club.prefStart(U);
  const fin = club.prefStand(U, nx);
  ok('в ответе рука игрока', Array.isArray(fin.hand) && fin.hand.length >= 2);
  ok('и рука генерала', Array.isArray(fin.foe) && fin.foe.length >= 2);
  ok('и что он добрал отдельно', Array.isArray(fin.drawn));
  ok('обе суммы названы', typeof fin.mySum === 'number' && typeof fin.foeSum === 'number');
  ok('исход однозначный', ['win', 'lose'].includes(fin.result));
  free();
  club.prefStart(U);
  let bust = null;
  for (let k = 0; k < 12 && !bust; k++) {
    const r = club.prefHit(U, nx);
    if (r.result === 'bust') bust = r;
  }
  ok('при переборе тоже видны обе руки',
     !bust || (Array.isArray(bust.hand) && Array.isArray(bust.foe) && typeof bust.foeSum === 'number'));

  console.log('\n── 10. Игра платная: ставка списывается, выигрыш возвращает вдвое ──');
  // Это единственная игра клуба, которая ЗАБИРАЕТ золото. Ошибка здесь
  // стоит дороже обычной: не списали ставку — игра начала печатать
  // золото; списали дважды — обобрали игрока.
  free();
  U.gold = 100;
  // Счётчик расхода накопительный: выше уже сыграно несколько сотен
  // партий. Сверять его с ценой одной ставки было ошибкой — смотрим
  // ПРИРОСТ.
  const spentBefore = ((U.stats || {}).goldSpent || {}).club_pref || 0;
  club.prefStart(U, nx);
  ok('ставка списана ровно один раз', U.gold === 100 - C.PREF_ENTRY_GOLD);
  ok('расход помечен источником club_pref',
     (((U.stats || {}).goldSpent || {}).club_pref || 0) - spentBefore === C.PREF_ENTRY_GOLD);
  // Повторный старт при идущей партии не должен брать деньги второй раз
  const g2 = U.gold;
  club.prefStart(U, nx);
  ok('за уже начатую партию второй раз не берут', U.gold === g2);

  // Без золота за стол не пускают
  free();
  U.club.pref = null;
  U.gold = C.PREF_ENTRY_GOLD - 1;
  let poor = null;
  try { club.prefStart(U, nx); } catch (e) { poor = e; }
  ok('без ставки играть нельзя', !!poor);
  ok('и золото при отказе не тронуто', U.gold === C.PREF_ENTRY_GOLD - 1);
  ok('партия при этом не началась', !U.club.pref);

  console.log('\n── 11. Выплата ровно PREF_WIN_GOLD ──');
  // Гоняем партии до победы и до проигрыша, считая живое золото.
  let sawWin = false, sawLose = false, badWin = 0, badLose = 0;
  for (let i = 0; i < 300 && !(sawWin && sawLose); i++) {
    free();
    U.gold = 1000; U.club.dayGold = 0;
    const before = U.gold;
    club.prefStart(U, nx);
    const r = club.prefStand(U, nx);
    const delta = U.gold - before;
    if (r.result === 'win') { sawWin = true; if (delta !== C.PREF_WIN_GOLD - C.PREF_ENTRY_GOLD) badWin++; }
    else { sawLose = true; if (delta !== -C.PREF_ENTRY_GOLD) badLose++; }
  }
  ok('победы случались', sawWin);
  ok('поражения тоже', sawLose);
  ok(`победа даёт ровно +${C.PREF_WIN_GOLD - C.PREF_ENTRY_GOLD} на руки (сбоев ${badWin})`, badWin === 0);
  ok(`поражение стоит ровно ${C.PREF_ENTRY_GOLD} (сбоев ${badLose})`, badLose === 0);

  console.log('\n── 12. Игра остаётся стоком золота ──');
  // Главная проверка: при выплате 20 за ставку 10 игра не должна
  // кормить игрока. Замер по 3000 партий наивной игрой.
  let net = 0, games = 0, wins = 0;
  for (let i = 0; i < 3000; i++) {
    free();
    U.gold = 100000; U.club.dayGold = 0;
    const before = U.gold;
    club.prefStart(U, nx);
    let busted = false;
    while (cfg.handSum(U.club.pref.hand) < 17) {
      if (club.prefHit(U, nx).result === 'bust') { busted = true; break; }
    }
    if (!busted && club.prefStand(U, nx).result === 'win') wins++;
    net += U.gold - before;
    games++;
  }
  const wr = wins / games;
  const perGame = net / games;
  ok(`винрейт ${(wr * 100).toFixed(1)}% — около обещанных 40%`, wr > 0.34 && wr < 0.48);
  ok(`игрок в среднем теряет ${perGame.toFixed(2)} 🪙 за партию`, perGame < 0);
  ok(`при выплате ${C.PREF_WIN_GOLD} за ставку ${C.PREF_ENTRY_GOLD} печатать золото нельзя`,
     C.PREF_WIN_GOLD * 0.5 <= C.PREF_ENTRY_GOLD * 1.15);

  console.log('\n── 13. Перерыв между партиями ──');
  free();
  U.gold = 1000;
  club.prefStart(U, nx);
  club.prefStand(U, nx);
  const cd = club.view(U).pref;
  ok('после партии — перерыв', cd.state === 'cooldown');
  ok(`перерыв ${C.PREF_CD_MIN} мин и после победы, и после поражения`,
     Math.abs(cd.cooldownSec - C.PREF_CD_MIN * 60) <= 2);
  let locked = null;
  try { club.prefStart(U, nx); } catch (e) { locked = e; }
  ok('в перерыв за стол не сесть', !!locked);
  const goldInBreak = U.gold;
  try { club.prefStart(U, nx); } catch (e) {}
  ok('и ставку за отказ в перерыве не берут', U.gold === goldInBreak);

  console.log('\n── 14. Шанс на выигрыш наружу не отдаётся ──');
  free();
  U.club.pref = null;
  const ready = club.view(U).pref;
  const asText = JSON.stringify(ready);
  ok('ставка и выигрыш названы', ready.entry === C.PREF_ENTRY_GOLD && ready.win === C.PREF_WIN_GOLD);
  ok('а вероятности победы в ответе нет',
     !/chance|odds|winrate|probab|шанс/i.test(asText));


  console.log('\n── 9. Сама проверка умеет краснеть ──');
  // Разделы 2 и 4 держатся на реальных файлах и реальном счёте, а не на
  // переписанных сюда ожиданиях.
  ok('файлы правда открывались', fs.existsSync(path.join(ROOT, 'public/img/cards/ace-spades.webp')));
  ok('подмена ранга сломала бы счёт', cfg.handSum(['jack-spades', 'jack-hearts']) === 4);
  ok('несуществующего файла проверка бы не нашла',
     !fs.existsSync(path.join(ROOT, 'public/img/cards/joker-spades.webp')));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
