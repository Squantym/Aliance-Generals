// ═══════════════════════════════════════════════════════════════════
// test/alliance_invites.test.js — приглашения в личный альянс
//
// Что здесь стережётся:
//
//  1. В альянс зовут ТОЛЬКО живых игроков. Бот больше не союзник: с ним
//     не работают ни подкрепления, ни совместные бои, а вместимость
//     армии он поднимал — это был бесплатный буст в один клик.
//  2. Позвать можно двумя путями: по позывному (вкладка альянса) и по
//     id (кнопка в чужом профиле). Оба ведут в одну проверку.
//  3. Заявка живёт ЧАС. Просроченную не видно, принять нельзя, и она
//     не лежит в коллекции вечно — её выметает мировой тик.
//
// Час — не украшение: пока заявки висели вечно, игрок принимал зов
// месячной давности, и союзник появлялся у того, кто про него забыл.
//
// Запуск: node test/alliance_invites.test.js   (после npm run build)
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
const pa = require('../dist/src/services/personalAlliance');
const worldTick = require('../dist/src/services/worldTick');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const fails = (n, fn, part) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};
const inbox = () => db.load('alliance_invites', {});

(async () => {
  await db.init();
  await auth.register('Зовущий', 'password1', 'a@t.ru', 'ru', '1.1.1.1');
  await auth.register('Позванный', 'password1', 'b@t.ru', 'ru', '2.2.2.2');
  await auth.register('Третий', 'password1', 'c@t.ru', 'ru', '3.3.3.3');
  await auth.register('Хмурый', 'password1', 'd@t.ru', 'ru', '4.4.4.4');
  const U = player.users();
  const A = Object.values(U).find((x) => x.name === 'Зовущий');
  const B = Object.values(U).find((x) => x.name === 'Позванный');
  const C = Object.values(U).find((x) => x.name === 'Третий');
  for (const p of [A, B, C]) { p.level = 50; pa.ensure(p); }
  // Бот — такой же аккаунт мира, отличается только флагом
  const BOT = Object.values(U).find((x) => x.name === 'Хмурый');
  BOT.isBot = true; BOT.level = 50;
  const nx = [];

  console.log('\n[1] Ботов в альянс не зовут');
  fails('по имени бота — отказ', () => pa.invitePlayer(A, 'Хмурый', nx), 'живых игроков');
  fails('и по id бота тоже', () => pa.invitePlayer(A, '', nx, BOT.id), 'живых игроков');
  ok('заявка боту не легла', !(inbox()[BOT.id] || []).length);
  eq('и заявка часа не потрачена', pa.view(A).invitesUsed, 0);
  ok('серверного набора ботов больше нет', typeof pa.inviteBot !== 'function');
  const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  ok('адреса /api/alliance/invite-bot нет', routes.indexOf('invite-bot') === -1);

  console.log('\n[2] Два пути к живому игроку: позывной и профиль');
  pa.invitePlayer(A, 'Позванный', nx);
  eq('заявка легла в инбокс', (inbox()[B.id] || []).length, 1);
  eq('и подписана отправителем', inbox()[B.id][0].fromId, A.id);
  eq('заявка часа потрачена', pa.view(A).invitesUsed, 1);
  pa.invitePlayer(A, '', nx, C.id);                    // кнопка в профиле
  eq('приглашение по id дошло', (inbox()[C.id] || []).length, 1);
  fails('повторный зов тому же — отказ', () => pa.invitePlayer(A, 'Позванный', nx), 'уже приглашали');
  fails('самого себя не позвать', () => pa.invitePlayer(A, 'Зовущий', nx), 'самого себя');
  fails('несуществующего — отказ', () => pa.invitePlayer(A, 'Никого', nx), 'не найден');

  console.log('\n[3] Приглашённый видит срок');
  const mine = pa.myInvites(B);
  eq('заявка одна', mine.invites.length, 1);
  eq('срок жизни — час', mine.ttlMin, 60);
  ok('до сгорания меньше часа', mine.invites[0].expiresInSec > 3500 && mine.invites[0].expiresInSec <= 3600);
  eq('на экране альянса тот же срок', pa.view(A).inviteTtlMin, 60);

  console.log('\n[4] Принятие: союзники обоюдно');
  const bBefore = B.allianceMembers, aBefore = A.allianceMembers;
  pa.acceptInvite(B, A.id, nx);
  eq('принявшему +1', B.allianceMembers, bBefore + 1);
  eq('пригласившему тоже +1', A.allianceMembers, aBefore + 1);
  ok('союз обоюдный', pa.areAllies(A, B));
  ok('заявка из инбокса ушла', !(inbox()[B.id] || []).length);
  fails('своего же союзника не позвать снова', () => pa.invitePlayer(A, 'Позванный', nx), 'уже в вашем альянсе');

  console.log('\n[5] Час прошёл — заявки нет');
  inbox()[C.id][0].at = Date.now() - 61 * 60 * 1000;    // состарили на час и минуту
  // Сначала нажатие: игрок жмёт «принять» по экрану, открытому раньше,
  // и должен получить внятное «просрочено», а не «не найдено».
  fails('принять просроченную нельзя', () => pa.acceptInvite(C, A.id, nx), 'просрочено');
  fails('а неизвестную — «не найдено»', () => pa.acceptInvite(C, B.id, nx), 'не найдено');
  eq('и в списке её больше нет', pa.myInvites(C).invites.length, 0);
  eq('в коллекции протухшая тоже не осталась', (inbox()[C.id] || []).length, 0);

  console.log('\n[6] Уборка мирового тика');
  // Протухшая и свежая рядом: уборка обязана унести только первую
  inbox()[C.id] = [
    { fromId: A.id, fromName: A.name, at: Date.now() - 2 * 3600 * 1000 },
    { fromId: B.id, fromName: B.name, at: Date.now() },
  ];
  eq('вымело ровно одну', pa.sweepInvites(), 1);
  eq('свежая осталась', (inbox()[C.id] || []).length, 1);
  eq('и это именно свежая', inbox()[C.id][0].fromId, B.id);
  // Тик мира зовёт уборку сам — иначе просроченные копились бы в базе
  inbox()[C.id][0].at = Date.now() - 3 * 3600 * 1000;
  worldTick.gameTick();
  ok('после игрового тика протухших не осталось', !(inbox()[C.id] || []).length);

  console.log('\n[7] Кнопка в профиле игрока');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok('кнопка «Пригласить в альянс» есть', /pf-invite-alliance/.test(core));
  ok('шлёт id игрока в личный альянс', /alliance\/invite', \{ targetId: p\.id \}/.test(core));
  ok('боту её не показывают', /!own && !isBot/.test(core) && /p\.myAlly/.test(core));
  ok('союзнику вместо кнопки — отметка', /Уже в вашем альянсе/.test(core));
  eq('профиль сообщает, что это союзник', player.publicProfile(B, A).myAlly, true);
  eq('чужому — нет', player.publicProfile(B, C).myAlly, false);
  eq('и бот отличается от живого', player.publicProfile(BOT, A).isBot, true);
  const social = fs.readFileSync(path.join(ROOT, 'public/js/screens/social.js'), 'utf8');
  ok('на экране альянса срок заявки виден', /сгорит через/.test(social));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
