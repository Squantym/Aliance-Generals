// ═══════════════════════════════════════════════════════════════════
// test/gbhistory.test.js — история групповых боёв показывает ИСХОД
//
// Ошибка, ради которой написан тест: сервер записывает исход одним
// полем result ('win' | 'lose' | 'draw' | 'forfeit'), а экран читал
// h.won / h.draw / h.forfeit — таких полей нет. Все три давали
// undefined, и КАЖДЫЙ бой показывался как поражение, включая
// выигранные. Игрок видел «Поражение» после победы.
//
// Это не опечатка в одном месте, а расхождение договора между сервером
// и клиентом. Поэтому проверяем не текст, а сам договор: какие поля
// сервер пишет и какие поля экран читает.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const srv = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');

console.log('\n── 1. Что сервер кладёт в личную историю ──');
// Берём именно тот кусок, где формируется запись истории игрока
const at = srv.indexOf('list.unshift({\n      at: Date.now(),');
const rec = srv.slice(at, at + 400);
ok(at > 0, 'нашли место записи истории');
// Ключи ищем по всей записи, а не по началу строки: часть полей стоит
// парами в одной строке (kills: …, damage: …), и построчный разбор их
// терял — тест тогда «находил» несуществующее расхождение.
const serverKeys = [...rec.matchAll(/([a-zA-Z]+):/g)].map((m) => m[1]);
ok(serverKeys.includes('result'), `исход пишется полем result (поля: ${serverKeys.join(', ')})`);
ok(!serverKeys.includes('won'), 'поля won сервер НЕ пишет');
ok(serverKeys.includes('role'), 'роль пишется полем role, а не roleLabel');
for (const v of ['win', 'lose', 'draw']) {
  ok(rec.includes(`'${v}'`), `возможное значение исхода: ${v}`);
}
ok(/result: 'forfeit'/.test(srv), 'для не явившегося отдельный исход forfeit');

console.log('\n── 2. Что читает экран ──');
// Комментарии вырезаем: в них перечислены как раз те поля, которых
// быть не должно, и проверка «их не осталось» падала на объяснении,
// почему их не осталось.
const blockRaw = war.slice(war.indexOf('d.myHistory.map('), war.indexOf('d.myHistory.map(') + 1600);
const block = blockRaw.replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
ok(/h\.result === 'win'/.test(block), 'экран определяет победу по result');
ok(/h\.result === 'draw'/.test(block), 'ничья — тоже по result');
ok(/h\.result === 'forfeit'/.test(block), 'неявка — тоже по result');
ok(!/h\.won\b/.test(block), 'обращений к несуществующему h.won не осталось');
ok(!/h\.draw\b/.test(block), 'и к h.draw');
ok(/h\.role\b/.test(block), 'роль берётся из h.role');

console.log('\n── 3. Договор сходится по каждому полю ──');
// Главная проверка: всё, что экран читает у записи истории, сервер
// действительно пишет. Именно расхождение здесь и было ошибкой.
const readKeys = [...block.matchAll(/\bh\.([a-zA-Z]+)/g)].map((m) => m[1]);
const uniqRead = [...new Set(readKeys)];
const missing = uniqRead.filter((k) => !serverKeys.includes(k) && k !== 'roleLabel');
ok(missing.length === 0,
   `экран не читает ничего лишнего (читает: ${uniqRead.join(', ')})`
   + (missing.length ? ` — НЕТ на сервере: ${missing.join(', ')}` : ''));

console.log('\n── 4. Победа отличается от поражения и на вид ──');
ok(/hist-win/.test(block) && /hist-lose/.test(block), 'у победы и поражения разные классы');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(/\.hist-win\s*\{/.test(css) && /\.hist-lose\s*\{/.test(css), 'оба класса описаны в оформлении');

console.log('\n── 5. Общая история и личная — разные вещи ──');
// В общей истории лежит только победившая команда: по ней нельзя
// сказать, выиграл ли конкретный игрок. Личная история существует
// именно поэтому — и экран обязан брать её, а не общую.
ok(/s\.history\.unshift\(\{ id: b\.id, at: b\.finishedAt, winnerTeam/.test(srv),
   'в общей истории только номер победившей команды');
// В war.js есть ещё история АРЕНЫ (d.history с winnerName/pot) — это
// другой экран и другая сущность, запрещать её нельзя.
ok(/d\.myHistory/.test(war), 'экран группового боя показывает личную историю');
const gbHistCard = war.slice(war.indexOf('Ваши последние бои') - 200, war.indexOf('Ваши последние бои') + 1800);
ok(!/d\.history\b/.test(gbHistCard),
   'в карточке личной истории общая история не используется');
const arenaCard = war.slice(war.indexOf('Последние бои') - 100, war.indexOf('Последние бои') + 600);
ok(/h\.winnerName/.test(arenaCard), 'история арены — про победителя турнира, это отдельная вещь');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
