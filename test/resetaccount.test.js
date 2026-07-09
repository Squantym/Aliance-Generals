// Тест ПОЛНОГО сброса аккаунта в админ-панели: игрок начинает заново без
// исключений — альянс/легион (состав групп + лидерство), шахты, силосы,
// лазеры, ракеты, ресурсы, постройки, титулы, сезон, шпионаж и т.д.
// Идентификация (логин/почта/роль/страна/реф-код) сохраняется.
// Запуск: node test/resetaccount.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const player = require('../dist/src/services/player');
const admin = require('../dist/src/services/admin');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); passed++; console.log(`  ✅ ${n}`); };
const thr = (n, fn) => { try { fn(); assert.fail(); } catch (e) { passed++; console.log(`  ✅ ${n}`); } };

const users = player.users();
const alliances = db.load('alliances', {});
const legions = db.load('legions', {});
const rockets = db.load('rockets', {});
for (const m of [users, alliances, legions, rockets]) for (const k of Object.keys(m)) delete m[k];
const now = Date.now();

// Прокачанный игрок «в полном фарше»
const P = {
  id: 'p1', name: 'Ветеран', email: 'vet@t.t', passHash: 'HASH', salt: 'SALT', isAdmin: false,
  emailVerified: true, emailVerifyToken: null, emailVerifySentAt: now, country: 'ru',
  status: 'мой статус', createdAt: 1000, lastSeen: now,
  level: 55, xp: 999999, dollars: 5e9, gold: 400000, bank: 1e8,
  skillPoints: 20, skills: { energy: 30, health: 25, ammo: 40, cruelty: 15, agility: 10 },
  res: { hp: { cur: 500, t: now }, en: { cur: 600, t: now }, am: { cur: 200, t: now } },
  units: { ground_1: { 0: 500, 1: 100 }, air_1: { 0: 300 } }, workshops: 8, modernQueue: [{ x: 1 }],
  buildings: { hq: 20, bank_s: 15, factory: 30 }, secretDevs: { sd1: 5 }, superSecret: 3,
  ears: 50, tokens: 12, earsLost: 4, earsCurrent: 1, earsLostAt: [now], earPenaltyUntil: now + 1e6,
  earCutters: [{ id: 'x', name: 'X' }, null], earMessage: { byId: 'x', byName: 'X', text: 'hi' },
  adminEars: 100, adminTokens: 50,
  battle: { attacks: 200, wins: 150, losses: 50, defWins: 20, defLosses: 10, fatalities: 30 },
  counters: { wins: 150, attacks: 200, fatalities: 30, unitsBought: 999, buildingsBuilt: 65, missionStages: 40, earsCut: 4, moneyEarned: 1e9, battleLoot: 5e8, level: 55 },
  achStages: { a1: 3 }, missions: { m1: true }, missionProgress: { m1: 2 }, missionQueue: [{ s: 1 }],
  tutorial: { step: 10, done: true }, effects: [{ id: 'buff' }],
  trophies: { satellite: 1, medvezhatnik: 1 }, club: { vip: true },
  loginStreak: 30, lastLoginDay: '2026-07-01', titles: ['warlord'], activeTitle: 'warlord',
  lastSpyDay: '2026-07-01', spyCount: 5, spyReports: { t2: { foo: 1 } },
  contracts: [{ id: 'c1', progress: 3 }], contractsDay: '2026-07-01',
  profileFrame: 'gold', profileBg: 'dark', ownedCosmetics: ['gold', 'dark'],
  refCode: 'VET123', referredBy: 'someone', refCount: 8, refEarnings: 5000, refRewarded: true, refLevel50Paid: true,
  seasonRating: 8500, seasonId: 's5', weekly: { weekId: 'w1', rating: 500, wins: 20, ears: 10, mercy: 2, loot: 1e6, alliance: 5, missions: 8 },
  allianceId: 'aL', legionId: 'lG',
  allianceMembers: 40, allianceRoster: [{ id: 'b1', name: 'Bot', isBot: true }], allianceDiplomats: 3, allianceInviteLog: [now],
  lastBankHackDay: '2026-07-01', bankHackCountToday: 5, bankHackVictimsToday: ['v1'],
  landmines: 8, pendingMineDefuse: null, pendingBankHack: null, pendingFatality: null,
  saboteurs: { ground: 50, sea: 40, air: 30, secret: 20, building: 10, suicide: 5 },
  saboteurLimits: { ground: 200, sea: 150, air: 120, secret: 80, building: 60 }, saboteurRareLossAccum: 12,
  vsRecord: { e1: { wins: 3, losses: 1 } }, recentAttacks: { e1: [now] }, lastChatAt: now, lastIncomeAt: now,
  mines: [{ id: 'm1', status: 'idle', goldLeft: 100 }], minesBuiltTotal: 3, minesSchemaV: 2,
  silos: [{ id: 's1', rocket: {} }], silosBuiltTotal: 2,
  lasers: [{ id: 'la1', phase: 'ready' }], lasersBuiltTotal: 4, pendingRocketHits: [{ powerPct: 100 }],
};
users['p1'] = P;

