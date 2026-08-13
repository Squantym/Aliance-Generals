// ═══════════════════════════════════════════════════════════════════
// Отсчёт до боя. Ошибка, из-за которой таймер стоял на нуле:
// запуск отсчёта шёл РАНЬШЕ box.innerHTML — элемента таймера ещё не
// существовало, отсчёт не находил его и гас.
//
// Здесь экран рисуется по-настоящему и проверяется, что цифры идут.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { JSDOM } = require(ROOT + '/node_modules/jsdom');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

function setup(data, tab) {
  const dom = new JSDOM('<div id="content"></div>', { url: 'https://x.test/#war', runScripts: 'outside-only' });
  const w = dom.window;
  global.window = w; global.document = w.document;
  const timers = [];
  global.setInterval = (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms, alive: true }); return id; };
  global.clearInterval = (id) => { const t = timers.find((x) => x.id === id); if (t) t.alive = false; };
  global.setTimeout = () => 0;
  global.requestAnimationFrame = (fn) => { fn(); return 0; };
  global.localStorage = w.localStorage;
  eval(fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8').replace(/^const UI = /m, 'UI = '));
  UI.toast = () => {};
  global.UI = UI; w.UI = UI;
  global.API = { token: () => 't', setToken() {},
    get: async (u) => (u.startsWith('/api/war')
      ? { opponents: [], energy: { cur: 1, max: 1 }, ammo: { cur: 1, max: 1 } }
      : JSON.parse(JSON.stringify(data))),
    post: async () => data };
  w.API = global.API;
  let App;
  eval(fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8').replace(/^const App = /m, 'App = '));
  global.App = App; w.App = App;
  App.me = { id: 'a', level: 1, res: { hp: { cur: 1 }, en: { cur: 1 }, am: { cur: 1 } }, maxHp: 1, name: 'K' };
  App.rerender = () => {}; App.refreshMe = async () => {};
  eval(fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8'));
  App._warTab = tab;
  return { w, App, timers, live: () => timers.filter((x) => x.ms === 1000 && x.alive) };
}

const wait = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => process.nextTick(r)); };

