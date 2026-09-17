// ═══════════════════════════════════════════════════════════════════
// test/offers-form.test.js — конструктор наборов в панели (jsdom, 18.09.2026)
//
// ЧТО БЫЛО. Любая правка состава («Добавить позицию», «✕», смена типа)
// перерисовывала форму из черновика, а в черновик перед этим попадал
// только состав. Название, цены, срок продажи и лимит молча возвращались
// к старым значениям: владелец ставил срок и лимит, добавлял позицию и
// сохранял набор бессрочным и без лимита.
//
// Что стережётся:
//  1. После правок состава все поля формы на месте и уходят в сохранение.
//  2. В форме есть «Всего на всех» (тираж) и быстрые кнопки срока.
//  3. В списке — понятное состояние: «ещё не начался», «срок вышел»,
//     «тираж разобран», и продано «N из M».
//  4. Карточка у игрока показывает остаток тиража и «разобрано».
//
// Запуск: node test/offers-form.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const dom = new JSDOM('<!DOCTYPE html><body><div id="econ-body"></div></body>', { url: 'http://localhost/admin' });
Object.assign(global, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, location: dom.window.location, Event: dom.window.Event });
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(path.join(ROOT, f), 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API');
UI.toast = () => {};
global.OfferCard = load('public/js/offercard.js', 'OfferCard');
dom.window.OfferCard = global.OfferCard;
global.Admin = load('public/js/admin.js', 'Admin');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const wait = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

const palette = {
  types: [{ id: 'gold', name: 'Золото', needs: 'qty' }, { id: 'vip', name: 'VIP', needs: 'days' }],
  mercs: [], containers: [], units: [],
};
const HOUR = 3600e3;
const row = (over) => Object.assign({
  id: 'o1', title: 'Набор', emoji: '🎁', note: '', items: [{ type: 'gold', qty: 1 }], itemsText: ['🪙 1 золота'],
  priceGold: 10, priceRub: 0, oldPriceGold: 0, oldPriceRub: 0, startAt: 0, endAt: 0,
  limitPerPlayer: 0, limitTotal: 0, reserved: 0, enabled: true, sold: 0, active: true, state: 'live',
}, over);

(async () => {
  const saves = [];
  let list = [];
  API.get = async (u) => (u === '/api/admin/offers' ? { offers: list, palette } : {});
  API.post = async (u, b) => {
    if (u === '/api/admin/offers/save') saves.push(b);
    if (u === '/api/admin/offers/preview') return { offer: { id: 'p', title: b.title, items: [], priceGold: b.priceGold, limitTotal: b.limitTotal, leftTotal: b.limitTotal }, active: true };
    return {};
  };
  const box = document.getElementById('econ-body');
  await Admin.loadOffers(box);

  console.log('\n[1] Поля формы переживают правку состава');
  document.getElementById('of-new').click();
  const set = (id, v) => { document.getElementById(id).value = v; };
  set('of-title', 'Весенний'); set('of-price-gold', '77'); set('of-price-rub', '199');
  set('of-limit', '3'); set('of-limit-total', '50');
  set('of-start', '2026-09-20T10:00'); set('of-end', '2026-09-25T10:00');
  document.getElementById('of-add').click();
  document.getElementById('of-add').click();
  const sel = document.querySelectorAll('.of-type')[1];
  sel.value = 'vip'; sel.onchange();
  document.querySelector('.of-del').click();
  const g = (id) => document.getElementById(id).value;
  ok('название на месте', g('of-title') === 'Весенний');
  ok('цены на месте', g('of-price-gold') === '77' && g('of-price-rub') === '199');
  ok('лимит в одни руки на месте', g('of-limit') === '3');
  ok('тираж на месте', g('of-limit-total') === '50');
  ok('срок продажи на месте', g('of-start') === '2026-09-20T10:00' && g('of-end') === '2026-09-25T10:00');
  ok('состав — одна позиция VIP', [...document.querySelectorAll('.of-type')].map((s) => s.value).join() === 'vip');
  document.getElementById('of-save').click();
  await wait();
  const s = saves[0] || {};
  ok('в сохранение ушли лимиты', s.limitPerPlayer === 3 && s.limitTotal === 50);
  ok('и срок', s.startAt === new Date('2026-09-20T10:00').getTime() && s.endAt === new Date('2026-09-25T10:00').getTime());
  ok('и цены с названием', s.priceGold === 77 && s.priceRub === 199 && s.title === 'Весенний');

  console.log('\n[2] Быстрые кнопки срока');
  document.getElementById('of-new').click();
  set('of-start', '2026-09-20T10:00');
  document.querySelector('[data-of-days="7"]').click();
  ok('+7 дней от начала', g('of-end') === '2026-09-27T10:00');
  document.querySelector('[data-of-days="1"]').click();
  ok('+1 день к уже стоящему концу', g('of-end') === '2026-09-28T10:00');
  document.getElementById('of-end-clear').click();
  document.getElementById('of-start-clear').click();
  ok('«Сразу» и «Бессрочно» очищают даты', g('of-end') === '' && g('of-start') === '');

  console.log('\n[3] Состояние в списке');
  list = [
    row({ id: 'a', title: 'Скоро', state: 'soon', active: false }),
    row({ id: 'b', title: 'Прошёл', state: 'ended', active: false }),
    row({ id: 'c', title: 'Разобран', state: 'soldout', active: false, limitTotal: 5, sold: 5 }),
    row({ id: 'd', title: 'Идёт', state: 'live', limitTotal: 10, sold: 3, reserved: 2 }),
    row({ id: 'e', title: 'Выкл', state: 'off', enabled: false, active: false }),
  ];
  await Admin.loadOffers(box);
  const card = (t) => [...box.querySelectorAll('.card')].find((c) => c.querySelector('b') && c.querySelector('b').textContent.indexOf(t) >= 0);
  ok('«ещё не начался»', /ещё не начался/.test(card('Скоро').textContent));
  ok('включённый с прошедшим сроком — «срок вышел», а не «выключен»',
     /срок вышел/.test(card('Прошёл').textContent) && !/выключен/.test(card('Прошёл').textContent));
  ok('«тираж разобран»', /тираж разобран/.test(card('Разобран').textContent));
  ok('продано N из M', /продано: 3 из 10/.test(card('Идёт').textContent));
  ok('остаток с учётом брони', /10 · осталось 5 \(ждут оплаты: 2\)/.test(card('Идёт').textContent));
  ok('выключенный — «выключен»', /выключен/.test(card('Выкл').textContent));

  console.log('\n[4] Карточка у игрока');
  const base = { id: 'x', title: 'T', items: [], priceGold: 5, priceRub: 0, canBuyGold: true, canBuyRub: false };
  let html = OfferCard.html(Object.assign({}, base, { limitTotal: 100, leftTotal: 37, soldOut: false }));
  ok('«Осталось 37 из 100»', /Осталось 37 из 100/.test(html));
  html = OfferCard.html(Object.assign({}, base, { limitTotal: 100, leftTotal: 0, soldOut: true, canBuyGold: false }));
  ok('разобрано — так и написано, а не «вы уже взяли»', /Тираж разобран/.test(html) && /Наборы разобраны/.test(html) && !/Вы уже взяли/.test(html));
  html = OfferCard.html(Object.assign({}, base, { limitTotal: 0 }));
  ok('без тиража — строки нет', !/Осталось/.test(html));

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
