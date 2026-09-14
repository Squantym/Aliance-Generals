// ═══════════════════════════════════════════════════════════════════
// test/doping_admin.test.js — допинг и эффекты игрока из панели
//
// Владелец попросил две вещи, которых в панели не было: снять с игрока
// эффекты допинга и выдать ему допинг. До этого и то и другое делалось
// только правкой базы руками.
//
// Что стережётся:
//  1. Права: это зона «Ресурсы». Обычный игрок не выдаёт и не снимает.
//  2. Выдача кладёт допинг на СКЛАД (как покупку), а «применить сразу»
//     проводит его тем же путём, что и кнопка игрока, — со всеми
//     проверками.
//  3. Выдать можно только допинг: падлянка бьёт по чужому игроку и на
//     складе не лежит, миной со склада тоже не пользуются.
//  4. Снятие: по ключу уходит ровно один эффект, «снять всё» уносит
//     допинг и падлянки, но НЕ наёмника — он оплачен золотом.
//  5. Адрес размечен зоной и переводится в журнале: без этого правки
//     не видно ни в правах, ни в истории действий.
//
// Запуск: node test/doping_admin.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
process.env.DISABLE_RATE_LIMIT = '1';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const market = require('../dist/src/services/market');
const roles = require('../dist/src/services/roles');
const tr = require('../dist/src/services/logTranslate');
const config = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const fails = (n, fn, part) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};