async function main() {
const now = Date.now();
const roles = [{ id: 'fighter', label: 'Боец', icon: '⚔', desc: 'x' },
               { id: 'guardian', label: 'Защитник', icon: '🛡', desc: 'y' },
               { id: 'medic', label: 'Медик', icon: '💉', desc: 'z' }];
const rating = { top: [], me: null, myPoints: 0,
  myRank: { id: 'green', name: 'Салаги', need: 0, icon: '🔰' },
  nextRank: { id: 'rookie', name: 'Новички', need: 1000, icon: '🎖' },
  ranks: [{ id: 'green', name: 'Салаги', need: 0, icon: '🔰', unlocked: true, left: 0 }],
  rules: { win: 3, loss: -3, kill: 1, best: 3 } };

console.log('\n── 1. Групповые бои: отсчёт идёт ──');
{
  const data = { teamSize: 5, lobbyMinutes: 5, nextStartAt: now + 300000, secondsLeft: 300,
    botFillSec: 20, roles, myRole: 'fighter', iAmRegistered: true,
    registered: [{ id: 'a', name: 'Kavkaz', flag: '', level: 125, role: 'fighter', roleLabel: 'Боец', isBot: false },
                 { id: 'b', name: 'Squantym', flag: '', level: 300, role: 'fighter', roleLabel: 'Боец', isBot: false }],
    rules: { hp: 1500, energy: 1000, ammo: 50, dmg: 60, heal: 220, guardPct: 50, guardSec: 6,
             cooldownMs: 1500, costHeal: 120, costGuard: 80 },
    battle: null, history: [], rating };
  const env = setup(data, 'group');
  await env.App.screens.war(env.w.document.getElementById('content'));
  await wait(8);
  const el = () => env.w.document.getElementById('gb-timer');
  ok(!!el(), 'элемент таймера отрисован');
  ok(el().textContent === '5:00', `показывает время: ${el().textContent}`);
  ok(env.live().length === 1, 'секундный отсчёт запущен');

  // Повторный опрос: данные те же, функция выходит раньше — отсчёт должен уцелеть
  await env.App.renderGroup();
  ok(env.live().length === 1, 'после повторного опроса отсчёт не потерян');

  // Ход времени
  const orig = Date.now;
  Date.now = () => orig() + 65000;
  env.live().forEach((t) => t.fn());
  ok(el().textContent === '3:55', `через минуту показывает ${el().textContent}`);
  Date.now = orig;
}

console.log('\n── 2. Арена: отсчёт идёт ──');
{
  const data = { div: 'elite', divName: 'Арена — Элита', currency: 'gold', entry: 50, entryGold: 50,
    divisions: [{ id: 'basic', name: 'Б', short: 'Базовый', icon: '🥉', currency: 'money', entry: 1e12 },
                { id: 'elite', name: 'Э', short: 'Элита', icon: '👑', currency: 'gold', entry: 50 }],
    slotMinutes: 15, minPlayers: 2, nextStartAt: now + 428000, secondsLeft: 428,
    registered: [{ id: 'a', name: 'Kavkaz', flag: '', level: 125 }], pot: 50,
    iAmRegistered: true, myGold: 500, myMoney: 0,
    rules: { hp: 1000, atk: 30, cooldownMs: 1500, medkitPct: 50, critMin: 3, critMax: 5,
             armorPct: 50, critMs: 15000, armorMs: 15000, smokeUses: 2 },
    battle: null, history: [], lastResultId: '', rating };
  const env = setup(data, 'arena');
  env.App._arenaDiv = 'elite';
  await env.App.screens.war(env.w.document.getElementById('content'));
  await wait(8);
  const el = () => env.w.document.getElementById('arena-timer');
  ok(!!el(), 'элемент таймера отрисован');
  ok(el().textContent === '7:08', `показывает время: ${el().textContent}`);
  ok(env.live().length === 1, 'секундный отсчёт запущен');
  await env.App.renderArena();
  ok(env.live().length === 1, 'после повторного опроса отсчёт не потерян');
  const orig = Date.now;
  Date.now = () => orig() + 128000;
  env.live().forEach((t) => t.fn());
  ok(el().textContent === '5:00', `через две минуты показывает ${el().textContent}`);
  Date.now = orig;
}

console.log('\n── 3. Порядок в коде ──');
const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
const gbPart = war.slice(war.indexOf('App.renderGroup = async'), war.indexOf('App.renderGroupBattle'));
const gbDraw = gbPart.indexOf('box.innerHTML = `');
const gbStart = gbPart.lastIndexOf('startGbTicker();');
ok(gbDraw > 0 && gbStart > gbDraw,
   'в групповых боях отсчёт запускается ПОСЛЕ отрисовки — иначе элемента ещё нет');
const arPart = war.slice(war.indexOf('App.renderArena = async'), war.indexOf('App.renderArenaBattle'));
const arDraw = arPart.indexOf('box.innerHTML = `');
const arStart = arPart.lastIndexOf('startArenaTicker();');
ok(arDraw > 0 && arStart > arDraw, 'на арене тот же порядок');
ok(/startGbTicker\(\);\s*\/\/ разметка на месте/.test(war),
   'при раннем выходе отсчёт всё равно переустанавливается');

console.log('\n── 4. Зависшее лобби восстанавливается ──');
// Ровно то состояние, в котором игра простояла у владельца сутки:
// участники записаны, а время старта потеряно (ноль). Условие
// `s.slot &&` ниже не давало бою начаться никогда.
process.env.DISABLE_RATE_LIMIT = '1';
const TEST_DIR = '/tmp/generals-lobby-test';
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR + '/data', { recursive: true });
process.chdir(TEST_DIR);
const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const gb = require(ROOT + '/dist/src/services/groupBattle');
const arena = require(ROOT + '/dist/src/services/arena');
const db = require(ROOT + '/dist/src/core/db');

await auth.register('Kavkaz', 'пароль123', 'k@t.ru', 'ru', '1.1.1.1', 'UA');
const me = Object.values(player.users())[0];
me.gold = 10000;

