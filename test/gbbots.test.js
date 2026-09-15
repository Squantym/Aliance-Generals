// ═══════════════════════════════════════════════════════════════════
// test/gbbots.test.js — боты в групповых боях слабее и глупее живых
//
// Решение владельца: в групповых боях бот бьёт на 30% слабее человека,
// а правильные решения принимает на 20% реже. ХАРАКТЕРИСТИКИ при этом
// базовые: сперва срезали и их, но владелец вернул на место — ослабить
// просил только урон.
//
// Что стережётся:
//  1. Оба числа лежат в ОДНОМ месте.
//  2. Характеристики бота НЕ тронуты: запас HP, крит, уворот, энергия и
//     боеприпасы — ровно базовые, как у неулучшенного игрока.
//  3. Живого игрока правка не касается — у него всё как было.
//  4. Урон бота ровно на 30% ниже урона человека той же роли при тех же
//     бросках костей.
//  5. Решения бота проходят через smart(): при броске между старым и
//     новым порогом бот теперь ошибается, а раньше сыграл бы правильно.
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

// Бой собираем руками: ждать набора и подготовки в тесте незачем, а
// проверяем мы арифметику боя, а не запись на него.
function makeBattle(fighters) {
  const b = { id: 'test', slot: 0, startedAt: Date.now(), finishedAt: 0,
    state: 'running', fighters: {}, log: [], winnerTeam: -1, lastBotAt: 0, prepareUntil: 0 };
  for (const f of fighters) b.fighters[f.id] = f;
  return b;
}
function fighter(id, team, role, isBot, hp) {
  // И бот, и человек выходят в бой с базовыми характеристиками: вся
  // разница между ними — множитель урона у бота.
  const base = { hp: gb.HP, energy: gb.ENERGY, ammo: gb.AMMO,
    critChance: UP.BASE.critChance, dodgeChance: 0,
    healCritChance: 0, damageReduce: 0, rewardBonus: 0, atkBonus: 0, supEnergy: 0 };
  const maxHp = hp || base.hp;
  return { id, name: id, flag: '', team, role, st: base,
    hp: maxHp, maxHp, energy: base.energy, maxEnergy: base.energy,
    ammo: base.ammo, maxAmmo: base.ammo, alive: true, seen: true, isBot,
    targetId: null, lastActionAt: 0, guardedUntil: 0, guardedBy: '',
    rating: 0, damageDealt: 0, healed: 0, absorbed: 0, kills: 0, killedBy: '', killedById: '' };
}

