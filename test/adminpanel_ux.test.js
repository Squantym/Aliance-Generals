// jsdom: доработка админ-панели —
//   • вкладки разложены по группам «Люди / Игра / Служебное»;
//   • сотрудник видит СВОИ права списком, а не гадает по вкладкам;
//   • необратимые действия требуют впечатать слово, а не нажать «ОК»;
//   • журнал игроков и журнал сотрудников разведены.
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API');
UI.toast = () => {};
global.Admin = load('public/js/admin.js', 'Admin');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const ALL = ['players', 'chat', 'forum', 'moderation', 'security', 'support', 'legions', 'news',
             'event', 'roles', 'economy', 'discounts', 'analytics', 'database', 'season'];
const ZONE_NAMES = { players: 'Игроки', moderation: 'Баны аккаунтов', analytics: 'Аналитика',
  database: 'База данных', economy: 'Ресурсы', security: 'Безопасность', roles: 'Роли',
  chat: 'Модерация чатов', forum: 'Модерация форума', support: 'Поддержка', legions: 'Легионы',
  news: 'Новости', event: 'Мировое событие', discounts: 'Акции', season: 'Сезон' };
const mkAccess = (mine) => ALL.map((id) => ({ id, name: ZONE_NAMES[id], note: 'что делает раздел',
  allowed: mine.indexOf(id) >= 0, ownerOnly: id === 'database' }));
const DASH = (zones) => ({
  me: { name: 'Дозорный', role: 'admin', label: 'Администратор' },
  zones, myAccess: mkAccess(zones),
  tickets: { open: 0, answered: 0, oldest: 0 },
  players: { total: 140, online: 3, newToday: 4 },
  chatBans: [], chatBansTotal: 0, accountBans: [], accountBansTotal: 0,
  reportsNew: 0, myActions: [], myActionsTotal: 0,
});

