// ═══════════════════════════════════════════════════════════════════
// test/trophies293.test.js — переделка трофеев и мощь секреток (19.09.2026)
//
// Что стережётся:
//  1. Эффект: 1–9 уровни растут равномерно, 10-й — рывок. «Медаль» и
//     «Щит» — 18% на 9-м, 25% на 10-м. Потолок крита ×6 сохранён.
//  2. Подкрепление: база 1%, со «Знаменем победы» 10 ур. — 2.5%.
//  3. Цена: 1–4 ур. — доллары (100/250/450/700 единиц наземной техники
//     на уровне игрока), 5–7 — доллары (1000/1500/2500 единиц) плюс
//     гербы/жетоны (50/100/300 ±30%), 8–10 — золото 1500–7000, боевые
//     дороже хозяйственных.
//  4. Списание: все валюты проверяются до списания — при нехватке одной
//     ничего не уходит.
//  5. Секретные разработки: в профиле мощь та же, что на чёрном рынке
//     (растёт с уровнем), а не базовая из таблицы.
//
// Запуск: node test/trophies293.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const trophies = require('../dist/src/services/trophies');
const reinf = require('../dist/src/services/reinforcements');
const market = require('../dist/src/services/market');
const c = require('../dist/config/gameConfig');

let passed = 0, failed = 0;
const ok = (cond, n) => { if (cond) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, name) => {
  let err = '';
  try { fn(); } catch (e) { err = e.message; }
  ok(err.indexOf(part) >= 0, `${name}: «${err || 'ошибки не было'}»`);
};
const T = (id) => c.TROPHIES.find((t) => t.id === id);
const V = (id, l) => c.trophyValue(T(id), l);

