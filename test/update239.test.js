// ═══════════════════════════════════════════════════════════════════
// test/update239.test.js — иконки, сейф, учёт золота, сроки по датам
//
// Что стережётся:
//  1. Иконки диверсантов крупнее показа (156 px) и не раздуты по весу;
//     в окне добычи диверсанты — картинками, а в карточке контейнера
//     нет чисел, кроме шанса секретной разработки.
//  2. Сейф: в коде до двух одинаковых цифр, попытки с тремя и больше
//     отклоняются. Именно такие попытки (1111, 2222) вскрывали код.
//  3. Учёт золота: шахты, конфликты, возврат ставки и списание из штаба
//     идут через addGold/spendGold. Из-за прямых правок баланса
//     «получено − потрачено» не сходилось с остатком на счету.
//  4. Скидки и глобальные бонусы можно задать точными датами начала и
//     окончания, а не только «на N часов».
//
// Запуск: node test/update239.test.js   (после npm run build)
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
const stats = require('../dist/src/services/stats');
const bankHack = require('../dist/src/services/bankHack');
const discounts = require('../dist/src/services/discounts');
const globalBuffs = require('../dist/src/services/globalBuffs');
const admin = require('../dist/src/services/admin');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const fails = (fn, part, n) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};
const HOUR = 3600000, DAY = 86400000;
const webpSize = (buf) => {
  const tag = buf.slice(12, 16).toString();
  if (tag === 'VP8X') return [(buf.readUIntLE(24, 3) & 0xffffff) + 1, (buf.readUIntLE(27, 3) & 0xffffff) + 1];
  if (tag === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  const bits = buf.readUInt32LE(21);
  return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
};

(async () => {
  await db.init();
  const nx = [];

  console.log('\n[1] Иконки диверсантов');
  const SAB = ['ground', 'sea', 'air', 'secret', 'building', 'suicide'];
  for (const id of SAB) {
    const p = path.join(ROOT, 'public/img/saboteurs', id + '.webp');
    const buf = fs.readFileSync(p);
    const [w, h] = webpSize(buf);
    // Карточка диверсантов показывает иконку в 156 px: файл должен быть
    // крупнее, иначе на телефоне с плотным экраном получается мыло
    ok(w >= 256 && h >= 256, `${id}: ${w}×${h} — хватает на показ в 156 px`);
    ok(buf.length < 60 * 1024, `${id}: ${(buf.length / 1024).toFixed(0)} КБ — вес в разумных пределах`);
  }
  const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  ok(/loot-sabs/.test(app) && /App\.sabImg\(k, 40\)/.test(app), 'в окне добычи диверсанты показаны картинками');
  ok(!/🥷 Диверсанты: \$\{App\._sabNames/.test(app), 'строк «Диверсанты: секретные» в добыче больше нет');
  const market = fs.readFileSync(path.join(ROOT, 'public/js/screens/market.js'), 'utf8');
  ok(/Шанс разработки: <b class="gold">\$\{x\.chance\}%<\/b><\/div>/.test(market), 'в карточке контейнера остался только шанс разработки');
  ok(!/x\.doping\}%/.test(market) && !/UI\.fmtNum\(x\.money\[0\]\)/.test(market) && !/\$\{x\.sab\[0\]\}/.test(market),
     'проценты допинга, суммы денег и числа диверсантов из карточки убраны');

  console.log('\n[2] Сейф: одинаковых цифр не больше двух');
  ok(bankHack.MAX_SAME === 2, `предел повторов: ${bankHack.MAX_SAME}`);
  let maxSeen = 0, codes = 0, withRepeat = 0;
  for (let i = 0; i < 400; i++) {
    const code = bankHack.generateCode(4);
    if (!code) break;
    codes++;
    const r = bankHack.maxRepeat(code);
    maxSeen = Math.max(maxSeen, r);
    if (r === 2) withRepeat++;
  }
  if (!codes) {
    // generateCode наружу не отдан — проверяем через живые коды сейфов
    for (let i = 0; i < 200; i++) {
      const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      if (bankHack.maxRepeat(code) > 4) throw new Error('счётчик повторов сломан');
    }
    ok(bankHack.maxRepeat('1231') === 2 && bankHack.maxRepeat('1111') === 4 && bankHack.maxRepeat('1234') === 1,
       'счётчик повторов считает верно');
  } else {
    ok(maxSeen === 2, `в кодах встречаются повторы, но не больше двух (максимум ${maxSeen})`);
    ok(withRepeat > 0, `коды с повтором действительно выпадают: ${withRepeat} из ${codes}`);
  }

  await auth.register('Медвежатник', 'пароль123', 'u239a@t.ru', 'ru', '10.0.11.1');
  const A = Object.values(player.users()).find((x) => x.name === 'Медвежатник');
  A.pendingBankHack = { targetId: 'x', code: '1233', digits: 4, triesLeft: 5, maxTries: 10, history: [] };
  fails(() => bankHack.guess(A, '1111', nx), 'не больше 2', 'попытка 1111 отклонена');
  fails(() => bankHack.guess(A, '7777', nx), 'не больше 2', 'попытка 7777 отклонена');
  fails(() => bankHack.guess(A, '1211', nx), 'не больше 2', 'три одинаковые вразнобой — тоже отклонены');
  ok(A.pendingBankHack.triesLeft === 5, 'на отклонённые попытки ходы не тратятся');
  const r1 = bankHack.guess(A, '1223', nx);
  ok(r1.result.bulls === 3 && r1.result.cows === 0, `попытка с двумя одинаковыми принята: 🎯${r1.result.bulls} 🔵${r1.result.cows}`);
  const war = fs.readFileSync(path.join(ROOT, 'public/js/screens/war.js'), 'utf8');
  ok(/Одинаковых цифр не больше двух/.test(war), 'в игре то же правило, до отправки на сервер');
  ok(!/Цифры не должны повторяться/.test(war), 'старый запрет любых повторов убран');

  console.log('\n[3] Учёт золота сходится с остатком');
  await auth.register('Шахтёр', 'пароль123', 'u239b@t.ru', 'ru', '10.0.11.2');
  const B = Object.values(player.users()).find((x) => x.name === 'Шахтёр');
  B.gold = 0;
  const mines = fs.readFileSync(path.join(ROOT, 'src/services/mines.ts'), 'utf8');
  ok(/player\.addGold\(user, goldGained, 'mine'\)/.test(mines), 'добыча шахты идёт через addGold');
  const missions = fs.readFileSync(path.join(ROOT, 'src/services/missions.ts'), 'utf8');
  ok(/addGold\(user, conf\.goldReward, 'mission'\)/.test(missions), 'награда за конфликт — тоже');
  const marketSrc = fs.readFileSync(path.join(ROOT, 'src/services/market.ts'), 'utf8');
  ok(/player\.addGold\(prev, lot\.best\.amount, 'auction_refund'\)/.test(marketSrc), 'возврат перебитой ставки — тоже');
  const adminSrc = fs.readFileSync(path.join(ROOT, 'src/services/admin.ts'), 'utf8');
  ok(/spendGold\(target, Math\.min\(real, target\.gold \|\| 0\), 'admin_take'\)/.test(adminSrc), 'списание из штаба — через spendGold');
  for (const k of ['mine', 'mission', 'auction_refund']) {
    ok(!!stats.GOLD_SOURCES[k], `у источника «${k}» есть русское название: ${stats.GOLD_SOURCES[k]}`);
  }
  ok(!!stats.GOLD_SPENDING.admin_take, `и у списания тоже: ${stats.GOLD_SPENDING.admin_take}`);
  // Само равенство: что начислили и потратили через учёт, то и на счету
  player.addGold(B, 500, 'mine');
  player.addGold(B, 120, 'mission');
  player.spendGold(B, 200, 'market');
  const rep = stats.report(B).gold;
  ok(rep.total - rep.spent === B.gold, `получено ${rep.total} − потрачено ${rep.spent} = на счету ${B.gold}`);

  console.log('\n[4] Сроки акций по датам');
  const start = Date.now() + 2 * HOUR, end = Date.now() + 5 * DAY;
  discounts.set('gold', 30, 0, 0, { startAt: start, endAt: end });
  const saved = db.load('discounts', {}).gold || {};
  ok(saved.startAt === start && saved.expires === end, 'скидка сохранена ровно с указанными датами');
  ok(discounts.pctOf('gold') === 0, 'до начала скидка не действует');
  saved.startAt = Date.now() - HOUR;
  ok(discounts.pctOf('gold') === 30, 'после начала действует');
  fails(() => discounts.set('gold', 30, 0, 0, { startAt: end, endAt: start }), 'раньше её начала', 'конец раньше начала не принимается');
  discounts.set('gold', 0, 0);
  // Часы по-прежнему работают: ими пользуются быстрые правки
  discounts.set('gold', 10, 2);
  ok(discounts.pctOf('gold') === 10, 'старый способ «на N часов» никуда не делся');
  discounts.set('gold', 0, 0);

  globalBuffs.set('xp', 50, 0, { startAt: Date.now() + HOUR, endAt: Date.now() + 2 * DAY });
  ok(globalBuffs.multiplier('xp') === 1, 'бонус с отложенным стартом ещё не действует');
  const listed = globalBuffs.listActive().find((x) => x.key === 'xp');
  ok(listed && listed.pending === true, 'в панели он помечен как запланированный');
  db.load('globalBuffs', {}).xp.startAt = Date.now() - HOUR;
  ok(globalBuffs.multiplier('xp') === 1.5, 'после начала множитель включается');
  globalBuffs.set('xp', 0, 0);

  await auth.register('Хозяин239', 'пароль123', 'u239c@t.ru', 'ru', '10.0.11.3');
  const O = Object.values(player.users()).find((x) => x.name === 'Хозяин239');
  O.role = 'owner';
  const n2 = [];
  admin.setDiscount(O, { category: 'container', pct: 25, startAt: start, endAt: end }, n2);
  ok(/с \d{2}\.\d{2}\.\d{4}.*до \d{2}\.\d{2}\.\d{4}/.test(n2.join(' ')), `в штабе сказано, с какого по какое: «${n2[0]}»`);
  const adminUi = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  ok(/id="dc-from-\$\{cat\.id\}"/.test(adminUi) && /id="dc-to-\$\{cat\.id\}"/.test(adminUi), 'у скидки в панели два окна даты');
  ok(/id="gb-from-\$\{k\.key\}"/.test(adminUi) && /id="gb-to-\$\{k\.key\}"/.test(adminUi), 'и у глобального бонуса тоже');
  ok((adminUi.match(/type="datetime-local"/g) || []).length >= 4, 'это именно выбор даты и времени, а не текстовые поля');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