// Второй участник альянса и легиона (чтобы проверить передачу лидерства)
const M2 = { id: 'p2', name: 'Зам', allianceId: 'aL', legionId: 'lG', isAdmin: false };
users['p2'] = M2;

// Альянс и легион, где P — ЛИДЕР, а p2 — участник
alliances['aL'] = { id: 'aL', name: 'Альфа-Альянс', leaderId: 'p1', members: ['p1', 'p2'] };
legions['lG'] = { id: 'lG', name: 'Легион-1', leaderId: 'p1', members: ['p1', 'p2'] };

// Летящие ракеты: одна запущена P, одна летит в P, одна чужая (не трогать)
rockets['r1'] = { id: 'r1', attackerId: 'p1', targetId: 'p2', resolved: false };
rockets['r2'] = { id: 'r2', attackerId: 'p2', targetId: 'p1', resolved: false };
rockets['r3'] = { id: 'r3', attackerId: 'p2', targetId: 'p3', resolved: false };

const adminU = { id: 'adm', name: 'Admin', isAdmin: true };
users['adm'] = adminU;
const N = [];

console.log('\n[1] Полный сброс аккаунта');
admin.resetAccount(adminU, { userId: 'p1' }, N);
const R = users['p1'];

console.log('\n[2] Идентификация СОХРАНЕНА');
eq('id сохранён', R.id, 'p1');
eq('имя сохранено', R.name, 'Ветеран');
eq('email сохранён', R.email, 'vet@t.t');
eq('passHash сохранён', R.passHash, 'HASH');
eq('роль сохранена', R.isAdmin, false);
eq('страна сохранена', R.country, 'ru');
eq('дата создания сохранена', R.createdAt, 1000);
eq('реф-код сохранён', R.refCode, 'VET123');
eq('кто пригласил — сохранён', R.referredBy, 'someone');

