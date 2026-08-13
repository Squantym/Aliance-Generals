// ═══════════════════════════════════════════════════════════════════
// База снабжения: три торговца, пороги по рейтингу, покупка усилений
// и их действие в бою.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-supply-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 46)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const sup = require(ROOT + '/dist/src/services/groupSupply');
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
await auth.register('Покупатель', 'пароль123', 'b@t.ru', 'ru', '1.1.1.1', 'UA');
const me = Object.values(player.users())[0];
me.battlePoints = 100000;

console.log('\n── 1. Торговцы ──');
ok(sup.TRADERS.length === 3, `торговцев: ${sup.TRADERS.length}`);
const [pavel, nicole, peace] = sup.TRADERS;
ok(pavel.name === 'Павел Терентич' && pavel.need === 500, `${pavel.name} — с рейтинга ${pavel.need}`);
ok(nicole.name === 'Николь Колман' && nicole.need === 1500, `${nicole.name} — с рейтинга ${nicole.need}`);
ok(peace.name === 'Миротворец' && peace.need === 3000, `${peace.name} — с рейтинга ${peace.need}`);
ok(pavel.need < nicole.need && nicole.need < peace.need,
   'пороги идут по возрастанию — сильнее товар, выше требование');

console.log('\n── 2. Товары ──');
const item = (id) => sup.ALL_ITEMS[id];
// Павел
ok(item('p_money').pct === 0.25 && item('p_money').minutes === 15 && item('p_money').price === 50,
   `Павел: +25% валюты на 15 мин за 50 очков`);
// Николь
ok(item('n_money').pct === 0.35 && item('n_money').minutes === 30 && item('n_money').price === 100,
   'Николь: +35% валюты на 30 мин за 100 очков');
ok(item('n_attack').pct === 0.30 && item('n_attack').minutes === 20 && item('n_attack').price === 80,
   'Николь: +30% атаки на 20 мин за 80 очков');
ok(item('n_energy').pct === 0.50 && item('n_energy').minutes === 20 && item('n_energy').price === 75,
   'Николь: +50% энергии на 20 мин за 75 очков');
// Миротворец
ok(item('pm_money').pct === 0.50 && item('pm_money').minutes === 45 && item('pm_money').price === 300,
   'Миротворец: +50% валюты на 45 мин за 300 очков');
ok(item('pm_attack').pct === 0.50 && item('pm_attack').minutes === 30 && item('pm_attack').price === 500,
   'Миротворец: +50% атаки на 30 мин за 500 очков');
ok(item('pm_energy').pct === 1.00 && item('pm_energy').minutes === 30 && item('pm_energy').price === 500,
   'Миротворец: +100% энергии на 30 мин за 500 очков');
ok(item('pm_crit').pct === 0.30 && item('pm_crit').minutes === 30 && item('pm_crit').price === 450,
   'Миротворец: +30% крита на 30 мин за 450 очков');
ok(item('pm_dodge').pct === 0.30 && item('pm_dodge').minutes === 30 && item('pm_dodge').price === 470,
   'Миротворец: +30% уворота на 30 мин за 470 очков');

console.log('\n── 3. Бонусов к рейтингу нет ──');
// Рейтинг — мера мастерства: если его покупать, ранг перестаёт что-то значить
const kinds = new Set();
for (const t of sup.TRADERS) for (const it of t.items) kinds.add(it.kind);
ok(!kinds.has('rating'), `виды усилений: ${[...kinds].join(', ')} — рейтинга среди них нет`);

console.log('\n── 4. Доступ по рейтингу ──');
setRating(me.id, 0);
fails(() => sup.buy(me, 'p_money', []), 'торгует с рейтинга', 'без рейтинга не продают');
setRating(me.id, 600);
const before = me.battlePoints;
sup.buy(me, 'p_money', []);
ok(before - me.battlePoints === 50, `списано ровно ${before - me.battlePoints} очков`);
fails(() => sup.buy(me, 'n_attack', []), 'торгует с рейтинга',
      'товар Николь недоступен при рейтинге 600');
fails(() => sup.buy(me, 'pm_attack', []), 'торгует с рейтинга',
      'товар Миротворца тоже');
setRating(me.id, 5000);
sup.buy(me, 'pm_attack', []);
ok(true, 'при высоком рейтинге доступны все');
me.battlePoints = 10;
fails(() => sup.buy(me, 'pm_energy', []), 'Не хватает боевых очков', 'без очков не купить');
me.battlePoints = 100000;

