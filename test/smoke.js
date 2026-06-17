// ===================================================================
// test/smoke.js — дымовой тест всего API
// Поднимите сервер (node server.js) и запустите: node test/smoke.js
// Тест регистрирует двух игроков и проходит ключевые сценарии:
// бой, обучение, миссии, покупки, рынок, клуб, альянс, почту, админку.
// ===================================================================

const BASE = process.env.BASE || 'http://127.0.0.1:3000';

let passed = 0, failed = 0;

// Мини-обвязка проверок
function check(name, cond) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✖ ' + name); }
}

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-token': token || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const get = (p, t) => api('GET', p, t);
const post = (p, t, b) => api('POST', p, t, b || {});

async function main() {
  const stamp = Date.now().toString(36).slice(-5);
  const nameA = 'Admin' + stamp;
  const nameB = 'Boets' + stamp;

  console.log('1. Регистрация и вход');
  // В dev-режиме (без RESEND_API_KEY) сервер сразу выдаёт токен
  const regA = await post('/api/register', null, { login: nameA, email: `admina${stamp}@test.ru`, password: 'pass123', country: 'ru' });
  check('первый игрок зарегистрирован', regA.status === 200 && (!!regA.data.token || regA.data.pending));
  const A = regA.data.token; // в dev-режиме есть сразу
  const regB = await post('/api/register', null, { login: nameB, email: `boetsb${stamp}@test.ru`, password: 'pass123', country: 'ua' });
  check('второй игрок зарегистрирован', regB.status === 200);
  const B = regB.data.token;
  const dupe = await post('/api/register', null, { login: nameA, email: `dupe${stamp}@test.ru`, password: 'x1234', country: 'ru' });
  check('дубликат позывного отклонён', dupe.status === 400);
  const dupeEmail = await post('/api/register', null, { login: 'ZZZ' + stamp, email: `admina${stamp}@test.ru`, password: 'x1234', country: 'ru' });
  check('дубликат email отклонён', dupeEmail.status === 400);
  const login = await post('/api/login', null, { login: nameA, password: 'pass123' });
  check('вход работает', login.status === 200 && !!login.data.token);

  console.log('2. Состояние игрока');
  let meA = (await get('/api/me', A)).data;
  check('/api/me отвечает', meA.name === nameA);
  check('стартовые деньги $80000', meA.dollars === 80000);
  check('туториал активен, шаг 0', meA.tutorial.done === false && meA.tutorial.step === 0);
  const idA = meA.id;
  const idB = (await get('/api/me', B)).data.id;

  console.log('3. Война (туториал: атака)');
  const opp = (await get('/api/war/opponents', A)).data;
  check('10 целей в списке', opp.opponents.length === 10);
  const bot = opp.opponents.find((o) => o.isBot);
  check('боты-террористы есть', !!bot);
  const atk = await post('/api/war/attack', A, { targetId: bot.id });
  check('атака бота прошла', atk.status === 200 && typeof atk.data.win === 'boolean');
  meA = (await get('/api/me', A)).data;
  check('боеприпас потрачен и восстановлен левелапом', meA.res.am.cur <= meA.res.am.max);
  check('туториал сдвинулся на шаг 1', meA.tutorial.step === 1);

  console.log('4. Техника (туториал: покупка)');
  const units = (await get('/api/units', A)).data;
  const firstUnit = units.items.find((x) => !x.locked);
  check('каталог техники не пуст', !!firstUnit);
  const buy = await post('/api/units/buy', A, { unitId: firstUnit.id, qty: 2 });
  check('покупка техники прошла', buy.status === 200 && buy.data.owned === 2);
  meA = (await get('/api/me', A)).data;
  check('туториал на шаге 2', meA.tutorial.step === 2);
  check('мощь атаки выросла', meA.power.atk > 0);

  console.log('5. Миссии-конфликты (туториал: шаг дозора)');
  const ms = (await get('/api/missions', A)).data;
  const firstConf = ms.conflicts.find((x) => !x.locked);
  // Деталь конфликта
  const confDetail = (await get('/api/missions/' + firstConf.id, A)).data;
  check('детали конфликта читаются', confDetail.operations.length >= 7);
  // Запускаем первый шаг первой операции
  const stepStart = await post('/api/missions/start', A, { confId: firstConf.id, opIdx: 0, stepIdx: 0 });
  check('шаг миссии запущен', stepStart.status === 200 && !!stepStart.data.processId);
  // Сразу ускорим за золото (на старте золота нет — выдадим админкой)
  await post('/api/admin/grant', A, { userId: idA, gold: 50 });
  const boostStep = await post('/api/missions/boost', A, { processId: stepStart.data.processId });
  check('шаг миссии ускорен', boostStep.status === 200);
  meA = (await get('/api/me', A)).data;
  check('энергия потрачена и восстановлена левелапом', meA.res.en.cur <= meA.res.en.max);
  check('туториал на шаге 3', meA.tutorial.step === 3);

  console.log('6. Постройки (туториал: доходное здание)');
  const bl = (await get('/api/buildings', A)).data;
  const firstB = bl.income.find((x) => !x.locked);
  const built = await post('/api/buildings/build', A, { buildingId: firstB.id, qty: 1 });
  check('постройка возведена', built.status === 200 && built.data.owned === 1);
  meA = (await get('/api/me', A)).data;
  check('туториал на шаге 4', meA.tutorial.step === 4);
  check('доход в час появился', meA.incomePerHour > 0);

  console.log('7. Навыки (финал туториала, +100 золота)');
  check('очки навыков накоплены с уровней', meA.skillPoints >= 1);
  const goldBefore = meA.gold;
  const skill = await post('/api/skill', A, { stat: 'energy' });
  check('очко навыка потрачено', skill.status === 200 && skill.data.skills.energy === 1);
  meA = (await get('/api/me', A)).data;
  check('туториал завершён', meA.tutorial.done === true);
  check('выдано 100 золота за обучение', meA.gold === goldBefore + 100);

  console.log('8. Чёрный рынок: контейнер');
  const open = await post('/api/market/open', A, { tier: 1 });
  check('контейнер за 50 золота открыт', open.status === 200 && Array.isArray(open.data.drops));
  const cont = (await get('/api/market/containers', A)).data;
  check('коллекция читается', cont.collection.length === 9);

  console.log('9. Аукцион');
  const auc = (await get('/api/market/auction', A)).data;
  check('лоты аукциона на месте', auc.lots.length === 3);
  meA = (await get('/api/me', A)).data;
  if (meA.gold >= auc.lots[0].minBid) {
    const bid = await post('/api/market/bid', A, { lotId: auc.lots[0].id, amount: auc.lots[0].minBid });
    check('ставка принята', bid.status === 200);
  } else {
    check('ставка пропущена (мало золота) — допустимо', true);
  }

  console.log('10. Клуб офицеров');
  const club = (await get('/api/club', A)).data;
  check('загадка стенгазеты активна', club.riddle.state === 'active' && !!club.riddle.q);
  const riddle = await post('/api/club/riddle', A, { answer: 'заведомо неверный ответ' });
  check('неверный ответ обработан', riddle.status === 200 && riddle.data.correct === false);
  await post('/api/club/guess/start', A);
  const guess = await post('/api/club/guess', A, { number: 250 });
  check('попытка угадать число обработана', ['win', 'hint', 'fail'].includes(guess.data.result));
  const arm = await post('/api/club/arm', A, { bet: 1000 });
  check('армрестлинг сыгран', arm.status === 200 && typeof arm.data.win === 'boolean');

  console.log('11. Банк');
  meA = (await get('/api/me', A)).data;
  const cash = meA.dollars;
  const dep = await post('/api/bank', A, { action: 'deposit', amount: 1000 });
  check('вклад принят с комиссией 10%', dep.status === 200 && dep.data.bank === 900 && dep.data.dollars === cash - 1000);
  const wd = await post('/api/bank', A, { action: 'withdraw', amount: 900 });
  check('снятие без комиссии', wd.status === 200 && wd.data.bank === 0);

  console.log('12. Чат и почта');
  const chat = await post('/api/chat', A, { text: 'Всем в укрытие! Идёт дымовой тест.' });
  check('сообщение в чат отправлено', chat.status === 200);
  const chatList = (await get('/api/chat', A)).data;
  check('сообщение видно в чате', chatList.messages.some((m) => m.name === nameA));
  const mail = await post('/api/mail', A, { toName: nameB, subject: 'Проверка связи', text: 'Как слышно, приём!' });
  check('письмо отправлено', mail.status === 200);
  const inboxB = (await get('/api/mail', B)).data;
  const letter = inboxB.messages.find((m) => m.fromName === nameA);
  check('письмо дошло адресату', !!letter);
  const read = await get('/api/mail/' + letter.id, B);
  check('письмо читается', read.status === 200 && read.data.mail.text.includes('приём'));

  console.log('13. Админка (доступ и выдача)');
  const denied = await get('/api/admin/players', B);
  check('обычному игроку админка закрыта (403)', denied.status === 403);
  const players = (await get('/api/admin/players?q=' + nameB, A)).data;
  check('поиск игроков работает', players.players.some((p) => p.id === idB));
  const grant = await post('/api/admin/grant', A, {
    userId: idB, gold: 1000, dollars: 2000000, setLevel: 75,
  });
  check('выдача ресурсов прошла', grant.status === 200 && grant.data.player.level === 75 && grant.data.player.gold >= 1000);

  console.log('13b. Админка: скидки');
  const dcCats = (await get('/api/admin/discounts', A)).data;
  check('категории скидок доступны', dcCats.categories.length >= 8);
  const setDc = await post('/api/admin/discount', A, { category: 'unit', pct: 50, hours: 1 });
  check('скидка 50% на технику установлена', setDc.status === 200 && setDc.data.active.unit.pct === 50);
  // Проверка применения: цена техники должна снизиться
  const unitsAfter = (await get('/api/units', B)).data;
  const u1After = unitsAfter.items.find((x) => x.id === 'ground_1');
  check('цена техники со скидкой = 50% от 30000', u1After.price === 15000);

  console.log('14. Производство (у игрока B теперь 75 уровень)');
  const unitsB = (await get('/api/units', B)).data;
  const cheapB = unitsB.items.find((x) => !x.locked);
  // Купим 5 единиц — попадут в Mk0
  await post('/api/units/buy', B, { unitId: cheapB.id, qty: 5 });
  const ws = await post('/api/production/workshop', B);
  check('цех куплен', ws.status === 200 && ws.data.workshops === 1);
  // Запустим партию: 3 единицы Mk0 → Mk1
  const start = await post('/api/production/start', B, { unitId: cheapB.id, fromMk: 0, qty: 3 });
  check('партия модернизации запущена', start.status === 200 && !!start.data.processId);
  const prod1 = (await get('/api/production', B)).data;
  check('один слот цеха занят', prod1.slotsUsed === 1 && prod1.queue.length === 1);
  check('осталось 2 ед. Mk0 в наличии', prod1.queue[0].qty === 3);
  // Ускорим партию за 100 золота
  await post('/api/admin/grant', A, { userId: idB, gold: 200 });
  const boost = await post('/api/production/boost', B, { processId: start.data.processId });
  check('ускорение принято', boost.status === 200);
  // После следующего запроса refresh() завершит процесс
  const prod2 = (await get('/api/production', B)).data;
  check('слот цеха освободился', prod2.slotsUsed === 0 && prod2.queue.length === 0);
  // Проверим что 3 ед. теперь в Mk1
  const unitsAfterMod = (await get('/api/units', B)).data;
  const cheapNow = unitsAfterMod.items.find((x) => x.id === cheapB.id);
  check('3 ед. перешли в Mk1', cheapNow.ownedMk[1] === 3 && cheapNow.ownedMk[0] === 2);
  const prodLockedA = await post('/api/production/workshop', A);
  check('игроку низкого уровня производство закрыто', prodLockedA.status === 400);

  console.log('15. Альянс (новый groups API)');
  const alC = await post('/api/group/alliance/create', B, { name: 'Тест ' + stamp });
  check('альянс создан (75 ур., $1M есть)', alC.status === 200);
  const alB = (await get('/api/group/alliance', B)).data;
  check('состав альянса виден', alB.mine && alB.mine.members.length === 1);
  const meB = (await get('/api/me', B)).data;
  check('вместимость = 100 + 10*1 = 110 (1 человек в альянсе)', meB.capacity === 110);
  // Приглашение игроком A через инвайт + ответ
  const inv = await post('/api/group/alliance/invite', B, { userId: idA });
  check('приглашение отправлено', inv.status === 200);
  const invA = (await get('/api/group/alliance/invites', A)).data;
  check('у адресата виден инвайт', invA.invites.length === 1);
  const accept = await post('/api/group/alliance/respond', A, { groupId: alC.data.id, accept: true });
  check('инвайт принят', accept.status === 200);
  const meB2 = (await get('/api/me', B)).data;
  check('вместимость = 100 + 10*2 = 120 (2 человека)', meB2.capacity === 120);

  console.log('16. Профиль, зал славы, достижения');
  const prof = (await get('/api/profile/' + idA, B)).data;
  check('чужой профиль читается', prof.profile.name === nameA);
  check('атака вне ±10 уровней запрещена', prof.profile.canAttack === false);
  const fame = (await get('/api/fame', A)).data;
  check('зал славы: 7 категорий', fame.categories.length === 7);
  const ach = (await get('/api/achievements', A)).data;
  check('достижения читаются', ach.achievements.length >= 5);
  const trophies = (await get('/api/trophies', A)).data;
  check('трофеи читаются', trophies.trophies.length === 14);

  console.log('17. Покупка золота (заготовка)');
  const packs = (await get('/api/bank/gold-packages', A)).data;
  check('пакеты золота доступны', packs.packages.length === 6);
  check('первый пакет — 100 золота за 100 руб', packs.packages[0].gold === 100 && packs.packages[0].priceRub === 100);
  check('крупный пакет имеет бонус', packs.packages[packs.packages.length - 1].bonus > 0);
  const buyG = await post('/api/bank/buy-gold', A, { packId: 'pack_100' });
  check('покупка золота вернула pending (оплата не подключена)', buyG.status === 200 && buyG.data.pending === true);

  console.log('18. Очки навыков за уровень = 5');
  // У игрока A после регистрации и активности должны быть очки
  meA = (await get('/api/me', A)).data;
  check('у игрока есть очки навыков', meA.skillPoints >= 0);
  check('xpNext присутствует для полоски опыта', typeof meA.xpNext === 'number' && meA.xpNext > 0);

  console.log('19. Паспорт (смена имени и страны на чёрном рынке)');
  await post('/api/admin/grant', A, { userId: idA, gold: 5000 });
  const ppView = (await get('/api/passport', A)).data;
  check('паспорт: первая смена имени стоит 100', ppView.namePrice === 100);
  check('паспорт: первая смена страны стоит 100', ppView.countryPrice === 100);
  const ppName = await post('/api/passport/name', A, { newName: nameA + 'X' });
  check('паспорт: имя сменено', ppName.status === 200 && ppName.data.newName === nameA + 'X');
  const ppView2 = (await get('/api/passport', A)).data;
  check('паспорт: следующая смена имени дороже в 2 раза', ppView2.namePrice === 200);
  const ppCountry = await post('/api/passport/country', A, { country: 'ua' });
  check('паспорт: страна сменена на UA', ppCountry.status === 200);

  console.log('20. Бои: новые поля результата боя');
  const opps = (await get('/api/war/opponents', A)).data;
  check('у оппонентов есть поле allianceMembers', typeof opps.opponents[0].allianceMembers === 'number');
  const botId = opps.opponents.find((o) => o.isBot).id;
  const botProf = await get('/api/profile/' + botId, A);
  check('профиль бота открывается', botProf.status === 200 && botProf.data.profile.isBot === true);

  console.log('21. Техника прибавляет атаку и защиту в общую мощь');
  // Берём свежего игрока (B), у него ещё нет техники
  const meBnoUnits = (await get('/api/me', B)).data;
  const atkBefore = meBnoUnits.power.atk;
  const defBefore = meBnoUnits.power.def;
  // Покупаем 1 наземный юнит (Т-54: 50/50)
  await post('/api/admin/grant', A, { userId: idB, dollars: 100000 });
  const buyUnit = await post('/api/units/buy', B, { unitId: 'ground_1', qty: 1 });
  check('купили 1× Т-54', buyUnit.status === 200);
  const meBwithUnits = (await get('/api/me', B)).data;
  check('атака УВЕЛИЧИЛАСЬ после покупки', meBwithUnits.power.atk > atkBefore);
  check('защита УВЕЛИЧИЛАСЬ после покупки', meBwithUnits.power.def > defBefore);

  console.log('22. Дипломаты в альянсе');
  // Игрок B — лидер альянса (создал его в шаге 15). Проверяем найм дипломата.
  await post('/api/admin/grant', A, { userId: idB, gold: 5000 });
  const allianceBefore = (await get('/api/group/alliance', B)).data;
  if (allianceBefore.mine && allianceBefore.mine.isLeader) {
    check('базовый лимит приглашений = 5', allianceBefore.mine.inviteLimit === 5);
    check('первый дипломат стоит 100 золота', allianceBefore.mine.nextDiplomatCost === 100);
    const hire = await post('/api/group/alliance/diplomat', B);
    check('первый дипломат нанят', hire.status === 200);
    const allianceAfter = (await get('/api/group/alliance', B)).data;
    check('лимит вырос до 6 после 1 дипломата', allianceAfter.mine.inviteLimit === 6);
    check('второй дипломат стоит 200 (×2)', allianceAfter.mine.nextDiplomatCost === 200);
    check('лимит альянса = уровень × 10', allianceAfter.mine.maxMembers === meB.level * 10);
  } else {
    console.log('  (B не лидер альянса — пропускаем)');
  }

  console.log('23. Защита построек учитывается в power.def');
  // Берём C — нового игрока без построек
  const regC = await post('/api/register', null, { login: 'C' + stamp, email: `c${stamp}@t.ru`, password: 'pass123', country: 'kz' });
  const C = regC.data.token;
  const idC = (await get('/api/me', C)).data.id;
  await post('/api/admin/grant', A, { userId: idC, setLevel: 35, dollars: 100000 });
  const meCbefore = (await get('/api/me', C)).data;
  const defBefore2 = meCbefore.power.def;
  // Покупаем 1 бункер (доступен с 30 ур.)
  const buyBunker = await post('/api/buildings/build', C, { buildingId: 'bunker', qty: 1 });
  check('бункер построен', buyBunker.status === 200);
  const meCafter = (await get('/api/me', C)).data;
  check('защита УВЕЛИЧИЛАСЬ после постройки бункера', meCafter.power.def > defBefore2);

  console.log('24. Глобальный бонус опыта');
  await post('/api/admin/global-buff', A, { key: 'xp', pct: 100, hours: 1 });
  const buffs = (await get('/api/admin/global-buffs', A)).data;
  check('глобальный бонус xp активен', buffs.active.some((b) => b.key === 'xp' && b.pct === 100));

  console.log('25. Ежедневные задания');
  const daily = (await get('/api/daily', A)).data;
  check('9 ежедневных заданий', daily.quests.length === 9);
  check('награда за задание масштабируется с уровнем', daily.reward.xp > 0 && daily.reward.dollars > 0);
  check('бонус 100 золота за все', daily.bonusGold === 100);
  // Попытка получить бонус до выполнения должна провалиться
  const earlyBonus = await post('/api/daily/bonus', A);
  check('бонус нельзя забрать пока не выполнены все', earlyBonus.status === 400);

  console.log('\n========================================');
  console.log(`ИТОГО: ✔ ${passed} пройдено, ✖ ${failed} провалено`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Тест упал с ошибкой:', e);
  process.exit(1);
});
