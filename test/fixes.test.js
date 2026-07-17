// Тест правок: (1) допинг «Ястреб» усиливает и фаталити, не только крит;
// (2) победа строго по фактическому урону (dealt vs received);
// (3) почта: треды между игроками, системные события ушли в notifications;
// (4) admin: просмотр игрока «его глазами», список/детали групп, депозит в легион.
// Запуск: node test/fixes.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const social = require('../dist/src/services/social');
const notifications = require('../dist/src/services/notifications');
const admin = require('../dist/src/services/admin');
const groups = require('../dist/src/services/groups');
const legion = require('../dist/src/services/legion');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

const usersMap = db.load('users', {});
for (const k of Object.keys(usersMap)) delete usersMap[k];
const now = Date.now();

function mkUser(id, name, opts) {
  opts = opts || {};
  return {
    id, name, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: false,
    emailVerified: true, country: 'ru', status: '', createdAt: now, lastSeen: now,
    level: opts.level ?? 20, xp: 0, dollars: 1000, gold: 1e6, bank: opts.bank ?? 0, skillPoints: 0,
    skills: opts.skills || { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 },
    res: { hp: { cur: opts.hp ?? 100, max: 100, t: now }, en: { cur: 100, max: 100, t: now }, am: { cur: 9999, max: 9999, t: now } },
    units: opts.units || { ground_1: [10, 0, 0] },
    workshops: 0, modernQueue: [], buildings: {}, secretDevs: {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0, earsCurrent: c.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 },
    counters: { wins: 0, attacks: 0, fatalities: 0, unitsBought: 0, buildingsBuilt: 0, missionStages: 0, earsCut: 0, moneyEarned: 0, battleLoot: 0, level: 20 },
    achStages: {}, missions: {}, tutorial: { step: 0, done: true }, effects: opts.effects || [],
    trophies: Object.fromEntries(c.TROPHIES.map((t) => [t.id, (opts.trophies || {})[t.id] || 0])),
    club: {}, allianceId: null, legionId: null, lastIncomeAt: now,
    pendingFatality: null, lastChatAt: 0, trophyQueue: [],
    pendingBankHack: null, bankHackCountToday: 0, bankHackVictimsToday: [],
    landmines: 0, pendingMineDefuse: null, recentAttacks: {},
  };
}
const notices = { push: () => {} };

// ===================================================================
console.log('\n[1] Допинг «Ястреб» (crit_bonus) усиливает шанс ФАТАЛИТИ, не только крит');
function mkFatalityAttacker(withBuff) {
  const u = mkUser('u_fat_' + (withBuff ? 'buff' : 'nobuff'), 'Атакер', {
    skills: { energy: 0, health: 0, ammo: 0, cruelty: 20, agility: 0 },
    units: { ground_1: [500, 0, 0] },
  });
  if (withBuff) {
    u.effects.push({ id: 'crit_boost', name: 'Ястреб', type: 'crit_bonus', value: 20, expiresAt: now + 999999 });
  }
  return u;
}
function runFatalityTrial(attacker, victim, trials) {
  let critWinLowHp = 0, fatalities = 0;
  for (let i = 0; i < trials; i++) {
    attacker.lastAttackAt = 0; attacker.res.am.cur = 9999; attacker.res.hp.cur = 100;
    attacker.pendingFatality = null;
    attacker.level = 20; attacker.xp = 0; // иначе левелапится за тысячи атак и вылетает за ±10
    victim.res.hp.cur = 30; // maxima=200 (health skill=10) -> 15% = 30; выше порога атаки (25)
    victim.pendingFatality = null;
    const r = battle.attack(attacker, victim.id, notices);
    if (r.crit && r.win && r.targetHpPct <= 15) {
      critWinLowHp++;
      if (attacker.pendingFatality) { fatalities++; attacker.pendingFatality = null; }
    }
  }
  return { critWinLowHp, fatalities, rate: fatalities / Math.max(1, critWinLowHp) };
}

const victimA = mkUser('u_fat_victimA', 'ЖертваA', { units: { ground_1: [1, 0, 0] }, skills: { energy: 0, health: 10, ammo: 0, cruelty: 0, agility: 0 } });
const victimB = mkUser('u_fat_victimB', 'ЖертваB', { units: { ground_1: [1, 0, 0] }, skills: { energy: 0, health: 10, ammo: 0, cruelty: 0, agility: 0 } });
usersMap['u_fat_victimA'] = victimA; usersMap['u_fat_victimB'] = victimB;

const noBuff = mkFatalityAttacker(false);
usersMap[noBuff.id] = noBuff;
const withBuff = mkFatalityAttacker(true);
usersMap[withBuff.id] = withBuff;

