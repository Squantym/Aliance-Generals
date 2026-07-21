// Интеграция ассетов и связей:
// (1) все webp на месте (инструкторы 6, трофеи 20, вкладки 31, достижения 95);
// (2) ach.list отдаёт steps/titles/activeTitle (для экрана уровней + «Выбрать»);
// (3) daily.list отдаёт charIntro (вступление инструктора);
// (4) титулы «Ветерана» больше не воинские звания;
// (5) выбор титула достижения работает (features.setTitle).
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const ach = require('../dist/src/services/achievements');
const daily = require('../dist/src/services/dailyQuests');
const features = require('../dist/src/services/features');
const c = require('../dist/config/gameConfig');
const ROOT = process.cwd();
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const exists = (p) => fs.existsSync(path.join(ROOT, 'public/img', p));

(async () => {
  await db.init();

  console.log('\n[1] Все ассеты на месте');
  const instrN = fs.readdirSync(path.join(ROOT,'public/img/instructors')).filter(f=>f.endsWith('.webp')).length;
  const trophN = fs.readdirSync(path.join(ROOT,'public/img/trophies')).filter(f=>f.endsWith('.webp')).length;
  const tabN   = fs.readdirSync(path.join(ROOT,'public/img/tabs')).filter(f=>f.endsWith('.webp')).length;
  const achN   = fs.readdirSync(path.join(ROOT,'public/img/achievements')).filter(f=>f.endsWith('.webp')).length;
  eq('инструкторов 6', instrN, 6);
  eq('трофеев 20', trophN, 20);
  eq('вкладок 31', tabN, 31);
  eq('достижений 95 (19×5)', achN, 95);
  // каждый инструктор из конфига имеет файл
  ok('файл есть для каждого заказчика', Object.keys(c.DAILY_CHARS).every(id => exists('instructors/'+id+'.webp')));
  // каждое достижение имеет 5 файлов уровней
  ok('у каждого достижения есть 5 файлов уровней', c.ACHIEVEMENTS.every(a => [1,2,3,4,5].every(l => exists('achievements/'+a.id+'_'+l+'.webp'))));
  // каждый трофей имеет файл
  const trophies = c.TROPHIES || c.CMD_TROPHIES || [];
  ok('у каждого трофея есть файл', trophies.every(t => exists('trophies/'+t.id+'.webp')));
  // спецоперации: главный баннер у каждого конфликта + баннер каждой операции
  ok('главный баннер у каждого из 10 конфликтов', c.CONFLICTS.every(cf => exists('conflicts/'+cf.id+'.webp')));
  ok('баннер у каждой операции (по slug из конфига)', c.CONFLICTS.every(cf =>
    cf.operations.every(op => op.img && exists('conflicts/'+cf.id+'/'+op.img+'.webp'))));

  console.log('\n[2] ach.list: steps/titles/activeTitle');
  await auth.register('Боец', 'password1', 'b@a.com', 'ru', '1.1.1.1');
  const u = Object.values(player.users()).find(x => x.name === 'Боец');
  const list = ach.list(u);
  ok('есть поле activeTitle', 'activeTitle' in list);
  ok('у достижений есть steps(5) и titles(5)', list.achievements.every(a => a.steps.length === 5 && a.titles.length === 5));

  console.log('\n[3] daily.list: charIntro у заказчиков');
  u.level = 50;
  const dl = daily.list(u);
  ok('у поручений есть charIntro', dl.quests.every(q => typeof q.charIntro === 'string' && q.charIntro.length > 0));

  console.log('\n[4] Титулы «Ветерана» — прогрессия, не звания');
  const vet = c.ACHIEVEMENTS.find(a => a.id === 'veteran');
  ok('первый титул = «Новичок»', vet.titles[0] === 'Новичок');
  ok('нет воинских званий (Сержант/Маршал)', !vet.titles.includes('Сержант') && !vet.titles.includes('Маршал'));

  console.log('\n[5] Выбор титула достижения работает');
  u.counters.wins = 100000; ach.check(u, []); // прокачиваем «Ликвидатор» на все этапы
  ok('достижение wins прокачано', (u.achStages.wins || 0) >= 1);
  features.setTitle(u, 'wins:0', []); // выбрать титул 1 уровня
  eq('активный титул установлен', u.activeTitle, 'wins:0');
  const list2 = ach.list(u);
  eq('ach.list видит активный титул', list2.activeTitle, 'wins:0');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
