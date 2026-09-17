// ═══════════════════════════════════════════════════════════════════
// test/team-ui.test.js — вкладка «Командные сражения» (jsdom)
//
// Что стережётся:
//  1. На войне вкладки: Вторжение → Командные сражения → Санкции →
//     Событие; внутри — Групповые бои, Арена, Рейтинговые бои.
//  2. Групповые бои: запрос к /api/squad, картинка-превью, взнос и
//     приз, реальные характеристики, нет рангов, улучшений и снабжения.
//  3. Рейтинговые бои: запрос к /api/group, БЕЗ картинки, с рангом,
//     улучшениями и снабжением.
//  4. Старые адреса #war/group и #war/arena открывают нужные разделы.
//  5. Боевое окно групповых: карточка реальных характеристик, итог с
//     деньгами; действие уходит на /api/squad/act.
//  6. Плашка боя ведёт в нужный раздел и подписана по режиму.
//
// Запуск: node test/team-ui.test.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { JSDOM } = require(ROOT + '/node_modules/jsdom');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const wait = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const roles = [{ id: 'fighter', label: 'Штурмовик', icon: '🎯', desc: 'x' },
               { id: 'guardian', label: 'Защитник', icon: '🛡', desc: 'y' },
               { id: 'medic', label: 'Медик', icon: '➕', desc: 'z' }];
const now = Date.now();
const SQUAD = {
  mode: 'squad', teamSize: 5, lobbyMinutes: 5, nextStartAt: now + 200000, secondsLeft: 200, botFillSec: 10,
  entry: 1e9, prize: 2e9, myMoney: 5e9, roles, myRole: 'fighter', iAmRegistered: false,
  registered: [{ id: 'a', name: 'Альфа', flag: '', level: 60, role: 'fighter', roleLabel: 'Штурмовик', isBot: false }],
  myStats: { hp: 400, energy: 200, ammo: 25, atk: 1234, def: 999, critPct: 10, dodgePct: 5 },
  rules: { real: true, healMin: 6, healMax: 11, healCritMin: 22, healCritMax: 55, guardPct: 50, guardSec: 20,
           cooldownMs: 1500, costHeal: 50, costGuard: 50, botMinPct: 50, botMaxPct: 80 },
  battle: null, history: [],
  myHistory: [{ at: now, result: 'win', role: 'Штурмовик', kills: 2, damage: 40, rating: 5, money: 1e9 }],
  rating: { top: [{ place: 1, id: 'a', name: 'Альфа', flag: '', points: 5, wins: 1, isMe: false }], me: null, myPoints: 0,
            rules: { win: 3, loss: -3, kill: 1, best: 3 } },
};
const RATING = {
  teamSize: 5, lobbyMinutes: 5, nextStartAt: 0, secondsLeft: 0, botFillSec: 20, roles, myRole: 'fighter',
  iAmRegistered: false, registered: [],
  rules: { hp: 1500, energy: 1000, ammo: 30, dmg: 60, healMin: 25, healMax: 45, healCritMin: 90, healCritMax: 220,
           heal: 45, guardPct: 50, guardSec: 20, cooldownMs: 1500, costHeal: 50, costGuard: 50 },
  battle: null, history: [], myHistory: [],
  rating: { top: [{ place: 1, id: 'b', name: 'Бета', flag: '', points: 1200, wins: 9, rank: 'Новички', isMe: false }],
            me: null, myPoints: 1200,
            myRank: { id: 'rookie', name: 'Новички', need: 1000, icon: '🎖' },
            nextRank: { id: 'skilled', name: 'Опытные', need: 2000, icon: '🏅' },
            ranks: [], rules: { win: 3, loss: -3, kill: 1, best: 3 } },
};
const ARENA = { div: 'elite', divName: 'Арена — Элита', currency: 'gold', entry: 10, entryGold: 10,
  divisions: [{ id: 'elite', name: 'Э', short: 'Элита', icon: '👑', currency: 'gold', entry: 10 }],
  slotMinutes: 15, minPlayers: 2, nextStartAt: now + 100000, secondsLeft: 100, seats: 10, botFillSec: 10, botPct: 70,
  registered: [{ id: 'bot1', name: 'Гладиатор-1', flag: '🤖', level: 0, isBot: true }], pot: 0,
  iAmRegistered: false, myGold: 50, myMoney: 0, myStats: { hp: 300, ammo: 20, atk: 100, def: 90, critPct: 5, dodgePct: 0 },
  rules: { real: true, hp: 1000, atk: 30, cooldownMs: 1500, medkitPct: 50, critMin: 3, critMax: 5,
           armorPct: 50, critMs: 15000, armorMs: 15000, smokeUses: 2 },
  battle: null, history: [], lastResultId: '', rating: { top: [], me: null } };

