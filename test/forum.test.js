// ═══════════════════════════════════════════════════════════════════
// Форум: темы, комментарии, порядок вывода, страницы, модерация,
// ограничения игрокам и вкладки раздела «Общение».
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-forum-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 60)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
try { const dbz = require(ROOT + '/dist/src/core/db'); const z = dbz.load('roleZones', {}); for (const k of Object.keys(z)) delete z[k]; dbz.save('roleZones'); } catch (e) {}
const forum = require(ROOT + '/dist/src/services/forum');
const social = require(ROOT + '/dist/src/services/social');

async function main() {
for (const [n, e] of [['Хозяин','o'],['Модер','m'],['Игрок1','p1'],['Игрок2','p2']]) {
  await auth.register(n, 'пароль123', e + '@t.ru', 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const own = by('Хозяин'), mod = by('Модер'), p1 = by('Игрок1'), p2 = by('Игрок2');
own.role = 'owner'; own.isAdmin = true;
roles.setRole(own, mod.id, 'moderator', []);
roles.setRoleZone(own, 'moderator', 'forum', true, []);
roles.setRoleZone(own, 'moderator', 'chat', true, []);
const noWait = (u) => { u.lastForumTopicAt = 0; u.lastForumCommentAt = 0; };

console.log('\n── 1. Создание тем ──');
noWait(p1); const t1 = forum.createTopic(p1, 'Вопрос по технике', 'Какой танк лучше?', null, []);
ok(!!t1.id, 'игрок создал тему');
fails(() => forum.createTopic(p1, 'Ещё', 'Текст', null, []), 'через полминуты', 'антифлуд: вторая тема сразу не создаётся');
noWait(p1);
fails(() => forum.createTopic(p1, 'ab', 'Текст', null, []), 'минимум 3 символа', 'слишком короткое название отклонено');
fails(() => forum.createTopic(p1, 'Нормальное', '', null, []), 'Напишите текст', 'пустая тема без картинки отклонена');
noWait(p2); forum.createTopic(p2, 'Ищу альянс', 'Возьмите к себе', null, []);
noWait(mod); forum.createTopic(mod, 'Правила форума', 'Читать всем', null, []);

console.log('\n── 2. Темы сотрудников всегда первыми ──');
const l1 = forum.list(p1, 1);
ok(l1.total === 3, `тем всего: ${l1.total}`);
ok(l1.topics[0].staff === true, 'тема сотрудника наверху, хотя создана последней');
ok(l1.topics[0].title === 'Правила форума', `первая: «${l1.topics[0].title}»`);
ok(l1.topics[1].at >= l1.topics[2].at, 'внутри игроков — новые выше старых');
ok(l1.topics.every((t) => typeof t.comments === 'number'), 'в списке видно число комментариев');

console.log('\n── 3. Страницы по 15 тем ──');
ok(forum.PAGE_SIZE === 15, `на странице ${forum.PAGE_SIZE} тем`);
for (let i = 0; i < 20; i++) { noWait(p1); forum.createTopic(p1, 'Тема номер ' + i, 'текст', null, []); }
const l2 = forum.list(p1, 1);
ok(l2.topics.length === 15, `на первой странице ${l2.topics.length} тем`);
ok(l2.pages === 2, `страниц: ${l2.pages}`);
const l3 = forum.list(p1, 2);
ok(l3.topics.length === 8, `на второй странице ${l3.topics.length} тем`);
ok(l3.page === 2, 'номер страницы возвращается');
ok(forum.list(p1, 99).page === 2, 'запрос несуществующей страницы отдаёт последнюю');

console.log('\n── 4. Комментарии ──');
noWait(p2); forum.addComment(p2, t1.id, 'Бери Армату', []);
noWait(p1); forum.addComment(p1, t1.id, 'Спасибо', []);
const v1 = forum.view(p1, t1.id);
ok(v1.comments.length === 2, `комментариев: ${v1.comments.length}`);
ok(v1.comments[0].userName === 'Игрок2', 'порядок сохранён');
ok(v1.views >= 1, 'просмотры считаются');
fails(() => forum.addComment(p2, t1.id, '', []), 'Пустой комментарий', 'пустой комментарий отклонён');

console.log('\n── 5. Закрытие темы ──');
forum.setClosed(mod, t1.id, true, []);
noWait(p2);
fails(() => forum.addComment(p2, t1.id, 'ещё', []), 'закрыта', 'в закрытую тему писать нельзя');
ok(forum.view(p1, t1.id).canComment === false, 'кнопка комментария скрыта');
forum.setClosed(mod, t1.id, false, []);
noWait(p2); forum.addComment(p2, t1.id, 'снова пишу', []);
ok(true, 'после открытия комментарии снова принимаются');
// Автор может закрыть свою тему
forum.setClosed(p1, t1.id, true, []);
ok(forum.view(p1, t1.id).closed === true, 'автор закрывает свою тему сам');
forum.setClosed(p1, t1.id, false, []);
fails(() => forum.setClosed(p2, t1.id, true, []), 'Нет права модерировать', 'чужую тему обычный игрок не закроет');

console.log('\n── 6. Право модерации выдаёт владелец ──');
ok(forum.isForumMod(mod) === true, 'у модератора выдана зона «Форум»');
ok(forum.isForumMod(p1) === false, 'у игрока её нет');
roles.setRoleZone(own, 'moderator', 'forum', false, []);
ok(forum.isForumMod(mod) === false, 'право можно отобрать');
fails(() => forum.setPinned(mod, t1.id, true, []), 'Нет права', 'без права закрепить нельзя');
roles.setRoleZone(own, 'moderator', 'forum', true, []);
forum.setPinned(mod, t1.id, true, []);
ok(forum.list(p1, 1).topics[0].id === t1.id, 'закреплённая тема поднимается выше всех');
forum.setPinned(mod, t1.id, false, []);

console.log('\n── 7. Удаление ──');
const vDel = forum.view(mod, t1.id);
forum.deleteComment(mod, t1.id, vDel.comments[0].id, []);
const afterDel = forum.view(p1, t1.id);
ok(afterDel.comments.filter((c) => !c.deleted).length < vDel.comments.length, 'комментарий удалён');
ok(forum.view(own, t1.id).comments.some((c) => c.deleted), 'администрация видит удалённые');
noWait(mod);
const tDel = forum.createTopic(mod, 'На удаление', 'текст', null, []);
forum.deleteTopic(mod, tDel.id, []);
ok(!forum.list(p1, 1).topics.some((t) => t.id === tDel.id), 'удалённая тема исчезла из списка');

console.log('\n── 8. Ограничения игроку ──');
const nb = [];
forum.banForum(mod, p2.id, 60, 'Оскорбления', ['write'], nb);
noWait(p2);
fails(() => forum.addComment(p2, t1.id, 'привет', []), 'закрыто обсуждение', 'запрет комментариев работает');
ok(forum.canCreateTopic(p2) === false, 'запрет распространяется и на создание тем');
ok(forum.canRead(p2) === true, 'но читать форум он может');
forum.banForum(mod, p2.id, 60, 'Реклама', ['topic'], []);
noWait(p2);
fails(() => forum.createTopic(p2, 'Реклама', 'текст', null, []), 'закрыто создание тем', 'запрет только на темы');
noWait(p2);
forum.addComment(p2, t1.id, 'а комментировать могу', []);
ok(true, 'комментарии при этом доступны');
forum.banForum(mod, p2.id, 60, 'Тяжкое нарушение', ['read'], []);
fails(() => forum.list(p2, 1), 'Доступ к форуму закрыт', 'полный запрет — форум не открывается');
fails(() => forum.view(p2, t1.id), 'Доступ к форуму закрыт', 'и тему не посмотреть');
forum.unbanForum(mod, p2.id, []);
ok(forum.canRead(p2) && forum.canWrite(p2) && forum.canCreateTopic(p2), 'после снятия всё вернулось');

console.log('\n── 9. Кого нельзя ограничить ──');
fails(() => forum.banForum(mod, own.id, 60, 'x', ['write'], []), 'владельца', 'владельца — нельзя');
fails(() => forum.banForum(mod, mod.id, 60, 'x', ['write'], []), 'самому себе', 'себя — тоже');
fails(() => forum.banForum(p1, p2.id, 60, 'x', ['write'], []), 'Нет права', 'игрок не может наказывать');

console.log('\n── 10. Комнаты чата ──');
p1.lastChatAt = 0; social.chatPost(p1, 'общее сообщение');
p2.lastChatAt = 0; social.chatPost(p2, 'ищу альянс', 'recruit');
const globalMsgs = social.chatGet(p1, 0, 'global').messages;
const recruitMsgs = social.chatGet(p1, 0, 'recruit').messages;
ok(globalMsgs.some((m) => m.text === 'общее сообщение'), 'общий чат содержит своё сообщение');
ok(!globalMsgs.some((m) => m.text === 'ищу альянс'), 'объявление о наборе не попало в общий чат');
ok(recruitMsgs.some((m) => m.text === 'ищу альянс'), '«Позывные» содержат объявление');
ok(!recruitMsgs.some((m) => m.text === 'общее сообщение'), 'и не содержат общего чата');

console.log('\n── 11. Интерфейс ──');
const soc = fs.readFileSync(ROOT + '/public/js/screens/social.js', 'utf8');
ok(/data-ctab="chat"/.test(soc) && /data-ctab="forum"/.test(soc) && /data-ctab="news"/.test(soc),
   'в «Общении» три вкладки: чат, форум, новости');
ok(/data-croom="global"/.test(soc) && /data-croom="recruit"/.test(soc), 'у чата две подвкладки');
ok(/Позывные/.test(soc), 'вторая подвкладка названа «Позывные» — доска поиска соратников');
ok(/App\.renderForum/.test(soc) && /App\.renderTopic/.test(soc), 'есть список тем и просмотр темы');
ok(/_resizeImage/.test(soc), 'картинка уменьшается в браузере перед отправкой');
ok(/maxW \/ img\.width/.test(soc), 'ширина приводится к заданному пределу');
ok(/while \(out\.length > 600 \* 1024 && q > 0\.4\)/.test(soc), 'качество подбирается, пока файл не уложится в размер');
ok(/data-page=/.test(soc), 'есть кнопки страниц');
ok(/forum-title-staff/.test(soc), 'темы сотрудников выделяются');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(/\.forum-img \{[\s\S]{0,140}width: 70%/.test(css), 'картинка занимает 70% ширины');
ok(/\.forum-row-staff/.test(css), 'строки сотрудников оформлены');
ok(/\.forum-pages/.test(css), 'стили страниц добавлены');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
// Проверяем НАЛИЧИЕ САМИХ РОУТОВ, а не только вспомогательных функций:
// однажды сервис форума был готов, а роуты в файл не попали — снаружи
// форум был полностью недоступен, и тест этого не замечал
for (const [method, route] of [
  ['GET', '/api/forum'], ['GET', '/api/forum/topic/:id'],
  ['POST', '/api/forum/topic'], ['POST', '/api/forum/comment'],
  ['POST', '/api/forum/close'], ['POST', '/api/forum/pin'],
  ['POST', '/api/forum/delete'], ['POST', '/api/forum/delete-comment'],
  ['POST', '/api/forum/ban'], ['POST', '/api/forum/unban'],
]) {
  const re = new RegExp(`app\\.add\\('${method}',\\s*'${route.replace(/\//g, '\\/')}'`);
  ok(re.test(routes), `роут ${method} ${route} зарегистрирован`);
}
ok(/saveForumImage/.test(routes), 'сервер сохраняет картинку файлом, а не в базу');
ok(/700 \* 1024/.test(routes), 'размер картинки на сервере ограничен');
const rolesSrc = fs.readFileSync(ROOT + '/src/services/roles.ts', 'utf8');
ok(/id: 'forum',\s+name: 'Модерация форума'/.test(rolesSrc), 'право «Модерация форума» настраивается владельцем');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
