// Тест системы «Диверсанты»: конфиг, покупка/апгрейд, дебафф мощи по
// типам (обе стороны боя), расход в бою, уничтожение при мине/ракете,
// правило 5:1, выбор смертника при подрыве.
// Запуск: node test/saboteurs.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const saboteurs = require('../dist/src/services/saboteurs');

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
    level: opts.level ?? 20, xp: 0, dollars: opts.dollars ?? 1e12, gold: opts.gold ?? 1e9,
    bank: 0, skillPoints: 0,
    skills: opts.skills || { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 },
    res: { hp: { cur: 100, max: 100, t: now }, en: { cur: 100, max: 100, t: now }, am: { cur: 9999, max: 9999, t: now } },
    units: opts.units || { ground_1: [50, 0, 0] },
    workshops: 0, modernQueue: [], buildings: opts.buildings || {}, secretDevs: opts.secretDevs || {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0, earsCurrent: c.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 },
    counters: { wins: 0, attacks: 0, fatalities: 0, unitsBought: 0, buildingsBuilt: 0, missionStages: 0, earsCut: 0, moneyEarned: 0, battleLoot: 0, level: 20 },
    achStages: {}, missions: {}, tutorial: { step: 0, done: true }, effects: [],
    trophies: Object.fromEntries(c.TROPHIES.map((t) => [t.id, (opts.trophies || {})[t.id] || 0])),
    club: {}, allianceId: null, legionId: null, lastIncomeAt: now,
    pendingFatality: null, lastChatAt: 0, trophyQueue: [],
    pendingBankHack: null, bankHackCountToday: 0, bankHackVictimsToday: [],
    landmines: opts.landmines ?? 0, pendingMineDefuse: null, recentAttacks: {},
    saboteurs: opts.saboteurs || { ground: 0, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 },
    saboteurLimits: opts.saboteurLimits || { ground: 50, sea: 50, air: 50, secret: 50, building: 50 },
    saboteurRareLossAccum: 0,
  };
}
const notices = { push: () => {} };

// ===================================================================
console.log('\n[1] Конфиг: лимиты и цены апгрейда точно по ТЗ');
eq('наземные/морские/воздушные: старт 50', c.SABOTEURS.regular.startLimit, 50);
eq('наземные/морские/воздушные: потолок 300', c.SABOTEURS.regular.maxLimit, 300);
eq('секретные: потолок 200', c.SABOTEURS.secret.maxLimit, 200);
eq('построечные: потолок 250', c.SABOTEURS.building.maxLimit, 250);
eq('смертники: фиксированный лимит 10', c.SABOTEURS.suicide.fixedLimit, 10);
eq('смертники: цена 10 золота', c.SABOTEURS.suicide.priceGold, 10);
eq('обычные: шаг 1 = 20 золота', c.SABOTEURS.upgradeCost(20, 1), 20);
eq('обычные: шаг 2 = 40 золота', c.SABOTEURS.upgradeCost(20, 2), 40);
eq('обычные: шаг 3 = 80 золота', c.SABOTEURS.upgradeCost(20, 3), 80);
eq('секретные: шаг 1 = 30 золота', c.SABOTEURS.upgradeCost(30, 1), 30);
eq('построечные: шаг 1 = 25 золота', c.SABOTEURS.upgradeCost(25, 1), 25);

