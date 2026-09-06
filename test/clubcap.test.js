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
const C = require('../dist/config/gameConfig').CLUB;

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const nx = [];

// Все коды сейфа — для игры «называй код, не противоречащий подсказкам».
// Так играет думающий человек, и это верхняя граница сложности.
const ALL_CODES = [];
for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++)
  for (let c = 0; c < 10; c++) for (let d = 0; d < 10; d++) {
    const s = '' + a + b + c + d;
    if (new Set(s).size === 4) ALL_CODES.push(s);
  }
const bulls = (g, code) => {
  let bl = 0, cw = 0;
  for (let i = 0; i < g.length; i++) { if (g[i] === code[i]) bl++; else if (code.includes(g[i])) cw++; }
  return bl + ':' + cw;
};

(async () => {
  await db.init();
  await auth.register('Клубный', 'пароль123', 'k@t.ru', 'ru', '1.1.1.1');
  const U = Object.values(player.users()).find((x) => x.name === 'Клубный');
  U.level = 100;

  // Кулдауны в тесте снимаем руками: нас интересует потолок, а не то,
  // сколько реального времени нужно просидеть.
  const clearCd = () => { if (U.club && U.club.cd) for (const k of Object.keys(U.club.cd)) U.club.cd[k] = 0; };
  const playSafe = () => {
    club.safeStart(U);
    let pool = ALL_CODES;
    for (let t = 0; t < C.SAFE_TRIES; t++) {
      const g = pool[Math.floor(Math.random() * pool.length)];
      const r = club.safeTry(U, g, nx);
      if (r.result === 'win') return r;
      if (r.result === 'fail') return r;
      const key = r.bulls + ':' + r.cows;
      pool = pool.filter((x) => bulls(g, x) === key);
      if (!pool.length) pool = ALL_CODES;
    }
    return null;
  };

  console.log('\n── 1. Потолок настроен и виден игроку ──');
  ok('потолок задан числом', typeof C.DAILY_GOLD_CAP === 'number' && C.DAILY_GOLD_CAP > 0);
  ok('общий кулдаун задан', typeof C.SHARED_CD_MIN === 'number' && C.SHARED_CD_MIN > 0);
  const v0 = club.view(U);
  ok('в ответе есть остаток на сутки', v0.budget && v0.budget.cap === C.DAILY_GOLD_CAP);
  ok('в начале суток потрачено ноль', v0.budget.spent === 0 && v0.budget.left === C.DAILY_GOLD_CAP);

  console.log('\n── 2. Сколько ни играй, больше потолка не выдадут ──');
  const before = U.gold;
  // Заведомо больше партий, чем нужно, чтобы упереться
  for (let i = 0; i < 400; i++) { clearCd(); playSafe(); }
  const earned = U.gold - before;
  ok(`за 400 партий выдано ${earned} 🪙, не больше потолка ${C.DAILY_GOLD_CAP}`,
     earned <= C.DAILY_GOLD_CAP);
  ok('и потолок действительно выбран (иначе проверка ничего не значит)',
     earned === C.DAILY_GOLD_CAP);
  ok('счётчик расхода сходится с выданным', U.club.dayGold === earned);
  const vFull = club.view(U);
  ok('игроку показано, что остатка нет', vFull.budget.left === 0);

  console.log('\n── 3. После полуночи по Москве счётчик сбрасывается ──');
  // Подменяем не время, а записанные сутки: так проверяется именно
  // правило сброса, а не системные часы.
  U.club.day = 'вчера';
  const v1 = club.view(U);
  ok('новые сутки — снова полный лимит', v1.budget.spent === 0 && v1.budget.left === C.DAILY_GOLD_CAP);
  clearCd();
  const g1 = U.gold;
  for (let i = 0; i < 400; i++) { clearCd(); playSafe(); }
  ok('и во вторые сутки выдан ровно потолок', U.gold - g1 === C.DAILY_GOLD_CAP);

  console.log('\n── 4. Источник золота помечен ──');
  const got = (U.stats && U.stats.goldGot) || {};
  ok('клубное золото записано с источником club_*',
     Object.keys(got).some((k) => k.indexOf('club_') === 0));
  ok('и не свалено в «Прочее»', !got.other);

  console.log('\n── 5. Общий перерыв после выигрыша ──');
  U.club.day = 'ещё одни сутки';
  clearCd();
  let won = null;
  for (let i = 0; i < 60 && !won; i++) {
    clearCd();
    const r = playSafe();
    if (r && r.result === 'win') won = r;
  }
  ok('выигрыш случился (иначе проверять нечего)', !!won);
  const cdSec = club.view(U).sharedCooldownSec;
  ok(`после выигрыша взведён общий перерыв (${cdSec} с)`, cdSec > 0);
  ok('перерыв примерно нужной длины',
     Math.abs(cdSec - C.SHARED_CD_MIN * 60) <= 2);
  let blocked = 0;
  for (const start of [() => club.prefStart(U), () => club.diceStart(U),
                       () => club.artyStart(U), () => club.tacticStart(U)]) {
    try { start(); } catch (e) { if (/перерыв/i.test(e.message)) blocked++; }
  }
  ok('перерыв закрывает ВСЕ игры, а не одну', blocked === 4);

  console.log('\n── 6. Сейф стал проигрываемым ──');
  // Восемь попыток на четыре неповторяющиеся цифры не проигрывались
  // никогда. Это была не мини-игра, а рента.
  U.club.day = 'сутки для замера';
  let wins = 0;
  const N = 600;
  for (let i = 0; i < N; i++) { clearCd(); U.club.dayGold = 0; const r = playSafe(); if (r && r.result === 'win') wins++; }
  const wr = wins / N;
  ok(`идеальный решатель выигрывает ${(wr * 100).toFixed(0)}%, а не всегда`, wr < 0.95);
  ok('но игра не превратилась в безнадёжную', wr > 0.5);

  console.log('\n── 7. Тактическая дуэль: привычку генерала можно прочитать ──');
  const KINDS = ['ground', 'air', 'sea'];
  const COUNTER = { air: 'ground', sea: 'air', ground: 'sea' };   // чем бить X
  const tactic = (smart) => {
    clearCd(); U.club.dayGold = 0;
    club.tacticStart(U);
    for (let r = 0; r < 40; r++) {
      const rounds = (U.club.tactic && U.club.tactic.rounds) || [];
      const last = rounds[rounds.length - 1];
      let pick;
      if (!smart || !last) pick = KINDS[Math.floor(Math.random() * 3)];
      else if (last.res === 'lose') pick = COUNTER[last.foe];              // повторит победивший род
      else if (last.res === 'win') pick = COUNTER[KINDS.filter((k) => k !== last.foe)[Math.floor(Math.random() * 2)]];
      else pick = KINDS[Math.floor(Math.random() * 3)];
      const res = club.tacticPlay(U, pick, nx);
      if (res.result === 'win') return true;
      if (res.result === 'lose') return false;
    }
    return false;
  };
  let rnd = 0, smart = 0;
  const M = 600;
  for (let i = 0; i < M; i++) if (tactic(false)) rnd++;
  for (let i = 0; i < M; i++) if (tactic(true)) smart++;
  const rndPct = rnd / M, smartPct = smart / M;
  ok(`тычущий наугад берёт ${(rndPct * 100).toFixed(0)}% — примерно поровну`,
     rndPct > 0.4 && rndPct < 0.6);
  ok(`читающий привычку берёт ${(smartPct * 100).toFixed(0)}% — заметно больше`,
     smartPct - rndPct > 0.08);
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

  console.log('\n── 9. Сама проверка умеет краснеть ──');
  // Без этого раздела разбор кода был бы зелёным и на пустом файле.
  ok('образец с прямым addGold распознаётся',
     (('player.addGold(user, 5);\nplayer.addGold(u, 1, \'x\');').match(/player\.addGold\(/g) || []).length === 2);
  ok('пустой источник не считается помеченным',
     !/player\.addGold\(user, give, 'club_' \+ game\)/.test('player.addGold(user, give);'));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