console.log('\n── 5. Действующие усиления ──');
const v = sup.view(me);
ok(v.active.length >= 2, `действует усилений: ${v.active.length}`);
ok(v.active.every((a) => a.leftSec > 0), 'у каждого показан остаток времени');
ok(sup.bonus(me, 'money') === 0.25, `бонус к валюте: ${sup.bonus(me, 'money') * 100}%`);
ok(sup.bonus(me, 'attack') === 0.50, `бонус к атаке: ${sup.bonus(me, 'attack') * 100}%`);
ok(sup.bonus(me, 'dodge') === 0, 'некупленное усиление не действует');
// Истёкшее не считается
const buffs = sup.buffsOf(me);
buffs.money.until = Date.now() - 1000;
ok(sup.bonus(me, 'money') === 0, 'истёкшее усиление перестаёт действовать');
ok(!sup.buffsOf(me).money, 'и вычищается из хранилища');

console.log('\n── 6. Покупка того же вида продлевает ──');
sup.buy(me, 'pm_money', []);
const until1 = sup.buffsOf(me).money.until;
sup.buy(me, 'pm_money', []);
const until2 = sup.buffsOf(me).money.until;
ok(until2 > until1, 'срок продлевается, а не начинается заново');
ok(Math.round((until2 - until1) / 60000) === 45, `добавилось ${Math.round((until2 - until1) / 60000)} минут`);

console.log('\n── 7. Усиления работают в бою ──');
await auth.register('Обычный', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1', 'UA');
const U = player.users();
const plain = Object.values(U).find((p) => p.name === 'Обычный');
// Чистим и покупаем заново
me.gbBuffs = {};
me.battlePoints = 100000;
sup.buy(me, 'pm_energy', []);
sup.buy(me, 'pm_crit', []);
sup.buy(me, 'pm_dodge', []);
sup.buy(me, 'pm_attack', []);
const gs = db.load('groupBattle', {});
gs.registered = {}; gs.battle = null; gs.slot = 0;
db.save('groupBattle');
gb.register(me, 'fighter', []);
gb.register(plain, 'fighter', []);
const st = db.load('groupBattle', {});
st.slot = Date.now() - 1000;
db.save('groupBattle');
gb.tick();
{
  const s2 = db.load('groupBattle', {});
  if (s2.battle) {
    for (const f of Object.values(s2.battle.fighters)) f.seen = true;
    if (s2.battle.state === 'preparing') s2.battle.prepareUntil = Date.now() - 1;
    db.save('groupBattle');
    gb.tick();
  }
}
const b = db.load('groupBattle', {}).battle;
const mine = b.fighters[me.id];
const other = b.fighters[plain.id];
ok(mine.maxEnergy === 2000, `энергия с усилением: ${mine.maxEnergy} против ${other.maxEnergy}`);
ok(mine.st.critChance === 0.50, `крит: ${mine.st.critChance * 100}% против ${other.st.critChance * 100}%`);
ok(mine.st.dodgeChance === 0.50, `уворот: ${mine.st.dodgeChance * 100}%`);
ok(mine.st.healCritChance === 0.50, `крит лечения тоже поднялся: ${mine.st.healCritChance * 100}%`);
ok(mine.st.atkBonus === 0.50, `прибавка к урону: ${mine.st.atkBonus * 100}%`);
const srcGb = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
ok(/\* \(1 \+ \(mySt\.atkBonus \|\| 0\)\)/.test(srcGb), 'прибавка к урону применяется при ударе');
ok(/moneyBuff = require\('\.\/groupSupply'\)\.bonus/.test(srcGb),
   'усиление валюты учитывается при начислении награды');

console.log('\n── 8. Интерфейс ──');
const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/App\.renderSupplyPage = async/.test(war), 'страница базы снабжения есть');
ok(/api\/group\/supply/.test(war), 'данные берутся с сервера');
ok(/sup-go/.test(war), 'кнопка покупки у каждого товара');
ok(/Действует сейчас/.test(war), 'показаны действующие усиления');
ok(/data-buff-until/.test(war), 'остаток времени тикает');
ok(/уже действует — покупка продлит/.test(war), 'подписано, что покупка продлевает');
ok(/🔒 рейтинг/.test(war), 'закрытые торговцы помечены');
ok(!/Содержимое появится позже/.test(war), 'заглушка убрана');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/'\/api\/group\/supply'/.test(routes) && /'\/api\/group\/supply\/buy'/.test(routes), 'роуты есть');
const fields = fs.readFileSync(path.join(ROOT, 'src/core/playerFields.ts'), 'utf8');
ok(/gbBuffs:/.test(fields), 'усиления зарегистрированы в реестре');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
