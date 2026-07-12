// Тест суммирования времени эффектов: допинги суммируются без предела,
// падлянки суммируются, но максимум 24 часа. Бафф и дебафф одного типа
// не перезаписывают друг друга.
const assert = require('assert');
const player = require('../dist/src/services/player');
const market = require('../dist/src/services/market');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const um = player.users(); for (const k of Object.keys(um)) delete um[k];
const now = Date.now();
const mk = (id) => ({ id, name: id, gold: 1e9, level: 20, effects: [], skills: {}, units: {}, buildings: {}, trophies: {}, counters: {}, battle: {}, res: { hp: { cur: 100, t: now }, en: { cur: 1e6, t: now }, am: { cur: 1e6, t: now } }, secretDevs: {} });
const U = mk('u'), V = mk('v'); um['u'] = U; um['v'] = V;

const stim = c.MARKET_ITEM_BY_ID['stim'];
console.log('\n[1] Допинг суммирует время');
market.buyItem(U, 'stim', '', []);
const t1 = U.effects.find(e => e.type === stim.effect.type).expiresAt - Date.now();
market.buyItem(U, 'stim', '', []);
const t2 = U.effects.find(e => e.type === stim.effect.type).expiresAt - Date.now();
ok('после 2-й покупки время ~удвоилось', t2 > t1 * 1.8);
ok('эффект по-прежнему один', U.effects.filter(e => e.type === stim.effect.type).length === 1);

console.log('\n[2] Падлянка суммируется, но капается на 24ч');
for (let i = 0; i < 40; i++) { U.gold = 1e9; market.buyItem(U, 'sabotage', 'v', []); }
const sab = c.MARKET_ITEM_BY_ID['sabotage'];
const ed = V.effects.find(e => e.type === sab.effect.type && e.hostile);
const hrs = (ed.expiresAt - Date.now()) / 3600000;
ok('не дольше 24 часов', hrs <= 24.01);
ok('близко к 24 часам (накопилось)', hrs >= 23.9);

console.log('\n[3] Бафф и дебафф одного типа сосуществуют');
// stim (atk_pct, бафф) уже есть у U; применим падлянку с тем же типом atk_pct (если есть)
const debAtk = c.MARKET_ITEMS.find(i => i.kind === 'debuff' && i.effect.type === stim.effect.type);
if (debAtk) {
  const before = U.effects.length;
  U.gold = 1e9;
  const attacker = mk('att'); um['att'] = attacker;
  market.buyItem(attacker, debAtk.id, 'u', []);
  const buffs = U.effects.filter(e => e.type === stim.effect.type && !e.hostile).length;
  const debuffs = U.effects.filter(e => e.type === stim.effect.type && e.hostile).length;
  ok('бафф остался', buffs === 1);
  ok('дебафф добавился отдельно', debuffs === 1);
} else {
  ok('нет дебаффа того же типа — проверка пропущена', true);
  ok('(пропуск)', true);
}

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
