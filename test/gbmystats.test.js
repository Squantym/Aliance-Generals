// ═══════════════════════════════════════════════════════════════════
// Свои характеристики в комнате подготовки: разбивка «база → прокачка →
// снабжение → роль», и никакой утечки чужих данных.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-gbmystats-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const gb = require(ROOT + '/dist/src/services/groupBattle');
const UP = require(ROOT + '/dist/src/services/groupUpgrades');
const db = require(ROOT + '/dist/src/core/db');

async function main() {
for (const [n, e] of [['Танк', 'a@t.ru'], ['Новобранец', 'b@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const tank = by('Танк'), rookie = by('Новобранец');
for (const p of [tank, rookie]) p.level = 50;

// Танк прокачан и снабжён, новобранец чистый
tank.gbUpgrades = { hp: 10, energy: 5, ammo: 4, crit: 8, dodge: 3, armor: 5, healCrit: 0, reward: 6 };
tank.gbBuffs = { energy: { pct: 0.25, until: Date.now() + 3600e3 } };
db.save('users');

gb.register(tank, 'guardian', []);     // hpMul 1.25, dmgReduce 0.25
gb.register(rookie, 'fighter', []);    // atkMul 1.25
const s = db.load('groupBattle', {});
s.slot = Date.now() - 1000; db.save('groupBattle'); gb.tick();

const B = UP.BASE;
const v = gb.battleState(tank);
const m = v.myStats;

console.log('\n── 1. Разбивка отдаётся владельцу ──');
ok(!!m, 'блок myStats присутствует');
ok(v.preparing === true, 'это комната подготовки');
ok(!!m.role && m.role.id === 'guardian', `роль в разбивке: ${m.role && m.role.label}`);

console.log('\n── 2. HP: слагаемые сходятся с ручным расчётом ──');
const upHp = Math.round(B.hp * (1 + 10 * 0.02));        // прокачка +20%
const finHp = Math.round(upHp * 1.25);                   // роль защитника
ok(m.hp.base === B.hp, `база: ${m.hp.base}`);
ok(m.hp.fromUpgrades === upHp - B.hp, `от улучшений: +${m.hp.fromUpgrades} (ждём +${upHp - B.hp})`);
ok(m.hp.fromRole === finHp - upHp, `от роли: +${m.hp.fromRole} (ждём +${finHp - upHp})`);
ok(m.hp.total === finHp, `итого: ${m.hp.total}`);
ok(m.hp.base + m.hp.fromUpgrades + m.hp.fromRole === m.hp.total,
   'сумма слагаемых в точности равна итогу — цифры не разъезжаются');

console.log('\n── 3. Энергия: видно и прокачку, и снабжение ──');
const upEn = Math.round(B.energy * (1 + 5 * 0.03));
const supEn = Math.round(upEn * 1.25);
ok(m.energy.fromUpgrades === upEn - B.energy, `от улучшений: +${m.energy.fromUpgrades}`);
ok(m.energy.fromSupply === supEn - upEn, `от снабжения: +${m.energy.fromSupply}`);
ok(m.energy.fromRole === 0, 'защитнику роль энергии не добавляет — показан ноль, а не выдуманная прибавка');
ok(m.energy.base + m.energy.fromUpgrades + m.energy.fromSupply + m.energy.fromRole === m.energy.total,
   'сумма слагаемых равна итогу');

console.log('\n── 4. Итог совпадает с тем, чем боец реально дерётся ──');
const f = db.load('groupBattle', {}).battle.fighters[tank.id];
ok(m.hp.total === f.maxHp, `HP в разбивке ${m.hp.total} = maxHp бойца ${f.maxHp}`);
ok(m.energy.total === f.maxEnergy, `энергия ${m.energy.total} = maxEnergy ${f.maxEnergy}`);
ok(m.ammo.total === f.maxAmmo, `боеприпасы ${m.ammo.total} = maxAmmo ${f.maxAmmo}`);

console.log('\n── 5. Боевые проценты, которых раньше не показывали ──');
ok(m.critPct === 28, `крит: ${m.critPct}% (база 20 + прокачка 8)`);
ok(m.dodgePct === 23, `уворот: ${m.dodgePct}%`);
ok(m.armorPct === 28.5, `броня: ${m.armorPct}% (прокачка 3.5 + роль 25)`);
ok(m.rewardBonusPct === 6, `к награде: ${m.rewardBonusPct}%`);
ok(m.role.dmgReducePct === 25, 'вклад роли в броню показан отдельно');

console.log('\n── 6. Новобранец видит СВОЮ разбивку, без выдуманных прибавок ──');
const v2 = gb.battleState(rookie);
const m2 = v2.myStats;
ok(m2.hp.total === B.hp, `его HP: ${m2.hp.total} — базовые`);
ok(m2.hp.fromUpgrades === 0 && m2.hp.fromRole === 0, 'прибавок нет — и показаны нули, а не пусто');
ok(m2.energy.fromSupply === 0, 'снабжения нет');
ok(m2.role.atkMul === 1.25, 'но множитель урона от роли штурмовика виден');

console.log('\n── 7. Чужие характеристики НЕ утекают ──');
const cards = v.allies.concat(v.enemies);
const forbidden = ['myStats', 'breakdown', 'st', 'critPct', 'dodgePct', 'armorPct',
                   'healCritPct', 'atkBonusPct', 'rewardBonusPct', 'maxEnergy', 'maxAmmo'];
const leaked = forbidden.filter((k) => cards.some((c) => c[k] !== undefined));
ok(leaked.length === 0, leaked.length ? `утекло: ${leaked.join(', ')}` : 'в карточках других — только имя, роль, рейтинг и HP');
ok(v2.enemies.concat(v2.allies).every((c) => c.critPct === undefined),
   'новобранец не видит характеристики танка');
ok(cards.every((c) => c.rating !== undefined), 'рейтинг при этом виден — он и раньше показывался');

console.log('\n── 8. Разбивка живёт и после старта боя ──');
const b2 = db.load('groupBattle', {}).battle;
b2.prepareUntil = Date.now() - 1; db.save('groupBattle'); gb.tick();
const v3 = gb.battleState(tank);
ok(v3.state === 'running', 'бой пошёл');
ok(!!v3.myStats && v3.myStats.hp.total === finHp, 'характеристики доступны и в бою — цифры те же');

console.log('\n── 9. Старый бой без разбивки не роняет экран ──');
const b3 = db.load('groupBattle', {}).battle;
delete b3.fighters[tank.id].breakdown;     // как будто бой начат до правки
db.save('groupBattle');
let err = null, v4 = null;
try { v4 = gb.battleState(tank); } catch (e) { err = e; }
ok(!err, err ? `упало: ${err.message}` : 'состояние отдаётся без ошибки');
ok(v4 && v4.myStats && v4.myStats.hp.total === finHp, 'итог берётся из самого бойца');

console.log('\n── 10. Интерфейс показывает разбивку, а не одно число ──');
const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/_gbMyStatsHtml/.test(war), 'карточка характеристик вынесена в отдельную функцию');
ok(/b\.myStats/.test(war), 'берёт данные из myStats, а не из карточки бойца');
ok(/улучшения/.test(war) && /снабжение/.test(war) && /роль/.test(war),
   'подписаны все три источника прибавки');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(/\.gbs-part/.test(css) && /\.gbs-chip/.test(css), 'стили слагаемых и плиток добавлены');
ok(/\.gbs-up b \{ color/.test(css) && /\.gbs-role b \{ color/.test(css),
   'источники прибавок различаются цветом');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main();
