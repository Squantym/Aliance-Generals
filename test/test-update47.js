// ===================================================================
// test/test-update47.js — v47:
//  1) Мощь ботов снижена ещё на 20% (×0.8 к прежним диапазонам)
//  2) По цели под санкцией НЕТ фаталити и НЕТ отрезания ушей
// Запуск: node test/test-update47.js (после npm run build)
// ===================================================================

const fs = require('fs');
const TEST_CWD = '/tmp/generals-test-cwd-47';
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
const sanctions = require('../dist/src/services/sanctions');
const config = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');

async function main() {

await auth.register('Охотник', 'пароль123', 'h@t.ru', 'ru', '1.1.1.1');
await auth.register('Добыча',  'пароль123', 'p@t.ru', 'ua', '2.2.2.2');
await auth.register('Заказчик', 'пароль123', 'z@t.ru', 'ru', '3.3.3.3');
const users = player.users();
const byName = (n) => users[Object.keys(users).find((id) => users[id].name === n)];
const hunter = byName('Охотник'), prey = byName('Добыча'), boss = byName('Заказчик');

// Армия охотнику, чтобы боты генерировались от неё
const unit = config.UNITS.find((x) => x.unlock <= 10) || config.UNITS[0];
for (const p of [hunter, prey]) {
  p.level = 10;
  player.ensureUnit(p, unit.id);
  p.res.hp.cur = 100; p.res.en.cur = 100; p.res.am.cur = 500;
}
hunter.units[unit.id][0] = 400;   // охотник заметно сильнее — бои выигрываются
prey.units[unit.id][0] = 40;

// HP цели держим в «окне фаталити»: ниже 15% от максимума (порог фаталити),
// но выше 5% (порог выплаты награды — иначе санкция закроется на первой же
// атаке и цель просто уйдёт в лазарет). Порог лазарета (25 HP) тоже учтён.
const preyMaxHp = player.maxima(prey).hp;
const HP_IN_WINDOW = Math.max(config.PLAYER.MIN_HP_TO_FIGHT + 1, Math.round(preyMaxHp * 0.14));
console.log(`  (макс. HP цели ${preyMaxHp}; порог фаталити ${Math.round(preyMaxHp * config.BATTLE.FATALITY_HP_PCT)}, порог выплаты ${Math.round(preyMaxHp * 0.05)}; ставим ${HP_IN_WINDOW})`);

// Санкция может закрыться выплатой посреди цикла — держим её активной
const keepSanction = () => {
  if (sanctions.isUnderSanction(prey.id)) return;
  boss.earCutters = [{ id: prey.id, name: prey.name }, null];
  boss.earsCurrent = 1; boss.dollars = 5000000;
  sanctions.declare(boss, prey.id, 10000, []);
};

console.log('\n── 1. Мощь ботов: диапазоны после снижения на 20% ──');
const base = Math.max(30, player.buildArmy(hunter, 'atk').power);
// Генерируем много ботов и смотрим фактический разброс доли от базы.
// makeBot не экспортируется — берём ботов через список противников.
const ratios = { playerLike: [], terrorist: [] };
for (let i = 0; i < 400; i++) {
  const { opponents } = battle.opponents(hunter);
  for (const o of opponents) {
    if (!o.id || !String(o.id).startsWith('bot_')) continue;
    const prof = battle.botProfile(o.id, hunter);
    if (!prof || !prof.power) continue;
    // Компенсируем поправку на разницу уровней: power = base × range × (1 + Δур×0.03)
    const lvlAdj = 1 + (prof.level - hunter.level) * 0.03;
    const r = prof.power.atk / (base * lvlAdj);
    (prof.isBot && prof.isPlayerLike ? ratios.playerLike : ratios.terrorist).push(r);
  }
  if (ratios.playerLike.length > 60 && ratios.terrorist.length > 60) break;
}
const stat = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr), n: arr.length });
const pl = stat(ratios.playerLike), tr = stat(ratios.terrorist);
console.log(`  (псевдоигроки: ${pl.min.toFixed(3)}–${pl.max.toFixed(3)}, выборка ${pl.n})`);
console.log(`  (террористы:   ${tr.min.toFixed(3)}–${tr.max.toFixed(3)}, выборка ${tr.n})`);
// Границы с небольшим допуском на округление power до целого
ok(pl.min >= 0.63 && pl.max <= 0.85, 'псевдоигроки укладываются в 0,64–0,832 (было 0,80–1,04)');
ok(tr.min >= 0.27 && tr.max <= 0.55, 'террористы укладываются в 0,28–0,532 (было 0,35–0,665)');
ok(pl.max <= 1.0, 'ни один бот больше не сильнее армии игрока');

console.log('\n── 2. Фаталити по цели под санкцией ──');
ok(sanctions.isUnderSanction(prey.id) === false, 'до объявления санкции: цель не под санкцией');

