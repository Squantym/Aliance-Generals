// ═══════════════════════════════════════════════════════════════════
// test/profile_ui.test.js — «Личное дело» рисуется целиком
//
// ЧТО БЫЛО НАЙДЕНО. Карточка профиля и игральная карта преферанса
// назывались одним классом .pf-card. Стили карты (ширина 60 px,
// пропорции 2:3, overflow:hidden, светлая рубашка) накрыли карточку
// профиля: всё «Личное дело» схлопывалось в белый прямоугольник в
// шестьдесят пикселей, а вместе с ним исчезали аватар, обращение и
// кнопка «Поставить портрет». Разметка при этом была правильной, сервер
// отвечал правильно — и по логам всё было в порядке.
//
// Отсюда две разные проверки:
//   1. Экран профиля рисуется и содержит то, что игрок должен увидеть.
//   2. Классы карточки профиля и игральной карты РАЗНЫЕ — это то, из-за
//      чего сломалось, и это дешевле стеречь, чем искать заново.
//
// Запуск: node test/profile_ui.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage; global.location = dom.window.location;
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');

function load(file, name) {
  let c = fs.readFileSync(path.join(ROOT, file), 'utf8');
  c += `\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`;
  eval(c);
  return globalThis.__x;
}
global.UI = load('public/js/ui.js', 'UI');
global.API = load('public/js/api.js', 'API');
UI.toast = () => {}; UI.confirm = async () => true;
global.App = load('public/js/app.js', 'App');
App.refreshMe = async () => {}; App.rerender = () => {}; App.go = () => {};
load('public/js/screens/core.js', 'App');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const me = {
  id: 'u1', name: 'Командующий', level: 12, gold: 100, vip: false,
  gender: 'm', alliance: null, legion: null, staffRole: null,
};
const profile = (over) => Object.assign({
  id: 'u1', name: 'Командующий', level: 12, rating: 1200, online: true,
  flag: '🇷🇺', countryName: '', avatar: null, profileFrame: '', profileBg: '',
  rank: 'Генерал', gender: 'm', genderTitle: 'Господин Генерал',
  battle: { wins: 3, losses: 1, defWins: 2, defLosses: 0, breaches: 5 },
  deathsCount: 1, units: [], buildings: [], trophies: [], achievements: [],
  power: { atk: 100, def: 90 }, critChancePct: 5, dodgeChancePct: 4,
  status: '', activeTitle: '', canAttack: false, isBot: false,
  capacity: 10, exp: 0, expNext: 333, skills: {}, skillPoints: 0,
}, over || {});

(async () => {
  const c = document.getElementById('content');
  const render = async (p) => {
    App.me = Object.assign({}, me, { gender: p.gender });
    API.get = async (url) => (url.indexOf('/api/profile/') === 0 ? { profile: p } : {});
    await App.screens.profile(c, 'u1');
    return c.innerHTML;
  };

  console.log('\n── 1. Карточка профиля на месте целиком ──');
  let html = await render(profile());
  ok('заголовок «Личное дело»', /Личное дело/.test(html));
  ok('имя игрока показано', /Командующий/.test(html));
  ok('карточка профиля отрисована', !!c.querySelector('.pf-card'));
  ok('в ней есть блок аватара', !!c.querySelector('.pf2-avatar'));
  ok('и кнопка поставить портрет', !!c.querySelector('#pf-avatar-btn'));
  ok('звание на месте', /Генерал/.test(html));

  console.log('\n── 2. Обращение подписано под именем ──');
  const gline = c.querySelector('.pf2-gender');
  ok('подпись есть', !!gline);
  ok('и это обращение с сервера', gline && gline.textContent.trim() === 'Господин Генерал');
  html = await render(profile({ gender: 'f', genderTitle: 'Госпожа Генерал' }));
  ok('у женского пола своё обращение',
     c.querySelector('.pf2-gender').textContent.trim() === 'Госпожа Генерал');

  console.log('\n── 3. Портрет игрока ──');
  html = await render(profile({ avatar: 'm3' }));
  const ava = c.querySelector('.pf2-avatar');
  ok('поставленный портрет виден картинкой',
     /\/img\/avatars\/m3\.webp/.test(ava.getAttribute('style') || ''));
  ok('и заглушки при этом нет', !c.querySelector('.pf2-avatar-stub'));
  html = await render(profile({ avatar: null }));
  ok('без портрета показана заглушка', !!c.querySelector('.pf2-avatar-stub'));
  ok('и кнопка предлагает поставить', /Поставить/.test(c.querySelector('#pf-avatar-btn').textContent));

  console.log('\n── 4. Карточка профиля и игральная карта — разные классы ──');
  // Из-за общего имени профиль складывался в шестьдесят пикселей. Класс
  // игральной карты живёт в экране клуба, карточка профиля — здесь;
  // столкнуться они могут только по имени, поэтому имя и проверяем.
  const market = fs.readFileSync(path.join(ROOT, 'public/js/screens/market.js'), 'utf8');
  ok('в клубе карта называется не так, как карточка профиля',
     !/class="pf-card"/.test(market) && /class="pref-card"/.test(market));
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  // Правило ширины принадлежит игральной карте: попади оно на .pf-card —
  // профиль снова схлопнется.
  ok('правило «карта 60px» относится к игральной карте',
     /\.pref-card \{[\s\S]{0,160}width: 60px/.test(css));
  ok('и не относится к карточке профиля',
     !/\.pf-card \{[\s\S]{0,160}width: 60px/.test(css));

  console.log('\n── 5. Сама проверка умеет краснеть ──');
  ok('разметка не пустая', html.length > 500);
  ok('проверки смотрят в живой DOM', c.querySelectorAll('.card').length > 1);

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
