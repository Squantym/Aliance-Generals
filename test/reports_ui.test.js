// jsdom: кнопка «Пожаловаться» в профиле игрока и очередь жалоб в панели.
// Главное, что проверяем: очередь читается как «на кого жалуются», а не
// как лента отдельных сигналов, и что репутация жалобщика видна сразу.
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div><div id="tab-content"></div></body>',
  { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API');
const toasts = []; UI.toast = (m) => toasts.push(m); UI.confirm = async () => true;
global.App = load('public/js/app.js', 'App');
App.refreshMe = async () => {}; App.rerender = () => {}; App.go = () => {};
load('public/js/screens/core.js', 'App');
global.Admin = load('public/js/admin.js', 'Admin');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const REASONS = [
  { id: 'cheat', label: 'Читы или накрутка', icon: '🚫' },
  { id: 'insult', label: 'Оскорбления, мат, угрозы', icon: '🤬' },
  { id: 'other', label: 'Другое', icon: '💬' },
];
const now = Date.now();
const QUEUE = {
  counts: { new: 4, accepted: 2, rejected: 3, total: 9 },
  reasons: REASONS,
  groups: [
    { targetId: 'bad', targetName: 'Нарушитель', exists: true, banned: false, level: 22,
      total: 3, uniqueReporters: 3, lastAt: now - 5 * 60000, reports: [
        { id: 'r1', at: now - 5 * 60000, fromId: 'u1', fromName: 'Свидетель', reason: 'Оскорбления, мат, угрозы',
          reasonId: 'insult', text: 'Материл в чате легиона', where: 'из чата', status: 'new',
          verdict: '', handledBy: '', rejectedByAuthor: 0 },
        { id: 'r2', at: now - 30 * 60000, fromId: 'u2', fromName: 'Кляузник', reason: 'Читы или накрутка',
          reasonId: 'cheat', text: 'Деньги растут без боёв', where: 'из профиля', status: 'new',
          verdict: '', handledBy: '', rejectedByAuthor: 5 },
        { id: 'r3', at: now - 3 * 3600000, fromId: 'u3', fromName: 'Третий', reason: 'Другое',
          reasonId: 'other', text: 'Ведёт себя странно', where: 'из боя', status: 'accepted',
          verdict: 'Проверили, подтвердилось', handledBy: 'Владелец', rejectedByAuthor: 0 },
      ] },
    { targetId: 'quiet', targetName: 'Тихоня', exists: true, banned: true, level: 5,
      total: 1, uniqueReporters: 1, lastAt: now - 26 * 3600000, reports: [
        { id: 'r4', at: now - 26 * 3600000, fromId: 'u1', fromName: 'Свидетель', reason: 'Другое',
          reasonId: 'other', text: 'Спамит приглашениями', where: 'из переписки', status: 'new',
          verdict: '', handledBy: '', rejectedByAuthor: 0 },
      ] },
  ],
};

(async () => {
const src = fs.readFileSync(__dirname + '/../public/js/admin.js', 'utf8');
const core = fs.readFileSync(__dirname + '/../public/js/screens/core.js', 'utf8');

console.log('\n[1] Кнопка в профиле — только у чужого живого игрока');
ok('кнопка есть в разметке профиля', /id="pf-report"/.test(core));
ok('своему профилю кнопка не рисуется', /\(!own && !isBot\).{0,120}pf-report/s.test(core));
ok('боту жаловаться не на что', /!isBot/.test(/pf-report/.source) || /\(!own && !isBot\)/.test(core));
ok('обработчик подставляет игрока сам', /App\._reportPlayer\(p\.id, p\.name, 'profile'\)/.test(core));

console.log('\n[2] Лимит проверяется ДО написания текста');
API.get = async () => ({ left: 0, dayLimit: 5, reasons: REASONS, list: [] });
toasts.length = 0;
await App._reportPlayer('bad', 'Нарушитель', 'profile');
ok('окно не открылось', !document.getElementById('game-dialog'));
ok('сказано, что жалобы кончились', toasts.some((m) => /жалобы закончились/.test(m)));
ok('и когда обновятся', toasts.some((m) => /завтра/.test(m)));

console.log('\n[3] Окно жалобы');
API.get = async () => ({ left: 3, dayLimit: 5, reasons: REASONS, list: [] });
await App._reportPlayer('bad', 'Нарушитель', 'chat');
const dlg = document.getElementById('game-dialog');
ok('окно открылось', !!dlg);
ok('в заголовке — на кого жалуемся', /Нарушитель/.test(dlg.textContent));
ok('причины предложены списком', dlg.querySelectorAll('#rp-reason option').length === 3);
ok('причины названы словами', /Читы или накрутка/.test(dlg.textContent));
ok('поле описания есть', !!dlg.querySelector('#rp-text'));
ok('видно остаток на сутки', /Осталось жалоб сегодня: 3 из 5/.test(dlg.textContent));
ok('предупреждение про ложные жалобы', /портят доверие/.test(dlg.textContent));

console.log('\n[4] Пустую жалобу не отправить');
toasts.length = 0;
let posted = null;
API.post = async (url, body) => { posted = { url, body }; return {}; };
dlg.querySelector('#rp-text').value = 'ну он';
await dlg.querySelector('#rp-ok').onclick();
ok('запрос не ушёл', posted === null);
ok('объяснено почему', toasts.some((m) => /10 символов/.test(m)));
ok('окно осталось открытым', !!document.getElementById('game-dialog'));

console.log('\n[5] Нормальная жалоба уходит с контекстом');
dlg.querySelector('#rp-reason').value = 'cheat';
dlg.querySelector('#rp-text').value = 'Деньги выросли в тысячу раз за минуту';
await dlg.querySelector('#rp-ok').onclick();
ok('адрес правильный', posted && posted.url === '/api/reports/create');
ok('передан игрок', posted.body.targetId === 'bad');
ok('передана причина', posted.body.reason === 'cheat');
ok('передан текст', /тысячу раз/.test(posted.body.text));
ok('передано, откуда пожаловались', posted.body.where === 'chat');
ok('окно закрылось', !document.getElementById('game-dialog'));

console.log('\n[6] Очередь в панели: группировка по нарушителю');
const c = document.getElementById('tab-content');
Admin.me = { staffRole: 'owner', staffZones: ['moderation'] }; Admin.zones = ['moderation'];
Admin.showPlayerCard = () => {};
API.get = async () => JSON.parse(JSON.stringify(QUEUE));
await Admin.renderReports(c);
const t = c.textContent;
ok('оба нарушителя показаны', /Нарушитель/.test(t) && /Тихоня/.test(t));
ok('видно, сколько жалоб и от скольких людей', /жалоб 3 от 3 разных игроков/.test(t));
ok('массовый случай подсвечен красной рамкой', /border-color:var\(--red\)/.test(c.innerHTML));
ok('и подписан словами', /жалуются много и независимо/.test(t));
ok('одиночная жалоба красным не орёт',
   (c.innerHTML.match(/border-color:var\(--red\)/g) || []).length === 1);
ok('бан нарушителя виден сразу', /заблокирован/.test(t));
ok('тексты жалоб на месте', /Материл в чате легиона/.test(t) && /Спамит приглашениями/.test(t));
ok('указано, откуда пришла жалоба', /из чата/.test(t) && /из переписки/.test(t));

console.log('\n[7] Репутация жалобщика видна');
ok('серийный жалобщик помечен', /ложных: 5/.test(t));
ok('честный жалобщик не помечен', !/ложных: 0/.test(t));

console.log('\n[8] Уже разобранные не предлагают кнопок');
ok('решение по разобранной видно', /подтверждена/.test(t) && /Владелец/.test(t));
ok('комментарий сотрудника показан', /Проверили, подтвердилось/.test(t));
ok('кнопок у разобранной нет', !c.querySelector('[data-acc="r3"]') && !c.querySelector('[data-rej="r3"]'));
ok('у новых кнопки есть', !!c.querySelector('[data-acc="r1"]') && !!c.querySelector('[data-rej="r1"]'));

console.log('\n[9] Фильтры по состоянию');
const filts = [...c.querySelectorAll('[data-filt]')].map((b) => b.dataset.filt);
ok('четыре фильтра', filts.join() === 'new,accepted,rejected,all');
ok('в кнопках числа', /🆕 Новые \(4\)/.test(t) && /Все \(9\)/.test(t));
let asked = '';
API.get = async (url) => { asked = url; return JSON.parse(JSON.stringify(QUEUE)); };
await c.querySelector('[data-filt="rejected"]').onclick();
ok('фильтр уходит на сервер', /status=rejected/.test(asked));

console.log('\n[10] Решение спрашивает комментарий и не выдаёт санкций само');
API.get = async () => JSON.parse(JSON.stringify(QUEUE));
Admin._rpStatus = 'new';
await Admin.renderReports(c);
UI.prompt = async () => 'Проверил логи, всё так';
posted = null;
await c.querySelector('[data-acc="r1"]').onclick();
ok('ушло решение по жалобе', posted && posted.url === '/api/mod/report/resolve');
ok('передан комментарий жалобщику', posted.body.verdict === 'Проверил логи, всё так');
ok('подтверждение помечено как accept', posted.body.accept === true);
await Admin.renderReports(c);
posted = null;
await c.querySelector('[data-all-rej="bad"]').onclick();
ok('групповое отклонение бьёт по игроку, а не по жалобе',
   posted.url === '/api/mod/report/resolve-all' && posted.body.targetId === 'bad');
ok('в панели прямо написано, что санкции выдаются отдельно',
   /Санкции здесь не выдаются/.test(src));
UI.prompt = async () => null;
posted = null;
await Admin.renderReports(c);
await c.querySelector('[data-rej="r1"]').onclick();
ok('отказ от комментария отменяет действие', posted === null);

console.log('\n[11] Пустая очередь — понятный экран');
API.get = async () => ({ counts: { new: 0, accepted: 0, rejected: 0, total: 0 }, reasons: REASONS, groups: [] });
Admin._rpStatus = 'new';
await Admin.renderReports(c);
ok('сказано, что всё разобрано', /очередь разобрана/.test(c.textContent));
ok('фильтры остались на месте', c.querySelectorAll('[data-filt]').length === 4);

console.log('\n[12] Отказ в правах — текстом, а не пустотой');
API.get = async () => { throw new Error('Недостаточно прав'); };
await Admin.renderReports(c);
ok('видно причину', /Недостаточно прав/.test(c.textContent));

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
})();