(async () => {
  await db.init();

  console.log('\n[1] Оба множителя заданы в одном месте');
  eq('урон ботов — минус 30%', gb.BOT_POWER_MUL, 0.7);
  eq('сообразительность — минус 20%', gb.BOT_SMART_MUL, 0.8);
  near('smart() занижает порог правильного хода', gb.smart(0.5), 0.4, 0.0001);
  near('и порог лечения', gb.smart(0.65), 0.52, 0.0001);

  console.log('\n[2] Характеристики бота в собранном бою');
  await auth.register('Живой', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
  const human = Object.values(player.users())[0];
  const s = db.load('groupBattle', {});
  s.registered = {};
  s.slot = Date.now() - 1000;
  db.save('groupBattle');
  gb.register(human, 'fighter', []);
  gb.fillWithBots(db.load('groupBattle', {}));
  const st = db.load('groupBattle', {});
  st.slot = Date.now() - 1000;
  db.save('groupBattle');
  gb.tick();
  const battle = db.load('groupBattle', {}).battle;
  ok('бой собрался', !!battle);
  const bot = Object.values(battle.fighters).find((f) => f.isBot && f.role === 'fighter');
  const me = battle.fighters[human.id];
  ok('бот в бою есть', !!bot);
  eq('запас HP бота базовый', bot.st.hp, gb.HP);
  near('шанс крита базовый', bot.st.critChance, UP.BASE.critChance, 0.0001);
  near('шанс уворота базовый', bot.st.dodgeChance, UP.BASE.dodgeChance, 0.0001);
  eq('боезапас базовый', bot.st.ammo, gb.AMMO);
  eq('энергия базовая', bot.st.energy, gb.ENERGY);
  eq('и всё это ровно то же, что у живого игрока', bot.st.hp, battle.fighters[human.id].st.hp);
  eq('у живого игрока запас прежний', me.st.hp, gb.HP);
  near('и крит прежний', me.st.critChance, UP.BASE.critChance, 0.0001);

  console.log('\n[3] Урон бота ровно на 30% ниже');
  // Броски костей фиксируем: сравниваем удар бота и человека при
  // одинаковой «случайности», иначе разницу не измерить.
  const realRandom = Math.random;
  Math.random = () => 0.5;        // без уворота, без крита, средний разброс
  const b1 = makeBattle([fighter('bot1', 0, 'fighter', true), fighter('foe1', 1, 'fighter', false)]);
  const b2 = makeBattle([fighter('man1', 0, 'fighter', false), fighter('foe2', 1, 'fighter', false)]);
  gb.doAttack(b1, b1.fighters.bot1, b1.fighters.foe1);
  gb.doAttack(b2, b2.fighters.man1, b2.fighters.foe2);
  const botDmg = b1.fighters.bot1.damageDealt;
  const manDmg = b2.fighters.man1.damageDealt;
  Math.random = realRandom;
  ok(`бот бьёт слабее: ${botDmg} против ${manDmg}`, botDmg < manDmg);
  near('разница ровно 30%', botDmg / manDmg, gb.BOT_POWER_MUL, 0.02);

  console.log('\n[4] Бот стал ошибаться в выборе цели');
  // Бросок 0.45 лежит МЕЖДУ новым порогом (0.4) и прежним (0.5): раньше
  // бот добил бы раненого, теперь бьёт наугад. Врагов трое, и «наугад»
  // при 0.45 указывает на второго по списку — здорового.
  const realRandom2 = Math.random;
  Math.random = () => 0.45;
  const b3 = makeBattle([
    fighter('bot2', 0, 'fighter', true),
    fighter('hurt', 1, 'fighter', false),
    fighter('full', 1, 'fighter', false),
    fighter('full2', 1, 'fighter', false),
  ]);
  b3.fighters.hurt.hp = 100;                 // еле живой — «умный» выбор
  b3.lastBotAt = 0;
  gb.botTurn(b3, Date.now());
  Math.random = realRandom2;
  ok('раненого не добили — бот выбрал наугад', b3.fighters.hurt.hp === 100);
  ok('удар всё-таки был', b3.fighters.full.hp < b3.fighters.full.maxHp);

  console.log('\n[5] Решения бота проходят через smart()');
  const src = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
  ok('выбор цели', /Math\.random\(\) < smart\(0\.5\)/.test(src));
  ok('порог прикрытия', /maxHp < smart\(0\.7\)/.test(src));
  ok('порог лечения', /maxHp < smart\(0\.5\)/.test(src));
  ok('вероятность лечения', /Math\.random\(\) < smart\(0\.65\)/.test(src));
  ok('урон бота срезан множителем', /me\.isBot \? BOT_POWER_MUL : 1/.test(src));
  // Единственное место, где множитель силы РАБОТАЕТ, — расчёт урона.
  // Стоит ему появиться в блоке характеристик, и характеристики бота
  // снова разойдутся с живым игроком.
  ok('множитель силы применяется только к урону',
     !/hp: Math\.round\(HP \* BOT_POWER_MUL\)/.test(src)
     && !/critChance: UP\.BASE\.critChance \* BOT_POWER_MUL/.test(src));
  ok('множители объявлены один раз',
     (src.match(/const BOT_POWER_MUL/g) || []).length === 1
     && (src.match(/const BOT_SMART_MUL/g) || []).length === 1);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
