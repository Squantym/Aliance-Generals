// Клуб офицеров после обновления:
// оставлены «Военный преферанс» и «Сейф штаба», удалены минное поле,
// полоса препятствий и штабная партия. Добавлены три новые игры:
//   3) Артиллерийская пристрелка — угадай дистанцию (перелёт/недолёт)
//   4) Военные кости — 5 кубиков, 2 переброса, комбинации
//   5) Штабной аукцион — слепые ставки очками влияния
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const club = require('../dist/src/services/club');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Игрок', 'password1', 'p@a.com', 'ru', '1.1.1.1');
  const p = Object.values(player.users()).find(x => x.name === 'Игрок');
  const clearCd = () => { p.club.cd = {}; };

  console.log('\n[1] Состав клуба: старые игры убраны, новые на месте');
  const v = club.view(p);
  ok('преферанс остался', !!v.pref);
  ok('сейф остался', !!v.safe);
  ok('минного поля нет', v.mine === undefined);
  ok('полосы препятствий нет', v.run === undefined);
  ok('штабной партии нет', v.duel === undefined);
  ok('артиллерия добавлена', !!v.arty);
  ok('кости добавлены', !!v.dice);
  ok('аукцион добавлен', !!v.bids);
  ok('старых функций нет в API', !club.mineStart && !club.runStart && !club.duelStart);
  ok('новые функции есть', !!club.artyStart && !!club.diceStart && !!club.bidsPlay);

  console.log('\n[2] Артиллерия: подсказки и награда за скорость');
  club.artyStart(p);
  const target = p.club.arty.target;
  ok(`дистанция в диапазоне ${c.CLUB.ARTY_MIN}..${c.CLUB.ARTY_MAX}`, target >= c.CLUB.ARTY_MIN && target <= c.CLUB.ARTY_MAX);
  // Заведомо неверный выстрел → корректная подсказка
  const wrong = target > c.CLUB.ARTY_MIN ? c.CLUB.ARTY_MIN : c.CLUB.ARTY_MAX;
  const miss = club.artyShoot(p, wrong, []);
  eq('промах распознан', miss.result, 'miss');
  eq('подсказка верная', miss.hint, wrong > target ? 'over' : 'under');
  // Точный выстрел → награда
  const goldBefore = p.gold;
  const hit = club.artyShoot(p, target, []);
  eq('попадание засчитано', hit.result, 'hit');
  ok('золото начислено', p.gold > goldBefore);
  ok('награда в диапазоне 10..20', hit.reward >= c.CLUB.ARTY_REWARD_MIN && hit.reward <= 20);
  ok('после победы кулдаун', club.view(p).arty.state === 'cooldown');
  // Раннее попадание выгоднее позднего
  clearCd(); club.artyStart(p);
  const t2 = p.club.arty.target;
  const fast = club.artyShoot(p, t2, []).reward;
  clearCd(); club.artyStart(p);
  const t3 = p.club.arty.target;
  const other = t3 > c.CLUB.ARTY_MIN ? c.CLUB.ARTY_MIN : c.CLUB.ARTY_MAX;
  club.artyShoot(p, other, []);
  const slow = club.artyShoot(p, t3, []).reward;
  ok(`попадание с 1-го выстрела выгоднее (${fast} > ${slow})`, fast > slow);

  console.log('\n[3] Артиллерия: патроны кончаются');
  clearCd(); club.artyStart(p);
  const t4 = p.club.arty.target;
  const miss4 = t4 > c.CLUB.ARTY_MIN ? c.CLUB.ARTY_MIN : c.CLUB.ARTY_MAX;
  let last;
  for (let i = 0; i < c.CLUB.ARTY_SHOTS; i++) last = club.artyShoot(p, miss4, []);
  eq('после всех промахов — проигрыш', last.result, 'lost');
  eq('цель раскрыта', last.target, t4);

  console.log('\n[4] Кости: комбинации, перебросы, выплата');
  clearCd();
  const dv = club.diceStart(p);
  eq('брошено 5 кубиков', dv.dice.length, c.CLUB.DICE_COUNT);
  ok('значения 1..6', dv.dice.every(d => d >= 1 && d <= 6));
  eq('перебросов 2', dv.rerollsLeft, c.CLUB.DICE_REROLLS);
  // Переброс без сохранения кубиков
  club.diceReroll(p, [], []);
  eq('после переброса остался 1', p.club.dice.rerollsLeft, 1);
  club.diceReroll(p, [0, 1], []);
  eq('перебросы кончились', p.club.dice.rerollsLeft, 0);
  throws('третий переброс отклонён', () => club.diceReroll(p, [], []));
  // Подсовываем заведомо выигрышную комбинацию
  p.club.dice.dice = [4, 4, 4, 4, 4];
  const g0 = p.gold;
  const fin = club.diceFinish(p, []);
  eq('пять одинаковых = «Полный залп»', fin.combo.id, 'five');
  eq('выплата 20', fin.reward, 20);
  eq('золото начислено', p.gold, g0 + 20);
  // Проигрышная комбинация
  clearCd(); club.diceStart(p);
  p.club.dice.dice = [1, 2, 3, 4, 6]; // не стрит и без пар
  const lose = club.diceFinish(p, []);
  eq('комбинация не собралась', lose.result, 'nothing');

  console.log('\n[5] Кости: распознавание комбинаций');
  const combo = (arr) => { clearCd(); club.diceStart(p); p.club.dice.dice = arr; const r = club.diceFinish(p, []); return r.combo ? r.combo.id : null; };
  eq('каре', combo([5, 5, 5, 5, 2]), 'four');
  eq('фулл-хаус', combo([3, 3, 3, 6, 6]), 'full');
  eq('стрит 1-5', combo([1, 2, 3, 4, 5]), 'straight');
  eq('стрит 2-6', combo([2, 3, 4, 5, 6]), 'straight');
  eq('тройка', combo([2, 2, 2, 5, 6]), 'three');
  eq('две пары', combo([2, 2, 5, 5, 6]), 'twopair');
  eq('ничего', combo([1, 2, 3, 5, 6]), null);

  console.log('\n[6] Аукцион: ставки, лимит очков, награда');
  clearCd();
  const bv = club.view(p).bids;
  eq('очков влияния 20', bv.points, c.CLUB.BIDS_POINTS);
  eq('лотов 3', bv.lots.length, c.CLUB.BIDS_LOTS);
  throws('перебор очков отклонён', () => club.bidsPlay(p, [20, 20, 20], []));
  throws('неверное число лотов отклонено', () => club.bidsPlay(p, [10, 10], []));
  clearCd();
  // Все очки в один лот — он почти наверняка берётся
  const g1 = p.gold;
  const res = club.bidsPlay(p, [20, 0, 0], []);
  eq('лотов в отчёте 3', res.lots.length, 3);
  ok('по каждому лоту видна ставка соперника', res.lots.every(l => typeof l.rivalBest === 'number'));
  ok('награда соответствует числу выигранных лотов',
     res.reward === res.won * c.CLUB.BIDS_REWARD_PER_LOT + (res.sweep ? c.CLUB.BIDS_SWEEP_BONUS : 0));
  ok('золото начислено при победе', res.reward > 0 ? p.gold === g1 + res.reward : p.gold === g1);
  ok('после игры кулдаун', club.view(p).bids.state === 'cooldown');

  console.log('\n[7] Игры засчитываются в ежедневное поручение');
  const daily = require('../dist/src/services/dailyQuests');
  const before = daily.ensureDaily(p).counters.clubPlayed || 0;
  clearCd(); club.artyStart(p); club.artyShoot(p, 1, []);
  ok('счётчик clubPlayed вырос', (daily.ensureDaily(p).counters.clubPlayed || 0) > before);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
