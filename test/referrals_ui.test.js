// jsdom: две страницы приглашений и почта с удалением сообщений.
//
// Проверки строкой по исходнику ловят пропажу кнопки, но не ловят
// ошибку при отрисовке — а именно из-за неё экран у игрока остаётся
// пустым. Поэтому страницы здесь рисуются по-настоящему:
//   • «Пригласить друга» — только ссылка, QR и список пришедших;
//   • «Задания приглашений» — две вкладки: шкалы и парные задания.
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
  refCount: 2, refEarnings: 350, referredBy: null, invitedByName: null,
  level50Reward: 100, level50Tokens: 3, inviteeGold: 50, purchaseSharePct: 10,
  questsOn: false,
  invited: [
    { name: 'Новобранец', level: 52, joinedAt: Date.now() - 86400000, lastSeen: Date.now(), active: true, reached50: true, goldFromHim: 350 },
    { name: 'Тихоня', level: 4, joinedAt: Date.now() - 7 * 86400000, lastSeen: 0, active: false, reached50: false, goldFromHim: 0 },
  ],
};
const QUESTS = {
  inviter: {
    board: 'inviter', points: 2, total: 10,
    tasks: [
      { id: 'inv1', name: 'Пригласить 1 человека', note: 'до 50 уровня', need: 1, have: 1, done: true },
      { id: 'inv3', name: 'Пригласить 3 человек', note: '', need: 3, have: 1, done: false },
    ],
    steps: [
      { step: 1, icon: '🪙', img: '/img/icons/gold.webp', text: '50 золота', reached: true, claimed: true },
      { step: 2, icon: '💵', img: '/img/icons/dollar.webp', text: '$10 000 000 000', reached: true, claimed: false },
      { step: 3, icon: '📦', img: '/img/containers/keis.webp', text: '5 × Технологичный кейс', reached: false, claimed: false },
    ],
  },
  newbie: {
    board: 'newbie', points: 1, total: 10,
    tasks: [{ id: 'lvl30', name: 'Достигнуть 30 уровня', note: '', need: 30, have: 30, done: true }],
    steps: [{ step: 1, icon: '👑', img: '', badge: 'VIP', text: 'Подписка VIP на 7 дн.', reached: true, claimed: false }],
  },
  share: {
    pct: 12, basePct: 10, minLevel: 70, friendsReady: 5,
    steps: [{ friends: 5, pct: 12, reached: true }, { friends: 10, pct: 15, reached: false }],
    next: { friends: 10, pct: 15, left: 5 },
  },
  pair: {
    mates: [{ id: 'm1', name: 'Новобранец', level: 52 }, { id: 'm2', name: 'Тихоня', level: 4 }],
    daily: [
      { id: 'pd_chat', name: 'Написать по 10 сообщений', note: '', need: 10, mine: 10, theirs: 4,
        mateName: 'Новобранец', done: false, icon: '🪙', img: '/img/icons/gold.webp', badge: '', reward: '10 золота' },
      { id: 'pd_market', name: 'Купить любой товар на чёрном рынке', note: 'допинг или контейнер',
        need: 1, mine: 0, theirs: 1, mateName: 'Тихоня', done: false, icon: '🪙',
        img: '/img/icons/gold.webp', badge: '', reward: 'возврат 50% от стоимости товара' },
    ],
    once: [
      { id: 'po_lvl70', name: 'Достигнуть 70 уровня обоим', note: '', need: 70, mine: 70, theirs: 52,
        mateName: 'Новобранец', done: false, icon: '🪙', img: '/img/icons/gold.webp', badge: '', reward: '150 золота' },
    ],
  },
};

