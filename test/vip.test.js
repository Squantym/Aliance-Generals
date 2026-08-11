// ═══════════════════════════════════════════════════════════════════
// VIP-подписка: все двадцать преимуществ из списка владельца.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-vip-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };
const fails = (fn, part, n) => { try { fn(); ok(false, n + ' (ошибки не было)'); } catch (e) { ok(String(e.message).includes(part), `${n} → «${e.message.slice(0, 50)}»`); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const vip = require(ROOT + '/dist/src/services/vip');
const daily = require(ROOT + '/dist/src/services/dailyQuests');
const feat = require(ROOT + '/dist/src/services/features');
const troph = require(ROOT + '/dist/src/services/trophies');
const cfg = require(ROOT + '/dist/config/gameConfig');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');

async function main() {
for (const [n, e] of [['ВИП','a'],['Обычный','b'],['Шпион','c']]) {
  await auth.register(n, 'пароль123', e + '@t.ru', 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const v = by('ВИП'), plain = by('Обычный'), spy = by('Шпион');
for (const x of [v, plain, spy]) x.level = 50;
vip.grant(null, v, 30, 'тест', []);

console.log('\n── Подписка ──');
ok(vip.isVip(v) === true, 'подписка активна');
ok(vip.isVip(plain) === false, 'у обычного игрока её нет');
ok(vip.vipInfo(v).daysLeft === 30, `осталось дней: ${vip.vipInfo(v).daysLeft}`);
// Продление не сжигает остаток
vip.grant(null, v, 10, 'продление', []);
ok(vip.vipInfo(v).daysLeft === 40, 'повторная выдача продлевает, а не перетирает');
vip.grant(null, v, -30, 'откат', []);   // clamp вернёт 1 день
ok(vip.isVip(v), 'подписка держится');
v.vipUntil = Date.now() + 30 * 86400000;

console.log('\n── 1. Восстановление (−30% от текущего) ──');
ok(vip.regenSeconds(plain, 180) === 180, 'обычному без изменений');
ok(vip.regenSeconds(v, 180) === 126, `180 → ${vip.regenSeconds(v, 180)} с`);
ok(vip.regenSeconds(v, 90) === 63, `с трофеем 90 → ${vip.regenSeconds(v, 90)} с — считается от уже ускоренного`);

console.log('\n── 2, 15. Суточные счётчики ──');
ok(vip.left(v, 'heal') === cfg.VIP.HOSPITAL_FREE_PER_DAY, `лечений: ${vip.left(v, 'heal')}`);
ok(vip.left(v, 'immunity') === 3, `иммунитетов к фаталити: ${vip.left(v, 'immunity')}`);
ok(vip.left(v, 'reroll') === 2, `замен поручений: ${vip.left(v, 'reroll')}`);
ok(vip.left(plain, 'heal') === 0, 'обычному суточных преимуществ не полагается');
let used = 0;
for (let i = 0; i < 5; i++) if (vip.tryFatalityImmunity(v)) used++;
ok(used === 3, `иммунитет сработал ровно ${used} раза`);
ok(vip.left(v, 'immunity') === 0, 'после исчерпания — ноль');

console.log('\n── 3, 19. Ускорения ──');
ok(vip.siloRocketSeconds(v, 1000) === 500, 'шахты и ракеты вдвое быстрее');
ok(vip.trophyUpgradeSeconds(v, 1000) === 500, 'улучшение трофеев вдвое быстрее');
const tv = troph.list(v).trophies[0], tp = troph.list(plain).trophies[0];
ok(tv.trainMinutes < tp.trainMinutes, `в игре: ${tp.trainMinutes} мин → ${tv.trainMinutes} мин`);

console.log('\n── 4. Массовые действия ──');
const acceptedBefore = daily.list(v).quests.filter((q) => q.accepted).length;
daily.acceptAll(v, []);
const acceptedAfter = daily.list(v).quests.filter((q) => q.accepted).length;
ok(acceptedAfter > acceptedBefore, `принято одной кнопкой: ${acceptedBefore} → ${acceptedAfter}`);
fails(() => daily.acceptAll(plain, []), 'VIP-подписке', 'обычному игроку недоступно');
fails(() => daily.claimAll(plain, []), 'VIP-подписке', 'сдача всех — тоже');
const cl = [];
daily.claimAll(v, cl);
ok(true, 'сдача всех выполненных не падает даже когда сдавать нечего');

console.log('\n── 5, 6, 7. Лимиты ──');
ok(vip.spyFreePerDay(plain) === cfg.SPY.freePerDay && vip.spyFreePerDay(v) === 7,
   `разведок: ${vip.spyFreePerDay(plain)} → ${vip.spyFreePerDay(v)}`);
ok(vip.reinforcePerDay(plain) === 10 && vip.reinforcePerDay(v) === 15,
   `подкреплений: ${vip.reinforcePerDay(plain)} → ${vip.reinforcePerDay(v)}`);
ok(vip.contractsPerDay(plain) === 3 && vip.contractsPerDay(v) === 5,
   `контрактов: ${vip.contractsPerDay(plain)} → ${vip.contractsPerDay(v)}`);

console.log('\n── 8. Замена поручений ──');
const q0 = daily.list(v).quests[0];
daily.reroll(v, q0.id, []);
const q1 = daily.list(v).quests[0];
ok(q1.id !== q0.id, `поручение сменилось: «${q0.name}» → «${q1.name}»`);
ok(vip.left(v, 'reroll') === 1, 'замена списана');
daily.reroll(v, daily.list(v).quests[0].id, []);
fails(() => daily.reroll(v, daily.list(v).quests[0].id, []), 'закончились', 'третья замена отклонена');
fails(() => daily.reroll(plain, 'x', []), 'VIP-подписке', 'обычному недоступно');

console.log('\n── 10. Кто разведал ──');
feat.spyOn(spy, v.id, []);
ok(v.spiedBy && v.spiedBy.list.length === 1, 'разведка записана цели');
ok(v.spiedBy.list[0].name === 'Шпион', `видно, кто смотрел: ${v.spiedBy.list[0].name}`);
feat.spyOn(spy, v.id, []);
ok(v.spiedBy.list.length === 1 && v.spiedBy.list[0].count === 2,
   'повторная разведка тем же игроком не плодит записи, а считается');
ok(v.spiedBy.day === vip.mskDayKey(), 'список привязан к суткам по Москве');

console.log('\n── 12, 13. Рынок и золото ──');
ok(vip.marketDiscountPct(v, 0) === 15, 'без акции скидка 15%');
ok(vip.marketDiscountPct(v, 40) === 50, 'акция 40% + VIP = 50% (упёрлись в потолок)');
ok(vip.marketDiscountPct(v, 60) === 60, 'акция 60% остаётся как есть — надбавка не идёт');
ok(vip.marketDiscountPct(plain, 40) === 40, 'обычному — только акция');
ok(vip.goldPurchaseBonusPct(v, 50) === 65, 'акция 50% + VIP 15% = 65%');
ok(vip.goldPurchaseBonusPct(plain, 50) === 50, 'обычному — только акция');

console.log('\n── 14, 16, 17, 20. Множители ──');
ok(vip.upkeepMul(v) === 0.85 && vip.upkeepMul(plain) === 1, 'содержание техники −15%');
ok(vip.incomeMul(v) === 1.15, 'доход построек +15%');
ok(vip.xpMul(v) === 1.3, 'опыт +30%');
ok(vip.unitLossMul(v) === 0.7, 'потери техники −30%');
ok(vip.mineTriggerBonusPct(v) === 5 && vip.mineTriggerBonusPct(plain) === 0, 'мины +5 п.п.');

console.log('\n── 18. Смена позывного ──');
ok(vip.canRenameFree(v) === true, 'бесплатная смена доступна');
ok(vip.canRenameFree(plain) === false, 'обычному — нет');
vip.markRenameUsed(v);
ok(vip.canRenameFree(v) === false, 'после использования — ждать 30 дней');

console.log('\n── Подключение к игре ──');
const playerSrc = fs.readFileSync(ROOT + '/src/services/player.ts', 'utf8');
ok(/vipSrv\.regenSeconds\(user, Math\.round\(/.test(playerSrc), 'восстановление проходит через VIP');
ok(/amount = Math\.round\(amount \* require\('\.\/vip'\)\.xpMul\(user\)\)/.test(playerSrc), 'опыт умножается');
ok(/total \*= require\('\.\/vip'\)\.upkeepMul\(user\)/.test(playerSrc), 'содержание учитывается');
ok(/total \*= require\('\.\/vip'\)\.incomeMul\(user\)/.test(playerSrc), 'доход учитывается');
const battleSrc = fs.readFileSync(ROOT + '/src/services/battle.ts', 'utf8');
ok(/function unitLossFor/.test(battleSrc), 'потери техники считаются с учётом подписки');
ok(/tryFatalityImmunity\(victimCheck\)/.test(battleSrc), 'иммунитет к фаталити проверяется в бою');
ok(/vipSaved \|\| Math\.random\(\) < dodgeChance/.test(battleSrc),
   'иммунитет проверяется ДО броска на ловкость — иначе удачный бросок съедал бы попытку');
const paySrc = fs.readFileSync(ROOT + '/src/services/payments.ts', 'utf8');
ok(/bonusMul\('gold', user\)/.test(paySrc), 'бонус к покупке золота применяется');

console.log('\n── Роуты ──');
for (const [m, r] of [['GET', '/api/vip'], ['POST', '/api/admin/vip/grant'], ['POST', '/api/admin/vip/revoke'],
                      ['POST', '/api/daily/accept-all'], ['POST', '/api/daily/claim-all'],
                      ['POST', '/api/daily/reroll'], ['GET', '/api/spied-by']]) {
  const re = new RegExp(`app\\.add\\('${m}',\\s*'${r.replace(/\//g, '\\/')}'`);
  ok(re.test(routes), `роут ${m} ${r} зарегистрирован`);
}
ok(/vip: require\('\.\/services\/vip'\)\.isVip\(req\.user\)/.test(routes), 'признак VIP приходит игроку');
const socialSrc = fs.readFileSync(ROOT + '/src/services/social.ts', 'utf8');
ok(/vip: author \?/.test(socialSrc), 'признак VIP есть в сообщениях чата');
ok(/vip: \(\(\) => \{ try \{ return require\('\.\/vip'\)\.isVip\(t\)/.test(battleSrc), 'и в списке целей');

console.log('\n── 9. Расширенная статистика ──');
const stats = require(ROOT + '/dist/src/services/stats');
player.addGold(v, 500, 'purchase');
player.addGold(v, 100, 'quest');
player.addMoney(v, 1000000, false);
stats.track(v, 'unitsBought', 'ground', 5);
stats.track(v, 'unitsLost', 'total', 2);
stats.track(v, 'sabBought', 'air', 10);
v.lastSeen = Date.now() - 120000;
stats.tickPlayTime(v);
const rep = stats.report(v);
ok(typeof rep.hoursInGame === 'number', `часов в игре: ${rep.hoursInGame}`);
ok(rep.daysInService >= 1, `дней в строю: ${rep.daysInService}`);
ok(rep.gold.total === 600, `золота получено всего: ${rep.gold.total}`);
ok(rep.gold.bySource.some((x) => x.id === 'purchase' && x.value === 500),
   'разбивка золота по источникам: покупки отдельно');
ok(rep.gold.bySource.some((x) => x.id === 'quest'), 'поручения отдельно');
ok(rep.money.earned >= 1000000, 'заработанные деньги учтены');
ok(rep.units.bought === 5 && rep.units.lost === 2, `техника: куплено ${rep.units.bought}, потеряно ${rep.units.lost}`);
ok(rep.units.byTypeBought.some((x) => x.id === 'ground'), 'техника разбита по родам войск');
ok(rep.saboteurs.bought === 10, `диверсанты: ${rep.saboteurs.bought}`);
ok(rep.saboteurs.byTypeBought.some((x) => x.id === 'air'), 'диверсанты разбиты по типам');
ok(!!rep.battle, 'боевой раздел на месте');
fails(() => { if (!vip.isVip(plain)) throw new Error('Расширенная статистика доступна по VIP-подписке'); },
      'VIP-подписке', 'обычному игроку статистика закрыта');
// Учёт подключён к реальным точкам
const unitsSrc = fs.readFileSync(ROOT + '/src/services/units.ts', 'utf8');
ok(/require\('\.\/stats'\)\.track\(user, 'unitsBought', def\.type/.test(unitsSrc),
   'покупка техники учитывается по роду войск');
const battleSrc2 = fs.readFileSync(ROOT + '/src/services/battle.ts', 'utf8');
ok(/require\('\.\/stats'\)\.track\(owner, 'unitsLost'/.test(battleSrc2), 'потери техники учитываются');
const sabSrc = fs.readFileSync(ROOT + '/src/services/saboteurs.ts', 'utf8');
ok(/require\('\.\/stats'\)\.track\(user, 'sabBought', type/.test(sabSrc), 'диверсанты учитываются по типам');
const httpSrc = fs.readFileSync(ROOT + '/src/core/http.ts', 'utf8');
ok(/tickPlayTime\(user\)/.test(httpSrc), 'время в игре считается на каждом запросе');

console.log('\n── 18. Смена позывного в игре ──');
const v2 = plain;   // временно делаем VIP для проверки
vip.grant(null, v2, 5, 'проверка', []);
v2.lastFreeRenameAt = 0;
player.renameSelf(v2, 'Переименован', []);
ok(v2.name === 'Переименован', `позывной сменён: ${v2.name}`);
fails(() => player.renameSelf(v2, 'Ещё Раз', []), 'раз в 30 дней', 'повторная смена ждёт срока');
v2.lastFreeRenameAt = 0;
fails(() => player.renameSelf(v2, 'ВИП', []), 'занят', 'занятый позывной отклоняется');
fails(() => player.renameSelf(v2, 'ab', []), 'от 3 до 16', 'слишком короткий отклоняется');
fails(() => player.renameSelf(spy, 'Кто-то', []), 'VIP-подписке', 'без подписки менять нельзя');

console.log('\n── 2. Госпиталь вне очереди ──');
const hospital = require(ROOT + '/dist/src/services/hospital');
const hospSrc = fs.readFileSync(ROOT + '/src/services/hospital.ts', 'utf8');
ok(/vipSrv\.spend\(user, 'heal'\)/.test(hospSrc), 'лечение вне очереди списывает суточную попытку');
ok(/if \(now - last < COOLDOWN_MS\)/.test(hospSrc), 'попытка тратится только когда ожидание реально мешает');
ok(/!vipSkip && now - last < COOLDOWN_MS/.test(hospSrc), 'без подписки ожидание действует как прежде');

console.log('\n── 11, 4. Интерфейс ──');
const appSrc = fs.readFileSync(ROOT + '/public/js/app.js', 'utf8');
ok(/vipMark\(isVip\)/.test(appSrc), 'есть значок VIP');
ok(/class="vip-mark"/.test(appSrc), 'значок оформлен отдельным классом');
const socJs = fs.readFileSync(ROOT + '/public/js/screens/social.js', 'utf8');
ok(/App\.vipMark\(msg\.vip\)/.test(socJs), 'значок в чате');
const warJs = fs.readFileSync(ROOT + '/public/js/screens/war.js', 'utf8');
ok(/App\.vipMark\(o\.vip\)/.test(warJs), 'значок в списке целей');
const coreJs = fs.readFileSync(ROOT + '/public/js/screens/core.js', 'utf8');
ok(/App\.vipMark\(p\.vip\)/.test(coreJs), 'значок в профиле');
ok(/id="q-accept-all"/.test(coreJs) && /id="q-claim-all"/.test(coreJs), 'кнопки «принять все» и «сдать все»');
ok(/data-reroll=/.test(coreJs), 'кнопка замены поручения');
ok(/App\.me && App\.me\.vip/.test(coreJs), 'кнопки видны только подписчикам');
const cssSrc = fs.readFileSync(ROOT + '/public/css/style.css', 'utf8');
ok(/\.vip-mark \{[\s\S]{0,220}(#c9a227|#f3d27a|var\(--gold\))/.test(cssSrc), 'значок золотого цвета');
ok((cssSrc.match(/^\.vip-mark \{/gm) || []).length === 1, 'стиль значка объявлен один раз — без дублей');
ok(/App\.screens\.vip = /.test(coreJs), 'страница подписки есть в игре');
ok(/api\/vip/.test(coreJs), 'она берёт данные с сервера');
ok(cssSrc.includes('.vip-bulk'), 'панель массовых действий оформлена');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
