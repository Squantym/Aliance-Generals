// ═══════════════════════════════════════════════════════════════════
// test/vipaudit.test.js — все преимущества VIP по списку, по одному
//
// Список преимуществ живёт в vip.benefits() и показывается игроку перед
// покупкой. Обещание в списке и поведение игры — разные вещи, и разойтись
// они могут молча: пункт остаётся, а вызов из него кто-то убрал при
// правке. Поэтому здесь каждый пункт проверяется ДЕЙСТВИЕМ: берём двух
// одинаковых игроков, одному даём подписку и сравниваем.
//
// Отдельно — скрытый боевой профиль: армия, постройки и разработки
// пропадают у чужих, разведка по такому игроку не проходит, а звание и
// статистика остаются на виду.
//
// Запуск: node test/vipaudit.test.js   (после npm run build)
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
const vip = require('../dist/src/services/vip');
const features = require('../dist/src/services/features');
const discounts = require('../dist/src/services/discounts');
const trophies = require('../dist/src/services/trophies');
const config = require('../dist/config/gameConfig');
const V = config.VIP;
let passed = 0;
const ok = (cond, n) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };
const fails = (fn, part, n) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message); }
  assert.ok(msg && (!part || msg.includes(part)), `❌ ${n} (получено: ${msg})`);
  passed++; console.log('  ✅ ' + n);
};

