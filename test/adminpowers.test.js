// Тест уникальных админ-привилегий и раздела новостей:
//  - профиль: админ видит армию/постройки/секретки без разведки;
//  - легион: админ-обзор внутренностей, вступление без разрешения, вклад ресурсов;
//  - турнир: бой между двумя легионами напрямую;
//  - новости: CRUD с фильтрацией мусорных блоков и защитой прав.
// Запуск: node test/adminpowers.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const player = require('../dist/src/services/player');
const legion = require('../dist/src/services/legion');
const groups = require('../dist/src/services/groups');
const news = require('../dist/src/services/news');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };
const thr = (n, fn) => { try { fn(); assert.fail(); } catch (e) { passed++; console.log(`  ✅ ${n}`); } };

const um = db.load('users', {}), lm = db.load('legions', {}), bm = db.load('battles', {}), nw = db.load('news', {});
for (const m of [um, lm, bm, nw]) for (const k of Object.keys(m)) delete m[k];
const now = Date.now();
function mkUser(id, isAdmin) {
  return { id, name: id, email: id + '@t.t', passHash: 'x', salt: 'x', isAdmin: !!isAdmin, country: 'ru', status: '', createdAt: now, lastSeen: now, level: 20, xp: 0, dollars: 0, gold: 0, bank: 0, skillPoints: 0, skills: { energy: 0, health: 0, ammo: 0, cruelty: 5, agility: 3 }, res: { hp: { cur: 100, max: 100, t: now }, en: { cur: 50, max: 100, t: now }, am: { cur: 9, max: 100, t: now } }, units: { ground_1: { 0: 10 } }, workshops: 0, modernQueue: [], buildings: { hq: 1 }, secretDevs: {}, superSecret: 2, ears: 0, tokens: 0, earsLost: 0, earsCurrent: 2, earsLostAt: [], earPenaltyUntil: 0, battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 }, counters: {}, achStages: {}, missions: {}, tutorial: { done: true }, effects: [], trophies: Object.fromEntries((c.TROPHIES || []).map(t => [t.id, 0])), club: {}, allianceId: null, legionId: null, lastIncomeAt: now, saboteurs: { ground: 0, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 }, saboteurLimits: { ground: 50, sea: 50, air: 50, secret: 50, building: 50 }, silos: [] };
}
const admin = mkUser('admin', true), viewer = mkUser('viewer', false), target = mkUser('target', false);
um.admin = admin; um.viewer = viewer; um.target = target;

console.log('\n[1] Профиль: раскрытие армии администратору');
const asViewer = player.publicProfile(target, viewer);
const asAdmin = player.publicProfile(target, admin);
eq('обычный не видит юниты', asViewer.units.length, 0);
eq('обычный: hideArmy', asViewer.hideArmy, true);
eq('обычный: power скрыт', asViewer.power, null);
ok('админ видит юниты', asAdmin.units.length > 0);
eq('админ: superSecret виден', asAdmin.superSecret, 2);
ok('админ: power виден', !!asAdmin.power);
eq('админ: hideArmy=false', asAdmin.hideArmy, false);
eq('админ: adminView=true', asAdmin.adminView, true);
eq('свой профиль: adminView=false', player.publicProfile(admin, admin).adminView, false);

console.log('\n[2] Легион: обзор внутренностей только админу');
lm.lA = { id: 'lA', name: 'Альфа', leaderId: 'target', members: ['target'], requests: [], invites: [], treasury: 5000, reserves: 200, treasuryEars: 3, treasuryTokens: 1, arsenal: { gas_grenade: 2 }, buildings: {}, battleBuildings: {}, gloryPoints: 10, battleStats: { wins: 1, losses: 0 } };
lm.lB = { id: 'lB', name: 'Браво', leaderId: 'viewer', members: ['viewer'], requests: [], invites: [], treasury: 0, reserves: 0, arsenal: {}, buildings: {}, battleBuildings: {}, gloryPoints: 0, battleStats: { wins: 0, losses: 0 } };
target.legionId = 'lA'; viewer.legionId = 'lB';
const peekA = legion.publicView('lA', admin);
ok('админ видит adminPeek', !!peekA.adminPeek);
eq('adminPeek.treasury мигрирован в 0 (валюта клана — РЕЗ)', peekA.adminPeek.treasury, 0);
eq('adminPeek.reserves = 200 + 5000/1000', peekA.adminPeek.reserves, 205);
ok('adminPeek.arsenal заполнен', peekA.adminPeek.arsenal.length === 1);
eq('обычный не видит adminPeek', legion.publicView('lA', viewer).adminPeek, null);