(async () => {
  await db.init();

  console.log('\n[1] Эффект: равномерно до 9-го, рывок на 10-м');
  ok(V('medal', 9) === 18 && V('medal', 10) === 25, `«Медаль»: 9 ур. ${V('medal', 9)}%, 10 ур. ${V('medal', 10)}%`);
  ok(V('shield', 9) === 18 && V('shield', 10) === 25, `«Щит»: 9 ур. ${V('shield', 9)}%, 10 ур. ${V('shield', 10)}%`);
  ok(V('license', 10) === 200 && c.BATTLE.CRIT_MULT * (1 + V('license', 10) / 100) === 6, 'крит на 10-м — ×6, потолок владельца');
  for (const t of c.TROPHIES) {
    if (!t.perLvl) continue;                       // «текстовые» трофеи — ниже
    const steps = [];
    for (let l = 1; l <= 9; l++) steps.push(+(V(t.id, l) - V(t.id, l - 1)).toFixed(4));
    const even = steps.every((s) => s === steps[0]);
    const jump = V(t.id, 10) - V(t.id, 9);
    // Рывок — не меньше полутора обычных шагов. У трофеев восстановления
    // проценты нелинейны: 67.5% → 80% времени — это ускорение ×3.1 → ×5
    ok(even && jump >= steps[0] * 1.5, `${t.id}: шаг ${steps[0]}%, рывок 9→10 +${+jump.toFixed(2)}%`);
    ok(new RegExp('10-м').test(t.desc), `${t.id}: описание говорит о 10-м уровне`);
  }
  // «Текстовые»: медвежатник и растяжка — тоже рывок
  const BH = c.BANK_HACK, MN = c.MINES;
  ok(BH.successChancePct[10] - BH.successChancePct[9] > BH.successChancePct[9] - BH.successChancePct[8], 'Медвежатник: успех — рывок на 10-м');
  ok(BH.lootPct[10] - BH.lootPct[9] > 1, 'Медвежатник: кража — рывок на 10-м');
  ok(BH.offerChancePct(10) - BH.offerChancePct(9) > 0.9 * 3, 'Медвежатник: шанс сейфа — рывок на 10-м');
  ok(MN.triggerChancePct[10] - MN.triggerChancePct[9] > 2 && MN.techLossPct[10] - MN.techLossPct[9] > 3, 'Растяжка: рывок на 10-м');

  console.log('\n[2] Бонус в игре читается по новой шкале');
  await auth.register('Трофейщик', 'пароль123', 't293@t.ru', 'ru', '10.2.9.3');
  const U = Object.values(player.users()).find((x) => x.name === 'Трофейщик');
  U.level = 100;
  U.trophies.medal = 9;
  ok(Math.abs(trophies.atkBonus(U) - 0.18) < 1e-9, `атака на 9-м: +${Math.round(trophies.atkBonus(U) * 100)}%`);
  U.trophies.medal = 10;
  ok(Math.abs(trophies.atkBonus(U) - 0.25) < 1e-9, `атака на 10-м: +${Math.round(trophies.atkBonus(U) * 100)}%`);
  U.trophies.shield = 10;
  ok(Math.abs(trophies.defBonus(U) - 0.25) < 1e-9, 'защита на 10-м: +25%');
  U.trophies.logistics = 10;
  ok(trophies.discountPct(U, 'regen_en') === 80, 'экономический трофей на 10-м — рывок (восстановление −80%)');

  console.log('\n[3] Подкрепление: база 1%, со знаменем 10-го — 2.5%');
  U.reinforcements = [{ fromId: 'x', fromName: 'x', expiresAt: Date.now() + 3600e3 }];
  U.trophies.banner = 0;
  ok(reinf.bonusPct(U) === 1, `без знамени: ${reinf.bonusPct(U)}%`);
  U.trophies.banner = 9;
  ok(reinf.bonusPct(U) === 1.9, `знамя 9 ур.: ${reinf.bonusPct(U)}%`);
  U.trophies.banner = 10;
  ok(reinf.bonusPct(U) === 2.5, `знамя 10 ур.: ${reinf.bonusPct(U)}%`);

  console.log('\n[4] Цены по уровням');
  const unit = c.minUnitPriceAtLevel(U.level);
  const units14 = [100, 250, 450, 700];
  for (let l = 0; l < 4; l++) {
    const p = c.trophyPrice(T('medal'), l, U.level);
    ok(p.dollars === units14[l] * unit && !p.gold && !p.ears && !p.tokens, `ур. ${l + 1}: $${p.dollars} = ${units14[l]} ед. техники`);
  }
  const units57 = [1000, 1500, 2500], marks57 = [50, 100, 300];
  for (const t of c.TROPHIES) {
    for (let l = 4; l < 7; l++) {
      const p = c.trophyPrice(t, l, U.level);
      const m = p.ears + p.tokens, base = marks57[l - 4];
      const kindOk = t.marks === 'ears' ? (p.ears > 0 && !p.tokens) : t.marks === 'tokens' ? (p.tokens > 0 && !p.ears) : (p.ears > 0 && p.tokens > 0);
      if (!(p.dollars === units57[l - 4] * unit && !p.gold && kindOk && m >= base * 0.7 - 5 && m <= base * 1.3 + 5)) {
        ok(false, `${t.id} ур. ${l + 1}: ${JSON.stringify(p)}`);
      }
    }
  }
  ok(true, 'ур. 5–7: доллары + гербы/жетоны в пределах ±30% у всех трофеев');
  const muls = c.TROPHIES.map((t) => t.markMul);
  ok(muls.every((m) => m >= 0.7 && m <= 1.3) && new Set(muls).size > 3, 'разброс ±30% у разных трофеев разный');
  const kinds = new Set(c.TROPHIES.map((t) => t.marks));
  ok(kinds.has('ears') && kinds.has('tokens') && kinds.has('both'), 'есть трофеи за гербы, за жетоны и за обе валюты');
  for (const t of c.TROPHIES) {
    const g = [7, 8, 9].map((l) => c.trophyPrice(t, l, U.level));
    const bad = g.some((p) => p.dollars || p.ears || p.tokens || p.gold < 1500 || p.gold > 7000) || !(g[0].gold < g[1].gold && g[1].gold < g[2].gold);
    if (bad) ok(false, `${t.id} ур. 8–10: ${g.map((p) => p.gold).join('/')}`);
  }
  ok(true, 'ур. 8–10: только золото, 1500–7000, растёт с уровнем');
  ok(c.trophyPrice(T('medal'), 9, 1).gold === 7000, 'самый дорогой — боевой топ, 10-й уровень: 7000');
  ok(c.trophyPrice(T('medal'), 9, 1).gold > c.trophyPrice(T('tax'), 9, 1).gold, 'боевые дороже хозяйственных');
  ok(c.trophyPrice(T('medal'), 0, 150).dollars > c.trophyPrice(T('medal'), 0, 10).dollars, 'доллары растут с уровнем игрока');

  console.log('\n[5] Прокачка списывает нужные валюты');
  U.trophies.hospital = 4;             // следующий — 5-й: доллары + жетоны
  U.trophyQueue = [];
  const need = c.trophyPrice(T('hospital'), 4, U.level);
  U.dollars = need.dollars * 2; U.tokens = need.tokens - 1; U.gold = 10;
  const d0 = U.dollars;
  fails(() => trophies.startUpgrade(U, 'hospital', []), 'жетонов', 'жетонов не хватает — отказ');
  ok(U.dollars === d0 && U.trophyQueue.length === 0, 'при отказе доллары не списаны и прокачка не началась');
  U.tokens = need.tokens;
  trophies.startUpgrade(U, 'hospital', []);
  ok(U.dollars === d0 - need.dollars && U.tokens === 0 && U.gold === 10, `списано $${need.dollars} и ${need.tokens} жетонов, золото не тронуто`);
  U.trophyQueue = [];
  U.trophies.tax = 7;                  // следующий — 8-й: золото
  const g8 = c.trophyPrice(T('tax'), 7, U.level).gold;
  U.gold = g8; const dBefore = U.dollars;
  trophies.startUpgrade(U, 'tax', []);
  ok(U.gold === 0 && U.dollars === dBefore, `8-й уровень — только золото: ${g8}`);
  const view = trophies.list(U).trophies.find((t) => t.id === 'medal');
  ok(view.nextCost === null || typeof view.nextCost === 'object', 'экран получает цену по валютам');
  const m1 = trophies.list(U).trophies.find((t) => t.id === 'radar');
  ok(m1.nextCost.dollars > 0 && m1.bonusNext === 5, 'экран: цена 1-го уровня в долларах, будущий бонус по новой шкале');
  const mk = fs.readFileSync(path.join(ROOT, 'public/js/screens/market.js'), 'utf8');
  ok(mk.includes('costStr(t.baseNextCost, t.nextCost)'), 'кнопка прокачки показывает все валюты');

  console.log('\n[6] Мощь секретных разработок в профиле = на рынке');
  U.level = 120; U.superSecret = 2;
  U.secretDevs = { kara: 3 };
  const mv = market.containersView(U).collection.find((x) => x.id === 'kara');
  const prof = player.publicProfile(U, U);
  const pd = (prof.secretDevs || []).find((x) => x.id === 'kara');
  ok(mv.atkNow > c.SECRET_DEV_BY_ID.kara.atk, `на рынке мощь выросла с уровнем: ${mv.atkNow} > ${c.SECRET_DEV_BY_ID.kara.atk}`);
  ok(pd && pd.attack === mv.atkNow && pd.defense === mv.defNow, `в профиле та же мощь: ${pd && pd.attack}/${pd && pd.defense}`);
  ok(prof.superDevInfo && prof.superDevInfo.attack === c.secretAtk(U, c.SUPER_DEV), 'сверхсекретная в профиле — тоже с уровнем');

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
