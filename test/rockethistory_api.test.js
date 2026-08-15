// Сквозная проверка маршрута /api/silos/history через настоящий HTTP.
// Сервер поднимаем В ЭТОМ ЖЕ процессе: тогда база у теста и у сервера одна
// (иначе отдельный процесс правил бы файлы, а сервер держал своё в памяти).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-rockethist-api';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.PORT = '3456';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const BASE = 'http://127.0.0.1:3456';
async function api(m, p, tok, body) {
  const r = await fetch(BASE + p, {
    method: m, headers: { 'Content-Type': 'application/json', 'x-token': tok || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  require(ROOT + '/dist/server.js');            // поднимает сервер и базу
  await new Promise((r) => setTimeout(r, 1500));

  const auth = require(ROOT + '/dist/src/services/auth');
  const player = require(ROOT + '/dist/src/services/player');
  const silos = require(ROOT + '/dist/src/services/silos');
  const config = require(ROOT + '/dist/config/gameConfig');
  const db = require(ROOT + '/dist/src/core/db');

  const A = (await auth.register('Пускач', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1')).token;
  const B = (await auth.register('Мишень', 'пароль123', 'b@t.ru', 'ru', '2.2.2.2')).token;
  const U = player.users();
  const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
  const att = by('Пускач'), tgt = by('Мишень');

  console.log('\n── 1. Маршрут закрыт для неавторизованных ──');
  const noAuth = await api('GET', '/api/silos/history', '');
  ok(noAuth.status === 401 || noAuth.status === 403, `без токена HTTP ${noAuth.status}`);

  console.log('\n── 2. Пустая история у нового игрока ──');
  const h0 = await api('GET', '/api/silos/history', A);
  ok(h0.status === 200, `HTTP ${h0.status}`);
  ok(Array.isArray(h0.data.launched) && Array.isArray(h0.data.incoming), 'обе вкладки — массивы');
  ok(!h0.data.launched.length && !h0.data.incoming.length, 'история пуста');

  console.log('\n── 3. Настоящий пуск через сервис ──');
  tgt.buildings = { [Object.keys(config.BUILDING_BY_ID)[0]]: 30 };
  tgt.units = { [config.UNITS[0].id]: { 0: 4000, 1: 0, 2: 0 } };
  att.silos = [{ id: 'silo1', rocket: {
    readyEnergy: config.SILO.READY_ENERGY_NEEDED,
    powerAmmo: config.SILO.POWER_AMMO_NEEDED, buildFinishesAt: 0 } }];

  const res = silos.launch(att, 'silo1', tgt.id, []);
  ok(res.launched === true, `ракета запущена по «${res.targetName}» (${res.powerPct}%)`);

  // Пока летит — истории ещё нет
  const mid = await api('GET', '/api/silos/history', A);
  ok(mid.data.launched.length === 0, 'летящая ракета в историю ещё не попала');

  console.log('\n── 4. Долёт → запись у обеих сторон ──');
  const rockets = db.load('rockets', {});
  const rid = Object.keys(rockets).find((k) => !rockets[k].resolved);
  rockets[rid].impactAt = Date.now() - 1;
  db.save('rockets');

  const hA = (await api('GET', '/api/silos/history', A)).data;
  const hB = (await api('GET', '/api/silos/history', B)).data;
  ok(hA.launched.length === 1, `у атакующего «Мои пуски»: ${hA.launched.length} (маршрут сам досчитал долёт)`);
  ok(hB.incoming.length === 1, `у цели «По мне»: ${hB.incoming.length}`);

  const eA = hA.launched[0], eB = hB.incoming[0];
  ok(eA.outcome === 'hit', 'итог — попадание');
  ok(eA.targetName === 'Мишень', `атакующий видит по кому бил: ${eA.targetName}`);
  ok(eB.attackerName === 'Пускач', `цель видит кто бил: ${eB.attackerName}`);
  ok(eB.techDestroyedCount > 0 && eB.buildingsDestroyedCount > 0,
     `потери в записи: техника ${eB.techDestroyedCount}, здания ${eB.buildingsDestroyedCount}`);
  ok(Object.keys(eB.techLost || {}).length > 0, 'поимённый список техники доехал до клиента');
  ok(Object.keys(eB.destroyedBuildings || {}).length > 0, 'поимённый список построек доехал');

  console.log('\n── 5. Изоляция журналов ──');
  ok(hA.incoming.length === 0, 'у атакующего «По мне» пуста');
  ok(hB.launched.length === 0, 'у цели «Мои пуски» пуста');

  console.log('\n── 6. Служебные поля не утекают ──');
  const raw = JSON.stringify(hA) + JSON.stringify(hB);
  ok(!/passHash|salt|resetToken/.test(raw), 'пароль/соль/токены в ответе отсутствуют');

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})();
