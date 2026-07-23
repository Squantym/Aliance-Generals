// ===================================================================
// test/test-update44.js — проверка новых механик v44:
//  1) Сводка «пока вас не было» (warReport): атаки по оффлайн-цели,
//     отбитые атаки, санкции; онлайн-цель в сводку НЕ попадает; ack.
//  2) Очередь окон достижений (pendingAchievements): несколько этапов
//     за одно действие -> несколько окон; ackPending убирает по одному.
//  3) Профиль: deathsCount и данные для «Боевой эффективности».
// Запуск: node test/test-update44.js (после npm run build)
// ===================================================================

process.env.DATA_DIR = '/tmp/generals-test-data-44';
const fs = require('fs');
fs.rmSync('/tmp/generals-test-data-44', { recursive: true, force: true });
fs.mkdirSync('/tmp/generals-test-data-44', { recursive: true });

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name); }
}

const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const ach = require('../dist/src/services/achievements');
const warReport = require('../dist/src/services/warReport');
const sanctions = require('../dist/src/services/sanctions');
const config = require('../dist/config/gameConfig');

// ── Подготовка: два игрока (имена — кириллицей, иначе 400) ─────────
async function main() {
await auth.register('Атакующий', 'пароль123', 'a1@test.ru', 'ru', '1.1.1.1');
await auth.register('Защитник', 'пароль123', 'a2@test.ru', 'ua', '2.2.2.2');
const users = player.users();
const byName = (n) => users[Object.keys(users).find(id => users[id].name === n)];
const atk = byName('Атакующий');
const def = byName('Защитник');
ok(!!atk && !!def, 'игроки созданы');

// Даём атакующему армию и ресурсы, чтобы атака прошла
atk.level = 10; def.level = 10;
const unit = config.UNITS.find(u => u.unlock <= 10 && u.type === 'ground') || config.UNITS[0];
player.ensureUnit(atk, unit.id); atk.units[unit.id][0] = 500;
player.ensureUnit(def, unit.id); def.units[unit.id][0] = 5;
const fill = (u) => { u.res.hp.cur = 100; u.res.en.cur = 100; u.res.am.cur = 200; };
fill(atk); fill(def);
def.dollars = 1000000;

console.log('\n── 1. Сводка «пока вас не было» ──');

// Цель ОНЛАЙН — сводка не копится
def.lastSeen = Date.now();
atk.lastAttackAt = 0;
try { battle.attack(atk, def.id, []); } catch (e) { console.log('  (атака-онлайн: ' + e.message + ')'); }
ok(!def.offlineWar, 'онлайн-цель: offlineWar НЕ создан');

// Цель ОФФЛАЙН (lastSeen час назад) — атаки копятся
def.lastSeen = Date.now() - 60 * 60 * 1000;
const moneyBefore = def.dollars;
let attacksLanded = 0;
for (let i = 0; i < 5; i++) {
  atk.lastAttackAt = 0;              // сброс кулдауна атак (1 сек)
  fill(atk); def.res.hp.cur = 100;   // ресурсы и HP на каждый бой
  atk.pendingFatality = null; atk.pendingBankHack = null; atk.pendingMineDefuse = null;
  def.lastSeen = Date.now() - 60 * 60 * 1000; // держим цель «оффлайн»
  try { battle.attack(atk, def.id, []); attacksLanded++; } catch (e) { console.log('  (атака: ' + e.message + ')'); }
}
ok(attacksLanded === 5, 'проведено 5 атак по оффлайн-цели (' + attacksLanded + ')');
ok(!!def.offlineWar, 'offlineWar создан у оффлайн-цели');
const w = def.offlineWar;
ok(w.attacks === 5, `атак в сводке: 5 (факт ${w.attacks})`);
ok(w.defeats + w.defended === w.attacks, `поражения(${w.defeats}) + отбито(${w.defended}) = атаки`);
const moneyLostReal = moneyBefore - def.dollars;
ok(w.moneyLost === moneyLostReal, `потеряно денег в сводке = реально снятому ($${w.moneyLost} = $${moneyLostReal})`);
const lossKeys = Object.keys(w.losses || {});
console.log('  (потери техники в сводке: ' + lossKeys.map(k => w.losses[k].name + ' ×' + w.losses[k].count).join(', ') + ')');

// Санкция на оффлайн-цель (нужно, чтобы цель отрезала ухо заказчику)
atk.earCutters = [{ id: def.id, name: def.name }, null];
atk.earsCurrent = 1;
atk.dollars = 500000;
sanctions.declare(atk, def.id, 5000, []);
sanctions.declare(atk, def.id, 3000, []); // добор — агрегируется
const sanc = Object.values(def.offlineWar.sanctions || {});
ok(sanc.length === 1, 'санкции агрегированы по заказчику (1 запись)');
ok(sanc[0] && sanc[0].count === 2 && sanc[0].amount === 8000, `заказчик: x2 на сумму $8000 (факт x${sanc[0] && sanc[0].count}, $${sanc[0] && sanc[0].amount})`);
ok(sanc[0] && sanc[0].byName === atk.name && !!sanc[0].byFlag, 'у санкции есть имя и флаг заказчика');

// view() и ack()
const view = warReport.view(def);
ok(view && view.attacks === 5 && Array.isArray(view.losses) && Array.isArray(view.sanctions), 'view(): корректная сводка для фронта');
ok(view.losses.every((l, i, arr) => i === 0 || arr[i-1].count >= l.count), 'view(): потери отсортированы по убыванию');
warReport.ack(def);
ok(!def.offlineWar && warReport.view(def) === null, 'ack(): сводка очищена');

// Агрегация потерь техники (прямой вызов, т.к. случайный бросок в бою
// может дать 0 потерь при крошечной армии защитника)
def.lastSeen = Date.now() - 60 * 60 * 1000;
warReport.onAttack(def, { defeat: true, moneyLost: 100, losses: [{ id: 'ground_1', name: 'Джип', count: 3 }] });
warReport.onAttack(def, { defeat: true, moneyLost: 50,  losses: [{ id: 'ground_1', name: 'Джип', count: 2 }, { id: 'air_1', name: 'Дрон', count: 1 }] });
const w2 = def.offlineWar;
ok(w2.losses['ground_1'].count === 5 && w2.losses['air_1'].count === 1, 'потери одной техники суммируются (Джип ×5, Дрон ×1)');
const v2 = warReport.view(def);
ok(v2.losses[0].id === 'ground_1' && v2.losses[0].count === 5, 'view(): крупнейшие потери первыми');
warReport.ack(def);

console.log('\n── 2. Очередь окон достижений ──');
const before = (def.pendingAchievements || []).length;
console.log('  (в очереди после атак уже: ' + before + ' — «Битый»/«Враг народа» оффлайн)');
// «Враг народа» (порог 1 санкция) получен оффлайн; «Битый» требует 10
// поражений — их пока 6, окна нет. Проверяем сам механизм:
ok(before >= 1 && (def.pendingAchievements || []).some(p => p.achId === 'sanctioned'),
   'достижение, полученное оффлайн («Враг народа»), попало в очередь');

// Несколько этапов за одно действие: прыжок счётчика wins с 0 до 300
await auth.register('Ветеранша', 'пароль123', 'a3@test.ru', 'ru', '3.3.3.3');
const vet = byName('Ветеранша');
vet.counters.wins = 300; // порог 25 и 250 => сразу 2 этапа
ach.check(vet, []);
const q = vet.pendingAchievements || [];
const winsQ = q.filter(p => p.achId === 'wins');
ok(winsQ.length === 2, `за одно действие 2 этапа «Ликвидатора» -> 2 окна (факт ${winsQ.length})`);
ok(winsQ[0].stage === 1 && winsQ[1].stage === 2, 'этапы в очереди по порядку: 1, затем 2');
const p1 = winsQ[0];
ok(p1.name === 'Ликвидатор' && p1.threshold === 25 && p1.title === 'Боец' && p1.titleId === 'wins:0', 'поля окна: имя/порог/титул/titleId');
ok(typeof p1.dollars === 'number' && p1.dollars === config.ACH_DOLLARS[0], 'награда в окне совпадает с конфигом');
ok(fs.existsSync(__dirname + '/../public/img/achievements/' + p1.achId + '_' + p1.stage + '.webp'), 'картинка для окна существует');

// ackPending: убираем по одному — имитация «закрыл окно, открылось следующее»
const total = q.length;
ach.ackPending(vet, q[0].id);
ok(vet.pendingAchievements.length === total - 1, 'ackPending убрал ровно одно окно');
ach.ackPending(vet, 'несуществующий');
ok(vet.pendingAchievements.length === total - 1, 'ackPending с чужим id ничего не ломает');
while (vet.pendingAchievements.length) ach.ackPending(vet, vet.pendingAchievements[0].id);
ok(vet.pendingAchievements.length === 0, 'очередь опустошается до конца');

// Переполнение очереди: не больше 30
vet.achStages = {}; vet.pendingAchievements = [];
for (const a of config.ACHIEVEMENTS) vet.counters[a.counter] = 1e15;
vet.level = 300;
ach.check(vet, []);
ok(vet.pendingAchievements.length <= 30, `очередь ограничена 30 окнами (факт ${vet.pendingAchievements.length})`);

console.log('\n── 3. Профиль: deathsCount и боевая эффективность ──');
def.counters.deaths = 7;
const prof = player.publicProfile(def, def);
ok(prof.deathsCount === 7, 'deathsCount отдаётся в профиле (смерти на минах)');
ok(prof.power && typeof prof.power.atk === 'number' && typeof prof.power.def === 'number', 'power.atk/def для «Боевой эффективности»');
ok(typeof prof.critChancePct === 'number' && typeof prof.dodgeChancePct === 'number', 'critChancePct/dodgeChancePct отдаются');
ok(typeof prof.rating === 'number' && typeof prof.rank === 'string', 'rating и rank на месте');
const profForeign = player.publicProfile(def, atk);
ok(profForeign.deathsCount === 7, 'deathsCount виден и в чужом профиле (блок «Статистика»)');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
