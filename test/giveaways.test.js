// ═══════════════════════════════════════════════════════════════════
// test/giveaways.test.js — раздачи наград к праздникам и событиям
//
// Что стережётся:
//  1. Собирает раздачу только сотрудник с правом «Ресурсы»; разовая без
//     срока не принимается — иначе плашка висела бы над экраном вечно.
//  2. Разовая: забирается один раз, содержимое действительно выдаётся.
//  3. Срок: после конца плашки нет и забрать нельзя; не начавшаяся
//     раздача не показывается.
//  4. По дням: каждый московский день — следующая награда по списку,
//     дважды за день нельзя, после последнего дня плашка уходит.
//  5. Удалённая раздача исчезает, но уже полученное остаётся.
//  6. Плашка приходит игроку вместе с остальным (mePayload) и рисуется
//     над экраном с кнопкой «Забрать».
//
// Запуск: node test/giveaways.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const gw = require('../dist/src/services/giveaways');
const u = require('../dist/src/core/utils');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const fails = (fn, part, n) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};
const HOUR = 3600000, DAY = 86400000;

(async () => {
  await db.init();
  let ipN = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `gw${++ipN}@t.ru`, 'ru', '10.0.8.' + ipN);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.gold = 0; p.dollars = 0;
    return p;
  };
  const nx = [];
  const O = await reg('Хозяин'); O.role = 'owner';
  const clear = () => { const s = db.load('giveaways', {}); for (const k of Object.keys(s)) delete s[k]; };

  console.log('\n[1] Кто и что может выложить');
  const P = await reg('Игрок');
  fails(() => gw.adminSave(P, { title: 'x', items: [{ type: 'gold', qty: 10 }], endAt: Date.now() + DAY }, nx),
        'прав', 'игроку выкладывать награды нельзя');
  fails(() => gw.adminSave(O, { title: '', items: [{ type: 'gold', qty: 10 }], endAt: Date.now() + DAY }, nx),
        'Назовите', 'без названия не принимается');
  fails(() => gw.adminSave(O, { title: 'Пустая', items: [], endAt: Date.now() + DAY }, nx),
        'хотя бы одну позицию', 'пустая награда не принимается');
  fails(() => gw.adminSave(O, { title: 'Бессрочная', items: [{ type: 'gold', qty: 10 }] }, nx),
        'до какого времени', 'разовая без срока не принимается');
  fails(() => gw.adminSave(O, { title: 'Задом наперёд', items: [{ type: 'gold', qty: 10 }], startAt: Date.now() + DAY, endAt: Date.now() + HOUR }, nx),
        'раньше начала', 'срок раньше начала не принимается');
  fails(() => gw.adminSave(O, { title: 'Пустые дни', kind: 'daily', days: [[]] }, nx),
        'хотя бы на один день', 'дневная без наград не принимается');

  console.log('\n[2] Разовая награда');
  const A = await reg('Первый');
  const once = gw.adminSave(O, {
    title: 'День Победы', emoji: '🎖', note: 'Всем участникам',
    items: [{ type: 'gold', qty: 100 }, { type: 'dollars', qty: 5000 }],
    endAt: Date.now() + 7 * DAY,
  }, nx).giveaway;
  const bar = gw.forPlayer(A);
  ok(bar && bar.id === once.id && bar.canTake && bar.items.length === 2, 'плашка показывает состав и кнопку');
  ok(bar.items[0].icon === '/img/icons/gold.webp', 'у золота в плашке своя картинка');
  const got = gw.claim(A, once.id, nx);
  ok(A.gold === 100 && A.dollars === 5000, `награда выдана: 🪙 ${A.gold}, $ ${A.dollars}`);
  ok(got.given.length === 2, 'в ответе перечислено, что именно выдали');
  ok(gw.forPlayer(A) === null, 'после получения плашки нет');
  fails(() => gw.claim(A, once.id, nx), 'уже забрали', 'второй раз забрать нельзя');
  const B = await reg('Второй');
  ok(gw.forPlayer(B) !== null, 'другому игроку награда всё ещё доступна');

  console.log('\n[3] Срок получения');
  clear();
  const past = gw.adminSave(O, { title: 'Вчерашняя', items: [{ type: 'gold', qty: 50 }], endAt: Date.now() + HOUR }, nx).giveaway;
  db.load('giveaways', {})[past.id].endAt = Date.now() - 1000;   // срок вышел, пока игрок думал
  ok(gw.forPlayer(B) === null, 'просроченная награда в плашке не показывается');
  fails(() => gw.claim(B, past.id, nx), 'истёк', 'и забрать её нельзя');
  clear();
  gw.adminSave(O, { title: 'Завтрашняя', items: [{ type: 'gold', qty: 50 }], startAt: Date.now() + DAY, endAt: Date.now() + 3 * DAY }, nx);
  ok(gw.forPlayer(B) === null, 'не начавшаяся награда не показывается');
  clear();
  gw.adminSave(O, { title: 'Выключенная', items: [{ type: 'gold', qty: 50 }], endAt: Date.now() + DAY, enabled: false }, nx);
  ok(gw.forPlayer(B) === null, 'выключенная награда не показывается');

  console.log('\n[4] Награда по дням');
  clear();
  const daily = gw.adminSave(O, {
    title: 'Неделя события', kind: 'daily',
    days: [
      [{ type: 'gold', qty: 10 }],
      [{ type: 'gold', qty: 20 }],
      [{ type: 'gold', qty: 30 }],
    ],
    endAt: Date.now() + 30 * DAY,
  }, nx).giveaway;
  const C = await reg('Ежедневный');
  const d1 = gw.forPlayer(C);
  ok(d1.kind === 'daily' && d1.day === 1 && d1.daysTotal === 3, `плашка: день ${d1.day} из ${d1.daysTotal}`);
  gw.claim(C, daily.id, nx);
  ok(C.gold === 10, `первый день выдал 10 золота (${C.gold})`);
  const after = gw.forPlayer(C);
  ok(after && !after.canTake && after.nextAt > Date.now(), 'сегодня уже забрал — кнопка ждёт следующих суток');
  ok(after.day === 2, 'и показывает, что завтра будет второй день');
  fails(() => gw.claim(C, daily.id, nx), 'уже получена', 'дважды за день нельзя');
  C.giveawaysTaken[daily.id].last = '2000-01-01';    // наступили новые сутки
  gw.claim(C, daily.id, nx);
  ok(C.gold === 30, `второй день выдал 20 золота (всего ${C.gold})`);
  C.giveawaysTaken[daily.id].last = '2000-01-01';
  gw.claim(C, daily.id, nx);
  ok(C.gold === 60, `третий день выдал 30 золота (всего ${C.gold})`);
  ok(gw.forPlayer(C) === null, 'список кончился — плашка ушла');
  C.giveawaysTaken[daily.id].last = '2000-01-01';
  fails(() => gw.claim(C, daily.id, nx), 'уже забрали', 'после последнего дня больше ничего');
  const D = await reg('Опоздавший');
  ok(gw.forPlayer(D).day === 1, 'новый игрок начинает с первого дня');

  console.log('\n[5] Удаление и штаб');
  const list = gw.adminList(O);
  ok(list.giveaways.length >= 1 && list.palette && list.palette.types.length > 0, 'в штабе список и набор позиций');
  const taken = gw.adminList(O).giveaways.find((g) => g.id === daily.id).taken;
  ok(taken === 3, `видно, сколько раз забрали: ${taken}`);
  gw.adminRemove(O, daily.id, nx);
  ok(gw.forPlayer(D) === null, 'удалённая раздача исчезла у всех');
  ok(C.gold === 60, 'но полученное у игрока осталось');
  fails(() => gw.adminRemove(O, daily.id, nx), 'не найдена', 'удалить дважды нельзя');

  console.log('\n[6] Плашка у игрока');
  clear();
  const shown = gw.adminSave(O, { title: 'Ивент', items: [{ type: 'gold', qty: 100 }], endAt: Date.now() + 7 * DAY }, nx).giveaway;
  const me = player.mePayload(B);
  ok(me.giveaway && me.giveaway.id === shown.id, 'раздача приходит игроку вместе с остальным');

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><body><div id="pin-news"></div><div id="content"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.location = dom.window.location;
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  const load = (f, name) => {
    let code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    code += `\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`;
    eval(code);
    return globalThis.__x;
  };
  global.UI = load('public/js/ui.js', 'UI');
  global.API = load('public/js/api.js', 'API');
  const App = load('public/js/app.js', 'App');
  global.App = App;
  API.token = () => 'x';
  App.me = { giveaway: { id: shown.id, title: 'Ивент', emoji: '🎁', kind: 'once', canTake: true, endAt: Date.now() + 7 * DAY, items: [{ text: '100 золота', icon: '/img/icons/gold.webp' }] } };
  App.renderPinnedNews();
  const box = document.getElementById('pin-news');
  ok(/Ивент/.test(box.textContent) && !!box.querySelector('#gw-take'), 'плашка с наградой и кнопкой «Забрать» над экраном');
  ok(!!box.querySelector('.gw-item img[src="/img/icons/gold.webp"]'), 'позиции награды показаны картинками');
  let posted = null;
  API.post = async (url, body) => { posted = [url, body]; return { items: App.me.giveaway.items, given: ['🪙 100 золота'] }; };
  App.refreshMe = async () => {};
  App.renderHeader = () => {};
  box.querySelector('#gw-take').click();
  await new Promise((r) => setTimeout(r, 30));
  ok(posted && posted[0] === '/api/giveaway/claim' && posted[1].id === shown.id, 'кнопка забирает именно эту награду');
  ok(!!document.querySelector('#gw-result-close'), 'и показывает окно с тем, что выдали');

  App.me.giveaway = { id: 'd1', title: 'Событие', emoji: '🎁', kind: 'daily', day: 2, daysTotal: 7, canTake: false, nextAt: Date.now() + HOUR, items: [] };
  App.renderPinnedNews();
  const box2 = document.getElementById('pin-news');
  ok(/дня 2 из 7/i.test(box2.textContent) && box2.querySelector('#gw-take').disabled,
     'на дневной раздаче виден номер дня, а кнопка ждёт следующих суток');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
