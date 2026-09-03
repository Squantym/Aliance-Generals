// ═══════════════════════════════════════════════════════════════════
// test/clientdupes.test.js — одноимённые методы в клиенте
//
// Клиент на 226 КБ не проходит НИКАКОЙ проверки: public/ исключён из
// сборки, типов там нет, компилятор его не видит. Значит и опечатки, и
// случайные дубли живут в нём столько, сколько повезёт.
//
// Этот тест закрывает один узкий, но неприятный случай: два метода с
// одним именем в одном объекте. В JavaScript побеждает ПОСЛЕДНИЙ, а
// первый становится мёртвым кодом — молча, без единого предупреждения.
//
// Так в app.js жили две vipMark подряд, различавшиеся пробелом перед
// значком. Работала вторая; у первой при этом стоял более подробный
// комментарий — то есть правили бы, скорее всего, именно её, и правка
// ничего бы не меняла. Такое выясняется только опытным путём и стоит
// часа недоумения.
//
// Проверка нарочно узкая: только объявления методов на верхнем уровне
// объекта (отступ в два пробела, строка кончается открывающей скобкой).
// Широкая ловила бы вызовы и утонула бы в ложных тревогах, а тест,
// который врёт, перестают читать.
//
// Запуск: node test/clientdupes.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const walk = (d) => fs.readdirSync(d).flatMap((n) => {
  const p = path.join(d, n);
  return fs.statSync(p).isDirectory() ? walk(p) : (n.endsWith('.js') ? [p] : []);
});

const SKIP = /^(if|for|while|switch|catch|function|return|else|do|try)\b/;

function dupesIn(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const seen = new Map();
  lines.forEach((l, i) => {
    // Объявление метода, а не вызов: параметры и сразу открывающая скобка
    const m = /^ {2}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/.exec(l);
    if (!m || SKIP.test(l.trim())) return;
    if (!seen.has(m[1])) seen.set(m[1], []);
    seen.get(m[1]).push(i + 1);
  });
  return [...seen.entries()].filter(([, at]) => at.length > 1);
}

console.log('\n── 1. Дублей нет ни в одном файле клиента ──');
const files = walk(path.join(ROOT, 'public/js'));
ok(`файлы клиента найдены (${files.length})`, files.length > 5);

const all = [];
for (const f of files) {
  for (const [name, at] of dupesIn(f)) {
    all.push(`${path.relative(ROOT, f).replace(/\\/g, '/')} → ${name}() строки ${at.join(', ')}`);
  }
}
ok(all.length ? `дубли: ${all.join(' | ')}` : 'одноимённых методов нет', all.length === 0);

console.log('\n── 2. Сама проверка работает ──');
// Без этого раздела тест был бы зелёным и с поломанным поиском: список
// пуст — значит всё хорошо. Проверяем на заведомом образце.
const sample = [
  'const X = {',
  '  alpha(a) {',
  '    return a;',
  '  },',
  '  beta() {',
  '    return 1;',
  '  },',
  '  alpha(a) {',
  '    return a + 1;',
  '  },',
  '};',
].join('\n');
const tmp = path.join(require('os').tmpdir(), 'dupcheck-sample.js');
fs.writeFileSync(tmp, sample);
const found = dupesIn(tmp);
ok('на образце с дублем он находится', found.length === 1 && found[0][0] === 'alpha');
ok('и указаны обе строки', found.length === 1 && found[0][1].length === 2);
fs.writeFileSync(tmp, sample.replace("  alpha(a) {\n    return a + 1;\n  },\n", ''));
ok('на образце без дубля тревоги нет', dupesIn(tmp).length === 0);
try { fs.unlinkSync(tmp); } catch (e) {}

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
