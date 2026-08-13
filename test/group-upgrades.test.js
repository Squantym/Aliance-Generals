// ═══════════════════════════════════════════════════════════════════
// Улучшения групповых боёв: цены, ступени по рангам, правило «пока не
// выкачал — дальше нельзя» и влияние на сам бой.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-gup-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 50)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const gu = require(ROOT + '/dist/src/services/groupUpgrades');
const gb = require(ROOT + '/dist/src/services/groupBattle');
const db = require(ROOT + '/dist/src/core/db');

const setRating = (id, pts) => {
  const s = db.load('groupBattle', {});
  if (!s.ratings) s.ratings = {};
  s.ratings[id] = { id, name: 'x', flag: '', points: pts, wins: 0, losses: 0,
                    kills: 0, battles: 0, damage: 0, absorbed: 0, healed: 0 };
  db.save('groupBattle');
};

async function main() {
await auth.register('Качок', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1', 'UA');
await auth.register('Обычный', 'пароль123', 'b@t.ru', 'ru', '2.2.2.2', 'UA');
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const pro = by('Качок'), plain = by('Обычный');

console.log('\n── 1. Базовые характеристики ──');
const base = gu.statsFor(plain);
ok(base.hp === 1500, `HP: ${base.hp}`);
ok(base.energy === 1000, `энергия: ${base.energy}`);
ok(base.ammo === 50, `боеприпасы: ${base.ammo}`);
ok(base.critChance === 0.20, `крит: ${base.critChance * 100}%`);
ok(base.dodgeChance === 0.20, `уворот: ${base.dodgeChance * 100}%`);
ok(gb.HP === 1500 && gb.AMMO === 50, 'бой берёт те же базовые значения');

console.log('\n── 2. Навыки ──');
ok(gu.SKILLS.length === 8, `навыков: ${gu.SKILLS.length}`);
const stepOf = (id) => gu.SKILLS.find((s) => s.id === id).step;
for (const [id, step, label] of [
  ['crit', 0.01, 'крит +1%'], ['dodge', 0.01, 'уворот +1%'],
  ['reward', 0.01, 'награда +1%'], ['healCrit', 0.01, 'крит лечения +1%'],
  ['armor', 0.007, 'снижение урона +0.7%'], ['hp', 0.02, 'HP +2%'],
  ['energy', 0.03, 'энергия +3%'], ['ammo', 3, 'боеприпасы +3'],
]) {
  ok(Math.abs(stepOf(id) - step) < 1e-9, `${label} за уровень`);
}
ok(gu.MAX_LEVEL === 50, `предел уровня: ${gu.MAX_LEVEL}`);
ok(gu.TIERS.length === 5, `ступеней: ${gu.TIERS.length}`);
ok(gu.TIERS[0].from === 1 && gu.TIERS[0].to === 10, 'первая ступень 1–10');
ok(gu.TIERS[4].from === 41 && gu.TIERS[4].to === 50, 'последняя 41–50');

console.log('\n── 3. Цены ──');
for (const [lvl, cur, res] of [[1, 500, 5], [10, 5000, 30], [41, 50000, 100], [50, 300000, 300]]) {
  const c = gu.costOf(lvl);
  ok(c.amount === cur && c.ears === res && c.tokens === res,
     `уровень ${lvl}: ${c.amount} валюты, ${c.ears} ушей, ${c.tokens} жетонов`);
}
let mono = true;
for (let l = 2; l <= 50; l++) if (gu.costOf(l).amount < gu.costOf(l - 1).amount) mono = false;
ok(mono, 'цена нигде не падает — копить ради дешёвого уровня невыгодно');
ok(gu.CURRENCY_NAME === 'Боевые очки', `валюта улучшений: ${gu.CURRENCY_NAME}`);
// Три разных ресурса, ни один не путается с другим
const costParts = gu.costOf(1);
ok(typeof costParts.amount === 'number' && typeof costParts.ears === 'number' && typeof costParts.tokens === 'number',
   'цена состоит из боевых очков, ушей и жетонов милосердия');

console.log('\n── 4. Ступени по рангу ──');
setRating(plain.id, 0);
ok(gu.levelCapFor(0) === 0, 'без рейтинга качать нечего');
ok(gu.levelCapFor(1000) === 10, 'ранг «Новички» открывает 10 уровней');
ok(gu.levelCapFor(2000) === 20, '«Опытные» — 20');
ok(gu.levelCapFor(3000) === 30, '«Продвинутые» — 30');
ok(gu.levelCapFor(4000) === 40, '«Спецотряд» — 40');
ok(gu.levelCapFor(5000) === 50, '«Элита» — все 50');
ok(gu.levelCapFor(999) === 0, 'на «Салагах» улучшений нет');
fails(() => gu.upgrade(plain, 'crit', []), 'открывается на ранге', 'без ранга улучшить нельзя');

console.log('\n── 5. Прокачка и правило ступеней ──');
setRating(pro.id, 1000);
pro.battlePoints = 1e9; pro.ears = 1e6; pro.tokens = 1e6;
for (let i = 0; i < 10; i++) gu.upgrade(pro, 'crit', []);
ok(gu.levelsOf(pro).crit === 10, 'первая ступень выкачана');
fails(() => gu.upgrade(pro, 'crit', []), 'открывается на ранге',
      'одиннадцатый уровень требует следующего ранга');
// Другие навыки при этом качаются
gu.upgrade(pro, 'hp', []);
ok(gu.levelsOf(pro).hp === 1, 'другой навык на той же ступени качается');
// С новым рангом продолжение открывается
setRating(pro.id, 2000);
gu.upgrade(pro, 'crit', []);
ok(gu.levelsOf(pro).crit === 11, 'с рангом «Опытные» одиннадцатый уровень взят');
// Но перепрыгнуть ступень нельзя: невыкачанный навык дальше не идёт
const v = gu.view(pro);
const hpSkill = v.skills.find((s) => s.id === 'hp');
ok(hpSkill.level === 1 && hpSkill.canUpgrade, 'недокачанный навык качается дальше в своей ступени');

console.log('\n── 6. Списание и нехватка ──');
const ptsBefore = pro.battlePoints, earsBefore = pro.ears, tokBefore = pro.tokens;
const goldUntouched = pro.gold, moneyUntouched = pro.dollars;
const nextCost = gu.costOf(gu.levelsOf(pro).hp + 1);
gu.upgrade(pro, 'hp', []);
ok(ptsBefore - pro.battlePoints === nextCost.amount, `списано боевых очков: ${nextCost.amount}`);
ok(earsBefore - pro.ears === nextCost.ears, `списано ушей: ${nextCost.ears}`);
ok(tokBefore - pro.tokens === nextCost.tokens, `списано жетонов милосердия: ${nextCost.tokens}`);
// Валюта новая и отдельная: обычные деньги и золото не трогаются
ok(pro.gold === goldUntouched, 'золото не расходуется');
ok(pro.dollars === moneyUntouched, 'игровые деньги тоже');
pro.ears = 0;
fails(() => gu.upgrade(pro, 'hp', []), 'ушей', 'без ушей улучшить нельзя');
pro.ears = 1e6; pro.tokens = 0;
fails(() => gu.upgrade(pro, 'hp', []), 'жетонов милосердия', 'без жетонов тоже');
pro.tokens = 1e6; pro.battlePoints = 0;
fails(() => gu.upgrade(pro, 'hp', []), 'боевых очков', 'и без боевых очков');
pro.battlePoints = 1e9;

console.log('\n── 7. Прибавки считаются верно ──');
pro.gbUpgrades = { crit: 10, dodge: 10, reward: 10, healCrit: 10, armor: 10, hp: 10, energy: 10, ammo: 10 };
const up = gu.statsFor(pro);
ok(up.hp === 1800, `HP: 1500 → ${up.hp} (+20%)`);
ok(up.energy === 1300, `энергия: 1000 → ${up.energy} (+30%)`);
ok(up.ammo === 80, `боеприпасы: 50 → ${up.ammo} (+30)`);
ok(up.critChance === 0.30, `крит: 20% → ${Math.round(up.critChance * 100)}%`);
ok(up.dodgeChance === 0.30, `уворот: 20% → ${Math.round(up.dodgeChance * 100)}%`);
ok(Math.abs(up.damageReduce - 0.07) < 1e-6, `снижение урона: ${(up.damageReduce * 100).toFixed(1)}%`);
// Базовый шанс крита лечения 20%, улучшения добавляют сверху
ok(up.healCritChance === 0.30, `крит лечения: 20% базовых + 10% от прокачки = ${up.healCritChance * 100}%`);
ok(up.rewardBonus === 0.10, `награда: +${up.rewardBonus * 100}%`);
// Потолки, чтобы прокачка не сломала бой
pro.gbUpgrades = { crit: 50, dodge: 50, armor: 50, reward: 0, healCrit: 0, hp: 0, energy: 0, ammo: 0 };
const capped = gu.statsFor(pro);
ok(capped.dodgeChance <= 0.75, `уворот ограничен сверху: ${capped.dodgeChance * 100}%`);
ok(capped.damageReduce <= 0.60, `снижение урона ограничено: ${(capped.damageReduce * 100).toFixed(0)}%`);

console.log('\n── 8. Улучшения работают в бою ──');
pro.gbUpgrades = { crit: 10, dodge: 10, reward: 10, healCrit: 10, armor: 10, hp: 10, energy: 10, ammo: 10 };
const gs = db.load('groupBattle', {});
gs.registered = {}; gs.battle = null; gs.slot = 0; db.save('groupBattle');
gb.register(pro, 'fighter', []);
gb.register(plain, 'fighter', []);
const g1 = db.load('groupBattle', {}); g1.slot = Date.now() + 1000; db.save('groupBattle'); gb.tick();
const g2 = db.load('groupBattle', {}); g2.slot = Date.now() - 1000; db.save('groupBattle'); gb.tick();
// Пропускаем подготовку: ждать 30 секунд в тесте незачем
{
  const st = db.load('groupBattle', {});
  if (st.battle && st.battle.state === 'preparing') {
    // Отмечаем всех явившимися: не открывшие комнату выбывают, а в
    // тесте комнату никто не открывает
    for (const fr of Object.values(st.battle.fighters)) fr.seen = true;
    st.battle.prepareUntil = Date.now() - 1;
    db.save('groupBattle');
    gb.tick();
  }
}
gb.enter(pro, []); gb.enter(plain, []);
// Усыпляем ботов: здесь проверяются улучшения игрока, а агрессивные
// боты успевали добить проверяющего до конца проверки
{
  const st = db.load('groupBattle', {});
  if (st.battle) {
    st.battle.lastBotAt = Date.now() + 3600000;
    db.save('groupBattle');
  }
}
const bt = db.load('groupBattle', {}).battle;
const fPro = bt.fighters[pro.id], fPlain = bt.fighters[plain.id];
ok(fPro.maxHp === 1800, `в бою у прокачанного ${fPro.maxHp} HP`);
ok(fPlain.maxHp === 1500, `у обычного ${fPlain.maxHp} HP`);
ok(fPro.maxAmmo === 80 && fPlain.maxAmmo === 50, 'боеприпасы тоже различаются');
ok(fPro.maxEnergy === 1300, 'и энергия');
// Уворот
const foe = Object.values(bt.fighters).find((f) => f.team !== fPro.team && f.alive);
foe.st = { ...foe.st, dodgeChance: 1 };
db.save('groupBattle');
let dodged = 0;
for (let i = 0; i < 5; i++) {
  const cur = db.load('groupBattle', {}).battle;
  cur.fighters[pro.id].lastActionAt = 0;
  // Боты агрессивные и могут добить проверяющего — держим его живым
  cur.fighters[pro.id].alive = true;
  cur.fighters[pro.id].hp = cur.fighters[pro.id].maxHp;
  db.save('groupBattle');
  const before = db.load('groupBattle', {}).battle.fighters[foe.id].hp;
  try { gb.act(pro, 'attack', foe.id, []); } catch (e) {}
  if (db.load('groupBattle', {}).battle.fighters[foe.id].hp === before) dodged++;
}
ok(dodged === 5, `при 100% увороте все 5 ударов мимо`);
// Крит
const c1 = db.load('groupBattle', {}).battle;
c1.fighters[foe.id].st.dodgeChance = 0;
c1.fighters[foe.id].st.damageReduce = 0;
c1.fighters[pro.id].st.critChance = 1;
c1.fighters[foe.id].hp = 1500;
c1.fighters[pro.id].lastActionAt = 0;
db.save('groupBattle');
gb.act(pro, 'attack', foe.id, []);
const critDmg = 1500 - db.load('groupBattle', {}).battle.fighters[foe.id].hp;
const c2 = db.load('groupBattle', {}).battle;
c2.fighters[pro.id].st.critChance = 0;
c2.fighters[foe.id].hp = 1500;
c2.fighters[pro.id].lastActionAt = 0;
db.save('groupBattle');
gb.act(pro, 'attack', foe.id, []);
const normDmg = 1500 - db.load('groupBattle', {}).battle.fighters[foe.id].hp;
ok(critDmg > normDmg * 1.4, `крит бьёт сильнее: ${critDmg} против ${normDmg}`);
// Крит усиливает втрое-впятеро со случайным разбросом, как на арене
ok(gu.CRIT_MIN === 3 && gu.CRIT_MAX === 5, `множитель крита: ×${gu.CRIT_MIN}–×${gu.CRIT_MAX}`);
const mults = Array.from({ length: 200 }, () => gu.critMult());
ok(Math.min(...mults) >= 3 && Math.max(...mults) <= 5, 'множитель не выходит за границы');
ok(new Set(mults.map((m) => Math.round(m * 100))).size > 50, 'значение каждый раз разное');
// Снижение урона
const c3 = db.load('groupBattle', {}).battle;
c3.fighters[foe.id].st.damageReduce = 0.5;
c3.fighters[foe.id].hp = 1500;
c3.fighters[pro.id].lastActionAt = 0;
db.save('groupBattle');
gb.act(pro, 'attack', foe.id, []);
const reduced = 1500 - db.load('groupBattle', {}).battle.fighters[foe.id].hp;
ok(reduced < normDmg, `снижение урона работает: ${reduced} вместо ${normDmg}`);
const srcGb = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
ok(/tokens = Math\.round\(tokens \* \(1 \+ rewardBonus \+ moneyBuff\)\)/.test(srcGb),
   'навык награды и усиление из базы снабжения увеличивают боевые очки');
ok(/battlePoints/.test(srcGb), 'награда начисляется в боевых очках');
ok(/UP\.critMult\(\)/.test(srcGb), 'бой берёт случайный множитель крита');
ok(/healCritChance/.test(srcGb), 'крит лечения применяется медиком');

console.log('\n── 9. Интерфейс ──');
const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/App\.renderUpgradesPage = async/.test(war), 'улучшения открываются отдельной страницей');
ok(/api\/group\/upgrades/.test(war), 'данные берутся с сервера');
ok(/gb-up/.test(war), 'кнопка улучшения у каждого навыка');
ok(/🔒 ранг/.test(war), 'заблокированное рангом помечено');
ok(/уровни \$\{t\.from\}–\$\{t\.to\}/.test(war), 'у ступеней указан диапазон уровней');
ok(/Ваши характеристики в бою/.test(war), 'показаны итоговые характеристики');
ok(/gb-wallet/.test(war), 'видно, сколько ресурсов есть');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/'\/api\/group\/upgrades'/.test(routes) && /'\/api\/group\/upgrade'/.test(routes), 'роуты есть');
const fields = fs.readFileSync(path.join(ROOT, 'src/core/playerFields.ts'), 'utf8');
ok(/gbUpgrades:/.test(fields), 'уровни зарегистрированы в реестре');
ok(/battlePoints:/.test(fields), 'новая валюта зарегистрирована');
ok(!/squadTokens/.test(fields), 'прежнее название нигде не осталось');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
