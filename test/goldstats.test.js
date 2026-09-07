// ═══════════════════════════════════════════════════════════════════
// test/goldstats.test.js — расход золота считается ОДИН раз и читается
//
// Две ошибки в статистике золота, обе тихие.
//
//  1. ДВОЙНОЙ СЧЁТ. player.spendGold сам записывает расход, и рядом с
//     ним в восьми местах стояла ВТОРАЯ запись того же расхода. Знак у
//     них был разный, но stats.track берёт модуль — обе прибавлялись.
//     Владелец, настраивающий экономику, смотрел на удвоенные числа по
//     рынку, контейнерам, лазерам, объединениям и бою легиона.
//
//  2. БЕЗЫМЯННЫЕ КАТЕГОРИИ. Панель показывает ключ как есть, если для
//     него нет русского имени. Из пятнадцати категорий, которые код
//     реально передаёт, имя было у трёх — остальные показались бы
//     латиницей: «laser», «mission», «production».
//
// Второй раздел — главный: он не даст добавить новую статью расхода,
// забыв про имя. Это дешевле, чем потом искать, что такое «silo» в
// сводке.
//
// Запуск: node test/goldstats.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.MONGODB_URI = '';
require('./_guard');   // не даёт стереть боевую data/
const DATA = path.join(process.cwd(), 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const stats = require('../dist/src/services/stats');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

(async () => {
  await db.init();
  await auth.register('Казначей', 'пароль123', 'k@t.ru', 'ru', '1.1.1.1');
  const U = Object.values(player.users()).find((x) => x.name === 'Казначей');
  U.gold = 1000;

  console.log('\n── 1. Списание записывается ровно один раз ──');
  player.spendGold(U, 100, 'market');
  const st = U.stats && U.stats.goldSpent;
  ok('расход записан', !!st && st.market === 100);
  ok('и ровно на списанную сумму, а не вдвое', st.market === 100);
  ok('золото действительно списано', U.gold === 900);

  player.spendGold(U, 50, 'market');
  ok('второе списание складывается', U.stats.goldSpent.market === 150);

  player.spendGold(U, 30, 'laser');
  ok('другая статья считается отдельно', U.stats.goldSpent.laser === 30);
  ok('и не примешивается к первой', U.stats.goldSpent.market === 150);

  console.log('\n── 2. Писатель расхода ровно один ──');
  // Вторая запись рядом со списанием — это и был двойной счёт.
  const services = fs.readdirSync(path.join(ROOT, 'src/services'))
    .filter((n) => n.endsWith('.ts'));
  const extra = [];
  for (const n of services) {
    if (n === 'player.ts' || n === 'stats.ts') continue;   // единственный писатель и сама статистика
    const src = fs.readFileSync(path.join(ROOT, 'src/services', n), 'utf8');
    src.split('\n').forEach((l, i) => {
      if (l.trim().startsWith('//')) return;
      if (/track\s*\([^)]*'goldSpent'/.test(l)) extra.push(`${n}:${i + 1}`);
    });
  }
  ok(extra.length ? `лишние записи расхода: ${extra.join(', ')}` : 'расход пишет только player.spendGold',
     extra.length === 0);

  console.log('\n── 3. У каждой статьи расхода есть русское имя ──');
  // Иначе в сводке владельца появляется «silo» посреди русского списка.
  const statsSrc = fs.readFileSync(path.join(ROOT, 'src/services/stats.ts'), 'utf8');
  const dictBody = statsSrc.slice(statsSrc.indexOf('const GOLD_SPENDING'),
                                 statsSrc.indexOf('};', statsSrc.indexOf('const GOLD_SPENDING')));
  const named = new Set([...dictBody.matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]));
  ok(`словарь разобран (${named.size} имён)`, named.size > 5);

  const used = new Set();
  for (const n of services) {
    const src = fs.readFileSync(path.join(ROOT, 'src/services', n), 'utf8');
    for (const m of src.matchAll(/spendGold\s*\([^,]+,[^,]+,\s*'([a-z_]+)'/g)) used.add(m[1]);
  }
  ok(`статьи расхода найдены в коде (${used.size})`, used.size > 5);

  const noName = [...used].filter((k) => !named.has(k));
  ok(noName.length ? `без русского имени: ${noName.join(', ')}` : 'все статьи расхода названы по-русски',
     noName.length === 0);

  console.log('\n── 4. Статьи клуба названы все, включая доходные ──');
  // Клуб — крупнейший источник золота в игре, и статей у него больше
  // всего. Ставка списывается, выигрыш начисляется, взнос возвращается —
  // три разных названия на игру, и любое из них может остаться
  // английским. Проверка ищет их не по вызовам, а по самим строкам:
  // касса клуба обязана держать их литералами, а не склеивать из id.
  const incBody = statsSrc.slice(statsSrc.indexOf('const GOLD_SOURCES'),
                                statsSrc.indexOf('};', statsSrc.indexOf('const GOLD_SOURCES')));
  const incNamed = new Set([...incBody.matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]));
  ok(`словарь доходов разобран (${incNamed.size} имён)`, incNamed.size > 5);
  const clubSrc = ['club.ts', 'clubMatch.ts']
    .map((n) => fs.readFileSync(path.join(ROOT, 'src/services', n), 'utf8')).join('\n');
  const clubKeys = new Set([
    ...[...clubSrc.matchAll(/(?:addGold|spendGold)\([^)]*'(club_[a-z_]+)'/g)].map((m) => m[1]),
    ...[...clubSrc.matchAll(/^\s*[a-z]+:\s*'(club_[a-z_]+)',/gm)].map((m) => m[1]),
  ]);
  ok(`статьи клуба найдены (${clubKeys.size})`, clubKeys.size >= 6);
  const clubNoName = [...clubKeys].filter((k) => !named.has(k) && !incNamed.has(k));
  ok(clubNoName.length ? `статьи клуба без имени: ${clubNoName.join(', ')}`
     : 'все статьи клуба названы по-русски', clubNoName.length === 0);
  // Склейка вида 'club_' + game сюда не попадает — а значит, и в сводку
  // владельца попадёт обрубком. Ловим её отдельно.
  const glued = [...clubSrc.matchAll(/'(club_)'\s*\+/g)].map((m) => m[1]);
  ok(glued.length ? `имя статьи склеивается из кусков: ${glued.join(', ')}`
     : 'имена статей клуба — целые строки, а не склейка', glued.length === 0);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
