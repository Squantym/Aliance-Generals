// ═══════════════════════════════════════════════════════════════════
// test/numguard.test.js — числа от игрока приводятся к разумным
//
// Игрок присылает количество и суммы сам, и присылать может что угодно:
// минус десять, ноль, дробное, бесконечность, «abc». Каждое из них
// ломает расчёт по-своему — отрицательная покупка может начислить
// вместо списания, NaN расползается по всей арифметике и оседает в
// базе, Infinity переполняет счёт.
//
// В проекте для этого есть u.toInt и u.clamp, и привычка ими
// пользоваться сквозная — обстрел враждебными значениями это
// подтвердил. Этот тест закрепляет привычку: новая функция с числом от
// игрока не появится без приведения молча.
//
// Исключения перечислены поимённо. Так добавить функцию в исключения
// можно только осознанно, а не забыв про проверку.
//
// Запуск: node test/numguard.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Приведение, ограничение или явный отказ по диапазону
const SANITIZE = /(u\.toInt|u\.clamp|Math\.(floor|min|max|round|abs)|Number\(|parseInt|isFinite|Number\.isInteger)/;
const RANGE_THROW = /(throw new u\.ApiError|ApiError\()/;

// Окно в 32 строки: у banAccount приведение стоит на 21-й строке тела,
// у build — на пятой. Слишком узкое окно давало ложные тревоги, и
// список исключений раздулся бы из-за самой проверки.

// Внутренние функции: число приходит из конфига или расчёта, а не от
// игрока. Проверено по вызовам — ни одна не достижима из маршрута с
// пользовательским значением.
const INTERNAL = new Set([
  'setCd',            // club.ts: перезарядка из констант конфига
  'addSeasonRating',  // features.ts: сейчас вообще не вызывается
  'buildRound',       // tournaments.ts: номер раунда считает сам код
  'rollDice',         // club.ts: число костей — константа C.DICE_COUNT
  // buildings.ts: считалки цены. Число к ним приходит уже очищенным из
  // build(), где стоит u.clamp(u.toInt(qty, 1), 1, 100000); сами по себе
  // они из маршрутов не вызываются.
  'baseCostFor',
  'costFor',
]);

console.log('\n── 1. Разбор кода ──');
const files = fs.readdirSync(path.join(ROOT, 'src/services')).filter((n) => n.endsWith('.ts'));
ok(`сервисы найдены (${files.length})`, files.length > 20);

const rows = [];
for (const n of files) {
  const lines = fs.readFileSync(path.join(ROOT, 'src/services', n), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(lines[i]);
    if (!m) continue;
    const numArg = /\b(qty|amount|count|days|minutes|sum|price|bid|n)\s*:\s*number/.exec(m[2]);
    if (!numArg) continue;
    // Проверка должна касаться САМОГО числа, а не быть любой рядом.
    // Первая версия теста считала функцию защищённой из-за постороннего
    // throw в начале — и не заметила снятого приведения в units.buy.
    // Зелёная проверка, которая ничего не проверяет, хуже её отсутствия.
    const arg = numArg[1];
    // Тело — до начала СЛЕДУЮЩЕЙ функции, а не «столько-то строк».
    // Окно фиксированной длины залезало в соседнюю функцию, и приведение
    // оттуда засчитывалось текущей: тест оставался зелёным даже со снятым
    // u.clamp в units.buy. Проверка, которую нельзя уронить нарочно,
    // ничего не стережёт.
    let end = i + 1;
    while (end < lines.length && !/^function\s/.test(lines[end])) end++;
    const body = lines.slice(i, end);
    const argRe = new RegExp('(^|[^\\w$])' + arg + '([^\\w$]|$)');
    const guarded = body.some((l) => argRe.test(l)
      && (SANITIZE.test(l) || (RANGE_THROW.test(l) && /[<>=]/.test(l))));
    rows.push({ file: n, fname: m[1], arg: arg, line: i + 1, guarded: guarded });
  }
}
ok(`функции с числом от игрока найдены (${rows.length})`, rows.length > 15);

console.log('\n── 2. Каждая либо приводит число, либо признана внутренней ──');
const bad = rows.filter((r) => !r.guarded && !INTERNAL.has(r.fname));
ok(bad.length
  ? `без приведения: ${bad.map((r) => `${r.file}:${r.line} ${r.fname}(${r.arg})`).join(', ')}`
  : 'все числа от игрока приводятся к разумным',
   bad.length === 0);

console.log('\n── 3. Список исключений не разросся ──');
// Если исключений становится много, значит привычка потерялась, и тест
// превращается в список отговорок.
ok(`исключений ${INTERNAL.size} — немного`, INTERNAL.size <= 8);
const stillThere = [...INTERNAL].filter((name) => rows.some((r) => r.fname === name));
ok(`все исключения ещё существуют в коде (${stillThere.length} из ${INTERNAL.size})`,
   stillThere.length === INTERNAL.size);

console.log('\n── 4. Сама проверка работает ──');
// Без этого раздела тест был бы зелёным и с пустым разбором.
const sampleGuarded = 'function buy(user: User, id: string, qty: number) {\n  qty = u.clamp(qty, 1, 10);\n}';
const sampleBare = 'function buy(user: User, id: string, qty: number) {\n  user.units += qty;\n}';
ok('образец с приведением признаётся защищённым', SANITIZE.test(sampleGuarded));
ok('образец без приведения — незащищённым', !SANITIZE.test(sampleBare) && !RANGE_THROW.test(sampleBare));

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