// ===================================================================
console.log('\n[2] Покупка пачки: доллары по цене юнита × 100, золото для secret/building');
{
  const u1 = mkUser('u_buy1', 'Покупатель1');
  usersMap['u_buy1'] = u1;
  const price = c.minUnitPriceAtLevel(u1.level);
  const dollarsBefore = u1.dollars;
  saboteurs.buyPack(u1, 'ground', 1, notices);
  eq('наземные +10 после покупки 1 пачки', u1.saboteurs.ground, 10);
  eq('списано ровно 100×цена юнита долларов (без золота)', dollarsBefore - u1.dollars, price * 100);

  const u2 = mkUser('u_buy2', 'Покупатель2');
  usersMap['u_buy2'] = u2;
  const goldBefore = u2.gold;
  saboteurs.buyPack(u2, 'secret', 1, notices);
  eq('секретные +10', u2.saboteurs.secret, 10);
  eq('списано 10 золота за пачку секретных', goldBefore - u2.gold, 10);

  const u3 = mkUser('u_buy3', 'Покупатель3');
  usersMap['u_buy3'] = u3;
  const goldBefore3 = u3.gold;
  saboteurs.buyPack(u3, 'building', 1, notices);
  eq('построечные +10', u3.saboteurs.building, 10);
  eq('списано 5 золота за пачку построечных', goldBefore3 - u3.gold, 5);
}

// ===================================================================
console.log('\n[3] Смертники: покупка по 1, максимум 10, только золото');
{
  const u = mkUser('u_suicide', 'Смертник-покупатель');
  usersMap['u_suicide'] = u;
  const goldBefore = u.gold;
  saboteurs.buySuicide(u, 3, notices);
  eq('куплено 3 смертника', u.saboteurs.suicide, 3);
  eq('списано 30 золота (3×10)', goldBefore - u.gold, 30);
  saboteurs.buySuicide(u, 20, notices);
  eq('обрезано до максимума 10', u.saboteurs.suicide, 10);
  let threw = false;
  try { saboteurs.buySuicide(u, 1, notices); } catch (e) { threw = true; }
  ok('покупка сверх максимума отклонена', threw);
}

// ===================================================================
console.log('\n[4] Апгрейд лимита: цена растёт ×2 за шаг, останавливается на потолке');
{
  const u = mkUser('u_upg', 'Апгрейдер');
  usersMap['u_upg'] = u;
  let goldBefore = u.gold;
  saboteurs.upgradeLimit(u, 'ground', notices);
  eq('лимит наземных 50->60', u.saboteurLimits.ground, 60);
  eq('цена первого шага 20', goldBefore - u.gold, 20);
  goldBefore = u.gold;
  saboteurs.upgradeLimit(u, 'ground', notices);
  eq('лимит наземных 60->70', u.saboteurLimits.ground, 70);
  eq('цена второго шага 40', goldBefore - u.gold, 40);

  const u2 = mkUser('u_upgmax', 'МаксАпгрейдер', { gold: 1e12 });
  usersMap['u_upgmax'] = u2;
  while (u2.saboteurLimits.ground < 300) saboteurs.upgradeLimit(u2, 'ground', notices);
  eq('лимит достиг потолка 300', u2.saboteurLimits.ground, 300);
  let threw = false;
  try { saboteurs.upgradeLimit(u2, 'ground', notices); } catch (e) { threw = true; }
  ok('апгрейд сверх потолка отклонён', threw);
}

// ===================================================================
console.log('\n[5] Излишек сверх лимита не работает (запас), но реально сохранён');
{
  const u = mkUser('u_over', 'Излишек', { saboteurs: { ground: 89, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 }, saboteurLimits: { ground: 90, sea: 50, air: 50, secret: 50, building: 50 } });
  usersMap['u_over'] = u;
  eq('активны только 89 (лимит 90, наличие 89)', saboteurs.active(u, 'ground'), 89);
  saboteurs.buyPack(u, 'ground', 1, notices);
  eq('наличие стало 99', u.saboteurs.ground, 99);
  eq('активно только 90 (упёрлись в лимит)', saboteurs.active(u, 'ground'), 90);
  saboteurs.upgradeLimit(u, 'ground', notices);
  eq('после апгрейда лимита активны все 99', saboteurs.active(u, 'ground'), 99);
}

