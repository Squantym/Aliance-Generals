// Тест системы навыков:
// (1) Потолки: жестокость 90, ловкость 100 — дальше прокачка блокируется на сервере.
// (2) Энергия/здоровье/боеприпасы — без потолка (качаются выше 100).
// (3) Сброс: 1-я попытка бесплатна, далее 100 → 200 → 400 золота (×2),
//     очки возвращаются полностью, навыки обнуляются, ресурсы зажимаются.
// (4) Сброс пустых навыков запрещён (не жжёт бесплатную попытку).
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db'),
      auth = require('../dist/src/services/auth'),
      player = require('../dist/src/services/player'),
      c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил ошибку'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();

  await auth.register('Скилловик', 'password1', 's@a.com', 'ru', '1.1.1.1');
  const user = Object.values(player.users()).find(x => x.name === 'Скилловик');

  console.log('\n[1] Потолки жестокости (90) и ловкости (100)');
  eq('конфиг: потолок жестокости 90', c.SKILL_CAPS.cruelty, 90);
  eq('конфиг: потолок ловкости 100', c.SKILL_CAPS.agility, 100);

  console.log('\n[2] Прокачка до потолка и блок сверху');
  user.skillPoints = 100000;
  // Жестокость до 90 (цена 3/уровень)
  for (let i = 0; i < 90; i++) player.spendSkill(user, 'cruelty');
  eq('жестокость дошла до 90', user.skills.cruelty, 90);
  throws('91-й уровень жестокости заблокирован', () => player.spendSkill(user, 'cruelty'));
  eq('жестокость осталась 90', user.skills.cruelty, 90);

  // Ловкость до 100
  for (let i = 0; i < 100; i++) player.spendSkill(user, 'agility');
  eq('ловкость дошла до 100', user.skills.agility, 100);
  throws('101-й уровень ловкости заблокирован', () => player.spendSkill(user, 'agility'));
  eq('ловкость осталась 100', user.skills.agility, 100);

  console.log('\n[3] Энергия/здоровье/боеприпасы — без потолка (>100)');
  for (let i = 0; i < 150; i++) player.spendSkill(user, 'energy');
  ok('энергия свободно перевалила за 100', user.skills.energy === 150);
  for (let i = 0; i < 120; i++) player.spendSkill(user, 'health');
  ok('здоровье свободно перевалило за 100', user.skills.health === 120);

  console.log('\n[4] Цена сброса: бесплатно → 100 → 200 → 400 (×2)');
  eq('сброс #0 (первый) бесплатный', c.skillResetCost(0), 0);
  eq('сброс #1 стоит 100', c.skillResetCost(1), 100);
  eq('сброс #2 стоит 200', c.skillResetCost(2), 200);
  eq('сброс #3 стоит 400', c.skillResetCost(3), 400);
  eq('сброс #4 стоит 800', c.skillResetCost(4), 800);

  console.log('\n[5] Первый сброс: бесплатный, полный возврат очков, обнуление');
  // Зафиксируем вложенные очки и текущие ресурсы ДО сброса
  const spentPts = 90 * c.SKILL_COSTS.cruelty + 100 * c.SKILL_COSTS.agility
                 + 150 * c.SKILL_COSTS.energy + 120 * c.SKILL_COSTS.health;
  const ptsBefore = user.skillPoints;
  const goldBefore = user.gold = 500;
  const r1 = player.resetSkills(user);
  eq('первый сброс бесплатный (cost 0)', r1.cost, 0);
  eq('возврат очков = сумме вложенных', r1.refunded, spentPts);
  eq('очки навыков вернулись', user.skillPoints, ptsBefore + spentPts);
  eq('золото не тронуто на бесплатном сбросе', user.gold, goldBefore);
  eq('жестокость обнулена', user.skills.cruelty, 0);
  eq('ловкость обнулена', user.skills.agility, 0);
  eq('энергия обнулена', user.skills.energy, 0);
  eq('здоровье обнулено', user.skills.health, 0);
  eq('счётчик сбросов = 1', user.skillResets, 1);

  console.log('\n[6] Ресурсы зажаты по новому (упавшему) максимуму');
  const mx = player.maxima(user);
  ok('HP.cur не превышает новый максимум', user.res.hp.cur <= mx.hp);
  ok('энергия.cur не превышает новый максимум', user.res.en.cur <= mx.en);
  eq('максимум HP вернулся к базовому', mx.hp, c.PLAYER.BASE_HP);

  console.log('\n[7] Второй сброс: платный (100 золота), при нехватке — отказ');
  // Вложим что-нибудь снова
  user.skillPoints = 1000;
  for (let i = 0; i < 10; i++) player.spendSkill(user, 'cruelty'); // 10×3 = 30 очков
  user.gold = 50; // меньше 100
  throws('сброс при нехватке золота отклонён', () => player.resetSkills(user));
  eq('навыки не тронуты при отказе', user.skills.cruelty, 10);
  user.gold = 300;
  const r2 = player.resetSkills(user);
  eq('второй сброс стоит 100', r2.cost, 100);
  eq('золото списано (300 - 100)', user.gold, 200);
  eq('счётчик сбросов = 2', user.skillResets, 2);
  eq('следующий сброс будет стоить 200', r2.nextResetCost, 200);

  console.log('\n[8] Сброс пустых навыков запрещён (не жжёт попытку)');
  // Сейчас всё обнулено после r2
  throws('пустой сброс отклонён', () => player.resetSkills(user));
  eq('счётчик сбросов не вырос', user.skillResets, 2);

  console.log('\n[9] mePayload отдаёт потолки и цену сброса');
  const me = player.mePayload(user);
  eq('mePayload.skillCaps.cruelty', me.skillCaps.cruelty, 90);
  eq('mePayload.skillCaps.agility', me.skillCaps.agility, 100);
  eq('mePayload.skillResets', me.skillResets, 2);
  eq('mePayload.skillResetCost (3-й = 200)', me.skillResetCost, 200);

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
