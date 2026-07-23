// (1) Скидка на диверсантов: категория в админке + реально удешевляет
//     пачки, смертников и повышение лимитов;
// (2) Отъём ресурсов админом, включая БАНК; ниже нуля не уходит.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const saboteurs = require('../dist/src/services/saboteurs');
const discounts = require('../dist/src/services/discounts');
const admin = require('../dist/src/services/admin');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  await auth.register('Главком', 'password1', 'a@a.com', 'ru', '1.1.1.1');
  await auth.register('Боец', 'password1', 'b@a.com', 'ru', '1.1.1.2');
  const adm = Object.values(player.users()).find(x => x.name === 'Главком');
  const p = Object.values(player.users()).find(x => x.name === 'Боец');
  adm.isAdmin = true;
  p.level = 50;

  console.log('\n[1] Категория скидки «Диверсанты» есть в админке');
  const cats = discounts.categories();
  ok('категория saboteur доступна', cats.some(x => x.id === 'saboteur'));
  eq('название категории', discounts.CATEGORIES.saboteur, 'Диверсанты (пачки, смертники, лимиты)');

  console.log('\n[2] Скидка удешевляет пачку, смертников и лимиты');
  const packBefore = saboteurs.packPrice(p, 'ground');
  const upBefore = saboteurs.nextUpgradeCost(p, 'ground');
  const suicideBefore = saboteurs.view(p).suicide.priceGold;
  discounts.set('saboteur', 50, 24); // −50% на сутки
  const packAfter = saboteurs.packPrice(p, 'ground');
  const upAfter = saboteurs.nextUpgradeCost(p, 'ground');
  const suicideAfter = saboteurs.view(p).suicide.priceGold;
  ok(`пачка подешевела (${packBefore.dollars} → ${packAfter.dollars})`, packAfter.dollars < packBefore.dollars);
  ok(`апгрейд лимита подешевел (${upBefore} → ${upAfter})`, upAfter < upBefore);
  ok(`смертники подешевели (${suicideBefore} → ${suicideAfter})`, suicideAfter < suicideBefore);
  ok('скидка ≈ 50%', Math.abs(packAfter.dollars - packBefore.dollars * 0.5) <= 2);
  ok('акция видна игроку во view', saboteurs.view(p).discount && saboteurs.view(p).discount.pct === 50);

  console.log('\n[3] Покупка списывает цену СО скидкой');
  p.dollars = 1e15; p.gold = 1e9;
  const goldBefore = p.gold;
  const cashBefore = p.dollars;
  saboteurs.buyPack(p, 'ground', 1, []);
  eq('списана цена со скидкой', cashBefore - p.dollars, packAfter.dollars);
  // Смертники — за золото
  const g2 = p.gold;
  saboteurs.buySuicide(p, 1, []);
  eq('смертник по цене со скидкой', g2 - p.gold, suicideAfter);

  console.log('\n[4] Отъём ресурсов, включая банк');
  p.dollars = 1000; p.bank = 5000; p.gold = 300; p.skillPoints = 10;
  p.ears = 4; p.adminEars = 2; p.tokens = 3; p.adminTokens = 1; p.xp = 500;
  admin.take(adm, { userId: p.id, dollars: 400, bank: 2000, gold: 100, skillPoints: 3, ears: 5, tokens: 2, xp: 200 }, []);
  eq('наличные списаны', p.dollars, 600);
  eq('БАНК списан', p.bank, 3000);
  eq('золото списано', p.gold, 200);
  eq('очки навыков списаны', p.skillPoints, 7);
  eq('уши: сначала админские, потом игровые (2+3)', p.adminEars + p.ears, 1);
  eq('жетоны списаны (1 админ + 1 игровой)', p.adminTokens + p.tokens, 2);
  eq('опыт списан', p.xp, 300);

  console.log('\n[5] Ниже нуля не уходим');
  p.dollars = 100; p.bank = 50; p.gold = 5;
  admin.take(adm, { userId: p.id, dollars: 999999, bank: 999999, gold: 999999 }, []);
  eq('наличные не ушли в минус', p.dollars, 0);
  eq('банк не ушёл в минус', p.bank, 0);
  eq('золото не ушло в минус', p.gold, 0);

  console.log('\n[6] Защита');
  throws('пустое списание отклонено', () => admin.take(adm, { userId: p.id }, []));
  throws('несуществующий игрок', () => admin.take(adm, { userId: 'nope', gold: 1 }, []));

  console.log('\n[7] Выдача продолжает работать (не сломана)');
  const goldWas = p.gold;
  admin.grant(adm, { userId: p.id, gold: 777 }, []);
  eq('золото выдано', p.gold, goldWas + 777);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
