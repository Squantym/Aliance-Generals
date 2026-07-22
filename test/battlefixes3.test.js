// Правки:
// (1) ракета летит 30 минут; (2) реакция на террористов в шахте — 30 минут;
// (3) исход боя: уворот НЕ переворачивает результат — решает реальная мощь
//     (слабый, увернувшись, всё равно проигрывает сильному);
// (4) окно обучения исчезает после прохождения курса;
// (5) результат боя сбрасывается при уходе с экрана «Война».
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const c = require('../dist/config/gameConfig');
const ROOT = process.cwd();
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();

  console.log('\n[1] Таймеры: ракета и шахта — по 30 минут');
  eq('ракета летит 30 минут', c.SILO.FLIGHT_MS, 30 * 60 * 1000);
  eq('реакция на террористов 30 минут', c.MINE.TERRORIST_REACT_MS, 30 * 60 * 1000);
  const silosSrc = fs.readFileSync(path.join(ROOT, 'src/services/silos.ts'), 'utf8');
  ok('текст долёта берётся из конфига (не зашит «10 минут»)', /flightMin/.test(silosSrc) && !/Долёт через 10 минут/.test(silosSrc));

  console.log('\n[2] Уворот НЕ переворачивает исход: решает реальная мощь');
  await auth.register('Сильный', 'password1', 's@a.com', 'ru', '1.1.1.1');
  await auth.register('Слабый', 'password1', 'w@a.com', 'ru', '1.1.1.2');
  const strong = Object.values(player.users()).find(x => x.name === 'Сильный');
  const weak = Object.values(player.users()).find(x => x.name === 'Слабый');
  strong.level = 100; weak.level = 100;
  const hi = c.UNITS[Math.min(18, c.UNITS.length - 1)], lo = c.UNITS[0];
  strong.units = { [hi.id]: { 0: 3000, 1: 0, 2: 0 } };
  weak.units = { [lo.id]: { 0: 1, 1: 0, 2: 0 } };
  // Максимальная ловкость жертвы → уворот срабатывает часто
  weak.skills.agility = 100;
  strong.skills.agility = 0;
  db.save('users');

  const reset = (p) => { p.lastAttackAt = 0; p.pendingFatality = null; p.pendingBankHack = null; p.pendingMineDefuse = null;
    const mx = player.maxima(p); p.res.hp.cur = mx.hp; p.res.am.cur = mx.am; p.res.en.cur = mx.en; };

  let fights = 0, strongWins = 0, dodgeFights = 0, dodgeStrongWins = 0, zeroDealtWins = 0;
  for (let i = 0; i < 200; i++) {
    reset(strong); weak.res.hp.cur = player.maxima(weak).hp;
    const r = battle.attack(strong, weak.id, []);
    if (r.encounter) continue;
    fights++;
    if (r.win) strongWins++;
    if (r.dodge || r.attackerDodge) {           // был уворот любой из сторон
      dodgeFights++;
      if (r.win) dodgeStrongWins++;
    }
    if (r.dealt === 0 && r.win) zeroDealtWins++; // увернулись от него — но он сильнее
  }
  ok(`боёв проведено (${fights})`, fights >= 50);
  ok(`увороты случались (${dodgeFights})`, dodgeFights > 0);
  eq('сильный победил ВО ВСЕХ боях', strongWins, fights);
  eq('в боях с уворотом сильный тоже победил всегда', dodgeStrongWins, dodgeFights);
  ok(`есть победы при нулевом уроне из-за уворота цели (${zeroDealtWins})`, zeroDealtWins > 0);

  console.log('\n[3] Обратный случай: слабый атакует сильного и увернулся — всё равно проигрывает');
  let wFights = 0, wWins = 0, wDodgeFights = 0, wDodgeWins = 0;
  for (let i = 0; i < 200; i++) {
    reset(weak); strong.res.hp.cur = player.maxima(strong).hp;
    const r = battle.attack(weak, strong.id, []);
    if (r.encounter) continue;
    wFights++;
    if (r.win) wWins++;
    if (r.dodge || r.attackerDodge) { wDodgeFights++; if (r.win) wDodgeWins++; }
  }
  ok(`боёв слабого проведено (${wFights})`, wFights >= 50);
  ok(`увороты у слабого случались (${wDodgeFights})`, wDodgeFights > 0);
  eq('слабый не выиграл ни одного боя у сильного', wWins, 0);
  eq('даже увернувшись, слабый не выиграл', wDodgeWins, 0);

  console.log('\n[4] Окно обучения исчезает после курса');
  const coreSrc = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok('после прохождения курса карточка не рендерится (majorHtml пустой)', /majorHtml = '';/.test(coreSrc));
  ok('нет рендера вечной карточки после курса', !/Генерал Волков:<\/b> Курс молодого бойца пройден/.test(coreSrc));

  console.log('\n[5] Результат боя сбрасывается при уходе с экрана «Война»');
  const appSrc = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  ok('в роутере есть сброс _lastBattle вне war', /if \(name !== 'war'\) App\._lastBattle = null;/.test(appSrc));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