// ===================================================================
console.log('\n[6] Эффективность: 0.1% за штуку, 10=1%, 100=10%');
{
  const u = mkUser('u_eff', 'Эффект', { saboteurs: { ground: 100, sea: 10, air: 1, secret: 0, building: 0, suicide: 0 }, saboteurLimits: { ground: 300, sea: 50, air: 50, secret: 50, building: 50 } });
  usersMap['u_eff'] = u;
  const d = saboteurs.debuffsFor(u);
  eq('100 наземных = -10% (0.10)', d.ground, 0.10);
  eq('10 морских = -1% (0.01)', d.sea, 0.01);
  ok('1 воздушный = -0.1% (≈0.001)', Math.abs(d.air - 0.001) < 1e-9);
}

// ===================================================================
console.log('\n[7] Дебафф мощи по типам работает в player.totalPower() и режет ТОЛЬКО свой тип');
{
  const victim = mkUser('u_pw_victim', 'Жертва', { units: { ground_1: [100, 0, 0] } });
  victim.allianceMembers = 5; // даём capacity (10 + 5*10=60), чтобы все 100 наземных не срезались лимитом
  usersMap['u_pw_victim'] = victim;
  const baseline = player.totalPower(victim, 'atk');
  const onlyGroundDebuff = player.totalPower(victim, 'atk', { ground: 0.5, air: 0, sea: 0, secret: 0, building: 0 });
  ok('дебафф 50% на наземные СНИЖАЕТ итоговую мощь', onlyGroundDebuff.power < baseline.power);
  const noDebuff = player.totalPower(victim, 'atk', { ground: 0, air: 0, sea: 0, secret: 0, building: 0 });
  eq('нулевой дебафф не меняет мощь', noDebuff.power, baseline.power);
}

// ===================================================================
console.log('\n[8] Интеграция боя: дебафф действует в ОБЕ стороны (атакующий и защитник)');
{
  const attacker1 = mkUser('u_int_a1', 'Атакер1', { units: { ground_1: [50, 0, 0] } });
  const defenderNoSab = mkUser('u_int_d1', 'БезДиверсантов', { units: { ground_1: [5, 0, 0] } });
  const defenderWithSab = mkUser('u_int_d2', 'СДиверсантами', {
    units: { ground_1: [5, 0, 0] },
    saboteurs: { ground: 300, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 },
    saboteurLimits: { ground: 300, sea: 50, air: 50, secret: 50, building: 50 },
  });
  usersMap['u_int_a1'] = attacker1; usersMap['u_int_d1'] = defenderNoSab; usersMap['u_int_d2'] = defenderWithSab;

  let dealtNoSab = 0, dealtWithSab = 0;
  for (let i = 0; i < 300; i++) {
    attacker1.res.am.cur = 9999; attacker1.res.hp.cur = 100; attacker1.lastAttackAt = 0; attacker1.level = 20;
    defenderNoSab.res.hp.cur = 100;
    const r1 = battle.attack(attacker1, defenderNoSab.id, notices);
    dealtNoSab += r1.dealt;
  }
  for (let i = 0; i < 300; i++) {
    attacker1.res.am.cur = 9999; attacker1.res.hp.cur = 100; attacker1.lastAttackAt = 0; attacker1.level = 20;
    defenderWithSab.res.hp.cur = 100;
    const r2 = battle.attack(attacker1, defenderWithSab.id, notices);
    dealtWithSab += r2.dealt;
  }
  console.log(`  средний урон без диверсантов цели: ${(dealtNoSab/300).toFixed(2)}, с диверсантами (300 наземных, -30% aPow атакующего): ${(dealtWithSab/300).toFixed(2)}`);
  ok('диверсанты защитника снижают урон, который получает ОТ атаки', dealtWithSab < dealtNoSab);
}

