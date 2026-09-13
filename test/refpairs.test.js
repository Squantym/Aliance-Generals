// ═══════════════════════════════════════════════════════════════════
// test/refpairs.test.js — парные задания приглашений
//
// Правило одно и главное: награда приходит ОБОИМ и только тогда, когда
// условие выполнили ОБА. Половина пары не закрывает задание — это и
// проверяется в первую очередь, потому что ошибка здесь означала бы
// бесплатную раздачу золота через второй аккаунт.
//
// Отдельно проверяются: ежедневные считаются по московскому дню,
// разовые — за всё время, и каждое задание выдаёт ровно свою награду
// (включая динамическую «половину стоимости покупки»).
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

  const boss = await reg('Наставник');
  const mate = await reg('Подопечный');
  features.applyReferral(mate, features.ensureRefCode(boss), nx);
  boss.gold = 0; mate.gold = 0; boss.dollars = 0; mate.dollars = 0;

  console.log('\n[1] Пара видна с обеих сторон');
  let mine = rq.pairsView(boss);
  ok(mine.length === 1 && mine[0].otherName === 'Подопечный', 'у пригласившего пара с приглашённым');
  const theirs = rq.pairsView(mate);
  ok(theirs.length === 1 && theirs[0].otherName === 'Наставник', 'и наоборот');
  ok(mine[0].daily.length === Q.pairDaily.length && mine[0].once.length === Q.pairOnce.length,
     `${mine[0].daily.length} ежедневных и ${mine[0].once.length} разовых заданий`);

  console.log('\n[2] Половина пары задание не закрывает');
  dq.bump(boss, 'chatMessages', 10);
  mine = rq.pairsView(boss);
  ok(task(mine[0].daily, 'pd_chat').mine === 10 && task(mine[0].daily, 'pd_chat').theirs === 0,
     'видно оба прогресса: свой и напарника');
  ok(task(mine[0].daily, 'pd_chat').done === false, 'пока написал один — задание не выполнено');
  ok(boss.gold === 0 && mate.gold === 0, 'и награды никто не получил');

  console.log('\n[3] Сделали оба — награда обоим сразу');
  dq.bump(mate, 'chatMessages', 10);
  mine = rq.pairsView(boss);
  ok(task(mine[0].daily, 'pd_chat').done === true, 'условие закрыто');
  ok(boss.gold === 10 && mate.gold === 10, `обоим начислено по ${boss.gold} золота`);
  // Повторный просмотр не выдаёт награду второй раз
  rq.pairsView(boss); rq.pairsView(mate); rq.pairsView(boss);
  ok(boss.gold === 10 && mate.gold === 10, 'повторные заходы в раздел награду не удваивают');

  console.log('\n[4] Ежедневные считаются по московскому дню');
  const box = dq.mskBox(boss);
  ok(box.day === require('../dist/src/core/utils').dayKey(), 'счётчики живут в московских сутках');
  box.day = '2000-01-01';                 // «наступило завтра»
  ok(dq.mskCount(boss, 'chatMessages') === 0, 'с новым днём счётчик обнулился');

  console.log('\n[5] Разовые задания — за всё время');
  boss.counters.sanctionsMade = 10;
  mine = rq.pairsView(boss);
  ok(task(mine[0].once, 'po_sanc10').mine === 10 && task(mine[0].once, 'po_sanc10').done === false,
     'у одного есть, у второго нет — не выполнено');
  mate.counters.sanctionsMade = 10;
  const goldBefore = boss.gold, dollarsBefore = boss.dollars;
  mine = rq.pairsView(boss);
  ok(task(mine[0].once, 'po_sanc10').done === true, 'оба объявили по 10 санкций');
  ok(boss.gold - goldBefore === 150 && boss.dollars - dollarsBefore === 15000000000,
     'выдана составная награда: золото и деньги');
  ok(mate.gold - 10 === 150, 'и напарнику тоже');

  console.log('\n[6] Награды нестандартных видов');
  // Техника: обоим по 100 единиц самой свежей
  boss.counters.chatMessages = 0;
  dq.bump(boss, 'topUnitsBought', 100);
  dq.bump(mate, 'topUnitsBought', 100);
  const top = units.topUnitFor(boss);
  const hadUnits = player.unitTotalCount(boss, top.id);
  rq.pairsView(boss);
  ok(player.unitTotalCount(boss, top.id) - hadUnits === 100,
     `выдано 100 единиц «${top.name}»`);
  // Диверсанты: по 20 каждого вида, кроме секретных и смертников
  dq.bump(boss, 'buildingsBuilt', 50);
  dq.bump(mate, 'buildingsBuilt', 50);
  rq.pairsView(mate);
  ok(mate.saboteurs.ground === 20 && mate.saboteurs.sea === 20
     && mate.saboteurs.air === 20 && mate.saboteurs.building === 20,
     'выдано по 20 диверсантов четырёх видов');
  ok(!mate.saboteurs.secret && !mate.saboteurs.suicide, 'секретные и смертники не выдаются');
  // Половина стоимости покупки — у каждого своя, и считается по САМОЙ
  // ДОРОГОЙ покупке дня: дешёвый стимулятор, взятый первым, не должен
  // обесценивать контейнер, купленный следом
  boss.gold = 1000; mate.gold = 1000;
  market.buyItem(boss, 'stim', null, nx);    // 15 золота — первая покупка
  market.buyContainers(boss, 1, 1, nx);      // 50 золота — дороже
  market.buyItem(mate, 'stim', null, nx);    // 15 золота
  const bossGold = boss.gold, mateGold = mate.gold;
  rq.pairsView(boss);
  ok(boss.gold - bossGold === 25, `за контейнер в 50 золота вернулось ${boss.gold - bossGold}`);
  ok(mate.gold - mateGold === 7, `за покупку в 15 золота вернулось ${mate.gold - mateGold}`);

  console.log('\n[7] Совместные действия: подкрепления и групповые бои');
  pa.invitePlayer(boss, mate.name, nx); pa.acceptInvite(mate, boss.id, nx);
  rein.send(boss, mate.id, nx);
  mine = rq.pairsView(boss);
  ok(task(mine[0].daily, 'pd_rein').mine === 1 && task(mine[0].daily, 'pd_rein').theirs === 0,
     'одностороннее подкрепление задание не закрывает');
  rein.send(mate, boss.id, nx);
  const gBefore = boss.dollars;
  mine = rq.pairsView(boss);
  ok(task(mine[0].daily, 'pd_rein').done === true, 'обменялись подкреплениями — выполнено');
  ok(boss.dollars - gBefore === 10000000000, 'награда деньгами начислена');
  // Групповые бои: три совместных
  for (let i = 0; i < 3; i++) rq.onGroupBattle([boss.id, mate.id, 'посторонний']);
  const gb = boss.gold;
  mine = rq.pairsView(boss);
  ok(task(mine[0].daily, 'pd_group').mine === 3, 'совместные бои посчитаны');
  ok(task(mine[0].daily, 'pd_group').done === true && boss.gold - gb === 30,
     'три боя вместе — награда 30 золота');

  // Счётчик совместных боёв наполняется из самого группового боя —
  // проверяем, что вызов оттуда никуда не делся
  const gbSrc = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
  ok(/onGroupBattle\(real\)/.test(gbSrc), 'групповой бой сообщает о своих участниках');

  console.log('\n[8] Чужие в пару не попадают');
  const stranger = await reg('Посторонний');
  ok(rq.pairsView(stranger).length === 0, 'у игрока без приглашений парных заданий нет');
  rq.onGroupBattle([stranger.id, boss.id]);
  ok(Math.max(0, Number((dq.mskBox(boss).groupWith || {})[stranger.id]) || 0) === 0,
     'бой с посторонним в парный счётчик не идёт');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
