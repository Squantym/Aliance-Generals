// ═══════════════════════════════════════════════════════════════════
// test/team-battles.test.js — «Командные сражения» (17.09.2026)
//
// Что стережётся:
//  1. Новые групповые бои (squadBattle): взнос $1 млрд, возврат при
//     отмене записи, в бой — с ТЕКУЩИМИ запасами игрока (роль их не
//     меняет), итог боя переносится в игру, боеприпасы восстанавливаются
//     как в игре, удар 20–35 и крит ×4–×7, лечение 22–46 и крит
//     160–240, боты 50–80% от средних за 10 секунд до старта, приз $2
//     млрд каждому живому победителю, ничья — возврат, прогульщик и
//     ушедший взнос теряют, один общий рейтинг без рангов.
//  2. Нельзя быть в двух режимах сразу (арена, рейтинговые, групповые).
//  3. Таймер: после старта отсчёт не идёт, пока никто не записался
//     (жалоба «таймер снова начинает отсчёт без игроков»); идущий бой не
//     задерживает следующий — оба идут параллельно.
//  4. Арена: реальные характеристики, боты до 10 мест с 70% средних, бот
//     выигрывает — банк сгорает, живой вытесняет бота из полного
//     списка, боты сами бьют.
//  5. Пустые боеприпасы бой не заканчивают — они восстанавливаются.
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

