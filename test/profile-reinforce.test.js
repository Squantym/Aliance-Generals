// ═══════════════════════════════════════════════════════════════════
// test/profile-reinforce.test.js — подкрепление из профиля союзника
// (18.09.2026)
//
// Что стережётся:
//  1. Профиль союзника несёт состояние подкрепления; у чужого его нет.
//     Причина отказа — та же sendBlock, что в разделе «Подкрепления»:
//     кнопка не обещает того, в чём отправка откажет.
//  2. Кнопка «Отправить подкрепление» в профиле союзника отправляет
//     подкрепление ему; после отправки кнопка неактивна с пояснением.
//  3. У чужого игрока и в своём профиле кнопки нет.
//
// Запуск: node test/profile-reinforce.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const reinf = require('../dist/src/services/reinforcements');
const { JSDOM } = require('jsdom');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const wait = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

(async () => {
  await db.init();
  let ipN = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `pr_${++ipN}@t.ru`, 'ru', '10.0.8.' + ipN);
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

  console.log('\n[1] Состояние для профиля');
  const Me = await reg('Отправитель');
  const A = await reg('Союзник');
  const S = await reg('Посторонний');
  ally(Me, A);
  ok(reinf.profileState(Me, S) === null, 'у чужого — кнопки нет');
  ok(reinf.profileState(Me, Me) === null, 'в своём профиле — кнопки нет');
  let st = reinf.profileState(Me, A);
  ok(st && st.canSend === true && st.reason === '', 'союзнику можно отправить');
  ok(st.theirMax > 0 && st.theirActive === 0, `слоты союзника: ${st.theirActive}/${st.theirMax}`);
  reinf.send(Me, A.id, []);
  st = reinf.profileState(Me, A);
  ok(!st.canSend && st.mine === true && st.reason === 'ваше подкрепление уже действует', 'после отправки — «уже действует»');
  let err = '';
  try { reinf.send(Me, A.id, []); } catch (e) { err = e.message; }
  ok(!!err, 'и отправка тоже откажет — кнопка с ней согласна');

  const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  const pr = routes.slice(routes.indexOf("'/api/profile/:id'"), routes.indexOf("'/api/find-player'"));
  ok(/profileState\(req\.user, target\)/.test(pr) && /prof\.reinforce = rs/.test(pr), 'профиль отдаёт состояние подкрепления');

  console.log('\n[2] Кнопка в профиле');
  const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.location = dom.window.location;
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  localStorage.setItem('gtoken', 't');
  const load = (file, name) => {
    let c = fs.readFileSync(path.join(ROOT, file), 'utf8');
    c += `\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`;
    eval(c);
    return globalThis.__x;
  };
  global.UI = load('public/js/ui.js', 'UI');
  global.API = load('public/js/api.js', 'API');
  const toasts = [];
  UI.toast = (t) => toasts.push(t); UI.confirm = async () => true;
  global.App = load('public/js/app.js', 'App');
  let rerendered = 0;
  App.refreshMe = async () => {}; App.rerender = () => { rerendered++; }; App.go = () => {};
  load('public/js/screens/core.js', 'App');

  const base = (over) => Object.assign({
    id: 'a1', name: 'Союзник', level: 60, rating: 1200, online: true,
    flag: '🇷🇺', countryName: '', avatar: null, profileFrame: '', profileBg: '',
    rank: 'Генерал', gender: 'm', genderTitle: 'Господин Генерал',
    battle: { wins: 0, losses: 0, defWins: 0, defLosses: 0, breaches: 0 },
    deathsCount: 0, units: [], buildings: [], trophies: [], achievements: [],
    power: { atk: 1, def: 1 }, critChancePct: 0, dodgeChancePct: 0,
    status: '', activeTitle: '', canAttack: true, isBot: false, isOwn: false,
    capacity: 10, exp: 0, expNext: 333, skills: {}, skillPoints: 0,
  }, over || {});
  const c = document.getElementById('content');
  const posts = [];
  API.post = async (u, b) => { posts.push({ u, b }); return {}; };
  const render = async (p, id) => {
    App.me = { id: 'me1', name: 'Отправитель', level: 60, gold: 0, gender: 'm', legion: null, staffRole: null };
    API.get = async (url) => (url.indexOf('/api/profile/') === 0 ? { profile: p } : {});
    await App.screens.profile(c, id || p.id);
    await wait();
  };

  await render(base({ myAlly: true, reinforce: { canSend: true, reason: '', mine: false, theirActive: 1, theirMax: 3 } }));
  let btn = document.getElementById('pf-reinforce');
  ok(btn && !btn.disabled && /Отправить подкрепление/.test(btn.textContent), 'у союзника — активная кнопка');
  ok(/Уже в вашем альянсе/.test(c.innerHTML), 'пометка альянса на месте');
  btn.onclick();
  await wait();
  ok(posts.length === 1 && posts[0].u === '/api/reinforcements/send' && posts[0].b.toId === 'a1', 'кнопка отправляет подкрепление этому игроку');
  ok(rerendered === 1, 'после отправки профиль перерисован');

  posts.length = 0;
  API.post = async (u, b) => { posts.push({ u, b }); throw new Error('Лимит: 3 подкреплений в сутки'); };
  await render(base({ myAlly: true, reinforce: { canSend: true, reason: '', mine: false, theirActive: 0, theirMax: 3 } }));
  btn = document.getElementById('pf-reinforce');
  btn.onclick();
  await wait();
  ok(toasts.some((t) => /Лимит/.test(t)) && btn.disabled === false, 'отказ сервера показан, кнопку можно нажать снова');

  await render(base({ myAlly: true, reinforce: { canSend: false, reason: 'ваше подкрепление уже действует', mine: true, theirActive: 1, theirMax: 3 } }));
  btn = document.getElementById('pf-reinforce');
  ok(btn && btn.disabled && /уже действует/.test(c.innerHTML), 'уже отправлено — кнопка неактивна, с пояснением');

  await render(base({ myAlly: true, reinforce: { canSend: false, reason: 'у него все слоты заняты', mine: false, theirActive: 3, theirMax: 3 } }));
  ok(document.getElementById('pf-reinforce').disabled && /Сейчас нельзя: у него все слоты заняты/.test(c.innerHTML), 'причина отказа видна');

  await render(base({ myAlly: false }));
  ok(!document.getElementById('pf-reinforce'), 'у чужого — кнопки нет');

  console.log(`\n${failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'}: ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
