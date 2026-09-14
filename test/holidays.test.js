// ═══════════════════════════════════════════════════════════════════
// test/holidays.test.js — праздники и акции по расписанию
//
// Владелец просил раздел, где праздник заводится заранее: начало, конец,
// тип акции и отложенный старт, а мир включает всё сам. Значит проверять
// нужно не форму, а расписание: включилось ли вовремя, не включилось ли
// дважды, что будет, если срок прошёл мимо стоящего сервера.
//
// Что стережётся:
//  1. Права: зона «Акции». Посторонний не заводит и не удаляет.
//  2. Проверки на входе: без названия, задом наперёд, акция без типа,
//     скидка без категории, новость без текста — отказ с внятным текстом.
//  3. Акция вне периода праздника прижимается к нему.
//  4. Тик включает то, чему пришло время, и НЕ включает будущее.
//  5. Скидка и бонус получают точное окно и гаснут сами — выключать их
//     тиком нельзя, тик может не состояться.
//  6. Дважды одна акция не включается, а пропущенная целиком помечается
//     «не состоялась», а не включается задним числом.
//  7. Выключенный праздник не срабатывает.
//  8. Правка сработавшей акции возвращает её в очередь.
//
// Запуск: node test/holidays.test.js   (после npm run build)
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
const holidays = require('../dist/src/services/holidays');
const discounts = require('../dist/src/services/discounts');
const buffs = require('../dist/src/services/globalBuffs');
const giveaways = require('../dist/src/services/giveaways');
const news = require('../dist/src/services/news');
const roles = require('../dist/src/services/roles');
const tr = require('../dist/src/services/logTranslate');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const fails = (n, fn, part) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};

const MIN = 60 * 1000, HOUR = 60 * MIN;