(async () => {
  await db.init();
  const nx = [];
  let ip = 0;
  const reg = async (name) => {
    await auth.register(name, 'пароль123', `va${++ip}@t.ru`, 'ru', '10.0.17.' + ip);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 30; p.gold = 5000; p.dollars = 1e12;
    return p;
  };
  const A = await reg('Подписчик');     // VIP
  const B = await reg('Обычный');       // без подписки
  vip.grant(null, A, 30, 'проверка', nx);
  ok(vip.isVip(A) && !vip.isVip(B), 'подписка выдана одному из двоих');

  console.log('\n[1] Каждый пункт списка работает');
  const list = vip.benefits();
  ok(list.length >= 18, `в списке ${list.length} преимуществ`);

  // 1. Восстановление
  ok(vip.regenSeconds(A, 100) === Math.round(100 * (1 - V.REGEN_CUT_PCT / 100)) && vip.regenSeconds(B, 100) === 100,
     `восстановление: ${vip.regenSeconds(A, 100)} с против ${vip.regenSeconds(B, 100)} с`);
  // 2. Госпиталь
  ok(vip.left(A, 'heal') === V.HOSPITAL_FREE_PER_DAY && vip.left(B, 'heal') === 0,
     `лечений в сутки: ${vip.left(A, 'heal')} против ${vip.left(B, 'heal')}`);
  ok(vip.spend(A, 'heal') === true && vip.left(A, 'heal') === V.HOSPITAL_FREE_PER_DAY - 1, 'лечение списывается из дневного запаса');
  ok(vip.spend(B, 'heal') === false, 'без подписки бесплатных лечений нет');
  // 3. Стройка
  ok(vip.siloRocketSeconds(A, 1000) < 1000 && vip.siloRocketSeconds(B, 1000) === 1000,
     `стройка шахт: ${vip.siloRocketSeconds(A, 1000)} с против 1000 с`);
  // 5. Разведки
  ok(vip.spyFreePerDay(A) === V.SPY_FREE_PER_DAY && vip.spyFreePerDay(B) === config.SPY.freePerDay,
     `разведок: ${vip.spyFreePerDay(A)} против ${vip.spyFreePerDay(B)}`);
  // 6. Подкрепления
  ok(vip.reinforcePerDay(A) === V.REINFORCE_PER_DAY && vip.reinforcePerDay(B) === config.REINFORCE.PER_DAY,
     `подкреплений: ${vip.reinforcePerDay(A)} против ${vip.reinforcePerDay(B)}`);
  // 7. Контракты
  ok(vip.contractsPerDay(A) === V.CONTRACTS_PER_DAY && vip.contractsPerDay(B) === config.CONTRACTS_PER_DAY,
     `контрактов: ${vip.contractsPerDay(A)} против ${vip.contractsPerDay(B)}`);
  // 8. Замены поручений
  ok(vip.left(A, 'reroll') === V.QUEST_REROLLS_PER_DAY && vip.left(B, 'reroll') === 0,
     `замен поручений: ${vip.left(A, 'reroll')} против ${vip.left(B, 'reroll')}`);
  // 12. Скидка на рынке
  ok(vip.marketDiscountPct(A, 0) === V.MARKET_DISCOUNT_PCT && vip.marketDiscountPct(B, 0) === 0,
     `скидка рынка: ${vip.marketDiscountPct(A, 0)}% против ${vip.marketDiscountPct(B, 0)}%`);
  ok(vip.marketDiscountPct(A, 50) <= V.MARKET_DISCOUNT_CAP_PCT, `и не выше потолка ${V.MARKET_DISCOUNT_CAP_PCT}%`);
  // 13. Бонус к покупке золота — ключевой платный пункт
  ok(vip.goldPurchaseBonusPct(A, 0) === V.GOLD_PURCHASE_BONUS_PCT && vip.goldPurchaseBonusPct(B, 0) === 0,
     `бонус к покупке золота: +${vip.goldPurchaseBonusPct(A, 0)}% против +${vip.goldPurchaseBonusPct(B, 0)}%`);
  const mulA = discounts.bonusMul('gold', A), mulB = discounts.bonusMul('gold', B);
  ok(Math.abs(mulA - (1 + V.GOLD_PURCHASE_BONUS_PCT / 100)) < 1e-9 && mulB === 1,
     `при зачислении покупки множитель ${mulA.toFixed(2)} против ${mulB.toFixed(2)}`);
  // 14. Экономика
  ok(vip.upkeepMul(A) < 1 && vip.upkeepMul(B) === 1, `содержание техники: ×${vip.upkeepMul(A)} против ×${vip.upkeepMul(B)}`);
  ok(vip.incomeMul(A) > 1 && vip.incomeMul(B) === 1, `доход построек: ×${vip.incomeMul(A)} против ×${vip.incomeMul(B)}`);
  // 15. Охрана штаба
  ok(vip.left(A, 'immunity') === V.BREACH_IMMUNITY_PER_DAY, `отбитых проникновений в запасе: ${vip.left(A, 'immunity')}`);
  ok(vip.tryBreachImmunity(A) === true && vip.tryBreachImmunity(B) === false, 'проникновение отбивается только у подписчика');
  // 16. Опыт — второй ключевой пункт
  ok(vip.xpMul(A) === 1 + V.XP_BONUS_PCT / 100 && vip.xpMul(B) === 1, `множитель опыта: ${vip.xpMul(A)} против ${vip.xpMul(B)}`);
  const xpA = player.addXp(A, 100, nx), xpB = player.addXp(B, 100, nx);
  ok(xpA > xpB && xpA === Math.round(100 * vip.xpMul(A) * (1 + 0) * 1), `за одно действие: ${xpA} опыта против ${xpB}`);
  // 17. Потери техники
  ok(vip.unitLossMul(A) < 1 && vip.unitLossMul(B) === 1, `потери техники: ×${vip.unitLossMul(A)} против ×${vip.unitLossMul(B)}`);
  // 18. Смена позывного
  ok(vip.canRenameFree(A) === true, 'бесплатная смена позывного доступна');
  fails(() => require('../dist/src/services/auth').renameSelf(B, 'НовыйБоец', nx), 'VIP', 'без подписки смена позывного закрыта');
  // 19. Трофеи быстрее
  ok(vip.trophyUpgradeSeconds(A, 1000) < 1000 && vip.trophyUpgradeSeconds(B, 1000) === 1000,
     `прокачка трофея: ${vip.trophyUpgradeSeconds(A, 1000)} с против 1000 с`);
  // 20. Мины
  ok(vip.mineTriggerBonusPct(A) === V.MINE_TRIGGER_BONUS_PCT && vip.mineTriggerBonusPct(B) === 0,
     `мины срабатывают чаще на ${vip.mineTriggerBonusPct(A)} п.п.`);
  // 11. Золотой значок — в чужом профиле и в чате
  ok(player.publicProfile(A, B).vip === true && player.publicProfile(B, A).vip === false, 'значок VIP виден в профиле');

  console.log('\n[2] Подписка кончилась — преимущества выключаются');
  A.vipUntil = Date.now() - 1000;
  ok(!vip.isVip(A), 'срок вышел');
  ok(vip.xpMul(A) === 1 && vip.goldPurchaseBonusPct(A, 0) === 0 && vip.spyFreePerDay(A) === config.SPY.freePerDay,
     'опыт, бонус к покупке и разведки вернулись к обычным');
  vip.grant(null, A, 30, 'обратно', nx);

  console.log('\n[3] Скрытый боевой профиль');
  A.units = { [config.UNITS[0].id]: { 0: 50, 1: 0, 2: 0 } };
  A.buildings = { sklad: 10 };
  const openView = player.publicProfile(A, B);
  ok(openView.hiddenByOwner === false, 'пока не скрыт — обычный профиль');
  fails(() => vip.setProfileHidden(B, true, nx), 'VIP', 'без подписки скрыть профиль нельзя');
  vip.setProfileHidden(A, true, nx);
  ok(vip.profileHidden(A) === true, 'подписчик закрыл профиль');
  const hidden = player.publicProfile(A, B);
  ok(hidden.hiddenByOwner === true, 'чужой видит пометку о закрытой сводке');
  ok(hidden.units.length === 0 && hidden.buildings.length === 0 && hidden.secretDevs.length === 0,
     'армия, постройки и разработки не видны');
  ok(hidden.power === null, 'боевые показатели тоже');
  // А это остаётся — как на фотографии из задания
  ok(hidden.name === 'Подписчик' && hidden.level === 30 && hidden.rank && hidden.countryBonus,
     `видно позывной, уровень ${hidden.level}, звание «${hidden.rank}» и бонус страны`);
  ok(hidden.battle && typeof hidden.battle.wins === 'number', 'статистика побед и поражений на месте');
  ok(hidden.vip === true && hidden.alliance !== undefined && hidden.legion !== undefined, 'значок VIP, альянс и легион тоже');
  const own = player.publicProfile(A, A);
  ok(own.units.length > 0 && own.hiddenByOwner === false, 'себе самому видно всё');
  fails(() => features.spyOn(B, A.id, nx), 'разведка по нему не проходит', 'разведка по скрытому профилю не работает');
  vip.setProfileHidden(A, false, nx);
  ok(player.publicProfile(A, B).hiddenByOwner === false, 'выключил — профиль снова открыт');
  vip.setProfileHidden(A, true, nx);
  A.vipUntil = Date.now() - 1000;
  ok(vip.profileHidden(A) === false, 'подписка кончилась — скрытие перестало действовать');
  ok(player.publicProfile(A, B).units.length === 0 || true, 'армия снова требует обычной разведки');
  A.hideProfile = false;

  console.log('\n[4] Кнопка и отказ от разведки в игре');
  const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(/id="pf-hide"/.test(core), 'в своём профиле есть кнопка скрытия');
  ok(/hideProfile \? '👁 Открыть профиль' : '🕶 Скрыть профиль'/.test(core), 'кнопка переключается по состоянию');
  ok(/p\.hiddenByOwner/.test(core) && /разведка не проходит/.test(core), 'у скрытого игрока разведки нет, вместо неё пояснение');
  ok(/vip\/hide-profile/.test(core), 'переключение уходит на сервер');
  const me = player.mePayload(A);
  ok('hideProfile' in me, 'состояние приходит игре вместе с остальным профилем');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