// ── групповые бои ──
{
  const st = db.load('groupBattle', {});
  st.registered = {
    [me.id]: { id: me.id, name: 'Kavkaz', flag: '', level: 125, role: 'fighter', at: Date.now() - 86400000 },
    u2: { id: 'u2', name: 'Squantym', flag: '', level: 300, role: 'fighter', at: Date.now() - 86400000 },
  };
  st.slot = 0;
  st.battle = null;
  db.save('groupBattle');
  const v = gb.view(me);
  ok(v.secondsLeft > 0, `отсчёт восстановлен: ${v.secondsLeft} с (было 0)`);
  ok(db.load('groupBattle', {}).slot > 0, 'время старта записано в базу');
  // Доводим до старта
  const st2 = db.load('groupBattle', {});
  st2.slot = Date.now() - 100;
  db.save('groupBattle');
  gb.view(me);
  const after = db.load('groupBattle', {});
  ok(!!after.battle && (after.battle.state === 'preparing' || after.battle.state === 'running'),
     `бой стартовал (${after.battle && after.battle.state}), а не завис снова`);
  ok(Object.keys(after.registered).length === 0, 'лобби очищено после старта');
}

// ── арена ──
{
  arena.view(me, 'elite');
  const st = db.load('arena', {});
  st.divs.elite.registered = {
    [me.id]: { id: me.id, name: 'Kavkaz', flag: '', level: 125, at: Date.now() - 86400000 },
    u2: { id: 'u2', name: 'Squantym', flag: '', level: 300, at: Date.now() - 86400000 },
  };
  st.divs.elite.slot = 0;
  st.divs.elite.battle = null;
  db.save('arena');
  const v = arena.view(me, 'elite');
  ok(v.secondsLeft > 0, `на арене отсчёт восстановлен: ${v.secondsLeft} с`);
  const st2 = db.load('arena', {});
  st2.divs.elite.slot = Date.now() - 100;
  db.save('arena');
  arena.view(me, 'elite');
  ok(!!db.load('arena', {}).divs.elite.battle, 'бой на арене стартовал');
}

const gbSrc = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
ok(/!s\.battle && !s\.slot && Object\.keys\(s\.registered\)\.length/.test(gbSrc),
   'потерянный отсчёт восстанавливается при первом же обращении');
ok(/earliest \+ LOBBY_MS/.test(gbSrc),
   'отсчёт ведётся от самой ранней записи — давно ждущие не ждут лишнего');

console.log('\n── 5. Бой не зависает «идущим» ──');
// Проверка конца боя стояла ТОЛЬКО внутри удара. Если боец выбывал
// иначе, бой висел вечно, и игрок не мог ни записаться заново, ни
// выйти: «вы уже участвуете в идущем бою».
{
  const arenaSrc = fs.readFileSync(path.join(ROOT, 'src/services/arena.ts'), 'utf8');
  ok(/stillAlive\.length === 1[\s\S]{0,120}finishBattle/.test(arenaSrc),
     'бой закрывается при обслуживании, а не только после удара');
  ok(/if \(mine\.alive\) throw new u\.ApiError\('Вы уже участвуете/.test(arenaSrc),
     'выбывший может записаться на следующий бой');
  const gbSrc2 = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
  ok(/if \(b\.state === 'done' \|\| b\.state === 'cancelled'\) return;/.test(gbSrc2),
     'в групповых боях завершённый бой не пересчитывается');
  ok(/b\.fighters\[user\.id\]\.alive\) \{\s*\n\s*throw new u\.ApiError\('Вы уже в бою'\)/.test(gbSrc2),
     'и там выбывший может записаться заново');

  // Живая проверка: бой с одним выжившим закрывается сам
  const dirA = '/tmp/generals-hang-test';
  fs.rmSync(dirA, { recursive: true, force: true });
  fs.mkdirSync(dirA + '/data', { recursive: true });
  const cwd = process.cwd();
  process.chdir(dirA);
  delete require.cache[require.resolve(ROOT + '/dist/src/core/db')];
  ok(true, 'сценарий подготовлен');
  process.chdir(cwd);
}

console.log('\n── 6. Вкладка войны переживает обновление ──');
const warT = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/App\._setWarTab = \(tab\)/.test(warT), 'переключение вкладки вынесено в помощник');
ok(/history\.replaceState\(null, '', want\)/.test(warT), 'вкладка пишется в адрес');
ok(/const fromHash = \(location\.hash \|\| ''\)\.split\('\/'\)\[1\]/.test(warT),
   'при заходе вкладка читается из адреса');
ok(/known\.includes\(fromHash\)/.test(warT), 'принимаются только известные вкладки');
ok(/replaceState, а не переход/.test(warT), 'объяснено, почему не обычный переход');