(async () => {
  await db.init();
  await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1');
  await auth.register('Боец', 'пароль123', 'p@t.ru', 'ru', '2.2.2.2');
  await auth.register('Посторонний', 'пароль123', 's@t.ru', 'ru', '3.3.3.3');
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const owner = by('Хозяин'), target = by('Боец'), stranger = by('Посторонний');
  owner.role = 'owner'; owner.isAdmin = true;
  target.level = 30; target.gold = 0;
  const nx = [];

  console.log('\n[1] Права: зона «Ресурсы»');
  fails('обычный игрок не выдаёт допинг',
    () => market.adminGiveDoping(stranger, { userId: target.id, itemId: 'stim' }, nx), 'прав');
  fails('и не снимает эффекты',
    () => market.adminClearEffects(stranger, { userId: target.id }, nx), 'прав');
  fails('и даже не смотрит',
    () => market.adminDopingView(stranger, target.id), 'прав');
  eq('адрес выдачи размечен зоной', roles.zoneOfPath('/api/admin/doping/give'), 'economy');
  eq('адрес снятия — той же зоной', roles.zoneOfPath('/api/admin/doping/clear'), 'economy');

  console.log('\n[2] Выдача кладёт допинг на склад');
  const r1 = market.adminGiveDoping(owner, { userId: target.id, itemId: 'stim', qty: 3 }, nx);
  eq('на складе три штуки', r1.owned, 3);
  eq('в поле игрока столько же', (target.itemsOwned || {}).stim, 3);
  eq('сразу применять не просили — эффектов нет', target.effects.length, 0);
  ok('в ответе назван игрок', r1.targetName === 'Боец');
  const v1 = market.adminDopingView(owner, target.id);
  const stim = v1.items.find((i) => i.id === 'stim');
  eq('панель показывает склад', stim.owned, 3);
  ok('и название товара', stim.name === config.MARKET_ITEM_BY_ID.stim.name);

  console.log('\n[3] «Применить сразу» проводит допинг обычным путём');
  const atkBefore = player.effMul(target, 'atk_pct');
  const r2 = market.adminGiveDoping(owner, { userId: target.id, itemId: 'stim', qty: 1, apply: true }, nx);
  eq('применена одна штука', r2.applied, 1);
  eq('склад стал прежним: пришла одна, ушла одна', r2.owned, 3);
  ok('эффект на игроке появился', target.effects.some((e) => e.id === 'stim'));
  ok('и он действительно считается в атаке', player.effMul(target, 'atk_pct') > atkBefore);

  // Восстановители на полном ресурсе не тратятся — обычная проверка
  // игрового пути. Панель обязана сказать почему, а не промолчать.
  target.res.en.cur = player.maxima(target).en;
  const before = nx.length;
  const r3 = market.adminGiveDoping(owner, { userId: target.id, itemId: 'energy', qty: 1, apply: true }, nx);
  eq('энергетик применить не вышло', r3.applied, 0);
  eq('но он остался на складе', r3.owned, 1);
  ok('и панель объяснила причину',
     nx.slice(before).some((s) => /Применить не удалось/.test(s) && /полная/i.test(s)));

  console.log('\n[4] Выдать можно только допинг');
  fails('падлянку со склада не выдать',
    () => market.adminGiveDoping(owner, { userId: target.id, itemId: 'sabotage' }, nx), 'не допинг');
  fails('мину тоже',
    () => market.adminGiveDoping(owner, { userId: target.id, itemId: 'landmine' }, nx), 'не допинг');
  fails('и выдуманный товар',
    () => market.adminGiveDoping(owner, { userId: target.id, itemId: 'nope' }, nx), 'не допинг');
  fails('игрока тоже проверяем',
    () => market.adminGiveDoping(owner, { userId: 'нет-такого', itemId: 'stim' }, nx), 'не найден');
  const r4 = market.adminGiveDoping(owner, { userId: target.id, itemId: 'stim', qty: 9999 }, nx);
  eq('за раз выдаётся не больше сотни', r4.owned, 103);

  console.log('\n[5] Снятие эффектов');
  // Собираем игроку полный набор: свой допинг, чужая падлянка, наёмник
  market.pushEffect(target, config.MARKET_ITEM_BY_ID.armor);
  market.pushEffect(target, config.MARKET_ITEM_BY_ID.sabotage, stranger);
  const merc = config.COMMANDERS[0];
  market.applyCommanderEffect(target, merc, Date.now());
  const v2 = market.adminDopingView(owner, target.id);
  const kinds = [...new Set(v2.effects.map((e) => e.kind))].sort().join(',');
  eq('в панели три природы эффектов', kinds, 'doping,hostile,merc');
  eq('у каждого свой ключ', new Set(v2.effects.map((e) => e.key)).size, v2.effects.length);
  const hostile = v2.effects.find((e) => e.kind === 'hostile');
  ok('у падлянки видно, кто наложил', hostile.byName === 'Посторонний');
  ok('и сколько осталось', /мин|ч /.test(hostile.timeLeft));

  const one = v2.effects.find((e) => e.kind === 'doping');
  market.adminClearEffects(owner, { userId: target.id, key: one.key }, nx);
  const v3 = market.adminDopingView(owner, target.id);
  eq('по ключу ушёл ровно один', v3.effects.length, v2.effects.length - 1);
  ok('и это именно он', !v3.effects.some((e) => e.key === one.key));

  const notMerc = v3.effects.filter((e) => e.kind !== 'merc').length;
  const r5 = market.adminClearEffects(owner, { userId: target.id }, nx);
  const v4 = market.adminDopingView(owner, target.id);
  ok('наёмник остался — он оплачен золотом', v4.effects.length > 0);
  ok('и в остатке только наёмник', v4.effects.every((e) => e.kind === 'merc'));
  eq('«снять всё» унесло весь допинг и падлянки', r5.removed, notMerc);
  for (const e of v4.effects) market.adminClearEffects(owner, { userId: target.id, key: e.key }, nx);
  eq('но по крестику снимается и он', market.adminDopingView(owner, target.id).effects.length, 0);
  fails('снимать нечего — так и говорим',
    () => market.adminClearEffects(owner, { userId: target.id }, nx), 'нечего снимать');

  console.log('\n[6] Журнал и панель');
  const give = tr.describe('/api/admin/doping/give',
    { itemId: 'stim', qty: 2, targetName: 'Боец', apply: true });
  ok(`выдача переводится: ${give}`, /Боевой стимулятор/.test(give) && /Боец/.test(give));
  const clr = tr.describe('/api/admin/doping/clear', { targetName: 'Боец' });
  ok(`снятие переводится: ${clr}`, /Снял/.test(clr) && /Боец/.test(clr));
  ok('одиночное снятие отличается от общего',
     tr.describe('/api/admin/doping/clear', { targetName: 'Боец', key: 'stim|atk_pct|0|0' }) !== clr);

  const js = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  ok('раздел живёт внутри формы выдачи — значит есть в обеих панелях',
     js.indexOf('g-dope-wrap') > js.indexOf('renderGrantForm(p, target)'));
  ok('есть кнопка «на склад» и «применить сразу»', /dope-give/.test(js) && /dope-now/.test(js));
  ok('и снятие всего', /dope-clear/.test(js));
  ok('снятие всего спрашивает подтверждение',
     /UI\.confirm\('Снять с игрока весь допинг/.test(js));
  const p2 = fs.readFileSync(path.join(ROOT, 'public/js/admin2/player.js'), 'utf8');
  ok('новая панель зовёт ту же форму', /Admin\.renderGrantForm\(/.test(p2));

  console.log('\n[7] Живой рендер раздела и кнопок');
  let JSDOM = null;
  try { JSDOM = require('jsdom').JSDOM; } catch (e) {}
  if (!JSDOM) {
    console.log('  ⚠ jsdom не установлен — рендер не проверяем');
  } else {
    const dom = new JSDOM('<div id="g-dope"></div>', { url: 'http://localhost/admin', runScripts: 'outside-only' });
    const w = dom.window;
    global.window = w; global.document = w.document; global.location = w.location;
    const posted = [];
    let payload = {
      userId: 'u1', targetName: 'Боец',
      effects: [
        { key: 'stim|atk_pct|0|0', name: 'Боевой стимулятор', desc: '+20% (атака)', kind: 'doping', byName: null, minLeft: 90, timeLeft: '1 ч 30 мин' },
        { key: 'sabotage|atk_pct|1|0', name: 'Саботаж снабжения', desc: '-15% (атака)', kind: 'hostile', byName: 'Посторонний', minLeft: 30, timeLeft: '30 мин' },
        { key: 'cmd_x_atk_pct|atk_pct|0|1', name: 'Барс', desc: '+100% (атака)', kind: 'merc', byName: null, minLeft: 600, timeLeft: '10 ч 0 мин' },
      ],
      items: [{ id: 'stim', name: 'Боевой стимулятор', kind: 'buff', durMin: 120, desc: '+20% (атака)', owned: 2 }],
    };
    const UIStub = { esc: (x) => String(x == null ? '' : x), toast: () => {}, fmtNum: (n) => String(n), confirm: async () => true };
    const APIStub = { token: () => 'x', get: async () => payload, post: async (url, body) => { posted.push([url, body]); return { notices: ['готово'] }; } };
    w.UI = UIStub; w.API = APIStub; global.UI = UIStub; global.API = APIStub;
    eval(js.replace(/^const Admin = /m, 'Admin = '));
    global.Admin = Admin; w.Admin = Admin;

    await Admin.renderDoping('u1');
    const box = w.document.getElementById('g-dope');
    ok('эффекты видны с названием и сроком',
       /Боевой стимулятор/.test(box.innerHTML) && /1 ч 30 мин/.test(box.innerHTML));
    ok('у падлянки подписан автор', /Посторонний/.test(box.innerHTML));
    ok('наёмник помечен отдельно', /наёмник/.test(box.innerHTML));
    eq('крестик у каждого эффекта', box.querySelectorAll('[data-dope-off]').length, 3);

    await box.querySelector('[data-dope-off]').onclick();
    eq('крестик шлёт снятие', posted[0][0], '/api/admin/doping/clear');
    eq('и именно тот ключ, что показан', posted[0][1].key, 'stim|atk_pct|0|0');

    posted.length = 0;
    await w.document.getElementById('dope-clear').onclick();
    eq('«снять всё» идёт без ключа', posted[0][1].key, undefined);

    posted.length = 0;
    w.document.getElementById('dope-qty').value = '5';
    await w.document.getElementById('dope-give').onclick();
    eq('«на склад» шлёт выдачу', posted[0][0], '/api/admin/doping/give');
    eq('с выбранным товаром', posted[0][1].itemId, 'stim');
    eq('и указанным количеством', posted[0][1].qty, '5');
    ok('без применения', !posted[0][1].apply);

    posted.length = 0;
    await w.document.getElementById('dope-now').onclick();
    ok('«применить сразу» помечает выдачу', posted[0][1].apply === true);

    // Если действует только наёмник, кнопки «снять всё» быть не должно:
    // она его не снимает, и нажимать её было бы не за чем
    payload = { ...payload, effects: [payload.effects[2]] };
    await Admin.renderDoping('u1');
    ok('при одном наёмнике общего снятия нет', !w.document.getElementById('dope-clear'));
  }

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
