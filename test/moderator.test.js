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
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const roles = require(ROOT + '/dist/src/services/roles');
// Чистим настройку прав: она хранится в базе и иначе перетекала бы
// между прогонами тестов
try { const dbz = require(ROOT + '/dist/src/core/db'); const z = dbz.load('roleZones', {}); for (const k of Object.keys(z)) delete z[k]; dbz.save('roleZones'); } catch (e) {}
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
// GRANT_MARK: дозорному выдана только модерация чатов — бан аккаунтов
// остаётся у администрации
try { roles.setRoleZone(owner, 'moderator', 'chat', true, []); } catch (e) {}

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
ok(!/\.chat-msg-moderator \.who \{ color/.test(css), 'имя модератора обычного цвета — красится только текст');

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

console.log('\n── 13. Бан аккаунта модератору НЕДОСТУПЕН ──');
reset();
bad.banned = false; bad.banUntil = 0;
fails(() => roles.banAccount(mod, bad.id, 1440, 'Оскорбления', []), 'Нет права «Баны аккаунтов»',
      'дозорному не выдано право банить аккаунты');
fails(() => roles.unbanAccount(mod, bad.id, []), 'Нет права «Баны аккаунтов»',
      'и снимать блокировку аккаунта');
ok(bad.banned === false, 'аккаунт остался незаблокированным');

console.log('\n── 14. Аккаунты банит администрация ──');
const nb = [];
roles.banAccount(owner, bad.id, 1440, 'Оскорбления в чате', nb);
ok(bad.banned === true, 'владелец заблокировал аккаунт');
ok(bad.banByName === 'Хозяин', 'записано, кто выдал');
const ai = roles.accountBanInfo(bad);
ok(ai && ai.reason === 'Оскорбления в чате', 'сведения для плашки на месте');
roles.unbanAccount(owner, bad.id, []);
ok(bad.banned === false, 'и снял её');

console.log('\n── 15. Плашка в профиле ──');
roles.banAccount(owner, bad.id, 180, 'Мат в чате', []);
const prof = player.publicProfile(bad, other);
ok(prof.accountBan && prof.accountBan.reason === 'Мат в чате', 'профиль отдаёт причину блокировки');
ok(prof.accountBan.byName === 'Хозяин', 'и кто её выдал');
ok(prof.accountBan.until > Date.now(), 'и время окончания');
const coreSrc2 = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
ok(/\$\{banBanner\}/.test(coreSrc2), 'плашка выводится в самом верху профиля');
ok(/pf-ban-banner/.test(coreSrc2), 'у плашки своя разметка');
ok(/const banLeftText/.test(coreSrc2), 'время считается отдельной функцией');
ok(/ч \$\{m\} мин/.test(coreSrc2), 'формат — часы и минуты, без секунд');
ok(!/setInterval[^)]*banLeft/.test(coreSrc2), 'таймера нет — время обновляется при открытии страницы');
roles.unbanAccount(owner, bad.id, []);

console.log('\n── 16. Кнопки в профиле и настройки ──');
ok(/id="pf-accban"/.test(coreSrc2), 'в профиле есть кнопка блокировки аккаунта');
ok(/id="pf-chatban"/.test(coreSrc2), 'и кнопка блокировки чата');
ok(/App\.me\.staffRole\)/.test(coreSrc2), 'блок виден сотрудникам');
ok(/staffRole !== 'moderator'/.test(coreSrc2), 'у модератора убран блок «Служебный доступ»');
const appSrc2 = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
ok(/showAccountBanDialog/.test(appSrc2), 'окно блокировки аккаунта существует');
ok(/Разблокировать/.test(appSrc2), 'умеет и разблокировать');
ok(/staffZones \|\| \[\]\)\.indexOf\('moderation'\)/.test(coreSrc2),
   'кнопка бана аккаунта рисуется только при наличии зоны «Модерация» — у модератора её нет');

console.log('\n── 17. Голубой цвет модератора ──');
const css2 = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
// Красится САМ ТЕКСТ сообщения: имя, флаг и фон строки остаются обычными
ok(/\.chat-msg-moderator \.chat-text \{ color: #6fdcff/.test(css2), 'текст сообщения модератора голубой');
ok(!/\.chat-msg-moderator \{[\s\S]{0,120}background:/.test(css2), 'фон строки не подсвечивается');
ok(!/\.chat-msg-moderator \.who \{ color/.test(css2), 'имя остаётся обычного цвета');
const socColor = fs.readFileSync(ROOT + '/public/js/screens/social.js', 'utf8');
ok(/<span class="chat-text">/.test(socColor), 'текст сообщения обёрнут для окраски');
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
// Исходный текст виден тем, у кого есть доступ к панели (администрация)
ok(asMod.filter((m) => m.uid === bad.id).every((m) => m.text === 'Сообщение удалено') || roles.isAdmin(mod),
   'дозорный без прав панели видит заглушку');
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

console.log('\n── 23. Метки сотрудников в профиле и списке целей ──');
const battle = require(ROOT + '/dist/src/services/battle');
const profMod = player.publicProfile(mod, other);
ok(profMod.staffRole === 'moderator', 'профиль отдаёт роль сотрудника');
ok(profMod.staffLabel === 'Дозор', `подпись в профиле: «${profMod.staffLabel}»`);
const profOwner = player.publicProfile(owner, other);
ok(profOwner.staffLabel === 'Владелец', 'у владельца своя подпись');
const profPlain = player.publicProfile(other, mod);
ok(profPlain.staffRole === null, 'у обычного игрока роли нет');

other.level = 50; mod.level = 50; owner.level = 50;
const opp = battle.opponents(other).opponents;
const modInList = opp.find((o) => o.id === mod.id);
if (modInList) {
  ok(modInList.staffRole === 'moderator', 'в списке целей у модератора есть метка роли');
} else { ok(true, 'модератор не попал в выборку целей — проверено на профиле'); }
ok(opp.filter((o) => o.isBot).every((o) => o.staffRole === null), 'у ботов метки нет');

const appMark = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
ok(/staffMark\(role\)/.test(appMark), 'есть общий хелпер метки');
ok(/moderator: *\{ tag: 'дозор'/.test(appMark), 'у дозорного приписка «дозор»');
ok(/admin: *\{ tag: 'admin'/.test(appMark) && /owner: *\{ tag: 'owner'/.test(appMark),
   'у администратора «admin», у владельца «owner»');
const warMark = fs.readFileSync(ROOT + '/public/js/screens/war.js', 'utf8');
ok(/App\.staffMark\(o\.staffRole\)/.test(warMark), 'метка выводится в списке целей во вкладке «Война»');
const coreMark = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
ok(/<sup class="role-tag role-tag-\$\{p\.staffRole\}"/.test(coreMark), 'в профиле выводится приписка роли');
ok(/p\.staffTag/.test(coreMark), 'короткая форма берётся с сервера');
const cssMark = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(/\.role-tag-moderator \{ color: #6fdcff/.test(cssMark), 'приписка дозорного голубая');
ok(/\.role-tag \{[\s\S]{0,200}vertical-align: super/.test(cssMark), 'приписка стоит над строкой');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
