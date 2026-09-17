// ═══════════════════════════════════════════════════════════════════
// test/gbbots.test.js — боты в рейтинговых боях (бывшие групповые)
//
// Решение владельца (17.09.2026): здоровье и урон бота — случайная доля
// 50–80% от СРЕДНИХ у живых игроков боя; «тупит» на 20–40% — у каждого
// бота своя сообразительность 0.6–0.8; боезапас 30 и откат 5 секунд
// остались.
//
// Что стережётся:
//  1. Все числа лежат в одном месте.
//  2. Здоровье бота — доля от среднего у живых (с их прокачкой), у
//     каждого бота своя; урон — та же доля (botPower).
//  3. Сообразительность у каждого своя, в границах; решения идут через
//     smart(p, bot).
//  4. Живого игрока правка не касается.
//  5. Удар бота ровно на botPower слабее удара человека той же роли.
//  6. Место прогульщика бьёт в полную силу — это копия человека.
//
// Запуск: node test/gbbots.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const gb = require('../dist/src/services/groupBattle');
const UP = require('../dist/src/services/groupUpgrades');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const near = (n, a, b, tol) => { assert.ok(Math.abs(a - b) <= tol, `❌ ${n}: ${a} vs ${b} (±${tol})`); passed++; console.log(`  ✅ ${n} (${a})`); };

function makeBattle(fighters) {
  const b = { id: 'test', slot: 0, startedAt: Date.now(), finishedAt: 0,
    state: 'running', fighters: {}, log: [], winnerTeam: -1, lastBotAt: 0, prepareUntil: 0 };
  for (const f of fighters) b.fighters[f.id] = f;
  return b;
}
function fighter(id, team, role, isBot, extra) {
  const base = { hp: gb.HP, energy: gb.ENERGY, ammo: isBot ? gb.BOT_AMMO : gb.AMMO,
    critChance: UP.BASE.critChance, dodgeChance: 0,
    healCritChance: 0, damageReduce: 0, rewardBonus: 0, atkBonus: 0, supEnergy: 0 };
  return Object.assign({ id, name: id, flag: '', team, role, st: base,
    hp: base.hp, maxHp: base.hp, energy: base.energy, maxEnergy: base.energy,
    ammo: base.ammo, maxAmmo: base.ammo, alive: true, seen: true, isBot,
    targetId: null, lastActionAt: 0, guardedUntil: 0, guardedBy: '',
    rating: 0, damageDealt: 0, healed: 0, absorbed: 0, kills: 0, killedBy: '', killedById: '' }, extra || {});
}