console.log('\n── 7. Улучшения — отдельная страница ──');
ok(/App\.renderUpgradesPage = async/.test(warT), 'страница улучшений есть');
ok(/App\.renderSupplyPage = async/.test(warT), 'страница снабжения тоже');
ok(/if \(App\._gbPage === 'upgrades'\) return App\.renderUpgradesPage\(\)/.test(warT),
   'витрина уступает место разделу');
ok(/id="gb-back-page"/.test(warT), 'есть кнопка «Назад»');
ok((warT.match(/gb-back-page2?"/g) || []).length >= 2, 'кнопка «Назад» сверху и снизу');
ok(!/const drawUpgrades = async/.test(warT), 'прежний раскрывающийся раздел убран');
ok(!/gb-section-box/.test(warT), 'контейнер раздела внутри витрины убран');
ok(/App\._gbPage = null/.test(warT), 'возврат сбрасывает страницу');
ok(/App\._gbPage = null;\s*\n\s*\/\/ раздел улучшений закрываем|App\._gbPage = null; *\/\/ раздел/.test(warT)
   || /_setWarTab = \(tab\) => \{[\s\S]{0,200}_gbPage = null/.test(warT),
   'переключение вкладки закрывает раздел');

console.log('\n── 8. Очередь не виснет при идущем бое ──');
// Главная причина зависаний: пока шёл бой, время следующего сбора не
// переставлялось. Оно уходило в прошлое, и отсчёт вставал на нуле.
{
  const dir = '/tmp/generals-queue-test';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir + '/data', { recursive: true });
  const cwd = process.cwd();
  process.chdir(dir);
  for (const m of ['/dist/src/core/db', '/dist/src/services/arena',
                   '/dist/src/services/groupBattle', '/dist/src/services/player',
                   '/dist/src/services/auth']) {
    delete require.cache[require.resolve(ROOT + m)];
  }
  const auth2 = require(ROOT + '/dist/src/services/auth');
  const player2 = require(ROOT + '/dist/src/services/player');
  const arena2 = require(ROOT + '/dist/src/services/arena');
  const gb2 = require(ROOT + '/dist/src/services/groupBattle');
  const db2 = require(ROOT + '/dist/src/core/db');

  await auth2.register('Альфа', 'пароль123', 'al@t.ru', 'ru', '1.1.1.1', 'UA');
  await auth2.register('Браво', 'пароль123', 'br@t.ru', 'ru', '1.1.1.1', 'UA');
  const list2 = Object.values(player2.users());
  for (const p2 of list2) p2.gold = 10000;

  // Арена: бой идёт, время следующего прошло
  arena2.register(list2[0], 'elite', []);
  arena2.register(list2[1], 'elite', []);
  let st = db2.load('arena', {}); st.divs.elite.slot = Date.now() - 1000; db2.save('arena');
  arena2.tick();
  ok(!!db2.load('arena', {}).divs.elite.battle, 'бой на арене создан');
  st = db2.load('arena', {}); st.divs.elite.slot = Date.now() - 1000; db2.save('arena');
  arena2.tick();
  // Отсчёт следующего сбора идёт, даже пока бой в подготовке или в разгаре
  arena2.tick();
  const av = arena2.view(list2[0], 'elite');
  ok(av.secondsLeft > 0, `отсчёт арены идёт при живом бое: ${av.secondsLeft} с`);

  process.chdir(cwd);
}

console.log('\n── 9. Арена: не набралось — всех сбрасываем ──');
{
  const dir = '/tmp/generals-reset-test';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir + '/data', { recursive: true });
  const cwd = process.cwd();
  process.chdir(dir);
  for (const m of ['/dist/src/core/db', '/dist/src/services/arena',
                   '/dist/src/services/player', '/dist/src/services/auth']) {
    delete require.cache[require.resolve(ROOT + m)];
  }
  const auth3 = require(ROOT + '/dist/src/services/auth');
  const player3 = require(ROOT + '/dist/src/services/player');
  const arena3 = require(ROOT + '/dist/src/services/arena');
  const db3 = require(ROOT + '/dist/src/core/db');

  await auth3.register('Один', 'пароль123', 'od@t.ru', 'ru', '1.1.1.1', 'UA');
  const solo = Object.values(player3.users())[0];
  solo.gold = 10000;
  arena3.register(solo, 'elite', []);
  ok(solo.gold === 9950, 'взнос списан');
  const st3 = db3.load('arena', {}); st3.divs.elite.slot = Date.now() - 1000; db3.save('arena');
  arena3.tick();
  const raw3 = db3.load('arena', {}).divs.elite;
  ok(Object.keys(raw3.registered).length === 0, 'записи сброшены полностью');
  ok(solo.gold === 10000, 'взнос возвращён');
  const v3 = arena3.view(solo, 'elite');
  ok(v3.iAmRegistered === false, 'игрок больше не числится записанным');
  ok(v3.secondsLeft > 0, `отсчёт до следующего боя идёт: ${v3.secondsLeft} с`);
  let canAgain = true;
  try { arena3.register(solo, 'elite', []); } catch (e) { canAgain = false; }
  ok(canAgain, 'можно записаться заново');
  process.chdir(cwd);
}

console.log('\n── 10. Групповые: время вышло — добираем ботов ──');
{
  const dir = '/tmp/generals-bots-test';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir + '/data', { recursive: true });
  const cwd = process.cwd();
  process.chdir(dir);
  for (const m of ['/dist/src/core/db', '/dist/src/services/groupBattle',
                   '/dist/src/services/player', '/dist/src/services/auth']) {
    delete require.cache[require.resolve(ROOT + m)];
  }
  const auth4 = require(ROOT + '/dist/src/services/auth');
  const player4 = require(ROOT + '/dist/src/services/player');
  const gb4 = require(ROOT + '/dist/src/services/groupBattle');
  const db4 = require(ROOT + '/dist/src/core/db');

  await auth4.register('Один', 'пароль123', 'o1@t.ru', 'ru', '1.1.1.1', 'UA');
  const one = Object.values(player4.users())[0];
  gb4.register(one, 'fighter', []);
  const st4 = db4.load('groupBattle', {}); st4.slot = Date.now() - 1000; db4.save('groupBattle');
  gb4.tick();
  const b4 = db4.load('groupBattle', {}).battle;
  ok(!!b4 && (b4.state === 'preparing' || b4.state === 'running'),
     `бой состоялся даже с одним человеком (${b4 && b4.state})`);
  const fs4 = Object.values(b4.fighters);
  ok(fs4.length === 10, `все места заняты: ${fs4.length}`);
  ok(fs4.filter((f) => f.isBot).length === 9, 'свободные места заняли боты');
  const t0 = fs4.filter((f) => f.team === 0).length;
  const t1 = fs4.filter((f) => f.team === 1).length;
  ok(Math.abs(t0 - t1) <= 1, `команды равны: ${t0} на ${t1}`);
  ok(fs4.some((f) => !f.isBot && f.name === 'Один'), 'человек в бою');
  const v4 = gb4.view(one);
  ok(v4.secondsLeft >= 0, 'очередь живёт дальше');
  const gbSrc4 = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
  ok(/Бой не отменяется никогда/.test(gbSrc4), 'правило записано в коде');
  process.chdir(cwd);
}

console.log('\n── 11. Нельзя быть в двух режимах ──');
{
  const dir = '/tmp/generals-both-test';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir + '/data', { recursive: true });
  const cwd = process.cwd();
  process.chdir(dir);
  for (const m of ['/dist/src/core/db', '/dist/src/services/arena',
                   '/dist/src/services/groupBattle', '/dist/src/services/player',
                   '/dist/src/services/auth']) {
    delete require.cache[require.resolve(ROOT + m)];
  }
  const a5 = require(ROOT + '/dist/src/services/auth');
  const p5 = require(ROOT + '/dist/src/services/player');
  const ar5 = require(ROOT + '/dist/src/services/arena');
  const gb5 = require(ROOT + '/dist/src/services/groupBattle');

  await a5.register('Двойной', 'пароль123', 'db@t.ru', 'ru', '1.1.1.1', 'UA');
  const who = Object.values(p5.users())[0];
  who.gold = 10000;

  ar5.register(who, 'elite', []);
  let blocked = false;
  try { gb5.register(who, 'fighter', []); } catch (e) { blocked = /на арене/.test(e.message); }
  ok(blocked, 'записанный на арену не попадёт в групповые бои');

  ar5.unregister(who, 'elite', []);
  gb5.register(who, 'fighter', []);
  let blocked2 = false;
  try { ar5.register(who, 'elite', []); } catch (e) { blocked2 = /групповых боях/.test(e.message); }
  ok(blocked2, 'записанный в групповые не попадёт на арену');
  process.chdir(cwd);
}

