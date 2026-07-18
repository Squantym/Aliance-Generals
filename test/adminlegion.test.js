// Админ-управление легионом: уровень, слава (⭐), ресурсы, рейтинг, постройки.
// Проверяем adminLegionInfo (чтение состояния) и adminSetLegion (установка).
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const legion = require('../dist/src/services/legion');
const lb = require('../dist/src/services/legionBattle');
let passed = 0;
const ok = (n, c) => { assert.ok(c, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  const lm = db.load('legions', {});
  lm['L1'] = { id: 'L1', name: 'Тестион', leaderId: 'u1', members: ['u1'], requests: [], buildings: {}, battleBuildings: {} };
  const admin = { id: 'a1', name: 'Админ', isAdmin: true };
  const notAdmin = { id: 'u2', name: 'Юзер', isAdmin: false };

  console.log('\n[1] adminLegionInfo отдаёт состояние по умолчанию');
  let s = legion.adminLegionInfo('L1');
  eq('уровень 1', s.legionLevel, 1);
  eq('maxLevel = длине порогов славы', s.maxLevel, lb.GLORY_THRESHOLDS.length);
  eq('слава-баланс 0', s.gloryPoints, 0);
  eq('резервы 0', s.reserves, 0);
  ok('список боевых построек непустой', s.battleBuildings.length > 0);
  ok('у построек есть level и maxLevel', s.battleBuildings.every(b => 'level' in b && 'maxLevel' in b));

  console.log('\n[2] Только админ может менять');
  throws('не-админ отклонён', () => legion.adminSetLegion(notAdmin, 'L1', { reserves: 100 }, []));
  throws('несуществующий легион отклонён', () => legion.adminSetLegion(admin, 'NOPE', { reserves: 100 }, []));
  throws('пустой patch отклонён', () => legion.adminSetLegion(admin, 'L1', {}, []));

  console.log('\n[3] Установка ресурсов (абсолютные значения)');
  legion.adminSetLegion(admin, 'L1', { reserves: 5000000, ears: 42, tokens: 17, ratingPoints: 999 }, []);
  s = legion.adminLegionInfo('L1');
  eq('резервы = 5 000 000', s.reserves, 5000000);
  eq('уши = 42', s.treasuryEars, 42);
  eq('жетоны = 17', s.treasuryTokens, 17);
  eq('рейтинг = 999', s.ratingPoints, 999);

  console.log('\n[4] Установка уровня синхронизирует заработанную славу с порогом');
  legion.adminSetLegion(admin, 'L1', { level: 5 }, []);
  s = legion.adminLegionInfo('L1');
  eq('уровень = 5', s.legionLevel, 5);
  ok('заработанная слава >= порога уровня 5', s.gloryEarned >= lb.GLORY_THRESHOLDS[4]);

  console.log('\n[5] Уровень зажимается в диапазон 1..maxLevel');
  legion.adminSetLegion(admin, 'L1', { level: 999 }, []);
  s = legion.adminLegionInfo('L1');
  eq('уровень зажат до maxLevel', s.legionLevel, s.maxLevel);
  legion.adminSetLegion(admin, 'L1', { level: 0 }, []);
  s = legion.adminLegionInfo('L1');
  eq('уровень зажат снизу до 1', s.legionLevel, 1);

  console.log('\n[6] Слава: баланс и заработано ставятся отдельно');
  legion.adminSetLegion(admin, 'L1', { gloryPoints: 250, gloryEarned: 300 }, []);
  s = legion.adminLegionInfo('L1');
  eq('слава-баланс = 250', s.gloryPoints, 250);
  eq('слава-заработано = 300', s.gloryEarned, 300);

  console.log('\n[7] Установка gloryEarned без level пересчитывает уровень');
  // 300 заработанной славы: пороги [0,50,100,170,250,500,1000] → уровень 5 (>=250)
  eq('уровень пересчитан по заработанной славе (300 → 5)', s.legionLevel, lb.calcLegionLevel(300));

  console.log('\n[8] Установка уровней боевых построек с зажимом по maxLevel');
  const firstBld = s.battleBuildings[0];
  legion.adminSetLegion(admin, 'L1', { battleBuildings: { [firstBld.id]: 3 } }, []);
  s = legion.adminLegionInfo('L1');
  eq(`${firstBld.id} → ур.3`, s.battleBuildings.find(b => b.id === firstBld.id).level, 3);
  // Зажим по максимуму
  legion.adminSetLegion(admin, 'L1', { battleBuildings: { [firstBld.id]: 9999 } }, []);
  s = legion.adminLegionInfo('L1');
  eq(`${firstBld.id} зажат до maxLevel`, s.battleBuildings.find(b => b.id === firstBld.id).level, firstBld.maxLevel);

  console.log('\n[9] Пустые поля patch не трогают значения');
  const before = legion.adminLegionInfo('L1');
  legion.adminSetLegion(admin, 'L1', { reserves: '', ears: '', level: 4 }, []);
  s = legion.adminLegionInfo('L1');
  eq('резервы не изменились (пустая строка)', s.reserves, before.reserves);
  eq('уши не изменились (пустая строка)', s.treasuryEars, before.treasuryEars);
  eq('уровень изменился (задан)', s.legionLevel, 4);

  console.log('\n[10] notices заполняется описанием изменений');
  const notices = [];
  legion.adminSetLegion(admin, 'L1', { reserves: 123 }, notices);
  ok('в notices есть запись об изменении', notices.length > 0 && /Легион/.test(notices[0]));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
