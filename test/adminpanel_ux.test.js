// jsdom: устройство панели штаба (v2 — она в проекте одна) —
//   • разделы разложены по группам «Работа / Игра / Разбор / Настройка / Опасное»;
//   • сотрудник видит СВОИ права списком, а не гадает по меню;
//   • необратимые действия требуют впечатать слово, а не нажать «ОК»;
//   • журнал игроков и журнал сотрудников разведены.
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/admin' });
Object.assign(global, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API');
UI.toast = () => {};
global.Admin = load('public/js/admin.js', 'Admin');
global.A2Router = load('public/js/admin2/router.js', 'A2Router');
global.A2 = load('public/js/admin2/shell.js', 'A2');
load('public/js/admin2/queue.js', 'A2');

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
  console.log('\n[1] Разделы разложены по группам');
  Admin.me = { name: 'Хозяин', staffRole: 'owner', staffZones: ALL }; Admin.zones = ALL;
  A2.render();
  const side = document.getElementById('a2-side');
  ok('боковое меню отрисовано', !!side);
  const groups = [...side.querySelectorAll('.a2-group')].map((g) => g.textContent);
  ok('группы названы по-человечески',
     groups.join('|') === 'Работа|Игра|Разбор|Настройка|Опасное');
  const inGroup = (name) => {
    const out = [];
    let on = false;
    for (const el of side.children) {
      if (el.classList.contains('a2-group')) { on = el.textContent === name; continue; }
      if (on && el.dataset && el.dataset.nav) out.push(el.dataset.nav);
    }
    return out;
  };
  ok('жалобы и заявки — к работе', inGroup('Работа').includes('reports') && inGroup('Работа').includes('support'));
  ok('экономика и события — к игре', inGroup('Игра').includes('econ') && inGroup('Игра').includes('events'));
  ok('журнал и аналитика — в разбор',
     inGroup('Разбор').includes('logs') && inGroup('Разбор').includes('analytics'));
  ok('обнуление мира — в опасное, отдельно от повседневного',
     inGroup('Опасное').includes('wipe') && inGroup('Опасное').includes('release'));
  ok('ссылка «в игру» на месте', !!document.querySelector('.a2-who a[href="/"]'));

  console.log('\n[2] Пустые группы не показываются');
  Admin.me = { name: 'Дозорный', staffRole: 'admin', staffZones: ['support'] }; Admin.zones = ['support'];
  A2.render();
  const g2 = [...document.getElementById('a2-side').querySelectorAll('.a2-group')].map((g) => g.textContent);
  ok('осталась одна группа', g2.length === 1);
  ok('и это «Работа»', g2[0] === 'Работа');
  ok('в ней только очередь и заявки',
     document.getElementById('a2-side').querySelectorAll('[data-nav]').length === 2);
  ok('чужих разделов в разметке нет', !document.querySelector('[data-nav="tech"]') && !document.querySelector('[data-nav="roles"]'));

  console.log('\n[3] Раздел без прав не открывается');
  ok('видимость считается по зонам', A2.visible({ id: 'tech', zone: 'security' }) === false);
  ok('а доступный — виден', A2.visible({ id: 'support', zone: 'support' }) === true);
  ok('владельческий раздел администратору закрыт',
     A2.visible({ id: 'gold', zone: 'support', ownerOnly: true }) === false);

  console.log('\n[4] Оформление групп прописано в стилях');
  const css = fs.readFileSync(__dirname + '/../public/css/admin2.css', 'utf8');
  ok('класс бокового меню есть в css', /\.a2-side\s*\{/.test(css));
  ok('подпись группы оформлена', /\.a2-group\s*\{/.test(css));
  ok('опасная группа выделена', /\.a2-group\.is-danger/.test(css));

  console.log('\n[5] Сотрудник видит свои права списком');
  Admin.me = { name: 'Дозорный', staffRole: 'admin', staffZones: ['players', 'support'] };
  Admin.zones = ['players', 'support'];
  A2.render();
  API.get = async () => DASH(['players', 'support']);
  const box = document.createElement('div');
  await A2.screens.queue(box, { name: 'queue', query: {} });
  const txt = box.textContent;
  ok('блок «Мои права» есть', /Мои права/.test(txt));
  ok('видно, сколько разделов открыто', /открыто 2 из 15/.test(txt));
  ok('открытые разделы названы', /Игроки/.test(txt) && /Поддержка/.test(txt));
  ok('закрытые тоже перечислены — видно, чего не хватает', /База данных/.test(txt));
  ok('владельческие помечены', /только владелец/.test(txt));

  console.log('\n[6] Необратимое требует впечатать слово');
  const src = fs.readFileSync(__dirname + '/../public/js/admin.js', 'utf8');
  ok('есть окно с вводом слова', /danger\(opts\)/.test(src));
  ok('слово по умолчанию — «УДАЛИТЬ»', /opts\.word \|\| 'УДАЛИТЬ'/.test(src));
  // Комментарии отбрасываем: в них слово confirm() упоминается как раз
  // потому, что от него избавились
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok('браузерный confirm не используется', !/[^.\w]confirm\(/.test(code.replace(/UI\.confirm\(/g, '')));


  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})();
