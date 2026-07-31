// ═══════════════════════════════════════════════════════════════════
// Картинки минного поля: нарыв и подрыв. При успешном разминировании
// картинки нет — игрок сразу продолжает атаки.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');

console.log('\n── 1. Файлы ──');
for (const [f, what] of [['field', 'минное поле'], ['boom', 'подрыв']]) {
  const p = path.join(ROOT, 'public/img/mine', f + '.webp');
  ok(fs.existsSync(p), `${what}: ${f}.webp (${Math.round(fs.statSync(p).size / 1024)} КБ)`);
}

console.log('\n── 2. Нарыв на минное поле ──');
const card = war.slice(war.indexOf('function mineDefuseCardHtml'), war.indexOf('function mineDefuseCardHtml') + 1400);
ok(/src="\/img\/mine\/field\.webp"/.test(card), 'при обнаружении показывается картинка поля');
ok(card.indexOf('mine-banner') < card.indexOf('РАСТЯЖКА'), 'картинка стоит над заголовком');
ok(/onerror="this\.style\.display='none'"/.test(card), 'если файл не загрузится, карточка не сломается');
ok(/data-wire=/.test(card), 'выбор проводов остался на месте');

console.log('\n── 3. Подрыв ──');
const wire = war.slice(war.indexOf('async function mineDefuseWire'), war.indexOf('async function mineSacrifice'));
ok(/src="\/img\/mine\/boom\.webp"/.test(wire), 'при взрыве показывается картинка подрыва');
ok(/if \(r\.exploded\)/.test(wire), 'картинка привязана именно к взрыву');
ok(/html: true/.test(wire), 'окно переведено в режим разметки — иначе картинка вывелась бы текстом');
ok(/mine-result/.test(wire), 'текст потерь оформлен блоком');
ok(/техники,\s*\n?\s*участвовавшей в бою/.test(wire), 'состав потерь техники сохранён');
ok(/Погибло диверсантов/.test(wire), 'и потери диверсантов тоже');

console.log('\n── 4. Успешное разминирование ──');
const successPart = wire.slice(wire.indexOf('} else {'));
ok(!/img\/mine/.test(successPart), 'при удачном проходе картинки НЕТ');
ok(/App\._lastBattle = r/.test(successPart), 'сразу показывается результат боя — можно атаковать дальше');
const sacrifice = war.slice(war.indexOf('async function mineSacrifice'), war.indexOf('async function mineSacrifice') + 600);
ok(!/img\/mine/.test(sacrifice), 'при спасении смертником картинки тоже нет');

console.log('\n── 5. Оформление ──');
ok(css.includes('.mine-banner'), 'стили баннера добавлены');
ok(/\.mine-banner-dialog \{[\s\S]{0,120}margin: 0 -20px 12px/.test(css), 'в окне компенсированы поля диалога');
ok(/@media \(max-width: 400px\)[\s\S]{0,500}mine-banner/.test(css), 'на узких экранах отступы пересчитаны');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
