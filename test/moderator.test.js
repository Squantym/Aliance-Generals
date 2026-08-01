// ═══════════════════════════════════════════════════════════════════
// Возможности модератора: выдача и снятие блокировки, выбор каналов,
// выделение нарушителей, кнопка в профиле, цвет сообщений, правила.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-mod-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
const social = require(ROOT + '/dist/src/services/social');
const legion = require(ROOT + '/dist/src/services/legion');
const db = require(ROOT + '/dist/src/core/db');

async function main() {
for (const [n, e] of [['Хозяин','o@t.ru'],['Дозорный','m@t.ru'],['Болтун','b@t.ru'],['Сосед','s@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const owner = by('Хозяин'), mod = by('Дозорный'), bad = by('Болтун'), other = by('Сосед');
owner.role = 'owner'; owner.isAdmin = true;
roles.setRole(owner, mod.id, 'moderator', []);
// Легион для проверки его чата
const legions = db.load('legions', {});
legions['L1'] = { id: 'L1', name: 'Легион', leaderId: bad.id, members: [bad.id], chat: [], requests: [], arsenal: {}, battleBuildings: {} };
bad.legionId = 'L1'; db.save('legions');
const reset = () => { bad.lastChatAt = 0; bad.chatBan = null; };

console.log('\n── 1. Каналы блокировки ──');
ok(roles.CHAT_SCOPES.length === 3, `каналов для выбора: ${roles.CHAT_SCOPES.length}`);
ok(roles.CHAT_SCOPES.map((s) => s.id).join(',') === 'global,legion,mail',
   'общий чат, чат легиона, личные сообщения');
ok(roles.CHAT_SCOPES.every((s) => s.name && s.note), 'у каждого есть название и пояснение');

console.log('\n── 2. Блокировка только общего чата ──');
reset();
roles.banChat(mod, bad.id, 60, 'Оскорбления', [], ['global']);
fails(() => social.chatPost(bad, 'привет'), 'Общий чат закрыт', 'общий чат закрыт');
fails(() => social.chatPost(bad, 'привет'), 'Доступно:', 'игроку сообщают, что осталось доступным');
legion.chatPost(bad, 'привет легион', []);
ok(true, 'чат легиона работает');
social.sendMail(bad, 'Сосед', 'Тема', 'Текст');
ok(true, 'личные сообщения работают');

console.log('\n── 3. Блокировка всех каналов ──');
reset();
roles.banChat(mod, bad.id, 60, 'Спам', [], ['global', 'legion', 'mail']);
fails(() => social.chatPost(bad, 'x'), 'закрыт', 'общий чат закрыт');
fails(() => legion.chatPost(bad, 'x', []), 'закрыт', 'чат легиона закрыт');
fails(() => social.sendMail(bad, 'Сосед', 'Т', 'Т'), 'закрыт', 'личные сообщения закрыты');

console.log('\n── 4. Только личные сообщения ──');
reset();
roles.banChat(mod, bad.id, 60, 'Выманивал пароль', [], ['mail']);
social.chatPost(bad, 'в общем пишу');
ok(true, 'общий чат доступен');
fails(() => social.sendMail(bad, 'Сосед', 'Т', 'Т'), 'Личные сообщения закрыт', 'личные закрыты');

console.log('\n── 5. Пустой список каналов = закрыть всё ──');
reset();
const r = roles.banChat(mod, bad.id, 30, 'Проверка', [], []);
ok(r.scopes.length === 3, `при пустом выборе закрываются все каналы (${r.scopeNames})`);

console.log('\n── 6. Выдача и снятие ──');
reset();
roles.banChat(mod, bad.id, 120, 'Флуд', [], ['global']);
ok(roles.chatBanInfo(bad) !== null, 'модератор выдал блокировку');
const n1 = [];
roles.unbanChat(mod, bad.id, n1);
ok(roles.chatBanInfo(bad) === null, 'и снял её');
ok(/снята/.test(n1[0]), `сообщение: «${n1[0]}»`);
social.chatPost(bad, 'снова пишу');
ok(true, 'после снятия чат работает');
fails(() => roles.unbanChat(mod, bad.id, []), 'не заблокирован', 'повторное снятие отклоняется');

console.log('\n── 7. Совместимость со старыми блокировками ──');
bad.chatBan = { until: Date.now() + 3600000, reason: 'Старая', byName: 'Кто-то' };   // без scopes
const info = roles.chatBanInfo(bad);
ok(info && info.scopes.includes('global') && info.scopes.includes('legion'),
   'блокировка без списка каналов закрывает общий чат и легион, как раньше');
ok(!info.scopes.includes('mail'), 'личные сообщения при этом остаются открытыми');
reset();

console.log('\n── 8. Нарушители видны сотрудникам ──');
roles.banChat(mod, bad.id, 60, 'Мат', [], ['global']);
bad.lastChatAt = 0;
other.lastChatAt = 0;
social.chatPost(other, 'обычное сообщение');
const viewMod = social.chatGet(mod);
const viewPlayer = social.chatGet(other);
const msgFromBad = viewMod.messages.find((m) => m.uid === bad.id);
ok(viewMod.messages.some((m) => 'banned' in m), 'сотрудник получает признак блокировки у сообщений');
ok(viewPlayer.messages.every((m) => m.banned === false),
   'обычный игрок этого признака не видит — чужие наказания его не касаются');
const socSrc = fs.readFileSync(ROOT + '/public/js/screens/social.js', 'utf8');
ok(/chat-msg-banned/.test(socSrc), 'заблокированные помечаются в разметке');
ok(/chat-banned-mark/.test(socSrc), 'рядом с именем ставится значок');

console.log('\n── 9. Цвет сообщений сотрудников ──');
ok(/chat-msg-staff chat-msg-' \+ msg\.staff/.test(socSrc), 'класс сообщения зависит от роли');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(css.includes('.chat-msg-moderator'), 'у «Дозора» свой цвет');
ok(css.includes('.chat-msg-admin') && css.includes('.chat-msg-owner'), 'у администратора и владельца тоже');
ok(/\.chat-msg-moderator \.who \{ color: #6fdcff/.test(css), 'имя модератора выделено голубым');

console.log('\n── 10. Кнопка в профиле игрока ──');
const coreSrc = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
ok(/pf-mod-block/.test(coreSrc), 'в профиле есть блок инструментов «Дозора»');
ok(/App\.me\.staffRole/.test(coreSrc), 'виден только сотрудникам');
ok(/api\/mod\/chat-status/.test(coreSrc), 'показывает текущее состояние блокировки');
ok(/Снять блокировку/.test(coreSrc), 'кнопка умеет и снимать');
ok(/Сотрудник проекта — меры недоступны/.test(coreSrc), 'на сотруднике кнопки прячутся');

console.log('\n── 11. Окно блокировки ──');
const appSrc = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
ok(/data-scope="global"/.test(appSrc) && /data-scope="legion"/.test(appSrc) && /data-scope="mail"/.test(appSrc),
   'в окне можно выбрать каждый канал');
ok(/data-scope-all/.test(appSrc), 'есть кнопка «Всё сразу»');
ok(/st && st\.banned/.test(appSrc), 'если игрок уже заблокирован — предлагается снятие');
ok(/Блокировка активна/.test(appSrc), 'показывается текущее состояние с причиной и сроком');

console.log('\n── 12. Правила общения ──');
ok(/App\.showChatRules/.test(socSrc), 'правила открываются кнопкой');
ok(/id="chat-rules"/.test(socSrc), 'кнопка есть под полем ввода');
ok(/Уважайте «Дозор»/.test(socSrc), 'в правилах описано отношение к модераторам');
ok(/Без вражды/.test(socSrc) && /Без рекламы/.test(socSrc), 'перечислены основные запреты');
ok(/не мешает играть/.test(socSrc), 'объяснено, что блокировка не мешает играть');
ok(css.includes('.chat-rule'), 'стили правил добавлены');

console.log('\n── 13. Бан аккаунта силами модератора ──');
reset();
bad.banned = false; bad.banUntil = 0;
const nb = [];
const ban = roles.banAccount(mod, bad.id, 1440, 'Оскорбления в чате', nb);
ok(bad.banned === true, 'модератор заблокировал аккаунт');
ok(bad.banUntil > Date.now(), `срок проставлен (${Math.round((bad.banUntil - Date.now()) / 60000)} мин)`);
ok(bad.banByName === 'Дозорный', 'записано, кто выдал');
const ai = roles.accountBanInfo(bad);
ok(ai && ai.reason === 'Оскорбления в чате' && ai.byName === 'Дозорный',
   'сведения для плашки: причина и автор');
const nu = [];
roles.unbanAccount(mod, bad.id, nu);
ok(bad.banned === false, 'и снял блокировку');

console.log('\n── 14. Ограничения модератора ──');
fails(() => roles.banAccount(mod, bad.id, 0, 'навсегда', []), 'Бессрочный бан выдаёт только администрация',
      'модератор не может забанить бессрочно');
const long = roles.banAccount(mod, bad.id, 99999, 'проверка предела', []);
ok(long.minutes === roles.MOD_MAX_BAN_MINUTES,
   `срок ограничен неделей: ${Math.round(long.minutes / 1440)} суток`);
roles.unbanAccount(mod, bad.id, []);
fails(() => roles.banAccount(mod, bad.id, 60, '', []), 'Укажите причину', 'без причины нельзя');
fails(() => roles.banAccount(mod, mod.id, 60, 'x', []), 'самого себя', 'себя забанить нельзя');
fails(() => roles.banAccount(mod, owner.id, 60, 'x', []), 'владельца', 'владельца — тоже');
// Бессрочный бан от администрации модератор не снимет
roles.banAccount(owner, bad.id, 0, 'Серьёзное нарушение', []);
fails(() => roles.unbanAccount(mod, bad.id, []), 'только администрация',
      'бессрочную блокировку модератор снять не может');
roles.unbanAccount(owner, bad.id, []);

console.log('\n── 15. Плашка в профиле ──');
roles.banAccount(mod, bad.id, 180, 'Мат в чате', []);
const prof = player.publicProfile(bad, other);
ok(prof.accountBan && prof.accountBan.reason === 'Мат в чате', 'профиль отдаёт причину блокировки');
ok(prof.accountBan.byName === 'Дозорный', 'и кто её выдал');
ok(prof.accountBan.until > Date.now(), 'и время окончания');
const coreSrc2 = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
ok(/\$\{banBanner\}/.test(coreSrc2), 'плашка выводится в самом верху профиля');
ok(/pf-ban-banner/.test(coreSrc2), 'у плашки своя разметка');
ok(/const banLeftText/.test(coreSrc2), 'время считается отдельной функцией');
ok(/ч \$\{m\} мин/.test(coreSrc2), 'формат — часы и минуты, без секунд');
ok(!/setInterval[^)]*banLeft/.test(coreSrc2), 'таймера нет — время обновляется при открытии страницы');
roles.unbanAccount(mod, bad.id, []);

console.log('\n── 16. Кнопки в профиле и настройки ──');
ok(/id="pf-accban"/.test(coreSrc2), 'в профиле есть кнопка блокировки аккаунта');
ok(/id="pf-chatban"/.test(coreSrc2), 'и кнопка блокировки чата');
ok(/App\.me\.staffRole\)/.test(coreSrc2), 'блок виден сотрудникам');
ok(/staffRole !== 'moderator'/.test(coreSrc2), 'у модератора убран блок «Служебный доступ»');
const appSrc2 = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
ok(/showAccountBanDialog/.test(appSrc2), 'окно блокировки аккаунта существует');
ok(/Разблокировать/.test(appSrc2), 'умеет и разблокировать');
ok(/Бессрочную блокировку выдаёт администрация/.test(appSrc2), 'модератору объяснён предел его полномочий');

console.log('\n── 17. Голубой цвет модератора ──');
const css2 = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(/\.chat-msg-moderator \{[\s\S]{0,120}rgba\(60,190,240/.test(css2), 'подсветка сообщения голубая');
ok(/\.chat-msg-moderator \.who \{ color: #6fdcff/.test(css2), 'имя модератора голубое');
ok(/\.chat-staff-moderator \{[\s\S]{0,120}#6fdcff/.test(css2), 'значок «Дозор» тоже голубой');

console.log('\n── 18. Удаление сообщений при блокировке ──');
reset();
bad.chatBan = null;
// Наполняем чат: сообщения нарушителя и постороннего
for (let i = 0; i < 3; i++) { bad.lastChatAt = 0; social.chatPost(bad, 'нарушение ' + i); }
other.lastChatAt = 0; social.chatPost(other, 'мирное сообщение');
const beforeAll = social.chatGet(owner).messages.length;
const nPurge = [];
const res = roles.banChat(mod, bad.id, 60, 'Оскорбления', nPurge, ['global'], true);
ok(res.purged >= 3, `удалено сообщений нарушителя: ${res.purged}`);
ok(new RegExp(`Удалено сообщений в общем чате: ${res.purged}`).test(nPurge[0]),
   'модератору сообщается количество');

console.log('\n── 19. Кто видит удалённые ──');
const asPlayer = social.chatGet(other).messages;
const asAuthor = social.chatGet(bad).messages;
const asMod = social.chatGet(mod).messages;
const asOwner = social.chatGet(owner).messages;
// Сообщение остаётся в ленте, но текст заменён заглушкой — так видно,
// что модерация работает, и ответы на реплику не повисают в воздухе
const playerSees = asPlayer.filter((m) => m.uid === bad.id);
ok(playerSees.length >= 3, `сообщения остались в ленте (${playerSees.length})`);
ok(playerSees.every((m) => m.text === 'Сообщение удалено'), 'у игрока вместо текста — «Сообщение удалено»');
ok(playerSees.every((m) => m.tombstone === true), 'помечены как заглушки');
ok(!playerSees.some((m) => m.text.includes('нарушение')), 'исходный текст игроку не виден');
ok(asAuthor.filter((m) => m.uid === bad.id).every((m) => m.text === 'Сообщение удалено'),
   'сам автор тоже видит заглушку, а не свой текст');
ok(asMod.filter((m) => m.uid === bad.id).every((m) => m.text === 'Сообщение удалено'),
   'модератор видит заглушку — исходный текст только у администрации');
ok(playerSees.every((m) => !m.deletedBy), 'кто удалил — игрокам не показывается');
// Гость (без входа) тоже видит заглушки
const asGuest = social.chatGet(null).messages.filter((m) => m.uid === bad.id);
ok(asGuest.every((m) => m.text === 'Сообщение удалено'), 'гостю тоже показывается заглушка');
// Нарушитель писал в чат и раньше по ходу теста, поэтому сравниваем не с
// тройкой, а с фактом: владельцу видны ВСЕ его сообщения, игроку — ни одного
const ownerSeesBad = asOwner.filter((m) => m.uid === bad.id).length;
ok(ownerSeesBad >= 3, `владелец видит все удалённые сообщения нарушителя (${ownerSeesBad})`);
ok(asOwner.filter((m) => m.deleted).length === ownerSeesBad, 'все они помечены признаком deleted');
ok(asOwner.filter((m) => m.uid === bad.id).some((m) => m.text.includes('нарушение')),
   'администрация видит ИСХОДНЫЙ текст, а не заглушку');
ok(asOwner.filter((m) => m.uid === bad.id).every((m) => !m.tombstone),
   'для администрации это не заглушка');
ok(asOwner.find((m) => m.deleted).deletedBy === 'Дозорный', 'указано, кто удалил');
ok(asPlayer.some((m) => m.uid === other.id), 'чужие сообщения остались на месте');
// Администратор — тоже видит
const adm2 = by('Хозяин');
ok(social.chatGet(adm2).messages.some((m) => m.deleted), 'администрация видит удалённые');

console.log('\n── 20. Удаление не трогает закрытые каналы ──');
const soc = fs.readFileSync(ROOT + '/src/services/social.ts', 'utf8');
ok(/чат легиона и личную/i.test(soc) || /Чат легиона и личную/.test(soc),
   'в коде оговорено, что легион и личные не затрагиваются');
ok(/m\.uid !== userId \|\| m\.del/.test(soc), 'удаляются только сообщения нарушителя и только один раз');
ok(!/splice|delete w\.chat/.test(soc.slice(soc.indexOf('function purgeChatMessages'), soc.indexOf('function chatGet'))),
   'сообщения помечаются, а не стираются — иначе администрация не смогла бы их проверить');

console.log('\n── 21. Удаление по желанию, а не всегда ──');
reset(); bad.chatBan = null;
bad.lastChatAt = 0; social.chatPost(bad, 'ещё сообщение');
const res2 = roles.banChat(mod, bad.id, 60, 'Флуд', [], ['global']);
ok(!res2.purged, 'без галочки сообщения остаются');
ok(social.chatGet(other).messages.some((m) => m.text === 'ещё сообщение'), 'сообщение видно игрокам');

console.log('\n── 22. Интерфейс ──');
const appSrc3 = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
ok(/id="ban-purge"/.test(appSrc3), 'в окне блокировки есть галочка удаления');
ok(/чат легиона и личные не затрагиваются/.test(appSrc3), 'рядом пояснено, что именно удаляется');
ok(/purge: !!App\._banPurge/.test(appSrc3), 'флаг уходит на сервер');
ok(/удалено сообщений: \$\{r\.purged\}/.test(appSrc3), 'модератору показывают результат');
const socSrc3 = fs.readFileSync(ROOT + '/public/js/screens/social.js', 'utf8');
ok(/chat-msg-deleted/.test(socSrc3), 'удалённые сообщения помечаются в разметке');
ok(/chat-deleted-mark/.test(socSrc3), 'рядом ставится метка «удалено»');
ok(/msg\.deletedBy/.test(socSrc3), 'видно, кто удалил');
const css3 = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(css3.includes('.chat-msg-deleted'), 'стили удалённых добавлены');
ok(css3.includes('.chat-tomb-text'), 'стиль заглушки добавлен');
ok(/msg\.tombstone \? '' :/.test(socSrc3) || /\(msg\.self \|\| msg\.tombstone\)/.test(socSrc3),
   'у заглушки нет кнопки «Ответить» — отвечать нечему');
ok(/!msg\.tombstone\)/.test(socSrc3), 'и кнопки блокировки тоже нет');
ok(/line-through/.test(css3.slice(css3.indexOf('.chat-msg-deleted'))), 'имя автора зачёркнуто');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
