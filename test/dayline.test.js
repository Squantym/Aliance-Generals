// ═══════════════════════════════════════════════════════════════════
// test/dayline.test.js — сутки в игре у всех одни
//
// «Новый день» в игре наступает в полночь по Москве. От этого зависят
// суточные задания, лимиты, аукцион, шахты, статистика — десяток
// независимых механик. Правило простое, и именно поэтому его переписывали
// в каждом файле заново: сдвиг +3 часа был выписан числом в десяти местах.
//
// И один файл его не получил: mailQuota считал сутки по UTC, то есть
// суточный лимит писем сбрасывался в 03:00 по Москве. Три часа после
// полуночи расход числился вчерашним — а это тот самый счётчик, упершись
// в который игра перестаёт слать коды подтверждения.
//
// Тест закрепляет две вещи: правило живёт в одном месте (core/utils), и
// новая копия «+3 часа» в src/ не появится молча.
//
// Запуск: node test/dayline.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const u = require(path.join(ROOT, 'dist/src/core/utils'));

console.log('\n── 1. Граница суток — московская полночь ──');
// 2 сентября 2026, 21:30 UTC — это уже 00:30 3 сентября по Москве.
const justAfterMskMidnight = Date.parse('2026-09-02T21:30:00Z');
const justBeforeMskMidnight = Date.parse('2026-09-02T20:30:00Z'); // 23:30 МСК 2-го
ok('00:30 МСК — это уже новые сутки', u.dayKey(justAfterMskMidnight) === '2026-09-03');
ok('23:30 МСК — ещё прежние сутки', u.dayKey(justBeforeMskMidnight) === '2026-09-02');
ok('переход происходит ровно между ними',
   u.dayKey(justBeforeMskMidnight) !== u.dayKey(justAfterMskMidnight));

// Ровно в момент границы должны начинаться новые сутки, а миллисекундой
// раньше — ещё старые. Разбежка на миллисекунду здесь означала бы, что
// два счётчика в один и тот же миг числят разный день.
const boundary = Date.parse('2026-09-02T21:00:00.000Z');
ok('ровно в полночь МСК — новый день', u.dayKey(boundary) === '2026-09-03');
ok('за миллисекунду до — прежний', u.dayKey(boundary - 1) === '2026-09-02');
ok('dayStart указывает ровно на эту границу', u.dayStart(boundary) === boundary);
ok('dayStart от полудня тех же суток — та же граница',
   u.dayStart(boundary + 12 * 3600 * 1000) === boundary);
ok('месяц берётся из тех же суток', u.monthKey(boundary) === '2026-09');

// Месяц тоже обязан переключаться по Москве: 31 августа 21:00 UTC — это
// уже 1 сентября в Москве, и месячный счётчик писем должен обнулиться.
const monthEdge = Date.parse('2026-08-31T21:00:00Z');
ok('месяц переключается по московской полуночи', u.monthKey(monthEdge) === '2026-09');
ok('за час до — ещё август', u.monthKey(monthEdge - 3600 * 1000) === '2026-08');

const now = Date.now();
const canon = u.dayKey(now);
ok('ключ выглядит как дата', /^\d{4}-\d{2}-\d{2}$/.test(canon));
ok('месяц — первые семь символов дня', u.monthKey(now) === canon.slice(0, 7));

console.log('\n── 2. Суточные механики берут день оттуда же ──');
// Проверяем не текст исходника, а сам ответ функций из dist — того кода,
// что крутится на сервере. Совпадение должно держаться и на границе
// суток, а не только в середине дня: именно там расхождение и вылезало.
const S = (n) => require(path.join(ROOT, 'dist/src/services', n));
const vipDay = S('vip').mskDayKey;
const lotsDay = S('lots').mskDay;

for (const [label, ts] of [['сейчас', now], ['00:30 МСК', justAfterMskMidnight], ['23:30 МСК', justBeforeMskMidnight]]) {
  const want = u.dayKey(ts);
  ok(`vip (${label}) — тот же день, что у всех`, vipDay(ts) === want);
  ok(`лоты (${label}) — тот же день, что у всех`, lotsDay(ts) === want);
}

console.log('\n── 3. Отдельных копий правила в src/ не осталось ──');
// Правило живёт в core/utils. Любое «+ 3 * 3600 * 1000» в другом файле —
// это начало нового расхождения.
function walk(dir, out) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith('.ts')) out.push(p);
  }
  return out;
}
const srcFiles = walk(path.join(ROOT, 'src'), []);
ok(`исходники найдены (${srcFiles.length})`, srcFiles.length > 30);

const OFFSET = /(3\s*\*\s*3600\s*\*\s*1000|3\s*\*\s*60\s*\*\s*60\s*\*\s*1000|10800000)/;
const copies = srcFiles.filter((p) => {
  if (p.endsWith(path.join('core', 'utils.ts'))) return false; // здесь оно и должно быть
  return fs.readFileSync(p, 'utf8').split('\n').some((l) => OFFSET.test(l));
}).map((p) => path.relative(ROOT, p));
ok(copies.length ? `сдвиг переписан заново в: ${copies.join(', ')}` : 'сдвиг задан ровно в одном месте',
   copies.length === 0);

// Голая UTC-дата — ровно та ошибка, что была в mailQuota
const UTC_DAY = /new Date\(\s*\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*(10|7)\s*\)/;
const utcDays = srcFiles.filter((p) => UTC_DAY.test(fs.readFileSync(p, 'utf8')))
  .map((p) => path.relative(ROOT, p));
ok(utcDays.length ? `дата по UTC вместо МСК в: ${utcDays.join(', ')}` : 'дат по UTC не осталось',
   utcDays.length === 0);

console.log('\n── 4. mailQuota считает сутки как все ──');
// Раздел именной: именно здесь расхождение и было.
const mq = fs.readFileSync(path.join(ROOT, 'src/services/mailQuota.ts'), 'utf8');
ok('mailQuota берёт день из общего правила', /u\.dayKey\(\)/.test(mq));
ok('mailQuota берёт месяц из общего правила', /u\.monthKey\(\)/.test(mq));

console.log('\n── 5. Сама проверка умеет краснеть ──');
// Без этого раздела тест был бы зелёным и с пустым разбором.
ok('строка с копией сдвига распознаётся', OFFSET.test('const x = 3 * 3600 * 1000;'));
ok('строка без неё — нет', !OFFSET.test('const x = 24 * 3600 * 1000;'));
ok('дата по UTC распознаётся', UTC_DAY.test("return new Date().toISOString().slice(0, 10);"));
ok('дата со сдвигом — не ложная тревога', !UTC_DAY.test("return new Date(t + OFF).toISOString().slice(0, 10);"));

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
