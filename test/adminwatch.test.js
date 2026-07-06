// Тесты новых админ-инструментов:
//  (1) admin.playerSnapshot — полный снимок характеристик и имущества игрока;
//  (2) worldEvent.adminSetHp — регулировка текущего HP босса (с клампом).
// Запуск: npm run build && node test/adminwatch.test.js
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const admin = require('../dist/src/services/admin');
const worldEvent = require('../dist/src/services/worldEvent');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

const usersMap = db.load('users', {});
for (const k of Object.keys(usersMap)) delete usersMap[k];
const now = Date.now();

function mkUser(id, name, isAdmin) {
  return {
    id, name, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: !!isAdmin,
    emailVerified: true, country: 'ru', status: 'Готов к бою', createdAt: now, lastSeen: now,
    level: 25, xp: 1234, dollars: 5_000_000, gold: 4200, bank: 100000, skillPoints: 3,
    skills: { energy: 5, health: 8, ammo: 3, cruelty: 12, agility: 7 },
    res: { hp: { cur: 150, t: now }, en: { cur: 90, t: now }, am: { cur: 6, t: now } },
    units: { ground_1: { 0: 100, 1: 20, 2: 5 } },
    workshops: 0, modernQueue: [],
    buildings: { sklad: 3 },
    secretDevs: { kara: 4 }, superSecret: 1,
    ears: 15, tokens: 6, earsLost: 0, earsCurrent: c.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    earCutters: [null, null], earMessage: null,
    battle: { attacks: 50, wins: 30, losses: 20, defWins: 8, defLosses: 4, fatalities: 3 },
    counters: { wins: 30, attacks: 50, fatalities: 3, unitsBought: 0, buildingsBuilt: 0, missionStages: 7, earsCut: 5, moneyEarned: 0, battleLoot: 0, level: 25 },
    achStages: {}, missions: {}, tutorial: { step: 3, done: true }, effects: [],
    trophies: Object.assign(Object.fromEntries(c.TROPHIES.map((t) => [t.id, 0])), { medal: 3 }),
    club: {}, allianceId: null, legionId: null, lastIncomeAt: now,
    pendingFatality: null, lastChatAt: 0, trophyQueue: [],
    landmines: 4,
    saboteurs: { ground: 120, sea: 30, air: 0, secret: 15, building: 8, suicide: 2 },
    saboteurLimits: { ground: 90, sea: 50, air: 50, secret: 50, building: 50 },
    saboteurRareLossAccum: 0,
    silos: [{ readyEnergy: 0, powerAmmo: 0, buildFinishesAt: now }, { readyEnergy: 5, powerAmmo: 5, buildFinishesAt: now }],
    silosBuiltTotal: 2,
    allianceMembers: 4,
    loginStreak: 9, refCount: 2, seasonRating: 88,
  };
}

const adminU = mkUser('u_admin', 'Админ', true);
const hero = mkUser('u_hero', 'Диктатор', false);
usersMap['u_admin'] = adminU;
usersMap['u_hero'] = hero;
const notices = { push: () => {} };

console.log('\n[1] playerSnapshot: основное + ресурсы');
const s = admin.playerSnapshot(adminU, 'u_hero');
eq('имя', s.main.name, 'Диктатор');
eq('уровень', s.main.level, 25);
ok('ранг непустой', typeof s.main.rank === 'string' && s.main.rank.length > 0);
ok('рейтинг число', typeof s.main.rating === 'number');
eq('доллары', s.resources.dollars, 5_000_000);
eq('золото', s.resources.gold, 4200);
eq('банк', s.resources.bank, 100000);
eq('жетоны', s.resources.tokens, 6);
eq('очки навыков', s.resources.skillPoints, 3);
eq('трофейные уши', s.resources.earsTrophy, 15);
eq('мины (растяжки)', s.resources.landmines, 4);
eq('HP max посчитан (база 100 + здоровье 8×10)', s.resources.hp.max, 180);
ok('HP cur ≤ max', s.resources.hp.cur <= s.resources.hp.max);

