// Наёмник «Эйден Роу» (invite_unlimited):
// (1) view отдаёт признак безлимита — кнопка приглашения НЕ гаснет;
// (2) приглашать можно при 0 оставшихся заявок;
// (3) заявки при этом НЕ расходуются (после окончания наёмника лимит цел);
// (4) кнопка гаснет только при упоре в ЛИМИТ АЛЬЯНСА;
// (5) без наёмника всё работает по-старому.
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const pa = require('../dist/src/services/personalAlliance');
const ROOT = process.cwd();
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const throws = (n, fn) => { let t = false; try { fn(); } catch (e) { t = true; } assert.ok(t, '❌ ' + n + ' — не бросил'); passed++; console.log('  ✅ ' + n); };

const MERC = () => ([{ id: 'cmd_envoy_invite_unlimited', name: 'Эйден Роу', type: 'invite_unlimited',
  value: 1, expiresAt: Date.now() + 24 * 3600 * 1000, merc: true }]);

(async () => {
  await db.init();
  await auth.register('Комдив', 'password1', 'k@a.com', 'ru', '1.1.1.1');
  const p = Object.values(player.users()).find(x => x.name === 'Комдив');
  p.level = 100;                 // лимит альянса 1000
  p.allianceMembers = 0; p.allianceRoster = []; p.allianceDiplomats = 4;
  p.allianceInviteLog = []; p.effects = [];

  console.log('\n[1] Без наёмника: лимит работает как раньше');
  let v = pa.view(p);
  eq('лимит = 5 + дипломаты', v.inviteLimit, 9);
  eq('безлимита нет', v.unlimitedInvite, false);
  // Исчерпаем лимит
  for (let i = 0; i < v.inviteLimit; i++) p.allianceInviteLog.push(Date.now());
  v = pa.view(p);
  eq('заявок не осталось', v.invitesLeft, 0);
  throws('без наёмника приглашение отклонено', () => pa.inviteBot(p, []));

  console.log('\n[2] С наёмником: view сообщает о безлимите');
  p.effects = MERC();
  v = pa.view(p);
  eq('безлимит активен', v.unlimitedInvite, true);
  eq('имя наёмника отдаётся', v.unlimitedName, 'Эйден Роу');
  ok('срок действия отдаётся', v.unlimitedUntil > Date.now());
  eq('заявок по-прежнему 0 (но это не мешает)', v.invitesLeft, 0);

  console.log('\n[3] Кнопка НЕ гаснет: приглашение проходит при 0 заявок');
  const before = p.allianceMembers;
  pa.inviteBot(p, []);
  eq('боец принят несмотря на 0 заявок', p.allianceMembers, before + 1);
  // Много подряд
  for (let i = 0; i < 15; i++) pa.inviteBot(p, []);
  eq('принято 16 бойцов подряд', p.allianceMembers, before + 16);

  console.log('\n[4] Заявки НЕ расходуются, пока активен наёмник');
  const logLen = (p.allianceInviteLog || []).length;
  eq('лог заявок не вырос', logLen, 9);
  // Снимаем наёмника — лимит должен остаться прежним, а не «съеденным»
  p.effects = [];
  v = pa.view(p);
  eq('после наёмника лимит прежний', v.inviteLimit, 9);
  eq('использовано столько же, сколько до наёмника', v.invitesUsed, 9);

  console.log('\n[5] Гаснет только при упоре в ЛИМИТ АЛЬЯНСА');
  p.effects = MERC();
  p.allianceInviteLog = [];
  p.level = 1;                    // лимит альянса = 10
  p.allianceMembers = 10; p.allianceRoster = new Array(10).fill({ id: 'x', name: 'b', isBot: true });
  v = pa.view(p);
  eq('лимит альянса 10', v.maxMembers, 10);
  ok('состав упёрся в лимит', v.members >= v.maxMembers);
  throws('при полном альянсе приглашение отклонено даже с наёмником', () => pa.inviteBot(p, []));
  // Освободили место — снова можно
  p.allianceMembers = 9; p.allianceRoster.pop();
  pa.inviteBot(p, []);
  eq('после освобождения места приглашение прошло', p.allianceMembers, 10);

  console.log('\n[6] Фронт: кнопка блокируется по правильному условию');
  const src = fs.readFileSync(path.join(ROOT, 'public/js/screens/social.js'), 'utf8');
  ok('disabled учитывает безлимит', /data\.invitesLeft <= 0 && !data\.unlimitedInvite/.test(src));
  ok('лимит альянса по-прежнему блокирует', /data\.members >= data\.maxMembers/.test(src));
  ok('показывается «без лимита»', /без лимита/.test(src));
  ok('текст кнопки меняется при безлимите', /Пригласить бойца \(без лимита\)/.test(src));
  ok('в групповом альянсе тоже учтено', /g\.unlimitedInvite/.test(src));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
