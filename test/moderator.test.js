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
ok(/\.chat-msg-moderator \.who \{ color: #7fc0ea/.test(css), 'имя модератора выделено цветом');

console.log('\n── 10. Кнопка в профиле игрока ──');
const coreSrc = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
ok(/pf-mod-block/.test(coreSrc), 'в профиле есть блок инструментов «Дозора»');
ok(/App\.me\.staffRole/.test(coreSrc), 'виден только сотрудникам');
ok(/api\/mod\/chat-status/.test(coreSrc), 'показывает текущее состояние блокировки');
ok(/Снять блокировку/.test(coreSrc), 'кнопка умеет и снимать');
ok(/Сотрудник проекта — блокировка недоступна/.test(coreSrc), 'на сотруднике кнопка прячется');

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

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