console.log('\n[2] Навыки — все 5 с уровнями');
eq('навыков ровно 5', s.skills.length, 5);
eq('жестокость = 12', s.skills.find(x => x.id === 'cruelty').level, 12);
eq('ловкость = 7', s.skills.find(x => x.id === 'agility').level, 7);
ok('у навыка есть русское имя', /Жесток/.test(s.skills.find(x => x.id === 'cruelty').name));

console.log('\n[3] Мощь и боевая статистика');
ok('атака > 0', s.power.atk > 0);
ok('защита > 0', s.power.def > 0);
eq('всего техники (100+20+5)', s.power.armyTotal, 125);
eq('боёв атак', s.battle.attacks, 50);
eq('побед', s.battle.wins, 30);
eq('фаталити', s.battle.fatalities, 3);

console.log('\n[4] Армия / постройки / секретки / трофеи');
eq('позиций техники (3 Mk-слота)', s.army.length, 3);
eq('сумма техники по списку', s.army.reduce((a, x) => a + x.count, 0), 125);
eq('построек', s.buildings.length, 1);
eq('складов ×3', s.buildings.find(b => /клад|Склад/.test(b.name))?.count || s.buildings[0].count, 3);
ok('секретки включают супероружие', s.secretDevs.some(d => /Диктатор/.test(d.name)));
eq('трофеев прокачано', s.trophies.length, 1);
eq('уровень медали', s.trophies[0].level, 3);

console.log('\n[5] Диверсанты в снимке');
const sabGround = s.saboteurs.types.find(x => x.id === 'ground');
eq('наземных в наличии', sabGround.count, 120);
eq('лимит наземных', sabGround.limit, 90);
eq('работает наземных (min 120,90)', sabGround.active, 90);
eq('смертников', s.saboteurs.suicide, 2);
eq('лимит смертников', s.saboteurs.suicideLimit, 10);

console.log('\n[6] Прочее (ракеты, альянс, легион, extra)');
eq('ракетных шахт', s.silos, 2);
eq('членов альянса', s.allianceMembers, 4);
eq('легион (нет)', s.legion, null);
eq('серия входов', s.extra.loginStreak, 9);
eq('рефералов', s.extra.refCount, 2);

console.log('\n[7] Ошибка при несуществующем игроке');
let threw = false;
try { admin.playerSnapshot(adminU, 'no_such_id'); } catch (e) { threw = true; }
ok('брошено исключение', threw);

console.log('\n[8] Босс: регулировка текущего HP (adminSetHp)');
// Запускаем событие с HP=100000
worldEvent.adminStart(adminU, { name: 'Тест-босс', hp: 100000, goldPool: 50000 }, notices);
let v = worldEvent.view(adminU);
eq('событие активно', v.active, true);
eq('стартовый HP', v.hp, 100000);
eq('maxHp', v.maxHp, 100000);

// Понижаем HP до 30000
v = worldEvent.adminSetHp(adminU, { hp: 30000 }, notices);
eq('HP снижен до 30000', v.hp, 30000);
eq('maxHp не изменился', v.maxHp, 100000);
eq('процент HP = 30', v.hpPct, 30);

// Кламп сверху: выше maxHp нельзя
v = worldEvent.adminSetHp(adminU, { hp: 999999 }, notices);
eq('HP ограничен сверху maxHp', v.hp, 100000);

// Кламп снизу: ниже 0 нельзя
v = worldEvent.adminSetHp(adminU, { hp: -5000 }, notices);
eq('HP ограничен снизу нулём', v.hp, 0);

console.log('\n[9] adminSetHp без активного события — ошибка');
worldEvent.adminStop(adminU, notices);
let threw2 = false;
try { worldEvent.adminSetHp(adminU, { hp: 100 }, notices); } catch (e) { threw2 = true; }
ok('без события — исключение', threw2);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
