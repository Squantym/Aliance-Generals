// ═══════════════════════════════════════════════════════════════════
// test/clubgames.test.js — состав клуба и правила тактической дуэли
//
// Клуб не раз переписывали, и каждый раз убранная игра оставляла хвосты:
// поле в ответе сервера, маршрут в routes.ts, кнопку на экране. Ответ
// при этом выглядел исправным, а игрок видел кнопку, ведущую в никуда.
// Поэтому здесь проверяется не «работает ли игра», а СОСТАВ: что осталось
// и, главное, чего не осталось — ни в API, ни в маршрутах.
//
// Второй раздел — про дуэль: её круг обязан совпадать с наставлением
// клуба (public/img/club/tactic.webp). Разойдутся — и игрок, сыгравший
// по правилам с картинки, будет за это проигрывать.
//
// Запуск: node test/clubgames.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');   // не даёт стереть боевую data/
const ROOT = path.join(__dirname, '..');
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

(async () => {
  await db.init();
  await auth.register('Игрок', 'password1', 'p@a.com', 'ru', '1.1.1.1');
  const p = Object.values(player.users()).find((x) => x.name === 'Игрок');
  p.gold = 1000;
  // Сбрасываем заодно суточный расход золота: здесь проверяются ПРАВИЛА,
  // а накопившийся за предыдущие разделы потолок обрезал бы награды и
  // проверка стала бы зависеть от того, сколько выпало выше. За сам
  // потолок отвечает отдельный тест clubcap.
  const clearCd = () => { p.club.cd = {}; p.club.dayGold = 0; p.behavior = null; };

  console.log('\n[1] Состав клуба: что осталось');
  const v = club.view(p);
  ok('преферанс', !!v.pref);
  ok('сейф штаба', !!v.safe);
  ok('тактическая дуэль', !!v.tactic);
  ok('напёрстки', !!v.thimble);
  ok('радиоперехват', !!v.intercept);
  ok('снайперская дуэль', !!v.sniper);
  eq('и всего игр в ответе — шесть плюс касса',
     Object.keys(v).filter((k) => !['budget', 'sharedCooldownSec'].includes(k)).length, 6);

  console.log('\n[2] Убранные игры вырезаны целиком');
  // Поле в ответе — это кнопка на экране. Остался бы хоть один ключ —
  // игрок увидел бы игру, которой нет.
  const gone = ['mine', 'run', 'duel', 'arty', 'raid', 'dice', 'bids', 'convoy', 'sapper', 'bookie'];
  const leftInView = gone.filter((k) => v[k] !== undefined);
  ok(leftInView.length ? `остались в ответе: ${leftInView.join(', ')}` : 'ни одной убранной игры в ответе сервера',
     leftInView.length === 0);
  const goneFns = ['mineStart', 'runStart', 'duelStart', 'artyStart', 'safeStart', 'raidStart',
                   'diceStart', 'bidsPlay', 'convoyGo', 'sapperStart', 'sapperStep', 'sapperTake', 'bookieBet'];
  const leftInApi = goneFns.filter((f) => typeof club[f] === 'function');
  ok(leftInApi.length ? `остались в API: ${leftInApi.join(', ')}` : 'и ни одной функции в API клуба',
     leftInApi.length === 0);
  // Маршрут переживает удаление кода дольше всего: функции нет, а
  // app.add остался — и сервер падает при первом же запросе.
  const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  const goneRoutes = ['raid', 'dice', 'bids', 'arty', 'convoy', 'sapper', 'bookie']
    .filter((g) => routes.includes('/api/club/' + g + '/'));
  ok(goneRoutes.length ? `остались маршруты: ${goneRoutes.join(', ')}` : 'и ни одного маршрута',
     goneRoutes.length === 0);
  // То же на экране: кнопка ведёт на страницу, которой больше нет
  const screen = fs.readFileSync(path.join(ROOT, 'public/js/screens/market.js'), 'utf8');
  const goneUi = ['convoy', 'sapper', 'bookie'].filter((g) => screen.includes(g));
  ok(goneUi.length ? `остались на экране: ${goneUi.join(', ')}` : 'и ни одного следа на экране клуба',
     goneUi.length === 0);
  const cfg = fs.readFileSync(path.join(ROOT, 'config/gameConfig.ts'), 'utf8');
  const goneCfg = ['CONVOY_', 'SAPPER_', 'BOOKIE_', 'RAID_', 'DICE_', 'BIDS_'].filter((k) => cfg.includes(k));
  ok(goneCfg.length ? `остались настройки: ${goneCfg.join(', ')}` : 'и ни одной настройки в конфиге',
     goneCfg.length === 0);

  console.log('\n[3] Хвосты убранных игр вычищаются из сохранения');
  // Недоигранная тропа и кулдауны убранных игр лежали бы в сохранении
  // вечно: читать их некому, а места они занимают у всех и всегда.
  p.club.sapper = { opened: [1, 2], mines: [7] };
  p.club.bookieLast = { winner: 'alpha', won: true };
  p.club.cd.convoy = Date.now() + 60000;
  p.club.cd.bookie = Date.now() + 60000;
  p.club.cd.pref = Date.now() + 60000;          // живая игра — остаётся
  player.refresh(p);
  ok('состояние убранной игры удалено', p.club.sapper === undefined);
  ok('и её последний итог тоже', p.club.bookieLast === undefined);
  ok('кулдауны убранных игр убраны',
     p.club.cd.convoy === undefined && p.club.cd.bookie === undefined);
  ok('а кулдаун живой игры не тронут', typeof p.club.cd.pref === 'number');

  console.log('\n[4] Тактическая дуэль: круг как в наставлении клуба');
  // На картинке /img/club/tactic.webp нарисовано: пехота побеждает флот,
  // флот побеждает авиацию, авиация побеждает пехоту. Игрок играет по
  // ней, поэтому код обязан считать так же — обратный круг наказывал бы
  // ровно тех, кто прочитал правила.
  clearCd();
  const kinds = club.view(p).tactic.kinds;
  const beatsOf = (id) => (kinds.find((k) => k.id === id) || {}).beats;
  eq('пехота бьёт флот', beatsOf('ground'), 'sea');
  eq('флот бьёт авиацию', beatsOf('sea'), 'air');
  eq('авиация бьёт пехоту', beatsOf('air'), 'ground');
  ok('у каждого рода войск своя картинка',
     kinds.length === 3 && new Set(kinds.map((k) => k.img)).size === 3);
  const noPic = kinds.filter((k) => !fs.existsSync(path.join(ROOT, 'public', String(k.img || ''))));
  ok(noPic.length ? `нет файлов: ${noPic.map((k) => k.img).join(', ')}` : 'и все они лежат на диске',
     noPic.length === 0);
  ok('и подпись «кого бьёт» — в винительном падеже',
     kinds.every((k) => typeof k.beatsRu === 'string' && k.beatsRu.length > 2));
  // Считает ли круг так, как нарисован: генерала подменяем, чтобы
  // проверять правило, а не бросок.
  const realPick = utils.pick;
  const duel = (mine, foeKind) => {
    clearCd();
    utils.pick = () => foeKind;
    try { club.tacticStart(p); return club.tacticPlay(p, mine, []).last.res; }
    finally { utils.pick = realPick; }
  };
  eq('пехота против флота — победа', duel('ground', 'sea'), 'win');
  eq('флот против авиации — победа', duel('sea', 'air'), 'win');
  eq('авиация против пехоты — победа', duel('air', 'ground'), 'win');
  eq('флот против пехоты — поражение', duel('sea', 'ground'), 'lose');
  eq('авиация против флота — поражение', duel('air', 'sea'), 'lose');
  eq('пехота против авиации — поражение', duel('ground', 'air'), 'lose');
  eq('одинаковый выбор — ничья', duel('ground', 'ground'), 'draw');

  console.log('\n[5] Игры засчитываются в ежедневное поручение');
  const daily = require('../dist/src/services/dailyQuests');
  const before = daily.ensureDaily(p).counters.clubPlayed || 0;
  clearCd(); club.tacticStart(p); club.tacticPlay(p, 'ground', []);
  clearCd(); club.thimblePlay(p, 0, []);
  eq('счётчик clubPlayed вырос на две игры',
     (daily.ensureDaily(p).counters.clubPlayed || 0) - before, 2);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