function setup(hash, responses) {
  const dom = new JSDOM('<div id="content"></div>', { url: 'https://x.test/' + hash, runScripts: 'outside-only' });
  const w = dom.window;
  global.window = w; global.document = w.document; global.location = w.location; global.history = w.history;
  global.setInterval = () => 0; global.clearInterval = () => {};
  global.setTimeout = () => 0; global.requestAnimationFrame = (fn) => { fn(); return 0; };
  global.localStorage = w.localStorage;
  eval(fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8').replace(/^const UI = /m, 'UI = '));
  UI.toast = () => {}; UI.confirm = async () => true;
  global.UI = UI; w.UI = UI;
  const calls = [];
  global.API = { token: () => 't', setToken() {},
    get: async (u) => {
      calls.push(['GET', u]);
      for (const [prefix, data] of responses) if (u.startsWith(prefix)) return JSON.parse(JSON.stringify(data));
      return { opponents: [], energy: { cur: 1, max: 1 }, ammo: { cur: 1, max: 1 } };
    },
    post: async (u, body) => { calls.push(['POST', u, body]); return {}; } };
  w.API = global.API;
  let App;
  eval(fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8').replace(/^const App = /m, 'App = '));
  global.App = App; w.App = App;
  App.me = { id: 'me', level: 60, res: { hp: { cur: 1 }, en: { cur: 1 }, am: { cur: 1 } }, maxHp: 1, name: 'Я' };
  App.refreshMe = async () => {};
  eval(fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8'));
  App.rerender = () => App.screens.war(document.getElementById('content'));
  return { w, App, calls, doc: w.document };
}

(async () => {
  console.log('\n[1] Вкладки войны');
  {
    const env = setup('#war/team', [['/api/squad', SQUAD], ['/api/event', {}]]);
    await env.App.screens.war(env.doc.getElementById('content'));
    await wait(10);
    const tabs = [...env.doc.querySelectorAll('[data-wartab]')].map((t) => t.dataset.wartab);
    ok(tabs.join() === 'targets,team,sanctions,event', `вкладки: ${tabs.join(', ')}`);
    const team = env.doc.querySelector('[data-wartab="team"]');
    ok(/Командные сражения/.test(team.textContent) && team.classList.contains('active'), 'открыта «Командные сражения»');
    const subs = [...env.doc.querySelectorAll('[data-teamtab]')].map((t) => t.textContent.trim());
    ok(subs.join('|') === '🤝 Групповые бои|🏟 Арена|🏅 Рейтинговые бои', `разделы: ${subs.join(', ')}`);
    ok(env.doc.querySelector('[data-teamtab="squad"]').classList.contains('active'), 'по умолчанию — групповые бои');

    console.log('\n[2] Групповые бои');
    const box = env.doc.getElementById('gb-box');
    ok(env.calls.some((c) => c[0] === 'GET' && c[1] === '/api/squad'), 'запрос к /api/squad');
    ok(!!box.querySelector('img.gb-banner[src="/img/group/preview.webp"]'), 'картинка-превью на месте');
    ok(/ГРУППОВЫЕ БОИ/.test(box.textContent), 'заголовок «Групповые бои»');
    ok(/Взнос/.test(box.textContent) && /Приз каждому живому победителю/.test(box.textContent), 'взнос и приз показаны');
    ok(/как в игре/.test(box.textContent) && /1\s?234/.test(box.textContent), 'реальные характеристики игрока показаны');
    ok(!box.querySelector('[data-section]') && !/Ваш ранг/.test(box.textContent), 'ни рангов, ни улучшений, ни снабжения');
    ok(!/<th>Ранг<\/th>/.test(box.innerHTML), 'в таблице рейтинга нет столбца «Ранг»');
    ok(/\+\$/.test(box.textContent), 'в истории — деньги за бой');
    ok(/Записаться на бой — /.test(box.textContent), 'на кнопке записи — сумма взноса');
    await box.querySelector('#gb-in').onclick();
    ok(env.calls.some((c) => c[0] === 'POST' && c[1] === '/api/squad/register'), 'запись уходит на /api/squad/register');

    console.log('\n[3] Рейтинговые бои');
    // Отсчёт групповых запущен — переход в раздел с пустой очередью
    // обязан его погасить, иначе «таймер снова идёт без игроков»
    let tickerStopped = false;
    env.App._tickTimer = 777;
    const realClear = global.clearInterval;
    global.clearInterval = (id) => { if (id === 777) tickerStopped = true; realClear(id); };
    env.calls.length = 0;
    const setResp = (arr) => { global.API.get = async (u) => { env.calls.push(['GET', u]); for (const [p, d] of arr) if (u.startsWith(p)) return JSON.parse(JSON.stringify(d)); return {}; }; };
    setResp([['/api/group', RATING], ['/api/event', {}]]);
    env.doc.querySelector('[data-teamtab="rating"]').onclick();
    await wait(10);
    ok(env.w.location.hash === '#war/team/rating', `адрес раздела: ${env.w.location.hash}`);
    const box2 = env.doc.getElementById('gb-box');
    ok(env.calls.some((c) => c[1] === '/api/group'), 'запрос к /api/group');
    ok(/РЕЙТИНГОВЫЕ БОИ/.test(box2.textContent), 'заголовок «Рейтинговые бои»');
    ok(!box2.querySelector('img.gb-banner'), 'картинки нет');
    ok(/Ваш ранг/.test(box2.textContent) && !!box2.querySelector('[data-section="upgrades"]')
       && !!box2.querySelector('[data-section="supply"]'), 'ранг, улучшения и снабжение на месте');
    ok(/<th>Ранг<\/th>/.test(box2.innerHTML), 'в таблице есть ранги');
    ok(tickerStopped, 'отсчёт групповых погашен: у пустой очереди таймер не идёт');
    ok(env.doc.getElementById('gb-timer').textContent === '—', 'вместо времени — прочерк');
    global.clearInterval = realClear;

    console.log('\n[4] Арена');
    setResp([['/api/arena', ARENA], ['/api/event', {}]]);
    env.doc.querySelector('[data-teamtab="arena"]').onclick();
    await wait(10);
    const abox = env.doc.getElementById('arena-box');
    ok(!!abox && /как в игре/.test(abox.textContent), 'арена открыта, правила — про реальные характеристики');
    ok(/70%/.test(abox.textContent) && /банк сгорает/.test(abox.textContent), 'о ботах и банке сказано');
    ok(/Гладиатор-1/.test(abox.textContent) && /бот/.test(abox.textContent), 'бот в списке помечен');
  }

  console.log('\n[5] Старые адреса');
  {
    const env = setup('#war/group', [['/api/group', RATING], ['/api/event', {}]]);
    await env.App.screens.war(env.doc.getElementById('content'));
    await wait(10);
    ok(env.doc.querySelector('[data-teamtab="rating"]').classList.contains('active'), '#war/group → рейтинговые бои');
    const env2 = setup('#war/arena', [['/api/arena', ARENA], ['/api/event', {}]]);
    await env2.App.screens.war(env2.doc.getElementById('content'));
    await wait(10);
    ok(env2.doc.querySelector('[data-teamtab="arena"]').classList.contains('active'), '#war/arena → арена');
  }

  console.log('\n[6] Бой в групповых');
  {
    const card = (id, name, team, extra) => Object.assign({ id, name, flag: '', team, role: 'fighter', roleLabel: 'Штурмовик',
      roleIcon: '🎯', hp: 300, maxHp: 400, alive: true, isBot: false, guarded: false, rating: 0, isMe: false }, extra || {});
    const FIGHT = { mode: 'squad', active: true, state: 'running', preparing: false, finished: false, winnerTeam: -1,
      myTeam: 0, prize: 2e9, entry: 1e9,
      me: Object.assign(card('me', 'Я', 0, { isMe: true }), { energy: 100, maxEnergy: 200, ammo: 20, maxAmmo: 25,
        cooldownLeftMs: 0, damageDealt: 0, healed: 0, kills: 0, targetId: null }),
      myStats: { real: true, role: { id: 'fighter', label: 'Штурмовик', icon: '🎯', hpMul: 1, energyMul: 1, atkMul: 1.25, dmgReducePct: 0 },
        hp: 400, energy: 200, ammo: 25, atk: 1234, def: 999, critPct: 10, dodgePct: 5 },
      allies: [card('me', 'Я', 0, { isMe: true })], enemies: [card('e1', 'Враг', 1, { isBot: true })],
      log: [], watchable: [], killedBy: '', canHeal: false, canGuard: false, costHeal: 50, costGuard: 50 };
    const env = setup('#war/team/squad', [['/api/squad/battle', FIGHT], ['/api/squad', Object.assign({}, SQUAD, {
      battle: { state: 'running', iAmIn: true, needEnter: false, prepareLeftSec: 0, id: 'x' } })], ['/api/event', {}]]);
    await env.App.screens.war(env.doc.getElementById('content'));
    await wait(15);
    const box = env.doc.getElementById('gb-box');
    ok(/Групповой бой/.test(box.textContent), 'шапка боя — «Групповой бой»');
    const atk = box.querySelector('[data-act="attack"]');
    ok(!!atk, 'кнопка атаки есть');
    await atk.onclick();
    ok(env.calls.some((c) => c[0] === 'POST' && c[1] === '/api/squad/act'), 'удар уходит на /api/squad/act');
    // Итог
    const DONE = Object.assign({}, FIGHT, { active: false, finished: true, state: 'done', winnerTeam: 0, iWon: true,
      result: [{ id: 'me', name: 'Я', flag: '', team: 0, role: 'fighter', roleLabel: 'Штурмовик', isBot: false,
        kills: 1, damage: 50, absorbed: 0, healed: 0, alive: true, ratingGained: 4, money: 1e9, prize: 2e9, won: true }] });
    global.API.get = async (u) => (u.startsWith('/api/squad/battle') ? JSON.parse(JSON.stringify(DONE)) : {});
    env.App._resetSign('gbBattle_squad');
    await env.App.renderGroupBattle();
    ok(/ПОБЕДА/.test(box.textContent) && /Приз/.test(box.textContent), 'итог: победа и приз');
    ok(/<th class="num">Деньги<\/th>/.test(box.innerHTML), 'в таблице итогов — столбец «Деньги»');
    ok(/← К групповым боям/.test(box.textContent), 'кнопка возврата — к групповым боям');
    // Подготовка — карточка реальных характеристик
    const PREP = Object.assign({}, FIGHT, { preparing: true, state: 'preparing', prepareLeftSec: 20 });
    global.API.get = async (u) => (u.startsWith('/api/squad/battle') ? JSON.parse(JSON.stringify(PREP)) : {});
    env.App._resetSign('gbBattle_squad');
    await env.App.renderGroupBattle();
    ok(/Характеристики как в игре/.test(box.textContent) && /1\s?234/.test(box.textContent) && /999/.test(box.textContent),
       'в комнате подготовки — реальные характеристики и мощь');
  }

  console.log('\n[7] Плашка боя');
  {
    const env = setup('#home', [['/api/squad', SQUAD]]);
    env.App.me.combat = { fighting: false, registered: true, needEnter: false, regWhere: 'squad', where: null,
                          startsAt: now + 60000, prepareLeftSec: 0 };
    env.App.updateCombatBar();
    const bar = env.doc.getElementById('combat-bar');
    ok(bar && /Групповой бой/.test(bar.textContent), 'плашка: «Групповой бой»');
    env.App.rerender = () => {};
    await env.doc.getElementById('cb-go').onclick();
    ok(env.w.location.hash === '#war/team/squad' && env.App._teamTab === 'squad', 'кнопка ведёт в групповые бои');
    env.App.me.combat.regWhere = 'group';
    env.App.updateCombatBar();
    ok(/Рейтинговый бой/.test(env.doc.getElementById('combat-bar').textContent), 'рейтинговый подписан своим именем');
    await env.doc.getElementById('cb-go').onclick();
    ok(env.w.location.hash === '#war/team/rating', 'и ведёт в рейтинговые');
  }

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
