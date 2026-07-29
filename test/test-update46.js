// ===================================================================
// test/test-update46.js — баг «наёмник не суммируется с допингом»
// Допинг «Боевой стимулятор» (+20% атака) и наёмник «Беатрис Вэйл»
// (+100% атака) должны давать вместе +120%, а не 100% или 20%.
// Проверяем оба порядка покупки, а также что источники не затирают
// друг друга (падлянки, повторные покупки, отзыв наёмника).
// Запуск: node test/test-update46.js (после npm run build)
// ===================================================================

const fs = require('fs');
const TEST_CWD = '/tmp/generals-test-cwd-46';
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
const market = require('../dist/src/services/market');
const config = require('../dist/config/gameConfig');

const STIM = config.MARKET_ITEM_BY_ID['stim'];        // +20% атака, допинг
const SABOTAGE = config.MARKET_ITEM_BY_ID['sabotage']; // −15% атака, падлянка
const BERSERK = config.COMMANDERS.find((c) => c.id === 'berserk');   // +100% атака
const TYCOON  = config.COMMANDERS.find((c) => c.id === 'tycoon');    // economy_combo
ok(STIM.effect.value === 20 && BERSERK.effect.value === 100,
   `исходные данные: допинг «${STIM.name}» +${STIM.effect.value}%, наёмник «${BERSERK.name}» +${BERSERK.effect.value}%`);

// Множитель атаки в процентах прибавки: effMul 2.2 → «+120%»
const bonusPct = (u) => Math.round((player.effMul(u, 'atk_pct') - 1) * 100);
const HOUR = 3600 * 1000;

