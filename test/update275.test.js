// ═══════════════════════════════════════════════════════════════════
// test/update275.test.js — подкрепления в ответ, приглашения в легион,
// гербы в легионе
//
// Что стережётся:
//  1. В «Подкреплениях» у каждого, кто прислал подкрепление, есть
//     ответная кнопка; состояние кнопки считается той же проверкой, что
//     и отправка (иначе кнопка обещала бы то, в чём отправка откажет).
//  2. Приглашение в ЛЕГИОН приходит как приглашение в легион — с
//     отправителем и ссылкой на «Легион». До 275 оно называлось
//     «Приглашение в альянс» и отправляло игрока не в тот раздел.
//  3. Уведомление о приглашении показывает, от кого и куда идти; старые
//     приглашения в легион (без отправителя) тоже ведут в легион.
//  4. Экран легиона показывает гербы из поля crests: поле ears из
//     данных игрока убрали при переименовании, и там стоял 0.
//
// Запуск: node test/update275.test.js   (после npm run build)
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
const reinf = require('../dist/src/services/reinforcements');
const groups = require('../dist/src/services/groups');
const notifications = require('../dist/src/services/notifications');
const push = fs.readFileSync(path.join(ROOT, 'src/services/push.ts'), 'utf8');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  let ipN = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `u275_${++ipN}@t.ru`, 'ru', '10.0.9.' + ipN);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 60;
    return p;
  };
  const ally = (a, b) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      x.allianceRoster = (x.allianceRoster || []).concat([{ id: y.id, name: y.name }]);
      x.allianceMembers = x.allianceRoster.length;
    }
  };

  console.log('\n[1] Ответное подкрепление');
  const Me = await reg('Получатель');
  const A = await reg('Помогающий');
  const B = await reg('ДругБ');
  const C = await reg('Бывший');
  ally(Me, A); ally(Me, B);
  const N = [];
  reinf.send(A, Me.id, N);
  reinf.send(B, Me.id, N);
  // Бывший союзник: подкрепление есть, а союза уже нет
  Me.reinforcements.push({ fromId: C.id, fromName: C.name, at: Date.now() - 5000, expiresAt: Date.now() + 3600e3 });
  let v = reinf.view(Me);
  ok(v.active.length === 3, `прислали трое (${v.active.length})`);
  const row = (id) => v.active.find((r) => r.fromId === id);
  ok(row(A.id).canReply && row(B.id).canReply, 'обоим союзникам можно ответить');
  ok(row(A.id).fromLevel === 60 && typeof row(A.id).flag === 'string', 'у отправителя — уровень и флаг');
  ok(!row(C.id).canReply && row(C.id).replyReason === 'не во взаимном альянсе', 'бывшему союзнику — нельзя, с причиной');
  ok(v.active[0].receivedAt >= v.active[v.active.length - 1].receivedAt, 'свежие — сверху');
  reinf.send(Me, A.id, N);
  v = reinf.view(Me);
  ok(!row(A.id).canReply && row(A.id).replied === true, 'после ответа — «вы тоже помогаете»');
  ok(row(B.id).canReply, 'второму по-прежнему можно');
  // Кнопка и отправка согласны: то, что кнопка разрешает, отправка принимает
  let err = '';
  try { reinf.send(Me, C.id, N); } catch (e) { err = e.message; }
  ok(/только союзникам/.test(err), 'где кнопки нет, отправка тоже отказывает');
  // Дневной лимит исчерпан — кнопка гаснет с понятной причиной
  Me.reinforceSent = Array.from({ length: 20 }, (_, i) => ({ toId: 'x' + i, at: Date.now() }));
  v = reinf.view(Me);
  ok(!row(B.id).canReply && row(B.id).replyReason === 'ваш дневной лимит исчерпан', 'лимит исчерпан — ответить нельзя');
  const screen = fs.readFileSync(path.join(ROOT, 'public/js/screens/social.js'), 'utf8');
  const part = screen.slice(screen.indexOf('App.screens.reinforcements'));
  ok(/data-reinf="\$\{UI\.esc\(r\.fromId\)\}">↩ Ответить/.test(part), 'на экране у пришедших — кнопка «Ответить»');
  ok(/c\.querySelectorAll\('\[data-reinf\]'\)/.test(part), 'и она отправляет подкрепление');

  console.log('\n[2] Приглашение в легион');
  const L = await reg('Лидер');
  L.dollars = 5e12; L.gold = 1e6;
  groups.create(L, 'legion', 'Стальной кулак', []);
  const T = await reg('Новобранец');
  groups.invite(L, 'legion', T.id, []);
  const box = notifications.list(T).notifications;
  const n = box.find((x) => /легион/i.test(x.title));
  ok(n && n.kind === 'legion_invite', `тип уведомления — legion_invite (${n && n.kind})`);
  ok(/Лидер приглашает вас в легион «Стальной кулак»/.test(n.title), `заголовок: «${n.title}»`);
  ok(n.payload.fromId === L.id && n.payload.groupName === 'Стальной кулак', 'в данных — отправитель и легион');
  ok(/раздел «Легион»/.test(n.payload.text) && !/альянс/i.test(n.payload.text), 'текст ведёт в «Легион», не в «Альянс»');
  ok(!box.some((x) => x.kind === 'alliance_invite'), 'приглашения в альянс не появилось');
  ok(groups.pendingInvites(T, 'legion').some((g) => g.name === 'Стальной кулак'), 'и само приглашение ждёт в легионе');
  ok(/'legion_invite'/.test(push) && /legion_invite: '\/#legion'/.test(push), 'пуш о нём приходит и ведёт в легион');

  console.log('\n[3] Карточка приглашения в уведомлениях');
  const nb = screen.slice(screen.indexOf("n.kind === 'alliance_invite' || n.kind === 'legion_invite'"));
  ok(nb.length > 100 && /От кого/.test(nb.slice(0, 1500)), 'показано, от кого');
  ok(/App\.go\('\$\{toLegion \? 'legion' : 'alliance'\}'\)/.test(nb.slice(0, 2000)), 'кнопка ведёт в нужный раздел');
  ok(/const oldGroup = n\.kind === 'alliance_invite' && !p\.fromId && p\.text;/.test(nb), 'старые приглашения в легион узнаются по тексту без отправителя');

  console.log('\n[4] Гербы в легионе');
  const me = player.mePayload(Object.assign(await reg('Гербоносец'), { ears: 237 }));
  ok(me.crests === 237 && me.ears === undefined, 'игроку гербы приходят полем crests');
  ok(/App\.me\.crests != null \? App\.me\.crests/.test(screen) && !/fmtNum\(App\.me\.ears \|\| 0\)/.test(screen), 'экран легиона читает crests');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