console.log('\n[3] Легион: админ-вступление без разрешения');
groups.adminJoin(admin, 'legion', 'lA', []);
ok('админ в составе lA', lm.lA.members.includes('admin'));
eq('legionId админа', admin.legionId, 'lA');
thr('не-админ не может adminJoin', () => groups.adminJoin(viewer, 'legion', 'lB', []));
thr('повторное вступление отклонено', () => groups.adminJoin(admin, 'legion', 'lA', []));

console.log('\n[4] Легион: админ-вклад разных ресурсов');
legion.adminDeposit(admin, 'lB', 500, [], 'reserves');
legion.adminDeposit(admin, 'lB', 300, [], 'reserves');
legion.adminDeposit(admin, 'lB', 7, [], 'ears');
legion.adminDeposit(admin, 'lB', 4, [], 'tokens');
eq('резервы пополнены (500+300)', lm.lB.reserves, 800);
eq('уши пополнены', lm.lB.treasuryEars, 7);
eq('жетоны пополнены', lm.lB.treasuryTokens, 4);
thr('внесение долларов в казну отклонено (валюта — РЕЗ)', () => legion.adminDeposit(admin, 'lB', 100, [], 'treasury'));
thr('не-админ не может вложить', () => legion.adminDeposit(viewer, 'lB', 100, [], 'reserves'));
thr('отрицательная сумма отклонена', () => legion.adminDeposit(admin, 'lB', -5, [], 'reserves'));

console.log('\n[5] Турнир: бой между двумя легионами');
const battle = legion.adminStartBattle(admin, 'lA', 'lB', []);
ok('бой создан', !!battle.battleId);
ok('activeBattle у обоих', !!lm.lA.activeBattle && !!lm.lB.activeBattle);
eq('фаза prep', bm[battle.battleId].phase, 'prep');
eq('метка турнира', bm[battle.battleId].adminTournament, true);
thr('не-админ не может назначить бой', () => legion.adminStartBattle(viewer, 'lA', 'lB', []));
thr('нельзя назначить бой занятому легиону', () => legion.adminStartBattle(admin, 'lA', 'lB', []));
thr('нельзя бой легиона с самим собой', () => legion.adminStartBattle(admin, 'lA', 'lA', []));

console.log('\n[6] Новости: CRUD и фильтрация');
const created = news.create(admin, { title: 'Обновление 1.5', emoji: '🚀', tag: 'Патч', blocks: [
  { type: 'heading', text: 'Большое обновление', level: 1 },
  { type: 'text', text: 'Добавили **турниры**.' },
  { type: 'callout', text: 'Не пропустите!', color: 'gold' },
  { type: 'evil_block', hack: 'x' },              // мусорный тип — должен отфильтроваться
  { type: 'heading', text: 'x', level: 99 },       // некорректный level → дефолт
] }, []);
eq('мусорный блок отфильтрован', created.post.blocks.length, 4);
eq('некорректный level исправлен', created.post.blocks[3].level, 2);
const listed = news.list(viewer);
eq('пост в списке', listed.posts.length, 1);
eq('игрок не управляет', listed.canManage, false);
eq('админ управляет', news.list(admin).canManage, true);
news.update(admin, created.id, { title: 'Обновление 1.5.1', pinned: true }, []);
eq('заголовок обновлён', nw[created.id].title, 'Обновление 1.5.1');
eq('закреплено', nw[created.id].pinned, true);
news.togglePin(admin, created.id, []);
eq('откреплено', nw[created.id].pinned, false);
thr('игрок не может создать', () => news.create(viewer, { title: 'x', blocks: [{ type: 'text', text: 'y' }] }, []));
thr('пустой заголовок отклонён', () => news.create(admin, { title: '  ', blocks: [{ type: 'text', text: 'y' }] }, []));
thr('пост без блоков отклонён', () => news.create(admin, { title: 'x', blocks: [] }, []));
news.remove(admin, created.id, []);
eq('пост удалён', Object.keys(nw).length, 0);
thr('игрок не может удалить', () => news.remove(viewer, 'anything', []));

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
