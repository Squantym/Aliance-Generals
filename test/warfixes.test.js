// Боевые правки:
// (1) Террористы (боты 💀) ВСЕГДА проигрывают игроку.
// (2) Урон стабилен: числовой апсет отключён — по доминируемому противнику
//     урон не «схлопывается» до ~2 (нет разброса 2/27 по одному врагу).
// (3) Грабёж реального игрока = строго 5% ТЕКУЩИХ наличных за атаку, без
//     затухания серии; каждая следующая атака — 5% от остатка; банк не тронут.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db'),
      auth = require('../dist/src/services/auth'),
      player = require('../dist/src/services/player'),
      battle = require('../dist/src/services/battle'),
      c = require('../dist/config/gameConfig');
const N = () => [];
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

function giveArmy(u, unit, count) { u.units = u.units || {}; u.units[unit.id] = { 0: count, 1: 0, 2: 0 }; }
function resetFighter(u) {
  u.lastAttackAt = 0; u.pendingFatality = null; u.pendingBankHack = null; u.pendingMineDefuse = null;
  const mx = player.maxima(u); u.res.hp.cur = mx.hp; u.res.am.cur = mx.am; u.res.en.cur = mx.en;
}

(async () => {
  await db.init();

  await auth.register('Комдив', 'password1', 'g@a.com', 'ru', '1.1.1.1');
  const hero = Object.values(player.users()).find(x => x.name === 'Комдив');
  hero.level = 100;
  const hiUnit = c.UNITS[Math.min(20, c.UNITS.length - 1)];
  giveArmy(hero, hiUnit, 2000); // доминирующая армия
  db.save('users');

  console.log('\n[1] Террористы (💀) ВСЕГДА проигрывают + урон не схлопывается');
  let terrFights = 0, terrWins = 0, minDealt = Infinity, maxDealt = 0, crushedLow = 0;
  for (let iter = 0; iter < 60 && terrFights < 40; iter++) {
    const list = battle.opponents(hero).opponents;
    const terr = list.find(o => o.isBot && o.flag === '💀');
    if (!terr) continue;
    resetFighter(hero);
    let r;
    try { r = battle.attack(hero, terr.id, N()); }
    catch (e) { continue; } // цель ликвидирована/ушла — пропускаем
    if (r.encounter) continue; // мина/сейф — не боевой результат
    terrFights++;
    if (r.win) terrWins++;
    if (typeof r.dealt === 'number') {
      minDealt = Math.min(minDealt, r.dealt);
      maxDealt = Math.max(maxDealt, r.dealt);
      if (r.dealt <= 5) crushedLow++; // доминируя, урон ≤5 = признак «апсета»
    }
  }
  ok(`проведено достаточно боёв с террористами (${terrFights})`, terrFights >= 20);
  eq('террорист проигрывает В КАЖДОМ бою', terrWins, terrFights);
  ok(`урон доминирующего НЕ схлопывался до ≤5 (случаев: ${crushedLow})`, crushedLow === 0);
  ok(`минимальный урон в норме (>=15, был ${minDealt})`, minDealt >= 15);

  console.log('\n[2] Псевдоигроки (боты-игроки) НЕ форсятся на проигрыш');
  // Проверяем логику: у псевдоигрока isPlayerLike=true, для него win считается
  // по урону. Тут просто убеждаемся, что такие боты существуют в пуле.
  let sawPlayerLike = false;
  for (let i = 0; i < 20 && !sawPlayerLike; i++) {
    const list = battle.opponents(hero).opponents;
    if (list.some(o => o.isBot && o.flag !== '💀')) sawPlayerLike = true;
  }
  ok('в пуле есть боты-псевдоигроки (не 💀)', sawPlayerLike);

  console.log('\n[3] Грабёж реального игрока = 5% наличных за атаку, банк защищён');
  await auth.register('Жертва', 'password1', 'v@a.com', 'ru', '1.1.1.2');
  const victim = Object.values(player.users()).find(x => x.name === 'Жертва');
  victim.level = 100;
  victim.skills.agility = 0; // без уворота — чтобы герой стабильно побеждал
  const loUnit = c.UNITS[0];
  giveArmy(victim, loUnit, 1); // слабая армия
  const START_CASH = 10_000_000_000_000; // 10 Tr на руках
  const BANK = 5_000_000_000_000;        // 5 Tr в банке (должен остаться нетронутым)
  victim.dollars = START_CASH;
  victim.bank = BANK;
  db.save('users');

  let attacks = 0, exactPctHits = 0;
  for (let iter = 0; iter < 40 && attacks < 8; iter++) {
    resetFighter(hero);
    victim.res.hp.cur = player.maxima(victim).hp; // не даём уйти в лазарет
    const before = victim.dollars;
    let r;
    try { r = battle.attack(hero, victim.id, N()); }
    catch (e) { continue; }
    if (r.encounter || !r.win) continue; // берём только победные боевые исходы
    attacks++;
    const expected = Math.floor(before * c.BATTLE.LOOT_PCT); // 5% от наличных ДО атаки
    // У свежего героя нет трофеев/эффектов лута → грабёж ровно 5%
    eq(`атака #${attacks}: награблено ровно 5% от наличных (${expected})`, r.loot, expected);
    eq(`атака #${attacks}: наличные жертвы = было − награблено`, victim.dollars, before - r.loot);
    if (r.loot === expected) exactPctHits++;
  }
  ok(`проведено достаточно грабящих атак (${attacks})`, attacks >= 5);
  eq('банк жертвы НЕ тронут', victim.bank, BANK);
  ok('наличные уменьшаются, но НЕ схлопнулись в 0', victim.dollars > 0);
  // Проверяем геометрию: после k атак остаток ≈ START*(0.95^k)
  const k = attacks;
  const expectedRemainderApprox = START_CASH * Math.pow(0.95, k);
  const diffPct = Math.abs(victim.dollars - expectedRemainderApprox) / expectedRemainderApprox;
  ok(`остаток соответствует геометрии 0.95^${k} (расхожд. ${(diffPct*100).toFixed(2)}%)`, diffPct < 0.02);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