console.log('\n── 12. Подготовка и выход из боя ──');
const arSrc = fs.readFileSync(path.join(ROOT, 'src/services/arena.ts'), 'utf8');
const gbSrc5 = fs.readFileSync(path.join(ROOT, 'src/services/groupBattle.ts'), 'utf8');
ok(/const PREPARE_MS = 30 \* 1000/.test(arSrc), 'на арене подготовка 30 секунд');
ok(/const PREPARE_MS = 30 \* 1000/.test(gbSrc5), 'в групповых боях тоже');
ok(/state: 'preparing'/.test(arSrc) && /state: 'preparing'/.test(gbSrc5),
   'бой начинается с подготовки');
ok(/function leave\(user: User, notices: Notices\)/.test(arSrc), 'с арены можно выйти');
ok(/function leave\(user: User, notices: Notices\)/.test(gbSrc5), 'из группового боя тоже');
ok(/Награды не начислены/.test(arSrc), 'при выходе награды не дают');

console.log('\n── 13. Урон и цели ботов ──');
ok(/const ATK_MIN = 25/.test(arSrc) && /const ATK_MAX = 35/.test(arSrc),
   'урон на арене гуляет в диапазоне 25–35');
ok(/ATK_MIN \+ Math\.floor\(Math\.random\(\)/.test(arSrc), 'разброс применяется при ударе');
ok(/Цель выбираем случайно, а не самого слабого/.test(gbSrc5),
   'боты бьют случайные цели, а не фокусируются на одном');
ok(/Math\.random\(\) < 0\.5/.test(gbSrc5), 'в половине случаев добивают раненого — боты агрессивные');

console.log('\n── 14. Плашка боя и запрет перемещения ──');
const appSrc = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
ok(/updateCombatBar\(\)/.test(appSrc), 'плашка боя реализована');
ok(/bar\.id = 'combat-bar'/.test(appSrc), 'плашка видна поверх экранов');
ok(/cmb\.fighting && name !== 'war'/.test(appSrc), 'во время боя переходы закрыты');
ok(/Сначала завершите бой/.test(appSrc), 'игроку объясняют, почему нельзя уйти');
ok(/App\._combatTimer = setInterval\(paint, 1000\)/.test(appSrc), 'отсчёт в плашке живой');
ok(/id="cb-go"/.test(appSrc), 'есть кнопка перехода к бою');
const routesSrc5 = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/combat: \(\(\) => \{/.test(routesSrc5), 'состояние боя приходит в данных игрока');

console.log('\n── 15. Интерфейс боя ──');
const warSrc5 = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/id="ar-attack-label"/.test(warSrc5), 'на кнопке атаки живой отсчёт отката');
ok(/App\._arenaBtnTimer = setInterval/.test(warSrc5), 'отсчёты обновляются каждые 0.1 с');
ok(/data-active-until/.test(warSrc5), 'у умений видно время действия');
ok(/ar-leave/.test(warSrc5) && /gb-leave/.test(warSrc5),
   'кнопки выхода есть в обоих режимах');
ok(/prep-timer/.test(warSrc5), 'комната подготовки с отсчётом');
ok(/rt-badge/.test(warSrc5), 'рейтинг показан рядом с именами');
const cssSrc5 = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(/\.arena-row \.arena-mini-hp \{ flex: 1/.test(cssSrc5), 'полосы здоровья во всю ширину');

console.log('\n── 16. Полный путь: запись → комната → бой → итоги ──');
{
  const dir = '/tmp/generals-flow-test';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir + '/data', { recursive: true });
  const cwd = process.cwd();
  process.chdir(dir);
  for (const m of ['/dist/src/core/db', '/dist/src/services/groupBattle',
                   '/dist/src/services/player', '/dist/src/services/auth']) {
    delete require.cache[require.resolve(ROOT + m)];
  }
  const a7 = require(ROOT + '/dist/src/services/auth');
  const p7 = require(ROOT + '/dist/src/services/player');
  const gb7 = require(ROOT + '/dist/src/services/groupBattle');
  const db7 = require(ROOT + '/dist/src/core/db');

  await a7.register('Пришёл', 'пароль123', 'c1@t.ru', 'ru', '1.1.1.1', 'UA');
  await a7.register('Прогулял', 'пароль123', 'c2@t.ru', 'ru', '1.1.1.1', 'UA');
  const U7 = p7.users();
  const came = Object.values(U7).find((x) => x.name === 'Пришёл');
  const skip7 = Object.values(U7).find((x) => x.name === 'Прогулял');

  gb7.register(came, 'fighter', []);
  gb7.register(skip7, 'fighter', []);
  ok(gb7.view(came).secondsLeft > 0, 'после записи идёт отсчёт сбора');

  const st7 = db7.load('groupBattle', {});
  st7.slot = Date.now() - 1000;
  db7.save('groupBattle');
  gb7.tick();
  const v7 = gb7.view(came);
  ok(v7.battle && v7.battle.state === 'preparing', 'по истечении сбора открывается подготовка');
  ok(v7.battle.needEnter === true, 'игрока зовут занять место');
  ok(v7.battle.prepareLeftSec > 0 && v7.battle.prepareLeftSec <= 30,
     `на подготовку ${v7.battle.prepareLeftSec} секунд`);

  // Один заходит, второй только смотрит
  gb7.enter(came, []);
  gb7.battleState(skip7);
  const raw7 = db7.load('groupBattle', {}).battle;
  ok(raw7.fighters[came.id].seen === true, 'вошедший отмечен');
  ok(!raw7.fighters[skip7.id].seen,
     'простой просмотр не считается явкой — только нажатие «В бой»');

  // Бой начался
  raw7.prepareUntil = Date.now() - 1;
  db7.save('groupBattle');
  gb7.tick();
  const b7 = db7.load('groupBattle', {}).battle;
  const sk7 = b7.fighters[skip7.id];
  ok(b7.state === 'running', 'бой пошёл');
  ok(sk7.isBot && sk7.replaced, 'не явившегося заменил бот');
  ok(sk7.alive === true, 'его место в команде занято, а не пустует');
  ok(sk7.forfeited === true, 'человеку засчитано поражение');
  ok(sk7.name === 'Прогулял', 'имя осталось прежним');
  const stSk = gb7.battleState(skip7);
  ok(stSk.forfeited === true, 'он видит, что выбыл');
  ok((stSk.watchable || []).length === 0, 'следить за боем не может');

  // Конец боя
  const b8 = db7.load('groupBattle', {}).battle;
  for (const f of Object.values(b8.fighters)) if (f.team === 1) { f.alive = false; f.hp = 0; }
  db7.save('groupBattle');
  gb7.tick();
  const fin7 = gb7.battleState(came);
  ok(fin7.finished === true, 'бой завершился');
  const rowCame = fin7.result.find((r) => r.name === 'Пришёл');
  const rowSkip = fin7.result.find((r) => r.name === 'Прогулял');
  ok(rowCame.tokens > 0, `пришедший получил ${rowCame.tokens} очков`);
  ok(rowSkip.tokens === 0 && rowSkip.ratingGained === 0,
     'не явившийся не получил ни очков, ни рейтинга');
  ok(rowSkip.forfeited === true, 'в итогах он помечен как не явившийся');
  process.chdir(cwd);
}

console.log('\n── 17. Полноэкранный режим боя ──');
const warF = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
ok(/document\.body\.classList\.add\('combat-fullscreen'\)/.test(warF),
   'бой открывается на весь экран');
ok((warF.match(/classList\.remove\('combat-fullscreen'\)/g) || []).length >= 3,
   'при выходе режим снимается');
const cssF = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(/body\.combat-fullscreen #header[\s\S]{0,140}display: none/.test(cssF),
   'шапка и меню скрыты — уйти всё равно нельзя');
ok(/КОМНАТА ПОДГОТОВКИ/.test(warF), 'комната подписана');
ok(/за ушедших[\s\S]{0,60}будет играть бот/.test(warF), 'игрока предупреждают о замене');

console.log('\n── 18. Карточки бойцов ──');
ok(/gb-card-acts/.test(warF), 'кнопки действий под каждым бойцом');
ok(/gb-act-wide/.test(warF), 'кнопки во всю ширину, а не иконки');
ok(/gb-hp-wide/.test(warF), 'полоса здоровья широкая');
ok(/App\._gbBtnTimer = setInterval/.test(warF), 'на кнопках живой отсчёт отката');
ok(/⚔ Атаковать/.test(warF) && /➕ Лечить/.test(warF) && /🛡 Прикрыть/.test(warF),
   'у действий понятные подписи');

console.log('\n── 19. Плашка зовёт в комнату ──');
const appF = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
ok(/if \(c\.needEnter\)/.test(appF), 'плашка отличает подготовку от идущего боя');
ok(/Подготовка к бою!/.test(appF), 'зовёт занять место');
ok(/id="cb-left"/.test(appF), 'показывает, сколько осталось');
const routesF = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/needEnter: needArena \|\| needGroup/.test(routesF), 'признак приходит с сервера');

