// ═══════════════════════════════════════════════════════════════════
// test/season15.test.js — сезон 15 дней, без администрации и долгих банов
//
// Что стережётся:
//  1. Переход с недельного сезона НЕ обнуляет игроков: идущая неделя
//     становится началом 15-дневного сезона, очки остаются, меняется
//     только срок окончания.
//  2. Планки наград 500 / 300 / 100 доходят и до базы, где награды уже
//     сохранялись (они перекрывают конфиг), жетоны не трогаются.
//  3. Владелец, администраторы и комиссары вне зачёта: их нет в топах и
//     итогах, очки обнулены и не копятся. «Дозор» остаётся в зачёте.
//  4. Бан на месяц и дольше (и бессрочный) обнуляет очки и убирает из
//     зачёта; короткий бан и истёкший — нет.
//  5. Через 15 дней сезон закрывается: награды без администрации, по
//     новым планкам, следующий сезон — ровно через 15 дней.
//
// Запуск: node test/season15.test.js   (после npm run build)
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
const roles = require('../dist/src/services/roles');
const seasons = require('../dist/src/services/seasons');
const rewards = require('../dist/src/services/rewards');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

const DAY = 86400000, MSK = 3 * 3600000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const points = (w) => !!w && ['rating', 'wins', 'ears', 'mercy', 'loot', 'alliance', 'missions'].some((k) => (w[k] || 0) > 0);

