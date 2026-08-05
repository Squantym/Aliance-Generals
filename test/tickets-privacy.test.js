// ═══════════════════════════════════════════════════════════════════
// Закрепление обращений: взятое в работу видно только тому, кто взял,
// и владельцу. Плюс журнал действий сотрудников и меры к персоналу.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-tick-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
// Чистим настройку прав: она хранится в базе и иначе перетекала бы
// между прогонами тестов
try { const dbz = require(ROOT + '/dist/src/core/db'); const z = dbz.load('roleZones', {}); for (const k of Object.keys(z)) delete z[k]; dbz.save('roleZones'); } catch (e) {}
const support = require(ROOT + '/dist/src/services/support');

async function main() {
for (const [n, e] of [['Хозяин','o@t.ru'],['Первый','a1@t.ru'],['Второй','a2@t.ru'],['Игрок','p@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const own = by('Хозяин'), a1 = by('Первый'), a2 = by('Второй'), pl = by('Игрок');
own.role = 'owner'; own.isAdmin = true;
roles.setRole(own, a1.id, 'admin', []);
roles.setRole(own, a2.id, 'admin', []);

// Роли больше не дают прав сами по себе — выдаём их явно, как это
// делает владелец во вкладке «Роли»
const ALL_Z = ['players','chat','moderation','security','support','legions','news','event','roles','economy','discounts','season'];
const grantAll = (role) => { for (const z of ALL_Z) { try { roles.setRoleZone(own, role, z, true, []); } catch (e) {} } };
grantAll('admin'); grantAll('moderator'); grantAll('arbiter'); grantAll('commissar');

console.log('\n── 1. Свободное обращение видят все сотрудники ──');
support.createTicket(pl, 'other', 'Не приходит награда', 'Помогите', []);
const t1 = support.adminList({ status: 'open' }, a1).tickets[0];
ok(!!t1, `обращение создано: «${t1.subject}»`);
ok(t1.free === true, 'помечено как свободное');
ok(support.adminList({ status: 'open' }, a2).tickets.length === 1, 'второй сотрудник тоже его видит');

console.log('\n── 2. Взятое в работу закрепляется ──');
const n1 = [];
support.claim(a1, t1.id, n1);
const mine = support.adminList({ status: 'open' }, a1).tickets;
ok(mine.length === 1 && mine[0].mine === true, 'у взявшего обращение помечено как своё');
ok(mine[0].assignedName === 'Первый', `указан исполнитель: ${mine[0].assignedName}`);
ok(/взято в работу/i.test(n1[0]), `сообщение: «${n1[0]}»`);

console.log('\n── 3. Чужое обращение НЕ видно второму сотруднику ──');
const forSecond = support.adminList({ status: 'open' }, a2).tickets;
ok(forSecond.length === 0, 'второй сотрудник обращения больше не видит');
ok(support.adminList({ status: 'all' }, a2).tickets.length === 0, 'и в списке «все» тоже');
fails(() => support.claim(a2, t1.id, []), 'уже взял в работу', 'перехватить обращение нельзя');
fails(() => support.adminReply(a2, t1.id, 'мой ответ', false, []), 'в работе у сотрудника',
      'ответить на чужое обращение нельзя');

console.log('\n── 4. Владелец видит всё ──');
const forOwner = support.adminList({ status: 'all' }, own).tickets;
ok(forOwner.length === 1, 'владельцу видно чужое обращение');
ok(forOwner[0].assignedName === 'Первый', 'с пометкой, кто им занимается');
support.adminReply(own, t1.id, 'ответ владельца', false, []);
ok(true, 'и он может ответить на любое');

console.log('\n── 5. Переписка остаётся у исполнителя ──');
support.adminReply(a1, t1.id, 'разбираюсь', false, []);
const closed1 = support.adminList({ status: 'all' }, a1).tickets[0];
ok(closed1.messages.length >= 3, `в переписке ${closed1.messages.length} сообщения`);
ok(support.adminList({ status: 'all' }, a2).tickets.length === 0,
   'второй сотрудник переписку не видит даже после ответов');

console.log('\n── 6. Закрытое обращение тоже скрыто от чужих ──');
support.adminReply(a1, t1.id, 'решено', true, []);
ok(support.adminList({ status: 'closed' }, a1).tickets.length === 1, 'исполнитель видит своё закрытое');
ok(support.adminList({ status: 'closed' }, a2).tickets.length === 0, 'чужое закрытое не видно');
ok(support.adminList({ status: 'closed' }, own).tickets.length === 1, 'владельцу видно всегда');

console.log('\n── 7. Возврат в очередь ──');
support.createTicket(pl, 'other', 'Второй вопрос', 'Текст', []);
const t2 = support.adminList({ status: 'open' }, a1).tickets[0];
support.claim(a1, t2.id, []);
fails(() => support.release(a2, t2.id, []), 'только владелец', 'чужое обращение вернуть нельзя');
const n2 = [];
support.release(a1, t2.id, n2);
ok(support.adminList({ status: 'open' }, a2).tickets.length === 1, 'после возврата обращение снова у всех');
support.claim(a2, t2.id, []);
const n3 = [];
support.release(own, t2.id, n3);
ok(support.adminList({ status: 'open' }, a1).tickets.length === 1, 'владелец может вернуть чужое');

console.log('\n── 8. Ответ на свободное закрепляет его ──');
const t3 = support.adminList({ status: 'open' }, a1).tickets[0];
support.adminReply(a1, t3.id, 'беру и отвечаю', false, []);
const after = support.adminList({ status: 'open' }, a1).tickets[0];
ok(after.mine === true, 'обращение автоматически закрепилось за ответившим');
ok(support.adminList({ status: 'open' }, a2).tickets.length === 0, 'и скрылось от остальных');

console.log('\n── 9. Журнал действий сотрудников ──');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
ok(/\/api\/admin\/staff-log/.test(routes), 'есть роут журнала');
const logBlock = routes.slice(routes.indexOf("'/api/admin/staff-log'"), routes.indexOf('БАЗА ДАННЫХ'));
ok(/isOwner\(req\.user\)\) throw new u\.ApiError\('Только для владельца'\)/.test(logBlock),
   'журнал доступен только владельцу');
ok(/staffIds\.has\(l\.userId\)/.test(logBlock), 'показываются действия именно сотрудников');
ok(/req\.query\.userId/.test(logBlock), 'можно отфильтровать по одному сотруднику');
const adminJs = fs.readFileSync(ROOT + '/public/js/admin.js', 'utf8');
ok(/Журнал действий сотрудников/.test(adminJs), 'блок журнала есть во вкладке «Роли»');
ok(/data-staff-log/.test(adminJs), 'журнал открывается кнопкой у каждого сотрудника');
ok(/сотрудники чужой журнал не видят/.test(adminJs), 'в интерфейсе объяснено назначение');

console.log('\n── 10. Меры к сотрудникам ──');
ok(/data-staff-ban/.test(adminJs), 'у владельца есть кнопка блокировки сотрудника');
ok(/s\.role !== 'owner' && iAmOwner/.test(adminJs), 'кнопки видны только владельцу и не для владельца');
// Владелец действительно может забанить сотрудника
const n4 = [];
roles.banAccount(own, a2.id, 60, 'Злоупотребление правами', n4);
ok(a2.banned === true, 'владелец заблокировал администратора');
roles.unbanAccount(own, a2.id, []);
fails(() => roles.banAccount(a1, a2.id, 60, 'x', []), 'сотрудника проекта',
      'администратор другого администратора забанить не может');

console.log('\n── 11. Кнопки по правам во вкладке «Игроки» ──');
ok(/Admin\.can\('economy'\) \? `<button class="btn btn-orange btn-inline" data-pick=/.test(adminJs),
   'кнопка «Выдать» — только с правом на ресурсы');
ok(/Admin\.can\('moderation'\)\) \? `<button class="btn btn-inline" data-ban=/.test(adminJs),
   'кнопка бана — только с правом модерации');
ok(/Admin\.can\('security'\)\) \? `<button class="btn btn-inline" data-reset=/.test(adminJs),
   'кнопка обнуления — только с правом безопасности');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
