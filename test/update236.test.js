// ═══════════════════════════════════════════════════════════════════
// test/update236.test.js — мелкие правки одного выката
//
// Что стережётся:
//  1. Прочитанное объявление гасит свою полосу само, без крестика.
//  2. В «Откуда золото» купленное и полученное бонусом — разные строки
//     (источники 'purchase' и 'purchase_bonus'), обе в группе купленного.
//  3. Уведомления можно включить обратно: разрешение браузера и наличие
//     подписки — разные вещи, настройки смотрят на подписку.
//  4. VIP: 300 золота за 14 дней, и та же цена в Правилах платежей.
//
// Запуск: node test/update236.test.js   (после npm run build)
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
const payments = require('../dist/src/services/payments');
const donateBonus = require('../dist/src/services/donateBonus');
const stats = require('../dist/src/services/stats');
const vip = require('../dist/src/services/vip');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

(async () => {
  await db.init();
  const nx = [];

  console.log('\n[1] Купленное золото и бонусное — по отдельности');
  await auth.register('Хозяин', 'пароль123', 'up1@t.ru', 'ru', '10.0.9.1');
  const O = Object.values(player.users()).find((x) => x.name === 'Хозяин');
  O.role = 'owner';
  await auth.register('Покупатель', 'пароль123', 'up2@t.ru', 'ru', '10.0.9.2');
  const A = Object.values(player.users()).find((x) => x.name === 'Покупатель');
  A.gold = 0;
  const promo = donateBonus.adminSave(O, { title: 'Первое пополнение', kind: 'gold', pct: 100, limit: 'first' }, nx).promo;
  const order = payments.createOrder(A, 'gold_100', nx);
  payments.confirmPayment(order.orderId);
  ok(A.gold === 200, `зачислено 200 золота: пакет 100 и столько же бонусом (${A.gold})`);
  const bySource = stats.report(A).gold.bySource;
  const bought = bySource.find((x) => x.id === 'purchase');
  const bonus = bySource.find((x) => x.id === 'purchase_bonus');
  ok(bought && bought.value === 100, `строка «Покупки»: ${bought && bought.value}`);
  ok(bonus && bonus.value === 100, `строка «Бонусы к покупкам»: ${bonus && bonus.value}`);
  ok(stats.GOLD_SOURCES.purchase_bonus === 'Бонусы к покупкам', 'у источника есть человеческое название');
  // Надбавка акции на золото — тоже бонусная строка, а не покупка
  // Бонус к покупкам убираем, чтобы в этой проверке осталась только акция
  donateBonus.adminRemove(O, promo.id, nx);
  const discounts = require('../dist/src/services/discounts');
  discounts.set('gold', 50, 24);
  await auth.register('Второй', 'пароль123', 'up3@t.ru', 'ru', '10.0.9.3');
  const B = Object.values(player.users()).find((x) => x.name === 'Второй');
  B.gold = 0;
  payments.confirmPayment(payments.createOrder(B, 'gold_100', nx).orderId);
  const srcB = stats.report(B).gold.bySource;
  const boughtB = srcB.find((x) => x.id === 'purchase');
  const bonusB = srcB.find((x) => x.id === 'purchase_bonus');
  ok(B.gold === 150 && boughtB.value === 100 && bonusB.value === 50,
     "с акцией +50%: куплено " + (boughtB && boughtB.value) + ", бонусом " + (bonusB && bonusB.value));
  discounts.set('gold', 0, 0);

  const routes = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  ok(/pick\(\['purchase', 'purchase_bonus'\]\)/.test(routes), 'обе строки стоят в группе «Куплено за деньги»');
  ok(/'purchase', 'purchase_bonus', 'event'/.test(routes), 'и бонус не сваливается в «Прочее»');

  console.log('\n[2] VIP: 300 золота на 14 дней');
  ok(vip.PRICE_GOLD === 300 && vip.PRICE_DAYS === 14, `цена и срок: ${vip.PRICE_GOLD} золота на ${vip.PRICE_DAYS} дн.`);
  A.gold = 1000;
  vip.buy(A, nx);
  const left = Math.round((A.vipUntil - Date.now()) / 86400000);
  ok(A.gold === 700 && left === 14, `куплен VIP: списано 300, осталось ${left} дн.`);
  const pay = fs.readFileSync(path.join(ROOT, 'public/payments.html'), 'utf8');
  ok(pay.includes(vip.PRICE_GOLD + ' Золота за ' + vip.PRICE_DAYS + ' дней'), 'та же цена в Правилах платежей');

  console.log('\n[3] Объявление и уведомления в игре');
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><body><div id="pin-news"></div><div id="content"></div></body>', { url: 'http://localhost/' });
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
  const App = load('public/js/app.js', 'App');
  global.App = App;
  API.token = () => 'x';

  // Полоса объявления гаснет после прочтения
  App.me = { newsPin: { id: 'n1', title: 'Платёжная система', emoji: '🎁' } };
  App.renderPinnedNews();
  ok(/Платёжная система/.test(document.getElementById('pin-news').textContent), 'полоса объявления показана');
  let posted = null;
  API.post = async (url, body) => { posted = [url, body]; return {}; };
  await App._markNewsSeen('n1');
  ok(App.me.newsPin === null && !/Платёжная система/.test(document.getElementById('pin-news').textContent),
     'прочитал — полоса убралась сама, без крестика');
  ok(posted && posted[0] === '/api/news/hide-banner' && posted[1].id === 'n1', 'и сервер знает, что она прочитана');
  App.me = { newsPin: { id: 'n2', title: 'Другое', emoji: '📰' } };
  posted = null;
  await App._markNewsSeen('n1');
  ok(App.me.newsPin !== null && posted === null, 'чужое объявление чужую полосу не гасит');
  const news = fs.readFileSync(path.join(ROOT, 'public/js/screens/news.js'), 'utf8');
  ok(/App\._markNewsSeen\(p\.id\)/.test(news), 'экран новости зовёт гашение полосы');

  // Уведомления: разрешение есть, подписки нет — значит, выключены
  global.Notification = { permission: 'granted' };
  dom.window.Notification = global.Notification;
  let sub = null;
  // В Node 22 globalThis.navigator — только для чтения, простое присваивание
  // молча не сработает, и проверка «есть ли serviceWorker» будет ложной
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(dom.window.navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => sub } }) },
  });
  dom.window.PushManager = function () {};
  global.PushManager = dom.window.PushManager;
  App.rerender = () => {};
  ok(await App.refreshPushState() === false, 'подписки нет — уведомления считаются выключенными');
  sub = { endpoint: 'x' };
  ok(await App.refreshPushState() === true, 'подписка есть — включёнными');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(/perm === 'granted' && App\._pushOn/.test(core), 'настройки смотрят на подписку, а не только на разрешение');
  const offBranch = core.indexOf("perm === 'granted' && App._pushOn");
  const onBranch = core.indexOf("} else if (perm === 'granted') {");
  ok(onBranch > offBranch && /Уведомления выключены\. Браузер их разрешает/.test(core),
     'и предлагают включить обратно, когда подписки нет');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
