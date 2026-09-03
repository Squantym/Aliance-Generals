// ═══════════════════════════════════════════════════════════════════
// test/admin2.test.js — оболочка панели v2
//
// Проверяем то, ради чего v2 затевалась, а не «нарисовалось ли меню»:
//   • у каждого экрана есть адрес, и адрес переживает перезагрузку;
//   • контекст (поиск, выбранный игрок) лежит в ссылке;
//   • закрытые правами разделы не открываются даже по прямой ссылке;
//   • старые, ещё не перенесённые экраны работают внутри новой
//     оболочки — иначе «переезд» означал бы неделю без панели;
//   • новая панель не выдаёт существование старой в обход ADMIN_PATH.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// ── Окружение браузера ────────────────────────────────────────────
const dom = new JSDOM('<!DOCTYPE html><body><div id="toasts"></div><div id="content"></div></body>',
  { url: 'http://localhost/admin/v2' });
Object.assign(global, {
  window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location,
});

// Сервер подменяем: панель не должна ходить в сеть в тестах, а мы
// заодно видим, какие запросы она делает и с какими параметрами.
const CALLS = [];
const now = Date.now();
const PLAYERS = [
  { id: 'u_1', name: 'Комдив', level: 30, flag: '🇷🇺', dollars: 1e6, gold: 500, lastSeen: Date.now() - 60000 },
  { id: 'u_2', name: 'Снайпер', level: 12, flag: '🇰🇿', dollars: 2000, gold: 3, lastSeen: Date.now() - 9e6, chatBan: true },
];
const ROUTES = {
  '/api/me': () => ({ id: 'u_me', name: 'Владелец', staffRole: 'owner',
    // У владельца есть и 'database' — зона только для него (OWNER_ONLY_ZONES).
    // Без неё тест проверял бы панель администратора, называя её владельцем.
    staffZones: ['players', 'moderation', 'support', 'economy', 'discounts', 'event',
                 'legions', 'analytics', 'security', 'roles', 'database'] }),
  '/api/admin/dashboard': () => ({
    me: { name: 'Владелец', role: 'owner', label: 'владелец' },
    zones: ['players', 'moderation', 'support', 'security'],
    reportsNew: 7, tickets: { open: 2, answered: 1, oldest: 30 },
    players: { total: 12, online: 3, newToday: 1 },
    chatBansTotal: 1, accountBansTotal: 0, myActions: [{ human: 'выдал золото', at: Date.now() - 3e5 }],
  }),
  '/api/admin/db/stats': () => ({
    backups: [{ at: Date.now() - 3600e3, name: 'b1' }],
    offsite: { at: Date.now() - 3 * 24 * 3600e3, ok: true, encrypted: false },
  }),
  '/api/admin/player-card/u_1': () => ({
    id: 'u_1', name: 'Комдив', level: 30, flag: '🇷🇺', dollars: 1e6, gold: 500,
    online: true, lastSeen: Date.now(), createdAt: Date.now() - 1e9, email: 'k@x.ru',
    roleLabel: 'игрок', chatBan: null,
    accountBan: { until: 0, reason: 'накрутка', byName: 'Владелец' },
    recent: [{ human: 'купил танк', at: Date.now() - 6e5 }],
    can: { chatBan: true, accountBan: true, password: true, resources: true },
  }),
  // Ответы для ещё не перенесённых экранов: нам важно не их
  // содержимое, а что переходник вообще даёт им открыться.
  '/api/mod/reports': () => ({
    counts: { new: 3, accepted: 1, rejected: 2, total: 6 },
    groups: [
      { targetId: 'u_2', targetName: 'Снайпер', level: 12, banned: false, exists: true,
        total: 3, uniqueReporters: 3, lastAt: now - 6e5,
        reports: [
          { id: 'r1', reason: 'накрутка', where: 'в бою', text: 'бьёт ботами',
            fromId: 'u_1', fromName: 'Комдив', at: now - 6e5, status: 'new', rejectedByAuthor: 0 },
          { id: 'r2', reason: 'оскорбления', where: 'в чате', text: 'ругается',
            fromId: 'u_3', fromName: 'Пехотинец', at: now - 9e5, status: 'new', rejectedByAuthor: 4 },
        ] },
      { targetId: 'u_9', targetName: 'Одиночка', level: 3, banned: false, exists: true,
        total: 1, uniqueReporters: 1, lastAt: now - 8e6,
        reports: [{ id: 'r3', reason: 'спам', where: 'в чате', text: 'реклама',
          fromId: 'u_1', fromName: 'Комдив', at: now - 8e6, status: 'new', rejectedByAuthor: 0 }] },
    ],
  }),
  '/api/admin/support': () => ({
    categories: [{ id: 'bug', icon: '🐞', label: 'Ошибка' }, { id: 'pay', icon: '💳', label: 'Оплата' }],
    byCategory: { bug: 2, pay: 1 },
    tickets: [
      { id: 't1', userId: 'u_1', userName: 'Комдив', subject: 'Пропали танки', status: 'open',
        categoryLabel: 'Ошибка', free: true, mine: false, assignedName: '',
        messages: [{ from: 'user', authorName: 'Комдив', at: now - 3e6, text: 'было 10, стало 0' }] },
      { id: 't2', userId: 'u_2', userName: 'Снайпер', subject: 'Не пришло золото', status: 'open',
        categoryLabel: 'Оплата', free: false, mine: true, assignedName: 'Владелец',
        messages: [{ from: 'user', authorName: 'Снайпер', at: now - 1e6, text: 'оплатил, не пришло' }] },
    ],
  }),
  '/api/admin/db/snapshots': () => ({ snapshots: [] }),
  '/api/admin/groups/legion': () => ({ groups: [
    { id: 'lg_1', name: 'Север', members: 12, leaderName: 'Комдив', hasActiveBattle: false },
    { id: 'lg_2', name: 'Юг', members: 8, leaderName: 'Снайпер', hasActiveBattle: true },
  ] }),
  // Форма ответа взята с настоящего роута: редактор рисует поля прямо
  // из списков, и «примерно похожая» заглушка проверяла бы не его.
  '/api/admin/legion/lg_1/state': () => ({
    id: 'lg_1', name: 'Север', level: 4, treasury: 900000, reserves: 120,
    treasuryEars: 40, treasuryTokens: 7, members: 12, leaderName: 'Комдив',
    battleBuildings: [{ id: 'wall', name: 'Стена', level: 2, maxLevel: 10 },
                      { id: 'tower', name: 'Башня', level: 0, maxLevel: 5 }],
    units: [{ id: 'tank', name: 'Танк', count: 12 }],
  }),
  '/api/2fa/status': () => ({ enabled: false, pending: false, recoveryLeft: 0, recoveryUsedAt: 0, enabledAt: 0 }),
  '/api/2fa/setup': () => ({ secret: 'JBSWY3DPEHPK3PXP', otpauth: 'otpauth://totp/x', step: 30, digits: 6 }),
  '/api/2fa/enable': () => ({ enabled: true, recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] }),
  '/api/admin/gold-log': () => ({
    totals: { got: 12000, spent: 4000, now: 8000 },
    players: [{ id: 'u_1', name: 'Комдив', level: 30, got: 9000, spent: 3000, now: 6000, vip: true },
              { id: 'u_2', name: 'Снайпер', level: 12, got: 3000, spent: 1000, now: 2000 }],
    selected: null,
  }),
  '/api/staff': () => ({
    me: { id: 'u_me', name: 'Владелец', role: 'owner', label: 'Владелец' },
    staff: [
      { id: 'u_5', name: 'Помощник', role: 'admin', label: 'Администратор', level: 20 },
      { id: 'u_6', name: 'Дозорный', role: 'moderator', label: 'Дозор', level: 8 },
    ],
  }),
  '/api/admin/staff-log': () => ({ logs: [
    { at: now - 5e5, userId: 'u_5', userName: 'Помощник', human: 'выдал 500 золота игроку Комдив' },
  ] }),
  '/api/staff/permissions': () => ({
    zones: [{ id: 'players', name: 'Игроки', note: 'досье' }, { id: 'economy', name: 'Ресурсы', note: 'выдача' }],
    roles: [{ id: 'admin', name: 'Администратор', custom: false, zones: ['players'] },
            { id: 'moderator', name: 'Дозор', custom: true, zones: [] }],
  }),
  '/api/admin/email-status': () => ({ providerName: 'resend', configured: true, from: 'a@b.c',
    appUrl: 'https://x', total: 10, unverified: 1, hint: 'ок',
    list: [{ id: 'u_5', name: 'Новичок', email: 'n@x.ru', createdAt: now - 1e6, level: 2 }] }),
  '/api/admin/logs': () => ({
    category: 'all', scanned: 4210, more: true,
    logs: [
      { at: now - 6e5, userId: 'u_1', userName: 'Комдив', path: '/api/units/buy', human: 'купил 3 танка Т-90' },
      { at: now - 9e5, userId: 'u_2', userName: "О'Нил", path: '/api/battle/attack', human: 'атаковал игрока Комдив' },
      { at: now - 12e5, userId: '', userName: '', path: '/api/login', human: 'вход в игру' },
    ],
  }),
  // Формы (списки, а не объекты) взяты с реального ответа: подсунуть
  // «примерно похожее» — значит проверять переходник на выдуманных
  // данных и не заметить, что экран падает на настоящих.
  '/api/admin/analytics': () => ({
    activity: { online: 1, dau: 2, wau: 3, mau: 4, newToday: 0, newWeek: 0 },
    retention: { d1: { eligible: 4, returned: 2, pct: 50 }, d3: { eligible: 4, returned: 1, pct: 25 },
                 d7: { eligible: 2, returned: 0, pct: 0 }, d30: { eligible: 0, returned: 0, pct: null } },
    funnel: [{ name: 'Зарегистрировались', count: 10, pct: 100, note: 'все аккаунты' },
             { name: 'Провели первый бой', count: 6, pct: 60, note: 'хотя бы одна атака' },
             { name: 'Дошли до 5 уровня', count: 3, pct: 30, note: 'освоились' }],
    levels: [{ label: '1–5', count: 4 }, { label: '6–10', count: 2 }],
    economy: { players: 6, top: [], money: 0, gold: 0, concMoney: 40, concGold: 30 },
    history: [],
  }),
};
global.fetch = async (url, opts) => {
  const clean = String(url).split('?')[0];
  CALLS.push(String(url));
  let body = null;
  // Журнал золота отвечает по-разному со списком и с выбранным игроком —
  // мок обязан это различать, иначе экран «карточка игрока» проверялся бы
  // на данных списка и всегда «работал».
  if (clean === '/api/admin/gold-log' && /userId=u_1/.test(String(url))) {
    body = { totals: { got: 12000, spent: 4000, now: 8000 },
      selected: { id: 'u_1', name: 'Комдив', level: 30, got: 9000, spent: 3000, now: 6000,
        groups: [{ label: 'Выдача администрацией', total: 5000,
                   items: [{ label: 'выдал Владелец', gold: 5000, at: now - 6e5 }] },
                 { label: 'Поручения', total: 4000, items: [] }] } };
  } else if (ROUTES[clean]) body = ROUTES[clean]();
  else if (clean === '/api/admin/players') body = { players: PLAYERS };
  else body = {};
  return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body };
};