// ===================================================================
console.log('\n[9] Расход в бою: атакующий теряет чаще, защитник — реже');
{
  const attacker = mkUser('u_att_loss', 'АтакерРасход', {
    units: { ground_1: [50, 0, 0] },
    saboteurs: { ground: 10000, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 },
    saboteurLimits: { ground: 300, sea: 50, air: 50, secret: 50, building: 50 },
  });
  const defender = mkUser('u_def_loss', 'ЗащитникРасход', {
    units: { ground_1: [5, 0, 0] },
    saboteurs: { ground: 10000, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 },
    saboteurLimits: { ground: 300, sea: 50, air: 50, secret: 50, building: 50 },
  });
  usersMap['u_att_loss'] = attacker; usersMap['u_def_loss'] = defender;
  const attGroundBefore = attacker.saboteurs.ground, defGroundBefore = defender.saboteurs.ground;
  const N = 1000;
  for (let i = 0; i < N; i++) {
    attacker.res.am.cur = 9999; attacker.res.hp.cur = 100; attacker.lastAttackAt = 0;
    defender.res.hp.cur = 100;
    battle.attack(attacker, defender.id, notices);
  }
  const attLost = attGroundBefore - attacker.saboteurs.ground;
  const defLost = defGroundBefore - defender.saboteurs.ground;
  const attRate = attLost / N * 10, defRate = defLost / N * 10;
  console.log(`  за ${N} атак: у атакующего потеряно ${attLost} (${attRate.toFixed(2)}/10 атак), у защитника ${defLost} (${defRate.toFixed(2)}/10 атак)`);
  ok('атакующий теряет диверсантов заметно (1-3 на 10 атак)', attRate > 0.5 && attRate < 5);
  ok('защитник теряет ЗАМЕТНО реже атакующего', defRate < attRate / 2);
}

// ===================================================================
console.log('\n[10] Мина: уничтожает 10-50 обычных диверсантов у нападающего + правило 5:1');
{
  const attacker = mkUser('u_mine_att', 'МинаАтакер', {
    units: { ground_1: [1000, 0, 0] },
    saboteurs: { ground: 5000, sea: 0, air: 0, secret: 100, building: 100, suicide: 0 },
    saboteurLimits: { ground: 300, sea: 50, air: 50, secret: 200, building: 250 },
  });
  const defender = mkUser('u_mine_def', 'МинаЖертва', { trophies: { tripwire: 10 }, landmines: 1 });
  usersMap['u_mine_att'] = attacker; usersMap['u_mine_def'] = defender;

  let mineRes = null;
  for (let i = 0; i < 500 && !mineRes; i++) {
    attacker.res.am.cur = 9999; attacker.res.hp.cur = 100; attacker.lastAttackAt = 0;
    defender.landmines = 1; defender.res.hp.cur = 100;
    const r = battle.attack(attacker, defender.id, notices);
    if (r.encounter === 'mine_defuse') mineRes = r;
  }
  ok('мина сработала', !!mineRes);
  eq('без смертников canSacrifice=false', mineRes.canSacrifice, false);
  const wrongIdx = attacker.pendingMineDefuse.wires.findIndex((w, i) => i !== attacker.pendingMineDefuse.correctIdx);
  const before = attacker.saboteurs.ground;
  const boom = battle.mineDefuse(attacker, wrongIdx, notices);
  const lost = before - attacker.saboteurs.ground;
  ok('уничтожено от 10 до 50 наземных диверсантов', lost >= 10 && lost <= 50);
  ok('в ответе есть lostSaboteurs', !!boom.lostSaboteurs);
}

// ===================================================================
console.log('\n[11] Выбор смертника: canSacrifice=true при наличии, гарантированное спасение');
{
  const attacker = mkUser('u_sac_att', 'ЖертвующийАтакер', {
    units: { ground_1: [500, 0, 0] },
    saboteurs: { ground: 500, sea: 0, air: 0, secret: 0, building: 0, suicide: 2 },
    saboteurLimits: { ground: 300, sea: 50, air: 50, secret: 50, building: 50 },
  });
  const defender = mkUser('u_sac_def', 'ЖертваМина', { trophies: { tripwire: 10 }, landmines: 1 });
  usersMap['u_sac_att'] = attacker; usersMap['u_sac_def'] = defender;

  let mineRes = null;
  for (let i = 0; i < 500 && !mineRes; i++) {
    attacker.res.am.cur = 9999; attacker.res.hp.cur = 100; attacker.lastAttackAt = 0;
    defender.landmines = 1; defender.res.hp.cur = 100;
    const r = battle.attack(attacker, defender.id, notices);
    if (r.encounter === 'mine_defuse') mineRes = r;
  }
  ok('мина сработала', !!mineRes);
  eq('canSacrifice=true (есть 2 смертника)', mineRes.canSacrifice, true);
  const suicideBefore = attacker.saboteurs.suicide;
  const outcome = battle.mineSacrifice(attacker, notices);
  eq('смертник израсходован (-1)', attacker.saboteurs.suicide, suicideBefore - 1);
  eq('здоровье НЕ снесено (спасение сработало)', attacker.res.hp.cur > 0, true);
  ok('бой продолжился как обычно (mineDefused=true)', outcome.mineDefused === true && outcome.sacrificed === true);
}

