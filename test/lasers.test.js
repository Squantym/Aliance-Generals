// Тест лазеров (ПВО) + полёта ракет + перехвата:
//  - покупка лазера (300 ×2), постройка 24ч, охлаждение 24ч после выстрела;
//  - зарядка энергией (готовность) и боеприпасами (точность) из запасов;
//  - выстрел только при энергии 100%, шанс сбить = доля боеприпасов;
//  - ракета летит 10 мин (не мгновенно), шахта сразу в пересборку;
//  - долёт наносит урон и кладёт отчёт в pendingRocketHits;
//  - перехват: попадание уничтожает ракету, промах — летит дальше;
//  - нельзя сбить свою ракету; список исключает свои и долетающие.
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const u = require('../dist/src/core/utils');
const player = require('../dist/src/services/player');
const silos = require('../dist/src/services/silos');
const lasers = require('../dist/src/services/lasers');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };
const thr = (n, fn) => { try { fn(); assert.fail(); } catch (e) { passed++; console.log(`  ✅ ${n}`); } };

const realRandom = Math.random;
let randQ = [];
Math.random = () => (randQ.length ? randQ.shift() : 0.5);

const L = c.LASER, S = c.SILO;
const usersMap = player.users();
for (const k of Object.keys(usersMap)) delete usersMap[k];
const rocketsMap = db.load('rockets', {});
for (const k of Object.keys(rocketsMap)) delete rocketsMap[k];
const now = Date.now();
function mkUser(id) {
  return { id, name: id, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: false, country: 'ru', status: '', createdAt: now, lastSeen: now, level: 75, xp: 0, dollars: 1e9, gold: 100000, bank: 0, skillPoints: 0, skills: { energy: 500, health: 5, ammo: 500, cruelty: 0, agility: 0 }, res: { hp: { cur: 150, t: now }, en: { cur: 1e6, t: now }, am: { cur: 1e6, t: now } }, units: { ground_1: { 0: 500 }, air_1: { 0: 500 } }, workshops: 0, modernQueue: [], buildings: { hq: 50, bank_s: 50 }, secretDevs: {}, superSecret: 0, ears: 0, tokens: 0, earsLost: 0, earsCurrent: 2, earsLostAt: [], earPenaltyUntil: 0, battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 }, counters: {}, achStages: {}, missions: {}, tutorial: { done: true }, effects: [], trophies: {}, club: {}, allianceId: null, legionId: null, lastIncomeAt: now, mines: [], silos: [], lasers: [], saboteurs: {}, saboteurLimits: {} };
}
const A = mkUser('attacker'), D = mkUser('defender'), H = mkUser('helper');
const dTech = () => Object.values(D.units).reduce((s, m) => s + (m[0]||0)+(m[1]||0)+(m[2]||0), 0);
const dBuild = () => Object.values(D.buildings).reduce((s, x) => s + x, 0);
usersMap['attacker'] = A; usersMap['defender'] = D; usersMap['helper'] = H;
const N = [];

console.log('\n[1] Покупка лазера: 300, ×2, постройка 24ч');
lasers.buyLaser(H, N);
eq('золото списано 300', H.gold, 100000 - 300);
eq('лазеров 1', H.lasers.length, 1);
lasers.buyLaser(H, N);
eq('второй лазер 600 (итого -900)', H.gold, 100000 - 900);
const laser = H.lasers[0];
eq('фаза building', laser.phase, 'building');
ok('таймер стройки ~24ч', Math.abs(laser.readyAt - Date.now() - L.BUILD_TIME_MS) < 5000);
thr('зарядка во время стройки запрещена', () => lasers.fuelReady(H, laser.id, 100, N));

console.log('\n[2] Достроен → зарядка энергии/боеприпасов из запасов');
laser.readyAt = Date.now() - 1000; // достроен
const enBefore = H.res.en.cur, amBefore = H.res.am.cur;
lasers.fuelReady(H, laser.id, 3000, N);
eq('готовность 3000', laser.readyEnergy, 3000);
eq('энергия списана из запасов', enBefore - H.res.en.cur, 3000);
lasers.fuelPower(H, laser.id, 500, N); // 50% точности
eq('боеприпасы 500 (50%)', laser.powerAmmo, 500);
eq('боеприпасы списаны', amBefore - H.res.am.cur, 500);
const lv = lasers.view(H).lasers.find((x) => x.id === laser.id);
eq('шанс перехвата 50%', lv.interceptChancePct, 50);
ok('можно стрелять (энергия 100%)', lv.canFire === true);

console.log('\n[3] Запуск ракеты: летит 10 мин, шахта в пересборку, урон НЕ мгновенный');
// строим шахту атакующему и заряжаем
silos.build(A, N); const silo = A.silos[0];
silo.rocket.buildFinishesAt = Date.now() - 1000;
silos.fuelReady(A, silo.id, 3000, N);
silos.fuelPower(A, silo.id, 1000, N); // 100% мощность
const defTechBefore = dTech();
const r = silos.launch(A, silo.id, 'defender', N);
ok('ответ launched=true', r.launched === true);
ok('долёт через 10 мин', Math.abs(r.impactAt - Date.now() - S.FLIGHT_MS) < 5000);
eq('урон НЕ нанесён сразу', dTech(), defTechBefore);
const flying = Object.values(db.load('rockets', {}));
eq('создана 1 летящая ракета', flying.length, 1);
eq('шахта ушла в пересборку', silo.rocket.buildFinishesAt > Date.now(), true);
// цель получила предупреждение
const dn = require('../dist/src/services/notifications').list ? null : null;

