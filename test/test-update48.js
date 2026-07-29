// ===================================================================
// test/test-update48.js — v48, задача 1: потери техники в бою
// Потери стали абсолютными и зависят от урона:
//   обычный удар — 1..10 единиц, критический — 10..30.
// Полный уворот (урон 0) не отнимает технику вообще; если увернулись
// оба — не теряет никто.
// Запуск: node test/test-update48.js (после npm run build)
// ===================================================================

const fs = require('fs');
const TEST_CWD = '/tmp/generals-test-cwd-48';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name); }
}

const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const config = require('../dist/config/gameConfig');
const B = config.BATTLE;

async function main() {

console.log('\n── 1. Формула потерь (unitLossCount через реальные бои) ──');
console.log(`  (конфиг: обычный ${B.UNIT_LOSS_MIN}–${B.UNIT_LOSS_MAX}, крит ${B.UNIT_LOSS_CRIT_MIN}–${B.UNIT_LOSS_CRIT_MAX}, потолок урона ${B.UNIT_LOSS_DAMAGE_CAP})`);
ok(B.UNIT_LOSS_MIN === 1 && B.UNIT_LOSS_MAX === 10, 'обычные потери настроены на 1–10');
ok(B.UNIT_LOSS_CRIT_MIN === 10 && B.UNIT_LOSS_CRIT_MAX === 30, 'критические потери настроены на 10–30');

await auth.register('Атакующий', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
await auth.register('Защитник', 'пароль123', 'd@t.ru', 'ua', '2.2.2.2');
const users = player.users();
const byName = (n) => users[Object.keys(users).find((id) => users[id].name === n)];
const atk = byName('Атакующий'), def = byName('Защитник');

// Крупные армии: именно на них старая формула (доля от армии) давала
// потери в сотни единиц — как на скриншотах игроков (x822, x773).
const unit = config.UNITS.find((x) => x.unlock <= 10) || config.UNITS[0];
for (const p of [atk, def]) {
  p.level = 10;
  p.allianceMembers = 300;             // вместимость армии зависит от альянса
  player.ensureUnit(p, unit.id);
  p.units[unit.id][0] = 5000;          // большая армия
  p.res.hp.cur = 100; p.res.en.cur = 100; p.res.am.cur = 999;
  p.skills.agility = 0;                 // уворот отключаем — проверим отдельно
  p.dollars = 1000000;
}

console.log('\n── 2. Потери в реальных боях: диапазоны ──');
const norm = [], critLosses = [];
let battles = 0, zeroLossBattles = 0;
for (let i = 0; i < 600; i++) {
  atk.lastAttackAt = 0;
  atk.level = 10; def.level = 10;   // не даём уровням разойтись за серию боёв
  atk.res.hp.cur = 100; atk.res.en.cur = 100; atk.res.am.cur = 999;
  atk.pendingFatality = null; atk.pendingBankHack = null; atk.pendingMineDefuse = null;
  def.res.hp.cur = 100; def.dollars = 1000000;
  // Возвращаем технику, чтобы армии не иссякли за 600 боёв
  atk.units[unit.id][0] = 5000; def.units[unit.id][0] = 5000;
  let r;
  try { r = battle.attack(atk, def.id, []); } catch (e) { continue; }
  battles++;
  const enemyTotal = (r.enemyLosses || []).reduce((s, l) => s + l.count, 0);
  const myTotal = (r.myLosses || []).reduce((s, l) => s + l.count, 0);
  if (enemyTotal === 0 && myTotal === 0) zeroLossBattles++;
  // Потери защитника соответствуют удару атакующего
  if (r.dealt > 0) (r.crit ? critLosses : norm).push(enemyTotal);
}
const stat = (a) => a.length ? { min: Math.min(...a), max: Math.max(...a), avg: (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1), n: a.length } : null;
const sn = stat(norm), sc = stat(critLosses);
console.log(`  (боёв ${battles}; обычные удары: потери ${sn.min}–${sn.max}, среднее ${sn.avg}, выборка ${sn.n})`);
if (sc) console.log(`  (криты: потери ${sc.min}–${sc.max}, среднее ${sc.avg}, выборка ${sc.n})`);
ok(battles > 100, `бои проходят (${battles})`);
ok(sn.max <= B.UNIT_LOSS_MAX, `обычный удар: не больше ${B.UNIT_LOSS_MAX} единиц (факт максимум ${sn.max})`);
ok(sn.min >= B.UNIT_LOSS_MIN, `обычный удар: не меньше ${B.UNIT_LOSS_MIN} (факт минимум ${sn.min})`);
if (sc) {
  ok(sc.max <= B.UNIT_LOSS_CRIT_MAX, `крит: не больше ${B.UNIT_LOSS_CRIT_MAX} единиц (факт максимум ${sc.max})`);
  ok(sc.min >= B.UNIT_LOSS_CRIT_MIN, `крит: не меньше ${B.UNIT_LOSS_CRIT_MIN} (факт минимум ${sc.min})`);
  ok(Number(sc.avg) > Number(sn.avg), `крит отнимает больше техники, чем обычный удар (${sc.avg} против ${sn.avg})`);
}

console.log('\n── 3. Потери масштабируются по урону ──');
// Группируем потери по величине урона: сильнее удар → крупнее потери
const pairs = [];
for (let i = 0; i < 400; i++) {
  atk.lastAttackAt = 0;
  atk.level = 10; def.level = 10;   // не даём уровням разойтись за серию боёв
  atk.res.hp.cur = 100; atk.res.en.cur = 100; atk.res.am.cur = 999;
  atk.pendingFatality = null; atk.pendingBankHack = null; atk.pendingMineDefuse = null;
  def.res.hp.cur = 100; def.dollars = 1000000;
  atk.units[unit.id][0] = 5000;
  // Меняем соотношение сил: то защитник крепче (слабые удары), то слабее (сильные)
  def.units[unit.id][0] = (i % 2 === 0) ? 40000 : 300;
  let r;
  try { r = battle.attack(atk, def.id, []); } catch (e) { continue; }
  if (r.crit || !r.dealt) continue;
  const enemyTotal = (r.enemyLosses || []).reduce((s, l) => s + l.count, 0);
  pairs.push({ dmg: r.dealt, loss: enemyTotal });
}
const dmgs = pairs.map((p) => p.dmg);
console.log(`  (разброс урона в выборке: ${Math.min(...dmgs)}–${Math.max(...dmgs)})`);
const median = dmgs.slice().sort((a, b) => a - b)[Math.floor(dmgs.length / 2)];
const weak = pairs.filter((p) => p.dmg < median);
const strong = pairs.filter((p) => p.dmg > median);
if (weak.length && strong.length) {
  const avgW = weak.reduce((s, p) => s + p.loss, 0) / weak.length;
  const avgS = strong.reduce((s, p) => s + p.loss, 0) / strong.length;
  console.log(`  (удары слабее медианы (${median}) → ${avgW.toFixed(1)} единиц; сильнее медианы → ${avgS.toFixed(1)})`);
  ok(avgS > avgW, 'больше урона — больше потерянной техники');
} else {
  ok(false, 'не удалось собрать выборку по силе урона');
}

console.log('\n── 4. Уворот: техника не теряется ──');
// Заставляем защитника уворачиваться всегда: максимальная ловкость
def.skills.agility = 100;
atk.skills.agility = 0;
let dodgedBattles = 0, dodgedWithLosses = 0;
for (let i = 0; i < 300; i++) {
  atk.lastAttackAt = 0;
  atk.level = 10; def.level = 10;   // не даём уровням разойтись за серию боёв
  atk.res.hp.cur = 100; atk.res.en.cur = 100; atk.res.am.cur = 999;
  atk.pendingFatality = null; atk.pendingBankHack = null; atk.pendingMineDefuse = null;
  def.res.hp.cur = 100; def.dollars = 1000000;
  atk.units[unit.id][0] = 5000; def.units[unit.id][0] = 5000;
  let r;
  try { r = battle.attack(atk, def.id, []); } catch (e) { continue; }
  if (!r.dodge) continue;                       // интересуют только увороты защитника
  dodgedBattles++;
  const enemyTotal = (r.enemyLosses || []).reduce((s, l) => s + l.count, 0);
  if (enemyTotal > 0) dodgedWithLosses++;
}
console.log(`  (боёв с уворотом защитника: ${dodgedBattles}, из них с потерями: ${dodgedWithLosses})`);
ok(dodgedBattles > 20, `увороты случались (${dodgedBattles})`);
ok(dodgedWithLosses === 0, 'увернувшийся защитник НЕ потерял ни единицы техники');

console.log('\n── 5. Уворот атакующего ──');
atk.skills.agility = 100;
def.skills.agility = 0;
let atkDodged = 0, atkDodgedWithLosses = 0;
for (let i = 0; i < 300; i++) {
  atk.lastAttackAt = 0;
  atk.level = 10; def.level = 10;   // не даём уровням разойтись за серию боёв
  atk.res.hp.cur = 100; atk.res.en.cur = 100; atk.res.am.cur = 999;
  atk.pendingFatality = null; atk.pendingBankHack = null; atk.pendingMineDefuse = null;
  def.res.hp.cur = 100; def.dollars = 1000000;
  atk.units[unit.id][0] = 5000; def.units[unit.id][0] = 5000;
  let r;
  try { r = battle.attack(atk, def.id, []); } catch (e) { continue; }
  if (!r.attackerDodge) continue;
  atkDodged++;
  const myTotal = (r.myLosses || []).reduce((s, l) => s + l.count, 0);
  if (myTotal > 0) atkDodgedWithLosses++;
}
console.log(`  (боёв с уворотом атакующего: ${atkDodged}, из них с потерями: ${atkDodgedWithLosses})`);
ok(atkDodged > 20, `увороты атакующего случались (${atkDodged})`);
ok(atkDodgedWithLosses === 0, 'увернувшийся атакующий НЕ потерял ни единицы техники');

console.log('\n── 6. Увернулись оба — не теряет никто ──');
atk.skills.agility = 100; def.skills.agility = 100;
let bothDodged = 0, bothWithLosses = 0;
for (let i = 0; i < 600; i++) {
  atk.lastAttackAt = 0;
  atk.level = 10; def.level = 10;   // не даём уровням разойтись за серию боёв
  atk.res.hp.cur = 100; atk.res.en.cur = 100; atk.res.am.cur = 999;
  atk.pendingFatality = null; atk.pendingBankHack = null; atk.pendingMineDefuse = null;
  def.res.hp.cur = 100; def.dollars = 1000000;
  atk.units[unit.id][0] = 5000; def.units[unit.id][0] = 5000;
  let r;
  try { r = battle.attack(atk, def.id, []); } catch (e) { continue; }
  if (!(r.dodge && r.attackerDodge)) continue;
  bothDodged++;
  const total = (r.myLosses || []).reduce((s, l) => s + l.count, 0)
              + (r.enemyLosses || []).reduce((s, l) => s + l.count, 0);
  if (total > 0) bothWithLosses++;
}
console.log(`  (боёв, где увернулись оба: ${bothDodged}, из них с потерями: ${bothWithLosses})`);
ok(bothDodged > 5, `случаи двойного уворота найдены (${bothDodged})`);
ok(bothWithLosses === 0, 'при двойном увороте техники не теряет НИКТО');

console.log('\n── 7. Защита новичка: маленькая армия ──');
atk.skills.agility = 0; def.skills.agility = 0;
def.units[unit.id][0] = 6;                       // всего 6 единиц у защитника
def.allianceMembers = 0;                          // новичок без альянса
let maxLossSmall = 0, smallBattles = 0; const smallErrs = {};
for (let i = 0; i < 200; i++) {
  atk.lastAttackAt = 0;
  atk.level = 10; def.level = 10;   // не даём уровням разойтись за серию боёв
  atk.res.hp.cur = 100; atk.res.en.cur = 100; atk.res.am.cur = 999;
  atk.pendingFatality = null; atk.pendingBankHack = null; atk.pendingMineDefuse = null;
  def.res.hp.cur = 100; def.dollars = 1000000;
  atk.units[unit.id][0] = 5000;
  def.units[unit.id] = [6, 0, 0];
  let r;
  try { r = battle.attack(atk, def.id, []); } catch (e) { smallErrs[e.message] = (smallErrs[e.message] || 0) + 1; continue; }
  smallBattles++;
  const enemyTotal = (r.enemyLosses || []).reduce((s, l) => s + l.count, 0);
  if (enemyTotal > maxLossSmall) maxLossSmall = enemyTotal;
}
console.log(`  (боёв ${smallBattles}; максимум потерь при армии из 6 единиц: ${maxLossSmall})`);
if (Object.keys(smallErrs).length) console.log('  (причины пропусков:', smallErrs, ')');
ok(maxLossSmall <= 2, `армия новичка не выкашивается целиком: максимум ${maxLossSmall} из 6 (лимит — треть взятого в бой)`);

console.log('\n── 8. Сравнение со старой формулой ──');
// Старая формула: доля от армии. Для 5000 единиц при поражении защитника
// это floor(5000 × 0.004 × randMul до 1.6) ≈ до 32, а на реальных
// «боевых» армиях в десятки тысяч — сотни единиц за бой.
const oldMax = Math.floor(5000 * B.LOSS_DEF_PCT * 1.6);
const oldMaxBig = Math.floor(100000 * B.LOSS_DEF_PCT * 1.6);
console.log(`  (старая формула: армия 5 000 → до ${oldMax} единиц; армия 100 000 → до ${oldMaxBig})`);
ok(B.UNIT_LOSS_CRIT_MAX < oldMaxBig, `новый потолок ${B.UNIT_LOSS_CRIT_MAX} много ниже старого ${oldMaxBig} — расход техники резко снижен`);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