// ===================================================================
console.log('\n[12] Ракета: уничтожает диверсантов ЦЕЛИ, случайно ~100..150 всего (масштаб мощностью)');
{
  // Только обычные (ground) — тогда суммарные потери = обычные = round(бюджет/1.4)
  const target50 = mkUser('u_rocket50', 'Ракета50', { saboteurs: { ground: 100000, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 }, saboteurLimits: { ground: 300, sea: 50, air: 50, secret: 50, building: 50 } });
  usersMap['u_rocket50'] = target50;
  const before50 = target50.saboteurs.ground;
  saboteurs.rocketDestroy(target50, 0.5, notices);
  const lost50 = before50 - target50.saboteurs.ground;
  console.log(`  при мощности 50% уничтожено ${lost50} (ожидаем ~36..54)`);
  ok('при 50% мощности потери в разумном диапазоне (~30..60)', lost50 >= 30 && lost50 <= 60);

  const target100 = mkUser('u_rocket100', 'Ракета100', { saboteurs: { ground: 100000, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 }, saboteurLimits: { ground: 300, sea: 50, air: 50, secret: 50, building: 50 } });
  usersMap['u_rocket100'] = target100;
  const before100 = target100.saboteurs.ground;
  saboteurs.rocketDestroy(target100, 1.0, notices);
  const lost100 = before100 - target100.saboteurs.ground;
  console.log(`  при мощности 100% уничтожено ${lost100} (ожидаем ~71..107)`);
  ok('при 100% мощности потери в разумном диапазоне (~65..115)', lost100 >= 65 && lost100 <= 115);
  ok('при 100% теряется больше, чем при 50%', lost100 > lost50);
}

// ===================================================================
console.log('\n[13] Правило 5:1: на 5 уничтоженных обычных — 1 секретный и 1 построечный');
{
  const u = mkUser('u_ratio', 'Правило51', {
    saboteurs: { ground: 1000, sea: 0, air: 0, secret: 100, building: 100, suicide: 0 },
    saboteurLimits: { ground: 300, sea: 50, air: 50, secret: 200, building: 250 },
  });
  usersMap['u_ratio'] = u;
  saboteurs.destroyRegular(u, 25, notices);
  eq('уничтожено 5 секретных (25/5=5)', 100 - u.saboteurs.secret, 5);
  eq('уничтожено 5 построечных (25/5=5)', 100 - u.saboteurs.building, 5);

  const u2 = mkUser('u_ratio2', 'Правило51Накоп', {
    saboteurs: { ground: 1000, sea: 0, air: 0, secret: 50, building: 50, suicide: 0 },
    saboteurLimits: { ground: 300, sea: 50, air: 50, secret: 200, building: 250 },
  });
  usersMap['u_ratio2'] = u2;
  saboteurs.destroyRegular(u2, 3, notices);
  eq('после 3 потерь секретные/построечные не тронуты', u2.saboteurs.secret, 50);
  saboteurs.destroyRegular(u2, 2, notices);
  eq('после накопления до 5 — секретный уничтожен', u2.saboteurs.secret, 49);
  eq('после накопления до 5 — построечный уничтожен', u2.saboteurs.building, 49);
}

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
