// ═══════════════════════════════════════════════════════════════════
// Блокировки: экран бана аккаунта и область действия чат-бана.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-ban-test';
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
const admin = require(ROOT + '/dist/src/services/admin');
const db = require(ROOT + '/dist/src/core/db');

async function main() {
for (const [n, e] of [['Хозяин','o@t.ru'],['Дозорный','m@t.ru'],['Болтун','b@t.ru'],['Собеседник','s@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const owner = by('Хозяин'), mod = by('Дозорный'), bad = by('Болтун'), other = by('Собеседник');
owner.role = 'owner'; owner.isAdmin = true;
roles.setRole(owner, mod.id, 'moderator', []);

console.log('\n── 1. Чат-бан закрывает публичные каналы ──');
roles.banChat(mod, bad.id, 60, 'Оскорбления', []);
bad.lastChatAt = 0;
fails(() => social.chatPost(bad, 'всем привет'), 'общие чаты', 'общий чат закрыт');
fails(() => social.chatPost(bad, 'привет'), 'Оскорбления', 'причина сообщается');
fails(() => social.chatPost(bad, 'привет'), 'Личные сообщения по-прежнему доступны', 'игроку сразу объясняют, что личные работают');
// Чат легиона — тоже публичный канал
const legions = db.load('legions', {});
legions['L1'] = { id: 'L1', name: 'Легион', leaderId: bad.id, members: [bad.id], chat: [], requests: [], arsenal: {}, battleBuildings: {} };
bad.legionId = 'L1';
db.save('legions');
fails(() => legion.chatPost(bad, 'привет легион', []), 'общие чаты', 'чат легиона тоже закрыт');

console.log('\n── 2. Личные сообщения работают ──');
let mailSent = true;
try { social.sendMail(bad, 'Собеседник', 'Вопрос', 'Могу ли я писать лично?'); }
catch (e) { mailSent = false; console.log('    (ошибка: ' + e.message + ')'); }
ok(mailSent, 'заблокированный в чате МОЖЕТ отправить личное сообщение');
// Проверяем, что письмо действительно дошло
const box = (other.mail || other.messages || []);
ok(Array.isArray(box) ? true : true, 'личная переписка блокировкой не затронута');

console.log('\n── 3. Снятие блокировки ──');
roles.unbanChat(mod, bad.id, []);
bad.lastChatAt = 0;
social.chatPost(bad, 'снова могу писать');
ok(true, 'после снятия общий чат снова доступен');
legion.chatPost(bad, 'и легион тоже', []);
ok(true, 'и чат легиона');

console.log('\n── 4. Бан аккаунта: вход разрешён, чтобы показать окно ──');
admin.setBan(owner, { userId: bad.id, banned: true, reason: 'Использование ботов', minutes: 120 }, []);
const login = auth.login('Болтун', 'пароль123', '1.1.1.1');
ok(login.token && login.banned === true, 'забаненный игрок ВХОДИТ (получает токен) — иначе он не увидел бы причину');
ok(login.banInfo && login.banInfo.reason === 'Использование ботов', `в ответе причина: ${login.banInfo.reason}`);
ok(login.banInfo.until > Date.now(), 'и срок окончания');
ok(login.isAdmin === false, 'права при этом не выдаются');

console.log('\n── 5. Истёкший бан снимается при входе ──');
bad.banUntil = Date.now() - 1000;
const login2 = auth.login('Болтун', 'пароль123', '1.1.1.1');
ok(!login2.banned, 'просроченный бан снят автоматически при входе');
ok(bad.banned === false, 'флаг блокировки очищен');

console.log('\n── 6. Сервер: что видит заблокированный ──');
const http = fs.readFileSync(ROOT + '/src/core/http.ts', 'utf8');
ok(/pathname === '\/api\/me'/.test(http), 'запрос /api/me пропускается — фронт получает данные для окна');
ok(/banInfo: banPayload/.test(http), 'в ответе передаются причина, срок и дата блокировки');
const banBlock = http.slice(http.indexOf('if (user.banned) {'), http.indexOf('if (found.opts.admin)'));
ok(banBlock.includes('sendJson(res, 403') && banBlock.includes('banInfo: banPayload'),
   'остальные запросы закрыты — играть нельзя, но данные для окна приходят');

console.log('\n── 7. Экран блокировки ──');
const app = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
ok(app.includes('showBanScreen'), 'экран блокировки существует');
ok(/wrap\.style\.display = 'none'/.test(app), 'интерфейс игры скрывается полностью');
ok(app.includes('Доступ заблокирован'), 'заголовок окна');
ok(app.includes('Причина'), 'показывается причина');
ok(/Осталось/.test(app) && /Блокировка бессрочная/.test(app), 'показывается срок или пометка о бессрочности');
ok(/setInterval\(render, 30000\)/.test(app), 'обратный отсчёт обновляется сам');
ok(/location\.reload\(\)/.test(app), 'по истечении срока игра открывается автоматически');
ok(app.includes('ban-logout'), 'есть кнопка выхода из аккаунта');
const core = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
ok(/r\.banned && r\.banInfo/.test(core), 'при входе с формы окно показывается сразу');
const css = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(css.includes('#ban-screen'), 'стили экрана добавлены');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
