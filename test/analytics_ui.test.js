// jsdom: вкладка «Аналитика» в панели и блок античита во вкладке «Техника».
// Проверяем, что цифры не просто приходят, а читаются: узкое место воронки
// подсвечено, плохое удержание красное, история без данных не рисует пустой
// график.
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div><div id="tab-content"></div></body>',
  { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API');
UI.toast = () => {}; UI.confirm = async () => true;
global.Admin = load('public/js/admin.js', 'Admin');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Данные подобраны так, чтобы каждый вывод был заранее известен:
// удержание d1 плохое (10%), d7 хорошее (20%), провал воронки — на 5 уровне.
const DATA = {
  activity: { online: 3, dau: 12, wau: 30, mau: 80, stickiness: 15, newToday: 4, newWeek: 19, total: 140 },
  retention: {
    d1: { eligible: 100, returned: 10, pct: 10 },
    d3: { eligible: 100, returned: 30, pct: 30 },
    d7: { eligible: 100, returned: 20, pct: 20 },
    d30: { eligible: 0, returned: 0, pct: null },
  },
  funnel: [
    { name: 'Зарегистрировались', count: 100, pct: 100, note: 'все аккаунты' },
    { name: 'Провели первый бой', count: 80, pct: 80, note: 'хотя бы одна атака' },
    { name: 'Дошли до 5 уровня', count: 25, pct: 25, note: 'освоились' },
    { name: 'Дошли до 10 уровня', count: 20, pct: 20, note: 'закрепились' },
    { name: 'Дошли до 25 уровня', count: 8, pct: 8, note: 'играют всерьёз' },
    { name: 'Вступили в легион', count: 5, pct: 5, note: 'социальная привязка' },
  ],
  levels: [{ label: '1–4', from: 1, to: 4, count: 40 }, { label: '5–9', from: 5, to: 9, count: 12 },
           { label: '10–24', from: 10, to: 24, count: 20 }, { label: '25–49', from: 25, to: 49, count: 6 },
           { label: '50–99', from: 50, to: 99, count: 2 }, { label: '100–199', from: 100, to: 199, count: 0 },
           { label: '200–300', from: 200, to: 300, count: 0 }],
  economy: { players: 80,
    money: { total: 12345678, avg: 154320, median: 40000, top1Pct: 41.5, top10Pct: 72.3 },
    gold: { total: 9000, avg: 112, median: 30, top10Pct: 55 } },
  history: [
    { day: '2026-08-15', dau: 9, mau: 70, total: 130, moneyTotal: 1000, goldTotal: 10 },
    { day: '2026-08-16', dau: 11, mau: 76, total: 136, moneyTotal: 1100, goldTotal: 12 },
    { day: '2026-08-17', dau: 12, mau: 80, total: 140, moneyTotal: 1200, goldTotal: 14 },
  ],
};

(async () => {
const c = document.getElementById('tab-content');

console.log('\n[1] Вкладка есть и закрыта своей зоной');
const src = fs.readFileSync(__dirname + '/../public/js/admin.js', 'utf8');
const tabs = /const tabs = \[([\s\S]*?)\];/.exec(src)[1];
ok('вкладка «Аналитика» в списке', /id:'analytics'/.test(tabs));
ok('у вкладки своя зона, а не чужая', /id:'analytics'[^}]*zone:'analytics'/.test(tabs));
ok('вкладка разводится в renderTab', /Admin\.tab === 'analytics'\)\s*return Admin\.renderAnalytics/.test(src));

console.log('\n[2] Ошибку доступа показываем текстом, а не пустым экраном');
API.get = async () => { throw new Error('Недостаточно прав'); };
await Admin.renderAnalytics(c);
ok('видно причину отказа', /Недостаточно прав/.test(c.textContent));
ok('нет вечной загрузки', !/Считаю/.test(c.textContent));

console.log('\n[3] Верхние плитки');
API.get = async () => JSON.parse(JSON.stringify(DATA));
await Admin.renderAnalytics(c);
const t = c.textContent;
for (const [what, val] of [['онлайн', '3'], ['DAU', '12'], ['WAU', '30'], ['MAU', '80']]) {
  ok(`показано ${what}: ${val}`, new RegExp('>' + val + '<').test(c.innerHTML));
}
ok('липкость с процентом', /15%/.test(t) && /DAU \/ MAU/.test(t));
ok('новые за сегодня и за неделю', /Новых сегодня/.test(t) && /за неделю 19/.test(t));

console.log('\n[4] Удержание: цифры и цвет');
ok('все четыре рубежа', /Второй день/.test(t) && /Третий день/.test(t) && /Неделя/.test(t) && /Месяц/.test(t));
ok('d1 = 10%', /10%/.test(t));
ok('плохое удержание красное', /color:var\(--red\)[^>]*>\s*10%/.test(c.innerHTML.replace(/\n\s*/g, ' ')));
ok('хорошее — зелёное', /color:var\(--green\)[^>]*>\s*30%/.test(c.innerHTML.replace(/\n\s*/g, ' ')));
// Строка «Месяц» пустая: 0 из 0 — это не «удержание 0%», а «рано считать»
const retBlock = c.innerHTML.slice(c.innerHTML.indexOf('Удержание новичков'), c.innerHTML.indexOf('Воронка новичка'));
ok('месяц без данных не показывает 0%', /нет данных/.test(retBlock) && !/>\s*0%/.test(retBlock));
ok('объяснено, что в знаменателе', /у кого этот день уже наступил/.test(t));

console.log('\n[5] Воронка: узкое место найдено само');
ok('все ступени на месте', DATA.funnel.every((s) => t.includes(s.name)));
ok('пояснения к ступеням есть', /освоились/.test(t) && /социальная привязка/.test(t));
// Самый большой провал: 80 → 25 на пятом уровне (−55)
ok('подсвечен именно провал 80→25', /−55 чел/.test(t));
const funBlock = c.innerHTML.slice(c.innerHTML.indexOf('Воронка новичка'));
ok('узкое место выделено рамкой', /outline:1px solid var\(--red\)/.test(funBlock));
ok('полоски масштабированы от максимума', /width:100%/.test(funBlock) && /width:80%/.test(funBlock));

console.log('\n[6] Гистограмма уровней');
ok('подписи корзин', /1–4/.test(t) && /200–300/.test(t));
ok('пустые корзины не ломают вёрстку', /min-height:2px/.test(c.innerHTML));
ok('сказано, кого считаем', /за последние 30 дней/.test(t));

console.log('\n[7] Экономика: концентрация важнее среднего');
ok('крупные числа с разделителями', /12\u00a0345\u00a0678/.test(t));
ok('медиана показана рядом со средним', /Медиана/.test(t) && /40\u00a0000/.test(t));
ok('доля верхних 10% видна', /72\.3%/.test(t));
ok('сильный перекос помечен красным', /color:var\(--red\)[^>]*>72\.3%/.test(c.innerHTML));
ok('объяснено, зачем медиана', /среднее задирают несколько богачей/.test(t));
ok('английские слова в текст не просочились', !/honest|median|total/i.test(t.replace(/[A-Za-z]*Pct/g, '')));

console.log('\n[8] График динамики');
ok('нарисован svg', /<svg/.test(c.innerHTML));
ok('две линии: сутки и месяц', (c.innerHTML.match(/<polyline/g) || []).length === 2);
ok('подписан диапазон дат', /2026-08-15 → 2026-08-17/.test(t));
ok('координаты — числа, а не NaN', !/NaN/.test(c.innerHTML));

console.log('\n[9] Один день истории — график не рисуем, а объясняем');
API.get = async () => ({ ...JSON.parse(JSON.stringify(DATA)), history: [DATA.history[0]] });
await Admin.renderAnalytics(c);
ok('пустого графика нет', !/<polyline/.test(c.innerHTML));
ok('сказано, когда он появится', /график появится/.test(c.textContent));

console.log('\n[10] Нулевая база не роняет вкладку');
API.get = async () => ({
  activity: { online: 0, dau: 0, wau: 0, mau: 0, stickiness: null, newToday: 0, newWeek: 0, total: 0 },
  retention: { d1: { eligible: 0, returned: 0, pct: null }, d3: { eligible: 0, returned: 0, pct: null },
               d7: { eligible: 0, returned: 0, pct: null }, d30: { eligible: 0, returned: 0, pct: null } },
  funnel: DATA.funnel.map((s) => ({ ...s, count: 0, pct: 0 })),
  levels: DATA.levels.map((b) => ({ ...b, count: 0 })),
  economy: { players: 0, money: { total: 0, avg: 0, median: 0, top1Pct: null, top10Pct: null },
             gold: { total: 0, avg: 0, median: 0, top10Pct: null } },
  history: [],
});
await Admin.renderAnalytics(c);
ok('вкладка отрисовалась', c.textContent.includes('Удержание новичков'));
ok('без NaN и undefined', !/NaN|undefined/.test(c.innerHTML));
ok('липкость без данных — прочерк', /—/.test(c.textContent));

console.log('\n[11] Античит виден во вкладке «Техника»');
ok('блок есть', /Античит: подозрительные приросты/.test(src));
ok('закрыт зоной «Безопасность»', /Admin\.can\('security'\).{0,400}Античит/s.test(src));
ok('честно написано, что баны не автоматические', /Никого не банит/.test(src));
ok('есть выбор периода', /id="ac-hours"/.test(src) && /за неделю/.test(src));
ok('запрос идёт на нужный адрес', /\/api\/admin\/anticheat\?hours=/.test(src));
ok('чистый результат — зелёным', /Ничего подозрительного/.test(src));
ok('находки показывают доказательство, а не только заголовок', /f\.detail/.test(src));
ok('тяжесть находки красит рамку', /s === 'high' \? 'var\(--red\)'/.test(src));

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
})();
