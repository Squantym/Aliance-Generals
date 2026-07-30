// ===================================================================
// test/test-update54.js — v54:
//  1) Рейтинг: стабильные места (нет скачков при равных очках) + дедуп
//  2) Портреты заказчиков вместо эмодзи-иконок в поручениях
// ===================================================================
const fs = require('fs');
const TEST_CWD = '/tmp/generals-test-cwd-54';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const seasons = require('../dist/src/services/seasons');
const db = require('../dist/src/core/db');
const c = require('../dist/config/gameConfig');
const ROOT = __dirname + '/..';

async function main() {
// 12 игроков: у трёх есть очки, у остальных нули — как на проде после сброса
const names = ['Первый', 'Второй', 'Третий', 'Гамма', 'Дельта', 'Эпсилон', 'Зета', 'Эта', 'Тета', 'Йота', 'Каппа', 'Лямбда'];
for (let i = 0; i < names.length; i++) {
  await auth.register(names[i], 'пароль123', `p${i}@t.ru`, 'ru', `1.1.1.${i}`);
}
const users = player.users();
const by = (n) => users[Object.keys(users).find((id) => users[id].name === n)];
const me = by('Первый');

console.log('\n── 1. Места не скачут при равных очках ──');
// Даём очки только трём, остальным — нули
seasons.onFatalityEar(by('Первый'));
for (let i = 0; i < 5; i++) seasons.onFatalityEar(by('Второй'));
for (let i = 0; i < 3; i++) seasons.onFatalityEar(by('Третий'));

const snapshots = [];
for (let attempt = 0; attempt < 6; attempt++) {
  // Имитируем перезагрузку коллекции с другим порядком ключей (как из Mongo)
  const store = db.load('users', {});
  const entries = Object.entries(store).sort(() => Math.random() - 0.5);
  const reordered = {};
  for (const [k, v] of entries) reordered[k] = v;
  db.reset ? db.reset('users', reordered) : null;
  Object.keys(store).forEach((k) => delete store[k]);
  Object.assign(store, reordered);

  const view = seasons.view(me);
  const ears = view.categories.find((x) => x.id === 'ears') || view.categories[0];
  snapshots.push(ears.top.map((p) => p.name).join('|'));
}
const allSame = snapshots.every((x) => x === snapshots[0]);
console.log(`  (порядок при 6 перезагрузках: ${allSame ? 'одинаковый' : 'РАЗНЫЙ'})`);
ok(allSame, 'порядок в топе стабилен при любом порядке ключей в базе');
if (!allSame) snapshots.forEach((s, i) => console.log(`    ${i + 1}: ${s.slice(0, 80)}`));

const view = seasons.view(me);
const ears = view.categories.find((x) => x.id === 'ears') || view.categories[0];
ok(ears.top[0].name === 'Второй' && ears.top[0].value === 5, `первое место у лидера (${ears.top[0].name}, ${ears.top[0].value})`);
ok(ears.top[1].name === 'Третий', `второе место (${ears.top[1].name})`);
ok(ears.top[2].name === 'Первый', `третье место (${ears.top[2].name})`);

console.log('\n── 2. Один игрок — одно место ──');
const idsInTop = ears.top.map((p) => p.id);
ok(new Set(idsInTop).size === idsInTop.length, `в топе ${idsInTop.length} записей и все разные — дублей нет`);
const names20 = ears.top.map((p) => p.name);
ok(new Set(names20).size === names20.length, 'одинаковых имён в выдаче нет');

console.log('\n── 3. Призёров недели тоже выбирает не случай ──');
// Прогоняем штатное завершение недели несколько раз: очки одинаковые,
// значит и состав призёров должен совпадать до порядка мест
const winnersRuns = [];
for (let attempt = 0; attempt < 4; attempt++) {
  // Восстанавливаем одинаковую картину очков перед каждым прогоном
  seasons.onFatalityEar(by('Первый'));
  for (let i = 0; i < 5; i++) seasons.onFatalityEar(by('Второй'));
  for (let i = 0; i < 3; i++) seasons.onFatalityEar(by('Третий'));
  // Перемешиваем порядок ключей — имитация свежей загрузки из Mongo
  const store = db.load('users', {});
  const entries = Object.entries(store).sort(() => Math.random() - 0.5);
  const reordered = {};
  for (const [k, v] of entries) reordered[k] = v;
  Object.keys(store).forEach((k) => delete store[k]);
  Object.assign(store, reordered);

  const res = seasons.adminForceRollover(me, []);
  const w = (res.winners && res.winners.ears) || [];
  // Сравниваем ПОРЯДОК призёров: суммы очков между прогонами отличаются
  // (первый прогон наследует очки предыдущего блока), а вот кто на каком
  // месте — должно совпадать всегда
  winnersRuns.push(w.map((x) => x.name).join(','));
}
console.log(`  (составы призёров: ${winnersRuns.map((x, i) => `#${i + 1} [${x}]`).join(' ')})`);
ok(new Set(winnersRuns).size === 1, 'состав и порядок призёров одинаковы при повторных завершениях недели');
ok(winnersRuns.every((r) => r.split(',')[0] === 'Второй'), `первое место у настоящего лидера во всех прогонах: ${winnersRuns[0].split(',')[0]}`);

console.log('\n── 4. Фронт рейтинга: место видно явно ──');
const core = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
const winnersBlock = core.slice(core.indexOf('Итоги прошлой недели'), core.indexOf('Итоги прошлой недели') + 900);
ok(winnersBlock.includes('rank-num'), 'у победителей прошлой недели показан номер места, а не только медаль');
const topBlock = core.slice(core.indexOf('cat.top.map'), core.indexOf('cat.top.map') + 700);
ok(topBlock.includes('rank-num'), 'в текущем топе номер места виден у всех, включая первую тройку');
ok(core.includes('Завершённый зачёт'), 'подписано, что блок победителей — это прошлая неделя');

console.log('\n── 5. Портреты заказчиков ──');
const chars = [...new Set(c.DAILY_QUESTS.map((q) => q.char).concat(c.WEEKLY_QUESTS.map((q) => q.char)).concat(c.CONTRACTS_POOL.map((q) => q.char)))].filter(Boolean);
console.log(`  (заказчиков в поручениях и контрактах: ${chars.length} — ${chars.join(', ')})`);
let allImg = true;
for (const ch of chars) {
  const p = `${ROOT}/public/img/instructors/${ch}.webp`;
  if (!fs.existsSync(p)) { allImg = false; console.log(`    ❌ нет портрета: ${ch}`); }
}
ok(allImg, 'портрет есть у КАЖДОГО заказчика — и в дневных, и в недельных, и в контрактах');
const sizes = chars.map((ch) => fs.statSync(`${ROOT}/public/img/instructors/${ch}.webp`).size);
ok(Math.max(...sizes) < 60 * 1024, `самый тяжёлый портрет ${Math.round(Math.max(...sizes) / 1024)} КБ — годится для показа в списке`);
ok(core.includes('App.instrImg(q.char, 26)'), 'в строке названия поручения стоит портрет заказчика вместо эмодзи');
ok(core.includes('ct.char ? App.instrImg(ct.char, 58)'), 'у контрактов портрет заказчика тоже на месте');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(css.includes('.name > .ic-instr'), 'портрет в строке названия выровнен по тексту');

console.log('\n── 6. В архиве нет файлов с описанием изменений ──');
const stray = fs.readdirSync(ROOT).filter((f) => /^ИЗМЕНЕНИЯ/i.test(f));
ok(stray.length === 0, stray.length ? `остались: ${stray.join(', ')}` : 'файлов ИЗМЕНЕНИЯ_*.md в проекте нет');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
