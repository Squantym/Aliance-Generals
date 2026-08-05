// ═══════════════════════════════════════════════════════════════════
// Правки: вёрстка аватарки, оформление лотов, загрузка фото босса
// до старта события.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-ui3-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const we = require(ROOT + '/dist/src/services/worldEvent');
const core = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
const market = fs.readFileSync(ROOT + '/public/js/screens/market.js', 'utf8');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');

async function main() {
console.log('\n── 1. Аватарка и кнопка ──');
ok(/<div class="pf2-avatar-col">/.test(core), 'аватарка и кнопка вынесены в общую колонку');
ok(core.indexOf('pf2-avatar-col') < core.indexOf('class="pf2-avatar '),
   'обёртка идёт снаружи аватарки');
ok(/pf-avatar-change" id="pf-avatar-btn"[\s\S]{0,120}<\/div>/.test(core),
   'кнопка внутри колонки, а не соседом в строке');
ok(/\.pf2-avatar-col \{[\s\S]{0,160}flex-direction: column/.test(css), 'колонка выстроена вертикально');
ok(/\.pf2-avatar-col \{[\s\S]{0,200}align-self: flex-start/.test(css),
   'колонка не растягивается по высоте карточки — из-за этого аватар был во весь экран');
ok(/\.pf2-avatar \{[\s\S]{0,140}aspect-ratio: 3 \/ 4/.test(css), 'у аватарки фиксированная пропорция');
ok(!/\.pf2-avatar \{[\s\S]{0,140}min-height: 196px/.test(css), 'прежняя жёсткая высота убрана');
ok(/@media \(max-width: 420px\)[\s\S]{0,220}\.pf2-avatar-col \{ flex: 0 0 108px/.test(css),
   'на телефоне колонка уже');
ok(/\.pf2-avatar-col \.pf-avatar-change \{ width: 100%/.test(css), 'кнопка по ширине аватарки');

console.log('\n── 2. Оформление лотов ──');
ok(/class="lot-grid"/.test(market), 'лоты выстроены сеткой карточек');
ok(/\/img\/secret\/\$\{x\.devId\}\.webp/.test(market), 'у разработок своя картинка');
ok(/App\._marketImg\(b\.itemId\)/.test(market), 'у допингов картинка из каталога рынка');
ok(/lot-noimg/.test(market), 'если картинки нет — запасной значок');
const goldIcons = (market.match(/<span class="ic-gold"><\/span>/g) || []).length;
ok(goldIcons >= 5, `иконка золота вместо эмодзи: ${goldIcons} мест`);
ok(!/🪙 \$\{b\.basePrice\}/.test(market), 'старое эмодзи в ценах убрано');
ok(/lot-stock-bar/.test(market), 'остаток товара показан полосой');
ok(/lots-meta/.test(market), 'в шапке видно время до смены и своё золото');
ok(/lot-sold/.test(market), 'раскупленный товар помечается');
ok(css.includes('.lot-card'), 'стили карточек добавлены');
ok(/\.lot-grid \{[\s\S]{0,160}minmax\(230px, 1fr\)/.test(css), 'сетка подстраивается под ширину');
ok(/\.lot-card-img img \{[\s\S]{0,90}object-fit: cover/.test(css), 'картинка вписывается в рамку');
ok(/@media \(max-width: 420px\)[\s\S]{0,260}\.lot-grid \{ grid-template-columns: 1fr 1fr/.test(css),
   'на телефоне две карточки в ряд');

console.log('\n── 3. Фото босса до старта события ──');
await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1');
const own = Object.values(player.users())[0];
own.role = 'owner'; own.isAdmin = true;
const start = (image) => {
  try { we.adminStop(own, []); } catch (e) {}
  we.adminStart(own, { name: 'Босс', hp: 1000, goldPool: 1000, image }, []);
  return we.view(own).image;
};
// Главная причина: загруженная через панель картинка ложится в
// /forum-img/, а проверка такой путь не принимала
ok(start('/forum-img/m3x9a-ab12cd.jpg') === '/forum-img/m3x9a-ab12cd.jpg',
   'картинка, загруженная через панель, принимается при запуске события');
ok(start('/img/bosses/armada.webp') === '/img/bosses/armada.webp', 'файл из папки тоже работает');
ok(start('https://site.com/b.png') === 'https://site.com/b.png', 'внешняя ссылка работает');
let rejected = false;
try { start('javascript:alert(1)'); } catch (e) { rejected = true; }
ok(rejected, 'опасная ссылка по-прежнему отклоняется');
const wsrc = fs.readFileSync(ROOT + '/src/services/worldEvent.ts', 'utf8');
ok(/\(img\|images\|uploads\|forum-img\)/.test(wsrc), 'внутренний путь загрузок разрешён явно');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
ok(/app\.add\('POST', '\/api\/admin\/event\/image'/.test(routes), 'роут загрузки на месте');
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');
ok(/id="ev-img-shrink"/.test(adminJs) && /id="ev-img-file"/.test(adminJs),
   'кнопки сжатия и выбора файла есть в форме запуска');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
