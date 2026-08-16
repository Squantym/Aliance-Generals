// jsdom: комната подготовки ГБ — отдельная страница со списками команд,
// переход по баннеру ведёт СРАЗУ в неё, кнопки «В бой» нигде нет.
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"><div id="gb-box"></div></div></body>', { url: 'http://localhost/' });
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, location: dom.window.location });
global.fetch = async () => ({ ok: true, json: async () => ({}) }); localStorage.setItem('gtoken', 't');
function load(f, n) { let c = fs.readFileSync(__dirname + '/../' + f, 'utf8'); c += `\n;globalThis.__x=(typeof ${n}!=='undefined')?${n}:undefined;`; eval(c); return globalThis.__x; }
global.UI = load('public/js/ui.js', 'UI'); global.API = load('public/js/api.js', 'API'); UI.toast = () => {}; UI.confirm = async () => true;
global.App = load('public/js/app.js', 'App'); App.refreshMe = async () => {}; App.rerender = () => {}; App.go = () => {};
load('public/js/screens/war.js', 'App');
App.me = { id: 'me', level: 40 };

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const mk = (id, name, role, isMe) => ({ id, name, roleIcon: role === 'medic' ? '➕' : '⚔',
  roleLabel: role === 'medic' ? 'Медик' : 'Штурмовик', rating: 120, isMe: !!isMe, isBot: id.startsWith('gbot'), flag: 'ru' });

const PREP = {
  active: true, finished: false, state: 'preparing', preparing: true, prepareLeftSec: 27,
  me: { id: 'me', name: 'Я', roleIcon: '➕', roleLabel: 'Медик', maxHp: 1500, maxEnergy: 1000, maxAmmo: 30,
        hp: 1500, energy: 1000, ammo: 30, alive: true, team: 0 },
  allies: [mk('me', 'Я', 'medic', true), mk('a1', 'Соратник', 'assault'), mk('a2', 'Бастион', 'guard'),
           mk('gbot_1', 'Резерв-1', 'assault'), mk('gbot_2', 'Резерв-2', 'assault')],
  enemies: [mk('e1', 'Головорез', 'assault'), mk('e2', 'Санитар', 'medic'), mk('e3', 'Таран', 'assault'),
            mk('gbot_3', 'Резерв-3', 'assault'), mk('gbot_4', 'Резерв-4', 'assault')],
  log: [], watchable: [],
};

const RUNNING = {
  active: true, finished: false, state: 'running', preparing: false,
  me: { id: 'me', name: 'Я', roleIcon: '➕', roleLabel: 'Медик', hp: 1400, maxHp: 1500,
        energy: 900, maxEnergy: 1000, ammo: 28, maxAmmo: 30, alive: true, team: 0, cooldownLeftMs: 0, targetId: null },
  canHeal: true, canGuard: false,
  allies: [{ ...mk('me', 'Я', 'medic', true), hp: 1400, maxHp: 1500, alive: true },
           { ...mk('a1', 'Соратник', 'assault'), hp: 900, maxHp: 1500, alive: true }],
  enemies: [{ ...mk('e1', 'Головорез', 'assault'), hp: 1200, maxHp: 1500, alive: true }],
  log: [{ kind: 'system', text: 'Бой начался!' }], watchable: [],
};

