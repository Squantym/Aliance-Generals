// ===================================================================
// test/test-update45.js — проверка v45:
//  1) admin.deleteAccount — полное удаление аккаунта из игры
//  2) admin.setPassword   — установка пароля игроку админом
//  3) auth.changePassword — смена пароля самим игроком
//  4) Тема «Аврора» — молочная палитра, не белая, мягкий контраст
// Запуск: node test/test-update45.js (после npm run build)
// ===================================================================

// Изоляция БД: db.ts определяет папку данных как process.cwd()/data,
// поэтому переменной окружения не обойтись — уводим весь тест в
// отдельный рабочий каталог. require('../dist/...') резолвится
// относительно файла, а не cwd, поэтому смена каталога безопасна.
const fs = require('fs');
const path = require('path');
const TEST_CWD = '/tmp/generals-test-cwd-45';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name); }
}
// Ожидаем, что вызов упадёт с ошибкой, содержащей фрагмент msgPart
function fails(fn, msgPart, name) {
  try { fn(); ok(false, name + ' (ошибки не было)'); }
  catch (e) { ok(String(e.message).includes(msgPart), `${name} → «${e.message}»`); }
}

const auth = require('../dist/src/services/auth');
const admin = require('../dist/src/services/admin');
const player = require('../dist/src/services/player');
const db = require('../dist/src/core/db');
const u = require('../dist/src/core/utils');