(async () => {
const src = fs.readFileSync(__dirname + '/../public/js/admin.js', 'utf8');
const css = fs.readFileSync(__dirname + '/../public/css/style.css', 'utf8');

console.log('\n[1] Вкладки разложены по группам');
Admin.me = { staffRole: 'owner', staffZones: ALL }; Admin.zones = ALL; Admin.tab = 'home';
Admin.renderTab = () => {};   // саму вкладку не рисуем — проверяем шапку
Admin.render();
const bar = document.querySelector('.adm-tabs');
ok('шапка вкладок отрисована', !!bar);
const groups = [...document.querySelectorAll('.adm-tabgroup')];
ok('групп ровно три', groups.length === 3);
ok('они названы Люди / Игра / Служебное',
   groups.map((g) => g.querySelector('.adm-tabgroup-name').textContent).join('|') === 'Люди|Игра|Служебное');
const inGroup = (name) => [...groups.find((g) => g.querySelector('.adm-tabgroup-name').textContent === name)
  .querySelectorAll('button')].map((b) => b.id.replace('tab-', ''));
ok('жалобы и заявки — к людям', inGroup('Люди').includes('reports') && inGroup('Люди').includes('support'));
ok('экономика и события — к игре', inGroup('Игра').includes('econ') && inGroup('Игра').includes('events'));
ok('база, роли и аналитика — в служебное',
   inGroup('Служебное').includes('tech') && inGroup('Служебное').includes('roles')
   && inGroup('Служебное').includes('analytics'));
ok('владельцу видны все 13 вкладок', document.querySelectorAll('.adm-tabs button').length === 13);
ok('ссылка «В игру» на месте', !!document.querySelector('.adm-tabs a[href="/"]'));

console.log('\n[2] Пустые группы не показываются');
Admin.me = { staffRole: 'admin', staffZones: ['support'] }; Admin.zones = ['support'];
Admin.render();
const g2 = [...document.querySelectorAll('.adm-tabgroup')];
ok('осталась одна группа', g2.length === 1);
ok('и это «Люди»', g2[0].querySelector('.adm-tabgroup-name').textContent === 'Люди');
ok('в ней только Сводка и Заявки', [...g2[0].querySelectorAll('button')].length === 2);
ok('чужих вкладок в разметке нет', !document.getElementById('tab-tech') && !document.getElementById('tab-roles'));

console.log('\n[3] Открытая вкладка без прав уводит на доступную');
Admin.tab = 'tech';
Admin.render();
ok('переключились на первую доступную', Admin.tab === 'home');

console.log('\n[4] Оформление групп прописано в стилях');
ok('класс шапки есть в css', /\.adm-tabs\s*\{/.test(css));
ok('подпись группы оформлена', /\.adm-tabgroup-name\s*\{/.test(css));
ok('на телефоне подпись уходит на свою строку', /max-width: 760px[\s\S]{0,400}\.adm-tabgroup-name/.test(css));

console.log('\n[5] Сотрудник видит свои права списком');
Admin.me = { staffRole: 'admin', staffZones: ['players', 'support'] };
Admin.zones = ['players', 'support'];
Admin.renderTab = Object.getPrototypeOf(Admin) === Object.prototype ? Admin.renderTab : Admin.renderTab;
const box = document.createElement('div');
API.get = async () => DASH(['players', 'support']);
await Admin.renderHome(box);
const txt = box.textContent;
ok('блок «Мои права» есть', /Мои права/.test(txt));
ok('видно, сколько разделов открыто', /открыто 2 из 15/.test(txt));
ok('открытые разделы названы', /Игроки/.test(txt) && /Поддержка/.test(txt));
ok('закрытые тоже показаны, а не спрятаны', /База данных/.test(txt) && /Аналитика/.test(txt));
ok('владельческие помечены отдельно', /только владелец/.test(txt));
ok('объяснено, откуда берутся права', /Права выдаёт владелец/.test(txt));
ok('блок свёрнут по умолчанию — не мешает работе', /<details class="card">/.test(box.innerHTML));

console.log('\n[6] Новые жалобы попадают в «Требует внимания»');
API.get = async () => ({ ...DASH(['moderation']), reportsNew: 7 });
await Admin.renderHome(box);
ok('счётчик жалоб виден', /Неразобранных жалоб на игроков/.test(box.textContent));
ok('число указано', />7</.test(box.innerHTML) || /7<\/b>/.test(box.innerHTML));
ok('есть кнопка перехода', !!box.querySelector('[data-goto-tab="reports"]'));
ok('семь жалоб — это уже «горячо»', /adm-alert-hot/.test(box.innerHTML));
API.get = async () => ({ ...DASH(['moderation']), reportsNew: 0 });
await Admin.renderHome(box);
ok('нулевой счётчик не шумит', !/Неразобранных жалоб/.test(box.textContent));

console.log('\n[7] Необратимые действия требуют впечатать слово');
ok('браузерный confirm убран из опасных мест',
   !/if \(!confirm\(`\$\{label\}/.test(src) && !/ОБНУЛИТЬ аккаунт «\$\{name\}»\?\\n/.test(src));
ok('есть общий помощник Admin.danger', /danger\(opts\) \{/.test(src));
for (const [what, word] of [['очистка групп', 'СТЕРЕТЬ'], ['обнуление аккаунта', 'ОБНУЛИТЬ'],
                            ['удаление навсегда', 'УДАЛИТЬ'], ['завершение недели', 'ЗАВЕРШИТЬ']]) {
  ok(`${what} требует впечатать «${word}»`, new RegExp(`word: '${word}'`).test(src));
}
ok('объяснено, почему двойного «ОК» мало', /раздражение/.test(src));

const p = Admin.danger({ title: 'Стереть легионы', what: 'Всё пропадёт.', scope: 'всех игроков', word: 'СТЕРЕТЬ' });
const dlg = document.getElementById('game-dialog');
ok('окно открылось', !!dlg);
ok('видно, что произойдёт и кого затронет', /Всё пропадёт/.test(dlg.textContent) && /всех игроков/.test(dlg.textContent));
ok('предупреждение про копию базы', /Копия базы/.test(dlg.textContent));
const okBtn = dlg.querySelector('#dg-ok'), inp = dlg.querySelector('#dg-word');
ok('кнопка изначально заблокирована', okBtn.disabled === true);
inp.value = 'стереть!'; inp.oninput();
ok('похожее слово не подходит', okBtn.disabled === true);
inp.value = ' стереть '; inp.oninput();
ok('регистр и пробелы прощаются', okBtn.disabled === false);
okBtn.onclick();
ok('после подтверждения окно закрылось', !document.getElementById('game-dialog'));
ok('обещание разрешилось true', (await p) === true);

const p2 = Admin.danger({ title: 'Проверка отмены', what: '…', word: 'УДАЛИТЬ' });
document.getElementById('game-dialog').querySelector('#dg-cancel').onclick();
ok('отмена возвращает false', (await p2) === false);

console.log('\n[8] Журнал игроков и журнал сотрудников разведены');
ok('в журнале сказано, что тут действия игроков', /Здесь действия <b>игроков<\/b>/.test(src));
ok('объяснено, почему их не смешивают', /в тысяче строк «купил танк» бан теряется/.test(src));
ok('владельцу дана ссылка на журнал сотрудников', /Открыть журнал сотрудников/.test(src));
ok('журнал сотрудников тянется отдельным адресом', /\/api\/admin\/staff-log/.test(src));

console.log('\n[9] Права на аналитику и жалобы отданы разным зонам');
const rt = fs.readFileSync(__dirname + '/../src/routes.ts', 'utf8');
ok('аналитика — зона «Аналитика»', /canAccessZone\(req\.user, 'analytics'\)/.test(rt));
ok('жалобы — зона «Баны аккаунтов»', /canAccessZone\(req\.user, 'moderation'\)[\s\S]{0,200}reports\.queue/.test(rt));
ok('панель отдаёт разбор прав сотрудника', /myAccess: roles\.ZONE_INFO\.map/.test(rt));
ok('и счётчик новых жалоб', /reportsNew:/.test(rt));

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
})();
