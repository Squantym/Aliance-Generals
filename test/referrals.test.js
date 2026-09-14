// ═══════════════════════════════════════════════════════════════════
// test/referrals.test.js — реферальная система целиком
//
// Что стережётся:
//  1. Награда за 50 уровень друга — 100 золота (было 500).
//  2. Личная ссылка: у каждого своя, код в ней тот же, что виден игроку,
//     и переход по ней равносилен вводу кода руками.
//  3. Список приглашённых: кто пришёл именно ко мне, и чужие в него не
//     попадают.
//  4. Доля с покупок — 10%, приходит ПИСЬМОМ с кнопкой «Забрать», имя
//     покупателя в письме не называется, а золото после получения
//     ложится в историю как «Приглашения», а не как выдача админа.
//  5. Почта: удаление переписки и очистка всего ящика, при которой
//     незабранная награда не сгорает.
//  6. Раздел «Задания»: показан по умолчанию, прячется только из
//     панели и только с правом «Акции».
//  7. Генератор QR: собранная матрица совпадает с эталонным снимком.
//     Сам снимок снят с картинки, прочитанной СТОРОННИМ декодером
//     (jsQR) — то есть проверено не «сам себя проверил», а настоящая
//     читаемость кода камерой.
//
// Запуск: node test/referrals.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
process.env.MONGODB_URI = '';
process.env.APP_URL = 'https://aliance-general.ru';
const path = require('path'), fs = require('fs'), crypto = require('crypto');
require('./_guard');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.cwd(), 'data'); if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const features = require('../dist/src/services/features');
const referrals = require('../dist/src/services/referrals');
const rewards = require('../dist/src/services/rewards');
const social = require('../dist/src/services/social');
const config = require('../dist/config/gameConfig');
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
    await auth.register(name, 'пароль123', `ref${++ip}@t.ru`, 'ru', '10.0.19.' + ip);
    const p = Object.values(player.users()).find((x) => x.name === name);
    p.level = 10; p.gold = 0;
    return p;
  };

  console.log('\n[1] Награда за 50 уровень друга снижена');
  ok(config.REFERRAL.level50Reward === 100,
     `в настройках ${config.REFERRAL.level50Reward} золота вместо прежних 500`);
  const boss = await reg('Вербовщик');
  const rookie = await reg('Новобранец');
  features.applyReferral(rookie, features.ensureRefCode(boss), nx);
  ok(rookie.gold === config.REFERRAL.inviteeGold, `новичку сразу ${rookie.gold} золота`);
  const goldBefore = boss.gold;
  rookie.level = 50;
  features.onReferralLevelUp(rookie);
  ok(boss.gold - goldBefore === 100, `за 50 уровень друга пригласившему ${boss.gold - goldBefore} золота`);
  ok(boss.tokens >= config.REFERRAL.level50Tokens, 'жетоны тоже начислены');

  console.log('\n[2] Личная ссылка');
  const view = features.referralView(boss);
  ok(view.link === 'https://aliance-general.ru/?ref=' + view.code,
     `ссылка ведёт в игру с кодом: ${view.link}`);
  const other = await reg('Посторонний');
  ok(features.referralView(other).link !== view.link, 'у каждого игрока ссылка своя');
  // Переход по ссылке = ввод кода: код из ссылки должен приниматься
  const fromLink = decodeURIComponent(new URL(view.link).searchParams.get('ref'));
  const guest = await reg('ПоСсылке');
  features.applyReferral(guest, fromLink, nx);
  ok(guest.referredBy === boss.id, 'код из ссылки принят — игрок записан приглашённым');

  ok(/^[A-Z0-9]+$/.test(view.code), `код только латиницей и цифрами: ${view.code}`);
  // У старых игроков код собран из русского позывного. Он остаётся
  // рабочим: его могли отправить друзьям до перехода на латиницу.
  const veteran = await reg('Ветеран');
  veteran.refCode = 'ВЕТЕ1234';
  const newCode = features.ensureRefCode(veteran);
  ok(newCode !== 'ВЕТЕ1234' && /^[A-Z0-9]+$/.test(newCode) && newCode.startsWith('VETE'),
     `кириллический код заменён латинским: ВЕТЕ1234 → ${newCode}`);
  const oldFan = await reg('СтарыйДруг');
  features.applyReferral(oldFan, 'ВЕТЕ1234', nx);
  ok(oldFan.referredBy === veteran.id, 'прежний код по-прежнему принимается');

  console.log('\n[3] Список приглашённых');
  const list = features.referralView(boss).invited;
  const names = list.map((x) => x.name).sort();
  ok(names.join(',') === 'Новобранец,ПоСсылке', `в списке только свои: ${names.join(', ')}`);
  ok(features.referralView(other).invited.length === 0, 'у постороннего список пуст');
  const rk = list.find((x) => x.name === 'Новобранец');
  ok(rk.level === 50 && rk.reached50 === true, 'видно уровень друга и отметку о 50-м');

  console.log('\n[4] Доля с покупок друга — письмом и анонимно');
  const before = boss.gold;
  features.onReferralPurchase(rookie, 1000);
  ok(boss.gold === before, 'на счёт молча ничего не упало');
  const letters = rewards.listFor(boss).filter((r) => !r.claimed);
  ok(letters.length === 1, 'пришло ровно одно письмо-награда');
  const letter = letters[0];
  ok(letter.reward.gold === 100, `в письме 10% от покупки: ${letter.reward.gold} золота`);
  ok(!/Новобранец/.test(letter.title + letter.reason), 'имя покупателя в письме не названо');
  ok(/Забрать|забрать|награда|доля|%/.test(letter.title + letter.reason), 'письмо объясняет, за что награда');
  const srcBefore = ((boss.stats || {}).goldGot || {}).referral || 0;
  rewards.claim(boss, letter.id, nx);
  ok(boss.gold === before + 100, `после «Забрать» золото на счету: +${boss.gold - before}`);
  ok((((boss.stats || {}).goldGot || {}).referral || 0) - srcBefore === 100,
     'в истории золота источник — «Приглашения», а не выдача админа');
  ok(boss.refEarnings === 100, 'счётчик заработка с друзей пополнен');
  ok(rookie.refGoldGiven === 100, 'у самого друга записано, сколько он принёс');

  console.log('\n[5] Почта: удаление переписки и очистка ящика');
  social.sendMail(other, boss.name, '', 'Первое письмо');
  other.lastMailAt = 0;
  social.sendMail(other, boss.name, '', 'Второе письмо');
  ok(social.inbox(boss).threads.length === 1, 'переписка появилась');
  // Незабранная награда — для проверки, что очистка её не сожжёт
  rewards.grant(boss.id, { title: 'Тестовая награда', reason: 'проверка', reward: { gold: 7 } });
  const claimed = rewards.listFor(boss).find((r) => r.claimed);
  ok(!!claimed, 'забранное письмо в ящике осталось — его и должна убрать очистка');
  social.deleteThread(boss, other.id);
  ok(social.inbox(boss).threads.length === 0, 'переписка удалена целиком');
  fails(() => social.deleteThread(boss, other.id), 'не найдена', 'второй раз удалять нечего');
  social.sendMail(other, boss.name, '', 'И ещё одно');
  const cleared = social.clearMail(boss);
  ok(cleared.deleted >= 1 && social.inbox(boss).threads.length === 0, 'очистка убрала все письма игроков');
  const cut = rewards.removeClaimed(boss);
  ok(cut.deleted >= 1 && cut.kept === 1, `забранные письма удалены (${cut.deleted}), незабранная награда осталась`);
  ok(rewards.listFor(boss).length === 1 && !rewards.listFor(boss)[0].claimed,
     'в ящике осталась ровно одна — та, что с золотом внутри');
  ok(social.inbox(other).threads.length === 1, 'у собеседника его копия переписки на месте');

  console.log('\n[6] Раздел «Задания» — выключатель в панели');
  ok(referrals.questsEnabled() === true, 'по умолчанию раздел показан игрокам');
  ok(features.referralView(boss).questsOn === true, 'игрок видит кнопку заданий');
  // Запись, оставшаяся от прежнего умолчания «скрыт»: её писал не
  // владелец, а db.saveAll(), поэтому решением её считать нельзя —
  // именно из-за неё раздел так и не появился в игре.
  const st = db.load('referralSettings');
  st.questsOn = false; st.changedAt = 0; st.changedBy = '';
  ok(referrals.questsEnabled() === true,
     'старая запись «скрыт» без отметки о нажатии кнопки не прячет раздел');
  fails(() => referrals.setQuests(boss, false, nx), 'прав', 'обычный игрок выключить не может');
  ok(referrals.questsEnabled() === true, 'и после его попытки раздел остался на месте');
  const owner = await reg('Владелец');
  owner.role = 'owner';
  referrals.setQuests(owner, false, nx);
  ok(referrals.questsEnabled() === false && features.referralView(boss).questsOn === false,
     'владелец выключил — раздел спрятан');
  ok(referrals.adminView(owner).changedBy === 'Владелец', 'в панели видно, кто менял');
  referrals.setQuests(owner, true, nx);
  ok(referrals.questsEnabled() === true, 'и так же возвращается');
  ok(referrals.adminView(owner).questCount
     === config.REFERRAL_QUESTS.inviter.length + config.REFERRAL_QUESTS.newbie.length
       + config.REFERRAL_QUESTS.pairDaily.length + config.REFERRAL_QUESTS.pairOnce.length,
     `в панели посчитаны все задания, включая парные (${referrals.adminView(owner).questCount})`);
  const rq = require('../dist/src/services/referralQuests');
  ok(rq.view(boss).inviter.steps.length === 10, 'в шкале вербовщика десять баллов с наградами');

  console.log('\n[7] Генератор QR');
  const App = { screens: {} };
  const qrSrc = fs.readFileSync(path.join(ROOT, 'public/js/screens/referrals.js'), 'utf8');
  new Function('App', 'document', 'navigator', 'UI', 'API', qrSrc)(App);
  const sha = (m) => crypto.createHash('sha256')
    .update(m.mods.map((r) => r.map((v) => (v ? 1 : 0)).join('')).join('')).digest('hex').slice(0, 16);
  const m1 = App.QR.matrix('https://aliance-general.ru/?ref=TEST1234');
  ok(m1.size === 29 && sha(m1) === '9cbc3f6ca33cf5cf',
     `ссылка кодируется в версию 3 (29×29), снимок сходится: ${sha(m1)}`);
  const m2 = App.QR.matrix('HELLO WORLD');
  ok(m2.size === 21 && sha(m2) === 'f516d851861750f4', 'короткая строка — версия 1 (21×21), снимок сходится');
  // Поисковые квадраты по трём углам: без них камера код не найдёт
  const finder = (m, r0, c0) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const want = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      if (!!m.mods[r0 + r][c0 + c] !== want) return false;
    }
    return true;
  };
  ok(finder(m1, 0, 0) && finder(m1, 0, m1.size - 7) && finder(m1, m1.size - 7, 0),
     'поисковые квадраты стоят во всех трёх углах');
  ok(m1.mods[6][8] === true && m1.mods[6][9] === false && m1.mods[8][6] === true,
     'синхродорожки чередуются');
  ok(m1.mods[m1.size - 8][8] === true, 'обязательный тёмный модуль на месте');
  ok(App.QR.matrix('X'.repeat(200)) === null, 'слишком длинный текст честно возвращает null');
  ok(App.QR.matrix('https://aliance-general.ru/?ref=AAAA1111') !== null
     && sha(App.QR.matrix('https://aliance-general.ru/?ref=AAAA1111')) !== sha(m1),
     'разным кодам — разные картинки');

  console.log('\n[8] Интерфейс собран');
  const refJs = fs.readFileSync(path.join(ROOT, 'public/js/screens/referrals.js'), 'utf8');
  ok(/id="ref-link"/.test(refJs) && /id="ref-qr"/.test(refJs), 'на экране есть и ссылка, и QR-код');
  ok(/ref-qr-save/.test(refJs) && /navigator\.share/.test(refJs), 'QR можно сохранить, ссылкой — поделиться');
  ok(/Кто пришёл по вашей ссылке/.test(refJs), 'список приглашённых выводится');
  // Баннер раздела: лежит в игре, подключён к экрану и не тяжёлый.
  // Картинка декоративная — за её вес никто не заступится, если он
  // однажды вырастет до мегабайта.
  const bannerPath = path.join(ROOT, 'public/img/referral/banner.webp');
  ok(fs.existsSync(bannerPath), 'баннер приглашений лежит в игре');
  const banner = fs.readFileSync(bannerPath);
  ok(banner.length < 150 * 1024, `вес баннера ${Math.round(banner.length / 1024)} КБ — меньше 150 КБ`);
  ok(banner.toString('ascii', 8, 12) === 'WEBP', 'формат webp, а не тяжёлый png');
  // Ширина из заголовка. Формат у webp бывает трёх видов, и ширина в
  // каждом лежит по-своему: VP8X — расширенный, VP8L — без потерь,
  // VP8 — обычный. Шире 1200 на экране игры всё равно не видно.
  const fourcc = banner.toString('ascii', 12, 16);
  const bw = fourcc === 'VP8X' ? 1 + banner.readUIntLE(24, 3)
    : fourcc === 'VP8L' ? (banner.readUInt32LE(21) & 0x3fff) + 1
    : (banner.readUInt16LE(26) & 0x3fff);
  ok(bw > 0 && bw <= 1200, `ширина ${bw} px — под размер экрана`);
  ok(/img\/referral\/banner\.webp/.test(refJs) && /<div class="ref-hero">/.test(refJs),
     'баннер выводится в шапке раздела');
  ok(/\.ref-hero\b/.test(fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8')),
     'и у него есть оформление, а не голая картинка');
  ok(/<img src="\/img\/referral\/banner\.webp"[^>]*loading="lazy"/.test(refJs),
     'и грузится лениво, как остальные картинки игры');

  // Страницы разделены: ссылка и QR — одна, задания — другая
  ok(/App\.screens\.refquests = /.test(refJs), 'задания живут отдельной страницей');
  ok(/d\.questsOn \? `/.test(refJs) && /App\.go\('refquests'\)/.test(refJs),
     'кнопка на задания появляется только при включённом разделе');
  ok(/App\._questScale/.test(refJs) && /rq-bar/.test(refJs), 'шкала баллов рисуется полосой');
  ok(/refquests\/pairs/.test(refJs) && /refquests\/scales/.test(refJs),
     'на странице заданий две вкладки: вербовка и парные');
  ok(/refquests\/pairs\/daily/.test(refJs) && /refquests\/pairs\/once/.test(refJs),
     'у парных заданий два подраздела: ежедневные и разовые');
  ok(/App\._questBar/.test(refJs) && /rq-line-fill/.test(refJs),
     'у каждого задания своя полоса прогресса');
  ok(/rq-item/.test(refJs), 'каждое задание в своей рамке');
  ok(/rq-badge/.test(refJs) && /badge: 'VIP'/.test(fs.readFileSync(path.join(ROOT, 'src/services/referralQuests.ts'), 'utf8')),
     'VIP показывается надписью, а не картинкой');
  // Именно ТЕКСТ награды, а не упоминание в комментарии рядом
  ok(/text: 'возврат 50% от стоимости товара'/.test(fs.readFileSync(path.join(ROOT, 'src/services/referralQuests.ts'), 'utf8')),
     'награда за покупку на рынке названа возвратом половины стоимости');
  ok(!/ref-input/.test(refJs) && !/referral\/apply/.test(refJs),
     'ручного ввода чужого кода в игре больше нет');
  ok(/App\._rewardIcon/.test(refJs) && /img\/containers\//.test(fs.readFileSync(path.join(ROOT, 'src/services/referralQuests.ts'), 'utf8')),
     'у наград настоящие картинки игры, а не эмодзи');
  const appJs = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  ok(/localStorage\.setItem\('refcode'/.test(appJs) && /referral: 'referrals'/.test(appJs),
     'код из ссылки запоминается, экран вынесен в свой файл');
  ok(/history\.replaceState/.test(appJs), 'код убирается из адресной строки');
  const coreJs = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok(!/App\.screens\.referral = /.test(coreJs), 'старого экрана в core.js больше нет');
  // Код уходит ВМЕСТЕ с анкетой регистрации: применить чужой код позже,
  // уже играющим аккаунтом, нельзя
  ok(/ref: App\._pendingRefCode/.test(coreJs), 'код из ссылки уходит с регистрацией');
  ok(/App\._forgetRefCode\(\)/.test(coreJs), 'и после регистрации забывается');
  const routesTs = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
  ok(!/\/api\/referral\/apply/.test(routesTs), 'отдельной ручки «применить код» на сервере нет');
  ok(/features\.applyReferral\(fresh, code/.test(routesTs), 'зато код из анкеты регистрации применяется');
  const socialJs = fs.readFileSync(path.join(ROOT, 'public/js/screens/social.js'), 'utf8');
  ok(/api\/mail\/clear-all/.test(socialJs) && /api\/mail\/thread\//.test(socialJs),
     'в почте есть очистка всего и удаление переписки');
  ok(/data-del-mail/.test(socialJs), 'у каждого сообщения — своя кнопка удаления');
  const admJs = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  ok(/renderRefQuests/.test(admJs) && /rq-toggle/.test(admJs), 'в панели есть кнопка показа раздела');
  const adm2 = fs.readFileSync(path.join(ROOT, 'public/js/admin2/econ.js'), 'utf8');
  ok(/refquests/.test(adm2), 'подвкладка есть и в новой панели — владелец работает в ней');

  console.log(`\n✅ Все проверки пройдены: ${passed}`);
  setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 100); });
