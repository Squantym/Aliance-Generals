// jsdom: значки ролей в групповом бою — те же картинки, что в боях легиона.
// Раньше рисовались эмодзи, и ГБ выглядел иначе, чем легион.
const fs = require('fs'); const path = require('path'); const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"><div id="gb-box"></div></div></body>', { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) }); localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(ROOT + '/' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API'); UI.toast = () => {};
global.App = load('public/js/app.js', 'App'); App.refreshMe = async () => {}; App.rerender = () => {}; App.go = () => {};
load('public/js/screens/war.js', 'App');
App.me = { id: 'me', level: 40 };

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const mk = (id, name, role, isMe) => ({ id, name, role,
  roleIcon: role === 'medic' ? '➕' : (role === 'guardian' ? '🛡️' : '🎯'),
  roleLabel: role === 'medic' ? 'Медик' : (role === 'guardian' ? 'Защитник' : 'Штурмовик'),
  rating: 100, isMe: !!isMe, isBot: id.startsWith('gbot'), flag: 'ru' });

const common = {
  allies: [mk('me', 'Я', 'guardian', true), mk('a1', 'Боец', 'fighter'), mk('a2', 'Док', 'medic')],
  enemies: [mk('e1', 'Враг', 'fighter'), mk('e2', 'Щит', 'guardian'), mk('e3', 'Лекарь', 'medic')],
  log: [], watchable: [],
};
const PREP = { active: true, state: 'preparing', preparing: true, prepareLeftSec: 20, ...common,
  me: { ...mk('me', 'Я', 'guardian', true), maxHp: 2250, maxEnergy: 1438, maxAmmo: 82, hp: 2250, energy: 1438, ammo: 82, alive: true, team: 0 },
  myStats: { role: { id: 'guardian', label: 'Защитник', icon: '🛡️', hpMul: 1.25, energyMul: 1, atkMul: 0.75, dmgReducePct: 25 },
    hp: { base: 1500, fromUpgrades: 300, fromRole: 450, total: 2250 },
    energy: { base: 1000, fromUpgrades: 150, fromSupply: 288, fromRole: 0, total: 1438 },
    ammo: { base: 70, fromUpgrades: 12, total: 82 },
    critPct: 28, dodgePct: 23, healCritPct: 20, armorPct: 28.5, atkBonusPct: 0, rewardBonusPct: 0 } };
const RUN = { active: true, state: 'running', preparing: false,
  me: { ...mk('me', 'Я', 'guardian', true), hp: 2100, maxHp: 2250, energy: 1200, maxEnergy: 1438,
        ammo: 80, maxAmmo: 82, alive: true, team: 0, cooldownLeftMs: 0, targetId: null },
  canHeal: false, canGuard: true,
  allies: [{ ...mk('me', 'Я', 'guardian', true), hp: 2100, maxHp: 2250, alive: true },
           { ...mk('a1', 'Боец', 'fighter'), hp: 940, maxHp: 1500, alive: true }],
  enemies: [{ ...mk('e1', 'Враг', 'fighter'), hp: 1210, maxHp: 1500, alive: true },
            { ...mk('e2', 'Щит', 'guardian'), hp: 800, maxHp: 1500, alive: true }],
  log: [], watchable: [] };

const src = (html, role) => new RegExp(`src="/img/legion/roles/${role}\\.webp"`).test(html);

