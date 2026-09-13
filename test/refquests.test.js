// ═══════════════════════════════════════════════════════════════════
// test/refquests.test.js — шкалы заданий приглашений
//
// Проверяется каждое условие ДЕЙСТВИЕМ: условие закрывается только
// тогда, когда игрок (или его друзья) действительно сделали то, что
// написано. Отдельно — что балл даёт награду ровно один раз и что
// наградой становится именно то, что обещано в конфиге.
//
// Доля с покупок: растёт по числу друзей, дошедших до 50 уровня.
//
// Запуск: node test/refquests.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
process.env.APP_URL = 'https://aliance-general.ru';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const features = require('../dist/src/services/features');
const rq = require('../dist/src/services/referralQuests');
const pa = require('../dist/src/services/personalAlliance');
const market = require('../dist/src/services/market');
const vip = require('../dist/src/services/vip');
const config = require('../dist/config/gameConfig');
const Q = config.REFERRAL_QUESTS;
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const fails = (fn, part, n) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};
const taskOf = (view, id) => view.tasks.find((t) => t.id === id);

(async () => {
  await db.init();
  const nx = [];
  let ip = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `rq${++ip}@t.ru`, 'ru', '10.0.21.' + ip);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 20; p.gold = 0; p.dollars = 0;
    return p;
  };
  const invite = async (boss, name) => {
    const p = await reg(name);
    features.applyReferral(p, features.ensureRefCode(boss), nx);
    p.gold = 0;
    return p;
  };
  const allies = (a, b) => { pa.invitePlayer(a, b.name, nx); pa.acceptInvite(b, a.id, nx); };

  console.log('\n[1] Шкала вербовщика: условия закрываются делом');
  const boss = await reg('Вербовщик');
  let v = rq.view(boss).inviter;
  ok(v.steps.length === 10 && v.tasks.length === 10, 'десять условий и десять наград');
  ok(v.points === 0, 'на старте баллов нет');
  const f1 = await invite(boss, 'Друг1');
  ok(rq.view(boss).inviter.points === 0, 'приглашённый новичок балла ещё не даёт');
  f1.level = 50;
  v = rq.view(boss).inviter;
  ok(taskOf(v, 'inv1').done === true && v.points === 1, 'друг дошёл до 50 уровня — первый балл');
  const f2 = await invite(boss, 'Друг2'), f3 = await invite(boss, 'Друг3');
  f2.level = 50; f3.level = 49;
  ok(taskOf(rq.view(boss).inviter, 'inv3').done === false, '49 уровень не считается');
  f3.level = 50;
  ok(taskOf(rq.view(boss).inviter, 'inv3').done === true, 'трое по 50 — второй балл');
  // Альянс: только взаимный
  pa.invitePlayer(boss, f1.name, nx);
  ok(taskOf(rq.view(boss).inviter, 'ally3').have === 0, 'одностороннее приглашение не считается');
  pa.acceptInvite(f1, boss.id, nx);
  allies(boss, f2); allies(boss, f3);
  ok(taskOf(rq.view(boss).inviter, 'ally3').done === true, 'трое вступили в альянс — балл');
  // Опыт друзей за неделю
  player.addXp(f1, 20000, nx);
  const xpTask = taskOf(rq.view(boss).inviter, 'xp15k');
  ok(xpTask.done === true, `опыт друзей за неделю засчитан: ${xpTask.rawHave}`);
  // Подкрепления именно друзьям
  const stranger = await reg('Чужак');
  allies(boss, stranger);
  const rein = require('../dist/src/services/reinforcements');
  rein.send(boss, stranger.id, nx);
  ok(taskOf(rq.view(boss).inviter, 'rein5').have === 0, 'подкрепление постороннему не считается');
  for (const f of [f1, f2, f3]) rein.send(boss, f.id, nx);
  ok(taskOf(rq.view(boss).inviter, 'rein5').have === 3, 'подкрепления друзьям посчитаны');
  // Показатели друзей
  f1.counters.missionStages = 30; f2.counters.missionStages = 25;
  ok(taskOf(rq.view(boss).inviter, 'mis50').done === true, 'шаги спецопераций друзей суммируются');
  f1.counters.battleLoot = 6e9; f2.counters.battleLoot = 5e9;
  ok(taskOf(rq.view(boss).inviter, 'loot10').done === true, 'награбленное друзьями суммируется');
  f1.counters.chatMessages = 60; f2.counters.chatMessages = 41;
  ok(taskOf(rq.view(boss).inviter, 'chat100').done === true, 'сообщения друзей суммируются');
  v = rq.view(boss).inviter;
  ok(v.points === 7, `набрано баллов: ${v.points} из 10 (осталось: 5 и 10 друзей, 5 подкреплений)`);

  // Ещё двое до 50 уровня закрывают «пригласить 5» — восьмой балл
  const f4 = await invite(boss, 'Друг4'), f5 = await invite(boss, 'Друг5');
  f4.level = 50; f5.level = 50;
  ok(rq.view(boss).inviter.points === 8, 'пятеро друзей по 50 уровню — восьмой балл');

  console.log('\n[2] Награды выдаются ровно за набранный балл');
  fails(() => rq.claim(boss, 'inviter', 9, nx), 'Нужно 9', 'за не набранный балл награду не дают');
  const goldBefore = boss.gold;
  rq.claim(boss, 'inviter', 1, nx);
  ok(boss.gold - goldBefore === Q.inviterRewards[0].gold, `1-й балл: +${boss.gold - goldBefore} золота`);
  fails(() => rq.claim(boss, 'inviter', 1, nx), 'уже получена', 'дважды одну награду не забрать');
  const dollarsBefore = boss.dollars;
  rq.claim(boss, 'inviter', 2, nx);
  ok(boss.dollars - dollarsBefore === Q.inviterRewards[1].dollars, '2-й балл: деньги начислены');
  rq.claim(boss, 'inviter', 3, nx);
  ok(market.ownedCount(boss, 1) === 5, '3-й балл: 5 контейнеров легли на склад');
  rq.claim(boss, 'inviter', 4, nx);
  ok(market.itemCount(boss, 'stim') === 3 && market.itemCount(boss, 'armor') === 3,
     '4-й балл: допинг на атаку и защиту по 3 шт.');
  rq.claim(boss, 'inviter', 7, nx);
  ok(vip.isVip(boss) && boss.vipUntil - Date.now() > 6.5 * 86400000, '7-й балл: VIP на 7 дней');
  rq.claim(boss, 'inviter', 8, nx);
  const mercs = (boss.effects || []).filter((e) => e.commanderId);
  ok(mercs.length === 2, `8-й балл: наняты оба наёмника (${mercs.map((m) => m.commanderId).join(', ')})`);
  ok(mercs.every((m) => m.expiresAt - Date.now() > 2.5 * 86400000), 'и оба на три дня');
  const claimedSteps = rq.view(boss).inviter.steps.filter((s) => s.claimed).length;
  ok(claimedSteps === 6, `забранных наград: ${claimedSteps}`);

  console.log('\n[3] Шкала новобранца');
  ok(rq.view(boss).newbie === undefined, 'тому, кто пришёл сам, шкала новобранца не показывается');
  const rookie = f1;
  let nv = rq.view(rookie).newbie;
  ok(!!nv && nv.tasks.length === 10, 'приглашённому шкала новобранца доступна');
  ok(taskOf(nv, 'lvl30').done === true && taskOf(nv, 'lvl70').done === false, 'уровни считаются по игроку');
  rookie.counters.chatMessages = 10;
  rookie.counters.questsDone = 10;
  rookie.counters.sanctionsMade = 5;
  rookie.tutorial = { step: 99, done: true };
  nv = rq.view(rookie).newbie;
  ok(taskOf(nv, 'chat10').done && taskOf(nv, 'quest10').done && taskOf(nv, 'sanc5').done && taskOf(nv, 'tutor').done,
     'чат, поручения, санкции и обучение засчитаны');
  ok(taskOf(nv, 'rein10').have === 0, 'подкрепления новичок ещё не слал');
  const gb = rookie.gold;
  rq.claim(rookie, 'newbie', 1, nx);
  ok(rookie.gold - gb === Q.newbieRewards[0].gold, `новобранцу за 1-й балл +${rookie.gold - gb} золота`);
  fails(() => rq.claim(boss, 'newbie', 1, nx), 'по приглашению', 'чужую шкалу не забрать');

  console.log('\n[4] Доля с покупок растёт от числа друзей');
  const seller = await reg('Инвестор');
  ok(rq.sharePctFor(seller) === config.REFERRAL.purchaseSharePct, `без друзей — базовые ${rq.sharePctFor(seller)}%`);
  const crowd = [];
  for (let i = 0; i < 10; i++) {
    const p = await invite(seller, 'Рекрут' + i);
    p.level = 70; crowd.push(p);
  }
  ok(rq.sharePctFor(seller) === 15, `десять друзей по 70 уровню — ${rq.sharePctFor(seller)}%`);
  crowd[0].level = 69; crowd[1].level = 69; crowd[2].level = 69; crowd[3].level = 69; crowd[4].level = 69;
  ok(rq.sharePctFor(seller) === 12, `пятеро не добрали до 70 — ${rq.sharePctFor(seller)}%`);
  // Выплата идёт по ВЫРОСШЕЙ доле, а не по базовой
  const rewards = require('../dist/src/services/rewards');
  features.onReferralPurchase(crowd[9], 1000);
  const letter = rewards.listFor(seller).filter((r) => !r.claimed).pop();
  ok(letter && letter.reward.gold === 120, `с покупки 1000 пришло ${letter && letter.reward.gold} золота (12%)`);
  ok(!/Рекрут/.test(letter.title + letter.reason), 'имя покупателя по-прежнему не раскрывается');
  const sv = rq.shareView(seller);
  ok(sv.pct === 12 && sv.next && sv.next.pct === 15, `следующая ступень: ${sv.next.pct}% за ${sv.next.left} друзей`);
  // Порог именно 70: на 50 уровне друг ещё не считается в долю, хотя
  // шкалу заданий он уже закрывает
  ok(sv.minLevel === 70 && sv.friendsReady === 5, `в долю идут друзья с ${sv.minLevel} уровня, их ${sv.friendsReady}`);
  crowd[0].level = 50;
  ok(rq.shareView(seller).friendsReady === 5, '50 уровня для доли мало');
  crowd[0].level = 70;
  ok(rq.shareView(seller).friendsReady === 6, 'а 70 — засчитано');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
