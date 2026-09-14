// ═══════════════════════════════════════════════════════════════════
// test/battlesecret.test.js — секретные разработки в окне боя
//
// Правило:
//   • СВОИ разработки нападающий видит всегда — они и так участвуют в
//     бою целиком, а в окне их не было вовсе, и казалось, что они не
//     работают;
//   • ЧУЖИЕ закрыты, пока по цели не проведена разведка трофеем
//     «Спутник-шпион» 8 уровня и выше. Ни одна сторона не видит арсенал
//     другой просто так;
//   • разведанные числа берутся ИЗ ОТЧЁТА (они зашумлены по точности
//     трофея), а не из реального состава цели.
//
// Запуск: node test/battlesecret.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const features = require('../dist/src/services/features');
const config = require('../dist/config/gameConfig');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  const nx = [];
  let ip = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `bs${++ip}@t.ru`, 'ru', '10.0.24.' + ip);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 60; p.gold = 1000; p.dollars = 1e12; p.res.am.cur = 50;
    return p;
  };

  // Перед каждой атакой возвращаем бойца в строй: пауза между боями,
  // боеприпасы и здоровье к делу не относятся, а мешают проверке
  const ready = (p) => { p.res.am.cur = 50; p.res.hp.cur = 1000; p.lastAttackAt = 0; };
  const attacker = await reg('Нападающий');
  const victim = await reg('Оборона');
  // У обоих есть секретные разработки — и своя сверхсекретная
  // Обычная техника тоже есть: список разработок не должен мешать её
  // с танками — это разные пулы
  attacker.units = { ground_1: { 0: 40, 1: 0, 2: 0 } };
  attacker.secretDevs = { kara: 3, monolit: 2 };
  attacker.superSecret = 1;
  victim.secretDevs = { znets: 4 };
  victim.superSecret = 2;

  console.log('\n[1] Свои разработки нападающий видит');
  ready(attacker);
  let r = battle.attack(attacker, victim.id, nx);
  ok(Array.isArray(r.mySecret) && r.mySecret.length === 3,
     `в окне боя свои разработки: ${r.mySecret.map((x) => x.name + ' ×' + x.count).join(', ')}`);
  const kara = r.mySecret.find((x) => x.id === 'kara');
  ok(kara && kara.count === 3, 'количество своё, точное');
  ok(kara && kara.attack > 0 && kara.defense > 0, 'видна их сила в бою');
  ok(r.mySecret.some((x) => x.id === config.SUPER_DEV.id), 'сверхсекретная тоже в списке');
  ok(r.mySecret.every((x) => !config.UNIT_BY_ID[x.id]), 'обычная техника в список разработок не попала');
  ok((r.myArmy || []).length > 0, 'при этом сама техника показана отдельной строкой');

  console.log('\n[2] Чужие закрыты без разведки');
  ok(Array.isArray(r.enemySecret) && r.enemySecret.length === 0, 'состав врага не раскрыт');
  ok(r.enemySecretAcc === null, 'и точности разведданных нет');
  // Разведка слабым трофеем секреты не открывает
  attacker.trophies = { satellite: 7 };
  ready(attacker);
  features.spyOn(attacker, victim.id, nx);
  r = battle.attack(attacker, victim.id, nx);
  ok(r.enemySecret.length === 0 && r.enemySecretAcc === null,
     'разведка 7 уровня секретные разработки не показывает');

  console.log('\n[3] Разведка 8 уровня открывает состав');
  attacker.trophies = { satellite: 8 };
  attacker.lastSpyDay = ''; attacker.spyCount = 0;   // суточный лимит не мешает проверке
  features.spyOn(attacker, victim.id, nx);
  ready(attacker);
  r = battle.attack(attacker, victim.id, nx);
  ok(r.enemySecret.length > 0, `после разведки видно: ${r.enemySecret.map((x) => x.name).join(', ')}`);
  ok(r.enemySecretAcc !== null && r.enemySecretAcc <= 100, `точность разведданных: ${r.enemySecretAcc}%`);
  // Числа — из отчёта, а не реальные: иначе разведка обесценивается
  const rep = features.spyReport(attacker, victim.id);
  const fromReport = (rep.secretDevs || []).map((d) => d.id + ':' + d.count).sort().join(',');
  const inBattle = r.enemySecret.filter((x) => x.id !== config.SUPER_DEV.id)
    .map((x) => x.id + ':' + x.count).sort().join(',');
  ok(fromReport === inBattle, 'в бою показаны те же числа, что в разведданных');

  console.log('\n[4] Вторая сторона чужого не видит');
  // У обороняющегося разведки по нападавшему нет — его окно боя (атака в
  // ответ) чужих разработок не покажет
  ready(victim);
  const back = battle.attack(victim, attacker.id, nx);
  ok(back.enemySecret.length === 0 && back.enemySecretAcc === null,
     'обороняющийся без разведки арсенал нападавшего не видит');
  ok(back.mySecret.length === 2, 'зато видит свои: ' + back.mySecret.map((x) => x.name).join(', '));

  console.log('\n[5] Окно боя показывает это игроку');
  const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
  ok(/b\.mySecret/.test(war) && /Ваши секретные разработки/.test(war), 'свои разработки выводятся');
  ok(/b\.enemySecret/.test(war) && /Спутник-шпион/.test(war),
     'а для чужих объясняется, что нужна разведка 8 уровня');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