(async () => {
  await db.init();
  await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1');
  await auth.register('Посторонний', 'пароль123', 's@t.ru', 'ru', '2.2.2.2');
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const owner = by('Хозяин'), stranger = by('Посторонний');
  owner.role = 'owner'; owner.isAdmin = true;
  const nx = [];

  console.log('\n[1] Права: зона «Акции»');
  fails('посторонний не видит расписания', () => holidays.adminList(stranger), 'прав');
  fails('и не заводит праздник',
    () => holidays.adminSave(stranger, { name: 'Свой', startAt: Date.now(), endAt: Date.now() + HOUR }, nx), 'прав');
  eq('адрес сохранения размечен зоной', roles.zoneOfPath('/api/admin/holiday/save'), 'discounts');
  eq('адрес списка — той же зоной', roles.zoneOfPath('/api/admin/holidays'), 'discounts');
  eq('и выключатель тоже', roles.zoneOfPath('/api/admin/holiday/toggle'), 'discounts');

  console.log('\n[2] Проверки на входе');
  const now = Date.now();
  fails('без названия нельзя',
    () => holidays.adminSave(owner, { name: '  ', startAt: now, endAt: now + HOUR }, nx), 'Назовите');
  fails('без дат нельзя',
    () => holidays.adminSave(owner, { name: 'Пустой' }, nx), 'начало и конец');
  fails('задом наперёд нельзя',
    () => holidays.adminSave(owner, { name: 'Задом', startAt: now + HOUR, endAt: now }, nx), 'раньше');
  fails('акция без типа — отказ',
    () => holidays.adminSave(owner, { name: 'X', startAt: now, endAt: now + HOUR, promos: [{}] }, nx), 'не указан тип');
  fails('скидка без категории — отказ',
    () => holidays.adminSave(owner, { name: 'X', startAt: now, endAt: now + HOUR,
      promos: [{ type: 'discount', pct: 20, category: 'выдумка' }] }, nx), 'категория');
  fails('скидка без процента — отказ',
    () => holidays.adminSave(owner, { name: 'X', startAt: now, endAt: now + HOUR,
      promos: [{ type: 'discount', category: 'unit', pct: 0 }] }, nx), 'процент');
  fails('новость без текста — отказ',
    () => holidays.adminSave(owner, { name: 'X', startAt: now, endAt: now + HOUR,
      promos: [{ type: 'news', title: 'Только заголовок' }] }, nx), 'заголовок и текст');
  fails('раздача, которой нет — отказ',
    () => holidays.adminSave(owner, { name: 'X', startAt: now, endAt: now + HOUR,
      promos: [{ type: 'giveaway', giveawayId: 'нет-такой' }] }, nx), 'Выберите раздачу');

  console.log('\n[3] Акция не выходит за границы праздника');
  const hStart = now + 2 * HOUR, hEnd = now + 6 * HOUR;
  holidays.adminSave(owner, {
    name: 'Границы', startAt: hStart, endAt: hEnd,
    promos: [{ type: 'xp', pct: 50, startAt: now - 10 * HOUR, endAt: now + 99 * HOUR }],
  }, nx);
  const bound = holidays.adminList(owner).holidays.find((h) => h.name === 'Границы');
  eq('начало акции прижато к началу праздника', bound.promos[0].startAt, hStart);
  eq('а конец — к его концу', bound.promos[0].endAt, hEnd);
  eq('пока не время — акция ждёт', bound.promos[0].state, 'wait');

  console.log('\n[4] Тик включает то, чему пришло время');
  // Раздача, чтобы было что включать третьим типом
  giveaways.adminSave(owner, {
    title: 'Новогодний паёк', kind: 'once', items: [{ type: 'gold', qty: 100 }],
    endAt: now + 999 * HOUR, enabled: false,
  }, nx);
  const givId = giveaways.listBrief()[0].id;

  const from = now - MIN, to = now + 3 * HOUR;
  holidays.adminSave(owner, {
    name: 'Новогодние каникулы', note: 'проверка расписания',
    startAt: from, endAt: to,
    promos: [
      { type: 'discount', category: 'unit', pct: 30, startAt: from, endAt: to },
      { type: 'xp', pct: 100, startAt: from, endAt: to },
      { type: 'giveaway', giveawayId: givId, startAt: from, endAt: to },
      { type: 'news', title: 'С Новым годом!', text: 'Скидки и двойной опыт всю неделю.', pinned: true },
      // Отложенный старт: эта акция сегодня ещё не должна включиться
      { type: 'discount', category: 'container', pct: 50, startAt: now + 2 * HOUR, endAt: to },
    ],
  }, nx);

  eq('до тика скидки нет', discounts.pctOf('unit'), 0);
  const fired = holidays.tick();
  eq('включились четыре акции из пяти', fired, 4);
  eq('скидка на технику действует', discounts.pctOf('unit'), 30);
  ok('бонус опыта действует', buffs.multiplier('xp') === 2);
  ok('раздача включена', giveaways.adminList(owner).giveaways.some((g) => g.id === givId && g.live));
  ok('новость опубликована', news.list(owner).posts.some((p) => p.title === 'С Новым годом!'));
  eq('отложенная акция всё ещё ждёт', discounts.pctOf('container'), 0);

  console.log('\n[5] Скидке и бонусу отдано точное окно — гаснут сами');
  const sch = discounts.allScheduled().find((d) => d.category === 'unit');
  eq('у скидки конец ровно как у акции', sch.expires, to);
  const xp = buffs.listActive().find((b) => b.key === 'xp');
  eq('у бонуса опыта тоже', xp.expiresAt, to);
  const gw = giveaways.adminList(owner).giveaways.find((g) => g.id === givId);
  eq('и у раздачи окно от праздника', gw.endAt, to);

  console.log('\n[6] Дважды не включаем, пропущенное не догоняем');
  discounts.set('unit', 0, 0);                 // как будто скидку сняли руками
  eq('скидка снята', discounts.pctOf('unit'), 0);
  eq('повторный тик ничего не включает', holidays.tick(), 0);
  eq('и скидка не вернулась', discounts.pctOf('unit'), 0);

  holidays.adminSave(owner, {
    name: 'Прошедший', startAt: now - 10 * HOUR, endAt: now - HOUR,
    promos: [{ type: 'discount', category: 'trophy', pct: 40 }],
  }, nx);
  eq('пропущенная акция не включается', holidays.tick(), 0);
  eq('и скидки от неё нет', discounts.pctOf('trophy'), 0);
  const missed = holidays.adminList(owner).holidays.find((h) => h.name === 'Прошедший');
  eq('она помечена «не состоялась»', missed.promos[0].state, 'missed');

  console.log('\n[7] Выключенный праздник не срабатывает');
  const off = holidays.adminSave(owner, {
    name: 'Выключенный', startAt: now - MIN, endAt: now + HOUR, enabled: false,
    promos: [{ type: 'discount', category: 'mine', pct: 25 }],
  }, nx).holidays.find((h) => h.name === 'Выключенный');
  eq('в списке он помечен выключенным', off.status, 'off');
  eq('тик его не трогает', holidays.tick(), 0);
  eq('скидки нет', discounts.pctOf('mine'), 0);
  holidays.adminToggle(owner, off.id, true, nx);
  eq('включили — акция пошла', holidays.tick(), 1);
  eq('и скидка появилась', discounts.pctOf('mine'), 25);

  console.log('\n[8] Правка сработавшей акции ставит её обратно в очередь');
  const live = holidays.adminList(owner).holidays.find((h) => h.name === 'Выключенный');
  eq('акция отмечена сработавшей', live.promos[0].state, 'live');
  holidays.adminSave(owner, {
    id: live.id, name: live.name, startAt: live.startAt, endAt: live.endAt, enabled: true,
    promos: [{ id: live.promos[0].id, type: 'discount', category: 'mine', pct: 60,
      startAt: live.promos[0].startAt, endAt: live.promos[0].endAt }],
  }, nx);
  const again = holidays.adminList(owner).holidays.find((h) => h.id === live.id);
  eq('после правки процента акция снова ждёт', again.promos[0].state, 'wait');
  holidays.tick();
  eq('и на следующем тике встала новая скидка', discounts.pctOf('mine'), 60);
  // Правка названия праздника не должна перезапускать акции
  holidays.adminSave(owner, {
    id: live.id, name: 'Переименованный', startAt: live.startAt, endAt: live.endAt, enabled: true,
    promos: [{ id: live.promos[0].id, type: 'discount', category: 'mine', pct: 60,
      startAt: live.promos[0].startAt, endAt: live.promos[0].endAt }],
  }, nx);
  const renamed = holidays.adminList(owner).holidays.find((h) => h.id === live.id);
  eq('акция осталась сработавшей', renamed.promos[0].state, 'live');

  console.log('\n[9] Удаление и журнал');
  holidays.adminRemove(owner, missed.id, nx);
  ok('праздник убран из расписания',
     !holidays.adminList(owner).holidays.some((h) => h.id === missed.id));
  fails('удалять дважды нечего', () => holidays.adminRemove(owner, missed.id, nx), 'не найден');
  const s1 = tr.describe('/api/admin/holiday/save', { name: 'Новый год', promos: [1, 2] });
  ok(`создание переводится: ${s1}`, /Новый год/.test(s1) && /Создал/.test(s1));
  const s2 = tr.describe('/api/admin/holiday/toggle', { on: false });
  ok(`выключатель переводится: ${s2}`, /Выключил/.test(s2));
  ok('удаление переводится', /Удалил/.test(tr.describe('/api/admin/holiday/delete', { id: 'x' })));

  console.log('\n[10] Мир зовёт расписание сам');
  const wt = fs.readFileSync(path.join(ROOT, 'src/services/worldTick.ts'), 'utf8');
  ok('тик зовёт праздники', /require\('\.\/holidays'\)\.tick\(\)/.test(wt));
  const houseAt = wt.indexOf('function houseTick');
  const callAt = wt.indexOf("require('./holidays').tick()");
  ok('и зовёт в хозяйственной половине — она идёт и при закрытой игре',
     callAt > houseAt && callAt < wt.indexOf('function frozen'));
  const econ = fs.readFileSync(path.join(ROOT, 'public/js/admin2/econ.js'), 'utf8');
  ok('в панели есть подвкладка «Праздники»', /id: 'holidays'.*renderHolidays/.test(econ));
  ok('в форме есть выбор типа акции', /hd-type/.test(econ));
  ok('и свои даты у акции', /hd-start/.test(econ) && /hd-end/.test(econ));
  const old = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  ok('подвкладка есть и в старом списке — панели не разошлись', /id: 'holidays'/.test(old));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
