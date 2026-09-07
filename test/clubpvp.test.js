// ═══════════════════════════════════════════════════════════════════
// test/clubpvp.test.js — три новые игры клуба
//
//   7) Радиоперехват      — живая очередь, ход втёмную, ход жребием
//   8) Снайперская дуэль  — общие часы, прицел, выстрел, промах
//   9) Напёрстки          — ставка 10, выигрыш 20, честная треть
//
// Первые две идут ПРОТИВ ЖИВОГО ЧЕЛОВЕКА, и проверять в них надо не
// только правила, но и деньги на двоих: взнос берётся при входе в
// очередь, а вернуться он обязан в трёх разных случаях — уход из
// очереди, никто не пришёл, ничья. Забытый возврат тут не падает, он
// просто тихо съедает золото игрока.
//
// Запуск: node test/clubpvp.test.js
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const club = require('../dist/src/services/club');
const cm = require('../dist/src/services/clubMatch');
const utils = require('../dist/src/core/utils');
// Пульс клуба меряет ритм действий, а тест ходит машинной скоростью.
// Здесь проверяются правила игр, а не детектор: за него отвечает clubbot.
require('../dist/src/services/antibot').track = () => ({ ok: true, suspicion: 0 });
const c = require('../dist/config/gameConfig');
const CL = c.CLUB;
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Первый', 'password1', 'a@a.com', 'ru', '1.1.1.1');
  await auth.register('Второй', 'password1', 'b@a.com', 'ru', '2.2.2.2');
  await auth.register('Третий', 'password1', 'c@a.com', 'ru', '3.3.3.3');
  const A = Object.values(player.users()).find((x) => x.name === 'Первый');
  const B = Object.values(player.users()).find((x) => x.name === 'Второй');
  const D = Object.values(player.users()).find((x) => x.name === 'Третий');
  // Адрес входа берётся из user.access.lastIp — по нему сводятся пары.
  A.access = { lastIp: '10.0.0.1' };
  B.access = { lastIp: '10.0.0.2' };
  D.access = { lastIp: '10.0.0.1' };      // тот же адрес, что у Первого
  const reset = (p, gold = 1000) => { p.club = {}; p.gold = gold; p.behavior = null; };
  const clearAll = () => {
    for (const p of [A, B, D]) reset(p);
    const st = db.load('clubmatch', { queue: [], matches: [], seq: 0 });
    st.queue.length = 0; st.matches.length = 0;
  };
  const store = () => db.load('clubmatch', { queue: [], matches: [], seq: 0 });
  const match = () => store().matches.find((m) => !m.done);

  console.log('\n[1] Очередь: взнос берётся сразу и возвращается при выходе');
  clearAll();
  const g0 = A.gold;
  const q1 = cm.enqueue(A, 'intercept', []);
  eq('игрок в очереди', q1.state, 'queue');
  eq('взнос списан', A.gold, g0 - CL.INTERCEPT_ENTRY);
  eq('в очереди один', store().queue.length, 1);
  throws('второй раз в ту же очередь не встать', () => cm.enqueue(A, 'intercept', []));
  throws('и в соседнюю тоже — игрок уже занят', () => cm.enqueue(A, 'sniper', []));
  cm.leaveQueue(A, 'intercept', []);
  eq('взнос вернулся полностью', A.gold, g0);
  eq('очередь пуста', store().queue.length, 0);
  throws('выйти из очереди дважды нельзя', () => cm.leaveQueue(A, 'intercept', []));

  console.log('\n[2] Пара сводится из двух живых игроков');
  clearAll();
  cm.enqueue(A, 'intercept', []);
  eq('пары ещё нет', store().matches.length, 0);
  cm.enqueue(B, 'intercept', []);
  const m2 = match();
  ok('матч создан', !!m2);
  eq('очередь опустела', store().queue.length, 0);
  eq('соперники — те самые', [m2.a.id, m2.b.id].sort().join(), [A.id, B.id].sort().join());
  const vA = cm.interceptView(A);
  eq('игрок видит бой', vA.state, 'match');
  eq('и имя соперника', vA.match.foeName, 'Второй');
  ok('и срок хода', vA.match.deadlineSec > 0 && vA.match.deadlineSec <= CL.INTERCEPT_MOVE_SEC);

  console.log('\n[3] Два аккаунта с одного адреса в пару не сводятся');
  clearAll();
  cm.enqueue(A, 'intercept', []);
  cm.enqueue(D, 'intercept', []);     // тот же lastIp, что у A
  eq('пара не собрана', store().matches.length, 0);
  eq('оба остались ждать', store().queue.length, 2);
  // Появился третий с другого адреса — вот с ним пара и собирается
  cm.enqueue(B, 'intercept', []);
  eq('теперь матч есть', store().matches.filter((m) => !m.done).length, 1);
  const m3 = match();
  ok('свели именно разные адреса', m3.a.id !== m3.b.id
     && ![m3.a.id, m3.b.id].every((id) => id === A.id || id === D.id));

  console.log('\n[4] Радиоперехват: разбор хода и деньги');
  clearAll();
  const gA = A.gold, gB = B.gold;      // до очереди: взнос берут уже на входе
  cm.enqueue(A, 'intercept', []);
  cm.enqueue(B, 'intercept', []);
  throws('без укрытия ход не принят', () => cm.interceptMove(A, -1, [0, 1], []));
  throws('наводок должно быть ровно две', () => cm.interceptMove(A, 0, [1], []));
  throws('две наводки в один квадрат не считаются', () => cm.interceptMove(A, 0, [1, 1], []));
  throws('квадрата вне карты нет', () => cm.interceptMove(A, 0, [1, CL.INTERCEPT_CELLS], []));
  // A прячется в 0 и наводится на 3 и 4; B прячется в 3 — значит найден
  cm.interceptMove(A, 0, [3, 4], []);
  eq('ход сделан, ждём соперника', cm.interceptView(A).match.moved, true);
  throws('второй ход в том же бою отклонён', () => cm.interceptMove(A, 1, [2, 5], []));
  cm.interceptMove(B, 3, [1, 2], []);   // B не нашёл A (тот в 0)
  const lastA = cm.interceptView(A).last;
  eq('победа засчитана нашедшему', lastA.result, 'win');
  eq('банк выдан', lastA.reward, CL.INTERCEPT_WIN);
  eq('золото победителя: минус взнос, плюс банк', A.gold, gA - CL.INTERCEPT_ENTRY + CL.INTERCEPT_WIN);
  eq('проигравший потерял взнос', B.gold, gB - CL.INTERCEPT_ENTRY);
  eq('у проигравшего записано поражение', cm.interceptView(B).last.result, 'lose');
  eq('после боя кулдаун', cm.interceptView(A).state, 'cooldown');
  ok('и он равен заданному', cm.interceptView(A).cooldownSec > (CL.INTERCEPT_CD_MIN - 1) * 60);
  throws('в очередь по кулдауну не встать', () => cm.enqueue(A, 'intercept', []));

  console.log('\n[5] Радиоперехват: ничья возвращает взносы обоим');
  clearAll();
  const dA = A.gold, dB = B.gold;
  cm.enqueue(A, 'intercept', []);
  cm.enqueue(B, 'intercept', []);
  cm.interceptMove(A, 0, [1, 2], []);   // оба мимо: A в 0, B в 5
  cm.interceptMove(B, 5, [3, 4], []);
  eq('ничья', cm.interceptView(A).last.result, 'draw');
  eq('взнос вернулся первому', A.gold, dA);
  eq('и второму', B.gold, dB);

  console.log('\n[6] Радиоперехват: за молчащего ходит жребий');
  clearAll();
  cm.enqueue(A, 'intercept', []);
  cm.enqueue(B, 'intercept', []);
  cm.interceptMove(A, 0, [1, 2], []);
  const mSil = match();
  mSil.deadline = Date.now() - 1000;    // время вышло
  cm.tick();
  ok('бой завершён по часам', !match());
  const silent = cm.interceptView(B).last;
  ok('молчавшему тоже проставлен итог', ['win', 'lose', 'draw'].includes(silent.result));
  ok('и его укрытие выбрано жребием', silent.hide.mine >= 0 && silent.hide.mine < CL.INTERCEPT_CELLS);
  ok('наводки жребия — разные квадраты',
     silent.hide.guess.length === CL.INTERCEPT_GUESSES
     && new Set(silent.hide.guess).size === CL.INTERCEPT_GUESSES);

  console.log('\n[7] Очередь: соперник не пришёл — взнос возвращается');
  clearAll();
  const wA = A.gold;
  cm.enqueue(A, 'intercept', []);
  store().queue[0].at = Date.now() - (CL.QUEUE_TTL_MIN * 60 + 1) * 1000;
  cm.tick();
  eq('из очереди убрали', store().queue.length, 0);
  eq('взнос вернули', A.gold, wA);
  eq('и состояние снова «можно играть»', cm.interceptView(A).state, 'ready');

  console.log('\n[8] Снайпер: прицеливание растит точность');
  clearAll();
  cm.enqueue(A, 'sniper', []);
  cm.enqueue(B, 'sniper', []);
  const s8 = cm.sniperView(A);
  eq('дуэль началась', s8.state, 'match');
  eq('первый ход', s8.match.turn, 1);
  eq('точность стартовая', s8.match.myAcc, CL.SNIPER_ACC_START);
  eq('и подпись у кнопки прицела — первая', s8.match.aimLabel, CL.SNIPER_AIM_STEPS[0]);
  throws('третьего действия нет', () => cm.sniperAct(A, 'закурить', []));
  cm.sniperAct(A, 'aim', []);
  eq('ход отмечен, ждём соперника', cm.sniperView(A).match.acted, 'aim');
  throws('второй раз за ход не сходить', () => cm.sniperAct(A, 'shoot', []));
  cm.sniperAct(B, 'aim', []);
  const s8b = cm.sniperView(A);
  eq('ход сменился', s8b.match.turn, 2);
  eq('точность выросла', s8b.match.myAcc, CL.SNIPER_ACC_START + CL.SNIPER_ACC_STEP);
  eq('и подпись прицела сменилась', s8b.match.aimLabel, CL.SNIPER_AIM_STEPS[1]);
  eq('точность соперника видна', s8b.match.foeAcc, CL.SNIPER_ACC_START + CL.SNIPER_ACC_STEP);

  console.log('\n[9] Снайпер: промах открывает позицию');
  const realRnd = utils.rnd;
  utils.rnd = () => 100;               // 100 из 100 — промах при любой точности ниже 100
  try {
    cm.sniperAct(A, 'shoot', []);
    cm.sniperAct(B, 'aim', []);
    const s9 = cm.sniperView(A);
    ok('дуэль продолжается', s9.state === 'match');
    eq('промахнувшийся сбит с прицела', s9.match.myAcc, CL.SNIPER_ACC_START);
    eq('а соперник бьёт наверняка', s9.match.foeAcc, 100);
    eq('и он это видит', cm.sniperView(B).match.sure, true);
    ok('промах записан в журнал', s9.match.log.some((e) => /промахнулся/.test(e.text)));
    // Даже с «наверняка» выстрел надо сделать — само не стреляет
    cm.sniperAct(B, 'shoot', []);
    cm.sniperAct(A, 'aim', []);
    eq('выстрел наверняка решает дуэль', cm.sniperView(B).last.result, 'win');
    eq('банк ушёл победителю', cm.sniperView(B).last.reward, CL.SNIPER_WIN);
    eq('а первому — поражение', cm.sniperView(A).last.result, 'lose');
  } finally { utils.rnd = realRnd; }

  console.log('\n[10] Снайпер: убили друг друга — взносы назад');
  clearAll();
  const kA = A.gold, kB = B.gold;
  cm.enqueue(A, 'sniper', []);
  cm.enqueue(B, 'sniper', []);
  utils.rnd = () => 1;                 // 1 из 100 — попадание при любой точности
  try {
    cm.sniperAct(A, 'shoot', []);
    cm.sniperAct(B, 'shoot', []);
  } finally { utils.rnd = realRnd; }
  eq('победителя нет', cm.sniperView(A).last.result, 'draw');
  eq('взнос вернулся первому', A.gold, kA);
  eq('и второму', B.gold, kB);

  console.log('\n[11] Снайпер: оба промахнулись — дуэль с начала');
  clearAll();
  cm.enqueue(A, 'sniper', []);
  cm.enqueue(B, 'sniper', []);
  cm.sniperAct(A, 'aim', []); cm.sniperAct(B, 'aim', []);   // точность 30
  utils.rnd = () => 100;
  try {
    cm.sniperAct(A, 'shoot', []);
    cm.sniperAct(B, 'shoot', []);
  } finally { utils.rnd = realRnd; }
  const s11 = cm.sniperView(A);
  eq('пошёл второй раунд', s11.match.round, 2);
  eq('ход снова первый', s11.match.turn, 1);
  eq('точность сброшена', s11.match.myAcc, CL.SNIPER_ACC_START);
  eq('и у соперника тоже', s11.match.foeAcc, CL.SNIPER_ACC_START);
  ok('журнал объясняет, почему всё сначала',
     s11.match.log.some((e) => /выдали себя/.test(e.text)));

  console.log('\n[12] Снайпер: на последнем ходу прицеливаться некуда');
  clearAll();
  cm.enqueue(A, 'sniper', []);
  cm.enqueue(B, 'sniper', []);
  for (let t = 1; t < CL.SNIPER_TURNS; t++) { cm.sniperAct(A, 'aim', []); cm.sniperAct(B, 'aim', []); }
  const s12 = cm.sniperView(A);
  eq('дошли до последнего хода', s12.match.turn, CL.SNIPER_TURNS);
  eq('точность на пределе', s12.match.myAcc, CL.SNIPER_ACC_START + CL.SNIPER_ACC_STEP * (CL.SNIPER_TURNS - 1));
  eq('кнопка прицела спрятана', s12.match.canAim, false);
  // «Прицелиться» на последнем ходу превращается в выстрел: пропустить
  // ход нельзя, иначе выжидание было бы бесплатным навсегда
  utils.rnd = () => 1;
  try { cm.sniperAct(A, 'aim', []); cm.sniperAct(B, 'aim', []); } finally { utils.rnd = realRnd; }
  ok('дуэль разрешилась выстрелами', !match());
  ok('и итог у обоих записан',
     !!cm.sniperView(A).last && !!cm.sniperView(B).last);

  console.log('\n[13] Снайпер: три безрезультатных раунда — ничья');
  clearAll();
  const rA = A.gold, rB = B.gold;
  cm.enqueue(A, 'sniper', []);
  cm.enqueue(B, 'sniper', []);
  utils.rnd = () => 100;               // все промахи
  try {
    for (let round = 0; round < CL.SNIPER_ROUNDS_MAX; round++) {
      cm.sniperAct(A, 'shoot', []);
      cm.sniperAct(B, 'shoot', []);
    }
  } finally { utils.rnd = realRnd; }
  ok('дуэль закончилась', !match());
  eq('ничья', cm.sniperView(A).last.result, 'draw');
  eq('взносы вернулись обоим', A.gold + B.gold, rA + rB);

  console.log('\n[14] Напёрстки: ставка, выигрыш и честная треть');
  clearAll();
  const tv = club.view(A).thimble;
  eq('котелков три', tv.pots, CL.THIMBLE_POTS);
  eq('ставка из конфига', tv.entry, CL.THIMBLE_ENTRY);
  eq('выигрыш из конфига', tv.win, CL.THIMBLE_WIN);
  throws('котелка вне стола нет', () => club.thimblePlay(A, CL.THIMBLE_POTS, []));
  const tg = A.gold;
  utils.rnd = () => 1;                 // паёк под вторым котелком
  let win;
  try { win = club.thimblePlay(A, 1, []); } finally { utils.rnd = realRnd; }
  eq('угадал', win.result, 'win');
  eq('выплата целиком', win.reward, CL.THIMBLE_WIN);
  eq('золото: минус ставка, плюс выигрыш', A.gold, tg - CL.THIMBLE_ENTRY + CL.THIMBLE_WIN);
  eq('после партии кулдаун', club.view(A).thimble.state, 'cooldown');
  throws('вторая партия по кулдауну отклонена', () => club.thimblePlay(A, 0, []));
  A.club.cd = {};
  const lg = A.gold;
  utils.rnd = () => 2;                 // паёк под третьим, а ставим на первый
  let lose;
  try { lose = club.thimblePlay(A, 0, []); } finally { utils.rnd = realRnd; }
  eq('не угадал', lose.result, 'lose');
  eq('ставка удержана', A.gold, lg - CL.THIMBLE_ENTRY);
  // Ожидание отрицательное — иначе игру можно было бы крутить бесконечно
  ok('ожидание партии в минус игроку',
     (1 / CL.THIMBLE_POTS) * CL.THIMBLE_WIN < CL.THIMBLE_ENTRY);
  // Честная треть: раскладка берётся из u.rnd по всем котелкам
  clearAll();
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    A.club.cd = {}; A.club.dayGold = 0;
    seen.add(club.thimblePlay(A, 0, []).hidden);
  }
  eq('паёк бывает под каждым котелком', seen.size, CL.THIMBLE_POTS);

  console.log('\n[15] Потолок клуба считает нетто и равен заданному');
  clearAll();
  eq('потолок из конфига', club.view(A).budget.cap, CL.DAILY_GOLD_CAP);
  eq('и он поднят до 300', CL.DAILY_GOLD_CAP, 300);
  // Взнос за платную игру возвращается в бюджет: иначе десять партий
  // напёрстков забили бы потолок, хотя игрок ушёл в минус.
  A.club.cd = {};
  const spentBefore = club.view(A).budget.spent;
  utils.rnd = () => 2;
  try { club.thimblePlay(A, 0, []); } finally { utils.rnd = realRnd; }
  ok('проигранная партия потолок не расходует',
     club.view(A).budget.spent <= spentBefore);

  console.log('\n[16] Полоска сверху знает, где игрок');
  clearAll();
  eq('вне игры полоски нет', cm.liveView(A).kind, 'none');
  cm.enqueue(A, 'intercept', []);
  const lq = cm.liveView(A);
  eq('в очереди — полоска очереди', lq.kind, 'queue');
  eq('и названа игра', lq.title, 'Радиоперехват');
  ok('видно, сколько ещё ждать', lq.ttlSec > 0 && lq.ttlSec <= CL.QUEUE_TTL_MIN * 60);
  cm.enqueue(B, 'intercept', []);
  const lm = cm.liveView(A);
  eq('в бою — полоска боя', lm.kind, 'match');
  eq('с именем соперника', lm.foeName, 'Второй');
  eq('и с признаком «ход не сделан»', lm.moved, false);
  ok('срок хода идёт', lm.deadlineSec > 0);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
