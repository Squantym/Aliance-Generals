// ═══════════════════════════════════════════════════════════════════
// Правки интерфейса: баннеры результата боя, прокрутка к началу боя,
// умещение кнопок на узких экранах.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');

console.log('\n── 1. Картинки вместо надписей ──');
for (const f of ['win', 'lose']) {
  const p = path.join(ROOT, 'public/img/battle', f + '.webp');
  ok(fs.existsSync(p), `картинка ${f}.webp на месте (${Math.round(fs.statSync(p).size / 1024)} КБ)`);
}
ok(/img class="result-banner" src="\/img\/battle\/\$\{b\.win \? 'win' : 'lose'\}\.webp"/.test(war),
   'в карточке боя выводится баннер победы или поражения');
ok(!/result-title[^>]*>\$\{b\.win \? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'\}</.test(war), 'текстовый заголовок заменён');
ok(/onerror=[\s\S]{0,200}ПОБЕДА!/.test(war), 'если картинка не загрузится — вернётся текстовая надпись');
ok(css.includes('.result-banner'), 'стили баннера добавлены');
ok(/\.result-banner \{[\s\S]{0,160}width: calc\(100% \+ 34px\)/.test(css), 'баннер растянут на всю ширину карточки');

console.log('\n── 2. Прокрутка к началу боя ──');
ok(/window\.scrollTo\(\{ top: 0, behavior: 'auto' \}\);\s*\n\s*App\.rerenderTo/.test(war),
   'после атаки страница сначала уходит наверх, затем наводится на карточку');
ok(/App\.rerenderTo\(r\.encounter \? 'war-encounter' : 'battle-result'\)/.test(war), 'наведение на нужный блок сохранено');
ok(app.includes("block: 'start'"), 'блок встаёт началом к верху экрана');
ok(css.includes('scroll-margin-top'), 'учтён отступ, чтобы не уехать под шапку');

console.log('\n── 3. Узкие экраны ──');
ok(!/\$\{left\} осталось/.test(core), 'счётчик «N осталось» убран из кнопки ежедневных заданий');
ok(/badge green">бонус</.test(core), 'осталась короткая пометка о готовом бонусе');
ok(!/\$\{ready\} к выдаче/.test(core), 'у контрактов подпись тоже укорочена');
ok(/@media \(max-width: 380px\)/.test(css), 'есть правила для экранов уже 380px');
ok(/@media \(max-width: 340px\)/.test(css), 'и отдельные для самых узких (320px)');
const narrow = css.slice(css.indexOf('@media (max-width: 380px)'), css.indexOf('@media (max-width: 340px)'));
ok(/word-break: break-word/.test(narrow), 'длинные подписи переносятся, а не обрезаются');
ok(/\.menu-btn \{[\s\S]{0,200}font-size: 11\.5px/.test(narrow), 'шрифт кнопок уменьшен');
ok(/\.tab \{ padding: 6px 8px/.test(narrow), 'вкладки ужаты');
ok(/\.btn-inline \{ padding: 5px 8px/.test(narrow), 'кнопки внутри карточек тоже');
ok(/img\.ic-menu \{ width: 30px/.test(narrow), 'иконки уменьшены, чтобы освободить место под текст');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