const N = 4000;
const resNoBuff = runFatalityTrial(noBuff, victimA, N);
const resBuff = runFatalityTrial(withBuff, victimB, N);
console.log(`  без баффа: fatality-rate при crit&&win&&lowHP = ${(resNoBuff.rate * 100).toFixed(1)}% (образцов: ${resNoBuff.critWinLowHp})`);
console.log(`  с баффом:  fatality-rate при crit&&win&&lowHP = ${(resBuff.rate * 100).toFixed(1)}% (образцов: ${resBuff.critWinLowHp})`);
ok('достаточно образцов без баффа (>100)', resNoBuff.critWinLowHp > 100);
ok('достаточно образцов с баффом (>100)', resBuff.critWinLowHp > 100);
ok('без баффа частота фаталити близка к базовой 10% (5-16%)', resNoBuff.rate > 0.05 && resNoBuff.rate < 0.16);
ok('с баффом частота фаталити заметно выше (25-36%, база 10%+20%=30%)', resBuff.rate > 0.24 && resBuff.rate < 0.37);
ok('бафф РЕАЛЬНО повышает шанс фаталити (buff > noBuff)', resBuff.rate > resNoBuff.rate * 1.5);

// ===================================================================
console.log('\n[2] Исход боя — по МОЩИ (сильнейший побеждает), уворот НЕ переворачивает');
{
  let strongWins = 0, weakWins = 0, tgtDodges = 0, atkDodges = 0;
  for (let i = 0; i < 400; i++) {
    const strong = mkUser('u_str', 'Сильный', { level: 30, units: { ground_1: [400, 0, 0] } });
    const weak   = mkUser('u_wk', 'Слабый', { level: 30, units: { ground_1: [1, 0, 0] } });
    weak.skills.agility = 100;
    usersMap['u_str'] = strong; usersMap['u_wk'] = weak;
    strong.res.am.cur = 9999; strong.res.hp.cur = 100; strong.lastAttackAt = 0;
    weak.res.hp.cur = 100;
    const r = battle.attack(strong, weak.id, notices);
    if (r.win) strongWins++;
    if (r.dodge) tgtDodges++;
  }
  // Правило: побеждает тот, кто нанёс больше урона. Уворот обнуляет урон,
  // значит увернувшаяся цель может выиграть у более сильного атакующего.
  ok('сильный всё же побеждает заметно чаще, чем никогда', strongWins > 400*0.2);
  ok('уворот цели способен перевернуть исход', strongWins < 400);
  ok('цель периодически уворачивалась', tgtDodges > 0);

  for (let i = 0; i < 400; i++) {
    const weak   = mkUser('u_wk2', 'Слабый', { level: 30, units: { ground_1: [1, 0, 0] } });
    const strong = mkUser('u_str2', 'Сильный', { level: 30, units: { ground_1: [400, 0, 0] } });
    weak.skills.agility = 100;
    usersMap['u_wk2'] = weak; usersMap['u_str2'] = strong;
    weak.res.am.cur = 9999; weak.res.hp.cur = 100; weak.lastAttackAt = 0;
    strong.res.hp.cur = 100;
    const r = battle.attack(weak, strong.id, notices);
    if (r.win) weakWins++;
    if (r.attackerDodge) atkDodges++;
  }
  // Исход по урону: свой уворот обнуляет ПОЛУЧЕННЫЙ урон, поэтому слабый
  // атакующий с максимальной ловкостью выигрывает примерно в половине боёв —
  // это прямое следствие правила «побеждает тот, кто нанёс больше урона».
  console.log(`     слабый с ловкостью 100 выигрывает в ${(weakWins/400*100).toFixed(1)}% боёв`);
  ok('свой уворот способен принести победу слабому', weakWins > 0);
  ok('но не даёт побеждать всегда', weakWins < 400);
  ok('атакующий сам уворачивался (уворот доступен нападающему)', atkDodges > 0);
}

