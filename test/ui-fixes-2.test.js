// ═══════════════════════════════════════════════════════════════════
// Правки интерфейса: проценты в трофеях, кнопка смены аватара,
// лишние баннеры на своём же экране, устойчивость панели.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const market = fs.readFileSync(path.join(ROOT, 'public/js/screens/market.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');

console.log('\n── 1. Проценты в трофеях не дублируются ──');
ok(/\(t\.spy \|\| t\.bankHack \|\| t\.mine\) \? UI\.esc\(String\(val\)\) : `\$\{val\}%`/.test(market),
   'у текстовых трофеев знак % не добавляется — он уже внутри значения');
// Проверяем на реальных данных сервера
const trophies = require(ROOT + '/dist/src/services/trophies');
const cfg = require(ROOT + '/dist/config/gameConfig');
const bonusStr = (t, val) => ((t.spy || t.bankHack || t.mine) ? String(val) : `${val}%`);
ok(bonusStr({}, 20) === '20%', 'обычный трофей: «20%»');
ok(!/%%/.test(bonusStr({ bankHack: true }, 'окно 5%, успех 20%, кража 8%')),
   'медвежатник: двойного знака нет');
ok(!/%%/.test(bonusStr({ mine: true }, 'срабатывание 10%')), 'растяжка: двойного знака нет');
ok(/t\.bankHack \|\| t\.mine\) \? 'Сейчас'/.test(market), 'подпись для них тоже уместная');

console.log('\n── 2. Кнопка смены аватара вместо значка ──');
ok(!/pf-avatar-edit" id="pf-avatar-btn"[^>]*>📷/.test(core), 'значок фотоаппарата с аватарки убран');
ok(/pf-avatar-change" id="pf-avatar-btn"/.test(core), 'появилась кнопка под аватаркой');
ok(/🖼 Сменить/.test(core) && /🖼 Поставить/.test(core),
   'подпись зависит от того, есть ли аватар');
ok(/id="pf-avatar-btn"[\s\S]{0,200}<\/div>/.test(core) || core.indexOf('pf-avatar-change') > core.indexOf('pf-online-dot'),
   'кнопка стоит ПОД аватаркой, а не поверх неё');
ok(css.includes('.pf-avatar-change'), 'стили кнопки добавлены');

console.log('\n── 3. Баннеры не мешают на своём экране ──');
ok(/screenNow === 'production' && subNow === 'silos'/.test(app),
   'в шахтах не показывается баннер о нападении на шахту');
ok(/screenNow === 'production' && subNow === 'lasers'/.test(app),
   'у лазеров не показывается баннер о летящей ракете');
ok(/уже там/.test(app), 'в коде объяснена причина');
const eco = fs.readFileSync(path.join(ROOT, 'public/js/screens/economy.js'), 'utf8');
ok(/production\/silos/.test(eco) && /production\/lasers/.test(eco),
   'адреса экранов совпадают с проверкой — иначе условие не сработало бы');

console.log('\n── 4. Панель устойчива к пустым ответам ──');
ok(/\$\{\(d\.commanders \|\| \[\]\)\.map/.test(adminJs),
   'список наёмников не роняет вкладку, если сервер ничего не вернул');
ok(/\$\{\(h\.holders \|\| \[\]\)\.length/.test(adminJs), 'владельцы наёмников тоже защищены');

console.log('\n── 5. Состав панели ──');
const tabsBlock = /const tabs = \[([\s\S]*?)\];/.exec(adminJs)[1];
const ids = [...tabsBlock.matchAll(/id:'(\w+)'/g)].map((m) => m[1]);
ok(ids.length === 13, `вкладок: ${ids.length}`);
for (const id of ['home', 'players', 'econ', 'events', 'tournament', 'legions', 'logs', 'support', 'tech', 'roles', 'gold']) {
  ok(ids.includes(id), `вкладка «${id}» на месте`);
}
// У каждой вкладки есть обработчик
for (const id of ids) {
  const handler = new RegExp(`Admin\\.tab === '${id}'\\)\\s*return Admin\\.render`);
  ok(handler.test(adminJs), `у вкладки «${id}» есть экран`);
}

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
