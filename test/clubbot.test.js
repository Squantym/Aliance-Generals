// ═══════════════════════════════════════════════════════════════════
// test/clubbot.test.js — защита клуба от скриптов
//
// ЧТО БЫЛО НАЙДЕНО. Модуль antibot существовал, был написан правильно и
// подробно — и НЕ ВЫЗЫВАЛСЯ НИОТКУДА. Сто действий подряд с машинной
// регулярностью не поднимали подозрительность ни на единицу: поле
// user.behavior даже не заводилось. При этом панель показывала владельцу
// «подозрительность: 0» как измерение, хотя увеличивать её было некому.
// Мёртвый детектор хуже отсутствующего: он создаёт уверенность.
//
// Поэтому здесь две разные проверки, и обе обязательны:
//
//  1. ПУЛЬС ПОДКЛЮЧЁН. Каждая точка входа клуба зовёт beat(). Проверка
//     идёт по исходнику, потому что поведение ещё не написанной игры
//     прогнать нельзя, а забыть про пульс в ней — можно.
//
//  2. ДЕТЕКТОР РАБОТАЕТ И НЕ БЬЁТ СВОИХ. Машинный ритм ловится, живые
//     стили игры — нет. Второе важнее первого: ложное срабатывание
//     наказывает того, кто просто играет.
//
// Запуск: node test/clubbot.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
require('./_guard');   // не даёт стереть боевую data/
const DATA = path.join(process.cwd(), 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const club = require('../dist/src/services/club');
const antibot = require('../dist/src/services/antibot');
const C = require('../dist/config/gameConfig').CLUB;

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const nx = [];

(async () => {
  await db.init();
  await auth.register('Скрипт', 'пароль123', 's@t.ru', 'ru', '1.1.1.1');
  await auth.register('Живой', 'пароль123', 'h@t.ru', 'ru', '1.1.1.1');
  const B = Object.values(player.users()).find((x) => x.name === 'Скрипт');
  const H = Object.values(player.users()).find((x) => x.name === 'Живой');
  for (const U of [B, H]) { U.level = 100; U.gold = 1000000; }
  const clearCd = (U) => {
    if (U.club && U.club.cd) for (const k of Object.keys(U.club.cd)) if (k !== 'bot') U.club.cd[k] = 0;
  };

  console.log('\n── 1. Пульс подключён ко ВСЕМ точкам входа ──');
  // Разбор кода: новая игра не должна появиться мимо детектора.
  const src = fs.readFileSync(path.join(ROOT, 'src/services/club.ts'), 'utf8');
  ok('beat() существует и зовёт antibot', /function beat\(/.test(src) && /antibot\.track\(/.test(src));
  ok('и применяет замедление', /antibot\.throttleSec\(/.test(src));
  // Каждая экспортируемая функция клуба обязана пройти через beat()
  const exportedAll = (src.match(/export = \{([\s\S]*?)\};/) || [])[1] || '';
  // kassa — не игра, а касса клуба: её зовут ИЗ игр, каждая из которых
  // уже прошла через пульс. Требовать beat() от payout() и cdLeft()
  // значит стучать в детектор дважды за одно действие.
  const kassaAt = exportedAll.indexOf('kassa:');
  const exported = kassaAt >= 0 ? exportedAll.slice(0, kassaAt) : exportedAll;
  const names = exported.split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^[a-zA-Z]/.test(x));
  // Порог низкий намеренно: игры в клубе меняются, и упасть эта
  // проверка должна не от того, что игру убрали, а от того, что разбор
  // экспорта сломался и проверять стало нечего.
  ok(`экспортируемых функций найдено (${names.length})`, names.length >= 6);
  const noPulse = [];
  for (const name of names) {
    if (name === 'view') continue;               // просмотр золота не приносит
    const at = src.indexOf('function ' + name + '(');
    if (at < 0) continue;
    let end = src.indexOf('\nfunction ', at + 1);
    if (end < 0) end = src.length;
    if (!/beat\(user,/.test(src.slice(at, end))) noPulse.push(name);
  }
  ok(noPulse.length ? `мимо пульса ходят: ${noPulse.join(', ')}` : 'мимо пульса не ходит ни одна игра',
     noPulse.length === 0);

  // Игры против живого соперника живут в отдельном модуле — и это как
  // раз тот случай, когда про пульс легче всего забыть: файл другой,
  // касса чужая, а золото то же самое.
  const mSrc = fs.readFileSync(path.join(ROOT, 'src/services/clubMatch.ts'), 'utf8');
  const mNoPulse = [];
  for (const name of ['enqueue', 'leaveQueue', 'interceptMove', 'sniperAct']) {
    const at = mSrc.indexOf('function ' + name + '(');
    if (at < 0) { mNoPulse.push(name + ' (нет такой)'); continue; }
    let end = mSrc.indexOf('\nfunction ', at + 1);
    if (end < 0) end = mSrc.length;
    if (!/\bbeat\(user,/.test(mSrc.slice(at, end))) mNoPulse.push(name);
  }
  ok(mNoPulse.length ? `в живых играх мимо пульса: ${mNoPulse.join(', ')}`
     : 'живые игры тоже стучат в пульс', mNoPulse.length === 0);

  console.log('\n── 2. Машинный ритм ловится ──');
  // До правки эта проверка была бы красной при любом числе действий.
  let refused = 0;
  for (let i = 0; i < 60; i++) {
    clearCd(B);
    try { club.tacticStart(B); club.tacticPlay(B, 'air', nx); }
    catch (e) { if (/Штаб проверяет/.test(e.message)) refused++; }
  }
  const bp = antibot.profile(B);
  ok(`подозрительность выросла до ${bp.suspicion}`, bp.suspicion >= 60);
  ok(`интервалы собраны (${bp.samples})`, bp.samples >= 10);
  // По коэффициенту вариации здесь судить нельзя: интервалы почти нулевые,
  // и одна случайная пауза (сборка мусора, сброс на диск) взрывает его до
  // единиц. Ловит такой темп другое правило — «быстрее, чем может человек»,
  // и проверять надо именно то, что сработало. Сам коэффициент проверяется
  // в разделе 4, где интервалы задаются точно.
  ok(`темп нечеловеческий: медиана ${bp.medianMs} мс`,
     bp.medianMs !== null && bp.medianMs < 350);
  ok('ритм записан, а не выдуман', bp.cv !== null);
  ok(`замедление включилось (${bp.throttleSec} с)`, bp.throttleSec > 0);
  ok(`скрипт получил отказы (${refused} из 60)`, refused > 20);

  console.log('\n── 3. Живого игрока не ловим ──');
  // Это важнее предыдущего раздела: ложное срабатывание наказывает того,
  // кто просто играет. Интервалы подаём напрямую — гонять настоящие
  // паузы в тесте нельзя, а проверяется именно реакция на ритм.
  const feed = (U, ms) => { const b = antibot.ensure(U); b.lastActionAt = Date.now() - ms; antibot.track(U, 'club'); };
  const styles = [
    ['обычная игра, 1.5–8 с', () => 1500 + Math.random() * 6500],
    ['быстрая игра, 0.6–2 с', () => 600 + Math.random() * 1400],
    ['вдумчивая, 5–40 с', () => 5000 + Math.random() * 35000],
    ['нервный кликер, 0.4–1.2 с', () => 400 + Math.random() * 800],
  ];
  for (const [name, gen] of styles) {
    H.behavior = null;
    for (let i = 0; i < 40; i++) feed(H, Math.round(gen()));
    const p = antibot.profile(H);
    ok(`${name} → подозрительность ${p.suspicion}, замедления нет`, p.throttleSec === 0);
  }

  console.log('\n── 4. А дрожание у скрипта не спасает ──');
  // Скрипт, добавивший разброс ±3% и даже ±2%, всё равно ровнее человека.
  for (const [name, gen] of [
    ['ровно 1000 мс', () => 1000],
    ['1000 мс ±30', () => 1000 + (Math.random() * 60 - 30)],
    ['5000 мс ±100', () => 5000 + (Math.random() * 200 - 100)],
  ]) {
    H.behavior = null;
    for (let i = 0; i < 40; i++) feed(H, Math.round(gen()));
    const p = antibot.profile(H);
    ok(`${name} → пойман (подозрительность ${p.suspicion})`, p.throttleSec > 0);
  }

  console.log('\n── 5. Замедление — это задержка, а не бан ──');
  // Запрет запирал бы живого игрока при ложном срабатывании. Скрипт
  // теряет пропускную способность, человек — полминуты.
  B.club.cd.bot = 0;
  let played = false;
  try { clearCd(B); club.tacticStart(B); played = true; } catch (e) {}
  ok('после истечения задержки играть снова можно', played);
  ok('подозрительность спадает со временем', (() => {
    const b = antibot.ensure(B);
    b.suspicion = 100;
    b.lastDecayAt = Date.now() - 8 * 3600 * 1000;   // восемь часов назад
    return antibot.profile(B).suspicion < 40;
  })());

  console.log('\n── 6. Таймер сейфа не ровный ──');
  // Ровно минута — подарок скрипту: он ставит будильник на 60.0 с и
  // попадает в открытие раньше человека, который смотрит на часы.
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    H.club = H.club || {};
    H.club.safeNextAt = 0;
    H.behavior = null;
    if (H.club.cd) H.club.cd.bot = 0;
    try { club.safeTry(H, String(100000 + i), nx); } catch (e) {}
    seen.add(Math.round((H.club.safeNextAt - Date.now()) / 1000));
  }
  ok(`интервалов разной длины: ${seen.size}`, seen.size > 5);
  const arr = [...seen].filter((x) => x > 0);
  ok(`разброс вокруг ${C.SAFE_TRY_CD_SEC} с (от ${Math.min(...arr)} до ${Math.max(...arr)})`,
     Math.min(...arr) < C.SAFE_TRY_CD_SEC && Math.max(...arr) > C.SAFE_TRY_CD_SEC);

  console.log('\n── 7. Сама проверка умеет краснеть ──');
  // Раздел 1 держится на разборе исходника — убедимся, что он различает
  // функцию с пульсом и без.
  ok('функция без пульса распознаётся',
     !/beat\(user,/.test('function foo(user: User) {\n  return 1;\n}'));
  ok('функция с пульсом — да',
     /beat\(user,/.test("function foo(user: User) {\n  beat(user, 'foo');\n}"));
  ok('детектор считает по живым интервалам, а не по константе',
     antibot.profile(B).samples > 0);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
