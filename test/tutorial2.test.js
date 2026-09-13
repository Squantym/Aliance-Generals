// ═══════════════════════════════════════════════════════════════════
// test/tutorial2.test.js — обновлённый курс молодого бойца
//
// Раньше курс проходился нажатиями «по одному разу» и кончался за пару
// минут. Теперь у каждого задания есть количество, а цепочка водит по
// всем разделам игры. Здесь проверяется:
//   • задание закрывается только набранным количеством, а не первым
//     же событием;
//   • покупка сразу тридцати машин засчитывается как тридцать;
//   • чужое событие прогресс не двигает;
//   • покупки на чёрном рынке стоят ПОСЛЕ шагов, выдающих золото, —
//     иначе задание невыполнимо;
//   • курс доходит до конца и выдаёт финальное золото.
//
// Запуск: node test/tutorial2.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const tutorial = require('../dist/src/services/tutorial');
const config = require('../dist/config/gameConfig');
const T = config.TUTORIAL;
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  const nx = [];
  await auth.register('Курсант', 'пароль123', 'tut1@t.ru', 'ru', '10.0.23.1');
  const p = Object.values(player.users()).find((x) => x.name === 'Курсант');
  p.gold = 0;

  console.log('\n[1] Цепочка стала длиннее и требует количества');
  ok(T.length >= 14, `заданий в курсе: ${T.length}`);
  const withNeed = T.filter((q) => (q.need || 1) > 1).length;
  ok(withNeed >= 7, `заданий с количеством: ${withNeed}`);
  const events = T.map((q) => q.event);
  for (const ev of ['chat', 'quest_done', 'ally_join', 'market_buff', 'market_container']) {
    ok(events.indexOf(ev) >= 0, `в курсе есть задание на событие «${ev}»`);
  }
  ok(T.some((q) => q.event === 'win' && q.need === 10), 'есть задание на 10 побед');
  ok(T.some((q) => q.event === 'buy_unit' && q.need >= 30), 'есть задание на 30 единиц техники');

  console.log('\n[2] Покупки на рынке — только после выдачи золота');
  let goldBy = 0;
  const goldBefore = {};
  T.forEach((q, i) => { goldBefore[i] = goldBy; goldBy += Number(q.gold || 0); });
  const marketSteps = T.map((q, i) => ({ q, i })).filter((x) => /^market_/.test(x.q.event));
  ok(marketSteps.length === 2, 'заданий на чёрный рынок два: допинг и контейнер');
  for (const { q, i } of marketSteps) {
    const need = q.event === 'market_container' ? config.CONTAINERS[0].gold : 15;
    ok(goldBefore[i] >= need,
       `к заданию «${q.title}» игрок получил ${goldBefore[i]} золота — хватает на покупку (${need})`);
  }

  console.log('\n[3] Задание закрывается набранным количеством');
  tutorial.notify(p, 'attack', nx);                 // 1-е задание: 1 атака
  ok(p.tutorial.step === 1, 'первое задание закрыто одной атакой');
  tutorial.notify(p, 'buy_unit', nx, 10);
  ok(p.tutorial.step === 1 && p.tutorial.progress === 10, 'десять машин — задание ещё не закрыто');
  tutorial.notify(p, 'attack', nx, 5);
  ok(p.tutorial.progress === 10, 'чужое событие прогресс не двигает');
  tutorial.notify(p, 'buy_unit', nx, 25);
  ok(p.tutorial.step === 2 && !p.tutorial.progress, 'набрали 30 — перешли к следующему, прогресс обнулён');

  console.log('\n[4] Курс доходит до конца');
  let guard = 0;
  while (!p.tutorial.done && guard++ < 500) {
    const q = T[p.tutorial.step];
    tutorial.notify(p, q.event, nx, Math.max(1, q.need || 1));
  }
  ok(p.tutorial.done === true, `курс пройден за ${guard} действий`);
  ok(p.gold >= config.TUTORIAL_FINAL_GOLD, `выдано золота всего: ${p.gold}`);
  const view = player.mePayload(p).tutorial;
  ok(view.done === true, 'в интерфейсе курс помечен пройденным');

  console.log('\n[5] Прогресс виден в интерфейсе');
  await auth.register('Новичок2', 'пароль123', 'tut2@t.ru', 'ru', '10.0.23.2');
  const p2 = Object.values(player.users()).find((x) => x.name === 'Новичок2');
  p2.tutorial.step = T.findIndex((q) => (q.need || 1) > 1);
  p2.tutorial.progress = 0;
  tutorial.notify(p2, T[p2.tutorial.step].event, nx, 2);
  const v2 = player.mePayload(p2).tutorial;
  ok(v2.quest.need > 1 && v2.quest.have === 2, `в задании видно «сделано ${v2.quest.have} из ${v2.quest.need}»`);
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(/t\.quest\.need > 1/.test(core), 'экран показывает счётчик только там, где нужно больше одного');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
