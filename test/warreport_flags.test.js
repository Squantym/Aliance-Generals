// ═══════════════════════════════════════════════════════════════════
// test/warreport_flags.test.js — в сводке «Пока вас не было» флаги, а
// не надписи «US» и «RU»
//
// ЧТО БЫЛО. Клиент рисует флаг картинкой по эмодзи-флагу («🇷🇺» →
// /img/flags/ru.webp). Бой же клал в сводку не флаг, а КОД страны
// (user.country → «ru»), и рядом с именем нападавшего оказывалась
// латинская надпись вместо флага.
//
// Чинится с двух сторон, и обе проверяются здесь:
//  1. Сервер пишет в сводку настоящий флаг.
//  2. Клиент понимает и код страны — у игроков уже накоплены старые
//     записи, и без этого они так и остались бы надписями.
//
// Запуск: node test/warreport_flags.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
const path = require('path'), fs = require('fs');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url: 'http://localhost/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage; global.location = dom.window.location;
global.fetch = async () => ({ ok: true, json: async () => ({}) });
localStorage.setItem('gtoken', 't');
function load(file, name) {
  let src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  src += `\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`;
  eval(src);
  return globalThis.__x;
}
global.UI = load('public/js/ui.js', 'UI');
global.API = load('public/js/api.js', 'API');
UI.toast = () => {};
const App = load('public/js/app.js', 'App');

const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const battle = require('../dist/src/services/battle');
const warReport = require('../dist/src/services/warReport');
const c = require('../dist/config/gameConfig');
let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const eq = (n, a, b) => { assert.strictEqual(a, b, `❌ ${n}: ${a} !== ${b}`); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();

  console.log('\n[1] Клиент рисует флаг картинкой');
  const ru = c.COUNTRY_BY_ID.ru;
  ok('в конфиге у страны есть эмодзи-флаг', !!ru && !!ru.flag);
  ok('по эмодзи выходит картинка', /\/img\/flags\/ru\.webp/.test(App._flagImg(ru.flag)));
  // Главное: код страны тоже понимается — старые записи в сводках
  ok('и по коду страны тоже', /\/img\/flags\/ru\.webp/.test(App._flagImg('ru')));
  ok('регистр не важен', /\/img\/flags\/us\.webp/.test(App._flagImg('US')));
  const bad = App._flagImg('неизвестно');
  ok('чужую строку не превращаем в картинку', !/<img/.test(bad));
  for (const country of c.COUNTRIES) {
    ok(`флаг ${country.id} есть файлом`,
       fs.existsSync(path.join(ROOT, 'public/img/flags', country.id + '.webp')));
  }

  console.log('\n[2] Сервер кладёт в сводку флаг, а не код страны');
  await auth.register('Нападавший', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
  await auth.register('Защитник', 'пароль123', 'd@t.ru', 'ru', '1.1.1.2');
  const A = Object.values(player.users()).find((x) => x.name === 'Нападавший');
  const D = Object.values(player.users()).find((x) => x.name === 'Защитник');
  A.country = 'ru'; D.country = 'us';
  A.level = 60; D.level = 60;
  A.units = { ground_1: { 0: 400 } };
  D.units = { ground_1: { 0: 5 } };
  A.res.am.cur = 50;
  D.lastSeen = Date.now() - 3600 * 1000;      // защитник офлайн — копится сводка
  const realRandom = Math.random;
  Math.random = () => 0.5;
  try { battle.attack(A, D.id, []); } catch (e) { console.log('    (атака отклонена: ' + e.message + ')'); }
  Math.random = realRandom;

  const rep = warReport.view(D);
  ok('сводка собралась', !!rep && Array.isArray(rep.attackers) && rep.attackers.length > 0);
  const rec = rep.attackers[0];
  eq('в сводке тот самый нападавший', rec.name, 'Нападавший');
  eq('и у него флаг, а не код страны', rec.flag, c.COUNTRY_BY_ID.ru.flag);
  ok('а значит клиент нарисует картинку', /<img/.test(App._flagImg(rec.flag)));

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  process.exit(0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