(async () => {
  await db.init();
  const names = ['Хозяин', 'Куратор', 'Комиссар', 'Дозорный', 'Старожил', 'Боец', 'Новичок',
                 'Месячный', 'Недельный', 'Вечный', 'Отсидевший', 'Ветеран'];
  for (let i = 0; i < names.length; i++) {
    await auth.register(names[i], 'пароль123', `s${i}@t.ru`, 'ru', `1.1.2.${i + 1}`);
  }
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const [O, A, K, M, OLD, P1, P2, B30, B7, BP, BX, LEG] = names.map(by);
  O.role = 'owner'; A.role = 'admin'; K.role = 'commissar'; M.role = 'moderator';
  LEG.isAdmin = true;                       // старый флаг администратора без роли
  const zones = db.load('roleZones', {}); zones.admin = ['moderation']; db.save('roleZones');
  const nx = [];

  // Идущая «неделя» по старым правилам: понедельник МСК
  const msk = new Date(Date.now() + MSK);
  const dow = (msk.getUTCDay() + 6) % 7;
  const monday = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() - dow);
  const wid = iso(monday);
  const wk = (extra) => Object.assign({ weekId: wid, rating: 0, wins: 0, ears: 0, mercy: 0, loot: 0, alliance: 0, missions: 0 }, extra);

  // Хранилище в том виде, в каком его оставил недельный сезон
  const st = db.load('weeklySeason', {});
  for (const k of Object.keys(st)) delete st[k];
  Object.assign(st, {
    weekId: wid, lastWeekId: iso(monday - 7 * DAY),
    lastWinners: { wins: [{ id: O.id, name: O.name, value: 30 }, { id: OLD.id, name: OLD.name, value: 12 }] },
    rewards: [{ gold: 700, tokens: 4 }, { gold: 300, tokens: 2 }, { gold: 150, tokens: 1 }],
  });
  db.save('weeklySeason');

  OLD.weekly = wk({ rating: 44, wins: 9 });
  P1.weekly = wk({ rating: 20, wins: 5 });
  P2.weekly = wk({ rating: 9, wins: 3 });
  M.weekly = wk({ rating: 25, wins: 7 });
  O.weekly = wk({ rating: 90, wins: 30 });
  A.weekly = wk({ rating: 80, wins: 25 });
  K.weekly = wk({ rating: 70, wins: 20 });
  LEG.weekly = wk({ rating: 60, wins: 15 });

  console.log('\n[1] Переход на 15 дней — очки игроков целы');
  const v1 = seasons.view(P1);
  eq('сезон продолжает идущую неделю (тот же id)', v1.weekId, wid);
  eq('ролловера не было: победы старожила на месте', OLD.weekly.wins, 9);
  eq('и у обычного игрока', P1.weekly.wins, 5);
  eq('конец сезона — через 15 дней от начала недели', v1.endsAt, monday + 15 * DAY - MSK);
  eq('длительность отдаётся экрану', v1.seasonDays, 15);
  eq('точка отсчёта сохранена в базе', st.anchor, monday);
  ok('итоги прошлой недели подписываются 7 днями', v1.lastSeasonDays === 7);

  console.log('\n[2] Награды 500 / 300 / 100, жетоны не тронуты');
  eq('🥇 золото', v1.rewards[0].gold, 500);
  eq('🥈 золото', v1.rewards[1].gold, 300);
  eq('🥉 золото', v1.rewards[2].gold, 100);
  ok('жетоны остались прежними (4 / 2 / 1)', v1.rewards[0].tokens === 4 && v1.rewards[1].tokens === 2 && v1.rewards[2].tokens === 1);
  seasons.adminSetRewards(O, { gold1: 600, tokens1: 4, gold2: 300, tokens2: 2, gold3: 100, tokens3: 1 });
  eq('правка из панели после миграции не перетирается', seasons.view(P1).rewards[0].gold, 600);
  seasons.adminSetRewards(O, { gold1: 500, tokens1: 3, gold2: 300, tokens2: 2, gold3: 100, tokens3: 1 });

  console.log('\n[3] Администрация вне зачёта, «Дозор» — в зачёте');
  const wins = seasons.view(P1).categories.find((c) => c.id === 'wins');
  const ids = wins.top.map((x) => x.id);
  for (const [who, p] of [['владельца', O], ['администратора', A], ['комиссара', K], ['старого админа без роли', LEG]]) {
    ok(`${who} нет в топе`, ids.indexOf(p.id) === -1);
    ok(`у ${who} очки обнулены`, !points(p.weekly));
  }
  ok('модератор в топе', ids.indexOf(M.id) >= 0);
  eq('и его очки на месте', M.weekly.wins, 7);
  eq('первое место — у старожила, а не у владельца', wins.top[0].id, OLD.id);
  const lw = seasons.view(P1).categories.find((c) => c.id === 'wins').winners.map((w) => w.id);
  ok('владелец вычищен и из итогов прошлой недели', lw.indexOf(O.id) === -1 && lw.indexOf(OLD.id) >= 0);
  seasons.onWin(A); seasons.onAttack(O); seasons.onLoot(K, 5000);
  ok('новые действия администрации не копятся', !points(A.weekly) && !points(O.weekly) && !points(K.weekly));
  seasons.onWin(M);
  eq('а у модератора копятся', M.weekly.wins, 8);
  eq('администрации объяснено, почему её нет', seasons.view(A).excluded, 'staff');
  eq('игроку — ничего не мешает', seasons.view(P1).excluded, null);

  console.log('\n[4] Долгие баны обнуляют очки');
  for (const p of [B30, B7, BP, BX]) p.weekly = wk({ rating: 30, wins: 6 });
  roles.banAccount(O, B30.id, 30 * 24 * 60, 'Боты', nx);
  roles.banAccount(O, B7.id, 7 * 24 * 60, 'Флуд', nx);
  roles.banAccount(O, BP.id, 0, 'Мошенничество', nx);
  BX.banned = true; BX.bannedAt = Date.now() - 40 * DAY; BX.banUntil = Date.now() - 1000;   // срок вышел
  const t4 = seasons.view(P1).categories.find((c) => c.id === 'wins').top.map((x) => x.id);
  ok('бан ровно на месяц — вне зачёта', t4.indexOf(B30.id) === -1 && !points(B30.weekly));
  ok('бессрочный бан — вне зачёта', t4.indexOf(BP.id) === -1 && !points(BP.weekly));
  ok('бан на неделю — очки на месте', t4.indexOf(B7.id) >= 0 && B7.weekly.wins === 6);
  ok('истёкший бан — очки на месте', t4.indexOf(BX.id) >= 0 && BX.weekly.wins === 6);
  eq('забаненному объяснено', seasons.view(B30).excluded, 'ban');
  roles.unbanAccount(O, B30.id, nx);
  const t4b = seasons.view(P1).categories.find((c) => c.id === 'wins').top.find((x) => x.id === B30.id);
  ok('после разбана игрок вернулся в зачёт — с нуля, а не со старыми очками', !!t4b && t4b.value === 0);

  console.log('\n[5] Через 15 дней — итоги без администрации, по новым планкам');
  const realNow = Date.now;
  Date.now = () => monday - MSK + 15 * DAY + 60000;          // минута нового сезона
  try {
    ok('сезон сменился', seasons.rolloverIfNeeded() === true);
    ok('повторный вызов ничего не делает', seasons.rolloverIfNeeded() === false);
    eq('новый сезон начинается через 15 дней', seasons.weekId(), iso(monday + 15 * DAY));
    eq('и заканчивается ещё через 15', seasons.weekEndsAt(), monday + 30 * DAY - MSK);
    const letters = (p) => rewards.listFor(p).filter((r) => /Победы в боях/.test(r.reason || ''));
    const gold = (p) => { const l = letters(p)[0]; return l ? l.reward.gold : 0; };
    eq('🥇 по победам — старожил, 500', gold(OLD), 500);
    eq('🥈 — модератор, 300', gold(M), 300);
    eq('🥉 — B7 или Отсидевший, 100', Math.max(gold(B7), gold(BX)), 100);
    for (const p of [O, A, K, LEG, B30, BP]) ok(`${p.name}: писем с наградой нет`, rewards.listFor(p).length === 0);
    ok('письмо называется «Итоги сезона»', /Итоги сезона/.test(letters(OLD)[0].title));
    ok('метрики нового сезона обнулены', !points(OLD.weekly) && OLD.weekly.weekId === iso(monday + 15 * DAY));
    ok('итоги подписываются 15 днями', seasons.view(P1).lastSeasonDays === 15);
  } finally { Date.now = realNow; }

  console.log('\n[6] Экран и панель говорят о сезоне, а не о неделе');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  const scr = core.slice(core.indexOf('App.screens.season = async'), core.indexOf('// ---------- Мировое событие'));
  ok('на экране сезона нет слова «недел»', scr.length > 500 && !/недел/i.test(scr));
  ok('игроку вне зачёта объяснена причина', /d\.excluded === 'staff'/.test(scr) && /d\.excluded === 'ban'/.test(scr));
  const adminJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  ok('в панели — «Завершить сезон»', /Завершить сезон СЕЙЧАС/.test(adminJs) && !/Завершить неделю/.test(adminJs));
  const appJs = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  ok('подпись дат знает длительность', /_weekRange\(weekId, days = 7\)/.test(appJs));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