(async () => {
  const box = document.getElementById('gb-box');

  console.log('\n[1] Комната подготовки — отдельная страница на весь экран');
  API.get = async () => JSON.parse(JSON.stringify(PREP));
  App._resetSign('gbBattle');
  await App.renderGroupBattle();
  ok('заголовок комнаты', /КОМНАТА ПОДГОТОВКИ/.test(box.innerHTML));
  ok('открыта поверх интерфейса (полноэкранный режим)', document.body.classList.contains('combat-fullscreen'));
  ok('виден отсчёт до боя', !!document.getElementById('prep-left'));
  ok('сказано, что бой начнётся сам', /начн[её]тся автоматически/i.test(box.innerHTML));

  console.log('\n[2] Списки ОБЕИХ команд поимённо');
  ok('заголовок своей команды', /Ваша команда/.test(box.innerHTML));
  ok('заголовок противников', /Противники/.test(box.innerHTML));
  ok('все свои перечислены', /Соратник/.test(box.innerHTML) && /Бастион/.test(box.innerHTML));
  ok('все чужие перечислены', /Головорез/.test(box.innerHTML) && /Санитар/.test(box.innerHTML) && /Таран/.test(box.innerHTML));
  ok('боты помечены значком', /🤖/.test(box.innerHTML));
  ok('игрок помечен как «вы»', /\(вы\)/.test(box.innerHTML));
  ok('показан рейтинг участников', /rt-badge/.test(box.innerHTML));
  ok('строк ровно 10', box.querySelectorAll('.prep-row').length === 10);

  console.log('\n[3] Никакой кнопки «В бой» в комнате нет');
  ok('кнопки «В БОЙ» нет', !/В БОЙ/.test(box.innerHTML));
  ok('кнопки входа нет', !document.getElementById('gb-enter-fight'));
  ok('панели «вы ещё не вступили» нет', !/не вступили/.test(box.innerHTML));

  console.log('\n[4] Боевых кнопок в комнате тоже нет — бить ещё нельзя');
  ok('нет кнопок атаки', box.querySelectorAll('[data-act="attack"]').length === 0);
  ok('нет кнопок лечения', box.querySelectorAll('[data-act="heal"]').length === 0);

  console.log('\n[5] По истечении таймера — сам бой, без нажатий');
  API.get = async () => JSON.parse(JSON.stringify(RUNNING));
  App._resetSign('gbBattle');
  await App.renderGroupBattle();
  ok('комнаты больше нет', !/КОМНАТА ПОДГОТОВКИ/.test(box.innerHTML));
  ok('появились кнопки атаки', box.querySelectorAll('[data-act="attack"]').length >= 1);
  ok('панели «вы ещё не вступили» нет и здесь', !/не вступили/.test(box.innerHTML));
  ok('кнопки «В БОЙ» нет и здесь', !/В БОЙ/.test(box.innerHTML));
  ok('переключатель порядка блоков на месте', !!document.getElementById('gb-order-toggle'));

  console.log('\n[6] Экран группы во время подготовки ведёт СРАЗУ в комнату');
  // Это и было причиной жалобы: показывалась витрина с кнопкой, пока
  // игрок её искал — 30 секунд истекали, и он попадал в идущий бой.
  const warSrc = fs.readFileSync(__dirname + '/../public/js/screens/war.js', 'utf8');
  ok('условие включает фазу подготовки',
     /state === 'preparing' \|\| d\.battle\.state === 'running'/.test(warSrc));

  let opened = false;
  const realRGB = App.renderGroupBattle;
  App.renderGroupBattle = async () => { opened = true; };
  API.get = async () => ({
    battle: { iAmIn: true, state: 'preparing', needEnter: false, prepareLeftSec: 25 },
    rules: {}, roles: [], secondsLeft: 0, registered: [], history: [], myHistory: [], rating: [],
  });
  App._resetSign('gbLobby');
  const lobbyBox = document.getElementById('gb-box');
  lobbyBox.dataset.mode = '';
  await App.renderGroup();
  ok('во время подготовки открылась комната, а не витрина', opened);
  App.renderGroupBattle = realRGB;

  console.log('\n[7] Баннер в шапке не дёргает удалённый вход для ГБ');
  const appSrc = fs.readFileSync(__dirname + '/../public/js/app.js', 'utf8');
  ok('POST на /api/group/enter из баннера убран', !/api\/group\/enter/.test(appSrc));
  ok('для арены вход сохранён', /api\/arena\/enter/.test(appSrc));
  ok('баннер зовёт в комнату', /Состав собран/.test(appSrc));

  console.log('\n[8] Витрина ГБ: приглашение вместо «занять место»');
  ok('кнопка называется «открыть комнату»', /ОТКРЫТЬ КОМНАТУ/.test(warSrc));
  ok('сказано, что бой начнётся сам', /Бой начн[её]тся сам/.test(warSrc));
  ok('старого POST на вход не осталось', !/API\.post\('\/api\/group\/enter'/.test(warSrc));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})();
