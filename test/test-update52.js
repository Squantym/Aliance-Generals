// ===================================================================
// test/test-update52.js — v52:
//  3) окна результата: сейф, одно ухо / оба уха (трофей), ускользнувшая жертва
//  4) прокрутка: к результату боя после атаки; без прыжка наверх при
//     перерисовке (трофеи, спецоперации, покупка техники)
// ===================================================================
const fs = require('fs');
const TEST_CWD = '/tmp/generals-test-cwd-52';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const config = require('../dist/config/gameConfig');

const ROOT = __dirname + '/..';
const app = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
const war = fs.readFileSync(ROOT + '/public/js/screens/war.js', 'utf8');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');

async function main() {
await auth.register('Палач', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
await auth.register('Жертва', 'пароль123', 'b@t.ru', 'ru', '2.2.2.2');
const users = player.users();
const by = (n) => users[Object.keys(users).find((id) => users[id].name === n)];
const hero = by('Палач'), victim = by('Жертва');

console.log('\n── 3a. Ответ фаталити содержит детали для окна ──');
const HOUR = 3600 * 1000;
// Одно ухо: трофея «Тесак мясника» нет
hero.trophies = {};
victim.earsCurrent = 2; victim.skills.agility = 0;
hero.pendingFatality = { targetId: victim.id, name: victim.name, isBot: false, exp: Date.now() + HOUR };
const r1 = battle.fatality(hero, 'ear', []);
ok(r1.choice === 'ear', 'фаталити выполнено');
ok(r1.doubleCut === false, 'без трофея срезано ОДНО ухо (doubleCut=false) — окно скажет «Ухо отрезано»');
ok(r1.victimName === 'Жертва', `в ответе есть имя жертвы: ${r1.victimName}`);
ok(victim.earsCurrent === 1, `у жертвы осталось ушей: ${victim.earsCurrent}`);

// Оба уха: трофей на максимум
const butcher = (config.TROPHIES || []).find((t) => t.id === 'butcher' || t.effect === 'double_ear' || t.id === 'cleaver');
victim.earsCurrent = 2;
hero.trophies = {};
// Ставим все трофеи на максимальный уровень — среди них «Тесак мясника»
for (const t of (config.TROPHIES || [])) hero.trophies[t.id] = t.max || 10;
hero.pendingFatality = { targetId: victim.id, name: victim.name, isBot: false, exp: Date.now() + HOUR };
let sawDouble = false, sawSingle = false, restoredSeen = false;
for (let i = 0; i < 60; i++) {
  victim.earsCurrent = 2; victim.earsLost = 0; victim.earsLostAt = []; victim.trophies = {};
  hero.pendingFatality = { targetId: victim.id, name: victim.name, isBot: false, exp: Date.now() + HOUR };
  const r = battle.fatality(hero, 'ear', []);
  if (r.doubleCut) sawDouble = true; else sawSingle = true;
  if (r.restored) restoredSeen = true;
}
ok(sawDouble, 'с трофеем «Тесак мясника» бывает срез ОБОИХ ушей (doubleCut=true) — окно скажет об этом');
ok(typeof r1.restored === 'boolean', 'в ответе есть признак restored (жертва восстановила ухо хирургом)');

console.log('\n── 3b. Ускользнувшая жертва ──');
victim.earsCurrent = 2; victim.skills.agility = 100;   // максимальная ловкость
hero.trophies = {};
let escaped = null;
for (let i = 0; i < 60 && !escaped; i++) {
  victim.earsCurrent = 2;
  hero.pendingFatality = { targetId: victim.id, name: victim.name, isBot: false, exp: Date.now() + HOUR };
  const r = battle.fatality(hero, 'ear', []);
  if (r.escaped) escaped = r;
}
ok(!!escaped, 'ловкая жертва иногда ускользает');
ok(escaped && escaped.victimName === 'Жертва', `в ответе есть имя ускользнувшего: ${escaped && escaped.victimName}`);

console.log('\n── 3c. Фронт: окна вместо тостов ──');
ok(app.includes('_showFatalityEscaped'), 'есть окно «Жертва ускользнула» (было — короткий тост)');
ok(app.includes('Отрезаны ОБА уха'), 'окно различает срез обоих ушей');
ok(app.includes('одно ухо'), 'окно явно говорит про одно ухо');
ok(app.includes('Тесак мясника') && app.includes('сработал'), 'в окне объяснено, что сработал трофей');
ok(app.includes('полевым хирургом'), 'окно предупреждает, если жертва восстановила ухо');
ok(war.includes('showSafeResult'), 'результат взлома сейфа показывается окном');
ok(war.includes('Сигнализация') && war.includes('Взлом сорван'), 'окно сейфа различает тревогу и исчерпанные попытки');
ok(!war.includes("UI.toast(`🔓 Сейф взломан!"), 'старый тост о сейфе убран');
ok(css.includes('.safe-result'), 'стили окна сейфа добавлены');

console.log('\n── 4. Прокрутка ──');
ok(war.includes("App.rerenderTo(r.encounter ? 'war-encounter' : 'battle-result')"),
   'после атаки экран прокручивается к результату боя (или к окну сейфа/мины)');
ok(!war.includes('window.scrollTo({ top: 0, behavior: \'smooth\' })'),
   'прокрутка в самый верх после атаки убрана');
ok(war.includes('id="battle-result"'), 'у панели результата боя есть id для прокрутки');
ok(war.includes('id="war-encounter"'), 'у окна встречи (сейф/мина) есть id для прокрутки');
ok(app.includes('rerenderTo(id)'), 'добавлен App.rerenderTo — перерисовка с прокруткой к блоку');
ok(app.includes('scrollIntoView'), 'прокрутка выполняется плавно к самому блоку');
// Главное: при перерисовке контент не подменяется заглушкой (иначе прыжок наверх)
const routeBlock = app.slice(app.indexOf('  route() {'), app.indexOf('  route() {') + 3000);
ok(/if \(!preserve\) \{[\s\S]*?c\.innerHTML = '<div class="loading">/.test(routeBlock),
   'заглушка «Загрузка…» показывается только при переходе на другой экран');
ok(routeBlock.includes('сжимается до высоты'), 'причина прыжка описана в комментарии для будущих правок');
// Проверяем, что экраны действий используют перерисовку с сохранением скролла
for (const [file, label] of [['economy.js', 'экономика/техника'], ['war.js', 'война/спецоперации']]) {
  const src = fs.readFileSync(`${ROOT}/public/js/screens/${file}`, 'utf8');
  const bad = /App\.route\(\)/.test(src);
  ok(!bad, `${label}: после действий вызывается rerender, а не route (скролл сохраняется)`);
}

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
