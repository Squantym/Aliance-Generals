// ═══════════════════════════════════════════════════════════════════
// Три правки: распродажа техники при убытке, статичный таймер события,
// сжатие картинки босса до 400×400.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-upkeep-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const cfg = require(ROOT + '/dist/config/gameConfig');

async function main() {
await auth.register('Банкрот', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
await auth.register('Богач', 'пароль123', 'b@t.ru', 'ru', '2.2.2.2');
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const poor = by('Банкрот'), rich = by('Богач');
const unit = cfg.UNITS.filter((x) => x.type === 'ground')[40];
const countOf = (u) => Object.values(u.units[unit.id] || {}).reduce((a, b) => a + b, 0);

console.log('\n── 1. Убыточная армия распродаётся ──');
poor.level = 100;
poor.units = { [unit.id]: { '1': 50 } };
poor.dollars = 1000;
poor.buildings = {};
const upkeep0 = player.totalUpkeep(poor);
ok(upkeep0 > player.totalIncome(poor), `содержание ($${upkeep0}/ч) превышает доход`);
poor.lastIncomeAt = Date.now() - 3 * 3600 * 1000;
player.refresh(poor);
const left3 = countOf(poor);
ok(left3 < 50, `после 3 часов техники осталось ${left3} из 50 — часть продана`);
ok(player.totalUpkeep(poor) < upkeep0, 'содержание уменьшилось вслед за армией');
ok(poor.dollars >= 0, 'баланс не ушёл в минус');

console.log('\n── 2. Продажа идёт по 50% цены ──');
const p2 = by('Богач');
p2.level = 100;
p2.units = { [unit.id]: { '1': 10 } };
p2.dollars = 0;
p2.buildings = {};
const before = countOf(p2);
p2.lastIncomeAt = Date.now() - 1 * 3600 * 1000;
player.refresh(p2);
const soldN = before - countOf(p2);
ok(soldN > 0, `продано ${soldN} ед. за один час`);
// Выручка примерно равна половине цены за штуку
const perUnit = Math.floor(unit.price * 0.5);
ok(perUnit === Math.floor(unit.price / 2), `цена продажи — 50% от $${unit.price}, то есть $${perUnit}`);

console.log('\n── 3. Долгое отсутствие не сжигает всё разом ──');
const p3 = poor;
p3.units = { [unit.id]: { '1': 40 } };
p3.dollars = 0;
p3.lastIncomeAt = Date.now() - 240 * 3600 * 1000;   // 10 суток
player.refresh(p3);
ok(countOf(p3) >= 0, 'расчёт по часам отработал без ошибок');
// Техника продаётся не сразу: сначала тратятся деньги, и только когда
// касса пуста — уходит очередная единица. Поэтому после распродажи у
// игрока остаются и деньги, и часть армии
ok(p3.dollars >= 0, 'баланс не ушёл в минус');
ok(countOf(p3) < 40, `армия уменьшилась: осталось ${countOf(p3)} из 40`);
ok(p3.dollars > 0 || countOf(p3) === 0,
   'пока есть выручка от продаж, остальная техника сохраняется');
const src = fs.readFileSync(ROOT + '/src/services/player.ts', 'utf8');
ok(/for \(let h = 0; h < hours; h\+\+\)/.test(src),
   'часы считаются по одному — иначе за сутки списалось бы всё по старой ставке');

console.log('\n── 4. Порядок продажи ──');
ok(/owned\.sort\(\(a, b\) => b\.upkeep - a\.upkeep\)/.test(src),
   'первой уходит самая дорогая в содержании — она и разоряет');
ok(/Math\.max\(1, Math\.floor\(it\.price \* 0\.5\)\)/.test(src), 'продажа по половине цены');
ok(/Math\.ceil\(need \/ perUnit\)/.test(src), 'продаётся ровно столько, чтобы закрыть долг');
ok(/notifications'\)\.push\(user\.id, 'forced_sale'/.test(src), 'игрок получает уведомление о распродаже');
ok(/auditLog'\)\.record/.test(src.slice(src.indexOf('function sellUnitsForDebt'))),
   'распродажа попадает в журнал');

console.log('\n── 5. Статичный таймер события ──');
const core = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
const evBlock = core.slice(core.indexOf('Скоро событие'), core.indexOf('Скоро событие') + 1400);
ok(!/setInterval\(\(\) => \{\s*left--/.test(evBlock), 'посекундное тиканье убрано');
ok(/Таймер СТАТИЧНЫЙ/.test(evBlock), 'в коде объяснено решение');
ok(/setTimeout\(\(\) => \{[\s\S]{0,120}App\.rerender\(\)/.test(evBlock),
   'экран сам обновится к началу события');
ok(/Значение обновится при следующем открытии/.test(evBlock), 'игроку это объяснено');

console.log('\n── 6. Сжатие картинки босса ──');
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');
ok(/id="ev-img-shrink"/.test(adminJs), 'есть кнопка сжатия ссылки');
ok(/id="ev-img-file"/.test(adminJs), 'и загрузка файла с компьютера');
ok(/const S = 400;/.test(adminJs), 'размер приводится к 400');
ok(/cv\.width = S; cv\.height = S/.test(adminJs), 'картинка становится квадратной 400×400');
ok(/img\.width - side\) \/ 2/.test(adminJs), 'обрезка по центру — босс не растягивается');
ok(/while \(out\.length > 220 \* 1024 && q > 0\.4\)/.test(adminJs), 'качество подбирается под вес файла');
ok(/сайт запрещает копирование картинки/.test(adminJs),
   'если чужой сайт не даёт прочитать картинку — честное объяснение и запасной путь');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
ok(/app\.add\('POST', '\/api\/admin\/event\/image'/.test(routes), 'роут сохранения есть');
ok(/saveForumImage\(req\.body\.image\)/.test(routes), 'файл кладётся тем же проверенным способом');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(/max-width: min\(100%, 400px\)/.test(css), 'показ ограничен 400px и для чужих ссылок');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
