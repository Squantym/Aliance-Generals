// ═══════════════════════════════════════════════════════════════════
// test/clubdraw.test.js — ничья в клубе офицеров возвращает взнос
//
// Жалоба владельца: при ничье взнос должен возвращаться во ВСЕХ играх
// клуба. У радиоперехвата и снайперской дуэли так было с самого начала,
// а преферанс при равном счёте забирал ставку себе: «равенство и меньше
// — проигрыш, генерал на своём поле».
//
// Что стережётся:
//  1. Равный счёт в преферансе — ничья, а не проигрыш, и взнос
//     возвращается ровно в том размере, в каком был взят.
//  2. Возврат не считается выигрышем: суточный потолок золота клуба он
//     не расширяет — иначе через ничьи можно было бы обходить лимит.
//  3. Победа и поражение работают как прежде: это правка одного случая,
//     а не переделка игры.
//  4. Ни одна игра клуба не забирает взнос при ничье — проверяем по
//     исходникам, что путь возврата есть у каждой.
//
// Запуск: node test/clubdraw.test.js   (после npm run build)
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
const club = require('../dist/src/services/club');
const config = require('../dist/config/gameConfig');
const C = config.CLUB;
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

// Колоду в партии подменяем руками: случайные карты не дают поставить
// нужный исход, а проверяем мы кассу, а не раздачу.
const cardsOf = (ranks) => ranks.map((r) => config.CARD_DECK.find((id) => id.startsWith(r)));

(async () => {
  await db.init();
  await auth.register('Игрок', 'пароль123', 'p@t.ru', 'ru', '1.1.1.1');
  const user = Object.values(player.users()).find((x) => x.name === 'Игрок');
  user.level = 30; user.gold = 5000;
  const nx = [];
  const state = () => club.kassa.clubState(user);
  // Перерывы и задержку «антискрипта» снимаем перед каждым ходом: тест
  // играет с машинной регулярностью, а её штаб честно придерживает.
  const noCd = () => { const c = state(); c.cd = {}; user.lastClubAt = 0; };
  const stand = () => { noCd(); return club.prefStand(user, nx); };

  // Партия с заранее заданными руками: у игрока и у генерала поровну,
  // и генерал уже не добирает (17 и больше).
  const setHands = (mine, foe) => {
    noCd();
    club.prefStart(user, nx);
    const c = state();
    c.pref.hand = cardsOf(mine);
    c.pref.foe = cardsOf(foe);
    c.pref.deck = config.CARD_DECK.slice();
  };

  console.log('\n[1] Равный счёт — ничья, взнос назад');
  const before = user.gold;
  setHands(['10', '09'], ['10', '09']);          // 19 против 19
  const spent = before - user.gold;
  eq('взнос за партию списан', spent, C.PREF_ENTRY_GOLD);
  const r = stand();
  eq('итог — ничья', r.result, 'draw');
  eq('сумма игрока равна сумме генерала', r.mySum, r.foeSum);
  eq('вернули ровно взнос', r.back, C.PREF_ENTRY_GOLD);
  eq('золото вернулось на счёт', user.gold, before);
  ok('игроку сказали про возврат', nx.some((s) => /Ничья/.test(s) && /озвращ/.test(s)));

  console.log('\n[2] Возврат не расширяет суточный потолок');
  const c2 = state();
  const b2 = club.kassa.budget(c2);
  eq('потраченного за сутки нет: сколько внесли, столько и вернули', b2.spent, 0);
  eq('и весь суточный потолок на месте', b2.left, b2.cap);

  console.log('\n[3] Победа и поражение не тронуты');
  const beforeWin = user.gold;
  setHands(['10', '10'], ['10', '08']);          // 20 против 18
  const win = stand();
  eq('перевес игрока — победа', win.result, 'win');
  ok(`выигрыш пришёл: ${user.gold - beforeWin + C.PREF_ENTRY_GOLD}`, user.gold > beforeWin);
  const beforeLose = user.gold;
  setHands(['10', '08'], ['10', '10']);          // 18 против 20
  const lose = stand();
  eq('перевес генерала — поражение', lose.result, 'lose');
  eq('взнос при проигрыше не возвращается', beforeLose - user.gold, C.PREF_ENTRY_GOLD);

  console.log('\n[4] Перебор генерала остаётся победой игрока');
  setHands(['10', '09'], ['10', '10', '06']);    // 19 против 26
  const bust = stand();
  eq('генерал перебрал — победа', bust.result, 'win');

  console.log('\n[5] Ничья возвращает взнос во всех играх клуба');
  const clubSrc = fs.readFileSync(path.join(ROOT, 'src/services/club.ts'), 'utf8');
  const matchSrc = fs.readFileSync(path.join(ROOT, 'src/services/clubMatch.ts'), 'utf8');
  ok('преферанс: ничья идёт через возврат',
     /if \(tie\) \{[\s\S]{0,200}giveBack\(user, 'pref'/.test(clubSrc));
  ok('парные игры: ничья возвращает взнос обоим',
     /winnerId === null[\s\S]{0,300}giveBack\(p, m\.game/.test(matchSrc));
  ok('отменённая очередь тоже возвращает', /giveBack\(p, q\.game/.test(matchSrc));
  // Тактическая дуэль идёт до N побед: ничья в раунде не заканчивает
  // партию, и возвращать при ней нечего — взнос остаётся в игре
  ok('в дуэли ничья раунда не завершает партию',
     /if \(res === 'win'\) d\.my\+\+;/.test(clubSrc) && /if \(res === 'lose'\) d\.foe\+\+;/.test(clubSrc));

  console.log('\n[6] Экран показывает ничью, а не поражение');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/screens/market.js'), 'utf8');
  ok('итог партии знает про ничью', /last\.result === 'draw' \? '🤝 Ничья/.test(js));
  ok('и показывает возврат', /last\.back \? `.{0,40}возврат/.test(js));
  ok('ничья не красится как проигрыш', /last\.result === 'draw' \? '' : 'pf-lose'/.test(js));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
