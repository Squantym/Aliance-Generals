// ═══════════════════════════════════════════════════════════════════
// Картинки события «взлом хранилища»: обнаружение, успех, провал.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');

console.log('\n── 1. Файлы на месте ──');
for (const [f, what] of [['found', 'обнаружение хранилища'], ['success', 'успешный взлом'], ['fail', 'провал']]) {
  const p = path.join(ROOT, 'public/img/safe', f + '.webp');
  ok(fs.existsSync(p), `${what}: ${f}.webp (${Math.round(fs.statSync(p).size / 1024)} КБ)`);
}

console.log('\n── 2. Обнаружение сейфа ──');
const cardBlock = war.slice(war.indexOf('function bankHackCardHtml'), war.indexOf('function bankHackCardHtml') + 1200);
ok(/src="\/img\/safe\/found\.webp"/.test(cardBlock), 'в карточке обнаружения выводится картинка хранилища');
ok(/onerror="this\.style\.display='none'"/.test(cardBlock), 'если файл не загрузится — карточка не сломается');
ok(cardBlock.indexOf('safe-banner') < cardBlock.indexOf('Обнаружен сейф'), 'картинка стоит выше заголовка');

console.log('\n── 3. Результат взлома ──');
const resBlock = war.slice(war.indexOf('function showSafeResult'), war.indexOf('function showSafeResult') + 1600);
ok(/\$\{win \? 'success' : 'fail'\}\.webp/.test(resBlock), 'картинка выбирается по исходу: успех или провал');
ok(/const win = bh\.stolen > 0 && !bh\.alarmed/.test(resBlock), 'успехом считается взлом без сигнализации');
ok(/alarmed[\s\S]{0,200}тревогу/.test(resBlock), 'при сигнализации показывается провальная картинка и объяснение');
ok(/Попытки закончились/.test(resBlock), 'при исчерпании попыток — тоже провал');
ok(/safe-banner-dialog/.test(resBlock), 'в окне используется свой класс — поля диалога уже, чем у карточки');

console.log('\n── 4. Оформление ──');
ok(css.includes('.safe-banner'), 'стили баннера добавлены');
ok(/\.safe-banner \{[\s\S]{0,140}width: calc\(100% \+ 34px\)/.test(css), 'в карточке баннер на всю ширину, включая поля');
ok(/\.safe-banner-dialog \{[\s\S]{0,140}margin: 0 -20px 12px/.test(css), 'в окне компенсированы только боковые поля — заголовок остаётся сверху');
ok(/@media \(max-width: 400px\)[\s\S]{0,400}safe-banner/.test(css), 'на узких экранах отступы пересчитаны');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
