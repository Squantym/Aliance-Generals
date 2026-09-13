// jsdom: экран «Пригласить друга» и почта с удалением сообщений.
// Проверки строкой по исходнику ловят пропажу кнопки, но не ловят
// ошибку при отрисовке — а именно из-за неё экран у игрока остаётся
// пустым. Поэтому оба экрана здесь рисуются по-настоящему.
const assert = require('assert'); const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) }); localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API');
const toasts = []; UI.toast = (t) => toasts.push(t); UI.confirm = async () => true;
global.App = load('public/js/app.js', 'App'); App.refreshMe = async () => {}; App.rerender = () => {}; App.go = () => {};
load('public/js/screens/referrals.js', 'App');
load('public/js/screens/social.js', 'App');
App.me = { id: 'x', name: 'Вербовщик', gold: 0 };
let passed = 0; const ok = (n, c) => { assert.ok(c, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

const REF = {
  code: 'VERB1A2B', link: 'https://aliance-general.ru/?ref=VERB1A2B',
  refCount: 2, refEarnings: 350, referredBy: null, canApply: false,
  level50Reward: 100, level50Tokens: 3, inviteeGold: 50, purchaseSharePct: 10,
  questsOn: false,
  invited: [
    { name: 'Новобранец', level: 52, joinedAt: Date.now() - 86400000, lastSeen: Date.now(), active: true, reached50: true, goldFromHim: 350 },
    { name: 'Тихоня', level: 4, joinedAt: Date.now() - 7 * 86400000, lastSeen: 0, active: false, reached50: false, goldFromHim: 0 },
  ],
};

(async () => {
  const c = document.getElementById('content');

  console.log('\n[1] Экран приглашений рисуется целиком');
  API.get = async () => JSON.parse(JSON.stringify(REF));
  let err = null;
  try { await App.screens.referral(c); } catch (e) { err = e; }
  ok('отрисовка без ошибок', !err); if (err) console.log('   ' + (err.stack || err).split('\n').slice(0, 3).join(' | '));
  ok('ссылка показана в поле', document.getElementById('ref-link').value === REF.link);
  ok('код показан отдельно', c.innerHTML.includes('VERB1A2B'));
  ok('оба приглашённых в списке', /Новобранец/.test(c.innerHTML) && /Тихоня/.test(c.innerHTML));
  ok('видно, кто принёс золото', /350/.test(c.innerHTML));
  ok('отметка «50 ур.» только у дошедшего', (c.innerHTML.match(/50 ур\./g) || []).length === 1);
  ok('награда за 50 уровень — 100', /<span class="ic-gold"><\/span> 100/.test(c.innerHTML));
  ok('раздел заданий скрыт, пока выключен', !/Задания по приглашениям/.test(c.innerHTML));
  ok('кнопки «поделиться» и «сохранить QR» на месте',
     !!document.getElementById('ref-share') && !!document.getElementById('ref-qr-save'));
  // В jsdom холста нет: экран обязан пережить это и предложить ссылку
  ok('без поддержки холста вместо QR — понятная надпись',
     /QR-код недоступен/.test(document.getElementById('ref-qr').innerHTML));

  console.log('\n[2] Раздел заданий появляется по выключателю');
  API.get = async () => Object.assign(JSON.parse(JSON.stringify(REF)), { questsOn: true });
  await App.screens.referral(c);
  ok('включённый раздел виден игроку', /Задания по приглашениям/.test(c.innerHTML));

  console.log('\n[3] Почта: удаление сообщения, переписки и очистка');
  const posts = [];
  API.post = async (url) => { posts.push(url); return { ok: true, mail: 2, letters: 1 }; };
  API.get = async (url) => {
    if (url === '/api/mail') {
      return { threads: [{ otherId: 'u2', otherName: 'Сосед', lastAt: Date.now(), unread: 1,
        messages: [{ id: 'm1', dir: 'in', subject: '', text: 'Привет', at: Date.now(), read: false }] }] };
    }
    if (url === '/api/rewards') {
      return { rewards: [{ id: 'r1', kind: 'reward', title: 'Доля с покупки', reason: 'приглашение',
        reward: { gold: 100 }, rewardText: ['🪙 100'], lines: [], createdAt: Date.now(), claimed: false }] };
    }
    if (url.indexOf('/api/mail/') === 0) {
      return { otherId: 'u2', otherName: 'Сосед',
        messages: [{ id: 'm1', dir: 'in', subject: '', text: 'Привет', at: Date.now() }] };
    }
    return {};
  };
  await App.screens.mail(c);
  ok('у переписки есть кнопка удаления', !!c.querySelector('[data-del-thread="u2"]'));
  ok('внизу есть очистка всех сообщений', !!document.getElementById('mail-clear-all'));
  ok('незабранная награда предлагает «Забрать»', !!c.querySelector('[data-claim-reward="r1"]'));
  await c.querySelector('[data-del-thread="u2"]').onclick({ stopPropagation() {} });
  ok('удаление переписки уходит на сервер', posts.some((u) => u === '/api/mail/thread/u2/delete'));
  await document.getElementById('mail-clear-all').onclick();
  ok('очистка уходит на сервер', posts.some((u) => u === '/api/mail/clear-all'));
  await App.screens.mail(c, 'u2');
  ok('в переписке у каждого сообщения своя кнопка удаления', !!c.querySelector('[data-del-mail="m1"]'));
  await c.querySelector('[data-del-mail="m1"]').onclick();
  ok('удаление письма уходит на сервер', posts.some((u) => u === '/api/mail/m1/delete'));

  console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
