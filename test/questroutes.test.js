// Маршруты заданий: клик по поручению/контракту ведёт туда, где оно выполняется.
// (1) у всех 20 поручений и 8 контрактов есть route;
// (2) все маршруты ведут на СУЩЕСТВУЮЩИЕ экраны;
// (3) route соответствует счётчику задания (бой→war, банк→bank и т.д.);
// (4) route отдаётся в API;
// (5) фронт вешает переход и не ломает кнопку «Получить».
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const daily = require('../dist/src/services/dailyQuests');
const features = require('../dist/src/services/features');
const c = require('../dist/config/gameConfig');
const ROOT = process.cwd();
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

// Собираем реальные экраны из фронтенда
const screens = new Set();
for (const f of fs.readdirSync(path.join(ROOT, 'public/js/screens'))) {
  const s = fs.readFileSync(path.join(ROOT, 'public/js/screens', f), 'utf8');
  for (const m of s.matchAll(/App\.screens\.([a-zA-Z]+)\s*=/g)) screens.add(m[1]);
}

(async () => {
  await db.init();

  console.log('\n[1] У всех заданий есть маршрут');
  eq('поручений 20', c.DAILY_QUESTS.length, 20);
  ok('у каждого поручения есть route', c.DAILY_QUESTS.every(q => typeof q.route === 'string' && q.route.length));
  ok('у каждого контракта есть route', c.CONTRACTS_POOL.every(q => typeof q.route === 'string' && q.route.length));

  console.log('\n[2] Все маршруты ведут на существующие экраны');
  const bad = [...c.DAILY_QUESTS, ...c.CONTRACTS_POOL]
    .filter(q => !screens.has(String(q.route).split('/')[0]))
    .map(q => q.id + '→' + q.route);
  ok(`нет битых маршрутов (${bad.join(', ') || 'все валидны'})`, bad.length === 0);

  console.log('\n[3] Маршрут соответствует смыслу задания');
  const expect = {
    attacks: 'war', wins: 'war', fatalities: 'war', earsCut: 'war',
    missionStages: 'missions', unitsBought: 'units', buildingsBuilt: 'buildings',
    bankDeposited: 'bank/storage', clubPlayed: 'club', marketBought: 'market/buffs',
    saboteursBought: 'saboteurs',
  };
  const mism = c.DAILY_QUESTS.filter(q => expect[q.counter] && q.route !== expect[q.counter])
    .map(q => `${q.id}: ${q.counter}→${q.route}`);
  ok(`счётчик и маршрут согласованы (${mism.join(', ') || 'все ок'})`, mism.length === 0);
  ok('боевые задания ведут в «Войну»', c.DAILY_QUESTS.filter(q => q.counter === 'attacks').every(q => q.route === 'war'));
  ok('банковские — во вкладку хранилища', c.DAILY_QUESTS.filter(q => q.counter === 'bankDeposited').every(q => q.route === 'bank/storage'));

  console.log('\n[4] route отдаётся в API');
  await auth.register('Боец', 'password1', 'b@a.com', 'ru', '1.1.1.1');
  const p = Object.values(player.users()).find(x => x.name === 'Боец');
  p.level = 40;
  const list = daily.list(p);
  eq('в списке 9 поручений', list.quests.length, 9);
  ok('у каждого в API есть route', list.quests.every(q => typeof q.route === 'string' && q.route.length));
  const cts = features.contractsView(p);
  ok('у контрактов в API есть route', cts.contracts.every(ct => typeof ct.route === 'string' && ct.route.length));

  console.log('\n[5] Фронт: переход по клику + кнопка «Получить» не ломается');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok('поручение получает data-goto', /data-goto="\$\{q\.route\}"/.test(core));
  ok('контракт получает data-goto', /data-goto="\$\{ct\.route\}"/.test(core));
  ok('есть обработчик перехода', /location\.hash = '#' \+ row\.dataset\.goto/.test(core));
  ok('кнопка «Получить» не всплывает наверх (stopPropagation)', /ev\.stopPropagation\(\)/.test(core));
  ok('выполненные задания не кликабельны', /q\.route && !q\.done/.test(core));
  ok('есть подсказка перехода', /Нажмите, чтобы перейти к выполнению/.test(core));
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  ok('стиль кликабельности задан', /\.quest-clickable \{ cursor: pointer/.test(css));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
