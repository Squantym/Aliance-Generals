// ═══════════════════════════════════════════════════════════════════
// test/newsrights.test.js — новостями управляет тот, кому выдан раздел
//
// ЧТО БЫЛО. Владелец выдавал сотруднику роль и раздел «Новости», а тот
// всё равно получал «Только для администратора». Причина: сервис
// новостей проверял СТАРОЕ поле user.isAdmin, которого у сотрудника с
// ролью нет — роль лежит в user.role. Настройка прав и проверка прав
// жили в разных мирах.
//
// Заодно выяснилось, что адреса /api/news/* вообще не были размечены по
// зонам: общий контроль доступа считал их владельческими, а проверка
// полноты разметки их не видела — она смотрела только /api/admin,
// /api/staff и /api/mod.
//
// Здесь проверяется весь путь: разметка адреса → общий контроль →
// проверка внутри сервиса → кнопки в интерфейсе.
//
// Запуск: node test/newsrights.test.js  (после npm run build)
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
const roles = require('../dist/src/services/roles');
const news = require('../dist/src/services/news');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const denied = (n, fn) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && /Недостаточно прав/i.test(msg), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};

(async () => {
  await db.init();
  await auth.register('Хозяин', 'пароль123', 'o@t.ru', 'ru', '1.1.1.1');
  await auth.register('Сотрудник', 'пароль123', 'a@t.ru', 'ru', '1.1.1.2');
  await auth.register('Прохожий', 'пароль123', 'p@t.ru', 'ru', '1.1.1.3');
  const O = Object.values(player.users()).find((x) => x.name === 'Хозяин');
  const A = Object.values(player.users()).find((x) => x.name === 'Сотрудник');
  const P = Object.values(player.users()).find((x) => x.name === 'Прохожий');
  O.role = 'owner'; A.role = 'admin';
  const nx = [];
  const zonesBox = db.load('roleZones', {});
  const setAdminZones = (list) => { zonesBox.admin = list; };
  const post = () => ({ title: 'Обновление', blocks: [{ type: 'text', text: 'Что нового' }] });

  console.log('\n[1] Адрес новостей размечен зоной');
  // Неразмеченный адрес считается владельческим — сотрудник не пройдёт
  // даже с выданным разделом.
  for (const p of ['/api/news/create', '/api/news/update', '/api/news/delete', '/api/news/pin']) {
    eq(`${p} → зона «Новости»`, roles.zoneOfPath(p), 'news');
  }
  eq('чтение новостей зоны не требует', roles.zoneOfPath('/api/news'), null);
  // Тот же класс ошибки был у админских ручек легиона вне /api/admin
  eq('/api/legion/admin-join → зона «Легионы»', roles.zoneOfPath('/api/legion/admin-join'), 'legions');
  eq('/api/legion/admin-deposit → она же', roles.zoneOfPath('/api/legion/admin-deposit'), 'legions');

  console.log('\n[2] Без выданного раздела — отказ');
  setAdminZones([]);
  eq('у сотрудника нет разделов', roles.zonesFor(A).length, 0);
  denied('создать новость нельзя', () => news.create(A, post(), nx));
  denied('и удалить нельзя', () => news.remove(A, 'нет-такой', nx));
  eq('и кнопок управления ему не показывают', news.list(A).canManage, false);
  eq('обычному игроку тем более', news.list(P).canManage, false);
  ok('но читать новости может кто угодно', Array.isArray(news.list(P).posts));

  console.log('\n[3] Раздел выдан — сотрудник работает');
  setAdminZones(['news']);
  eq('раздел появился', roles.zonesFor(A).join(), 'news');
  eq('и доступ по зоне открыт', roles.canAccessZone(A, 'news'), true);
  const created = news.create(A, post(), nx);
  const id = created.id || (created.post && created.post.id);
  ok('новость создана', !!id);
  eq('кнопки управления показываются', news.list(A).canManage, true);
  news.update(A, id, { title: 'Обновление 2' }, nx);
  eq('заголовок изменён', news.list(A).posts.find((x) => x.id === id).title, 'Обновление 2');
  const pinned = news.togglePin(A, id, nx);
  eq('закрепление работает', pinned.pinned, true);
  news.remove(A, id, nx);
  ok('и удаление тоже', !news.list(A).posts.some((x) => x.id === id));

  console.log('\n[4] Соседний раздел прав на новости не даёт');
  setAdminZones(['players', 'chat']);
  denied('с чужими разделами создать нельзя', () => news.create(A, post(), nx));
  eq('и кнопок нет', news.list(A).canManage, false);

  console.log('\n[5] Владельцу открыто всегда');
  setAdminZones([]);
  const own = news.create(O, post(), nx);
  ok('владелец создаёт новость без настроек', !!(own.id || (own.post && own.post.id)));
  eq('и кнопки у него есть', news.list(O).canManage, true);

  console.log('\n[6] Тот же порядок — у остальных служебных действий');
  // Раньше эти проверки тоже смотрели на старое поле isAdmin, и раздел,
  // выданный владельцем, ничего не решал.
  const legion = require('../dist/src/services/legion');
  const groups = require('../dist/src/services/groups');
  const market = require('../dist/src/services/market');
  const push = require('../dist/src/services/push');
  setAdminZones([]);
  denied('легион: пополнение казны', () => legion.adminDeposit(A, 'x', 100, nx));
  denied('объединения: добавить игрока', () => groups.adminJoin(A, 'legion', 'x', nx));
  denied('наёмники: выдать', () => market.adminGrantCommander(A, 'x', 'y', nx));
  // broadcast асинхронный: отказ прилетает отклонённым промисом, а не
  // броском на месте — синхронная проверка его бы не увидела.
  let pushMsg = null;
  try { await push.broadcast(A, 'т', 'т', nx); } catch (e) { pushMsg = String(e.message); }
  ok('рассылка уведомлений', !!pushMsg && /Недостаточно прав/.test(pushMsg));
  // А с нужными разделами отказ должен быть уже ПО СУЩЕСТВУ, а не по правам
  setAdminZones(['legions', 'economy', 'support']);
  let byRights = false;
  try { legion.adminDeposit(A, 'нет-такого', 100, nx); } catch (e) { byRights = /Недостаточно прав/.test(e.message); }
  ok('с разделом «Легионы» отказ уже не про права', !byRights);

  console.log('\n[7] Интерфейс открывает редактор по разделу, а не по флагу');
  const src = fs.readFileSync(path.join(ROOT, 'public/js/screens/news.js'), 'utf8');
  ok('экран смотрит на выданные разделы', /staffZones/.test(src));
  ok('и не проверяет старое поле isAdmin', !/App\.me\.isAdmin/.test(src));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