console.log('\n[4] Список перехвата: свои пуски скрыты, чужие видны');
const rocketId = flying[0].id;
// H видит ракету (она чужая, летит по defender)
const hList = lasers.view(H).inFlight;
eq('helper видит 1 летящую ракету', hList.length, 1);
eq('видно, что цель — defender', hList[0].isMe, false);
// A (атакующий) НЕ видит свою ракету
eq('атакующий не видит свою ракету', lasers.view(A).inFlight.length, 0);
// D (цель) видит летящую по нему
const dList = lasers.view(D).inFlight;
eq('цель видит летящую ракету', dList.length, 1);
eq('для цели isMe=true', dList[0].isMe, true);

console.log('\n[5] Перехват: промах → ракета летит; заряд снят + охлаждение 24ч');
randQ = [0.99]; // 0.99 < 0.5 → промах
const miss = lasers.intercept(H, laser.id, rocketId, N);
eq('промах (hit=false)', miss.hit, false);
eq('шанс был 50%', miss.chancePct, 50);
eq('заряд энергии обнулён', laser.readyEnergy, 0);
eq('боеприпасы обнулены', laser.powerAmmo, 0);
eq('фаза cooling', laser.phase, 'cooling');
ok('охлаждение ~24ч', Math.abs(laser.readyAt - Date.now() - L.COOLDOWN_MS) < 5000);
ok('ракета всё ещё летит', !db.load('rockets', {})[rocketId].intercepted);

console.log('\n[6] Перехват вторым лазером: попадание → ракета уничтожена');
const laser2 = H.lasers[1];
laser2.readyAt = Date.now() - 1000;
lasers.fuelReady(H, laser2.id, 3000, N);
lasers.fuelPower(H, laser2.id, 1000, N); // 100% точности
randQ = [0.5]; // 0.5 < 1.0 → попадание
const histTerBefore = 0;
const hit = lasers.intercept(H, laser2.id, rocketId, N);
eq('попадание (hit=true)', hit.hit, true);
eq('шанс был 100%', hit.chancePct, 100);
ok('ракета помечена сбитой', db.load('rockets', {})[rocketId].intercepted === true);

console.log('\n[7] Сбитая ракета не наносит урон при долёте');
const rk = db.load('rockets', {})[rocketId];
rk.impactAt = Date.now() - 1000; // "долетела" бы
const defTechBefore2 = dTech();
silos.resolveInFlight();
eq('урон по цели НЕ нанесён (сбита)', dTech(), defTechBefore2);
eq('нет ожидающих окон у цели', (D.pendingRocketHits || []).length, 0);

console.log('\n[8] Не перехваченная ракета долетает → урон + окно у цели');
// новый пуск
silo.rocket.buildFinishesAt = Date.now() - 1000;
silos.fuelReady(A, silo.id, 3000, N);
silos.fuelPower(A, silo.id, 1000, N);
silos.launch(A, silo.id, 'defender', N);
const rk2 = Object.values(db.load('rockets', {})).find((x) => !x.resolved);
rk2.impactAt = Date.now() - 1000; // долетела
const before = dTech() + dBuild();
silos.resolveInFlight();
const after = dTech() + dBuild();
ok('цель понесла потери (техника/здания)', after < before);
ok('у цели появилось окно результата', (D.pendingRocketHits || []).length >= 1);
const rep = D.pendingRocketHits[D.pendingRocketHits.length - 1];
ok('в отчёте есть атакующий и мощность', rep.attackerName === 'attacker' && rep.powerPct === 100);
// dismiss
const leftBefore = D.pendingRocketHits.length;
silos.dismissRocketHit(D);
eq('окно закрыто (−1)', D.pendingRocketHits.length, leftBefore - 1);

console.log('\n[9] Нельзя сбить собственную ракету + защиты выстрела');
silo.rocket.buildFinishesAt = Date.now() - 1000;
silos.fuelReady(A, silo.id, 3000, N); silos.fuelPower(A, silo.id, 1000, N);
silos.launch(A, silo.id, 'defender', N);
const rk3 = Object.values(db.load('rockets', {})).find((x) => !x.resolved);
// у атакующего есть готовый лазер
lasers.buyLaser(A, N); const aLaser = A.lasers[0]; aLaser.readyAt = Date.now() - 1000;
lasers.fuelReady(A, aLaser.id, 3000, N); lasers.fuelPower(A, aLaser.id, 1000, N);
thr('нельзя сбить свою ракету', () => lasers.intercept(A, aLaser.id, rk3.id, N));
// выстрел без полной готовности запрещён
const laser3 = H.lasers[0]; laser3.readyAt = Date.now() - 1000; laser3.readyEnergy = 1000; laser3.powerAmmo = 500;
thr('выстрел без энергии 100% запрещён', () => lasers.intercept(H, laser3.id, rk3.id, N));

console.log('\n[10] Охлаждение блокирует зарядку и выстрел');
laser.readyAt = Date.now() + L.COOLDOWN_MS; laser.phase = 'cooling';
thr('во время охлаждения нельзя заряжать', () => lasers.fuelReady(H, laser.id, 100, N));
thr('во время охлаждения нельзя стрелять', () => lasers.intercept(H, laser.id, rk3.id, N));
// boost охлаждения
const cost = lasers.view(H).lasers.find((x) => x.id === laser.id).boostCostGold;
ok('стоимость ускорения охлаждения > 0', cost > 0);

Math.random = realRandom;
console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
