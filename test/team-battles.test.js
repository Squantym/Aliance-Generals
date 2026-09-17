// ═══════════════════════════════════════════════════════════════════
// test/team-battles.test.js — «Командные сражения» (17.09.2026)
//
// Что стережётся:
//  1. Новые групповые бои (squadBattle): взнос $1 млрд, возврат при
//     отмене записи, реальные характеристики «как в игре», роли, боты
//     50–80% от средних за 10 секунд до старта, приз $2 млрд каждому
//     живому победителю, ничья — возврат, прогульщик и ушедший взнос
//     теряют, один общий рейтинг без рангов.
//  2. Нельзя быть в двух режимах сразу (арена, рейтинговые, групповые).
//  3. Таймер: после старта отсчёт не идёт, пока никто не записался
//     (жалоба «таймер снова начинает отсчёт без игроков»); идущий бой не
//     задерживает следующий — оба идут параллельно.
//  4. Арена: реальные характеристики, боты до 10 мест с 70% средних, бот
//     выигрывает — банк сгорает, живой вытесняет бота из полного
//     списка, боты сами бьют.
//  5. Бой заканчивается, когда боеприпасы кончились у всех.
//
// Запуск: node test/team-battles.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-team-battles';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.ALLOW_UNVERIFIED_EMAIL = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 60)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const db = require(ROOT + '/dist/src/core/db');
const sq = require(ROOT + '/dist/src/services/squadBattle');
const gb = require(ROOT + '/dist/src/services/groupBattle');
const arena = require(ROOT + '/dist/src/services/arena');
const RS = require(ROOT + '/dist/src/services/realStats');

const B = 1e9;
const setSlot = (coll, ms) => { const s = db.load(coll, {}); s.slot = Date.now() + ms; db.save(coll); };
const sqStore = () => db.load('squadBattle', {});