(async () => {
  const c = document.getElementById('content');

  console.log('\n[1] Страница «Пригласить друга» — только ссылка, QR и свои');
  API.get = async () => JSON.parse(JSON.stringify(REF));
  let err = null;
  try { await App.screens.referral(c); } catch (e) { err = e; }
  ok('отрисовка без ошибок', !err); if (err) console.log('   ' + (err.stack || err).split('\n').slice(0, 3).join(' | '));
  ok('ссылка показана в поле', document.getElementById('ref-link').value === REF.link);
  ok('код показан', c.innerHTML.includes('VERB1A2B'));
  ok('оба приглашённых в списке', /Новобранец/.test(c.innerHTML) && /Тихоня/.test(c.innerHTML));
  ok('награда за 50 уровень — 100', /<span class="ic-gold"><\/span> 100/.test(c.innerHTML));
  ok('кнопки «поделиться» и «сохранить QR» на месте',
     !!document.getElementById('ref-share') && !!document.getElementById('ref-qr-save'));
  ok('без поддержки холста вместо QR — понятная надпись',
     /QR-код недоступен/.test(document.getElementById('ref-qr').innerHTML));
  ok('ввода чужого кода на странице нет', !/Ввести чужой код/.test(c.innerHTML) && !document.getElementById('ref-input'));
  ok('шкал и парных заданий здесь нет', !/Шкала вербовщика/.test(c.innerHTML) && !/Парные/.test(c.innerHTML));
  ok('кнопки на задания нет, пока раздел выключен', !/refquests/.test(c.innerHTML));
  API.get = async () => Object.assign(JSON.parse(JSON.stringify(REF)), { questsOn: true });
  await App.screens.referral(c);
  ok('с включённым разделом появляется кнопка на задания', /refquests/.test(c.innerHTML));

  console.log('\n[2] Страница заданий: вкладка «Шкалы»');
  API.get = async (url) => (url === '/api/referral/quests'
    ? JSON.parse(JSON.stringify(QUESTS))
    : Object.assign(JSON.parse(JSON.stringify(REF)), { questsOn: true }));
  const claims = [];
  API.post = async (url, body) => { claims.push([url, body]); return { ok: true }; };
  await App.screens.refquests(c, 'scales');
  ok('обе вкладки на месте', /refquests\/scales/.test(c.innerHTML) && /refquests\/pairs/.test(c.innerHTML));
  ok('шкала вербовщика нарисована', /Шкала вербовщика/.test(c.innerHTML) && !!c.querySelector('.rq-bar'));
  ok('полоса заполнена по баллам', /width:67%/.test(c.querySelector('.rq-fill').getAttribute('style')));
  ok('под каждым баллом иконка награды', c.querySelectorAll('.rq-card')[0].querySelectorAll('.rq-step').length === 3);
  ok('у каждого условия своя рамка', c.querySelectorAll('.rq-card')[0].querySelectorAll('.rq-item').length === 2);
  ok('и своя полоса прогресса', c.querySelectorAll('.rq-card')[0].querySelectorAll('.rq-item .rq-line').length === 2);
  ok('у VIP вместо картинки золотая надпись', /class="rq-badge">VIP</.test(c.innerHTML));
  ok(`иконки наград — картинки (${c.querySelectorAll('.rq-step .rq-img').length} шт.)`,
     c.querySelectorAll('.rq-step .rq-img').length === 3);
  // Монета и купюра остаются обычного размера, остальное — крупнее
  const px = (sel) => Number(c.querySelector(sel).getAttribute('width'));
  ok('предметы показаны крупнее монеты',
     px('.rq-step img[src*="containers"]') > px('.rq-step img[src*="icons/gold"]'));
  ok('и это настоящие файлы игры', /img\/containers\/keis\.webp/.test(c.innerHTML)
     && /img\/icons\/gold\.webp/.test(c.innerHTML));
  ok('забранный балл помечен', !!c.querySelector('.rq-step.is-claimed'));
  ok('кнопка «Забрать» только у достигнутого и незабранного',
     c.querySelectorAll('[data-claim-step]').length === 2);
  ok('шкала новобранца тоже видна', /Шкала новобранца/.test(c.innerHTML));
  ok('доля с покупок показана с порогом 70', /Доля с покупок друзей/.test(c.innerHTML) && /70 уровня/.test(c.innerHTML));
  await c.querySelector('[data-claim-step]').onclick();
  ok('получение награды уходит на сервер',
     claims.some(([u2, b]) => u2 === '/api/referral/quests/claim' && b.step === 2 && b.board === 'inviter'));

  console.log('\n[3] Страница заданий: вкладка «Парные»');
  await App.screens.refquests(c, 'pairs');
  ok('напарники перечислены', /Новобранец/.test(c.innerHTML) && /Тихоня/.test(c.innerHTML));
  ok('подразделы на месте', /Ежедневные/.test(c.innerHTML) && /Разовые/.test(c.innerHTML));
  ok('по умолчанию открыты ежедневные',
     /Написать по 10 сообщений/.test(c.innerHTML) && !/Достигнуть 70 уровня/.test(c.innerHTML));
  ok('каждое задание в своей рамке', c.querySelectorAll('.rq-item').length === 2);
  ok('под условием две полосы: своя и напарника',
     c.querySelectorAll('.rq-item')[0].querySelectorAll('.rq-line').length === 2);
  ok('подписаны «вы» и позывной напарника',
     /rq-line-who">вы</.test(c.innerHTML) && /rq-line-who">Новобранец</.test(c.innerHTML));
  ok('награда стоит под полосами, картинкой и текстом',
     !!c.querySelector('.rq-item-reward .rq-img'));
  ok('возврат за покупку назван словами', /возврат 50% от стоимости товара/.test(c.innerHTML));
  ok('шкал на этой вкладке нет', !c.querySelector('.rq-bar'));
  await App.screens.refquests(c, 'pairs/once');
  ok('подраздел «Разовые» открывается отдельно',
     /Достигнуть 70 уровня/.test(c.innerHTML) && !/Написать по 10 сообщений/.test(c.innerHTML));

  console.log('\n[4] Почта: удаление сообщения, переписки и очистка');
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
  // Почта разделена на подвкладки: переписки — «Личные», награды от
  // игры — «Системные». Проверяем обе.
  await App.screens.mail(c, 'personal');
  ok('у переписки есть кнопка удаления', !!c.querySelector('[data-del-thread="u2"]'));
  ok('внизу есть очистка всех сообщений', !!document.getElementById('mail-clear-all'));
  await App.screens.mail(c, 'system');
  ok('незабранная награда предлагает «Забрать»', !!c.querySelector('[data-claim-reward="r1"]'));
  await App.screens.mail(c, 'personal');
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