// Объявляем санкцию на «Добычу» (нужно, чтобы она отрезала ухо заказчику)
boss.earCutters = [{ id: prey.id, name: prey.name }, null];
boss.earsCurrent = 1;
boss.dollars = 500000;
sanctions.declare(boss, prey.id, 10000, []);
ok(sanctions.isUnderSanction(prey.id) === true, 'после объявления: цель под санкцией');

// Прогоняем много боёв по цели под санкцией: окно фаталити не должно
// появиться ни разу. Жестокость выкручена в максимум, HP цели — на дне,
// то есть при отсутствии фикса фаталити выпадало бы регулярно.
hunter.skills.cruelty = 90;
prey.skills.agility = 0;
let fatalityOffers = 0, crits = 0, battles = 0;
for (let i = 0; i < 300; i++) {
  hunter.lastAttackAt = 0;
  hunter.res.hp.cur = 100; hunter.res.en.cur = 100; hunter.res.am.cur = 500;
  hunter.pendingFatality = null; hunter.pendingBankHack = null; hunter.pendingMineDefuse = null;
  prey.res.hp.cur = HP_IN_WINDOW;         // в окне фаталити, но выше порога выплаты
  prey.dollars = 100000;
  keepSanction();                          // санкция должна оставаться активной
  try {
    const r = battle.attack(hunter, prey.id, []);
    battles++;
    if (r && r.crit) crits++;
    if (hunter.pendingFatality) fatalityOffers++;
  } catch (e) { /* лазарет/кулдаун — пропускаем */ }
}
console.log(`  (боёв: ${battles}, критов: ${crits}, предложений фаталити: ${fatalityOffers})`);
ok(battles > 50, `бои по цели под санкцией проходят (${battles}) — атаковать её по-прежнему можно`);
ok(crits > 0, `криты случались (${crits}) — условие фаталити достигалось`);
ok(fatalityOffers === 0, 'фаталити не предложено НИ РАЗУ по цели под санкцией');
ok(prey.earsCurrent === config.EARS.MAX, `уши цели целы (${prey.earsCurrent}/${config.EARS.MAX}) — резать в санкциях нельзя`);
ok(hunter.ears === 0, 'охотник не получил ни одного уха с цели под санкцией');

console.log('\n── 3. Без санкции фаталити работает как раньше ──');
sanctions.clearTarget(prey.id);
ok(sanctions.isUnderSanction(prey.id) === false, 'санкция снята');
let offersAfter = 0;
for (let i = 0; i < 300; i++) {
  hunter.lastAttackAt = 0;
  hunter.res.hp.cur = 100; hunter.res.en.cur = 100; hunter.res.am.cur = 500;
  hunter.pendingFatality = null; hunter.pendingBankHack = null; hunter.pendingMineDefuse = null;
  prey.res.hp.cur = HP_IN_WINDOW; prey.dollars = 100000;
  try {
    battle.attack(hunter, prey.id, []);
    if (hunter.pendingFatality) { offersAfter++; break; }
  } catch (e) {}
}
ok(offersAfter > 0, 'после снятия санкции фаталити снова доступно — механика не сломана');

console.log('\n── 4. Санкция, объявленная ПОСЛЕ открытия окна фаталити ──');
// Окно уже открыто (осталось от предыдущего блока), теперь вешаем санкцию
hunter.pendingFatality = { targetId: prey.id, name: prey.name, isBot: false, exp: Date.now() + 60000 };
boss.earCutters = [{ id: prey.id, name: prey.name }, null];
boss.earsCurrent = 1; boss.dollars = 500000;
sanctions.declare(boss, prey.id, 10000, []);
const earsBefore = prey.earsCurrent;
let blocked = false, msg = '';
try { battle.fatality(hunter, 'ear', []); } catch (e) { blocked = true; msg = e.message; }
ok(blocked, `попытка добить заблокирована → «${msg}»`);
ok(prey.earsCurrent === earsBefore, 'ухо не отрезано');
ok(hunter.pendingFatality === null, 'окно фаталити закрыто');

console.log('\n── 5. Награда за санкцию по-прежнему выплачивается ──');
sanctions.clearTarget(prey.id);
boss.earCutters = [{ id: prey.id, name: prey.name }, null];
boss.earsCurrent = 1; boss.dollars = 500000;
sanctions.declare(boss, prey.id, 50000, []);
const moneyBefore = hunter.dollars;
const maxHp = player.maxima(prey).hp;
const nn = [];
sanctions.checkPayout(hunter, prey, Math.floor(maxHp * 0.01), maxHp, nn);
ok(hunter.dollars > moneyBefore, `охотник получил награду (+$${hunter.dollars - moneyBefore}) — санкция закрывается выплатой, а не ухом`);
ok(sanctions.isUnderSanction(prey.id) === false, 'санкция снята после выплаты');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
