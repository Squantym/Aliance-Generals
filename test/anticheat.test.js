// ═══════════════════════════════════════════════════════════════════
// Античит: ловит ли он накрутку, эксплойты и сломанные формулы.
// Проверяем И срабатывание, И отсутствие ложных тревог на честной игре.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-anticheat-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const ac = require(ROOT + '/dist/src/services/antiCheat');
const db = require(ROOT + '/dist/src/core/db');

const M = 60000;
// Записать действие с указанным состоянием счёта
function log(p, atOffsetMs, apiPath, desc, bal) {
  db.appendLog({ at: Date.now() - atOffsetMs, userId: p.id, userName: p.name,
    path: apiPath, desc, bal });
}
const bal = (d, g, xp, lv) => ({ d, g, lv: lv || 10, xp: xp || 1000, u: 100, b: 5 });

async function main() {
for (const [n, e] of [['Честный', 'a@t.ru'], ['Читер', 'b@t.ru'], ['Скриптер', 'c@t.ru'], ['Сломанный', 'd@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const fair = by('Честный'), cheat = by('Читер'), script = by('Скриптер'), broken = by('Сломанный');
for (const p of [fair, cheat, script, broken]) { p.lastSeen = Date.now(); p.level = 50; }

console.log('\n── 1. Честная игра — тревог быть не должно ──');
// Деньги растут понемногу и на «денежных» действиях, золото — в клубе
log(fair, 30 * M, '/api/war/attack', '⚔️ Атаковал', bal(1_000_000, 100));
log(fair, 25 * M, '/api/war/attack', '⚔️ Атаковал', bal(1_800_000, 100));
log(fair, 20 * M, '/api/club/dice/start', '🎲 Клуб: кости', bal(1_800_000, 140));
log(fair, 15 * M, '/api/me', 'Обновил', bal(1_850_000, 140));
const rFair = await ac.scanOne(fair.id, 24);
ok(rFair.findings.length === 0,
   rFair.findings.length ? `ложная тревога: ${rFair.findings[0].title}` : 'у честного игрока находок нет');

console.log('\n── 2. Золото из ниоткуда ──');
log(cheat, 30 * M, '/api/me', 'Обновил', bal(1_000_000, 100));
log(cheat, 29 * M, '/api/notifications/read-all', '🔔 Прочитал уведомления', bal(1_000_000, 9_100));
const rCheat = await ac.scanOne(cheat.id, 24);
const goldF = rCheat.findings.filter((f) => f.kind === 'gold');
ok(goldF.length === 1, `находка про золото: ${goldF.length}`);
ok(/9000|\+9000/.test(goldF[0].title), `указан размер прироста: «${goldF[0].title}»`);
ok(goldF[0].severity === 'high', 'помечено как серьёзное');
ok(/уведомлен/i.test(goldF[0].detail), 'в доказательстве названо действие');
ok(/100.*9\s?100|с 100 до 9 100|с 100 до 9100/.test(goldF[0].detail.replace(/ /g, ' ')),
   'показано «было → стало»');

console.log('\n── 3. Клуб золото давать МОЖЕТ — там тревоги нет ──');
log(fair, 10 * M, '/api/club/riddle/answer', '🧩 Клуб: загадка', bal(1_850_000, 5_140));
const rFair2 = await ac.scanOne(fair.id, 24);
ok(rFair2.findings.filter((f) => f.kind === 'gold').length === 0,
   'прирост золота в клубе законен — не флагуется');

console.log('\n── 4. Деньги сверх нормы ──');
// У игрока нет построек → пассивный доход 0, значит любой крупный
// прирост на «неденежном» действии подозрителен
log(cheat, 20 * M, '/api/me', 'Обновил', bal(1_000_000, 9_100));
log(cheat, 19 * M, '/api/avatar', '🖼 Сменил аватар', bal(9_000_000_000, 9_100));
const rCheat2 = await ac.scanOne(cheat.id, 24);
const moneyF = rCheat2.findings.filter((f) => f.kind === 'money');
ok(moneyF.length >= 1, `находка про деньги: ${moneyF.length}`);
ok(/аватар/i.test(moneyF[0].detail), 'названо действие, на котором это случилось');
ok(/Пассивный доход/.test(moneyF[0].detail), 'объяснено, сколько было бы законно');

console.log('\n── 5. Грабёж в бою деньги давать МОЖЕТ ──');
log(fair, 8 * M, '/api/war/attack', '⚔️ Атаковал — ПОБЕДА', bal(900_000_000, 5_140));
const rFair3 = await ac.scanOne(fair.id, 24);
ok(rFair3.findings.filter((f) => f.kind === 'money').length === 0,
   'крупная добыча в бою не считается накруткой');

console.log('\n── 6. Скрипт: слишком плотные действия ──');
for (let i = 0; i < 90; i++) {
  log(script, 10 * M - i * 600, '/api/war/attack', '⚔️ Атаковал', bal(1000 + i, 0));
}
const rScript = await ac.scanOne(script.id, 24);
const rateF = rScript.findings.filter((f) => f.kind === 'rate');
ok(rateF.length === 1, 'плотность действий отмечена');
ok(/\d+/.test(rateF[0].title), `в заголовке число: «${rateF[0].title}»`);

console.log('\n── 6б. Всплеск на стыке минут тоже виден ──');
// Раньше плотность считалась по «календарным» минутам, и скрипт,
// начавшийся в 12:00:40, делился на две половины по 45 действий —
// порог 60 не превышался ни в одной, находки не было. Теперь окно
// скользящее: специально ставим всплеск ровно на границу минуты.
const boundary = Math.ceil((Date.now() - 20 * M) / 60000) * 60000;  // ровно :00
db.appendLog({ at: boundary, userId: 'edge', userName: 'Стыкач', path: '/api/me', desc: 'x', bal: bal(1000, 0) });
for (let i = 0; i < 90; i++) {
  // 45 действий до границы и 45 после — в любой отдельной минуте меньше порога
  db.appendLog({ at: boundary - 45 * 600 + i * 600, userId: 'edge', userName: 'Стыкач',
    path: '/api/war/attack', desc: '⚔️ Атаковал', bal: bal(1000 + i, 0) });
}
U['edge'] = { id: 'edge', name: 'Стыкач', level: 50, lastSeen: Date.now(), dollars: 1000, gold: 0 };
const rEdge = await ac.scanOne('edge', 24);
const edgeRate = rEdge.findings.filter((f) => f.kind === 'rate');
ok(edgeRate.length === 1, `всплеск через границу минуты найден: находок ${edgeRate.length}`);
const num = Number((edgeRate[0] || {}).title?.match(/\d+/)?.[0] || 0);
ok(num > 60, `в окне посчитано ${num} действий — больше порога 60`);
delete U['edge'];

console.log('\n── 7. Сломанная формула: невозможные значения ──');
broken.dollars = -5000;
broken.gold = NaN;
broken.level = 9999;
const rBroken = await ac.scanOne(broken.id, 24);
const kinds = rBroken.findings.map((f) => f.kind);
ok(kinds.includes('negative'), 'отрицательные деньги замечены');
ok(kinds.includes('broken'), 'NaN замечен');
ok(kinds.includes('overlevel'), 'уровень выше потолка замечен');
ok(rBroken.findings.every((f) => f.severity === 'high'), 'всё помечено серьёзным');
const negF = rBroken.findings.find((f) => f.kind === 'negative');
ok(/формул|минус/i.test(negF.detail), 'подсказано, что это ошибка кода, а не игрока');

console.log('\n── 8. Общая сводка ──');
const all = await ac.scan(24, 40);
ok(all.players.length >= 3, `игроков с находками: ${all.players.length}`);
ok(all.players[0].score >= all.players[all.players.length - 1].score, 'самые тяжёлые сверху');
ok(typeof all.scannedPlayers === 'number' && all.scannedPlayers >= 4, `просмотрено игроков: ${all.scannedPlayers}`);
ok(!all.players.some((p) => p.name === 'Честный'), 'честный игрок в список не попал');
ok(all.players.every((p) => p.findings.length > 0), 'у каждого в списке есть доказательства');
ok(all.players.every((p) => p.id && p.name), 'указано, кто именно');

console.log('\n── 9. Ничего не банится автоматически ──');
const src = fs.readFileSync(path.join(ROOT, 'src/services/antiCheat.ts'), 'utf8');
ok(!/\.banned\s*=|setBan|banAccount/.test(src), 'сервис не трогает баны — только находит');
ok(/не блокировщик|Решение всегда за человеком/.test(src), 'намерение записано в коде');

console.log('\n── 10. Маршруты закрыты правами ──');
const rt = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
const idx = rt.indexOf("'/api/admin/anticheat'");
ok(idx > 0, 'маршрут сводки есть');
ok(/canAccessZone\(req\.user, 'security'\)/.test(rt.slice(idx, idx + 400)), 'требует зону «Безопасность»');
ok(/admin: true/.test(rt.slice(idx, rt.indexOf('multi-check'))), 'и права администратора');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main();