async function main() {

// ── Подготовка: админ (первый = админ), жертва и свидетель ────────
await auth.register('Командир', 'пароль123', 'admin@test.ru', 'ru', '1.1.1.1');
await auth.register('Жертва',   'старый123', 'victim@test.ru', 'ua', '2.2.2.2');
await auth.register('Свидетель','пароль123', 'wit@test.ru',    'ru', '3.3.3.3');
const users = player.users();
const byName = (n) => users[Object.keys(users).find((id) => users[id].name === n)];
const boss = byName('Командир'), victim = byName('Жертва'), wit = byName('Свидетель');
// Права администратора больше не выдаются при регистрации никому —
// назначаются только с сервера (tools/grant-admin.js). В тесте
// проставляем флаг напрямую, как это делает скрипт.
boss.isAdmin = true;
ok(boss.isAdmin && !victim.isAdmin, 'админ и обычные игроки созданы');

console.log('\n── 1. Смена пароля игроком (Настройки → Аккаунт) ──');
fails(() => auth.changePassword(victim, 'неверный1', 'новый12345', 'новый12345'),
      'Текущий пароль неверен', 'неверный старый пароль отклонён');
fails(() => auth.changePassword(victim, 'старый123', 'новый12345', 'другой12345'),
      'не совпадают', 'несовпадение новых паролей отклонено');
fails(() => auth.changePassword(victim, 'старый123', 'кор1', 'кор1'),
      'минимум 8', 'короткий пароль отклонён');
fails(() => auth.changePassword(victim, 'старый123', 'толькобуквы', 'толькобуквы'),
      'буквы и цифры', 'пароль без цифр отклонён');
fails(() => auth.changePassword(victim, 'старый123', 'старый123', 'старый123'),
      'совпадает со старым', 'повтор старого пароля отклонён');

// Заводим две «живые» сессии, чтобы проверить их сброс
const sess = db.load('sessions', {});
sess['токен-телефон'] = victim.id;
sess['токен-планшет'] = victim.id;
const r = auth.changePassword(victim, 'старый123', 'новый12345', 'новый12345');
ok(r.ok && typeof r.token === 'string' && r.token.length > 10, 'смена прошла, выдан новый токен');
const sessNow = db.load('sessions', {});
ok(!sessNow['токен-телефон'] && !sessNow['токен-планшет'], 'старые сессии сброшены');
// Формат сессии сменился на { u: id, at: время } — у токенов появился срок
const sessRec = sessNow[r.token];
const sessUid = typeof sessRec === 'string' ? sessRec : (sessRec && sessRec.u);
ok(sessUid === victim.id, 'новый токен валиден — игрока не выкинуло из игры');
ok(sessRec && sessRec.at > 0, 'у новой сессии проставлено время активности (для срока жизни)');
ok(u.verifyPassword('новый12345', victim.salt, victim.passHash), 'новый пароль установлен');
ok(!u.verifyPassword('старый123', victim.salt, victim.passHash), 'старый пароль больше не подходит');
fails(() => auth.login('Жертва', 'старый123', ''), 'Неверный позывной или пароль', 'вход по старому паролю невозможен');
const okLogin = auth.login('Жертва', 'новый12345', '');
ok(!!okLogin.token, 'вход по новому паролю работает');

console.log('\n── 2. Установка пароля админом ──');
const n = [];
fails(() => admin.setPassword(boss, { userId: victim.id, password: 'кор1' }, n),
      'минимум 8', 'короткий пароль отклонён');
fails(() => admin.setPassword(boss, { userId: 'нет-такого', password: 'пароль1234' }, n),
      'не найден', 'несуществующий игрок отклонён');
const res = admin.setPassword(boss, { userId: victim.id, password: 'админский99' }, n);
ok(res.sessionsKilled >= 1, `сессии игрока сброшены (${res.sessionsKilled})`);
ok(!!auth.login('Жертва', 'админский99', '').token, 'вход с назначенным админом паролем работает');
fails(() => auth.login('Жертва', 'новый12345', ''), 'Неверный позывной или пароль', 'прежний пароль игрока аннулирован');
ok(!n.join(' ').includes('админский99'), 'пароль НЕ утекает в уведомления админа');
const logs = db.load('auditlog', []) || [];
ok(JSON.stringify(logs).indexOf('админский99') === -1, 'пароль НЕ попадает в журнал действий');

// Пароль другого админа менять нельзя
await auth.register('Второй', 'пароль123', 'a2@test.ru', 'ru', '4.4.4.4');
const boss2 = byName('Второй'); boss2.isAdmin = true;
fails(() => admin.setPassword(boss, { userId: boss2.id, password: 'пароль1234' }, n),
      'другого администратора', 'смена пароля другому админу запрещена');

console.log('\n── 3. Полное удаление аккаунта ──');
// Наполняем данными: почта, уведомления, награда, тикет, санкция,
// ракета, ссылки у свидетеля
db.load('mail', {})[victim.id] = [{ id: 'm1', text: 'письмо' }];
db.load('notifications', {})[victim.id] = [{ id: 'n1', kind: 'attack_lost' }];
db.load('pushsubs', {})[victim.id] = [{ endpoint: 'x' }];
db.load('rewards', {})['rw1'] = { id: 'rw1', userId: victim.id, claimed: false };
db.load('support', {})['tk1'] = { id: 'tk1', userId: victim.id, status: 'open' };
db.load('sanctions', {})[victim.id] = { targetId: victim.id, bounty: 5000, orders: [{ byId: wit.id, amount: 5000 }] };
db.load('sanctions', {})[wit.id] = { targetId: wit.id, bounty: 7000, orders: [
  { byId: victim.id, amount: 3000 }, { byId: boss.id, amount: 4000 } ] };
db.load('rockets', {})['rk1'] = { attackerId: victim.id, targetId: wit.id };
db.load('battles', {})['b1'] = { combatants: { [victim.id]: { userId: victim.id } }, activity: { [victim.id]: 10 } };
const world = db.load('world', { chat: [], auctions: [], seq: 1 });
world.chat = [{ id: 1, userId: victim.id, text: 'привет' }, { id: 2, userId: wit.id, text: 'ответ' }];
// Перекрёстные ссылки у свидетеля
wit.earCutters = [{ id: victim.id, name: 'Жертва' }, null];
wit.earMessage = { byId: victim.id, byName: 'Жертва', text: 'послание' };
wit.vsRecord = { [victim.id]: { wins: 3, losses: 1 } };
wit.effects = [{ id: 'e1', type: 'sabotage', hostile: true, byId: victim.id, expiresAt: Date.now() + 1e6 }];
db.load('sessions', {})['токен-жертвы'] = victim.id;

const n2 = [];
fails(() => admin.deleteAccount(boss, { userId: victim.id, confirmName: 'Жертвa' }, n2),
      'Подтверждение не совпало', 'опечатка в подтверждении блокирует удаление');
fails(() => admin.deleteAccount(boss, { userId: boss.id, confirmName: 'Командир' }, n2),
      'собственный аккаунт', 'удаление самого себя запрещено');
fails(() => admin.deleteAccount(boss, { userId: boss2.id, confirmName: 'Второй' }, n2),
      'администратора', 'удаление другого админа запрещено');

const victimId = victim.id;
const del = admin.deleteAccount(boss, { userId: victimId, confirmName: 'Жертва' }, n2);
ok(del.deletedName === 'Жертва', 'аккаунт удалён');
ok(!player.users()[victimId], 'запись игрока стёрта из users');

// Вход невозможен — и ответ такой же, как для несуществующего игрока
let msgDeleted = '', msgNever = '';
try { auth.login('Жертва', 'админский99', ''); } catch (e) { msgDeleted = e.message; }
try { auth.login('НетТакого', 'админский99', ''); } catch (e) { msgNever = e.message; }
ok(msgDeleted === 'Неверный позывной или пароль', 'вход удалённого игрока невозможен');
ok(msgDeleted === msgNever, 'ответ неотличим от «такого аккаунта не существует»');

// Все коллекции подчищены
ok(!db.load('mail', {})[victimId], 'почта удалена');
ok(!db.load('notifications', {})[victimId], 'уведомления удалены');
ok(!db.load('pushsubs', {})[victimId], 'push-подписки удалены');
ok(!db.load('rewards', {})['rw1'], 'награды удалены');
ok(!db.load('support', {})['tk1'], 'обращения в поддержку удалены');
ok(!db.load('sessions', {})['токен-жертвы'], 'сессии удалены');
ok(!db.load('rockets', {})['rk1'], 'летящие ракеты удалены');
ok(!db.load('sanctions', {})[victimId], 'санкция на игрока снята');
const sancWit = db.load('sanctions', {})[wit.id];
ok(sancWit && sancWit.orders.length === 1 && sancWit.bounty === 4000,
   'взнос удалённого вычтен из чужой санкции (награда пересчитана 7000 → 4000)');
const b1 = db.load('battles', {})['b1'];
ok(!b1.combatants[victimId] && b1.activity[victimId] === undefined, 'убран из боёв легиона');
ok(db.load('world', {}).chat.length === 1, 'сообщения в чате удалены');

// Перекрёстные ссылки у свидетеля — чтобы не было битых ссылок в профиле
ok(wit.earCutters[0] === null, 'ссылка «кто отрезал ухо» очищена');
ok(wit.earMessage === null, 'послание от удалённого игрока стёрто');
ok(!wit.vsRecord[victimId], 'личная история боёв очищена');
ok(wit.effects.length === 0, 'вражеские эффекты от удалённого сняты');

// Позывной и email снова свободны
await auth.register('Жертва', 'заново12345', 'victim@test.ru', 'ru', '5.5.5.5');
const reborn = byName('Жертва');
ok(!!reborn && reborn.id !== victimId, 'позывной и email освобождены — регистрация заново возможна');
ok(reborn.level === 1 && reborn.dollars >= 0, 'новый аккаунт стартовый, без остатков прогресса');

console.log('\n── 4. Тема «Аврора»: молочная палитра ──');
const css = fs.readFileSync(__dirname + '/../public/css/style.css', 'utf8');
const themeStart = css.indexOf('ТЕМА 6: АВРОРА');
const block = css.slice(themeStart, themeStart + 9000);
const varOf = (name) => (block.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1];
const bg = varOf('bg'), panel = varOf('panel'), text = varOf('text');
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
ok(!!bg && !!panel && !!text, `палитра читается: фон ${bg}, панель ${panel}, текст ${text}`);
const [br, bgn, bb] = rgb(bg);
ok(br > 230 && bgn > 225 && bb > 210, `фон светлый/яркий (${br},${bgn},${bb})`);
ok(!(br > 250 && bgn > 250 && bb > 250), 'фон НЕ белый');
ok(br > bb + 8, `фон тёплый — молочно-бежевый (R ${br} > B ${bb})`);
// Контраст текста к фону по WCAG: яркий, но мягкий диапазон
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
const cr = contrast(text, bg);
ok(cr >= 4.5, `текст читается (контраст ${cr.toFixed(1)}:1 ≥ 4.5 по WCAG AA)`);
ok(cr <= 10, `контраст мягкий, не резкий (${cr.toFixed(1)}:1 ≤ 10 — у чёрного на белом 21:1)`);
ok(block.includes('.menu-btn::before { content: none; }'), 'резкий градиентный контур кнопок убран');
ok(/body\.theme-aurora \.field/.test(block), 'поля ввода .field стилизованы под тему');
// Мусор в цветах (артефакты правки) — hex должны быть валидны
const badHex = (block.match(/#[0-9a-zA-Z\u0400-\u04FF\u0900-\u097F]+/g) || [])
  .filter((h) => !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(h))
  .filter((h) => !['#wrap', '#header', '#content', '#battle'].includes(h));
ok(badHex.length === 0, 'все цвета темы — валидные hex' + (badHex.length ? ': ' + badHex.join(', ') : ''));

console.log('\n── 5. Кастомные поля под остальные темы ──');
for (const t of ['steel', 'cyber', 'desert', 'noir']) {
  ok(css.includes(`body.theme-${t} .field`), `поля стилизованы под тему «${t}»`);
}
ok(css.includes('.field.field-bad') && css.includes('.field.field-good'), 'состояния валидации полей описаны');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