const B = 1e6;          // взнос
const WIN = 5e8;        // приз живому победителю (решение владельца 18.09.2026)
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
  // У Альфы прокачан трофей «Боевая логистика» (10 ур. — на 75% быстрее),
  // у Беты — нет: в бою боеприпасы у них должны идти с разной скоростью
  A.trophies = Object.assign(A.trophies || {}, { ammo_logi: 10 });
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
  // Запасы на входе: ровно с ними бойцы выйдут на поле
  const mxA = player.maxima(A), mxB = player.maxima(Bp);
  const now0 = Date.now();
  A.res = { hp: { cur: 300, t: now0 }, en: { cur: 70, t: now0 }, am: { cur: 7, t: now0 } };
  Bp.res = { hp: { cur: 90, t: now0 }, en: { cur: 100, t: now0 }, am: { cur: 3, t: now0 } };
  setSlot('squadBattle', -1000);
  sq.tick();
  const s1 = sqStore();
  const b1 = s1.battle;
  ok(b1 && b1.state === 'preparing' && Object.keys(b1.fighters).length === 10, 'бой собрался: 10 бойцов');
  ok(s1.slot === 0 && sq.view(D).secondsLeft === 0, 'очередь пуста — отсчёта нет');
  const fa = b1.fighters[A.id], fb = b1.fighters[Bp.id];
  ok(fa.hp === 300 && fa.maxHp === mxA.hp, `здоровье Альфы — как на входе: ${fa.hp}/${fa.maxHp}`);
  ok(fa.energy === 70 && fa.maxEnergy === mxA.en, `энергия — как на входе: ${fa.energy}/${fa.maxEnergy}`);
  ok(fa.ammo === 7 && fa.maxAmmo === mxA.am, `боеприпасы — как на входе: ${fa.ammo}/${fa.maxAmmo}`);
  ok(fb.hp === 90 && fb.maxHp === mxB.hp, `роль защитника запасы не меняет: ${fb.hp}/${fb.maxHp}`);
  ok(fa.stats.ammoRegenSec === player.ammoRegenSeconds(A), `восстановление боеприпасов — как в игре: ${fa.stats.ammoRegenSec} с`);
  ok(fa.stats.ammoRegenSec === 36 && fb.stats.ammoRegenSec === 180,
     `трофей ускоряет и в бою: у Альфы ${fa.stats.ammoRegenSec} с, у Беты ${fb.stats.ammoRegenSec} с`);
  const avgHp = (300 + 90) / 2;
  const bots = Object.values(b1.fighters).filter((f) => f.isBot);
  ok(bots.every((f) => f.hp >= Math.floor(avgHp * 0.35) && f.hp <= Math.ceil(avgHp * 0.56) && f.hp === f.maxHp),
     `здоровье ботов — 35–56% от среднего на входе (${Math.round(avgHp)}), запас полный`);
  ok(bots.every((f) => f.stats.power >= 0.35 && f.stats.power <= 0.56), 'и сила удара — та же доля');
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

  console.log('\n[5] Победа: по $500 млн каждому живому победителю');
  // Открываем комнату, пропускаем подготовку
  sq.battleState(A); sq.battleState(Bp);
  const s4 = sqStore();
  const bb = s4.others[0];
  bb.prepareUntil = Date.now() - 1;
  db.save('squadBattle');
  sq.tick();
  const cur = sqStore().others[0];
  ok(cur.state === 'running', 'подготовка кончилась — бой идёт');
  // Удар и лечение — числа владельца
  const RSm = require(ROOT + '/dist/src/services/realStats');
  const realRnd = Math.random;
  Math.random = () => 0.99;          // без уворота и крита, верх диапазона
  const foeId = Object.keys(cur.fighters).find((id) => cur.fighters[id].team !== cur.fighters[A.id].team && cur.fighters[id].isBot);
  const foe = cur.fighters[foeId];
  const hp0 = foe.hp;
  foe.stats.dodgeChance = 0;
  sq.doAttack(cur, cur.fighters[A.id], foe);
  const plain = hp0 - foe.hp;
  Math.random = () => 0;             // крит всегда, низ диапазона
  cur.fighters[A.id].stats.critChance = 1;
  foe.hp = 5000; foe.maxHp = 5000;
  foe.role = 'fighter';
  sq.doAttack(cur, cur.fighters[A.id], foe);
  const critHit = 5000 - foe.hp;
  Math.random = realRnd;
  ok(plain >= Math.round(20 * 1.25) && plain <= Math.round(35 * 1.25), `удар штурмовика 20–35 ×1.25: ${plain}`);
  ok(critHit >= Math.round(20 * 4 * 1.25) && critHit <= Math.round(35 * 7 * 1.25), `крит ×4–×7: ${critHit}`);
  ok(RSm.HIT_MIN === 20 && RSm.HIT_MAX === 35 && RSm.CRIT_MULT_MIN === 4 && RSm.CRIT_MULT_MAX === 7, 'числа удара в одном месте');
  ok(sq.HEAL_MIN === 22 && sq.HEAL_MAX === 46 && sq.HEAL_CRIT_MIN === 160 && sq.HEAL_CRIT_MAX === 240, 'лечение 22–46, крит 160–240');
  // Восстановление боеприпасов в бою
  const fA = cur.fighters[A.id];
  fA.ammo = 0;
  fA.ammoAt = Date.now() - 3 * fA.stats.ammoRegenSec * 1000 - 500;
  db.save('squadBattle');
  sq.tick();
  const fA2 = sqStore().others[0].fighters[A.id];
  ok(fA2.ammo === 3, `за три интервала вернулось 3 боеприпаса: ${fA2.ammo}`);
  // Итог боя — в игру
  const endHp = 123, endEn = 20;
  const curW = sqStore().others[0];
  curW.fighters[A.id].hp = endHp; curW.fighters[A.id].energy = endEn;
  const winTeam = curW.fighters[A.id].team;
  const moneyA = A.dollars, moneyB = Bp.dollars;
  for (const f of Object.values(curW.fighters)) if (f.team !== winTeam) { f.alive = false; f.hp = 0; }
  db.save('squadBattle');
  sq.tick();
  ok(A.res.hp.cur === endHp && A.res.en.cur === endEn && A.res.am.cur === 3,
     `итог боя перенесён в игру: ${A.res.hp.cur} HP, ${A.res.en.cur} энергии, ${A.res.am.cur} боеприпасов`);
  ok(Bp.res.hp.cur === 0, 'у погибшего в бою — ноль здоровья и в игре');
  const done = sqStore().others.find((x) => x.id === bb.id) || sqStore().results[bb.id];
  ok(done && (done.state === 'done' || done.rows), 'бой завершён');
  ok(A.dollars === moneyA + WIN, `Альфа получил приз: +$${(A.dollars - moneyA) / 1e6} млн`);
  ok(Bp.dollars === moneyB, 'проигравший ничего не получил (взнос уже списан)');
  const res = sqStore().results[bb.id];
  const rowA = res.rows.find((r) => r.id === A.id);
  ok(rowA.won && rowA.prize === WIN && rowA.money === WIN - B, 'в итогах: приз 500 млн, чистыми приз минус взнос');
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
  for (const f of Object.values(cur2.fighters)) { f.ammo = 0; f.ammoAt = Date.now(); }
  db.save('squadBattle');
  sq.tick();
  ok(sqStore().battle.state === 'running', 'боеприпасы у всех кончились — бой идёт дальше');
  // Равное здоровье команд и вышедшее время — ничья
  const hpEach = 50;
  const cur2b = sqStore().battle;
  for (const f of Object.values(cur2b.fighters)) { f.hp = hpEach; f.alive = true; }
  cur2b.startedAt = Date.now() - 21 * 60000;
  db.save('squadBattle');
  sq.tick();
  const r2 = sqStore().results[b2.id];
  ok(r2 && r2.winnerTeam === -1, 'время вышло при равном здоровье — ничья');
  ok(C.dollars === moneyC + B, 'при ничьей взнос вернулся');
  // Прогульщик
  sq.register(D, 'fighter', []);
  sq.register(C, 'fighter', []);
  setSlot('squadBattle', -1000);
  sq.tick();
  sq.battleState(C);               // Гамма открыл комнату, Дельта — нет
  const b3 = sqStore().battle;
  b3.prepareUntil = Date.now() - 1;
  // Гамма входит с остатком здоровья прошлого боя: резерв с критом ×4–×7
  // иногда добивал его за этот тик, и выход ниже падал «Вы уже выбыли»
  b3.fighters[C.id].hp = b3.fighters[C.id].maxHp = 100000;
  db.save('squadBattle');
  sq.tick();
  const cur3 = sqStore().battle;
  ok(cur3.fighters[D.id].forfeited && cur3.fighters[D.id].isBot, 'не вышедшего заменил резерв');
  fails(() => sq.act(D, 'attack', Object.keys(cur3.fighters).find((id) => cur3.fighters[id].team !== cur3.fighters[D.id].team), []),
        'Бой не идёт', 'прогульщик не управляет копией — в бой его больше не пускают');
  const moneyD = D.dollars, moneyC2 = C.dollars;
  sq.leave(C, []);
  for (const f of Object.values(sqStore().battle.fighters)) { f.ammo = 0; f.hp = 10; }
  const cb = sqStore().battle;
  for (const f of Object.values(cb.fighters)) if (f.id === C.id) { f.hp = 0; f.alive = false; }
  cb.startedAt = Date.now() - 21 * 60000;   // время боя вышло
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
  ok(ab.fighters[E.id].hp === ab.fighters[E.id].stats.hp && ab.fighters[E.id].maxHp === snapE.maxHp
     && ab.fighters[E.id].ammo === ab.fighters[E.id].stats.ammo, 'у живых — запасы на входе');
  const aBots = Object.values(ab.fighters).filter((f) => f.isBot);
  const avgA = (ab.fighters[E.id].hp + ab.fighters[F.id].hp) / 2;
  ok(aBots.length === 8 && aBots.every((f) => f.maxHp === Math.round(avgA * 0.7) && f.stats.power === 0.7),
     `боты — 70% среднего здоровья (${Math.round(avgA * 0.7)}) и силы удара`);
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
  // Живой бот: соседи-боты за прошлый тик могли кого-то добить, а бой без
  // живых не заканчивается победой — он отменяется, и разбора нет
  const winnerBot = Object.values(ab2.fighters).find((f) => f.isBot && f.alive);
  winnerBot.hp = Math.max(1, winnerBot.hp);
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

  console.log('\n[10] Арена: боеприпасы восстанавливаются, итог — в игру');
  const b10 = ar4.battle;
  for (const f of Object.values(b10.fighters)) { f.seen = true; f.ammo = 0; f.ammoAt = Date.now(); }
  b10.prepareUntil = Date.now() - 1;
  db.save('arena');
  arena.tick();
  ok(ar().battle.state === 'running', 'пустые боеприпасы бой не заканчивают');
  const fH = ar().battle.fighters[H.id];
  fH.ammoAt = Date.now() - 2 * fH.stats.ammoRegenSec * 1000 - 100;
  fH.botAt = Date.now();
  db.save('arena');
  const st10 = arena.battleState(H);
  ok(st10.me.ammo === 2, `за два интервала — два боеприпаса: ${st10.me.ammo}`);
  ok(st10.me.critPct >= 0 && st10.me.ammoRegenSec > 0, 'игрок видит крит и скорость восстановления');
  // Тета побеждает с 37 HP — столько и остаётся в игре
  const b10b = ar().battle;
  for (const f of Object.values(b10b.fighters)) if (f.id !== H.id) { f.alive = false; f.hp = 0; f.place = 5; }
  b10b.fighters[H.id].hp = 37;
  db.save('arena');
  const goldH = H.gold;
  arena.tick();
  ok(ar().battle.state === 'done' && ar().battle.winnerId === H.id, 'Тета победил');
  ok(H.gold === goldH + ar().battle.pot, 'и забрал банк');
  ok(H.res.hp.cur === 37 && H.res.am.cur === 2, `итог арены в игре: ${H.res.hp.cur} HP, ${H.res.am.cur} боеприпасов`);

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
