// Тест индикатора «онлайн» (зелёная точка): реальные игроки в легион-бою
// и публичный профиль. Онлайн = активность за последние 5 минут по lastSeen.
// Запуск: node test/online.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const player = require('../dist/src/services/player');
const legionBattle = require('../dist/src/services/legionBattle');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

const usersMap = db.load('users', {});
for (const k of Object.keys(usersMap)) delete usersMap[k];
const legionsMap = db.load('legions', {});
for (const k of Object.keys(legionsMap)) delete legionsMap[k];
const battlesMap = db.load('battles', {});
for (const k of Object.keys(battlesMap)) delete battlesMap[k];

const now = Date.now();
const FRESH = now - 30 * 1000;          // 30 сек назад — онлайн
const STALE = now - 10 * 60 * 1000;     // 10 мин назад — офлайн

function mkUser(id, name, lastSeen) {
  return {
    id, name, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: false,
    emailVerified: true, country: 'ru', status: '', createdAt: now - 1e6, lastSeen,
    level: 20, xp: 0, dollars: 0, gold: 0, bank: 0, skillPoints: 0,
    skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 },
    res: { hp: { cur: 100, max: 100, t: now }, en: { cur: 50, max: 100, t: now }, am: { cur: 7, max: 100, t: now } },
    units: {}, workshops: 0, modernQueue: [], buildings: {}, secretDevs: {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0, earsCurrent: c.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 },
    counters: {}, achStages: {}, missions: {}, tutorial: { step: 0, done: true }, effects: [],
    trophies: Object.fromEntries(c.TROPHIES.map((t) => [t.id, 0])),
    club: {}, allianceId: null, legionId: null, lastIncomeAt: now,
    pendingFatality: null, lastChatAt: 0, trophyQueue: [],
    pendingBankHack: null, bankHackCountToday: 0, bankHackVictimsToday: [],
    landmines: 0, pendingMineDefuse: null, recentAttacks: {},
    saboteurs: { ground: 0, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 },
    saboteurLimits: { ground: 50, sea: 50, air: 50, secret: 50, building: 50 }, saboteurRareLossAccum: 0,
    silos: [], silosBuiltTotal: 0,
  };
}

function mkCombatant(userId, name, side, lastSeen) {
  usersMap[userId] = mkUser(userId, name, lastSeen);
  return {
    userId, name, side, role: 'assault',
    roleMul: { atk: 1, def: 1, dmgReduce: 0 },
    hp: 100, maxHp: 100, shield: 0, direction: 1,
    ready: true, readyAt: now, lastActionAt: 0, lastMoveAt: 0, lastItemAt: 0,
    gear: [], statusEffects: [], alive: true,
    stats: { dmgDealt: 0, dmgTaken: 0, healed: 0, kills: 0, guards: 0, itemsUsed: 0 },
  };
}

// Легионы A и B со ссылкой на общий бой
// Врагов в подготовке видно только с «Разведцентром» (ур.2+ — ещё и направления)
legionsMap['lA'] = { id: 'lA', name: 'Альфа', activeBattle: { battleId: 'B1' }, arsenal: {}, battleBuildings: { intel: 2 } };
legionsMap['lB'] = { id: 'lB', name: 'Браво', activeBattle: { battleId: 'B1' }, arsenal: {}, battleBuildings: {} };

// Бойцы: наблюдатель (онлайн, сторона A), союзник (офлайн, A), враг (онлайн, B), враг (офлайн, B)
const viewer = mkCombatant('u_view', 'Наблюдатель', 'A', FRESH);
const allyOff = mkCombatant('u_ally', 'Союзник', 'A', STALE);
const enemyOn = mkCombatant('u_en1', 'ВрагОнлайн', 'B', FRESH);
const enemyOff = mkCombatant('u_en2', 'ВрагОфлайн', 'B', STALE);
usersMap['u_view'].legionId = 'lA';

battlesMap['B1'] = {
  id: 'B1', legionA: 'lA', legionB: 'lB', legionAName: 'Альфа', legionBName: 'Браво',
  startedAt: now, prepEndsAt: now + 60000, phase: 'prep',
  combatants: { u_view: viewer, u_ally: allyOff, u_en1: enemyOn, u_en2: enemyOff },
  gear: {}, guardLinks: {}, guardExpiry: {}, log: [],
};

console.log('\n[1] Легион-бой: online у союзников (направление 1)');
const st = legionBattle.battleState(usersMap['u_view']);
ok('бой отдан', !!st.battle);
const dir1 = st.battle.directions.find((d) => d.dir === 1);
ok('направление 1 есть', !!dir1);
const vAlly = dir1.allies.find((x) => x.userId === 'u_view');
const oAlly = dir1.allies.find((x) => x.userId === 'u_ally');
eq('наблюдатель online (30с назад)', vAlly.online, true);
eq('союзник офлайн (10 мин назад)', oAlly.online, false);

console.log('\n[2] Легион-бой: online у врагов');
const enOn = dir1.enemies.find((x) => x.userId === 'u_en1');
const enOff = dir1.enemies.find((x) => x.userId === 'u_en2');
eq('враг онлайн', enOn.online, true);
eq('враг офлайн', enOff.online, false);

console.log('\n[3] Легион-бой: online в общем ростере (allCombatants)');
const rosterOn = st.battle.allCombatants.find((x) => x.userId === 'u_en1');
const rosterOff = st.battle.allCombatants.find((x) => x.userId === 'u_ally');
eq('в ростере враг онлайн', rosterOn.online, true);
eq('в ростере союзник офлайн', rosterOff.online, false);
eq('поле me содержит online', st.battle.me.online, true);

console.log('\n[4] Профиль: online в publicProfile');
const viewerUser = usersMap['u_view'];
const onlineTarget = mkUser('p_on', 'Онлайнер', FRESH);
const offlineTarget = mkUser('p_off', 'Офлайнер', STALE);
usersMap['p_on'] = onlineTarget; usersMap['p_off'] = offlineTarget;
eq('профиль онлайн-игрока', player.publicProfile(onlineTarget, viewerUser).online, true);
eq('профиль офлайн-игрока', player.publicProfile(offlineTarget, viewerUser).online, false);

console.log('\n[5] Граница окна: ровно на пороге 5 мин — офлайн, чуть меньше — онлайн');
const justOnline = mkUser('b_on', 'ПочтиОнлайн', now - (5 * 60 * 1000 - 2000)); // 4м58с
const justOffline = mkUser('b_off', 'ПочтиОфлайн', now - (5 * 60 * 1000 + 2000)); // 5м02с
usersMap['b_on'] = justOnline; usersMap['b_off'] = justOffline;
eq('4м58с → онлайн', player.publicProfile(justOnline, viewerUser).online, true);
eq('5м02с → офлайн', player.publicProfile(justOffline, viewerUser).online, false);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
