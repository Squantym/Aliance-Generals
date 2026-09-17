// ═══════════════════════════════════════════════════════════════════
// test/layout-fit.test.js — надписи не выходят за свои окна (18.09.2026)
//
// Аудит вёрстки прошёл по всем экранам игры и панели на 320, 360, 375,
// 414, 768 и 1440 px (Chromium). Раскладку jsdom не считает, поэтому
// здесь стережём сами правила, которые закрыли найденные выезды:
//  1. «Ключ — значение» (.kv): не влезло — значение уходит на новую
//     строку, а не рвётся посреди слова («Зван-ие: Генералисс-имус»).
//  2. Ряд кнопок (.btn-row) переносится — «Сохранить QR» уезжал за экран.
//  3. Вкладки не уже своей надписи («ПОДРЫВНИКИ» торчала на 4px).
//  4. Длинный позывной/название легиона переносится в профиле и кабинете.
//  5. Секретки на узком телефоне: картинка меньше, названию есть место;
//     лоты дня — одна колонка до 360px.
//  6. Панель: «Открыть →», адреса Робокассы, таблица входов на телефоне.
//  7. Диверсанты «Построечные» переименованы в «Подрывники» везде.
//
// Запуск: node test/layout-fit.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const css = read('public/css/style.css');
const a2 = read('public/css/admin2.css');
// Правило целиком: селектор → тело до закрывающей скобки
const rule = (src, sel) => {
  const out = [];
  const re = new RegExp('(^|\\n|\\})\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(src))) out.push(m[2]);
  return out.join(';');
};
// Внутри медиазапроса с заданной шириной
const media = (src, w) => {
  const i = src.indexOf(`@media (max-width: ${w}px)`);
  const parts = [];
  let from = 0;
  for (;;) {
    const k = src.indexOf(`@media (max-width: ${w}px)`, from);
    if (k < 0) break;
    let depth = 0, j = src.indexOf('{', k);
    for (let p = j; p < src.length; p++) {
      if (src[p] === '{') depth++;
      if (src[p] === '}' && --depth === 0) { parts.push(src.slice(j + 1, p)); from = p; break; }
    }
  }
  return i < 0 ? '' : parts.join('\n');
};

console.log('\n[1] Ключ — значение');
ok(/flex-wrap:\s*wrap/.test(rule(css, '.kv')), '.kv переносит значение на новую строку');
ok(/margin-left:\s*auto/.test(rule(css, '.kv .v')), 'перенесённое значение прижато вправо');
ok(/max-width:\s*100%/.test(rule(css, '.kv > *')), 'часть строки не шире самой строки');

console.log('\n[2] Ряд кнопок');
ok(/flex-wrap:\s*wrap/.test(rule(css, '.btn-row')), '.btn-row переносит кнопки');
ok(/min-width:\s*min-content/.test(rule(css, '.btn-row > *')), 'перенос срабатывает и при flex:1');

console.log('\n[3] Вкладки');
ok(/min-width:\s*min-content/.test(rule(css, '.tab')), '.tab не уже надписи');
const sab = rule(css, '.sab-tabs .sab-tab');
ok(/min-width:\s*min-content/.test(sab) && !/min-width:\s*104px/.test(sab), 'вкладки диверсантов — тоже');
ok(/min-width:\s*30px/.test(rule(css, '.club-ico')) && !/(^|;|\s)width:\s*30px/.test(rule(css, '.club-ico')),
   'иконка клуба не шире своей ячейки');

console.log('\n[4] Длинные имена');
ok(/overflow-wrap:\s*anywhere/.test(rule(css, '.pf2-name')), 'позывной в профиле');
ok(/overflow-wrap:\s*anywhere/.test(rule(css, '.cab-name')), 'позывной в кабинете');
ok(/overflow-wrap:\s*anywhere/.test(rule(css, '.cab-rows b')), 'легион в кабинете');

console.log('\n[5] Рынок на узком телефоне');
const m400 = media(css, 400);
ok(/\.secret-row \.img-frame-row\s*\{[^}]*width:\s*64px/.test(m400), 'картинка секретки 64px до 400px');
ok(/\.lot-grid\s*\{[^}]*grid-template-columns:\s*1fr;/.test(media(css, 360)), 'лоты дня в одну колонку до 360px');
ok(/hyphens:\s*auto/.test(rule(css, '.secret-row-name')) && /hyphens:\s*auto/.test(rule(css, '.lot-card-name')),
   'длинные названия переносятся с дефисом, где браузер умеет');

console.log('\n[6] Панель');
ok(/min-width:\s*0/.test(rule(a2, '.a2-item-txt')), 'текст строки сжимается');
ok(/white-space:\s*nowrap/.test(rule(a2, '.a2-item > .a2-muted')), '«Открыть →» остаётся целым');
ok(/overflow-wrap:\s*anywhere/.test(rule(a2, '.a2-kv > b, .a2-kv > .mono')), 'адреса в «Платежах» переносятся');
ok(/\.a2-sess-table tr\s*\{[^}]*flex-wrap:\s*wrap/.test(media(a2, 560)), 'входы на телефоне раскладываются по строкам');
ok(/class="access-table a2-sess-table"/.test(read('public/js/admin2/sessions.js')), 'таблица входов помечена');

console.log('\n[7] «Подрывники»');
const files = ['public/js/ui.js', 'public/js/app.js', 'public/js/screens/war.js', 'public/js/screens/saboteurs.js',
  'src/services/admin.ts', 'src/services/referralQuests.ts', 'src/services/saboteurs.ts', 'config/gameConfig.ts'];
const left = files.filter((f) => /построечн/i.test(read(f)));
ok(left.length === 0, 'старого названия не осталось' + (left.length ? ': ' + left.join(', ') : ''));
ok(/\['building', 'Подрывники'\]/.test(read('public/js/screens/saboteurs.js')), 'вкладка «Подрывники»');
ok(/building: 'Подрывники'/.test(read('public/js/ui.js')), 'подпись в окнах');
ok(/building: 'подрывники'/.test(read('public/js/app.js')), 'подпись в сводках');
ok(/building: '💣 Подрывники'/.test(read('src/services/admin.ts')), 'панель');
ok(/building: 'подрывников'/.test(read('src/services/referralQuests.ts')), 'задания приглашений');

console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
process.exit(failed ? 1 : 0);
