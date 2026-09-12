// ═══════════════════════════════════════════════════════════════════
// test/taxreceipt.test.js — чек «Мой налог» и его передача покупателю
//
// ЮKassa перестала передавать чеки за самозанятых 29.12.2025, и чек по
// каждой покупке владелец пробивает в «Мой налог» руками. Передать чек
// покупателю он обязан по 422-ФЗ — эта часть и автоматизирована:
// ссылка вставляется в заказ, игрок получает её письмом.
//
// Что стережётся:
//  1. Ссылку принимает только владелец и только по оплаченному заказу.
//  2. Принимается ТОЛЬКО адрес ФНС по https: письмо с кликабельной
//     ссылкой — удобный способ увести игрока не туда.
//  3. Игрок получает письмо от «Системы» со ссылкой-кнопкой.
//  4. В списке платежей видно, по каким настоящим оплатам чека нет, и
//     их можно отобрать отдельно. Тестовые оплаты чека не требуют.
//
// Запуск: node test/taxreceipt.test.js   (после npm run build)
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
const rewards = require('../dist/src/services/rewards');
const lt = require('../dist/src/services/logTranslate');
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const fails = (fn, part, n) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};
const GOOD = 'https://lknpd.nalog.ru/api/v1/receipt/053701348971/2f8a1c9b/print';

(async () => {
  await db.init();
  const nx = [];
  let ip = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `tr${++ip}@t.ru`, 'ru', '10.0.15.' + ip);
    return Object.values(player.users()).find((x) => x.name === name);
  };
  const O = await reg('Хозяин'); O.role = 'owner';
  const P = await reg('Покупатель');

  const order = () => {
    const c = payments.createOrder(P, 'gold_100', nx);
    return c.orderId;
  };
  const paid = () => { const id = order(); payments.confirmPayment(id); return id; };

  console.log('\n[1] Кто и по какому заказу может отправить чек');
  const pending = order();
  fails(() => payments.setTaxReceipt(O, pending, GOOD, nx), 'оплаченному', 'по неоплаченному заказу чек не принимается');
  const id = paid();
  fails(() => payments.setTaxReceipt(P, id, GOOD, nx), 'владельц', 'игрок чужой чек отправить не может');

  console.log('\n[2] Принимается только ссылка ФНС');
  for (const bad of [
    'http://lknpd.nalog.ru/api/v1/receipt/1/print',      // без https
    'https://lknpd.nalog.ru.evil.com/receipt/1',         // чужой домен с похожим началом
    'https://example.com/receipt/1',                     // просто чужой сайт
    'javascript:alert(1)',                               // не ссылка вовсе
    'https://nalog.ru',                                  // без пути — не чек
  ]) {
    fails(() => payments.setTaxReceipt(O, id, bad, nx), 'Мой налог', `отклонено: ${bad.slice(0, 42)}`);
  }
  ok(!payments.adminGet(O, id).taxReceipt, 'после отказов чек в заказе так и не записан');

  console.log('\n[3] Чек уходит игроку письмом');
  const before = rewards.listFor(P).length;
  payments.setTaxReceipt(O, id, GOOD, nx);
  const card = payments.adminGet(O, id);
  ok(card.taxReceipt && card.taxReceipt.url === GOOD, 'ссылка записана в заказ');
  ok(card.taxReceipt.byName === 'Хозяин' && card.taxReceipt.at > 0, `видно, кто и когда отправил: ${card.taxReceipt.byName}`);
  const letters = rewards.listFor(P);
  ok(letters.length === before + 1, 'игроку пришло одно письмо');
  const letter = letters[0];
  ok(letter.kind === 'receipt' && letter.from === 'Система', 'письмо-квитанция от «Системы»');
  ok(letter.link && letter.link.url === GOOD, 'в письме ссылка на чек');
  ok(/чек/i.test(letter.title) && /99 ₽/.test(letter.reason), `в письме сумма и суть: «${letter.title}»`);
  const social = fs.readFileSync(path.join(ROOT, 'public/js/screens/social.js'), 'utf8');
  ok(/r\.link \? `<a class="btn btn-orange mt"/.test(social), 'в игре ссылка показана кнопкой, а не текстом');
  ok(/rel="noopener noreferrer"/.test(social), 'и открывается безопасно, в новой вкладке');

  console.log('\n[4] Ссылка в письме проверяется и там');
  const direct = rewards.grantReceipt(P.id, {
    title: 'Проверка', reason: '', lines: [], link: { url: 'javascript:alert(1)', label: 'Жми' },
  });
  ok(!direct.link, 'письмо не примет ссылку с чужой схемой даже напрямую');

  console.log('\n[5] Список платежей: по каким оплатам чека нет');
  const id2 = paid();
  const list = payments.adminList(O, {});
  ok(list.totals.needReceipt === 1, `счётчик «без чека»: ${list.totals.needReceipt}`);
  const row1 = list.rows.find((r) => r.id === id);
  const row2 = list.rows.find((r) => r.id === id2);
  ok(row1.taxReceipt === true && row2.taxReceipt === false, 'в строках видно, у кого чек есть, у кого нет');
  const only = payments.adminList(O, { noreceipt: '1' });
  ok(only.rows.length === 1 && only.rows[0].id === id2, 'отбор «только без чека» оставляет ровно нужные заказы');
  const ui = fs.readFileSync(path.join(ROOT, 'public/js/admin2/payments.js'), 'utf8');
  ok(/id="pay-noreceipt"/.test(ui) && /noreceipt: q\.noreceipt \|\| ''/.test(ui), 'в панели есть переключатель «только без чека»');
  ok(/pay-receipt-send/.test(ui) && /tax-receipt/.test(ui), 'и кнопка отправки чека игроку');

  console.log('\n[6] Журнал действий');
  ok(/чек/i.test(lt.describe('/api/admin/payments/abc123/tax-receipt', {}, {})), 'отправка чека попадает в журнал понятной строкой');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
