// ═══════════════════════════════════════════════════════════════════
// Аналитика: удержание, воронка, активность, уровни, экономика.
// Цифры сверяем с посчитанными на бумаге — метрика, которой нельзя
// доверять, хуже отсутствующей: по ней принимают решения о балансе.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-analytics-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
const an = require(ROOT + '/dist/src/services/analytics');

const DAY = 24 * 3600 * 1000;

async function main() {
const names = ['Один', 'Два', 'Три', 'Четыре', 'Пять', 'Шесть', 'Семь', 'Восемь', 'Девять', 'Десять'];
for (let i = 0; i < names.length; i++) {
  await auth.register(names[i], 'пароль123', `u${i}@t.ru`, 'ru', '1.1.1.' + i);
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const P = names.map(by);
const now = Date.now();

console.log('\n── 1. Удержание: считаем только тех, у кого день наступил ──');
// Пятеро зарегистрированы 10 дней назад, из них трое заходили позже
// первых суток → d1 = 3/5 = 60%.
// Один зарегистрирован час назад — в знаменатель d1 не попадает.
for (let i = 0; i < 5; i++) { P[i].createdAt = now - 10 * DAY; }
P[0].lastSeen = now - 10 * DAY + 2 * DAY;   // вернулся на 2-й день  → d1 ✔
P[1].lastSeen = now - 10 * DAY + 1 * DAY;   // ровно сутки           → d1 ✔ (>=)
P[2].lastSeen = now - 10 * DAY + 8 * DAY;   // прожил 8 дней         → d1 d3 d7 ✔
P[3].lastSeen = now - 10 * DAY + 3600000;   // ушёл через час        → ✘
P[4].lastSeen = now - 10 * DAY + 60000;     // ушёл сразу            → ✘
for (let i = 5; i < 10; i++) { P[i].createdAt = now - 3600000; P[i].lastSeen = now; }

const list = Object.values(U).filter((p) => !p.isBot);
const r = an.retention(list);
ok(r.d1.eligible === 5, `в знаменателе d1 только «старые»: ${r.d1.eligible}`);
ok(r.d1.returned === 3, `вернулось на 1-й день: ${r.d1.returned}`);
ok(r.d1.pct === 60, `d1 = ${r.d1.pct}% (ожидали 60)`);
ok(r.d3.returned === 1 && r.d3.pct === 20, `d3 = ${r.d3.pct}% (ожидали 20)`);
ok(r.d7.returned === 1 && r.d7.pct === 20, `d7 = ${r.d7.pct}% (ожидали 20)`);
ok(r.d30.eligible === 0 && r.d30.pct === null, 'd30 честно пустой: 30 дней ещё не прошло');

console.log('\n── 2. Вчерашние новички не занижают недельное удержание ──');
// Это и была причина фильтра: без него пятеро сегодняшних попали бы
// в знаменатель d7 как «не вернувшиеся» и обвалили бы метрику.
const naive = list.filter((p) => (p.lastSeen || 0) - p.createdAt >= 7 * DAY).length / list.length * 100;
ok(Math.round(naive) === 10 && r.d7.pct === 20,
   `наивный счёт дал бы ${Math.round(naive)}%, правильный — ${r.d7.pct}%`);

console.log('\n── 3. Воронка новичка ──');
P[0].battle = { wins: 3, losses: 1 };
P[1].battle = { wins: 0, losses: 0, defWins: 2, defLosses: 0 };  // бился в защите
P[2].battle = { wins: 10, losses: 2 };
P[0].level = 7; P[1].level = 12; P[2].level = 30; P[3].level = 1;
P[2].legionId = 'lg1';
const f = an.funnel(list);
ok(f[0].count === 10 && f[0].pct === 100, 'первая ступень — все аккаунты');
ok(f[1].count === 3, `провели бой: ${f[1].count} (ожидали 3)`);
ok(f[1].name.includes('бой'), 'ступень названа по-человечески');
ok(f[2].count === 3, `5-й уровень: ${f[2].count}`);
ok(f[3].count === 2, `10-й уровень: ${f[3].count}`);
ok(f[4].count === 1, `25-й уровень: ${f[4].count}`);
ok(f[5].count === 1, `в легионе: ${f[5].count}`);
let monotone = true;
for (let i = 1; i < 4; i++) if (f[i].count > f[i - 1].count) monotone = false;
ok(monotone, 'воронка не расширяется книзу — ступени вложены');
ok(f.every((s) => s.note), 'у каждой ступени есть пояснение');

console.log('\n── 4. Активность и липкость ──');
P[9].lastSeen = now - 60000;          // онлайн
P[8].lastSeen = now - 3 * 3600000;    // сегодня, но не онлайн
P[7].lastSeen = now - 4 * DAY;        // на неделе
P[6].lastSeen = now - 20 * DAY;       // в месяце
P[5].lastSeen = now - 200 * DAY;      // давно ушёл
const a = an.activity(list);
ok(a.online === 1, `онлайн: ${a.online}`);
// Кто когда заходил: P0 −8д, P1 −9д, P2 −2д, P3/P4 −10д,
// P5 −200д, P6 −20д, P7 −4д, P8 −3ч, P9 −1мин.
ok(a.dau === 2, `DAU: ${a.dau} (только P8 и P9 за сутки)`);
ok(a.wau === 4, `WAU: ${a.wau} (плюс P2 и P7)`);
ok(a.mau === 9, `MAU: ${a.mau} (все, кроме ушедшего 200 дней назад)`);
ok(a.stickiness === Math.round(a.dau / a.mau * 1000) / 10, `липкость: ${a.stickiness}%`);
ok(a.total === 10, `всего аккаунтов: ${a.total}`);
ok(a.newWeek === 5, `новых за неделю: ${a.newWeek}`);

console.log('\n── 5. Уровни: мёртвые души не искажают гистограмму ──');
const lv = an.levels(list);
const sumLv = lv.reduce((s, b) => s + b.count, 0);
ok(sumLv === a.mau, `в гистограмме ровно живые за месяц: ${sumLv} = MAU ${a.mau}`);
ok(lv[0].label === '1–4' && lv[lv.length - 1].to === 300, 'корзины от 1 до потолка 300');
const b10 = lv.find((b) => b.from === 10);
ok(b10.count === 1, `в корзине 10–24 один игрок: ${b10.count}`);
ok(lv.every((b) => b.count >= 0), 'отрицательных корзин нет');

console.log('\n── 6. Экономика: концентрация богатства ──');
// Живых за месяц девятеро. Раздаём так, чтобы доли считались руками:
// 10000 у одного и по 1250 у восьми → всего 20000, верхние 10% = 1 игрок = 50%.
const alive = list.filter((p) => now - (p.lastSeen || 0) <= 30 * DAY);
ok(alive.length === 9, `живых за месяц: ${alive.length}`);
alive.forEach((p, i) => { p.dollars = i === 0 ? 10000 : 1250; p.bank = 0; p.gold = 10; });
const e = an.economy(list);
ok(e.money.total === 20000, `всего денег: ${e.money.total}`);
ok(e.money.avg === Math.round(20000 / 9), `среднее: ${e.money.avg}`);
ok(e.money.median === 1250, `медиана: ${e.money.median} (среднее ${e.money.avg} врёт — в этом и смысл)`);
ok(e.money.top10Pct === 50, `верхние 10% держат ${e.money.top10Pct}% (ожидали 50)`);
ok(e.money.top1Pct === 50, 'при девяти игроках верхний «процент» — всё равно один человек');
ok(e.gold.total === 90, `золота всего: ${e.gold.total}`);

console.log('\n── 7. Равное распределение даёт долю без перекоса ──');
alive.forEach((p) => { p.dollars = 1000; });
const e2 = an.economy(list);
ok(e2.money.top10Pct === Math.round(1 / alive.length * 1000) / 10,
   `при равенстве верхние 10% держат ${e2.money.top10Pct}% — примерно свою долю`);

console.log('\n── 8. Ежедневный срез копит историю ──');
const snap = an.snapshotDaily();
ok(snap && snap.dau === a.dau, 'срез записал сегодняшний DAU');
const before = an.historyDays(60).length;
an.snapshotDaily();
ok(an.historyDays(60).length === before, 'повторный вызов за те же сутки строку не дублирует');
const snap2 = an.snapshotDaily(true);
ok(snap2.moneyTotal === e2.money.total, 'принудительный пересчёт обновляет цифры');
const h = an.historyDays(60);
ok(h.length >= 1 && h[h.length - 1].day === an.dayKey(Date.now()), 'последняя строка — сегодня');
ok(/^\d{4}-\d{2}-\d{2}$/.test(h[0].day), `ключ дня в виде даты: ${h[0].day}`);

console.log('\n── 9. Сутки считаются по МСК, а не по UTC ──');
// 21:30 UTC 1 марта — это уже 2 марта по Москве. Если бы считали по UTC,
// «новые за сегодня» обнулялись бы посреди вечера.
const mskEvening = Date.parse('2026-03-01T21:30:00Z');
ok(an.dayKey(mskEvening) === '2026-03-02', `21:30 UTC → ${an.dayKey(mskEvening)} по МСК`);
ok(an.dayKey(Date.parse('2026-03-01T20:00:00Z')) === '2026-03-01', '20:00 UTC — ещё вчерашние сутки');

console.log('\n── 10. Общая сводка отдаёт всё сразу ──');
const ov = an.overview();
ok(['activity', 'retention', 'funnel', 'levels', 'economy', 'history'].every((k) => ov[k]),
   'в ответе все разделы');
ok(Array.isArray(ov.funnel) && Array.isArray(ov.levels) && Array.isArray(ov.history),
   'списки пришли списками');
ok(JSON.stringify(ov).length < 200000, 'ответ не раздут — можно звать часто');

console.log('\n── 11. Боты в статистику не попадают ──');
const botCountBefore = an.activity(list).total;
U['bot1'] = { id: 'bot1', name: 'Бот', isBot: true, createdAt: now, lastSeen: now, level: 50 };
ok(an.overview().activity.total === botCountBefore, 'бот не добавился к аудитории');
delete U['bot1'];

console.log('\n── 12. Права: аналитика — своя зона ──');
ok(roles.ALL_ZONES.includes('analytics'), 'зона «Аналитика» зарегистрирована');
ok(roles.ZONE_INFO.some((z) => z.id === 'analytics' && z.name === 'Аналитика'),
   'у зоны есть человеческое название');
ok(!roles.OWNER_ONLY_ZONES.includes('analytics'), 'владелец может выдать её сотруднику');
ok(roles.zoneOfPath('/api/admin/analytics') === 'analytics', 'адрес размечен зоной');
ok(roles.zoneOfPath('/api/admin/anticheat') === 'security', 'античит размечен «Безопасностью»');
const rt = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
const i = rt.indexOf("'/api/admin/analytics'");
ok(i > 0 && /canAccessZone\(req\.user, 'analytics'\)/.test(rt.slice(i, i + 300)), 'маршрут проверяет зону');
ok(/admin: true/.test(rt.slice(i, i + 500)), 'и требует прав администратора');

console.log('\n── 13. Пустая база не роняет расчёты ──');
const empty = an.retention([]);
ok(empty.d1.pct === null && empty.d1.eligible === 0, 'удержание на пустом списке — null, а не NaN');
const ee = an.economy([]);
ok(ee.money.avg === 0 && ee.money.top10Pct === null, 'экономика на пустом списке не делит на ноль');
const ef = an.funnel([]);
ok(ef.every((s) => s.count === 0 && Number.isFinite(s.pct)), 'воронка на пустом списке даёт нули');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main();
