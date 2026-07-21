// Багфиксы:
// (2) Сезон: при смене недели награждается НАСТОЯЩИЙ топ-1, даже если он
//     сделал действие сразу после полуночи (ролловер идёт ДО сброса weekly).
// (3) Миссии: шаг спецоперации инкрементит user.counters.missionStages ПОШАГОВО
//     — иначе контракт «Пройди N шагов» не двигался бы.
// (4) Наёмник-дипломат (invite_unlimited) снимает почасовой лимит заявок в
//     ЛИЧНОМ альянсе (раньше проверка была только в groups.ts).
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const seasons = require('../dist/src/services/seasons');
const missions = require('../dist/src/services/missions');
const pa = require('../dist/src/services/personalAlliance');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();

  console.log('\n[2] Сезон: настоящий топ-1 награждается даже при действии после полуночи');
  await auth.register('Топ1', 'password1', 't1@a.com', 'ru', '1.1.1.1');
  await auth.register('Топ2', 'password1', 't2@a.com', 'ru', '1.1.1.2');
  await auth.register('Топ3', 'password1', 't3@a.com', 'ru', '1.1.1.3');
  const u1 = Object.values(player.users()).find(x => x.name === 'Топ1');
  const u2 = Object.values(player.users()).find(x => x.name === 'Топ2');
  const u3 = Object.values(player.users()).find(x => x.name === 'Топ3');

  // Устанавливаем ЗАВЕРШАЮЩУЮСЯ (прошлую) неделю в стор и статистику игроков за неё
  const store = db.load('weeklySeason', {});
  const OLD = '2020-01-06'; // заведомо прошлая неделя (≠ текущей)
  store.weekId = OLD;
  store.rewards = c.SEASON.rewards;
  store.lastWinners = {};
  // rating: топ1 > топ2 > топ3
  u1.weekly = { weekId: OLD, rating: 1000, wins: 50, ears: 0, mercy: 0, loot: 0, alliance: 0, missions: 0 };
  u2.weekly = { weekId: OLD, rating: 500,  wins: 30, ears: 0, mercy: 0, loot: 0, alliance: 0, missions: 0 };
  u3.weekly = { weekId: OLD, rating: 250,  wins: 10, ears: 0, mercy: 0, loot: 0, alliance: 0, missions: 0 };
  db.save('weeklySeason'); db.save('users');

  // СИМУЛЯЦИЯ БАГА: топ-1 делает действие сразу после смены недели.
  // Это дёргает ensureWeek → rolloverIfNeeded ДО обнуления weekly топ-1.
  seasons.onWin(u1);

  const winners = db.load('weeklySeason', {}).lastWinners;
  ok('снапшот победителей создан', winners && winners.rating && winners.rating.length >= 3);
  eq('топ-1 по рейтингу = настоящий Топ1', winners.rating[0].id, u1.id);
  eq('топ-2 по рейтингу = Топ2', winners.rating[1].id, u2.id);
  eq('топ-3 по рейтингу = Топ3', winners.rating[2].id, u3.id);
  eq('топ-1 по победам = Топ1', winners.wins[0].id, u1.id);
  // Награда реально начислена письмом топ-1
  const rewardsStore = db.load('rewards', {});
  const gotReward = Object.values(rewardsStore).some(r => r.userId === u1.id);
  ok('топ-1 получил письмо с наградой', gotReward);
  // weekly топ-1 после ролловера обнулён на новую неделю
  eq('weekly топ-1 обнулён на текущую неделю', u1.weekly.weekId, seasons.weekId());
  eq('рейтинг топ-1 в новой неделе учитывает его действие (+win)', u1.weekly.wins, 1);

  console.log('\n[3] Миссии: шаг инкрементит глобальный счётчик missionStages (для контрактов)');
  const conf = c.CONFLICTS[0];
  const beforeCounter = u2.counters.missionStages || 0;
  // Ставим готовый (завершённый по времени) шаг в очередь
  u2.missionProgress = { [conf.id]: { completed: 0, firstReward: false, ops: {} } };
  u2.missionQueue = [{ confId: conf.id, opIdx: 0, stepIdx: 0, finishesAt: Date.now() - 1000, xp: 10, money: 100 }];
  missions.checkCompleted(u2, []);
  eq('глобальный counters.missionStages +1 за шаг', u2.counters.missionStages, beforeCounter + 1);
  eq('прогресс шага операции записан', u2.missionProgress[conf.id].ops[0], 1);
  // Ещё один шаг — счётчик снова +1 (контракт увидит 2)
  u2.missionQueue = [{ confId: conf.id, opIdx: 0, stepIdx: 1, finishesAt: Date.now() - 1000, xp: 10, money: 100 }];
  missions.checkCompleted(u2, []);
  eq('после второго шага counters.missionStages = +2', u2.counters.missionStages, beforeCounter + 2);

  console.log('\n[4] Наёмник-дипломат снимает лимит заявок в личном альянсе');
  const rec = Object.values(player.users()).find(x => x.name === 'Топ3');
  rec.level = 100; // большой лимит альянса
  rec.allianceMembers = 0; rec.allianceRoster = []; rec.allianceDiplomats = 0;
  // Забиваем почасовой лимит заявок под завязку
  const limit = c && 5; // базовый лимит = 5 (INVITE_BASE_PER_HOUR)
  rec.allianceInviteLog = [];
  for (let i = 0; i < 5; i++) rec.allianceInviteLog.push(Date.now());
  rec.effects = [];
  db.save('users');
  throws('без наёмника: приём бота отклонён (лимит исчерпан)', () => pa.inviteBot(rec, []));

  // Нанимаем наёмника: эффект invite_unlimited на 24ч
  rec.effects = [{ id: 'cmd_envoy_invite_unlimited', name: 'Эйден Роу', type: 'invite_unlimited', value: 1, expiresAt: Date.now() + 24 * 3600 * 1000, merc: true }];
  const before = rec.allianceMembers;
  pa.inviteBot(rec, []);
  eq('с наёмником: бот принят несмотря на лимит', rec.allianceMembers, before + 1);
  // И ещё несколько — лимит игнорируется
  pa.inviteBot(rec, []); pa.inviteBot(rec, []);
  eq('с наёмником можно принимать сверх лимита', rec.allianceMembers, before + 3);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
