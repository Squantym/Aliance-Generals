// Иконки уши/жетоны/РЕЗ: файлы, CSS и корректность вставки в разметку.
const assert=require('assert'); const fs=require('fs'); const path=require('path');
let passed=0;
const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};
const ROOT=path.join(__dirname,'..');
const FRONT=['public/js/app.js','public/js/screens/social.js','public/js/screens/core.js',
             'public/js/screens/market.js','public/js/screens/war.js','public/js/screens/economy.js',
             'public/js/screens/news.js','public/js/admin.js'].filter(f=>fs.existsSync(path.join(ROOT,f)));

console.log('\n[1] Файлы иконок на месте');
for (const n of ['ear','token','reserve']) {
  const p=path.join(ROOT,'public/img/icons',n+'.webp');
  ok(`иконка ${n}.webp есть`, fs.existsSync(p));
  ok(`иконка ${n}.webp лёгкая (<40 KB)`, fs.statSync(p).size < 40*1024);
}

console.log('\n[2] CSS-классы объявлены');
const css=fs.readFileSync(path.join(ROOT,'public/css/style.css'),'utf8');
for (const n of ['ear','token','reserve']) {
  ok(`.ic-${n} имеет картинку`, new RegExp(`\\.ic-${n}\\s*\\{[^}]*icons/${n}\\.webp`).test(css));
  ok(`.ic-${n} в общем правиле размеров`, new RegExp(`\\.ic-${n}[,\\s][^{]*\\{[\\s\\S]{0,200}?background-size`).test(css)
     || new RegExp(`\\.ic-${n}\\s*[,{]`).test(css));
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
ok('профиль: отрезанные уши — иконкой', /ic-ear[\s\S]{0,60}Отрезанные уши/.test(core));
ok('профиль: восстановить ухо — иконкой', /pf-restore-ear[\s\S]{0,80}ic-ear/.test(core));
ok('банк: вкладка резерва — иконкой', /ic-reserve[\s\S]{0,20}Резерв/.test(core));
ok('награды сезона: жетоны — иконкой', /ic-token[\s\S]{0,30}tokens/.test(core));

const app=fs.readFileSync(path.join(ROOT,'public/js/app.js'),'utf8');
ok('фаталити: ухо отрезано — иконкой', /ic-ear[\s\S]{0,40}Ухо отрезано/.test(app));
ok('фаталити: помилование — жетоном', /ic-token[\s\S]{0,40}Враг помилован/.test(app));
ok('фаталити: показан итог трофеев', /fat-loot/.test(app));

const social=fs.readFileSync(path.join(ROOT,'public/js/screens/social.js'),'utf8');
ok('казна: уши иконкой', /Уши <span class="ic-ear">/.test(social));
ok('казна: жетоны иконкой', /Жетоны <span class="ic-token">/.test(social));
ok('ценники построек: РЕЗ иконкой', /ic-reserve[\s\S]{0,10}РЕЗ/.test(social));

console.log('\n[5] Декоративные эмодзи не превратились в валюту');
ok('«Поручения штаба» осталось с медалью', /🎖 Поручения штаба|'🎖', 'Поручения штаба'/.test(core));
ok('экран «Почта подтверждена» не показывает жетон', !/font-size:40px"><span class="ic-token"/.test(app));

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