(async () => {
  let n = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `tb${++n}@t.ru`, 'ru', '10.3.0.' + n);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.dollars = 10 * B; p.gold = 1000; p.level = 60;
    return p;
  };
  const A = await reg('Альфа');
  const Bp = await reg('Бета');
  const C = await reg('Гамма');
  const D = await reg('Дельта');
  A.skills.health = 30; A.skills.ammo = 20; A.skills.energy = 10;   // Альфа крепче
  Bp.skills.ammo = 20;

  console.log('\n[1] Запись на новые групповые бои');
  sq.register(A, 'fighter', []);
  ok(A.dollars === 9 * B, `взнос $1 млрд списан: ${A.dollars / B} млрд`);
  fails(() => sq.register(A, 'fighter', []), 'уже записаны', 'дважды нельзя');
  sq.unregister(A, []);
  ok(A.dollars === 10 * B, 'отмена записи — взнос вернулся');
  ok(sqStore().slot === 0, 'после ухода последнего отсчёт остановлен');
  const poor = await reg('Бедняк');
  poor.dollars = B - 1;
  fails(() => sq.register(poor, 'fighter', []), 'Не хватает', 'без миллиарда записаться нельзя');

  console.log('\n[2] Нельзя в двух режимах сразу');
  sq.register(A, 'fighter', []);
  fails(() => gb.register(A, 'fighter', []), 'групповых боях', 'записанный в групповые не попадёт в рейтинговые');
  fails(() => arena.register(A, 'elite', []), 'групповых боях', 'и на арену');
  gb.register(C, 'medic', []);
  fails(() => sq.register(C, 'fighter', []), 'рейтинговых боях', 'записанный в рейтинговые не попадёт в групповые');
  gb.unregister(C, []);

  console.log('\n[3] Боты за 10 секунд до старта, от средних у живых');
  sq.register(Bp, 'guardian', []);
  sq.setRole(A, 'fighter', []);
  ok(sq.BOT_FILL_BEFORE_MS === 10000, 'добор ботов — за 10 секунд');
  setSlot('squadBattle', 30000);
  sq.tick();
  ok(Object.keys(sqStore().registered).length === 2, 'за 30 секунд до старта ботов ещё нет');
  setSlot('squadBattle', 5000);
  sq.tick();
  const botsHalf = Object.keys(sqStore().registered).filter((id) => id.startsWith(sq.BOT_PREFIX)).length;
  ok(botsHalf > 0 && botsHalf < 8, `за 5 секунд — часть мест: ${botsHalf} ботов`);
  setSlot('squadBattle', -1000);
  sq.tick();
  const s1 = sqStore();
  const b1 = s1.battle;
  ok(b1 && b1.state === 'preparing' && Object.keys(b1.fighters).length === 10, 'бой собрался: 10 бойцов');
  ok(s1.slot === 0 && sq.view(D).secondsLeft === 0, 'очередь пуста — отсчёта нет');
  const fa = b1.fighters[A.id], fb = b1.fighters[Bp.id];
  const snapA = RS.snapshot(A), snapB = RS.snapshot(Bp);
  ok(fa.maxHp === snapA.hp && fa.maxHp === player.maxima(A).hp, `здоровье Альфы — как в игре: ${fa.maxHp}`);
  ok(fa.maxAmmo === player.maxima(A).am && fa.maxEnergy === player.maxima(A).en, 'боеприпасы и энергия — как в игре');
  ok(fb.maxHp === Math.round(snapB.hp * 1.25), `защитник крепче на 25%: ${fb.maxHp}`);
  ok(fa.stats.atk === snapA.atk && fa.stats.def === snapA.def, 'мощь атаки и защиты — от армии');
  const avgHp = (snapA.hp + snapB.hp) / 2;
  const bots = Object.values(b1.fighters).filter((f) => f.isBot);
  ok(bots.every((f) => f.stats.hp >= Math.floor(avgHp * 0.5) && f.stats.hp <= Math.ceil(avgHp * 0.8)),
     `здоровье ботов — 50–80% от среднего (${Math.round(avgHp)})`);
  // Мощь не ниже 10 — та же нижняя граница, что у живых без армии
  ok(bots.every((f) => f.stats.atk <= Math.max(10, Math.ceil((snapA.atk + snapB.atk) / 2 * 0.8))), 'и мощь не выше 80%');
  ok(bots.every((f) => f.botSmart >= 0.6 && f.botSmart <= 0.8), 'сообразительность ботов 0.6–0.8');
  ok(bots.every((f) => f.paid === 0), 'боты взнос не платят');
  const teamOf = (id) => b1.fighters[id].team;
  ok(teamOf(A.id) !== teamOf(Bp.id), 'живые разведены по разным командам');

  console.log('\n[4] Идущий бой не держит следующий');
  sq.register(C, 'fighter', []);
  const s2 = sqStore();
  ok(s2.slot > Date.now() + 4 * 60000, 'новая запись запустила свой отсчёт');
  setSlot('squadBattle', -1000);
  sq.tick();
  const s3 = sqStore();
  ok(s3.others.length === 1 && s3.others[0].id === b1.id, 'первый бой продолжается в стороне');
  ok(s3.battle.id !== b1.id && s3.battle.fighters[C.id], 'второй бой начался сразу, без ожидания');
  ok(sq.battleState(A).state === 'preparing' && sq.battleState(C).state === 'preparing', 'каждый видит свой бой');

  console.log('\n[5] Победа: по $2 млрд каждому живому победителю');
  // Открываем комнату, пропускаем подготовку
  sq.battleState(A); sq.battleState(Bp);
  const s4 = sqStore();
  const bb = s4.others[0];
  bb.prepareUntil = Date.now() - 1;
  db.save('squadBattle');
  sq.tick();
  const cur = sqStore().others[0];
  ok(cur.state === 'running', 'подготовка кончилась — бой идёт');
  const winTeam = cur.fighters[A.id].team;
  const moneyA = A.dollars, moneyB = Bp.dollars;
  for (const f of Object.values(cur.fighters)) if (f.team !== winTeam) { f.alive = false; f.hp = 0; }
  db.save('squadBattle');
  sq.tick();
  const done = sqStore().others.find((x) => x.id === bb.id) || sqStore().results[bb.id];
  ok(done && (done.state === 'done' || done.rows), 'бой завершён');
  ok(A.dollars === moneyA + 2 * B, `Альфа получил $2 млрд: +${(A.dollars - moneyA) / B}`);
  ok(Bp.dollars === moneyB, 'проигравший ничего не получил (взнос уже списан)');
  const res = sqStore().results[bb.id];
  const rowA = res.rows.find((r) => r.id === A.id);
  ok(rowA.won && rowA.prize === 2 * B && rowA.money === B, 'в итогах: приз 2 млрд, чистыми +1 млрд');
  ok(res.rows.find((r) => r.id === Bp.id).money === -B, 'у проигравшего — минус взнос');
  const rt = sq.ratingTable(A, 10);
  ok(rt.top[0].id === A.id && rt.top[0].points >= 3 && !('myRank' in rt), 'рейтинг один, без рангов');

  console.log('\n[6] Ничья — взнос возвращается, прогульщик и ушедший его теряют');
  const s5 = sqStore();
  const b2 = s5.battle;               // бой с Гаммой
  sq.battleState(C);
  b2.prepareUntil = Date.now() - 1;
  db.save('squadBattle');
  sq.tick();
  const moneyC = C.dollars;
  const cur2 = sqStore().battle;
  for (const f of Object.values(cur2.fighters)) { f.ammo = 0; }
  db.save('squadBattle');
  ok(sq.outOfAmmo(cur2), 'у всех кончились боеприпасы');
  // Равное здоровье команд — ничья
  const hpEach = 50;
  for (const f of Object.values(cur2.fighters)) { f.hp = hpEach; f.alive = true; }
  db.save('squadBattle');
  sq.tick();
  const r2 = sqStore().results[b2.id];
  ok(r2 && r2.winnerTeam === -1, 'стрелять нечем — бой закончен ничьей по здоровью');
  ok(C.dollars === moneyC + B, 'при ничьей взнос вернулся');
  // Прогульщик
  sq.register(D, 'fighter', []);
  sq.register(C, 'fighter', []);
  setSlot('squadBattle', -1000);
  sq.tick();
  sq.battleState(C);               // Гамма открыл комнату, Дельта — нет
  const b3 = sqStore().battle;
  b3.prepareUntil = Date.now() - 1;
  db.save('squadBattle');
  sq.tick();
  const cur3 = sqStore().battle;
  ok(cur3.fighters[D.id].forfeited && cur3.fighters[D.id].isBot, 'не вышедшего заменил резерв');
  fails(() => sq.act(D, 'attack', Object.keys(cur3.fighters).find((id) => cur3.fighters[id].team !== cur3.fighters[D.id].team), []),
        'не вышли', 'прогульщик не управляет копией');
  const moneyD = D.dollars, moneyC2 = C.dollars;
  sq.leave(C, []);
  for (const f of Object.values(sqStore().battle.fighters)) { f.ammo = 0; f.hp = 10; }
  const cb = sqStore().battle;
  for (const f of Object.values(cb.fighters)) if (f.id === C.id) { f.hp = 0; f.alive = false; }
  db.save('squadBattle');
  sq.tick();
  const r3 = sqStore().results[b3.id];
  ok(!!r3, 'бой завершён');
  ok(D.dollars === moneyD && C.dollars === moneyC2, 'ни прогульщик, ни ушедший взнос не вернули');
  ok(r3.rows.find((r) => r.id === D.id).forfeited && r3.rows.find((r) => r.id === D.id).money === -B, 'прогульщик: минус взнос');
  ok(r3.rows.find((r) => r.id === C.id).left, 'ушедший отмечен');

  console.log('\n[7] Рейтинговые бои: таймер и параллельные бои');
  gb.register(A, 'fighter', []);
  setSlot('groupBattle', -1000);
  gb.tick();
  const g1 = db.load('groupBattle', {});
  ok(g1.battle && g1.slot === 0, 'после старта отсчёта нет');
  ok(gb.view(D).secondsLeft === 0, 'витрина показывает 0, а не «5:00»');
  gb.register(Bp, 'fighter', []);
  setSlot('groupBattle', -1000);
  gb.tick();
  const g2 = db.load('groupBattle', {});
  ok(g2.others.length === 1 && g2.battle.fighters[Bp.id] && g2.others[0].fighters[A.id], 'новый рейтинговый бой не ждёт старого');
  ok(gb.battleState(A).state && gb.battleState(Bp).state, 'оба видят свои бои');

  console.log('\n[8] Арена: боты, реальные характеристики, банк');
  arena.setSeats(10);
  const E = await reg('Эпсилон');
  E.skills.health = 10;
  arena.register(E, 'elite', []);
  const ar = () => db.load('arena', {}).divs.elite;
  let st = ar(); st.slot = Date.now() + 30000; db.save('arena');
  arena.tick();
  ok(Object.keys(ar().registered).length === 1, 'за 30 секунд ботов нет');
  st = ar(); st.slot = Date.now() + 8000; db.save('arena');
  arena.tick();
  ok(Object.keys(ar().registered).length === 10, 'за 10 секунд места до 10 заняли боты');
  const F = await reg('Зета');
  arena.register(F, 'elite', []);
  ok(Object.keys(ar().registered).length === 10 && ar().registered[F.id], 'живой вытеснил бота');
  st = ar(); st.slot = Date.now() - 1000; db.save('arena');
  arena.tick();
  const ab = ar().battle;
  ok(ab && Object.keys(ab.fighters).length === 10, 'бой на 10 мест');
  ok(ab.pot === 20, `банк — только взносы живых: ${ab.pot}`);
  const snapE = RS.snapshot(E), snapF = RS.snapshot(F);
  ok(ab.fighters[E.id].maxHp === snapE.hp && ab.fighters[E.id].ammo === snapE.ammo, 'у живых — реальные характеристики');
  const aBots = Object.values(ab.fighters).filter((f) => f.isBot);
  const avgA = (snapE.hp + snapF.hp) / 2;
  ok(aBots.length === 8 && aBots.every((f) => f.maxHp === Math.round(avgA * 0.7)), `боты — 70% среднего здоровья (${Math.round(avgA * 0.7)})`);
  ok(aBots.every((f) => f.seen && f.entered), 'боты в строю сразу');
  // Бой пошёл — боты бьют сами
  for (const f of Object.values(ab.fighters)) f.seen = true;
  ab.prepareUntil = Date.now() - 1;
  db.save('arena');
  arena.tick();
  const ab2 = ar().battle;
  const dealtByBots = Object.values(ab2.fighters).filter((f) => f.isBot).reduce((s, f) => s + f.damageDealt, 0);
  ok(dealtByBots > 0, `боты атакуют сами: ${dealtByBots} урона`);
  // Победил бот — банк сгорает
  const goldE = E.gold, goldF = F.gold;
  const winnerBot = Object.values(ab2.fighters).find((f) => f.isBot);
  for (const f of Object.values(ab2.fighters)) if (f.id !== winnerBot.id) { f.alive = false; f.hp = 0; f.place = 5; }
  db.save('arena');
  arena.tick();
  const ar3 = arena.result(E, arena.lastResultId(E.id));
  ok(ar3.winnerIsBot && ar3.potBurned, 'победил бот — банк сгорел');
  ok(E.gold === goldE && F.gold === goldF, 'живым ничего не выплачено');
  ok(!db.load('arena', {}).ratings.elite[winnerBot.id], 'бот в таблицу рейтинга не попал');
  ok(ar3.rows.find((r) => r.isBot).delta === 0, 'у бота нет ни взноса, ни выигрыша');

  console.log('\n[9] Арена: следующий бой не ждёт идущего');
  const G = await reg('Эта');
  arena.register(G, 'elite', []);
  st = ar(); st.slot = Date.now() - 1000; db.save('arena');
  arena.tick();
  const firstId = ar().battle.id;
  const H = await reg('Тета');
  arena.register(H, 'elite', []);
  st = ar(); st.slot = Date.now() - 1000; db.save('arena');
  arena.tick();
  const ar4 = ar();
  ok(ar4.battle.id !== firstId && ar4.battle.fighters[H.id], 'новый бой арены начался вовремя');
  ok(ar4.others.some((x) => x.id === firstId), 'а идущий доигрывается в стороне');
  ok(arena.battleState(G).battleId === firstId && arena.battleState(H).battleId === ar4.battle.id, 'каждый видит свой бой');
  fails(() => arena.register(G, 'elite', []), 'уже участвуете', 'живой участник идущего боя не записывается повторно');

  console.log('\n[10] Арена: боеприпасы кончились — бой окончен');
  const b10 = ar4.battle;
  for (const f of Object.values(b10.fighters)) { f.seen = true; f.ammo = 0; }
  b10.prepareUntil = Date.now() - 1;
  b10.fighters[H.id].hp = b10.fighters[H.id].maxHp + 1000;   // у Теты больше всех
  db.save('arena');
  const goldH = H.gold;
  arena.tick();
  ok(ar().battle.state === 'done' && ar().battle.winnerId === H.id, 'стрелять нечем — победил тот, у кого больше здоровья');
  ok(H.gold === goldH + ar().battle.pot, 'и забрал банк');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
