// Клуб офицеров после обновления:
// оставлены «Военный преферанс» и «Сейф штаба», удалены минное поле,
// полоса препятствий и штабная партия. Добавлены три новые игры:
//   3) Артиллерийская пристрелка — угадай дистанцию (перелёт/недолёт)
//   4) Военные кости — 5 кубиков, 2 переброса, комбинации
//   5) Штабной аукцион — слепые ставки очками влияния
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');   // не даёт стереть боевую data/
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const club = require('../dist/src/services/club');
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
  const p = Object.values(player.users()).find(x => x.name === 'Игрок');
  // Сбрасываем заодно суточный расход золота. Этот файл проверяет
  // ПРАВИЛА игр — комбинации костей, подсказки артиллерии, награду за
  // лоты. Суточный потолок клуба до них не относится и, накопившись за
  // предыдущие разделы, обрезал бы награды: проверка стала бы зависеть
  // от того, сколько золота выпало выше. За сам потолок отвечает
  // отдельный тест clubcap.
  const clearCd = () => { p.club.cd = {}; p.club.dayGold = 0; p.behavior = null; };

  console.log('\n[1] Состав клуба: старые игры убраны, новые на месте');
  const v = club.view(p);
  ok('преферанс остался', !!v.pref);
  ok('сейф остался', !!v.safe);
  ok('минного поля нет', v.mine === undefined);
  ok('полосы препятствий нет', v.run === undefined);
  ok('штабной партии нет', v.duel === undefined);
  ok('артиллерии больше нет', v.arty === undefined);
  ok('ночной рейд добавлен', !!v.raid);
  ok('кости добавлены', !!v.dice);
  ok('аукцион добавлен', !!v.bids);
  ok('тактическая дуэль добавлена', !!v.tactic);
  ok('старых функций нет в API',
     !club.mineStart && !club.runStart && !club.duelStart && !club.artyStart && !club.safeStart);
  ok('новые функции есть', !!club.raidStart && !!club.diceStart && !!club.bidsPlay && !!club.tacticStart);

  console.log('\n[2] Ночной рейд: добыча растёт вместе с риском');
  clearCd();
  const rv = club.raidStart(p);
  eq('рубежей столько, сколько задано', rv.total, c.CLUB.RAID_RISK_PCT.length);
  eq('рубежей взято ноль', rv.step, 0);
  eq('уносить пока нечего', rv.loot, 0);
  ok('риск следующего рубежа показан ДО решения', rv.nextRisk === c.CLUB.RAID_RISK_PCT[0]);
  ok('и добыча за него тоже', rv.nextLoot === c.CLUB.RAID_LOOT[0]);
  // Риск обязан расти вместе с добычей — иначе решения нет, надо просто идти до конца
  const risks = c.CLUB.RAID_RISK_PCT, loots = c.CLUB.RAID_LOOT;
  ok('риск строго растёт', risks.every((x, i) => i === 0 || x > risks[i - 1]));
  ok('добыча строго растёт', loots.every((x, i) => i === 0 || x > loots[i - 1]));
  eq('рядов риска и добычи поровну', risks.length, loots.length);

  console.log('\n[3] Рейд: отход и срыв');
  // Проходим рубеж принудительно, минуя случайность: нас интересует
  // расчёт добычи, а не то, повезло ли броску.
  clearCd(); club.raidStart(p);
  p.club.raid.step = 3;
  const gRaid = p.gold;
  const home = club.raidPull(p, []);
  eq('отход засчитан', home.result, 'home');
  eq('добыча по третьему рубежу', home.reward, c.CLUB.RAID_LOOT[2]);
  eq('золото начислено ровно на добычу', p.gold, gRaid + c.CLUB.RAID_LOOT[2]);
  ok('после отхода кулдаун', club.view(p).raid.state === 'cooldown');

  clearCd(); club.raidStart(p);
  const empty = club.raidPull(p, []);
  eq('отход без взятых рубежей — пусто', empty.result, 'empty');
  eq('и без золота', empty.reward, 0);

  // Срыв: подменяем риск на гарантированный, чтобы проверить потерю
  clearCd(); club.raidStart(p);
  p.club.raid.step = 4;
  const saved = c.CLUB.RAID_RISK_PCT[4];
  c.CLUB.RAID_RISK_PCT[4] = 100;
  const gLost = p.gold;
  const lost = club.raidPush(p, []);
  c.CLUB.RAID_RISK_PCT[4] = saved;
  eq('срыв на рубеже', lost.result, 'lost');
  eq('потеряна вся набранная добыча', lost.lostLoot, c.CLUB.RAID_LOOT[3]);
  eq('золота не прибавилось', p.gold, gLost);
  throws('после срыва идти некуда', () => club.raidPush(p, []));

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
  clearCd(); club.raidStart(p); club.raidPush(p, []);
  ok('счётчик clubPlayed вырос', (daily.ensureDaily(p).counters.clubPlayed || 0) > before);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
