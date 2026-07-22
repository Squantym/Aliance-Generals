// Титулы уровней достижений:
// (1) у каждого из 19 достижений ровно 5 УНИКАЛЬНЫХ титулов (95 всего);
// (2) можно выбрать ЛЮБОЙ открытый уровень, не только старший;
// (3) закрытый уровень выбрать нельзя;
// (4) титул можно снять;
// (5) экран отдаёт названия титулов и рендерит кнопку на каждый уровень;
// (6) на широком экране (ПК) иконки крупнее — есть медиазапрос.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const ach = require('../dist/src/services/achievements');
const features = require('../dist/src/services/features');
const c = require('../dist/config/gameConfig');
const ROOT = process.cwd();
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();

  console.log('\n[1] У каждого достижения 5 уникальных титулов');
  eq('достижений 19', c.ACHIEVEMENTS.length, 19);
  ok('у каждого ровно 5 титулов', c.ACHIEVEMENTS.every(a => (a.titles || []).length === 5));
  ok('внутри достижения титулы не повторяются', c.ACHIEVEMENTS.every(a => new Set(a.titles).size === 5));
  ok('титулы непустые', c.ACHIEVEMENTS.every(a => a.titles.every(t => typeof t === 'string' && t.trim().length > 1)));
  const all = c.ACHIEVEMENTS.flatMap(a => a.titles);
  eq('всего титулов 95', all.length, 95);

  console.log('\n[2] Выбор ЛЮБОГО открытого уровня, не только старшего');
  await auth.register('Титулыч', 'password1', 't@a.com', 'ru', '1.1.1.1');
  const u = Object.values(player.users()).find(x => x.name === 'Титулыч');
  // Прокачиваем «Ликвидатор» (wins) на все 5 этапов
  u.counters.wins = 10_000_000; ach.check(u, []);
  eq('достижение wins прокачано до 5', u.achStages.wins, 5);
  // Выбираем МЛАДШИЙ титул (уровень 1) — раньше UI умел только старший
  features.setTitle(u, 'wins:0', []);
  eq('активен титул 1 уровня', u.activeTitle, 'wins:0');
  eq('имя активного титула = «Боец»', features.activeTitleName(u), c.ACHIEVEMENTS.find(a=>a.id==='wins').titles[0]);
  // Средний уровень
  features.setTitle(u, 'wins:2', []);
  eq('активен титул 3 уровня', u.activeTitle, 'wins:2');
  eq('имя = 3-й титул', features.activeTitleName(u), c.ACHIEVEMENTS.find(a=>a.id==='wins').titles[2]);
  // Старший
  features.setTitle(u, 'wins:4', []);
  eq('активен титул 5 уровня', u.activeTitle, 'wins:4');

  console.log('\n[3] Закрытый уровень выбрать нельзя');
  throws('титул недостигнутого достижения отклонён', () => features.setTitle(u, 'legionMedic:4', []));
  throws('несуществующий титул отклонён', () => features.setTitle(u, 'nope:1', []));

  console.log('\n[4] Титул можно снять');
  features.setTitle(u, '', []);
  ok('активный титул снят', !u.activeTitle);

  console.log('\n[5] API отдаёт названия титулов для экрана');
  const list = ach.list(u);
  ok('у каждого достижения в ответе 5 titles', list.achievements.every(a => a.titles.length === 5));
  ok('есть steps и stage', list.achievements.every(a => a.steps.length === 5 && 'stage' in a));
  // titlesView перечисляет все 95 по отдельности
  const tv = features.titlesView(u);
  eq('titlesView отдаёт 95 титулов', tv.list.length, 95);
  ok('у открытых стоит unlocked=true', tv.list.filter(t => t.id.startsWith('wins:')).every(t => t.unlocked));

  console.log('\n[6] Экран: кнопка на КАЖДЫЙ уровень + крупные иконки на ПК');
  const src = fs.readFileSync(path.join(ROOT, 'public/js/screens/social.js'), 'utf8');
  ok('кнопка выбора рендерится внутри каждого уровня (data-title)', /data-title="\$\{titleId\}"/.test(src));
  ok('название титула уровня выводится', /ach-title/.test(src) && /titleName/.test(src));
  ok('закрытый уровень с disabled', /reached \? '' : 'disabled'/.test(src));
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  ok('есть медиазапрос для широких экранов', /@media \(min-width: 900px\)/.test(css));
  ok('на ПК иконка достижения крупнее 46px', /\.ic-ach \{ width: 92px; height: 92px;/.test(css));
  ok('базовый размер иконки задан в CSS (для медиазапросов)', /width: 46px; height: 46px;/.test(css));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
