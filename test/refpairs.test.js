// ═══════════════════════════════════════════════════════════════════
// test/refpairs.test.js — парные задания приглашений
//
// Доска у игрока ОДНА, напарников может быть много: пригласил пятерых —
// засчитывается прогресс любого из них. У приглашённого напарник один —
// тот, кто его привёл.
//
// Главные правила, которые здесь стерегутся:
//   • половина пары задание не закрывает;
//   • награду получают оба — игрок и тот напарник, чьим прогрессом
//     задание закрыто;
//   • задание засчитывается ОДИН раз: пятеро друзей не превращают одно
//     задание в пять наград;
//   • ежедневные живут по московским суткам, разовые — за всё время.
//
// Запуск: node test/refpairs.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const features = require('../dist/src/services/features');
const rq = require('../dist/src/services/referralQuests');
const dq = require('../dist/src/services/dailyQuests');
const pa = require('../dist/src/services/personalAlliance');
const rein = require('../dist/src/services/reinforcements');
const market = require('../dist/src/services/market');
const units = require('../dist/src/services/units');
const config = require('../dist/config/gameConfig');
const Q = config.REFERRAL_QUESTS;
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const task = (list, id) => list.find((t) => t.id === id);

(async () => {
  await db.init();
  const nx = [];
  let ip = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `rp${++ip}@t.ru`, 'ru', '10.0.22.' + ip);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 40; p.gold = 0; p.dollars = 0;
    return p;
  };
  const invite = async (boss, name) => {
    const p = await reg(name);
    features.applyReferral(p, features.ensureRefCode(boss), nx);
    p.gold = 0; p.dollars = 0;
    return p;
  };

  const boss = await reg('Наставник');
  const mate = await invite(boss, 'Подопечный');
  boss.gold = 0; mate.gold = 0; boss.dollars = 0; mate.dollars = 0;

  console.log('\n[1] Доска одна, и она видна с обеих сторон');
  let mine = rq.pairBoard(boss);
  ok(mine.mates.length === 1 && mine.mates[0].name === 'Подопечный', 'у пригласившего напарник — приглашённый');
  const theirs = rq.pairBoard(mate);
  ok(theirs.mates.length === 1 && theirs.mates[0].name === 'Наставник', 'и наоборот');
  ok(mine.daily.length === Q.pairDaily.length && mine.once.length === Q.pairOnce.length,
     `${mine.daily.length} ежедневных и ${mine.once.length} разовых заданий`);

  console.log('\n[2] Половина пары задание не закрывает');
  dq.bump(boss, 'chatMessages', 10);
  mine = rq.pairBoard(boss);
  ok(task(mine.daily, 'pd_chat').mine === 10 && task(mine.daily, 'pd_chat').theirs === 0,
     'видно оба прогресса: свой и напарника');
  ok(task(mine.daily, 'pd_chat').done === false, 'пока написал один — задание не выполнено');
  ok(boss.gold === 0 && mate.gold === 0, 'и награды никто не получил');

  console.log('\n[3] Сделали оба — награда обоим сразу');
  dq.bump(mate, 'chatMessages', 10);
  mine = rq.pairBoard(boss);
  ok(task(mine.daily, 'pd_chat').done === true, 'условие закрыто');
  ok(boss.gold === 10 && mate.gold === 10, `обоим начислено по ${boss.gold} золота`);
  rq.pairBoard(boss); rq.pairBoard(mate); rq.pairBoard(boss);
  ok(boss.gold === 10 && mate.gold === 10, 'повторные заходы в раздел награду не удваивают');
  ok(task(rq.pairBoard(mate).daily, 'pd_chat').done === true, 'у напарника задание тоже отмечено');

  console.log('\n[4] Напарником идёт ЛЮБОЙ из приглашённых');
  const m2 = await invite(boss, 'Второй'), m3 = await invite(boss, 'Третий');
  ok(rq.pairBoard(boss).mates.length === 3, 'в напарниках все трое приглашённых');
  // Задание закрывает тот, кто дошёл до нужного числа
  dq.bump(boss, 'clubWon', 1);
  ok(task(rq.pairBoard(boss).daily, 'pd_club').done === false, 'никто из друзей ещё не выиграл');
  dq.bump(m3, 'clubWon', 1);
  const b4 = boss.gold, m2before = m2.gold, m3before = m3.gold;
  mine = rq.pairBoard(boss);
  ok(task(mine.daily, 'pd_club').done === true, 'выиграл третий — задание закрыто');
  ok(task(mine.daily, 'pd_club').mateName === 'Третий', `в строке назван напарник: ${task(mine.daily, 'pd_club').mateName}`);
  ok(boss.gold - b4 === 10 && m3.gold - m3before === 10, 'награду получили игрок и этот напарник');
  ok(m2.gold === m2before, 'остальные напарники награду не получают');
  // Второй друг то же задание для пригласившего повторно не открывает
  dq.bump(m2, 'clubWon', 1);
  const b5 = boss.gold;
  rq.pairBoard(boss);
  ok(boss.gold === b5, 'второй друг ту же награду не приносит — задание засчитано один раз');
  // Напарник, чьим прогрессом задание закрыто, уже получил своё: его
  // собственная доска не должна выдать ту же награду второй раз
  const m3after = m3.gold;
  rq.pairBoard(m3);
  ok(m3.gold === m3after, 'напарнику та же награда на его доске не повторяется');
  // И через ТРЕТЬЕГО игрока — тоже: цепочка «наставник → ученик → его
  // ученик» не должна выдавать ученику одну награду дважды
  const sub = await invite(mate, 'Внук');
  dq.bump(sub, 'chatMessages', 10);
  const mateBefore = mate.gold, subBefore = sub.gold;
  rq.pairBoard(sub);
  ok(sub.gold - subBefore === 10, 'новому игроку награда за его пару пришла');
  ok(mate.gold === mateBefore, 'а его напарнику, уже закрывшему это задание, — нет');

  console.log('\n[5] Ежедневные считаются по московскому дню');
  const box = dq.mskBox(boss);
  ok(box.day === require('../dist/src/core/utils').dayKey(), 'счётчики живут в московских сутках');
  box.day = '2000-01-01';
  ok(dq.mskCount(boss, 'chatMessages') === 0, 'с новым днём счётчик обнулился');

  console.log('\n[6] Разовые задания — за всё время');
  boss.counters.sanctionsMade = 10;
  mine = rq.pairBoard(boss);
  ok(task(mine.once, 'po_sanc10').mine === 10 && task(mine.once, 'po_sanc10').done === false,
     'у одного есть, у второго нет — не выполнено');
  mate.counters.sanctionsMade = 10;
  const goldBefore = boss.gold, dollarsBefore = boss.dollars;
  mine = rq.pairBoard(boss);
  ok(task(mine.once, 'po_sanc10').done === true, 'оба объявили по 10 санкций');
  ok(boss.gold - goldBefore === 150 && boss.dollars - dollarsBefore === 15000000000,
     'выдана составная награда: золото и деньги');

  console.log('\n[7] Награды нестандартных видов');
  dq.bump(boss, 'topUnitsBought', 100);
  dq.bump(mate, 'topUnitsBought', 100);
  const top = units.topUnitFor(boss);
  const hadUnits = player.unitTotalCount(boss, top.id);
  rq.pairBoard(boss);
  ok(player.unitTotalCount(boss, top.id) - hadUnits === 100, `выдано 100 единиц «${top.name}»`);
  dq.bump(boss, 'buildingsBuilt', 50);
  dq.bump(mate, 'buildingsBuilt', 50);
  rq.pairBoard(mate);
  ok(mate.saboteurs.ground === 20 && mate.saboteurs.sea === 20
     && mate.saboteurs.air === 20 && mate.saboteurs.building === 20,
     'выдано по 20 диверсантов четырёх видов');
  ok(!mate.saboteurs.secret && !mate.saboteurs.suicide, 'секретные и смертники не выдаются');
  // Половина стоимости — по самой дорогой покупке дня, у каждого своя
  boss.gold = 1000; mate.gold = 1000;
  market.buyItem(boss, 'stim', null, nx);    // 15 золота
  market.buyContainers(boss, 1, 1, nx);      // 50 золота — дороже
  market.buyItem(mate, 'stim', null, nx);    // 15 золота
  const bossGold = boss.gold, mateGold = mate.gold;
  rq.pairBoard(boss);
  ok(boss.gold - bossGold === 25, `за контейнер в 50 золота вернулось ${boss.gold - bossGold}`);
  ok(mate.gold - mateGold === 7, `за покупку в 15 золота вернулось ${mate.gold - mateGold}`);

  console.log('\n[8] Совместные действия считаются по конкретному напарнику');
  pa.invitePlayer(boss, mate.name, nx); pa.acceptInvite(mate, boss.id, nx);
  rein.send(boss, mate.id, nx);
  mine = rq.pairBoard(boss);
  ok(task(mine.daily, 'pd_rein').mine === 1 && task(mine.daily, 'pd_rein').theirs === 0,
     'одностороннее подкрепление задание не закрывает');
  rein.send(mate, boss.id, nx);
  const gBefore = boss.dollars;
  mine = rq.pairBoard(boss);
  ok(task(mine.daily, 'pd_rein').done === true, 'обменялись подкреплениями — выполнено');
  ok(boss.dollars - gBefore === 10000000000, 'награда деньгами начислена');
  for (let i = 0; i < 3; i++) rq.onGroupBattle([boss.id, mate.id, 'посторонний']);
  const gb = boss.gold;
  mine = rq.pairBoard(boss);
  ok(task(mine.daily, 'pd_group').mine === 3, 'совместные бои посчитаны');
  ok(task(mine.daily, 'pd_group').done === true && boss.gold - gb === 30,
     'три боя вместе — награда 30 золота');
  const gbSrc = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
  ok(/onGroupBattle\(real\)/.test(gbSrc), 'групповой бой сообщает о своих участниках');

  console.log('\n[9] Чужие в напарники не попадают');
  const stranger = await reg('Посторонний');
  ok(rq.pairBoard(stranger).mates.length === 0, 'у игрока без приглашений напарников нет');
  ok(rq.pairBoard(stranger).daily.every((t) => !t.done), 'и задания ему не закрываются');
  rq.onGroupBattle([stranger.id, boss.id]);
  ok(Math.max(0, Number((dq.mskBox(boss).groupWith || {})[stranger.id]) || 0) === 0,
     'бой с посторонним в парный счётчик не идёт');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
