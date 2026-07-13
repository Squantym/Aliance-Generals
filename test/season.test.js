// Тест еженедельного рейтингового сезона: начисление очков по категориям,
// топ-20, ролловер с наградами топ-3, снапшот победителей, сброс метрик.
// Запуск: node test/season.test.js  (после npm run build)
const assert = require('assert');
const c = require('../dist/config/gameConfig');
const db = require('../dist/src/core/db');
const seasons = require('../dist/src/services/seasons');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log(`  ✅ ${n} (= ${a})`); };

const usersMap = db.load('users', {});
for (const k of Object.keys(usersMap)) delete usersMap[k];
const now = Date.now();
function mkUser(id, name) {
  return {
    id, name, email: id + '@t.t', isBot: false, gold: 0, tokens: 0, level: 20,
    country: 'ru', dollars: 0, seasonRating: 0,
  };
}
function seed(id, name) { const u = mkUser(id, name); usersMap[id] = u; return u; }

const P = c.SEASON.points;

console.log('\n[1] Границы недели (пн 00:00 — вс 23:59 МСК)');
const wid = seasons.weekId();
ok('weekId формата YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(wid));
ok('weekId указывает на понедельник', new Date(wid + 'T00:00:00Z').getUTCDay() === 1);
const endsAt = seasons.weekEndsAt();
ok('конец недели в будущем', endsAt > Date.now());
ok('до конца недели ≤ 7 дней', endsAt - Date.now() <= 7 * 86400000 + 1000);

console.log('\n[2] Начисление очков по действиям (общий рейтинг 3–10)');
const u1 = seed('u1', 'Боец');
seasons.onAttack(u1);
eq('после атаки rating = очки атаки', u1.weekly.rating, P.attack);
seasons.onWin(u1);
eq('победа: wins=1', u1.weekly.wins, 1);
eq('победа добавила очки', u1.weekly.rating, P.attack + P.win);
seasons.onFatalityEar(u1);
eq('ухо: ears=1', u1.weekly.ears, 1);
seasons.onMercy(u1);
eq('помилование: mercy=1', u1.weekly.mercy, 1);
seasons.onLoot(u1, 5000);
eq('грабёж: loot=5000', u1.weekly.loot, 5000);
seasons.onMissionStep(u1);
eq('миссия: missions=1', u1.weekly.missions, 1);
seasons.onMissionComplete(u1);
seasons.onAllianceRecruit(u1);
eq('альянс: alliance=1', u1.weekly.alliance, 1);
const expectRating = P.attack + P.win + P.fatalityEar + P.mercy + P.loot + P.missionStep + P.missionComplete + P.allianceRecruit;
eq('итоговый рейтинг = сумме очков', u1.weekly.rating, expectRating);
ok('все очки в диапазоне 3..10', Object.values(P).every((v) => v >= 3 && v <= 10));

console.log('\n[3] view(): 7 категорий, топ-20, место игрока');
const u2 = seed('u2', 'Танкист'); const u3 = seed('u3', 'Снайпер');
for (let i = 0; i < 10; i++) seasons.onWin(u2);   // u2 лидер по победам
for (let i = 0; i < 3; i++) seasons.onWin(u3);
const v = seasons.view(u1);
eq('категорий 7', v.categories.length, 7);
ok('есть endsAt/weekId', !!v.endsAt && !!v.weekId);
const winsCat = v.categories.find((x) => x.id === 'wins');
eq('топ-1 по победам — u2', winsCat.top[0].id, 'u2');
eq('u2 побед = 10', winsCat.top[0].value, 10);
const ratingCat = v.categories.find((x) => x.id === 'rating');
ok('в рейтинге лидирует u1 (много действий)', ratingCat.top[0].id === 'u1');
const vForU3 = seasons.view(u3);
eq('место u3 по победам определено', vForU3.categories.find((x) => x.id === 'wins').myRank > 0, true);

console.log('\n[4] Ролловер: награда топ-3 каждой категории + снапшот + сброс');
// Настроим награды
const admin = seed('adm', 'Админ');
seasons.adminSetRewards(admin, { gold1: 500, tokens1: 3, gold2: 300, tokens2: 2, gold3: 150, tokens3: 1 });
// Снимок золота до
const goldBefore = { u1: u1.gold, u2: u2.gold, u3: u3.gold };
const res = seasons.adminForceRollover(admin, { push: () => {} });
ok('снапшот победителей есть', !!res.winners);
const winsWinners = res.winners['wins'];
eq('в категории побед 3 призёра', winsWinners.length, 3);
eq('1 место по победам — u2', winsWinners[0].id, 'u2');
// u2 — топ-1 по победам → награда приходит ПИСЬМОМ (не начисляется сразу).
const rewards = require('../dist/src/services/rewards');
ok('золото НЕ начислено сразу (награда письмом)', u2.gold === goldBefore.u2);
const u2Letters = rewards.listFor(u2).filter((r) => !r.claimed);
ok('у u2 есть неполученная награда-письмо', u2Letters.length >= 1);
const winsLetter = u2Letters.find((r) => (r.reward.gold || 0) >= 500 && (r.reward.tokens || 0) >= 3);
ok('в письме за победу 500 золота и 3 жетона', !!winsLetter);
// Забираем — теперь начисляется
rewards.claim(u2, winsLetter.id, { push: () => {} });
ok('после «Забрать» золото начислено', u2.gold >= goldBefore.u2 + 500);
ok('после «Забрать» жетоны начислены', u2.tokens >= 3);
// Метрики обнулены
eq('после ролловера wins u2 = 0', u2.weekly.wins, 0);
eq('после ролловера rating u1 = 0', u1.weekly.rating, 0);

console.log('\n[5] Снапшот победителей виден в view (топ-3 прошлой недели)');
const v2 = seasons.view(u1);
const wc = v2.categories.find((x) => x.id === 'wins');
ok('winners прошлой недели присутствуют', wc.winners && wc.winners.length === 3);
eq('winners[0] — u2', wc.winners[0].id, 'u2');
ok('текущий топ пуст после сброса', wc.top.every((x) => x.value === 0));

console.log('\n[6] Смена недели сбрасывает метрики игрока (ensureWeek)');
seasons.onWin(u1);
ok('u1 снова набрал победу', u1.weekly.wins === 1);
u1.weekly.weekId = '2000-01-03'; // подделываем старую неделю
seasons.onAttack(u1);            // ensureWeek должен сбросить
eq('после смены недели wins=0, только новая атака', u1.weekly.wins, 0);
eq('rating = только очки атаки', u1.weekly.rating, P.attack);

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
