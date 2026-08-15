// ═══════════════════════════════════════════════════════════════════
// История ракет: журнал у обеих сторон, перехват с именем стрелка,
// ограничение по каждой вкладке отдельно и изоляция чужих журналов.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-rockethist-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const silos = require(ROOT + '/dist/src/services/silos');
const lasers = require(ROOT + '/dist/src/services/lasers');
const db = require(ROOT + '/dist/src/core/db');
const config = require(ROOT + '/dist/config/gameConfig');

const S = config.SILO;
const L = config.LASER;

// Собрать «летящую ракету» руками — чтобы не ждать 24 ч постройки шахты
function flyingRocket(att, tgt, powerFrac, impactIn) {
  const id = 'rk' + Math.random().toString(36).slice(2, 8);
  const rockets = db.load('rockets', {});
  rockets[id] = {
    id, attackerId: att.id, attackerName: att.name,
    targetId: tgt.id, targetName: tgt.name,
    launchedAt: Date.now() - 1000,
    impactAt: Date.now() + impactIn,
    powerFrac, intercepted: false, interceptedBy: null, resolved: false,
  };
  db.save('rockets');
  return id;
}

async function main() {
for (const [n, e] of [['Пускач', 'a@t.ru'], ['Мишень', 'b@t.ru'], ['Спасатель', 'c@t.ru'], ['Посторонний', 'd@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1', 'UA');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const att = by('Пускач'), tgt = by('Мишень'), sav = by('Спасатель'), out = by('Посторонний');

// Дадим цели что терять
tgt.buildings = { ...(tgt.buildings || {}) };
const someBuilding = Object.keys(config.BUILDING_BY_ID)[0];
tgt.buildings[someBuilding] = 40;
const someUnit = config.UNITS[0].id;
tgt.units = { [someUnit]: { 0: 5000, 1: 0, 2: 0 } };

console.log('\n── 1. Попадание: запись появляется у ОБЕИХ сторон ──');
const rk1 = flyingRocket(att, tgt, 1, -1);   // уже долетела
silos.resolveInFlight();

const hAtt = silos.history(att);
const hTgt = silos.history(tgt);
ok(hAtt.launched.length === 1, `у атакующего во вкладке «запущенные»: ${hAtt.launched.length}`);
ok(hAtt.incoming.length === 0, 'у атакующего вкладка «по мне» пуста');
ok(hTgt.incoming.length === 1, `у цели во вкладке «по мне»: ${hTgt.incoming.length}`);
ok(hTgt.launched.length === 0, 'у цели вкладка «запущенные» пуста');

const eA = hAtt.launched[0], eT = hTgt.incoming[0];
ok(eA.outcome === 'hit' && eT.outcome === 'hit', 'обе записи помечены как попадание');
ok(eA.targetName === 'Мишень', `атакующий видит по кому бил: «${eA.targetName}»`);
ok(eT.attackerName === 'Пускач', `цель видит кто бил: «${eT.attackerName}»`);
ok(eA.id === eT.id, 'у обеих сторон одна и та же ракета (совпадает id)');
ok(eA.powerPct === 100, `мощность записана: ${eA.powerPct}%`);
ok(typeof eA.launchedAt === 'number' && typeof eA.at === 'number', 'время пуска и время события записаны');

console.log('\n── 2. Подробности: потерянная техника и постройки ──');
ok(eT.techDestroyedCount > 0, `уничтожено техники: ${eT.techDestroyedCount}`);
ok(eT.buildingsDestroyedCount > 0, `разрушено построек: ${eT.buildingsDestroyedCount}`);
ok(Object.keys(eT.techLost || {}).length > 0, `поимённый список техники: ${Object.keys(eT.techLost).join(', ').slice(0, 40)}`);
ok(Object.keys(eT.destroyedBuildings || {}).length > 0, `поимённый список построек: ${Object.keys(eT.destroyedBuildings).join(', ').slice(0, 40)}`);
ok(eA.techDestroyedCount === eT.techDestroyedCount, 'атакующий видит те же потери, что и цель');

console.log('\n── 3. Перехват: записано что сбита и КЕМ ──');
// Спасателю — готовый лазер со 100% точностью
sav.lasers = [{
  id: 'ls1', phase: 'ready', readyAt: 0,
  readyEnergy: L.READY_ENERGY_NEEDED, powerAmmo: L.POWER_AMMO_NEEDED,
}];
const rk2 = flyingRocket(att, tgt, 0.5, 10 * 60 * 1000);
const res = lasers.intercept(sav, 'ls1', rk2, []);
ok(res.hit === true, `лазер сбил ракету (шанс ${res.chancePct}%)`);

const hAtt2 = silos.history(att);
const hTgt2 = silos.history(tgt);
ok(hAtt2.launched.length === 2, 'у атакующего добавилась вторая запись');
ok(hTgt2.incoming.length === 2, 'у цели тоже');
const iA = hAtt2.launched.find((e) => e.id === rk2);
const iT = hTgt2.incoming.find((e) => e.id === rk2);
ok(iA && iA.outcome === 'intercepted', 'атакующий видит: ракета сбита');
ok(iT && iT.outcome === 'intercepted', 'цель видит: ракета сбита');
ok(iA.interceptedByName === 'Спасатель', `записано КЕМ сбита: «${iA.interceptedByName}»`);
ok(iA.interceptedById === sav.id, 'id стрелка тоже записан');
ok(iA.targetName === 'Мишень', 'и по кому она была запущена');
ok(!iA.techDestroyedCount, 'у сбитой ракеты потерь нет');

console.log('\n── 4. Сбитая ракета не наносит урон повторно при тике ──');
const techBefore = eT.techDestroyedCount;
silos.resolveInFlight();
const hTgt3 = silos.history(tgt);
ok(hTgt3.incoming.length === 2, 'тик не добавил лишних записей о сбитой ракете');

console.log('\n── 5. Чужой журнал недоступен ──');
const hOut = silos.history(out);
ok(hOut.launched.length === 0 && hOut.incoming.length === 0, 'посторонний не видит чужих ракет');
const hSav = silos.history(sav);
ok(hSav.launched.length === 0 && hSav.incoming.length === 0,
   'сбивший тоже не получает запись — он не атакующий и не цель');

console.log('\n── 6. Лимит: вкладки не вытесняют друг друга ──');
const PER = silos.LOG_PER_SIDE;
for (let i = 0; i < PER + 10; i++) {
  const r = flyingRocket(att, tgt, 0.1, -1);
  silos.resolveInFlight();
}
const hAtt4 = silos.history(att);
const hTgt4 = silos.history(tgt);
ok(hAtt4.launched.length === PER, `у атакующего «запущенные» ограничены ${PER} (стало ${hAtt4.launched.length})`);
ok(hTgt4.incoming.length === PER, `у цели «по мне» ограничены ${PER} (стало ${hTgt4.incoming.length})`);

// Теперь пусть цель сама запустит — её вкладка «по мне» не должна пострадать
for (let i = 0; i < 5; i++) {
  const r = flyingRocket(tgt, att, 0.1, -1);
  silos.resolveInFlight();
}
const hTgt5 = silos.history(tgt);
ok(hTgt5.launched.length === 5, `у цели появились свои пуски: ${hTgt5.launched.length}`);
ok(hTgt5.incoming.length === PER, `и «по мне» осталась полной: ${hTgt5.incoming.length} — серия своих пусков её не вытеснила`);

console.log('\n── 7. Порядок: новые записи сверху ──');
const l = silos.history(att).launched;
let descending = true;
for (let i = 1; i < l.length; i++) if (l[i - 1].at < l[i].at) descending = false;
ok(descending, 'записи отсортированы от новых к старым');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main();