const load = (f, n) => eval(fs.readFileSync(path.join(ROOT, f), 'utf8') + ';' + n);
const UI = load('public/js/ui.js', 'UI');
global.UI = UI;
global.API = load('public/js/api.js', 'API');
global.App = { me: null, go() {} };
const Admin = load('public/js/admin.js', 'Admin');
global.Admin = Admin;
const A2Router = load('public/js/admin2/router.js', 'A2Router');
global.A2Router = A2Router;
const A2 = load('public/js/admin2/shell.js', 'A2');
global.A2 = A2;
load('public/js/admin2/queue.js', '0');
load('public/js/admin2/players.js', '0');
load('public/js/admin2/player.js', '0');
load('public/js/admin2/reports.js', '0');
load('public/js/admin2/support.js', '0');
load('public/js/admin2/logs.js', '0');
load('public/js/admin2/tech.js', '0');
load('public/js/admin2/roles.js', '0');
load('public/js/admin2/gold.js', '0');
load('public/js/admin2/econ.js', '0');
load('public/js/admin2/tournament.js', '0');
load('public/js/admin2/legions.js', '0');
load('public/js/admin2/security.js', '0');

const wait = (ms) => new Promise((r) => setTimeout(r, ms || 30));

async function main() {

console.log('\n── 1. Адрес разбирается и собирается обратно ──');
ok(A2Router.parse('#/queue').name === 'queue', 'раздел читается');
const r1 = A2Router.parse('#/player/u_12345');
ok(r1.name === 'player' && r1.arg === 'u_12345', 'аргумент читается: игрок u_12345');
const r2 = A2Router.parse('#/logs?user=u_1&cat=economy');
ok(r2.name === 'logs' && r2.query.user === 'u_1' && r2.query.cat === 'economy', 'параметры читаются');
ok(A2Router.build('logs', '', { user: 'u_1', cat: '' }) === '#/logs?user=u_1',
   'пустые параметры в ссылку не попадают — она остаётся читаемой');
// Кириллица в позывном: собрали → разобрали → получили то же самое
const round = A2Router.parse(A2Router.build('player', 'Комдив №1'));
ok(round.arg === 'Комдив №1', `кириллица и спецсимволы переживают круг: «${round.arg}»`);
// Битый адрес не должен ронять панель — сотрудник просто попадёт в очередь
let broke = false;
try { A2Router.parse('#/logs?bad=%E0%A4%A'); } catch (e) { broke = true; }
ok(!broke, 'битый percent-encoding в ссылке не роняет разбор');

console.log('\n── 2. Оболочка поднимается ──');
localStorage.setItem('gtoken', 'test-token');   // без токена панель показала бы экран входа
await A2.init();
await wait(60);
ok(!!document.getElementById('a2-root'), 'каркас отрисован');
ok(!!document.getElementById('a2-side'), 'боковое меню на месте');
const navIds = Array.from(document.querySelectorAll('#a2-side .a2-nav')).map((a) => a.dataset.nav);
ok(navIds.indexOf('queue') === 0, 'первым пунктом — очередь работ');
// Не «все пункты NAV», а все НЕскрытые: «Защита входа» намеренно убрана
// из списка разделов — это личная настройка сотрудника, а не раздел
// игры, и ссылка на неё стоит рядом с его именем. Маршрут при этом
// остался, см. проверку ниже.
const visibleNav = A2.NAV.filter((n) => !n.hidden);
ok(navIds.length === visibleNav.length,
   `у владельца видны все разделы, кроме скрытых: ${navIds.length} из ${A2.NAV.length}`);
ok(A2.NAV.some((n) => n.hidden), 'скрытые пункты вообще существуют — иначе проверка выше пустая');
ok(location.hash === '#/queue', `после входа адрес осмысленный: ${location.hash}`);

console.log('\n── 3. Очередь работ показывает работу, а не статистику ──');
const main1 = document.getElementById('a2-main').textContent;
ok(/Неразобранных жалоб/.test(main1), 'жалобы в очереди');
ok(/Открытых обращений/.test(main1), 'обращения в очереди');
ok(/без шифрования/.test(main1), 'копии уезжают открытыми — это тоже работа, и она видна');
ok(/не срабатывал больше двух суток/.test(main1), 'молчащий вывоз копий замечен сам, без аварии');
// Счётчики уехали в меню
const badge = document.querySelector('#a2-side [data-nav="reports"] .a2-badge');
ok(badge && badge.textContent.trim() === '7', 'счётчик жалоб виден с любого экрана');
ok(badge && badge.className.indexOf('is-hot') >= 0, 'семь жалоб помечены красным, а не серым');

console.log('\n── 4. Переход меняет адрес, а адрес — экран ──');
location.hash = '#/players';
await wait(50);
ok(A2.find('players') && document.getElementById('a2-main').textContent.indexOf('Игроки') >= 0,
   'раздел «Игроки» открылся по адресу');
const active = document.querySelector('#a2-side .a2-nav.is-active');
ok(active && active.dataset.nav === 'players', 'подсветка в меню переехала');
ok(active.getAttribute('aria-current') === 'page', 'диктору сообщено, где мы находимся');

console.log('\n── 5. Поиск попадает в ссылку ──');
const q = document.getElementById('pls-q');
q.value = 'Комдив';
document.getElementById('pls-go').click();
await wait(50);
ok(location.hash.indexOf('q=') > 0, `поиск виден в адресе: ${location.hash}`);
ok(CALLS.some((u) => u.indexOf('/api/admin/players?q=') === 0 && /q=%D0%9A/.test(u)),
   'запрос ушёл с позывным — ссылку можно переслать напарнику');
const rows = document.querySelectorAll('#pls-list a.a2-item');
ok(rows.length === 2, `найдено игроков: ${rows.length}`);
ok(rows[0].getAttribute('href') === '#/player/u_1', 'строка ведёт на страницу игрока');

console.log('\n── 6. Страница игрока собирает всё в одном месте ──');
location.hash = '#/player/u_1';
await wait(60);
const pg = document.getElementById('a2-main').textContent;
ok(/Комдив/.test(pg), 'позывной в заголовке');
ok(/Аккаунт заблокирован/.test(pg) && /накрутка/.test(pg), 'действующая мера видна сразу, с причиной');
ok(/купил танк/.test(pg), 'последние действия тут же — без перехода в журнал');
ok(!!document.getElementById('pl-grant') && !!document.getElementById('g-go'),
   'форма выдачи встроена в страницу, а не открывается окном поверх');
const gcancel = document.getElementById('g-cancel');
ok(gcancel && gcancel.style.display === 'none', 'крестик формы скрыт — закрывать на своей странице нечего');
const toLogs = Array.from(document.querySelectorAll('#a2-main a'))
  .find((a) => /Журнал действий/.test(a.textContent));
ok(toLogs && toLogs.getAttribute('href') === '#/logs?user=u_1',
   'журнал открывается уже наведённым на этого игрока');
const crumbs = document.getElementById('a2-crumbs').textContent;
ok(/Игроки/.test(crumbs) && /Комдив/.test(crumbs), `путь показывает, откуда пришли: «${crumbs.trim()}»`);

console.log('\n── 7. Возврат «Назад» работает как в обычном сайте ──');
// Именно ради этого положение в панели сделано адресом
location.hash = '#/queue';
await wait(40);
ok(location.hash === '#/queue', 'ушли в очередь');
dom.window.history.back();
await wait(60);
ok(location.hash === '#/player/u_1', `«Назад» вернул на страницу игрока: ${location.hash}`);

console.log('\n── 8. Старые экраны работают внутри новой оболочки ──');
// Пока экран не перенесён, он обязан открываться как есть — иначе
// переезд означал бы неделю с наполовину рабочей панелью.
const legacyIds = A2.NAV.filter((n) => n.legacy && !A2.screens[n.id]).map((n) => n.id);
ok(legacyIds.length > 0, `экранов на старом коде осталось: ${legacyIds.length}`);
let brokenScreens = [];
for (const id of legacyIds) {
  location.hash = '#/' + id;
  await wait(40);
  const el = document.getElementById('tab-content');
  const txt = (el && el.textContent) || '';
  if (!el || !el.innerHTML.trim() || /Раздел не открылся/.test(txt)) brokenScreens.push(id);
}
ok(brokenScreens.length === 0, `все старые экраны открылись: ${legacyIds.join(', ')}`
   + (brokenScreens.length ? ` — сломаны: ${brokenScreens.join(', ')}` : ''));

console.log('\n── 9. Старый код обновляет экран, а не сносит оболочку ──');
// В admin.js в десяти местах написано `Admin.tab = X; Admin.renderTab()`.
// После переезда это должно означать переход, а не перерисовку поверх.
Admin.tab = 'logs';
Admin.renderTab();
await wait(50);
ok(location.hash === '#/logs', `старый переход стал адресом: ${location.hash}`);
ok(!!document.getElementById('a2-side'), 'боковое меню на месте — оболочку не снесли');
Admin.render();
await wait(40);
ok(!!document.getElementById('a2-root') && !!document.getElementById('a2-side'),
   'старый Admin.render() больше не перерисовывает вкладки поверх оболочки');

console.log('\n── 10. Права: закрытый раздел не открыть даже ссылкой ──');
const savedZones = Admin.zones.slice();
Admin.zones = ['players'];          // остались только игроки
Admin.me = { name: 'Помощник', staffRole: 'admin' };
A2.renderNav();
const navNow = Array.from(document.querySelectorAll('#a2-side .a2-nav')).map((a) => a.dataset.nav);
ok(navNow.indexOf('roles') === -1, 'раздел «Роли» из меню пропал');
ok(navNow.indexOf('gold') === -1, 'раздел владельца скрыт от администратора');
location.hash = '#/roles';
await wait(50);
ok(location.hash === '#/queue', `прямая ссылка на закрытый раздел увела в очередь: ${location.hash}`);
ok(!/Роли/.test(document.getElementById('a2-main').innerHTML), 'содержимое закрытого раздела не отрисовано');
// Страница игрока — тоже под правом players, а не «раз ссылка есть, значит можно»
Admin.zones = ['support'];
location.hash = '#/player/u_1';
await wait(50);
ok(location.hash === '#/queue', 'без права «players» страница игрока не открывается по прямой ссылке');
Admin.zones = savedZones;
Admin.me = ROUTES['/api/me']();

console.log('\n── 11. Сломанный экран не оставляет пустоту ──');
A2.screens.__probe = () => { throw new Error('нарочная поломка'); };
A2.NAV.push({ id: '__probe', label: 'Проба', icon: '🧪', group: 'Служебное' });
location.hash = '#/__probe';
await wait(40);
const failTxt = document.getElementById('a2-main').textContent;
ok(/Раздел не открылся/.test(failTxt) && /нарочная поломка/.test(failTxt),
   'вместо пустого экрана — причина и кнопка «Повторить»');
A2.NAV.pop(); delete A2.screens.__probe;

console.log('\n── 12. Жалобы: сигнал отделён от шума ──');
Admin.zones = savedZones; Admin.me = ROUTES['/api/me']();
location.hash = '#/reports';
await wait(60);
const rp = document.getElementById('a2-main');
const groups = rp.querySelectorAll('.a2-card[style*="border-color"]');
ok(groups.length === 2, `очередь сгруппирована по нарушителям: ${groups.length} групп, а не 3 жалобы вразнобой`);
ok(/жалуются много и независимо/.test(rp.textContent),
   'три РАЗНЫХ жалобщика помечены отдельно — сговором такое труднее накрутить');
ok(/ложных: 4/.test(rp.textContent), 'у автора с четырьмя отклонёнными жалобами это видно рядом с его жалобой');
const rpLink = Array.from(rp.querySelectorAll('a')).find((a) => /Снайпер/.test(a.textContent));
ok(rpLink && rpLink.getAttribute('href') === '#/player/u_2',
   'имя нарушителя ведёт на его страницу, а не открывает окно поверх');
// Фильтр — в адресе
rp.querySelector('[data-filt="accepted"]').click();
await wait(60);
ok(location.hash === '#/reports?status=accepted', `фильтр попал в ссылку: ${location.hash}`);
ok(CALLS.some((u) => /\/api\/mod\/reports\?status=accepted/.test(u)), 'запрос ушёл с выбранным фильтром');
// Перезагрузка страницы на этом адресе должна открыть то же самое
ok(A2Router.parse('#/reports?status=accepted').query.status === 'accepted',
   'после F5 фильтр восстановится из адреса');
const badgeRp = document.querySelector('#a2-side [data-nav="reports"] .a2-badge');
ok(badgeRp && badgeRp.textContent.trim() === '3', 'счётчик в меню пересчитан по свежему ответу, а не завис');

console.log('\n── 13. Заявки: набранный ответ не пропадает ──');
// Это чинили не ради красоты: в v1 любое действие перерисовывало
// список целиком, и длинный ответ, набранный в соседнем обращении,
// исчезал молча — человека наказывали за нормальную работу.
location.hash = '#/support';
await wait(60);
const sup = document.getElementById('a2-main');
const areas = sup.querySelectorAll('[data-draft]');
ok(areas.length === 2, `поля ответа отрисованы: ${areas.length}`);
const box1 = sup.querySelector('[data-draft="t1"]');
box1.value = 'Проверил историю состояния, танки вернул';
box1.oninput();                       // как будто печатали
// Действие в ДРУГОМ обращении перерисовывает список
sup.querySelector('[data-release]').click();
await wait(80);
const box1b = document.querySelector('[data-draft="t1"]');
ok(box1b && box1b.value === 'Проверил историю состояния, танки вернул',
   'ответ пережил перерисовку списка после действия в соседнем обращении');
// Отправленный ответ черновик убирает — иначе он всплыл бы поверх нового
await (async () => {
  const b = document.querySelector('[data-ans="t1"]');
  b.click(); await wait(80);
})();
ok(!A2._supportDrafts.t1, 'после отправки черновик удалён, а не всплывёт в следующий раз');
ok(CALLS.some((u) => /support\/reply/.test(u)), 'ответ ушёл на сервер');
// Пустой ответ отправлять нельзя: пустое сообщение игроку хуже молчания
const before = CALLS.filter((u) => /support\/reply/.test(u)).length;
document.querySelector('[data-ans="t2"]').click();
await wait(50);
ok(CALLS.filter((u) => /support\/reply/.test(u)).length === before, 'пустой ответ не отправляется');
// Фильтры — в адресе
document.querySelector('[data-cat="bug"]').click();
await wait(60);
ok(/cat=bug/.test(location.hash), `подраздел попал в ссылку: ${location.hash}`);
const supLink = Array.from(document.querySelectorAll('#a2-main a')).find((a) => /Комдив/.test(a.textContent));
ok(supLink && supLink.getAttribute('href') === '#/player/u_1', 'позывной в заявке ведёт на страницу игрока');

console.log('\n── 14. Журнал: разбор пересылается ссылкой ──');
location.hash = '#/logs';
await wait(60);
const lg = document.getElementById('a2-main');
ok(/купил 3 танка/.test(lg.textContent), 'журнал загрузился сам, без кнопки «Загрузить»');
ok(/показаны первые 3, подходящих больше/.test(lg.textContent),
   'сказано, что показано не всё — иначе сотрудник решит, что видит весь журнал');
// Позывной ведёт на игрока, «только он» — сужает журнал
const lgLink = Array.from(lg.querySelectorAll('a')).find((a) => /Комдив/.test(a.textContent));
ok(lgLink && lgLink.getAttribute('href') === '#/player/u_1', 'позывной ведёт на страницу игрока');
lg.querySelector('[data-only="u_1"]').click();
await wait(60);
ok(/user=u_1/.test(location.hash), `сужение до игрока попало в ссылку: ${location.hash}`);
ok(CALLS.some((u) => /\/api\/admin\/logs\?.*userId=u_1/.test(u)), 'запрос ушёл с игроком');
// Апостроф в позывном раньше ломал таблицу: id вклеивался в inline-onclick
const lgSrc = fs.readFileSync(path.join(ROOT, 'public/js/admin2/logs.js'), 'utf8');
ok(!/onclick=/.test(lgSrc), 'обработчики не вклеиваются в разметку строкой');
ok(/О'Нил|О&#39;Нил/.test(document.getElementById('a2-main').innerHTML) === false
   || document.querySelectorAll('#lg-out tbody tr').length >= 1,
   'строка с апострофом в позывном не разрушила таблицу');
// Категория тоже в адресе
document.querySelector('[data-cat="battle"]').click();
await wait(60);
ok(/cat=battle/.test(location.hash) && /user=u_1/.test(location.hash),
   `категория добавилась, игрок не потерялся: ${location.hash}`);

console.log('\n── 15. Журнал не отдаёт в браузер лишнего ──');
// Раньше этот роут отдавал сырое тело каждого запроса: паролей там нет
// (чистятся при записи), но почты, тексты и параметры уезжали пачками
// по 200 строк, хотя панель их не показывает.
const routesSrc = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
const logsRoute = routesSrc.slice(routesSrc.indexOf("'/api/admin/logs'"),
  routesSrc.indexOf("'/api/admin/logs'") + 400);
ok(/humanizeLogs/.test(logsRoute), 'журнал игроков проходит через humanizeLogs — тело запроса не уезжает');
ok(/const \{ body, params, \.\.\.safe \} = l;/.test(routesSrc), 'humanizeLogs по-прежнему вырезает body и params');

console.log('\n── 16. Опасные операции переехали к игроку и защищены дважды ──');
location.hash = '#/player/u_1';
await wait(80);
ok(!!document.getElementById('pl-pass-go') && !!document.getElementById('pl-del-go'),
   'смена пароля и удаление — на странице игрока, а не в «Технике» со своим вторым поиском');
const det = document.getElementById('pl-del-go').closest('details');
ok(det && !det.open, 'блок свёрнут по умолчанию — промахнуться по нему нельзя');
// Короткий пароль не уходит на сервер
const callsBefore = CALLS.length;
document.getElementById('pl-pass').value = 'коротко';
document.getElementById('pl-pass-go').click();
await wait(40);
ok(!CALLS.slice(callsBefore).some((u) => /set-password/.test(u)), 'пароль короче 8 символов не отправляется');
// Несовпавший позывной не удаляет
document.getElementById('pl-del').value = 'НеТотИгрок';
document.getElementById('pl-del-go').click();
await wait(40);
ok(!CALLS.some((u) => /delete-account/.test(u)), 'при несовпадении позывного удаление не начинается');
// Совпал — но дальше стоит второе подтверждение со словом
document.getElementById('pl-del').value = 'комдив';        // регистр не важен
document.getElementById('pl-del-go').click();
await wait(60);
const dangerDlg = document.querySelector('#game-dialog .game-dialog');
ok(!!dangerDlg && /УДАЛИТЬ/.test(dangerDlg.textContent),
   'после совпадения позывного просят впечатать слово — два независимых подтверждения');
ok(!CALLS.some((u) => /delete-account/.test(u)), 'до второго подтверждения запрос не уходит');
document.getElementById('dg-cancel').click();
await wait(40);
// В старой панели оставался единственный браузерный confirm() — его тоже нет
const adminSrc = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(!/[^.\w]confirm\(`/.test(adminSrc) && !/if \(!confirm\(/.test(adminSrc),
   'браузерного confirm() в панели не осталось — только свои окна с объяснением');

console.log('\n── 17. Техника разделена по поводу обращения ──');
// Раньше это была свалка из шести несвязанных вещей одним свитком.
// Поводов ровно два, и они не пересекаются: «всё пропало» и
// «что-то работает странно».
location.hash = '#/tech';
await wait(80);
const tech = document.getElementById('a2-main');
ok(/Данные и восстановление/.test(tech.textContent) && /Проверки/.test(tech.textContent),
   'две страницы вместо одного свитка');
ok(!!document.getElementById('db-block'), 'по умолчанию открыт разбор данных — то, зачем сюда бегут в аварии');
ok(!document.getElementById('tech-pass-go') && !document.getElementById('tech-del-go'),
   'операций над аккаунтом здесь больше нет — они на странице игрока');
ok(!document.getElementById('tech-q'),
   'исчез второй поиск игрока: он был вторым способом выбрать не того человека');
// Переключение страницы — в адресе
document.querySelector('[data-p="checks"]').click();
await wait(80);
ok(/p=checks/.test(location.hash), `страница «Проверки» попала в ссылку: ${location.hash}`);
ok(!!document.getElementById('mail-check') && !!document.getElementById('ac-go')
   && !!document.getElementById('mc-go'), 'карточки проверок на месте: почта, античит, мультиаккаунты');
// И они работают тем же кодом, что в старой панели
document.getElementById('mail-check').click();
await wait(60);
ok(/Ждут подтверждения/.test(document.getElementById('mail-box').textContent),
   'проверка почты отработала — обработчики общие со старой панелью');
// Разметка и обработчики действительно общие, а не скопированы
const a2tech = fs.readFileSync(path.join(ROOT, 'public/js/admin2/tech.js'), 'utf8');
ok(/Admin\._techChecksHtml\(\)/.test(a2tech) && /Admin\._bindTechChecks\(\)/.test(a2tech),
   'v2 зовёт общие функции, а не свою копию диагностики');
ok(/Admin\.renderDbBlock\(\)/.test(a2tech), 'блок базы — тот же, что и в старой панели');
const adminSrc2 = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok((adminSrc2.match(/id="mail-check"/g) || []).length === 1,
   'разметка проверок существует в одном экземпляре — расходиться нечему');
// Раздел базы закрыт правами: у администратора без «database» его нет
const savedZ = Admin.zones.slice();
Admin.zones = ['security'];
location.hash = '#/tech?p=data';
await wait(80);
ok(/только\s+владельцу/.test(document.getElementById('a2-main').textContent),
   'без права «database» вместо блока базы — объяснение, а не пустой экран');
Admin.zones = savedZ;

console.log('\n── 18. Роли: журнал сотрудника пересылается ссылкой ──');
location.hash = '#/roles';
await wait(80);
const rl = document.getElementById('a2-main');
ok(/Штат и назначения/.test(rl.textContent) && /Журнал сотрудников/.test(rl.textContent),
   'три занятия разложены по подстраницам, а не одним свитком');
ok(/Помощник/.test(rl.textContent) && /Дозорный/.test(rl.textContent), 'штат виден');
ok(!document.getElementById('perm-box'), 'настройка прав не грузится, пока её не открыли');
// Кнопка «журнал» у сотрудника уводит на страницу журнала с ним же
document.querySelector('[data-staff-log="u_5"]').click();
await wait(80);
ok(/p=log/.test(location.hash) && /who=u_5/.test(location.hash),
   `журнал открылся уже наведённым на сотрудника: ${location.hash}`);
ok(CALLS.some((u) => /staff-log\?userId=u_5/.test(u)), 'запрос ушёл с этим сотрудником');
ok(/выдал 500 золота/.test(document.getElementById('staff-log-box').textContent),
   'записи сотрудника показаны');
const sel = document.getElementById('staff-log-who');
ok(sel && sel.value === 'u_5', 'выбор в списке восстановлен из адреса — F5 не сбросит разбор');
// Настройка прав — своя страница
document.querySelector('[data-p="perms"]').click();
await wait(90);
ok(/who=/.test(location.hash) === false, 'при смене страницы выбранный сотрудник из адреса убран');
ok(!!document.getElementById('perm-box') && /Администратор/.test(document.getElementById('perm-box').textContent),
   'страница возможностей ролей открылась');
// Разметка и обработчики — общие со старой панелью
const a2roles = fs.readFileSync(path.join(ROOT, 'public/js/admin2/roles.js'), 'utf8');
ok(/Admin\._rolesHtml\(/.test(a2roles) && /Admin\._bindRoles\(/.test(a2roles),
   'v2 зовёт общие функции, а не свою копию экрана прав');
const adminSrc3 = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok((adminSrc3.match(/id="perm-box"/g) || []).length === 1,
   'разметка настройки прав существует в одном экземпляре');

console.log('\n── 19. Золото: разбор по игроку живёт в адресе ──');
location.hash = '#/gold';
await wait(80);
const gd = document.getElementById('a2-main');
ok(/Комдив/.test(gd.textContent) && /Снайпер/.test(gd.textContent), 'список игроков с движением золота');
gd.querySelector('[data-gp="u_1"]').click();
await wait(80);
ok(/who=u_1/.test(location.hash), `выбранный игрок ушёл в адрес: ${location.hash}`);
ok(CALLS.some((u) => /gold-log\?userId=u_1/.test(u)), 'запрос ушёл с игроком');
ok(/Выдача администрацией/.test(document.getElementById('a2-main').textContent),
   'видно, откуда у игрока золото');
// «Назад» браузера должен вернуть к списку, а не выкинуть из раздела
dom.window.history.back();
await wait(80);
ok(location.hash === '#/gold', `«Назад» вернул к списку золота: ${location.hash}`);

console.log('\n── 20. Экономика: подвкладка в ссылке и права по подвкладкам ──');
location.hash = '#/econ';
await wait(80);
ok(document.querySelectorAll('#a2-main [data-t]').length === 4, 'четыре подвкладки у владельца');
document.querySelector('[data-t="discounts"]').click();
await wait(80);
ok(/t=discounts/.test(location.hash), `подвкладка попала в ссылку: ${location.hash}`);
// Сотруднику только с правом «Акции» показываем сразу акции, а не
// «первую из списка, которая всё равно закрыта»
const savedZ2 = Admin.zones.slice();
Admin.zones = ['discounts'];
location.hash = '#/econ?t=tools';
await wait(80);
const tabs = Array.from(document.querySelectorAll('#a2-main [data-t]')).map((b) => b.dataset.t);
ok(tabs.length === 1 && tabs[0] === 'discounts', `видна только доступная подвкладка: ${tabs.join(',')}`);
ok(document.querySelector('[data-t="discounts"]').className.indexOf('btn-orange') >= 0,
   'она же и открыта, хотя в адресе была закрытая');
Admin.zones = savedZ2;

console.log('\n── 21. Турниры: режим в адресе ──');
location.hash = '#/tournament';
await wait(90);
ok(document.querySelectorAll('#a2-main [data-trn-mode]').length >= 2, 'режимы отрисованы');
const schedBtn = document.querySelector('[data-trn-mode="sched"]');
if (schedBtn) {
  schedBtn.click();
  await wait(90);
  ok(/m=sched/.test(location.hash), `режим попал в ссылку: ${location.hash}`);
  ok(document.querySelector('[data-trn-mode="sched"]').className.indexOf('btn-orange') >= 0,
     'после перерисовки из адреса открыт тот же режим');
} else { ok(false, 'кнопка режима «расписание» не найдена'); }

console.log('\n── 22. Легионы: редактор конкретного легиона имеет адрес ──');
location.hash = '#/legions';
await wait(90);
const lgMain = document.getElementById('a2-main');
ok(/Север/.test(lgMain.textContent) && /Юг/.test(lgMain.textContent), 'список легионов');
document.querySelector('[data-leg="lg_1"]').click();
await wait(90);
ok(/id=lg_1/.test(location.hash), `открытый легион попал в ссылку: ${location.hash}`);
ok(CALLS.some((u) => /legion\/lg_1\/state/.test(u)), 'запрос состояния легиона ушёл');
dom.window.history.back();
await wait(90);
ok(location.hash === '#/legions', `«Назад» вернул к списку легионов: ${location.hash}`);

console.log('\n── 22b. Фильтр заменяет адрес, переход — записывает ──');
// Разница не косметическая: если каждый щелчок фильтра пишется в
// историю, «Назад» перестаёт работать как выход и превращается в
// перебор собственных уточнений.
location.hash = '#/logs';
await wait(60);
const beforeLen = dom.window.history.length;
document.querySelector('[data-cat="buy"]').click();
await wait(60);
document.querySelector('[data-cat="auth"]').click();
await wait(60);
ok(dom.window.history.length === beforeLen,
   `два щелчка фильтра не удлинили историю (${beforeLen} → ${dom.window.history.length})`);
ok(/cat=auth/.test(location.hash), 'при этом адрес отражает последний выбор');

console.log('\n── 23. Защита входа: подключение в два шага ──');
location.hash = '#/security';
await wait(90);
const sec = document.getElementById('a2-main');
ok(/Второй фактор/.test(sec.textContent), 'экран защиты входа открылся');
ok(/держит в руках ваш телефон/.test(sec.textContent),
   'объясняется, от чего защищает, а не просто предлагается кнопка');
document.getElementById('sec-start').click();
await wait(90);
ok(!!document.getElementById('sec-confirm'), 'ключ показан и просят подтвердить кодом');
ok(!CALLS.some((u) => /2fa\/enable/.test(u)), 'до ввода кода включение не запрашивается');
document.getElementById('sec-confirm').value = '123456';
document.getElementById('sec-enable').click();
await wait(90);
const recBox = document.getElementById('sec-recovery');
ok(/AAAAA-BBBBB/.test(recBox.textContent), 'коды восстановления показаны сразу после включения');
ok(/один раз/.test(recBox.textContent), 'сказано, что показ единственный');
// Раздел доступен любому сотруднику: это его учётная запись, а не игра
const savedZ3 = Admin.zones.slice();
Admin.zones = ['support'];
A2.renderNav();
// В СПИСКЕ РАЗДЕЛОВ его теперь нет намеренно: это личная настройка, а не
// раздел игры. Но доступен он по-прежнему любому сотруднику — это и
// проверяем, плюс наличие ссылки рядом с именем. Иначе «убрал из меню»
// незаметно превратилось бы в «убрал совсем».
const secItem = A2.find('security');
ok(!!secItem && A2.visible(secItem), 'раздел доступен сотруднику с любыми правами');
ok(secItem.hidden === true, 'но в списке разделов не показывается');
ok(!Array.from(document.querySelectorAll('#a2-side .a2-nav')).some((a) => a.dataset.nav === 'security'),
   'в боковом меню его действительно нет');
const whoBox = document.querySelector('.a2-who');
ok(!!whoBox && /security/.test(whoBox.innerHTML),
   'ссылка на защиту входа стоит рядом с именем сотрудника');
Admin.zones = savedZ3;

console.log('\n── 24. Новая панель не выдаёт старую в обход ADMIN_PATH ──');
const httpSrc = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
ok(/isAdmin2File/.test(httpSrc), 'прямой /admin2.html обрабатывается отдельно');
ok(/const v2Path = \(ADMIN_PATH \|\| '\/admin'\) \+ '\/v2'/.test(httpSrc),
   'v2 живёт по тому же секретному адресу с хвостом /v2');
const i2 = httpSrc.indexOf('isAdmin2File');
const seg = httpSrc.slice(i2, i2 + 700);
ok(/res\.writeHead\(404/.test(seg), 'по стандартному адресу v2 отвечает 404, как несуществующая страница');

console.log('\n── 25. Оформление панели не лезет в игру ──');
// Комментарии вырезаем ДО разбора: в них есть и фигурные скобки, и
// запятые, и без этого «селектором» становится кусок пояснения.
const css = fs.readFileSync(path.join(ROOT, 'public/css/admin2.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
// Селекторы собираем по-настоящему: всё, что стоит перед «{», кроме
// @-правил. Прошлая версия склеивала файл в одну строку и отбрасывала
// куски со словом media — в итоге список выходил ПУСТЫМ, и проверка
// проходила ни на чём. Пустой список теперь считается провалом.
const selectors = [];
const ruleRe = /([^{}]+)\{/g;
let mRule;
while ((mRule = ruleRe.exec(css))) {
  const head = mRule[1].trim();
  if (!head || head.startsWith('@')) continue;       // @media, @keyframes — обёртки
  head.split(',').forEach((s) => { s = s.trim(); if (s) selectors.push(s); });
}
ok(selectors.length > 20, `селекторы действительно разобраны: ${selectors.length}`);
const leaking = selectors.filter((s) => !/\.a2/.test(s));
ok(leaking.length === 0, `все правила ограничены .a2 (проверено ${selectors.length})`
   + (leaking.length ? ` — утекают: ${leaking.slice(0, 3).join(' | ')}` : ''));
ok(!/^\s*(body|html|\.card|\.btn)\s*\{/m.test(css), 'общие теги и игровые классы не переопределяются');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