console.log('\n[3] Прогресс ОБНУЛЁН');
eq('уровень 1', R.level, 1);
eq('опыт 0', R.xp, 0);
eq('деньги = стартовые', R.dollars, c.PLAYER.START_DOLLARS);
eq('золото = стартовое', R.gold, c.PLAYER.START_GOLD);
eq('банк 0', R.bank, 0);
eq('очки навыков 0', R.skillPoints, 0);
eq('навыки обнулены', R.skills.ammo + R.skills.health + R.skills.energy + R.skills.cruelty + R.skills.agility, 0);
eq('техника пуста', Object.keys(R.units).length, 0);
eq('цехи 0', R.workshops, 0);
eq('постройки пусты', Object.keys(R.buildings).length, 0);
eq('секретки пусты', Object.keys(R.secretDevs).length, 0);
eq('суперсекрет 0', R.superSecret, 0);
eq('уши/жетоны 0', R.ears + R.tokens + R.earsLost, 0);
eq('adminEars сброшены', R.adminEars || 0, 0);
eq('adminTokens сброшены', R.adminTokens || 0, 0);
eq('статистика боёв обнулена', R.battle.attacks + R.battle.wins + R.battle.fatalities, 0);
eq('счётчики обнулены', R.counters.wins + R.counters.attacks + R.counters.fatalities, 0);
eq('трофеи обнулены', Object.values(R.trophies).reduce((s, x) => s + x, 0), 0);
eq('титулы сброшены', (R.titles || []).length, 0);
eq('активный титул сброшен', R.activeTitle || null, null);
eq('сезонный рейтинг сброшен', R.seasonRating || 0, 0);
eq('weekly сброшен', R.weekly || null, null);
eq('шпионаж сброшен', (R.spyCount || 0) + Object.keys(R.spyReports || {}).length, 0);
eq('контракты сброшены', (R.contracts || []).length, 0);
eq('косметика сброшена', (R.ownedCosmetics || []).length, 0);
eq('профиль-фон сброшен', R.profileBg || null, null);
eq('статус очищен', R.status, '');
eq('реф-прогресс сброшен (count)', R.refCount || 0, 0);
eq('реф-прогресс сброшен (earnings)', R.refEarnings || 0, 0);
eq('диверсанты обнулены', Object.values(R.saboteurs).reduce((s, x) => s + x, 0), 0);
eq('лимиты диверсантов = стартовые (50)', R.saboteurLimits.ground, 50);
eq('мины (жертвы) 0', R.landmines || 0, 0);
eq('логин-стрик сброшен', R.loginStreak || 0, 0);

console.log('\n[4] Экономика (шахты/силосы/лазеры) ОБНУЛЕНА');
eq('шахты пусты', (R.mines || []).length, 0);
eq('minesBuiltTotal 0', R.minesBuiltTotal || 0, 0);
eq('силосы пусты', (R.silos || []).length, 0);
eq('silosBuiltTotal 0', R.silosBuiltTotal || 0, 0);
eq('лазеры пусты', (R.lasers || []).length, 0);
eq('lasersBuiltTotal 0', R.lasersBuiltTotal || 0, 0);
eq('pendingRocketHits сброшены', (R.pendingRocketHits || []).length, 0);

console.log('\n[5] Альянс/легион: игрок ВЫВЕДЕН, лидерство передано p2');
eq('allianceId сброшен', R.allianceId, null);
eq('legionId сброшен', R.legionId, null);
eq('личный альянс (members) сброшен', R.allianceMembers || 0, 0);
eq('личный ростер сброшен', (R.allianceRoster || []).length, 0);
ok('игрок удалён из состава альянса', !alliances['aL'].members.includes('p1'));
ok('игрок удалён из состава легиона', !legions['lG'].members.includes('p1'));
eq('лидерство альянса → p2', alliances['aL'].leaderId, 'p2');
eq('лидерство легиона → p2', legions['lG'].leaderId, 'p2');
eq('в альянсе остался 1 участник', alliances['aL'].members.length, 1);

console.log('\n[6] Летящие ракеты игрока удалены, чужая — цела');
ok('ракета, запущенная игроком, удалена', !rockets['r1']);
ok('ракета, летящая в игрока, удалена', !rockets['r2']);
ok('чужая ракета не тронута', !!rockets['r3']);

console.log('\n[7] Расформирование при одиночке + защита админов');
// Игрок-одиночка, лидер альянса без других участников
users['solo'] = { id: 'solo', name: 'Один', allianceId: 'aSolo', legionId: null, isAdmin: false, createdAt: 1, email: 's@t.t', passHash: 'h', salt: 's', country: 'ru', emailVerified: true };
alliances['aSolo'] = { id: 'aSolo', name: 'Одиночка', leaderId: 'solo', members: ['solo'] };
admin.resetAccount(adminU, { userId: 'solo' }, N);
ok('пустой альянс расформирован', !alliances['aSolo']);
eq('allianceId одиночки сброшен', users['solo'].allianceId, null);
// Нельзя сбросить другого админа
users['adm2'] = { id: 'adm2', name: 'Admin2', isAdmin: true, createdAt: 1, email: 'a2@t.t', passHash: 'h', salt: 's', country: 'ru', emailVerified: true };
thr('нельзя сбросить другого админа', () => admin.resetAccount(adminU, { userId: 'adm2' }, N));

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
