// ═══════════════════════════════════════════════════════════════════
// test/clubcap.test.js — клуб не может выдать больше суточного потолка
//
// До потолка ограничение в клубе было только по времени, и замер живым
// кодом показал, чем это кончается: играя ровно по кулдаунам, из клуба
// выносилось 3341 🪙 в сутки — около 2500 ₽ бесплатного золота в день по
// прайсу магазина. Выигрывала усидчивость, а не умение. Сейф при этом
// вообще не проигрывался: 4000 партий из 4000 при осмысленной игре.
//
// Теперь всё золото клуба выходит через одну функцию payout(), и этот
// тест стережёт три вещи:
//
//  1. Потолок держится, сколько ни играй.
//  2. Ни одна игра не выдаёт золото мимо payout() — иначе новая игра
//     однажды пройдёт мимо потолка, и заметить это будет нечем.
//  3. Источник помечен. Раньше клуб звал addGold без источника, всё
//     падало в «Прочее», и крупнейший источник золота в игре не был
//     виден владельцу вообще.
//
// Запуск: node test/clubcap.test.js  (после npm run build)
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
const C = require('../dist/config/gameConfig').CLUB;

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const nx = [];

(async () => {
  await db.init();
  await auth.register('Клубный', 'пароль123', 'k@t.ru', 'ru', '1.1.1.1');
  const U = Object.values(player.users()).find((x) => x.name === 'Клубный');
  U.level = 100;

  // Кулдауны в тесте снимаем руками: нас интересует потолок, а не то,
  // сколько реального времени нужно просидеть.
  const clearCd = () => {
    if (U.club && U.club.cd) for (const k of Object.keys(U.club.cd)) U.club.cd[k] = 0;
    U.behavior = null;   // см. пояснение в test/cards: здесь проверяется потолок, а не пульс
  };
  // Долбим потолок ночным рейдом: рубеж проставляем сами, чтобы проверка
  // не зависела от того, как лёг бросок. Нас интересует ПОТОЛОК, а не
  // везение.
  // Долбим потолок сапёрной тропой: клетки открываем принудительно,
  // чтобы проверка не зависела от того, где легли мины. Нас интересует
  // ПОТОЛОК, а не везение.
  const playRaid = (steps) => {
    clearCd();
    club.sapperStart(U);
    U.club.sapper.mines = [];                 // мин нет: проверяем потолок
    U.club.sapper.opened = [];
    for (let k = 0; k < (steps || 3); k++) U.club.sapper.opened.push(k);
    return club.sapperTake(U, nx);
  };

  console.log('\n── 1. Потолок настроен и виден игроку ──');
  ok('потолок задан числом', typeof C.DAILY_GOLD_CAP === 'number' && C.DAILY_GOLD_CAP > 0);
  ok('общий кулдаун задан', typeof C.SHARED_CD_MIN === 'number' && C.SHARED_CD_MIN > 0);
  const v0 = club.view(U);
  ok('в ответе есть остаток на сутки', v0.budget && v0.budget.cap === C.DAILY_GOLD_CAP);
  ok('в начале суток потрачено ноль', v0.budget.spent === 0 && v0.budget.left === C.DAILY_GOLD_CAP);

  console.log('\n── 2. Сколько ни играй, больше потолка не выдадут ──');
  const before = U.gold;
  for (let i = 0; i < 200; i++) playRaid(7);      // заведомо больше, чем нужно
  const earned = U.gold - before;
  ok(`за 200 проходов выдано ${earned} 🪙, не больше потолка ${C.DAILY_GOLD_CAP}`,
     earned <= C.DAILY_GOLD_CAP);
  ok('и потолок действительно выбран (иначе проверка ничего не значит)',
     earned === C.DAILY_GOLD_CAP);
  ok('счётчик расхода сходится с выданным', U.club.dayGold === earned);
  ok('игроку показано, что остатка нет', club.view(U).budget.left === 0);

  console.log('\n── 3. После полуночи по Москве счётчик сбрасывается ──');
  // Подменяем не время, а записанные сутки: так проверяется именно
  // правило сброса, а не системные часы.
  U.club.day = 'вчера';
  const v1 = club.view(U);
  ok('новые сутки — снова полный лимит', v1.budget.spent === 0 && v1.budget.left === C.DAILY_GOLD_CAP);
  const g1 = U.gold;
  for (let i = 0; i < 200; i++) playRaid(7);
  ok('и во вторые сутки выдан ровно потолок', U.gold - g1 === C.DAILY_GOLD_CAP);

  console.log('\n── 4. Источник золота помечен ──');
  const got = (U.stats && U.stats.goldGot) || {};
  ok('клубное золото записано с источником club_*',
     Object.keys(got).some((k) => k.indexOf('club_') === 0));
  ok('и не свалено в «Прочее»', !got.other);

  console.log('\n── 5. Общий перерыв после выигрыша ──');
  U.club.day = 'ещё одни сутки';
  playRaid(3);
  const cdSec = club.view(U).sharedCooldownSec;
  ok(`после выигрыша взведён общий перерыв (${cdSec} с)`, cdSec > 0);
  ok('перерыв примерно нужной длины', Math.abs(cdSec - C.SHARED_CD_MIN * 60) <= 2);
  // Личные кулдауны игр снимаем: проверяем именно ОБЩИЙ перерыв, иначе
  // рейд отказал бы по своему собственному таймеру и проверка ничего бы
  // не доказала.
  const shared = U.club.cd.all;
  clearCd();
  U.club.cd.all = shared;
  // Платных игр в списке нет намеренно: преферанс и тотализатор общему
  // перерыву не подчиняются — это отдельно проверяется в разделе 10.
  let blocked = 0;
  for (const start of [() => club.convoyGo(U, 'mountain', 'coast', nx), () => club.sapperStart(U),
                       () => club.tacticStart(U)]) {
    try { start(); } catch (e) { if (/перерыв/i.test(e.message)) blocked++; }
  }
  ok('перерыв закрывает ВСЕ бесплатные игры, а не одну', blocked === 3);
  // Общий сейф — тоже часть клуба и тоже под перерывом
  let safeBlocked = false;
  try { club.safeTry(U, '123456', nx); } catch (e) { safeBlocked = /перерыв/i.test(e.message); }
  ok('и общий сейф в том числе', safeBlocked);

  console.log('\n── 6. Сапёрная тропа: жадность наказана арифметикой ──');
  // Если лучшая остановка — последний рубеж, решения в игре нет: надо
  // просто всегда идти до конца. Смысл появляется только когда ожидание
  // где-то в середине выше, чем в конце.
  // Считаем ожидание для каждой остановки: с каждой открытой клеткой
  // мины занимают всё большую долю оставшихся.
  const loots = C.SAPPER_LOOT;
  let survive = 1;
  const ev = loots.map((loot, i) => {
    survive *= (C.SAPPER_CELLS - i - C.SAPPER_MINES) / (C.SAPPER_CELLS - i);
    return loot * survive;
  });
  const best = ev.indexOf(Math.max(...ev));
  ok(`лучшая остановка — ${best + 1}-я клетка из ${loots.length}, а не последняя`,
     best < loots.length - 1);
  ok(`идти до конца хуже, чем остановиться вовремя (${ev[best].toFixed(1)} против ${ev[ev.length - 1].toFixed(1)})`,
     ev[best] > ev[ev.length - 1]);
  ok('первая клетка не лучшая — ходить хотя бы раз стоит', best > 0);

  console.log('\n── 7. Тактическая дуэль: читать нечего ──');
  // Раньше генерал играл по привычке, и внимательный игрок брал 64%
  // против 48% у случайного. Обратная сторона той же цифры: шаблон,
  // который человек замечает иногда, скрипт читает всегда. Теперь
  // выбор случайный, и проверяется ОБРАТНОЕ утверждение — что никакая
  // стратегия не даёт преимущества. Это и есть защита от автоматизации:
  // боту нечего вычитывать.
  const KINDS = ['ground', 'air', 'sea'];
  const COUNTER = { air: 'ground', sea: 'air', ground: 'sea' };
  const tactic = (strategy) => {
    clearCd(); U.club.dayGold = 0;
    club.tacticStart(U);
    for (let r = 0; r < 40; r++) {
      const rounds = (U.club.tactic && U.club.tactic.rounds) || [];
      const last = rounds[rounds.length - 1];
      const res = club.tacticPlay(U, strategy(last), nx);
      if (res.result === 'win') return true;
      if (res.result === 'lose') return false;
    }
    return false;
  };
  const rndPick = () => KINDS[Math.floor(Math.random() * 3)];
  // Три стратегии, которые написал бы автор скрипта, прочитав код
  const strategies = [
    ['наугад', () => rndPick()],
    ['ждёт повтора победившего', (last) => (last && last.res === 'lose' ? COUNTER[last.foe] : rndPick())],
    ['ждёт ухода от проигравшего', (last) => (last && last.res === 'win'
        ? COUNTER[KINDS.filter((k) => k !== last.foe)[Math.floor(Math.random() * 2)]] : rndPick())],
    ['всегда одно и то же', () => 'air'],
  ];
  const M = 800;
  const rates = [];
  for (const [name, fn] of strategies) {
    let w = 0;
    for (let i2 = 0; i2 < M; i2++) if (tactic(fn)) w++;
    rates.push([name, w / M]);
  }
  for (const [name, r] of rates) {
    ok(`${name}: ${(r * 100).toFixed(0)}% побед — как у всех`, r > 0.42 && r < 0.58);
  }
  const topRate = Math.max(...rates.map((x) => x[1]));
  const lowRate = Math.min(...rates.map((x) => x[1]));
  ok(`лучшая стратегия обгоняет худшую на ${((topRate - lowRate) * 100).toFixed(0)} п.п. — в пределах случайности`,
     topRate - lowRate < 0.08);
  ok('чужой род войск не принимается',
     (() => { clearCd(); club.tacticStart(U);
       try { club.tacticPlay(U, 'бронепоезд', nx); return false; } catch (e) { return true; } })());


  console.log('\n── 8. Мимо потолка золото не выдаётся ──');
  // Разбор кода: ни одна игра не должна звать addGold напрямую. Проверка
  // именно по исходнику — поведение будущей, ещё не написанной игры
  // прогнать нельзя, а забыть про payout() можно.
  const src = fs.readFileSync(path.join(ROOT, 'src/services/club.ts'), 'utf8');
  const addGoldCalls = (src.match(/player\.addGold\(/g) || []).length;
  ok(`player.addGold зовётся ровно один раз (найдено ${addGoldCalls}) — из payout()`,
     addGoldCalls === 1);
  ok('и этот вызов помечает источник', /player\.addGold\(user, give, 'club_' \+ game\)/.test(src));
  const payoutCalls = (src.match(/payout\(user, '/g) || []).length;
  ok(`каждая игра выдаёт золото через payout (${payoutCalls} вызовов)`, payoutCalls >= 6);

  console.log('\n── 10. Платная игра живёт по своим правилам ──');
  // Общий перерыв придуман, чтобы придержать РАЗДАЧУ бесплатного
  // золота. Преферанс платный: за партию внесена ставка, и запирать
  // из-за него остальной клуб не за что — как и его самого чужими
  // выигрышами.
  U.club.day = "сутки для платной игры";
  clearCd();
  U.gold = 100000;
  playRaid(2);                                  // бесплатная победа взвела перерыв
  ok('после бесплатной игры общий перерыв стоит', club.view(U).sharedCooldownSec > 0);
  let prefBlocked = false;
  try { club.prefStart(U, nx); } catch (e) { prefBlocked = /перерыв/i.test(e.message); }
  ok('но за платный стол он сесть не мешает', !prefBlocked);

  // И наоборот: победа за платным столом не запирает бесплатные игры
  clearCd();
  let sharedAfterPref = null;
  for (let i = 0; i < 200 && sharedAfterPref === null; i++) {
    clearCd();
    U.club.dayGold = 0;
    club.prefStart(U, nx);
    const r = club.prefStand(U, nx);
    if (r.result === 'win') sharedAfterPref = club.view(U).sharedCooldownSec;
  }
  ok('победа за платным столом случилась', sharedAfterPref !== null);
  ok('и она НЕ взвела общий перерыв клуба', sharedAfterPref === 0);

  console.log('\n── 11. Потолок считает НЕТТО, а не выплаты ──');
  // Считай мы по валовой выплате, десять партий преферанса (из них
  // четыре выигранных) забили бы весь суточный потолок — при том что
  // игрок ушёл бы в минус и ничего у клуба не выиграл.
  U.club.day = "сутки для нетто";
  clearCd();
  U.gold = 100000;
  const goldStart = U.gold;
  let played = 0, won = 0;
  for (let i = 0; i < 60; i++) {
    clearCd();
    club.prefStart(U, nx);
    const r = club.prefStand(U, nx);
    played++;
    if (r.result === 'win') won++;
  }
  const netGold = U.gold - goldStart;
  const spentBudget = club.view(U).budget.spent;
  ok(`сыграно ${played} партий, выиграно ${won}`, played === 60 && won > 0);
  ok(`на руках изменение ${netGold} 🪙 — игрок в минусе`, netGold < 0);
  ok(`суточный счётчик потолка при этом ${spentBudget}, а не ${won * C.PREF_WIN_GOLD}`,
     spentBudget < won * C.PREF_WIN_GOLD);
  ok(`и бесплатные игры не заперты потолком (остаток ${club.view(U).budget.left})`,
     club.view(U).budget.left > 0);


  console.log('\n── 9. Сама проверка умеет краснеть ──');
  // Без этого раздела разбор кода был бы зелёным и на пустом файле.
  ok('образец с прямым addGold распознаётся',
     (('player.addGold(user, 5);\nplayer.addGold(u, 1, \'x\');').match(/player\.addGold\(/g) || []).length === 2);
  ok('пустой источник не считается помеченным',
     !/player\.addGold\(user, give, 'club_' \+ game\)/.test('player.addGold(user, give);'));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
