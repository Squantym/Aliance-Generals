// ═══════════════════════════════════════════════════════════════════
// test/namereset.test.js — двойники позывных и сброс позывного модерацией
//
// Через настоящий HTTP: закрытие игры до смены делает слой http.ts.
//
// Что стережётся:
//  1. Двойники: смешение раскладок, похожие буквы, похожие на
//     зарезервированные — на регистрации, VIP-смене и в «Паспорте».
//  2. Сбросить может «Модерация чатов» или «Баны аккаунтов»; сотрудника —
//     только владелец; владельца — никто; без причины — нельзя.
//  3. «Закрыть игру»: действия отклоняет сервер, смотреть и сменить
//     позывной можно. Бесплатная смена не берёт золото.
//  4. Платная смена берёт цену паспорта; без золота — отказ и «Оставить».
//  5. «Оставить» и смена через «Паспорт» снимают сброс.
//  6. Окно, полоса, кнопки в профиле и в штабе.
//
// Запуск: node test/namereset.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-namereset';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STAFF_2FA_REQUIRED = '0';
process.env.PORT = '3498';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = TEST_CWD + '/data';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const tick = () => new Promise((r) => setTimeout(r, 20));

const BASE = 'http://127.0.0.1:3498';
async function api(m, p, tok, body) {
  const r = await fetch(BASE + p, {
    method: m, headers: { 'Content-Type': 'application/json', 'x-token': tok || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function rejects(promise, part) {
  try { await promise; return null; } catch (e) { return part ? (String(e.message).includes(part) ? String(e.message) : null) : String(e.message); }
}

(async () => {
  require(ROOT + '/dist/server.js');
  await new Promise((r) => setTimeout(r, 1800));
  const auth = require(ROOT + '/dist/src/services/auth');
  const player = require(ROOT + '/dist/src/services/player');
  const db = require(ROOT + '/dist/src/core/db');

  let ipN = 0;
  const reg = async (n) => (await auth.register(n, 'пароль123', `nr${++ipN}@t.ru`, 'ru', '10.0.1.' + ipN)).token;
  const T = {
    owner: await reg('Хозяин'), mod: await reg('Смотритель'), adm: await reg('Куратор'),
    idle: await reg('Стажёр'), bad: await reg('Нарушитель'), tester: await reg('Тестер'),
    plain: await reg('Игрок'), sera: await reg('Сера'),
  };
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const P = {
    owner: by('Хозяин'), mod: by('Смотритель'), adm: by('Куратор'), idle: by('Стажёр'),
    bad: by('Нарушитель'), tester: by('Тестер'), plain: by('Игрок'),
  };
  P.owner.role = 'owner'; P.owner.isAdmin = true;
  P.mod.role = 'moderator';
  P.adm.role = 'admin'; P.adm.isAdmin = true;
  // Права выдаются роли, а не человеку: сотрудник без прав — отдельной ролью
  P.idle.role = 'commissar';
  const zones = db.load('roleZones', {});
  zones.commissar = [];
  zones.moderator = ['chat'];
  zones.admin = ['moderation', 'players'];
  db.save('roleZones');

  console.log('\n[1] Двойники позывных');
  ok(await rejects(reg('Cepa'), 'похож на уже занятый «Сера»'), 'латинская «Cepa» не пройдёт при живой «Сера»');
  ok(await rejects(reg('Сeра'), 'смешивать русские и латинские'), 'смешение раскладок в одном позывном запрещено');
  ok(await rejects(reg('сера'), 'уже занят'), 'та же «сера» строчными — занято');
  ok(await rejects(reg('Вот'), 'зарезервировано'), 'русское «Вот» неотличимо от зарезервированного «bot»');
  P.plain.vipUntil = Date.now() + 10 * 86400000;
  const vipLook = await api('POST', '/api/rename', T.plain, { name: 'Cepa' });
  ok(vipLook.status >= 400 && /похож/.test(vipLook.data.error || ''), 'VIP-смена на двойника отклонена');
  P.plain.gold = 1000;
  const ppLook = await api('POST', '/api/passport/name', T.plain, { newName: 'С e р a' });
  ok(ppLook.status >= 400 && P.plain.gold === 1000, '«Паспорт» тоже не пускает двойника и не берёт золото');
  const acc = fs.readFileSync(path.join(ROOT, 'src/services/account.ts'), 'utf8');
  ok(/require\('\.\/names'\)\.assertFree\(nick\)/.test(acc), 'новый персонаж проверяется так же');

  console.log('\n[2] Кто может сбросить');
  const reset = (tok, target, extra) => api('POST', '/api/mod/name-reset', tok,
    Object.assign({ userId: target.id, reason: 'Оскорбительный позывной', free: true, block: true }, extra || {}));
  ok((await reset(T.plain, P.bad)).status >= 400, 'игроку — нельзя');
  ok((await reset(T.idle, P.bad)).status >= 400, 'администратору без нужных прав — нельзя');
  ok((await reset(T.mod, P.bad, { reason: '' })).status >= 400, 'без причины — нельзя');
  const r1 = await reset(T.mod, P.bad);
  ok(r1.status === 200 && /^general_\d{5,6}$/.test(P.bad.name), `модератор чата сбросил: «Нарушитель» → «${P.bad.name}»`);
  ok((await reset(T.adm, P.mod)).status >= 400, 'администратор не сбрасывает позывной сотрудника');
  ok((await reset(T.mod, P.owner)).status >= 400, 'позывной владельца не сбросить');
  const byOwner = await reset(T.owner, P.idle, { block: false });
  ok(byOwner.status === 200 && /^general_/.test(P.idle.name), 'владелец может сбросить и сотруднику');

  console.log('\n[3] Игра закрыта до смены, смена бесплатна');
  const me = (await api('GET', '/api/me', T.bad)).data;
  ok(me.nameReset && me.nameReset.block === true && me.nameReset.free === true && me.nameReset.from === 'Нарушитель',
     'игрок видит: позывной сброшен, игра закрыта, смена бесплатна');
  const act = await api('POST', '/api/status', T.bad, { text: 'привет' });
  ok(act.status === 403 && act.data.nameResetBlock === true, 'любое действие отклоняет сервер');
  ok((await api('GET', '/api/rewards', T.bad)).status === 200, 'смотреть — можно');
  const twin = await api('POST', '/api/name-reset/rename', T.bad, { name: 'Cepa' });
  ok(twin.status >= 400 && /похож/.test(twin.data.error || ''), 'двойника и здесь не взять');
  const gold0 = P.bad.gold || 0;
  const ren = await api('POST', '/api/name-reset/rename', T.bad, { name: 'Честный' });
  ok(ren.status === 200 && P.bad.name === 'Честный', 'сменил на «Честный»');
  ok((P.bad.gold || 0) === gold0, 'золото не взято');
  ok(!P.bad.nameReset && (await api('POST', '/api/status', T.bad, { text: 'ок' })).status === 200, 'игра снова открыта');
  ok((P.bad.nameHistory || []).length === 2 && P.bad.nameHistory[1].kind === 'reset', 'в истории — сброс и смена');

  console.log('\n[4] Смена за счёт игрока, игра открыта');
  ok((await reset(T.adm, P.tester, { free: false, block: false })).status === 200, 'администратор с «Банами» сбросил');
  ok((await api('POST', '/api/status', T.tester, { text: 'играю' })).status === 200, 'игра не закрыта');
  const tm = (await api('GET', '/api/me', T.tester)).data.nameReset;
  ok(tm && tm.block === false && tm.price === 100, `цена смены — как у паспорта: ${tm && tm.price}`);
  P.tester.gold = 0;
  const poor = await api('POST', '/api/name-reset/rename', T.tester, { name: 'Тестировщик' });
  ok(poor.status >= 400 && /Не хватает золота/.test(poor.data.error || '') && /оставить/.test(poor.data.error || ''),
     'без золота — отказ с подсказкой оставить позывной');
  P.tester.gold = 500;
  const paid = await api('POST', '/api/name-reset/rename', T.tester, { name: 'Тестировщик' });
  ok(paid.status === 200 && P.tester.gold === 400 && P.tester.passport.nameChanges === 1, 'сменил за 100, следующая смена подорожает');

  console.log('\n[5] «Оставить» и смена через «Паспорт»');
  ok((await reset(T.owner, P.plain)).status === 200, 'сброшен Игрок, игра закрыта');
  const kept = P.plain.name;
  ok((await api('POST', '/api/status', T.plain, { text: 'x' })).status === 403, 'закрыто');
  ok((await api('POST', '/api/name-reset/keep', T.plain, {})).status === 200 && P.plain.name === kept && !P.plain.nameReset,
     '«Оставить» — позывной прежний, сброс снят');
  ok((await api('POST', '/api/status', T.plain, { text: 'x' })).status === 200, 'игра открыта');
  ok((await reset(T.owner, P.tester, { free: false, block: true })).status === 200, 'Тестер сброшен снова');
  P.tester.gold = 1000;
  const viaPassport = await api('POST', '/api/passport/name', T.tester, { newName: 'Проверяющий' });
  ok(viaPassport.status === 200 && !P.tester.nameReset && P.tester.gold === 800,
     'смена в «Паспорте» проходит сквозь закрытие и снимает сброс (200 золота — вторая смена)');

  console.log('\n[6] Штаб и профиль');
  const card = (await api('GET', '/api/admin/player-card/' + P.bad.id, T.owner)).data;
  ok(card.can && card.can.nameReset === true && (card.nameHistory || []).length === 2, 'в карточке — право и история позывных');
  const st = (await api('GET', '/api/mod/chat-status/' + P.tester.id, T.mod)).data;
  ok(st.canNameReset === true, 'модератор в профиле видит кнопку сброса');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(/id="pf-namereset"/.test(core) && /showNameResetStaffDialog\(p\.id, p\.name\)/.test(core), 'кнопка в профиле игрока');
  const a2 = fs.readFileSync(path.join(ROOT, 'public/js/admin2/player.js'), 'utf8');
  ok(/data-act="name"/.test(a2) && /\/api\/mod\/name-reset/.test(a2), 'кнопка в карточке штаба');

  console.log('\n[7] Окно и полоса в игре');
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><body><div id="wrap"><div id="pin-news"></div><div id="content"></div></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.location = dom.window.location;
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  localStorage.setItem('gtoken', 't');
  const load = (f, name) => {
    let code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    code += `\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`;
    eval(code);
    return globalThis.__x;
  };
  global.UI = load('public/js/ui.js', 'UI');
  global.API = load('public/js/api.js', 'API');
  UI.toast = () => {};
  global.App = load('public/js/app.js', 'App');
  App.refreshMe = async () => {}; App.rerender = () => {};
  const nr = { at: 1, reason: 'Мат в позывном', from: 'Плохой', current: 'general_12345', free: true, block: true, price: 0, vipFree: false };
  const posted = [];
  API.post = async (url, body) => { posted.push({ url, body }); return { ok: true }; };
  App.showNameGate(nr);
  const gate = document.getElementById('name-gate');
  ok(!!gate && document.getElementById('wrap').style.display === 'none', 'окно закрывает игру');
  ok(/Мат в позывном/.test(gate.textContent) && /general_12345/.test(gate.textContent), 'в окне причина и выданный позывной');
  ok(!!gate.querySelector('#nr-name') && /бесплатно/.test(gate.querySelector('#nr-go').textContent), 'форма смены прямо в окне, смена бесплатна');
  gate.querySelector('#nr-keep').click();
  await tick();
  ok(posted.some((x) => x.url === '/api/name-reset/keep') && !document.getElementById('name-gate')
     && document.getElementById('wrap').style.display === '', '«Оставить» — окно ушло, игра открыта');
  App.me = { nameReset: Object.assign({}, nr, { block: false }) };
  App.renderPinnedNews();
  ok(!!document.getElementById('nr-bar') && !document.querySelector('#nr-bar .pin-news-x'), 'без закрытия игры — полоса над экраном без крестика');
  document.getElementById('nr-bar-go').click();
  ok(!!document.getElementById('nr-dialog') && !!document.querySelector('#nr-dialog #nr-name'), '«Сменить» открывает ту же форму');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 300); });