async function main() {

await auth.register('Боец', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
await auth.register('Вредитель', 'пароль123', 'b@t.ru', 'ru', '2.2.2.2');
const users = player.users();
const byName = (n) => users[Object.keys(users).find((id) => users[id].name === n)];
const hero = byName('Боец'), foe = byName('Вредитель');
hero.gold = 99999; foe.gold = 99999;   // золото на покупки допингов и падлянок

console.log('\n── 1. Допинг, затем наёмник (жалоба игроков) ──');
hero.effects = [];
market.buyItem(hero, 'stim', '', []);
ok(bonusPct(hero) === 20, `куплен допинг: +${bonusPct(hero)}% (ждём +20%)`);
market.applyCommanderEffect(hero, BERSERK, Date.now());
ok(bonusPct(hero) === 120, `сверху наёмник: +${bonusPct(hero)}% (ждём +120%, до фикса было +100%)`);
ok(hero.effects.filter((e) => e.type === 'atk_pct').length === 2,
   'допинг и наёмник существуют как два отдельных эффекта');
ok(hero.effects.some((e) => e.merc && e.commanderId === 'berserk'),
   'эффект наёмника помечен merc/commanderId — портрет и список владельцев не сломаются');
ok(hero.effects.some((e) => !e.merc && e.id === 'stim'),
   'эффект допинга сохранил свой id — картинка предмета на месте');

console.log('\n── 2. Обратный порядок: наёмник, затем допинг ──');
hero.effects = [];
market.applyCommanderEffect(hero, BERSERK, Date.now());
ok(bonusPct(hero) === 100, `выдан наёмник: +${bonusPct(hero)}%`);
market.buyItem(hero, 'stim', '', []);
ok(bonusPct(hero) === 120, `сверху допинг: +${bonusPct(hero)}% (ждём +120%, до фикса было +20% — наёмник терялся)`);
ok(hero.effects.some((e) => e.merc && e.commanderId === 'berserk'),
   'наёмник НЕ затёрт покупкой допинга');

console.log('\n── 3. Повторная покупка того же допинга ──');
hero.effects = [];
market.buyItem(hero, 'stim', '', []);
const exp1 = hero.effects.find((e) => e.id === 'stim').expiresAt;
market.buyItem(hero, 'stim', '', []);
const stims = hero.effects.filter((e) => e.id === 'stim');
ok(stims.length === 1, 'второй такой же допинг не создаёт второй эффект');
ok(bonusPct(hero) === 20, `бонус не удваивается: +${bonusPct(hero)}% (ждём +20%)`);
ok(stims[0].expiresAt > exp1, 'время действия продлено (как было раньше)');

console.log('\n── 4. Падлянка врага ──');
hero.effects = [];
market.applyCommanderEffect(hero, BERSERK, Date.now());
market.buyItem(hero, 'stim', '', []);
foe.gold = 99999;
market.buyItem(foe, 'sabotage', 'Боец', []);   // −15% атака жертве
const hostile = hero.effects.find((e) => e.hostile);
ok(!!hostile && hostile.value === -15, 'падлянка наложена отдельным эффектом');
ok(hero.effects.some((e) => e.merc && e.commanderId === 'berserk'),
   'падлянка НЕ съела наёмника');
ok(bonusPct(hero) === 105, `итог 20 + 100 − 15 = +${bonusPct(hero)}% (ждём +105%)`);

console.log('\n── 5. Наёмник поверх падлянки ──');
hero.effects = [];
market.buyItem(foe, 'sabotage', 'Боец', []);
market.applyCommanderEffect(hero, BERSERK, Date.now());
const h2 = hero.effects.find((e) => e.hostile);
ok(!!h2 && h2.value === -15 && !h2.merc,
   'падлянка осталась падлянкой (раньше наёмник перезаписывал её в бафф с пометкой «враждебный»)');
ok(bonusPct(hero) === 85, `итог 100 − 15 = +${bonusPct(hero)}% (ждём +85%)`);

console.log('\n── 6. Отзыв наёмника админом ──');
hero.effects = [];
market.buyItem(hero, 'stim', '', []);
market.applyCommanderEffect(hero, BERSERK, Date.now());
hero.effects = hero.effects.filter((e) => e.commanderId !== BERSERK.id);  // как в adminRevokeCommander
ok(bonusPct(hero) === 20, `после отзыва наёмника остаётся допинг: +${bonusPct(hero)}% (ждём +20%)`);

console.log('\n── 7. Экономический наёмник (комбо) ──');
hero.effects = [];
market.applyCommanderEffect(hero, TYCOON, Date.now());
ok(Math.round(player.effMul(hero, 'income_pct') * 100) === 200, 'доход ×2 (+100%)');
ok(player.effMul(hero, 'upkeep_pct') === 0, 'содержание ×0 (−100%)');

console.log('\n── 8. Защита от отрицательного множителя ──');
hero.effects = [
  { id: 'x1', name: 'дебафф', type: 'atk_pct', value: -80, expiresAt: Date.now() + HOUR },
  { id: 'x2', name: 'дебафф', type: 'atk_pct', value: -60, expiresAt: Date.now() + HOUR },
];
ok(player.effMul(hero, 'atk_pct') === 0,
   'сумма −140% не даёт отрицательную атаку — множитель ограничен нулём');

console.log('\n── 9. Истёкшие эффекты не учитываются ──');
hero.effects = [
  { id: 'old', name: 'старый', type: 'atk_pct', value: 100, expiresAt: Date.now() - 1000 },
  { id: 'new', name: 'новый', type: 'atk_pct', value: 20, expiresAt: Date.now() + HOUR },
];
ok(bonusPct(hero) === 20, `просроченный бонус игнорируется: +${bonusPct(hero)}% (ждём +20%)`);

console.log('\n── 10. Влияние на боевую мощь ──');
hero.effects = [];
player.ensureUnit(hero, config.UNITS[0].id);
hero.units[config.UNITS[0].id][0] = 100;
const basePower = player.totalPower(hero, 'atk').power;
market.buyItem(hero, 'stim', '', []);
market.applyCommanderEffect(hero, BERSERK, Date.now());
const buffedPower = player.totalPower(hero, 'atk').power;
const ratio = buffedPower / basePower;
console.log(`  (мощь ${basePower} → ${buffedPower}, ×${ratio.toFixed(2)})`);
ok(Math.abs(ratio - 2.2) < 0.01, `мощь выросла в 2,2 раза (+120%), факт ×${ratio.toFixed(2)}`);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
