// Иконки уши/жетоны/РЕЗ: файлы, CSS и корректность вставки в разметку.
const assert=require('assert'); const fs=require('fs'); const path=require('path');
let passed=0;
const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};
const ROOT=path.join(__dirname,'..');
const FRONT=['public/js/app.js','public/js/screens/social.js','public/js/screens/core.js',
             'public/js/screens/market.js','public/js/screens/war.js','public/js/screens/economy.js',
             'public/js/screens/news.js','public/js/admin.js'].filter(f=>fs.existsSync(path.join(ROOT,f)));

console.log('\n[1] Файлы иконок на месте');
for (const n of ['crest','truce','reserve']) {
  const p=path.join(ROOT,'public/img/icons',n+'.webp');
  ok(`иконка ${n}.webp есть`, fs.existsSync(p));
  ok(`иконка ${n}.webp лёгкая (<40 KB)`, fs.statSync(p).size < 40*1024);
}

console.log('\n[2] CSS-классы объявлены');
const css=fs.readFileSync(path.join(ROOT,'public/css/style.css'),'utf8');
for (const n of ['crest','truce','reserve']) {
  // Файл и класс называются по-разному только у жетона: файл truce.webp,
  // а класс .ic-token — он уже стоит в разметке в десятках мест, и
  // переименовывать его ради единообразия значило бы править их все.
  const cls = n === 'truce' ? 'token' : n;
  const lines = css.split(String.fromCharCode(10));
  ok(`.ic-${cls} берёт картинку ${n}.webp`,
     lines.some((ln) => ln.includes(".ic-" + cls) && ln.includes("icons/" + n + ".webp")));
  ok(`.ic-${cls} в общем правиле размеров`,
     lines.some((ln) => ln.includes(".ic-" + cls) && ln.includes(",")));
}

console.log('\n[3] Иконки не ломают разметку');
for (const f of FRONT) {
  const s=fs.readFileSync(path.join(ROOT,f),'utf8');
  // HTML внутри атрибута placeholder/title/alt рвёт разметку вложенными кавычками
  ok(`${f}: нет HTML внутри placeholder`, !/placeholder="[^"]*<span/.test(s));
  ok(`${f}: нет HTML внутри <option>`, !/<option[^>]*>[^<]*<span class="ic-/.test(s));
}

console.log('\n[4] Валюта показана иконками в ключевых местах');
const core=fs.readFileSync(path.join(ROOT,'public/js/screens/core.js'),'utf8');
ok('профиль: гербы — иконкой', core.includes('ic-crest') && core.includes('Гербы штабов'));
ok('профиль: вернуть часть — иконкой', core.includes('pf-restore-crest') && core.includes('Вернуть часть герба'));
ok('банк: вкладка резерва — иконкой', /ic-reserve[\s\S]{0,20}Резерв/.test(core));
ok('награды сезона: жетоны — иконкой', /ic-token[\s\S]{0,30}tokens/.test(core));

const app=fs.readFileSync(path.join(ROOT,'public/js/app.js'),'utf8');
// v52: заголовок окна стал переменным (одно ухо / оба уха по трофею),
// поэтому проверяем иконку рядом с подстановкой и сами варианты текста
ok('штаб: герб сорван — иконкой', app.includes('ic-crest') && app.includes('crestTitle'));
ok('штаб: заголовок различает одну часть и две',
   app.includes('Сорваны ДВЕ части герба') && app.includes('Герб сорван'));
ok('штаб: перемирие — жетоном', app.includes('ic-token') && app.includes('Перемирие заключено'));
ok('штаб: показан итог трофеев', app.includes('fat-loot'));
// Сцены выбираются по полу: женщине показывают женскую, и наоборот.
ok('сцена зависит от пола игрока', app.includes('_breachScene') && app.includes("App.me.gender === 'f'"));

const social=fs.readFileSync(path.join(ROOT,'public/js/screens/social.js'),'utf8');
ok('казна: гербы иконкой', social.includes('Гербы <span class="ic-crest">'));
ok('казна: жетоны иконкой', /Жетоны <span class="ic-token">/.test(social));
ok('ценники построек: РЕЗ иконкой', /ic-reserve[\s\S]{0,10}РЕЗ/.test(social));

console.log('\n[5] Декоративные эмодзи не превратились в валюту');
ok('«Поручения штаба» осталось с медалью', /🎖 Поручения штаба|'🎖', 'Поручения штаба'/.test(core));
ok('экран «Почта подтверждена» не показывает жетон', !/font-size:40px"><span class="ic-token"/.test(app));

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