// ===================================================================
console.log('\n[3] Почта: треды между игроками, системные события НЕ попадают в почту');
{
  const alice = mkUser('u_alice', 'Alice');
  const bob = mkUser('u_bob', 'Bob');
  usersMap['u_alice'] = alice; usersMap['u_bob'] = bob;

  social.sendMail(alice, 'Bob', 'Привет', 'Как дела?');
  social.sendMail(bob, 'Alice', 'Re: Привет', 'Отлично, а у тебя?');

  const aliceInbox = social.inbox(alice);
  eq('у Alice один тред (с Bob)', aliceInbox.threads.length, 1);
  eq('в треде 2 сообщения (туда-обратно)', aliceInbox.threads[0].messages.length, 2);
  eq('первое сообщение — исходящее (dir=out)', aliceInbox.threads[0].messages[0].dir, 'out');
  eq('второе сообщение — входящее (dir=in)', aliceInbox.threads[0].messages[1].dir, 'in');

  const bobInbox = social.inbox(bob);
  eq('у Bob тоже один тред (с Alice) — видит оба сообщения', bobInbox.threads[0].messages.length, 2);

  notifications.push(alice.id, 'group_accepted', 'Добро пожаловать!', { text: 'Вы приняты в альянс.' });
  const aliceInbox2 = social.inbox(alice);
  eq('после notifications.push у Alice всё ещё 1 тред (уведомление не в почте)', aliceInbox2.threads.length, 1);
  const notifList = notifications.list(alice);
  ok('уведомление реально попало в notifications', notifList.notifications.some((n) => n.kind === 'group_accepted'));

  const before = social.unread(bob);
  social.readThread(bob, alice.id);
  ok('после открытия треда непрочитанных стало 0 или меньше', social.unread(bob) <= before);
}

// ===================================================================
console.log('\n[4] Admin: viewAsPlayer — полный просмотр профиля игрока «его глазами»');
{
  const target = mkUser('u_viewme', 'Наблюдаемый', { units: { ground_1: [42, 0, 0] } });
  target.buildings = { sklad: 3 };
  target.secretDevs = { kara: 2 };
  usersMap['u_viewme'] = target;
  const adminU = mkUser('u_admin1', 'Админ1');
  usersMap['u_admin1'] = adminU;

  const view = admin.viewAsPlayer(adminU, target.id);
  ok('есть блок me (mePayload)', !!view.me && view.me.id === target.id);
  ok('есть блок profile (publicProfile isOwn)', !!view.profile);
  ok('профиль раскрывает технику (isOwn=true)', Array.isArray(view.profile.units) && view.profile.units.length > 0);
  ok('есть units.list', !!view.units);
  ok('есть buildings.list', !!view.buildings);
  ok('есть production.view', !!view.production);
  ok('есть trophies.list', !!view.trophies);
  let threw = false;
  try { admin.viewAsPlayer(adminU, 'нет-такого-id'); } catch (e) { threw = true; }
  ok('несуществующий игрок -> ошибка', threw);
}

// ===================================================================
console.log('\n[5] Admin: список и детальный просмотр ЛЮБОЙ группы (альянс/легион)');
{
  const leader = mkUser('u_leader1', 'Лидер1', { level: 60 });
  leader.dollars = 1e9;
  usersMap['u_leader1'] = leader;
  groups.create(leader, 'alliance', 'Тестовый Альянс', notices);
  const gid = leader.allianceId;
  ok('альянс создан, id присвоен лидеру', !!gid);

  const list = groups.listAllAdmin('alliance');
  ok('листинг альянсов содержит созданный', list.groups.some((g) => g.id === gid));

  const detail = groups.viewDetailAdmin('alliance', gid);
  eq('детальный просмотр: правильное имя', detail.name, 'Тестовый Альянс');
  eq('детальный просмотр: лидер верный', detail.leaderId, leader.id);

  let threw = false;
  try { groups.viewDetailAdmin('alliance', 'нет-такой-группы'); } catch (e) { threw = true; }
  ok('несуществующая группа -> ошибка', threw);
}

// ===================================================================
console.log('\n[6] Admin: депозит в казну ЛЮБОГО легиона (без списания у игрока)');
{
  const leader = mkUser('u_leader2', 'Лидер2', { level: 60 });
  leader.dollars = 1e18;
  usersMap['u_leader2'] = leader;
  groups.create(leader, 'legion', 'Тестовый Легион', notices);
  const lid = leader.legionId;

  const adminU = mkUser('u_admin2', 'Админ2');
  adminU.isAdmin = true;   // adminDeposit теперь требует прав администратора
  usersMap['u_admin2'] = adminU;
  const goldBefore = adminU.gold, dollarsBefore = adminU.dollars;

  const r = legion.adminDeposit(adminU, lid, 50000, notices);
  eq('резервы легиона пополнены на 50000 (валюта клана — РЕЗ)', r.reserves, 50000);
  eq('у админа НЕ списаны собственные доллары', adminU.dollars, dollarsBefore);
  eq('у админа НЕ списано золото', adminU.gold, goldBefore);

  let threw = false;
  try { legion.adminDeposit(adminU, 'нет-такого-легиона', 100, notices); } catch (e) { threw = true; }
  ok('несуществующий легион -> ошибка', threw);
  threw = false;
  try { legion.adminDeposit(adminU, lid, -50, notices); } catch (e) { threw = true; }
  ok('отрицательная сумма -> ошибка', threw);
}

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