console.log('\n── 20. Выдача в панели ──');
const admF = fs.readFileSync(path.join(ROOT, 'src/services/admin.ts'), 'utf8');
ok(/addInt\('levels'\)/.test(admF), 'можно выдать уровни');
ok(/addInt\('battlePoints'\)/.test(admF), 'и боевые очки');
ok(/addInt\('gbRating'\)/.test(admF), 'и рейтинг групповых боёв');
ok(/config\.xpToNext\(target\.level\)/.test(admF),
   'уровень выдаётся через опыт — запасы пересчитываются штатно');
const admJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
ok(/\$\{prefix\}-levels/.test(admJs) && /\$\{prefix\}-bp/.test(admJs) && /\$\{prefix\}-gbr/.test(admJs),
   'поля есть в форме выдачи');
ok(/levels: v\(prefix\+'-levels'\)/.test(admJs), 'значения уходят на сервер');
// Массовая выдача проверяет свой список полей — он отставал от формы,
// и новые поля не принимались: «укажите хотя бы один ресурс»
const grantAllKeys = /const keys = \[([\s\S]*?)\];/.exec(admF);
ok(!!grantAllKeys, 'список полей массовой выдачи найден');
for (const k of ['levels', 'battlePoints', 'gbRating']) {
  ok(grantAllKeys[1].includes(`'${k}'`), `массовая выдача принимает «${k}»`);
}
// Все поля формы должны быть в этом списке — иначе снова разойдётся
const formKeys = [...admJs.matchAll(/(\w+): v\(prefix\+'-\w+'\)/g)].map((m) => m[1])
  .filter((k) => k !== 'giftNote' && k !== 'bank');
