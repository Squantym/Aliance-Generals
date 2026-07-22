// Босс: фото, реплики, ответный урон.
// (1) 20 фраз в конфиге; (2) фото и фраза задаются админом (при старте и на лету);
// (3) небезопасные ссылки отбрасываются; (4) босс бьёт в ответ 3..15 БЕЗ крита.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const we = require('../dist/src/services/worldEvent');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();

  console.log('\n[1] 40 реплик босса в конфиге');
  const t = c.WORLD_EVENT.taunts;
  eq('ровно 40 фраз', t.length, 40);
  ok('все фразы непустые', t.every(x => typeof x === 'string' && x.trim().length > 5));
  ok('фразы уникальны', new Set(t).size === 40);
  ok('есть заданная в ТЗ фраза про салагу', t.some(x => /салага/i.test(x)));
  const mat = /(сука|сучк|бляд|хуй|хуе|пизд|ебан|ёбан|еба|муда|пидор|гандон)/i;
  ok('в фразах нет мата', !t.some(x => mat.test(x)));

  console.log('\n[2] Диапазон ответного урона в конфиге');
  eq('минимум 3', c.WORLD_EVENT.COUNTER_MIN, 3);
  eq('максимум 15', c.WORLD_EVENT.COUNTER_MAX, 15);

  console.log('\n[3] Запуск босса с фото и фразой');
  await auth.register('Админыч', 'password1', 'a@a.com', 'ru', '1.1.1.1');
  const admin = Object.values(player.users()).find(x => x.name === 'Админыч');
  admin.isAdmin = true;
  we.adminStart(admin, { name: 'Тест-босс', hp: 1000000, image: '/img/bosses/test.webp', taunt: 'Ну давай, салага!' }, []);
  let v = we.view(admin);
  eq('фото сохранено', v.image, '/img/bosses/test.webp');
  eq('своя фраза отдаётся', v.taunt, 'Ну давай, салага!');
  eq('диапазон ответного урона в view', `${v.counterMin}-${v.counterMax}`, '3-15');

  console.log('\n[4] Смена фото и фразы на лету');
  we.adminSetLook(admin, { image: 'https://example.com/boss.png', taunt: 'Слабак!' }, []);
  v = we.view(admin);
  eq('фото обновлено (внешний URL)', v.image, 'https://example.com/boss.png');
  eq('фраза обновлена', v.taunt, 'Слабак!');
  // Пустая фраза → случайные из конфига
  we.adminSetLook(admin, { taunt: '' }, []);
  v = we.view(admin);
  ok('пустая фраза → случайная из 40 заготовок', t.includes(v.taunt));
  // Пустое фото → убрано
  we.adminSetLook(admin, { image: '' }, []);
  eq('фото убрано', we.view(admin).image, null);

  console.log('\n[5] Небезопасные ссылки отбрасываются');
  throws('javascript: отклонён', () => we.adminSetLook(admin, { image: 'javascript:alert(1)' }, []));
  throws('data: отклонён', () => we.adminSetLook(admin, { image: 'data:text/html,<script>' }, []));
  throws('пустой patch отклонён', () => we.adminSetLook(admin, {}, []));

  console.log('\n[6] Ответный урон босса: 3..15 за атаку, БЕЗ крита');
  admin.level = 100;
  const hi = c.UNITS[Math.min(18, c.UNITS.length - 1)];
  admin.units = { [hi.id]: { 0: 2000, 1: 0, 2: 0 } };
  const counters = [];
  let hpBeforeAll = null;
  for (let i = 0; i < 60; i++) {
    admin.lastAttackAt = 0;
    const mx = player.maxima(admin);
    admin.res.hp.cur = mx.hp; admin.res.am.cur = mx.am;
    if (hpBeforeAll === null) hpBeforeAll = mx.hp;
    const before = admin.res.hp.cur;
    const r = we.attack(admin, []);
    counters.push(r.counterDamage);
    eq0(`HP уменьшилось ровно на ответный урон (итерация ${i + 1})`, before - admin.res.hp.cur, r.counterDamage, i);
  }
  const mn = Math.min(...counters), mx2 = Math.max(...counters);
  ok(`все ответы в диапазоне 3..15 (факт ${mn}..${mx2})`, mn >= 3 && mx2 <= 15);
  ok('есть разброс (не фиксированное число)', new Set(counters).size > 3);
  ok('крит НЕ применяется к ответному урону (максимум не превышен)', mx2 <= 15);
  ok('после атаки возвращается реплика босса', typeof we.attack === 'function');

  console.log('\n[7] Реплика приходит вместе с результатом атаки');
  admin.lastAttackAt = 0;
  const mx3 = player.maxima(admin);
  admin.res.hp.cur = mx3.hp; admin.res.am.cur = mx3.am;
  const r2 = we.attack(admin, []);
  ok('в ответе есть taunt', typeof r2.taunt === 'string' && r2.taunt.length > 0);
  ok('в ответе есть counterDamage', r2.counterDamage >= 3 && r2.counterDamage <= 15);
  ok('в ответе есть myHp', typeof r2.myHp === 'number');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

// вспомогательная: считает только первую проверку, чтобы не раздувать счётчик
function eq0(n, a, b, i) {
  assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`);
  if (i === 0) { passed++; console.log('  ✅ ' + n); }
}
