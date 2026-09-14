// jsdom: кнопка «Скрыть профиль» действительно работает.
//
// Жалоба: нажимаю — ничего не происходит. Причина: обработчик кнопки
// стоял внутри ветки «ЧУЖОЙ профиль», а сама кнопка рисуется только в
// СВОЁМ — значит, обработчик не навешивался никогда. Проверка строкой
// по коду такое не ловит (и кнопка, и обработчик в файле есть), поэтому
// здесь профиль рисуется по-настоящему и кнопка нажимается.
//
// Ровно на этих же граблях раздел стоял раньше: в коде рядом висит
// комментарий про «Полную статистику» и «Сменить позывной».
const assert = require('assert'); const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) }); localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API');
const toasts = []; UI.toast = (t) => toasts.push(t); UI.confirm = async () => true;
global.App = load('public/js/app.js', 'App');
App.rerender = () => {}; App.go = () => {};
load('public/js/screens/core.js', 'App');
let passed = 0; const ok = (n, c) => { assert.ok(c, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

const ME = {
  id: 'me', name: 'Squantym', vip: true, vipUntil: Date.now() + 7 * 86400000,
  hideProfile: false, level: 80, gold: 0,
};
const profileOf = (id) => ({
  id, name: id === 'me' ? 'Squantym' : 'Чужак', level: 80, status: '', avatar: 'm1',
  flag: '🇷🇺', countryName: 'Россия', countryBonus: '', legion: null, isBot: false,
  battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, breaches: 0 },
  power: null, crestParts: 3, critChancePct: 5, dodgePct: 5,
  hideArmy: false, hiddenByOwner: false, canAttack: false,
});

(async () => {
  const c = document.getElementById('content');
  const posts = [];
  API.post = async (url, body) => { posts.push([url, body]); return { ok: true, notices: ['🕶 Боевой профиль скрыт'] }; };
  App.refreshMe = async () => { App.me.hideProfile = !App.me.hideProfile; };

  console.log('\n[1] В своём профиле кнопка есть и нажимается');
  App.me = JSON.parse(JSON.stringify(ME));
  API.get = async () => ({ profile: profileOf('me') });
  await App.screens.profile(c, 'me');
  const btn = document.getElementById('pf-hide');
  ok('кнопка «Скрыть профиль» показана подписчику', !!btn);
  ok('и подписана по состоянию', /Скрыть профиль/.test(btn.textContent));
  ok('у кнопки есть обработчик — иначе нажатие ничего не делает', typeof btn.onclick === 'function');
  await btn.onclick();
  ok('нажатие уходит на сервер', posts.some(([u, b]) => u === '/api/vip/hide-profile' && b.on === true));
  ok('игроку сказали, что произошло', toasts.some((t) => /скрыт/i.test(t)));

  console.log('\n[2] Повторное нажатие открывает профиль обратно');
  posts.length = 0;
  App.me.hideProfile = true;
  await App.screens.profile(c, 'me');
  const btn2 = document.getElementById('pf-hide');
  ok('подпись сменилась на «Открыть профиль»', /Открыть профиль/.test(btn2.textContent));
  ok('и рядом объяснено, что именно закрыто', /Профиль закрыт/.test(c.innerHTML));
  await btn2.onclick();
  ok('на сервер уходит выключение', posts.some(([u, b]) => u === '/api/vip/hide-profile' && b.on === false));

  console.log('\n[3] Без подписки кнопки нет');
  App.me = Object.assign(JSON.parse(JSON.stringify(ME)), { vip: false });
  await App.screens.profile(c, 'me');
  ok('без VIP переключателя не показываем', !document.getElementById('pf-hide'));

  console.log('\n[4] В чужом профиле переключателя нет');
  App.me = JSON.parse(JSON.stringify(ME));
  API.get = async () => ({ profile: profileOf('other') });
  await App.screens.profile(c, 'other');
  ok('чужой профиль своей кнопкой скрытия не управляет', !document.getElementById('pf-hide'));

  console.log('\n[5] Обработчик стоит вне ветки «чужой профиль»');
  const src = fs.readFileSync(__dirname + '/../public/js/screens/core.js', 'utf8');
  const at = src.indexOf("document.getElementById('pf-hide')");
  const foreignBranch = src.indexOf('  if (!own) {\n    // Инструменты «Дозора»'.replace(/\n/g, src.includes('\r\n') ? '\r\n' : '\n'));
  ok('кнопка подписки не спрятана в ветку чужого профиля',
     at > 0 && (foreignBranch < 0 || at < foreignBranch));

  console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
