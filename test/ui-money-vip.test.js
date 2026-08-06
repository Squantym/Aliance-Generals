// ═══════════════════════════════════════════════════════════════════
// Компактная запись денег, единственный значок VIP и золотая кнопка
// покупки.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const UI = {};
eval(fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8').replace(/^const UI = /m, 'const _UI = ') + ';Object.assign(UI,_UI);');
const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');

console.log('\n── 1. Значок VIP не двоится ──');
const marks = (core.match(/App\.vipMark\(p\.vip\)/g) || []).length;
ok(marks === 1, `значок выводится ровно один раз (было два)`);
ok(/pf2-name">[\s\S]{0,80}<\/span>\$\{App\.vipMark\(p\.vip\)\}/.test(core), 'стоит сразу после имени');
ok(/role-tag role-tag-\$\{p\.staffRole\}/.test(core), 'приписка роли выводится отдельно и не дублируется');

console.log('\n── 2. Кнопка покупки золотая ──');
ok(!/\.pf2-vip-btn \{ width: 100%; opacity: \.55/.test(css),
   'приглушённость от старой заглушки убрана');
ok(/\.pf2-vip-btn \{ width: 100%; cursor: pointer/.test(css), 'кнопка выглядит нажимаемой');
ok(/\.btn\.vip-buy, \.vip-buy \{/.test(css),
   'селектор усилен классом .btn — общий стиль кнопок перебивал золотой фон');
ok(/background: linear-gradient\(150deg, #f3d27a, #c9a227\) !important/.test(css),
   'золотая заливка задана с приоритетом');
ok(/color: #1a1408 !important/.test(css), 'тёмный текст на золоте');
for (const t of ['light', 'paper', 'sand']) {
  ok(css.includes(`body.theme-${t} .btn.vip-buy`), `на светлой теме «${t}» кнопка тёмная`);
}

console.log('\n── 3. Короткая запись денег ──');
ok(UI.fmtMoney(1500) === '1 500', 'мелкие суммы пишутся полностью');
ok(UI.fmtMoney(250000) === '250 K', `сотни тысяч: ${UI.fmtMoney(250000)}`);
ok(UI.fmtMoney(3.4e6) === '3.4 M', `миллионы: ${UI.fmtMoney(3.4e6)}`);
ok(UI.fmtMoney(7.8e9) === '7.8 Bn', `миллиарды: ${UI.fmtMoney(7.8e9)}`);
ok(UI.fmtMoney(21.02e12) === '21.02 Tr', `триллионы: ${UI.fmtMoney(21.02e12)}`);
// Ради этого всё и делалось: раньше шкала обрывалась на Tr
ok(UI.fmtMoney(3.4e15) === '3.4 Qd', `квадриллионы: ${UI.fmtMoney(3.4e15)} (было «3400 Tr»)`);
ok(UI.fmtMoney(1.2e18) === '1.2 Qn', `квинтиллионы: ${UI.fmtMoney(1.2e18)} (было «1200000 Tr»)`);
ok(UI.fmtMoney(5e21) === '5 Sx', `секстиллионы: ${UI.fmtMoney(5e21)}`);
// Длина строки — то, из-за чего суммы обрезались в шапке
for (const n of [3.4e15, 9.9e17, 1.2e18, 5e21, 21.02e12]) {
  ok(UI.fmtMoney(n).length <= 9, `«${UI.fmtMoney(n)}» помещается в узкую колонку`);
}
ok(UI.fmtMoney(0) === '0', 'ноль не ломается');
ok(UI.fmtMoney(-2.5e12) === '-2.5 Tr', `отрицательные тоже: ${UI.fmtMoney(-2.5e12)}`);

console.log('\n── 4. Полная запись словами ──');
ok(UI.fmtMoneyFull(1e12) === '1 триллион', `${UI.fmtMoneyFull(1e12)}`);
ok(UI.fmtMoneyFull(2e12) === '2 триллиона', `${UI.fmtMoneyFull(2e12)}`);
ok(UI.fmtMoneyFull(5e12) === '5 триллионов', `${UI.fmtMoneyFull(5e12)}`);
ok(UI.fmtMoneyFull(11e12) === '11 триллионов', `11 — исключение: ${UI.fmtMoneyFull(11e12)}`);
ok(UI.fmtMoneyFull(21.02e12) === '21,02 триллиона',
   `у дробных родительный падеж: ${UI.fmtMoneyFull(21.02e12)}`);
ok(UI.fmtMoneyFull(1.5e15) === '1,5 квадриллиона', `${UI.fmtMoneyFull(1.5e15)}`);
ok(/title="\$\{UI\.fmtMoneyFull\(m\.dollars\)\}"/.test(app),
   'в шапке подсказка показывает сумму словами');

console.log('\n── 5. Шапка на узких экранах ──');
ok(/@media \(max-width: 400px\)[\s\S]{0,400}\.res-row > div/.test(css), 'на 400 точках шрифт мельче');
ok(/@media \(max-width: 340px\)[\s\S]{0,400}font-size: 10\.5px/.test(css), 'на 340 точках ещё мельче');
ok(/text-overflow: ellipsis/.test(css.slice(css.indexOf('@media (max-width: 340px)'))),
   'если сумма всё же длиннее — многоточие вместо обрезки без предупреждения');

console.log('\n── 6. Очки навыков в шапке ──');
// Значок с числом («+31») не помещался в колонку уровня на узких экранах
ok(!/class="badge">\+' \+ m\.skillPoints/.test(app), 'значок с числом убран из шапки');
ok(/class="sp-dot"/.test(app), 'вместо него компактная точка');
ok(/m\.skillPoints > 0 \? '<span class="sp-dot"/.test(app), 'точка показывается только при наличии очков');
ok(/title="\$\{m\.skillPoints > 0 \? 'Нераспределённых очков навыков: '/.test(app),
   'точное число видно в подсказке');
ok(/aria-label="есть нераспределённые очки"/.test(app), 'есть подпись для озвучивания');
ok(/\.sp-dot \{[\s\S]{0,200}font-size: 9px/.test(css), 'точка мелкая');
ok(/@keyframes spPulse/.test(css), 'мигает, чтобы не потеряться');
ok(/\.sp-dot \{[\s\S]{0,200}color: var\(--orange-1\)/.test(css), 'заметного цвета');
// Длина строки — то, из-за чего колонку обрезало
const was = '⭐ Ур. 300 +31'.length;
const now = '⭐ Ур. 300●'.length;
ok(now < was, `строка короче на ${was - now} знака: «${was}» → «${now}»`);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