(async () => {
  await db.init();

  console.log('\n[1] Настройки в одном месте');
  eq('сила бота — от 50%', gb.BOT_STRENGTH_MIN, 0.5);
  eq('до 80% средних у живых', gb.BOT_STRENGTH_MAX, 0.8);
  eq('сообразительность — от 0.6 (тупит на 40%)', gb.BOT_SMART_MIN, 0.6);
  eq('до 0.8 (тупит на 20%)', gb.BOT_SMART_MAX, 0.8);
  eq('боезапас на бой', gb.BOT_AMMO, 30);
  eq('откат между действиями бота — 5 секунд', gb.BOT_THINK_MS, 5000);
  near('smart() учитывает сообразительность бота', gb.smart(0.5, { botSmart: 0.6 }), 0.3, 0.0001);

  console.log('\n[2] Бот — от средних у живых');
  await auth.register('Живой', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
  await auth.register('Прокачан', 'пароль123', 'b@t.ru', 'ru', '1.1.1.2');
  const [h1, h2] = Object.values(player.users());
  // Второй игрок прокачал здоровье — среднее выше базы
  h2.gbUpgrades = { hp: 25 };          // +50% здоровья
  const hp1 = UP.statsFor(h1).hp, hp2 = UP.statsFor(h2).hp;
  ok(`у прокачанного здоровья больше: ${hp2} против ${hp1}`, hp2 > hp1);
  const avgHp = (hp1 + hp2) / 2;
  const s = db.load('groupBattle', {});
  s.registered = {}; s.slot = 0;
  db.save('groupBattle');
  gb.register(h1, 'fighter', []);
  gb.register(h2, 'guardian', []);
  const st = db.load('groupBattle', {});
  st.slot = Date.now() - 1000;
  db.save('groupBattle');
  gb.tick();
  const battle = db.load('groupBattle', {}).battle;
  ok('бой собрался', !!battle);
  const bots = Object.values(battle.fighters).filter((f) => f.isBot);
  ok(`ботов в бою: ${bots.length}`, bots.length === 8);
  ok('здоровье каждого бота — 50–80% от среднего у живых',
     bots.every((f) => f.st.hp >= Math.floor(avgHp * 0.5) && f.st.hp <= Math.ceil(avgHp * 0.8)));
  ok('у ботов разное здоровье', new Set(bots.map((f) => f.st.hp)).size > 1);
  ok('урон — та же доля, что и здоровье',
     bots.every((f) => Math.abs(f.botPower - f.st.hp / avgHp) <= 0.011));
  ok('сообразительность у каждого в границах 0.6–0.8',
     bots.every((f) => f.botSmart >= 0.6 && f.botSmart <= 0.8));
  ok('и разная', new Set(bots.map((f) => f.botSmart)).size > 1);
  ok('боезапас 30', bots.every((f) => f.st.ammo === gb.BOT_AMMO));
  eq('у живого игрока здоровье — его собственное', battle.fighters[h1.id].st.hp, hp1);
  ok('у живого нет множителей бота', battle.fighters[h1.id].botPower === undefined);

  console.log('\n[3] Удар бота слабее ровно на botPower');
  const realRandom = Math.random;
  Math.random = () => 0.5;
  const b1 = makeBattle([fighter('bot1', 0, 'fighter', true, { botPower: 0.62, botSmart: 0.7 }), fighter('foe1', 1, 'fighter', false)]);
  const b2 = makeBattle([fighter('man1', 0, 'fighter', false), fighter('foe2', 1, 'fighter', false)]);
  const b3 = makeBattle([fighter('copy', 0, 'fighter', true, { replaced: true }), fighter('foe3', 1, 'fighter', false)]);
  gb.doAttack(b1, b1.fighters.bot1, b1.fighters.foe1);
  gb.doAttack(b2, b2.fighters.man1, b2.fighters.foe2);
  gb.doAttack(b3, b3.fighters.copy, b3.fighters.foe3);
  Math.random = realRandom;
  const botDmg = b1.fighters.bot1.damageDealt, manDmg = b2.fighters.man1.damageDealt;
  near(`бот ${botDmg} против человека ${manDmg}`, botDmg / manDmg, 0.62, 0.02);
  eq('место прогульщика бьёт в полную силу', b3.fighters.copy.damageDealt, manDmg);

  console.log('\n[4] Глупый бот ошибается чаще');
  // Бросок 0.35: для бота с 0.6 порог добивания 0.30 — он бьёт наугад;
  // для бота с 0.8 порог 0.40 — добивает раненого.
  const run = (smartness) => {
    const real = Math.random;
    Math.random = () => 0.35;
    const b = makeBattle([
      fighter('bb', 0, 'fighter', true, { botPower: 0.6, botSmart: smartness }),
      fighter('hurt', 1, 'fighter', false), fighter('full', 1, 'fighter', false), fighter('full2', 1, 'fighter', false),
    ]);
    b.fighters.hurt.hp = 100;
    gb.botTurn(b, Date.now());
    Math.random = real;
    return b.fighters.hurt.hp < 100;
  };
  ok('сообразительный (0.8) добивает раненого', run(0.8) === true);
  ok('глупый (0.6) бьёт наугад', run(0.6) === false);

  console.log('\n[5] Пустые боеприпасы бой не заканчивают (решение владельца)');
  ok('правила «конец по боеприпасам» нет', gb.outOfAmmo === undefined);

  const src = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
  ok('решения бота идут через smart(p, bot)',
     /Math\.random\(\) < smart\(0\.5, bot\)/.test(src) && /maxHp < smart\(0\.7, bot\)/.test(src)
     && /maxHp < smart\(0\.5, bot\)/.test(src) && /Math\.random\(\) < smart\(0\.65, bot\)/.test(src));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