(async () => {
  const box = document.getElementById('gb-box');

  console.log('\n[1] Помощник берёт картинки из папки ролей легиона');
  ok('боец → assault.webp', src(App._gbRoleImg('fighter', '🎯'), 'assault'));
  ok('защитник → guardian.webp', src(App._gbRoleImg('guardian', '🛡️'), 'guardian'));
  ok('медик → medic.webp', src(App._gbRoleImg('medic', '➕'), 'medic'));
  ok('это тег картинки, а не текст', /<img[^>]+class="ic-role/.test(App._gbRoleImg('fighter', '🎯')));
  ok('класс тот же, что в боях легиона', /class="ic-role/.test(App.roleImg('assault')));
  ok('неизвестная роль — прежний значок', App._gbRoleImg('нетакой', '❔') === '❔');
  ok('размер можно задать', /width="26"/.test(App._gbRoleImg('medic', '➕', 26)));
  ok('есть запасной путь, если файл не загрузится', /onerror=/.test(App._gbRoleImg('fighter', '🎯')));
  ok('запасной значок — соседний спан, а не вставка в атрибут',
     /<span class="gb-role-fallback"[^>]*>🎯<\/span>/.test(App._gbRoleImg('fighter', '🎯')));
  ok('в onerror нет подставленного текста — только переключение видимости',
     !/createTextNode/.test(App._gbRoleImg('guardian', '🛡️')));

  console.log('\n[2] Файлы картинок существуют');
  for (const f of ['assault', 'guardian', 'medic']) {
    ok(`${f}.webp на месте`, fs.existsSync(path.join(ROOT, 'public/img/legion/roles', f + '.webp')));
  }

  console.log('\n[3] Комната подготовки: картинки у ВСЕХ ролей');
  API.get = async () => JSON.parse(JSON.stringify(PREP));
  App._resetSign('gbBattle'); box.dataset.mode = ''; await App.renderGroupBattle();
  ok('боец — картинка', src(box.innerHTML, 'assault'));
  ok('защитник — картинка', src(box.innerHTML, 'guardian'));
  ok('медик — картинка', src(box.innerHTML, 'medic'));
  // Проверяем через DOM, а не поиском по строке: эмодзи 🎯 используется
  // ещё и как значок боеприпасов, и поиск по тексту давал ложную тревогу.
  const slots = [...box.querySelectorAll('.gb-role-icon')];
  ok(`гнёзд значков роли: ${slots.length}`, slots.length === 6);
  ok('в каждом лежит картинка, а не эмодзи',
     slots.every((el) => !!el.querySelector('img.gb-role-pic')));
  const bareText = (el) => [...el.childNodes]
    .filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  ok('голого эмодзи в гнёздах нет — только картинка и скрытый запасной',
     slots.every((el) => bareText(el) === ''));
  ok('запасной значок есть, но спрятан стилем',
     slots.every((el) => {
       const fb = el.querySelector('.gb-role-fallback');
       return fb && fb.style.display === 'none' && fb.textContent.trim().length > 0;
     }));
  const picsPrep = (box.innerHTML.match(/gb-role-pic/g) || []).length;
  ok(`картинок ролей в комнате: ${picsPrep} (6 участников + своя карточка)`, picsPrep === 7);

  console.log('\n[4] В самом бою — тоже картинки');
  API.get = async () => JSON.parse(JSON.stringify(RUN));
  App._resetSign('gbBattle'); box.dataset.mode = ''; await App.renderGroupBattle();
  ok('боец', src(box.innerHTML, 'assault'));
  ok('защитник', src(box.innerHTML, 'guardian'));
  ok('своя полоса ресурсов тоже со значком', /gb-self[\s\S]{0,400}gb-role-pic/.test(box.innerHTML));
  const slots2 = [...box.querySelectorAll('.gb-role-icon')];
  ok(`гнёзд значков роли в бою: ${slots2.length}`, slots2.length === 4);
  ok('везде картинки', slots2.every((el) => !!el.querySelector('img.gb-role-pic')));
  ok('голого эмодзи нет и в бою', slots2.every((el) => [...el.childNodes]
     .filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() === ''));

  console.log('\n[5] Подпись роли сохранилась — значок не съел смысл');
  ok('название роли видно', /Защитник/.test(box.innerHTML));
  ok('у значка есть подсказка при наведении', /title="[^"]*Штурмовик/.test(box.innerHTML));

  console.log('\n[6] Витрина: выбор роли тоже с картинками');
  const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
  ok('кнопка роли использует помощник', /gb-role-icon">\$\{App\._gbRoleImg\(x\.id/.test(war));
  ok('эмодзи из конфига оставлено запасным вариантом', /App\._gbRoleImg\(x\.id, x\.icon/.test(war));

  console.log('\n[7] Сервер по-прежнему отдаёт эмодзи — как запасной путь');
  const svc = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
  ok('icon у ролей в сервисе остался', /icon: '🎯'/.test(svc));
  ok('роль отдаётся в карточке — по ней и выбирается картинка', /role: f\.role/.test(svc));

  console.log('\n[8] Стили значка поправлены под картинку');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  ok('класс картинки описан', /\.gb-role-pic/.test(css));
  ok('строка держится по высоте значка', /\.gb-role-icon \{[^}]*align-items: center/.test(css));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})();