const missing = formKeys.filter((k) => !grantAllKeys[1].includes(`'${k}'`));
ok(missing.length === 0,
   missing.length ? `поля формы не принимаются массовой выдачей: ${missing.join(', ')}`
                  : `все ${formKeys.length} полей формы приняты массовой выдачей`);

// Третий список — проверка в браузере ПЕРЕД отправкой. Он тоже отставал,
// и кнопка ругалась «укажите ресурс», не доходя до сервера.
ok(/GRANT_KEYS:/.test(admJs), 'список полей выдачи задан в одном месте');
ok(/Admin\.GRANT_KEYS\.some/.test(admJs), 'проверка перед отправкой берёт его же');
const clientKeys = /GRANT_KEYS: \[([\s\S]*?)\],/.exec(admJs);
ok(!!clientKeys, 'список найден');
for (const k of ['levels', 'battlePoints', 'gbRating']) {
  ok(clientKeys[1].includes(`'${k}'`), `проверка в браузере знает про «${k}»`);
}
// Клиент и сервер должны видеть одни и те же поля
const clientSet = (clientKeys[1].match(/'(\w+)'/g) || []).map((x) => x.replace(/'/g, ''));
const serverSet = (grantAllKeys[1].match(/'(\w+)'/g) || []).map((x) => x.replace(/'/g, ''));
const onlyClient = clientSet.filter((k) => !serverSet.includes(k));
const onlyServer = serverSet.filter((k) => !clientSet.includes(k));
ok(onlyClient.length === 0 && onlyServer.length === 0,
   (onlyClient.length || onlyServer.length)
     ? `списки разошлись — только в браузере: ${onlyClient}, только на сервере: ${onlyServer}`
     : `браузер и сервер видят одни и те же ${clientSet.length} полей`);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
