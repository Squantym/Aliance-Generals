// ═══════════════════════════════════════════════════════════════════
// test/banhide.test.js — скрытый профиль заблокированного игрока
//
// Бан закрывает вход, но профиль нарушителя оставался на виду целиком:
// последний статус («проект шляпа, фармите бабки на ботах»), флаг,
// статистика. Сотрудник при блокировке решает, скрыть ли профиль, —
// тогда игроки видят только позывной, аватар и причину бана.
//
// Что стережётся:
//  1. Скрывает СЕРВЕР: в ответе профиля нет ни статуса, ни статистики.
//     Спрятать поля только в интерфейсе мало — ответ читается и без него.
//  2. Сотрудники с правами видят профиль целиком — им по нему разбираться.
//  3. Скрытие живёт ровно столько, сколько бан: разбан и истёкший срок
//     открывают профиль без отдельной уборки.
//  4. Переключать скрытие вправе только тот, у кого есть «Баны аккаунтов».
//
// Запуск: node test/banhide.test.js   (после npm run build)
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
const roles = require('../dist/src/services/roles');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };
const fails = (n, fn, part) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};

const BAD_STATUS = 'Проект шляпа, всем удачи, фармите бабки на ботах)';

(async () => {
  await db.init();
  for (const [n, e, ip] of [['Хозяин', 'o@t.ru', '1.1.1.1'], ['Куратор', 'a@t.ru', '1.1.1.2'],
                            ['Дозорный', 'm@t.ru', '1.1.1.3'], ['Нарушитель', 'n@t.ru', '1.1.1.4'],
                            ['Зритель', 'v@t.ru', '1.1.1.5']]) {
    await auth.register(n, 'пароль123', e, 'ru', ip);
  }
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const O = by('Хозяин'), A = by('Куратор'), M = by('Дозорный'), N = by('Нарушитель'), V = by('Зритель');
  O.role = 'owner';
  A.role = 'admin';
  M.role = 'moderator';
  const zones = db.load('roleZones', {});
  zones.admin = ['moderation', 'players'];   // куратор банит аккаунты
  zones.moderator = ['chat'];                // «Дозор» — только чаты
  N.status = BAD_STATUS;
  N.avatar = 'm3';
  N.level = 33;
  const nx = [];

  console.log('\n[1] Бан без скрытия — профиль виден как раньше');
  roles.banAccount(O, N.id, 0, 'Нарушение правил проекта', nx);
  const open = player.publicProfile(N, V);
  ok('плашка бана есть', !!open.accountBan);
  eq('статус виден', open.status, BAD_STATUS);
  ok('скрытым профиль не помечен', !open.hiddenByBan);
  roles.unbanAccount(O, N.id, nx);

  console.log('\n[2] Бан со скрытием — игрок видит только позывной, аватар и причину');
  roles.banAccount(O, N.id, 0, 'Нарушение правил проекта', nx, true);
  const hidden = player.publicProfile(N, V);
  eq('профиль помечен скрытым', hidden.hiddenByBan, true);
  eq('позывной на месте', hidden.name, 'Нарушитель');
  eq('аватар на месте', hidden.avatar, 'm3');
  eq('причина бана на месте', hidden.accountBan && hidden.accountBan.reason, 'Нарушение правил проекта');
  ok('статуса в ответе НЕТ вовсе', !JSON.stringify(hidden).includes('шляпа'));
  const allowed = ['id', 'name', 'avatar', 'accountBan', 'hiddenByBan', 'isOwn', 'isBot'];
  const extra = Object.keys(hidden).filter((k) => allowed.indexOf(k) === -1);
  ok(`лишних полей нет${extra.length ? ': ' + extra.join(', ') : ''}`, extra.length === 0);
  for (const k of ['status', 'flag', 'level', 'battle', 'units', 'rating', 'legion', 'alliance', 'country', 'capacity']) {
    ok(`поле «${k}» не отдаётся`, hidden[k] === undefined);
  }
  ok('в плашке сказано, что профиль скрыт', hidden.accountBan.hideProfile === true);

  console.log('\n[3] Сотрудники видят профиль целиком');
  const byOwner = player.publicProfile(N, O);
  ok('владелец видит статус', byOwner.status === BAD_STATUS && !byOwner.hiddenByBan);
  const byAdmin = player.publicProfile(N, A);
  ok('администратор с правами видит статус', byAdmin.status === BAD_STATUS && !byAdmin.hiddenByBan);
  ok('и знает, что игрокам профиль скрыт', byAdmin.accountBan.hideProfile === true);

  console.log('\n[4] Переключатель для уже заблокированного');
  fails('«Дозор» без права «Баны аккаунтов» переключить не может',
        () => roles.setBanHideProfile(M, N.id, false, nx), 'Нет права');
  roles.setBanHideProfile(A, N.id, false, nx);
  eq('открыли — статус снова виден игрокам', player.publicProfile(N, V).status, BAD_STATUS);
  roles.setBanHideProfile(A, N.id, true, nx);
  ok('скрыли снова — статуса нет', player.publicProfile(N, V).hiddenByBan === true);
  fails('у незаблокированного скрывать нечего',
        () => roles.setBanHideProfile(A, V.id, true, nx), 'заблокированного');

  console.log('\n[5] Скрытие живёт ровно столько, сколько бан');
  roles.unbanAccount(O, N.id, nx);
  eq('разбан снимает признак', N.banHideProfile, false);
  eq('и профиль открыт', player.publicProfile(N, V).status, BAD_STATUS);
  roles.banAccount(O, N.id, 60, 'Временный бан', nx, true);
  ok('временный бан со скрытием действует', player.publicProfile(N, V).hiddenByBan === true);
  N.banUntil = Date.now() - 1000;             // срок вышел
  ok('срок вышел — профиль открылся сам', !player.publicProfile(N, V).hiddenByBan);

  console.log('\n[6] Маршруты и права');
  const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  ok('разведданные к скрытому профилю не прикладываются', /!prof\.isOwn && !prof\.hiddenByBan/.test(routes));
  ok('при бане передаётся признак скрытия', /req\.body\.hideProfile === true/.test(routes));
  eq('переключатель под зоной «Баны аккаунтов»', roles.zoneOfPath('/api/admin/account-ban-hide'), 'moderation');
  const fields = fs.readFileSync(path.join(ROOT, 'src/core/playerFields.ts'), 'utf8');
  ok('поле признака заявлено в реестре', /banHideProfile:/.test(fields));

  console.log('\n[7] Интерфейс');
  const appJs = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  const adminJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  ok('в окне бана в игре есть галочка «скрыть профиль»', /id="acc-ban-hide" checked/.test(appJs));
  ok('и она уходит на сервер', /hideProfile: App\._accBanHide !== false/.test(appJs));
  ok('в окне бана в панели — тоже', /id="adm-ahide" checked/.test(adminJs) && /hideProfile: Admin\._accHide !== false/.test(adminJs));

  // Бан из [5] уже истёк — выдаём заново со скрытием, иначе рисовать нечего
  roles.unbanAccount(O, N.id, nx);
  roles.banAccount(O, N.id, 0, 'Нарушение правил проекта', nx, true);

  // Рисуем профиль так, как его увидит игрок
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.location = dom.window.location;
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  const load = (f, name) => {
    let code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    code += `\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`;
    eval(code);
    return globalThis.__x;
  };
  global.UI = load('public/js/ui.js', 'UI');
  global.API = load('public/js/api.js', 'API');
  global.App = load('public/js/app.js', 'App');
  load('public/js/screens/core.js', 'App');
  App.me = { id: V.id, name: V.name, level: 10, staffZones: [] };
  const shown = player.publicProfile(N, V);
  API.get = async () => ({ profile: JSON.parse(JSON.stringify(shown)) });
  const c = document.getElementById('content');
  await App.screens.profile(c, N.id);
  const txt = c.textContent;
  ok('на экране позывной', txt.includes('Нарушитель'));
  ok('и причина бана', txt.includes('Временный бан') || txt.includes('Нарушение правил'));
  ok('статуса на экране нет', !txt.includes('шляпа'));
  ok('кнопок разведки, сообщения и альянса нет',
     !c.querySelector('#pf-spy') && !c.querySelector('#pf-msg') && !c.querySelector('#pf-invite-alliance'));
  ok('объяснено, почему профиль пуст', /скрыт администрацией/.test(txt));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
