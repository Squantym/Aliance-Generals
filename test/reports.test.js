// ═══════════════════════════════════════════════════════════════════
// Жалобы на игроков: приём, защита от заваливания, очередь по
// нарушителю, решения и обратная связь жалобщику.
// Отдельно проверяем главное: система НИКОГО не наказывает сама.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-reports-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const boom = async (fn, re, name) => {
  try { await fn(); failed++; console.log('  ❌ ' + name + ' — ошибки не было'); }
  catch (e) { if (re.test(e.message)) { passed++; console.log('  ✅ ' + name); }
              else { failed++; console.log(`  ❌ ${name} — не та ошибка: «${e.message}»`); } }
};

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const notif = require(ROOT + '/dist/src/services/notifications');
const rep = require(ROOT + '/dist/src/services/reports');
const db = require(ROOT + '/dist/src/core/db');

async function main() {
const N = [];
for (const [n, e] of [['Жалобщик', 'a@t.ru'], ['Нарушитель', 'b@t.ru'], ['Свидетель', 'c@t.ru'],
                      ['Третий', 'd@t.ru'], ['Новичок', 'e@t.ru'], ['Дозорный', 'm@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const me = by('Жалобщик'), bad = by('Нарушитель'), wit = by('Свидетель'),
      third = by('Третий'), noob = by('Новичок'), mod = by('Дозорный');
for (const p of [me, bad, wit, third, mod]) p.level = 10;
noob.level = 1;
mod.role = 'owner';
const n = () => { const a = []; a.push = Array.prototype.push.bind(a); return a; };

console.log('\n── 1. Приём жалобы ──');
const notices = [];
const r1 = rep.create(me, bad.id, 'insult', 'Написал в чате мат в мой адрес после боя', 'chat', notices);
ok(r1.ok, 'жалоба принята');
ok(r1.left === rep.DAY_LIMIT - 1, `остаток на сутки: ${r1.left} из ${rep.DAY_LIMIT}`);
ok(notices.some((s) => /Жалоба отправлена/.test(s)), 'игроку сказали, что дальше будет');

console.log('\n── 2. Защита от злоупотребления ──');
await boom(() => rep.create(me, me.id, 'other', 'сам на себя жалуюсь', 'profile', []),
           /На себя/, 'на себя пожаловаться нельзя');
await boom(() => rep.create(me, bad.id, 'spam', 'опять он что-то делает', 'chat', []),
           /уже жаловались.*через \d+ ч/, 'повторно на того же — только после паузы');
await boom(() => rep.create(me, wit.id, 'other', 'плохой', 'profile', []),
           /10 символов/, 'жалоба без описания не принимается');
await boom(() => rep.create(noob, bad.id, 'cheat', 'он читер, я точно видел это', 'profile', []),
           new RegExp(`с ${rep.MIN_LEVEL} уровня`), 'свежесозданный аккаунт жаловаться не может');
await boom(() => rep.create(me, 'нет-такого', 'other', 'жалуюсь на пустоту, честно', 'profile', []),
           /не найден/, 'жалоба на несуществующего игрока отклонена');

// Дневной лимит: у «Жалобщика» уже 1, добираем до потолка на разных целях
for (const t of [wit, third, noob]) rep.create(me, t.id, 'spam', 'Заваливает общий чат рекламой', 'chat', []);
ok(true, `подано жалоб подряд: ${rep.mine(me).list.length}`);
rep.create(me, mod.id, 'other', 'Проверка дневного лимита жалоб', 'profile', []);
await boom(() => rep.create(me, bad.id, 'cheat', 'ещё одна жалоба сверх лимита', 'profile', []),
           new RegExp(`Не больше ${rep.DAY_LIMIT} жалоб`), 'дневной лимит держится');
ok(rep.mine(me).left === 0, 'остаток жалоб на сутки показан как 0');

console.log('\n── 3. Очередь сгруппирована по нарушителю ──');
rep.create(wit, bad.id, 'insult', 'Оскорблял меня в чате легиона весь вечер', 'chat', []);
rep.create(third, bad.id, 'cheat', 'У него деньги растут без боёв, это накрутка', 'profile', []);
const q = rep.queue('new', 50);
const g = q.groups.find((x) => x.targetId === bad.id);
ok(!!g, 'группа по нарушителю найдена');
ok(g.total === 3 && g.uniqueReporters === 3, `жалоб ${g.total} от ${g.uniqueReporters} разных игроков`);
ok(q.groups[0].targetId === bad.id, 'самый «популярный» нарушитель — сверху');
ok(g.reports[0].at >= g.reports[g.reports.length - 1].at, 'внутри группы новые сверху');
ok(g.reports.every((x) => x.text && x.fromName), 'у каждой жалобы есть автор и текст');
ok(/Оскорбления/.test(g.reports.map((x) => x.reason).join()), 'причина показана словами, а не кодом');
ok(/из чата|из профиля/.test(g.reports.map((x) => x.where).join()), 'указано, откуда пожаловались');
ok(g.level === 10 && g.exists === true, 'видно уровень и что аккаунт жив');
ok(q.counts.new === 7, `новых жалоб всего: ${q.counts.new}`);

console.log('\n── 4. Решение по жалобе + обратная связь ──');
const target = g.reports.find((x) => x.fromName === 'Свидетель');
const nn = [];
rep.resolve(mod, target.id, true, 'Проверили логи чата — подтвердилось', nn);
ok(nn.some((s) => /подтверждена/.test(s)), 'сотруднику показан результат');
const msgs = notif.list(wit).notifications;
ok(msgs.some((x) => /жалоба подтвердилась/i.test(x.title)), 'жалобщик получил уведомление');
ok(msgs.some((x) => /Проверили логи/.test(JSON.stringify(x.payload || {}))), 'и комментарий сотрудника');
await boom(() => rep.resolve(mod, target.id, true, '', []), /уже есть решение/,
           'повторно решить ту же жалобу нельзя');
await boom(() => rep.resolve(mod, 'нет-такой', true, '', []), /не найдена/, 'несуществующая жалоба');

console.log('\n── 5. Отклонение видно в репутации жалобщика ──');
const q2 = rep.queue('all', 50);
const g2 = q2.groups.find((x) => x.targetId === bad.id);
const fromMe = g2.reports.find((x) => x.fromName === 'Жалобщик');
rep.resolve(mod, fromMe.id, false, 'Записей в чате не нашли', []);
const spam = rep.queue('all', 50).groups
  .flatMap((x) => x.reports).filter((x) => x.fromName === 'Жалобщик');
ok(spam.every((x) => x.rejectedByAuthor === 1), 'у автора отклонённой жалобы счётчик вырос');
ok(rep.mine(me).list.some((x) => x.status === 'rejected' && /не нашли/.test(x.verdict)),
   'жалобщик видит, что его жалобу отклонили и почему');

console.log('\n── 6. Разобрать всё по одному игроку ──');
const left = rep.queue('new', 50).groups.find((x) => x.targetId === bad.id);
ok(left.reports.filter((x) => x.status === 'new').length === 1, 'осталась одна новая');
const nAll = [];
const res = rep.resolveAll(mod, bad.id, false, 'Массовая жалоба от друзей, не подтвердилось', nAll);
ok(res.count === 1, `разобрано разом: ${res.count}`);
ok(!rep.queue('new', 50).groups.some((x) => x.targetId === bad.id), 'нарушитель ушёл из очереди новых');
await boom(() => rep.resolveAll(mod, bad.id, false, '', []), /Новых жалоб.*нет/,
           'повторный вызов на пустой группе — понятная ошибка');

console.log('\n── 7. Счётчик для значка на вкладке ──');
ok(rep.pendingCount() === rep.queue('new', 200).counts.new, 'счётчик совпадает с очередью');
ok(typeof rep.pendingCount() === 'number', 'счётчик — число');

console.log('\n── 8. Никаких автоматических наказаний ──');
const src = fs.readFileSync(path.join(ROOT, 'src/services/reports.ts'), 'utf8');
ok(!/\.banned\s*=|banUntil\s*=|chatBan\s*=/.test(src), 'сервис не выдаёт баны сам');
ok(!bad.banned && !bad.chatBan, 'на нарушителя с тремя жалобами санкций не наложено');
ok(/НИКАКИХ АВТОМАТИЧЕСКИХ САНКЦИЙ/.test(src), 'намерение записано в коде');
ok(/скоординированными жалобами/.test(src), 'объяснено, почему автобан опасен');

console.log('\n── 9. Данные переживают перезапуск ──');
db.save('reports');
const raw = db.load('reports', {});
ok(Object.keys(raw).length === 7, `в базе жалоб: ${Object.keys(raw).length}`);
ok(Object.values(raw).every((r) => r.id && r.at && r.fromId && r.targetId), 'у каждой записи полный набор полей');

console.log('\n── 10. Маршруты закрыты правами ──');
const rt = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
const i = rt.indexOf("'/api/mod/reports'");
ok(i > 0, 'маршрут очереди есть');
ok(/canAccessZone\(req\.user, 'moderation'\)/.test(rt.slice(i, i + 300)), 'очередь требует зону «Баны аккаунтов»');
ok(/'\/api\/reports\/create'/.test(rt), 'маршрут подачи жалобы есть');
const j = rt.indexOf("'/api/mod/report/resolve'");
ok(/canAccessZone\(req\.user, 'moderation'\)/.test(rt.slice(j, j + 300)), 'решение тоже под правами');
const roles = require(ROOT + '/dist/src/services/roles');
ok(roles.zoneOfPath('/api/mod/reports') === 'moderation', 'адрес размечен зоной');

console.log('\n── 11. Журнал показывает действия по-русски ──');
const tr = require(ROOT + '/dist/src/services/logTranslate');
ok(/Пожаловался на игрока/.test(tr.describe('/api/reports/create', { targetName: 'Нарушитель' })),
   'подача жалобы переведена');
ok(/Подтвердил жалобу/.test(tr.describe('/api/mod/report/resolve', { accept: true })), 'подтверждение переведено');
ok(/Отклонил жалобу/.test(tr.describe('/api/mod/report/resolve', { accept: false })), 'отклонение переведено');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main();
