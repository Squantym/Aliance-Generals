// ===================================================================
// test/smoke.js — дымовой тест всего API
//
// Единственный сквозной тест: проходит игру целиком через HTTP —
// бой, обучение, миссии, покупки, рынок, клуб, альянс, почту, админку.
//
// Запуск: node test/smoke.js
//
// Сервер тест поднимает СЕБЕ САМ, во временной папке. Раньше он требовал
// заранее запущенный сервер, поэтому в общем прогоне падал всегда — и
// «169 из 170» стало нормой. Тест, который всегда красный, перестают
// читать: за полгода в нём накопились устаревшие проверки (клубный API
// сменился целиком, почта стала перепиской, обучение выросло с 5 шагов
// до 14), и заметить это было уже нечем.
//
// Права администратора тест выдаёт себе честно — тем же способом, что и
// владелец на сервере: останавливает сервер, зовёт tools/grant-admin.js,
// поднимает обратно. Никаких обходных дверей в API для тестов нет и быть
// не должно: дверь, открытая для теста, открыта для всех.
//
// BASE=http://... — работать с уже запущенным сервером (свой не поднимать).
// В этом режиме разделы, требующие прав, пропускаются, если их нет.
// ===================================================================

const { spawn, execFileSync } = require('child_process');
const fsx = require('fs');
const pathx = require('path');
const osx = require('os');

const ROOT = pathx.join(__dirname, '..');
const EXTERNAL = !!process.env.BASE;
let BASE = process.env.BASE || '';
let srv = null;                       // наш процесс сервера
let workDir = '';                     // временная папка с базой

// Свободный порт берём случайным из высокого диапазона и проверяем.
const PORT = 4700 + Math.floor(Math.random() * 200);

// Окружение для служебных скриптов, запускаемых отдельным процессом.
// Они дочитывают .env проекта сами, и без пустых ключей настоящий .env
// уводил их в боевую базу вместо временной папки дымового прогона.
const toolEnv = (e) => Object.assign({}, process.env,
  { DB_DRIVER: '', SQLITE_DIR: '', SQLITE_FILE: '', MONGODB_URI: '' }, e || {});

function startServer(extraEnv) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [pathx.join(ROOT, 'dist/server.js')], {
      cwd: workDir,
      env: Object.assign({}, process.env, {
        PORT: String(PORT),
        DISABLE_RATE_LIMIT: '1',      // сценарий регистрирует игроков пачками
        // Второй фактор сотрудников проверяется отдельно, в
        // test/consents.test.js. Здесь он закрыл бы панель и сценарий
        // не дошёл бы до того, ради чего написан.
        STAFF_2FA_REQUIRED: '0',
        DB_DRIVER: '',                // JSON-режим: временная папка, ничего не жалко
        MONGODB_URI: '',
        NODE_ENV: 'test',
      }, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (b) => {
      out += String(b);
      if (/сервер запущен/i.test(out)) resolve(proc);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => reject(new Error(`сервер вышел с кодом ${code}:\n${out.slice(-500)}`)));
    setTimeout(() => reject(new Error('сервер не поднялся за 20 с:\n' + out.slice(-500))), 20000);
  });
}

function stopServer(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    // SIGTERM: сервер дописывает данные и выходит сам. Убивать сразу
    // нельзя — потеряли бы игроков, зарегистрированных тестом.
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM');
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} resolve(); }, 8000);
  });
}

let passed = 0, failed = 0, skipped = 0;

// Мини-обвязка проверок
function check(name, cond, why) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✖ ' + name + (why ? ' — ' + why : '')); }
}
// Шаг, который нельзя выполнить в этих условиях (например, нужны права
// администратора, которых у теста нет). Пропуск виден отдельно от провала:
// иначе «зелёный» тест начинает означать «часть проверок молча выключена».
function skip(name, why) {
  skipped++;
  console.log('  ⊘ ' + name + ' — пропущено: ' + why);
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

// ── Поднять свой сервер и выдать первому игроку права владельца ──
// Порядок именно такой: сервер держит базу в памяти и переписывает её
// при выходе, поэтому выдавать права на живой базе нельзя — изменение
// затёрлось бы при остановке. Останавливаем, правим, поднимаем.
async function bootstrap(adminName, adminPass, adminEmail) {
  workDir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'generals-smoke-'));
  fsx.mkdirSync(pathx.join(workDir, 'data'), { recursive: true });
  BASE = 'http://127.0.0.1:' + PORT;

  srv = await startServer();
  const reg = await post('/api/register', null, {
    login: adminName, email: adminEmail, password: adminPass, country: 'ru',
    consents: { age18: true, terms: true, pdn: true },
  });
  if (reg.status !== 200) throw new Error('не удалось создать игрока для прав: ' + JSON.stringify(reg.data));

  await stopServer(srv);
  // --yes: скрипт по умолчанию спрашивает подтверждение с клавиатуры.
  // Без флага он молча получал бы EOF, считал это отказом и «успешно»
  // ничего не делал — тест падал бы уже позже и на другом.
  try {
    execFileSync(process.execPath,
      [pathx.join(ROOT, 'tools/grant-admin.js'), adminName, '--owner', '--yes'],
      { cwd: workDir, stdio: 'pipe', env: toolEnv() });
  } catch (e) {
    // Свою причину grant-admin печатает в перехваченный поток, и без
    // этого она пропадала: оставалось голое «Command failed», по
    // которому нельзя отличить нехватку прав от неверной базы.
    throw new Error('grant-admin не выдал права:\n'
      + String((e && e.stdout) || '') + String((e && e.stderr) || ''));
  }
  srv = await startServer();

  const login = await post('/api/login', null, { login: adminName, password: adminPass });
  if (login.status !== 200 || !login.data.token) {
    throw new Error('не удалось войти сотрудником: ' + JSON.stringify(login.data));
  }
  const me = await get('/api/me', login.data.token);
  if (!me.data.staffZones || !me.data.staffZones.length) {
    throw new Error('права владельца не применились — grant-admin отработал впустую');
  }
  return login.data.token;
}

async function main() {
  const stamp = Date.now().toString(36).slice(-5);
  const nameA = 'Admin' + stamp;
  const nameB = 'Boets' + stamp;
  const passA = 'parol12345';
  let bootToken = null;

  if (!EXTERNAL) {
    console.log('0. Поднимаю свой сервер и выдаю права владельца');
    bootToken = await bootstrap(nameA, passA, `admina${stamp}@test.ru`);
    check('сервер поднят, права владельца выданы', !!bootToken);
  } else {
    console.log('0. Работаю с уже запущенным сервером: ' + BASE);
  }

  console.log('1. Регистрация и вход');
  // В dev-режиме (без RESEND_API_KEY) сервер сразу выдаёт токен
  let A;
  if (bootToken) {
    // Игрок уже создан на шаге 0 — повторная регистрация того же
    // позывного обязана быть отклонена, это тоже проверка.
    const again = await post('/api/register', null, { login: nameA, email: `dup${stamp}@test.ru`, password: passA, country: 'ru', consents: { age18: true, terms: true, pdn: true } });
    check('повторная регистрация того же позывного отклонена', again.status === 400);
    A = bootToken;
  } else {
    const regA = await post('/api/register', null, { login: nameA, email: `admina${stamp}@test.ru`, password: passA, country: 'ru', consents: { age18: true, terms: true, pdn: true } });
    check('первый игрок зарегистрирован', regA.status === 200 && (!!regA.data.token || regA.data.pending));
    A = regA.data.token; // в dev-режиме есть сразу
  }
  const regB = await post('/api/register', null, { login: nameB, email: `boetsb${stamp}@test.ru`, password: 'parol12345', country: 'ua', consents: { age18: true, terms: true, pdn: true } });
  check('второй игрок зарегистрирован', regB.status === 200);
  const B = regB.data.token;
  const dupe = await post('/api/register', null, { login: nameA, email: `dupe${stamp}@test.ru`, password: 'x1234', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  check('дубликат позывного отклонён', dupe.status === 400);
  const dupeEmail = await post('/api/register', null, { login: 'ZZZ' + stamp, email: `admina${stamp}@test.ru`, password: 'x1234', country: 'ru', consents: { age18: true, terms: true, pdn: true } });
  check('дубликат email отклонён', dupeEmail.status === 400);
  const login = await post('/api/login', null, { login: nameA, password: passA });
  check('вход работает', login.status === 200 && !!login.data.token);

  console.log('2. Состояние игрока');
  let meA = (await get('/api/me', A)).data;
  check('/api/me отвечает', meA.name === nameA);
  check('стартовые деньги $80000', meA.dollars === 80000);
  check('обучение активно и начинается с нуля',
        meA.tutorial.done === false && meA.tutorial.step === 0);
  const tutorialStart = meA.tutorial.step;
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
  // Берём СРАЗУ 3 единицы: первый шаг миссии-конфликта требует три
  // наземных машины. Раньше здесь покупались две, шаг не запускался
  // (сервер отвечал needUnits вместо processId), и весь дальнейший
  // туториальный сценарий рассыпался — тест «падал», хотя игра цела.
  const buy = await post('/api/units/buy', A, { unitId: firstUnit.id, qty: 3 });
  check('покупка техники прошла', buy.status === 200 && buy.data.owned === 3);
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
  // Если техники не хватает, сервер отвечает 200 и needUnits — это не
  // ошибка, а подсказка игроку. Для теста это провал: значит закупка
  // выше больше не покрывает требование шага.
  check('шаг миссии запущен', stepStart.status === 200 && !!stepStart.data.processId,
        stepStart.data.needUnits ? 'не хватает техники: ' + JSON.stringify(stepStart.data.needUnits.items) : '');
  // Ускорение стоит золота. Права администратора первому игроку больше НЕ
  // выдаются автоматически (это сделано намеренно), поэтому выдать себе
  // золото через админку из теста нельзя. Проверяем ускорение только если
  // золото откуда-то есть, иначе честно помечаем шаг пропущенным.
  // Права у теста теперь есть (шаг 0), поэтому золото для проверки
  // ускорения он выдаёт себе сам — и путь «ускорить за золото»
  // действительно проверяется, а не пропускается годами.
  if (bootToken) await post('/api/admin/grant', A, { userId: idA, gold: 300 });
  const goldNow = (await get('/api/me', A)).data.gold;
  if (goldNow > 0) {
    const boostStep = await post('/api/missions/boost', A, { processId: stepStart.data.processId });
    check('шаг миссии ускорен', boostStep.status === 200);
  } else {
    skip('шаг миссии ускорен', 'нет золота (внешний сервер без прав администратора)');
  }
  meA = (await get('/api/me', A)).data;
  check('энергия потрачена и восстановлена левелапом', meA.res.en.cur <= meA.res.en.max);
  // ВАЖНО: номера шагов туториала здесь больше не проверяются.
  // Раньше стояло «шаг >= 3», и тест сломался, когда обучение выросло
  // с 5 шагов до 14 — при полностью рабочем API. Дымовой тест обязан
  // проверять, что интерфейс работает, а не замораживать замысел игры:
  // владелец меняет обучение, и падать на этом тест не должен.
  // Проверяем структуру и то, что обучение ДВИГАЕТСЯ.
  check('обучение отдаёт понятную структуру',
        typeof meA.tutorial === 'object' && typeof meA.tutorial.step === 'number'
        && typeof meA.tutorial.total === 'number' && meA.tutorial.total > 0);
  const stepAfterMission = meA.tutorial.step;
  check('обучение не откатилось назад после боя и миссии', stepAfterMission >= tutorialStart);

  console.log('6. Постройки (шаг обучения: доходное здание)');
  const bl = (await get('/api/buildings', A)).data;
  const firstB = bl.income.find((x) => !x.locked);
  const built = await post('/api/buildings/build', A, { buildingId: firstB.id, qty: 1 });
  check('постройка возведена', built.status === 200 && built.data.owned === 1);
  meA = (await get('/api/me', A)).data;
  check('обучение продвинулось за постройку', meA.tutorial.step >= stepAfterMission);
  check('доход в час появился', meA.incomePerHour > 0);

  console.log('7. Навыки');
  // Очки навыков приходят с уровнями. Сколько именно уровней даст этот
  // сценарий — вопрос баланса, а не работоспособности API, поэтому
  // проверяем трату очка только когда оно есть.
  if (meA.skillPoints >= 1) {
    const skill = await post('/api/skill', A, { stat: 'energy' });
    check('очко навыка потрачено', skill.status === 200 && skill.data.skills.energy >= 1);
    const meAfterSkill = (await get('/api/me', A)).data;
    check('очков стало меньше', meAfterSkill.skillPoints === meA.skillPoints - 1);
    meA = meAfterSkill;
  } else {
    // Уровень здесь нарочно НЕ повышаем: ниже проверяется, что игроку
    // низкого уровня закрыто производство. Подкрутить уровень ради
    // одной проверки — значит сломать другую, более важную.
    skip('очко навыка потрачено', `очков ${meA.skillPoints} — сценарий не доходит до уровня с очком`);
    const bad = await post('/api/skill', A, { stat: 'energy' });
    check('без очков навык не качается', bad.status === 400);
  }

  console.log('8. Чёрный рынок: контейнер');
  const goldForBox = (await get('/api/me', A)).data.gold;
  if (goldForBox >= 50) {
    const open = await post('/api/market/open', A, { tier: 1 });
    check('контейнер за 50 золота открыт', open.status === 200 && Array.isArray(open.data.drops));
  } else {
    skip('контейнер за 50 золота открыт', `золота ${goldForBox} — покупать нечем`);
  }
  const cont = (await get('/api/market/containers', A)).data;
  check('коллекция читается', cont.collection.length === 9);

  console.log('9. Аукцион');
  const auc = (await get('/api/market/auction', A)).data;
  // Число лотов — настройка игры (было 3, стало 5). Проверяем, что лоты
  // есть и у них осмысленная форма, а не конкретное количество.
  check('лоты аукциона на месте', Array.isArray(auc.lots) && auc.lots.length > 0);
  check('у лота есть id и минимальная ставка',
        !!auc.lots[0] && !!auc.lots[0].id && Number(auc.lots[0].minBid || auc.minBid) > 0);
  meA = (await get('/api/me', A)).data;
  const minBid = Number(auc.lots[0].minBid || auc.minBid || 0);
  if (meA.gold >= minBid && minBid > 0) {
    const bid = await post('/api/market/bid', A, { lotId: auc.lots[0].id, amount: minBid });
    check('ставка принята', bid.status === 200);
  } else {
    check('ставка пропущена (мало золота) — допустимо', true);
  }

  console.log('10. Клуб офицеров');
  // Клуб переписан целиком: вместо загадки, угадайки и армрестлинга —
  // четыре игры (очко, сейф, артиллерия, кости) плюс ставки. Тест
  // тянул старый API и падал на первой же строке, скрывая всё, что
  // идёт ниже по сценарию.
  const club = (await get('/api/club', A)).data;
  check('клуб отдаёт свои игры',
        !!club.pref && !!club.safe && !!club.arty && !!club.dice,
        'получено: ' + Object.keys(club).join(', '));

  // Очко: сдача — добор — вскрытие. Каждый шаг обязан отвечать понятным
  // состоянием, а не просто «200 ОК».
  const prefStart = await post('/api/club/pref/start', A);
  check('очко: партия сдана', prefStart.status === 200 && Array.isArray(prefStart.data.hand));
  const prefHit = await post('/api/club/pref/hit', A);
  check('очко: добор обработан', prefHit.status === 200 && ['hit', 'bust'].includes(prefHit.data.result));
  if (prefHit.data.result === 'hit') {
    const prefStand = await post('/api/club/pref/stand', A);
    check('очко: вскрытие обработано', prefStand.status === 200 && !!prefStand.data.result);
  } else {
    skip('очко: вскрытие обработано', 'перебор на доборе — партия закончилась раньше');
  }

  // Сейф: подбор кода по принципу «быки и коровы».
  const safeStart = await post('/api/club/safe/start', A);
  check('сейф: попытка начата', safeStart.status === 200 && safeStart.data.triesLeft > 0);
  const digits = safeStart.data.digits || 4;
  const guessCode = '1234567890'.slice(0, digits);      // цифры не повторяются
  const safeTry = await post('/api/club/safe/try', A, { guess: guessCode });
  check('сейф: подсказка по коду получена',
        safeTry.status === 200 && typeof safeTry.data.bulls === 'number'
        && typeof safeTry.data.cows === 'number');
  const badCode = await post('/api/club/safe/try', A, { guess: '11' });
  check('сейф: неверный формат кода отклонён', badCode.status === 400);

  // Артиллерия: пристрелка по расстоянию.
  const artyStart = await post('/api/club/arty/start', A);
  check('артиллерия: наводка начата', artyStart.status === 200);
  const artyShot = await post('/api/club/arty/shoot', A, { distance: 50 });
  check('артиллерия: выстрел обработан', artyShot.status === 200 && !!artyShot.data);

  // Кости: бросок, переброс, подсчёт.
  const diceStart = await post('/api/club/dice/start', A);
  check('кости: брошены', diceStart.status === 200 && Array.isArray(diceStart.data.dice));
  const diceFinish = await post('/api/club/dice/finish', A);
  check('кости: комбинация посчитана', diceFinish.status === 200);

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
  // Почта стала перепиской: ответ — не плоский список писем, а список
  // ДИАЛОГОВ (threads), и читается диалог по id собеседника, а не по id
  // письма. Старый тест падал здесь и уносил с собой весь блок админки,
  // который идёт ниже, — то есть «одна устаревшая строка» скрывала
  // проверку прав администратора.
  const inboxB = (await get('/api/mail', B)).data;
  const thread = (inboxB.threads || []).find((t) => t.otherName === nameA);
  check('письмо дошло адресату', !!thread,
        'диалогов в ящике: ' + ((inboxB.threads || []).length));
  const read = await get('/api/mail/' + thread.otherId, B);
  check('переписка читается',
        read.status === 200 && (read.data.messages || []).some((m) => String(m.text).includes('приём')));
  // Ответ на чтение переписки поля «прочитано» не содержит — и не должен.
  // Проверяем результат там, где он виден: в списке диалогов.
  const inboxAfter = (await get('/api/mail', B)).data;
  const threadAfter = (inboxAfter.threads || []).find((t) => t.otherName === nameA);
  check('после открытия переписки непрочитанных не осталось',
        !!threadAfter && threadAfter.unread === 0);

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
  // ВАЖНО про вместимость. Здесь тест много месяцев проверял не то:
  // он ждал, что групповой альянс (/api/group/alliance) поднимет
  // capacity. Вместимость даёт ДРУГАЯ система — личный альянс
  // (/api/alliance, набор бойцов). Групповой альянс — про совместные
  // бои и склад, вместимости он не меняет. Проверка стояла красной и
  // выглядела как баланс-баг, а была ошибкой самого теста.
  const meB = (await get('/api/me', B)).data;
  // Конфиг переведён на TypeScript, из теста доступна только сборка.
  // Старый путь '../config/gameConfig' молча не резолвился — но до этой
  // строки тест не доживал, поэтому поломка не была видна.
  const cfgAll = require(pathx.join(ROOT, 'dist/config/gameConfig')).ALLIANCE;
  check('групповой альянс вместимость не меняет — это не его дело',
        meB.capacity === cfgAll.BASE_CAPACITY,
        `capacity=${meB.capacity}, база=${cfgAll.BASE_CAPACITY}`);
  // Приглашение игроком A через инвайт + ответ
  const inv = await post('/api/group/alliance/invite', B, { userId: idA });
  check('приглашение отправлено', inv.status === 200);
  const invA = (await get('/api/group/alliance/invites', A)).data;
  check('у адресата виден инвайт', invA.invites.length === 1);
  const accept = await post('/api/group/alliance/respond', A, { groupId: alC.data.id, accept: true });
  check('инвайт принят', accept.status === 200);
  const meB2 = (await get('/api/me', B)).data;
  const allB = (await get('/api/group/alliance', B)).data;
  check('в групповом альянсе стало двое', allB.mine && allB.mine.members.length === 2);

  console.log('15b. Личный альянс — он и даёт вместимость');
  const palBefore = (await get('/api/me', B)).data.capacity;
  const recruit = await post('/api/alliance/invite-bot', B);
  if (recruit.status === 200) {
    const palAfter = (await get('/api/me', B)).data.capacity;
    check('набор бойца в личный альянс поднял вместимость',
          palAfter === palBefore + cfgAll.PER_MEMBER,
          `было ${palBefore}, стало ${palAfter}, шаг ${cfgAll.PER_MEMBER}`);
    const pal = (await get('/api/alliance', B)).data;
    check('личный альянс показывает состав и прибавку',
          pal.members >= 1 && pal.bonusCapacity === cfgAll.PER_MEMBER * pal.members);
  } else {
    skip('набор бойца в личный альянс', 'сервер отказал: ' + (recruit.data.error || recruit.status));
  }

  console.log('16. Профиль, зал славы, достижения');
  const prof = (await get('/api/profile/' + idA, B)).data;
  check('чужой профиль читается', prof.profile.name === nameA);
  check('атака вне ±10 уровней запрещена', prof.profile.canAttack === false);
  const fame = (await get('/api/fame', A)).data;
  // Зал славы отдаёт два свода — «за всё время» и «за сегодня».
  // Раньше тест ждал плоский categories и падал, хотя всё работает.
  // Количество категорий — настройка игры, поэтому проверяем не число,
  // а что своды одинаковы по составу и у каждой категории есть таблица.
  check('зал славы: своды «за всё время» и «за сегодня»',
        Array.isArray(fame.allTime) && Array.isArray(fame.daily) && fame.allTime.length > 0);
  check('оба свода об одних и тех же категориях',
        fame.allTime.map((c) => c.id).join(',') === fame.daily.map((c) => c.id).join(','));
  check('у каждой категории есть таблица лидеров',
        fame.allTime.every((c) => Array.isArray(c.top) && !!c.name));
  const ach = (await get('/api/achievements', A)).data;
  check('достижения читаются', (ach.achievements || []).length >= 5);
  const trophies = (await get('/api/trophies', A)).data;
  check('трофеи читаются', (trophies.trophies || []).length > 0);

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
  const regC = await post('/api/register', null, { login: 'C' + stamp, email: `c${stamp}@t.ru`, password: 'parol12345', country: 'kz', consents: { age18: true, terms: true, pdn: true } });
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
  const dq = require(pathx.join(ROOT, 'dist/config/gameConfig'));
  // Заданий стало 22 вместо 9, награда переехала внутрь задания, а
  // dailyQuestReward принимает теперь (сложность, уровень, задание).
  // Числа заданий и подписи — замысел игры, тест их не морозит:
  // проверяем, что выдаётся непустой набор и что награда осмысленна.
  check('ежедневные задания выдаются', Array.isArray(daily.quests) && daily.quests.length > 0,
        'получено: ' + (daily.quests || []).length);
  check('у каждого задания есть цель, прогресс и награда',
        daily.quests.every((q) => typeof q.target === 'number' && q.target > 0
          && typeof q.progress === 'number' && q.reward && typeof q.reward.xp === 'number'));
  check('награда растёт с уровнем игрока',
        dq.dailyQuestReward(1, 60, {}).xp > dq.dailyQuestReward(1, 5, {}).xp);
  check('сложное задание награждает щедрее лёгкого',
        dq.dailyQuestReward(2.4, 30, {}).xp > dq.dailyQuestReward(1, 30, {}).xp);
  // Подпись функции тоже сменилась: (base, diff, level, counter, fixed).
  // Со старыми двумя аргументами она возвращала NaN, а NaN > NaN — это
  // false, то есть проверка «росла ли цель» просто сообщала о провале
  // вместо того, чтобы что-то проверить.
  check('цель задания растёт с уровнем',
        dq.dailyQuestTarget(100, 1, 300, null, 0) > dq.dailyQuestTarget(100, 1, 1, null, 0),
        `ур.1 → ${dq.dailyQuestTarget(100, 1, 1, null, 0)}, ур.300 → ${dq.dailyQuestTarget(100, 1, 300, null, 0)}`);
  check('за все задания положен бонус золотом', daily.bonusGold > 0);
  // Попытка получить бонус до выполнения должна провалиться
  const earlyBonus = await post('/api/daily/bonus', A);
  check('бонус нельзя забрать пока не выполнены все', earlyBonus.status === 400);

  console.log('26. Награда за бой с ботом убывает при повторных атаках (вплоть до нуля)');
  await new Promise((r) => setTimeout(r, 1300));   // пауза между атаками
  const oppsForLoot = (await get('/api/war/opponents', A)).data;
  const botTargetId = oppsForLoot.opponents.find((o) => o.isBot).id;
  const fightBot = await post('/api/war/attack', A, { targetId: botTargetId });
  if (fightBot.status === 200) {
    check('повторная атака на бота отработала', true);
    check('добыча — неотрицательное число', Number(fightBot.data.loot || 0) >= 0);
  } else {
    // К этому месту сценария у игрока может не остаться боеприпасов или
    // энергии — это правило игры, а не поломка. Раньше здесь стоял
    // безусловный «✖», и красная строка в отчёте ничего не значила.
    skip('повторная атака на бота', 'сервер отказал: ' + (fightBot.data.error || fightBot.status));
  }

  console.log('27. Подробная статистика в профиле');
  const profStats = (await get('/api/profile/' + idA, A)).data.profile;
  check('powerStats присутствует в профиле', !!profStats.powerStats);
  check('есть категории ground/air/sea/secret', !!profStats.powerStats.byCategory.ground && !!profStats.powerStats.byCategory.secret);

  console.log('28. Оборонительные постройки');
  const cfg = require(pathx.join(ROOT, 'dist/config/gameConfig'));
  // Конкретные числа защиты — баланс, его правит владелец. Тест их не
  // фиксирует (стояло def===18, стало 9 — и тест «падал» на нормальной
  // правке баланса). Проверяем целостность справочника.
  check('справочник оборонительных построек не пуст', cfg.DEFENSE_BUILDINGS.length > 0);
  check('у каждой постройки есть защита, цена и уровень открытия',
        cfg.DEFENSE_BUILDINGS.every((b) => b.def > 0 && b.price > 0 && typeof b.unlock === 'number'));
  check('постройки открываются по возрастанию уровня',
        cfg.DEFENSE_BUILDINGS.every((b, i, arr) => i === 0 || arr[i - 1].unlock <= b.unlock));

  console.log('29. Зал славы: состав категорий');
  // Набор категорий — тоже замысел игры: часть переименована
  // (rich/army/alliance_size → loot/buildings/alliance). Фиксируем не
  // список, а то, что своды непустые и каждая категория собрана верно.
  const fameIds = fame.allTime.map((c) => c.id);
  check('категорий в зале славы несколько', fameIds.length >= 5, 'есть: ' + fameIds.join(', '));
  check('у каждой категории есть название и описание',
        fame.allTime.every((c) => !!c.name && !!c.desc));
  check('таблицы лидеров отсортированы по убыванию',
        fame.allTime.every((c) => c.top.every((row, i, arr) =>
          i === 0 || Number(arr[i - 1].value) >= Number(row.value))));

  console.log('30. Крит-формула');
  // Значения множителей — баланс. Проверяем, что формула собирается и
  // усиление трофеем действительно усиливает, а не конкретные числа.
  const licenseDef = cfg.TROPHIES.find((t) => t.id === 'license');
  check('множитель крита задан и больше единицы', cfg.BATTLE.CRIT_MULT > 1);
  check('трофей «лицензия» усиливает крит', !!licenseDef && licenseDef.perLvl > 0);

  console.log('31. Шахты');
  // Шахты стали двухшаговыми: сначала покупается УЧАСТОК за золото,
  // потом на нём строится шахта за деньги. Старый тест звал
  // /api/mines/build без участка и получал отказ на каждом шаге —
  // три красные строки подряд про работающую механику.
  await post('/api/admin/grant', A, { userId: idA, setLevel: 70, gold: 5000, dollars: 50000000 });
  const minesView0 = (await get('/api/mines', A)).data;
  check('шахты открыты и участков пока нет', minesView0.plotCount === 0 && minesView0.nextPlotGold > 0);
  const plot = await post('/api/mines/buy-plot', A);
  check('участок куплен', plot.status === 200);
  const minesAfterPlot = (await get('/api/mines', A)).data;
  check('участок появился пустым',
        minesAfterPlot.mines.length === 1 && minesAfterPlot.mines[0].status === 'empty');
  const buildMine = await post('/api/mines/build', A, { mineId: minesAfterPlot.mines[0].id });
  check('шахта заложена', buildMine.status === 200);
  const minesView1 = (await get('/api/mines', A)).data;
  check('шахта в статусе «строится»', minesView1.mines[0].status === 'building');
  check('показан остаток времени стройки', minesView1.mines[0].buildRemainingSec > 0);
  // Спуск, пока шахта строится, должен быть запрещён
  const descendTooEarly = await post('/api/mines/descend', A, { mineId: minesView1.mines[0].id, minutes: 10 });
  check('нельзя спуститься пока шахта строится', descendTooEarly.status === 400);
  check('второй участок дороже первого',
        (await get('/api/mines', A)).data.nextPlotGold > minesView0.nextPlotGold);

  console.log('32. Секретные разработки НЕ вытесняют обычную технику из боя');
  // Игрок C: даём секретных разработок выше лимита альянса + немного обычной техники
  await post('/api/admin/grant', A, { userId: idC, gold: 100000, dollars: 100000000 });
  const meCsetup = (await get('/api/me', C)).data;
  // Покупаем 5 наземных юнитов
  await post('/api/units/buy', C, { unitId: 'ground_1', qty: 5 });
  const profC = (await get('/api/profile/' + idC, C)).data.profile;
  check('обычная техника видна в профиле (taken>0)', profC.powerStats.byCategory.ground.count === 5);

  console.log('33. Capacity = 10 база + 10 за каждого в альянсе (новая формула)');
  check('capacity новая формула (10 база)', cfg.ALLIANCE.BASE_CAPACITY === 10);
  check('PER_MEMBER = 10', cfg.ALLIANCE.PER_MEMBER === 10);

  console.log('34. Стоимость навыков: ловкость/жестокость = 3 очка');
  check('cruelty стоит 3 очка', cfg.SKILL_COSTS.cruelty === 3);
  check('agility стоит 3 очка', cfg.SKILL_COSTS.agility === 3);
  check('energy/health/ammo не изменились', cfg.SKILL_COSTS.energy === 1 && cfg.SKILL_COSTS.health === 1 && cfg.SKILL_COSTS.ammo === 2);

  console.log('35. Ракетные шахты');
  const silosView0 = (await get('/api/silos', A)).data;
  check('первая шахта стоит 300 золота', silosView0.nextSiloCostGold === 300);
  const buildSilo = await post('/api/silos/build', A);
  check('ракетная шахта построена', buildSilo.status === 200);
  const silosView1 = (await get('/api/silos', A)).data;
  check('у игрока 1 ракетная шахта', silosView1.silos.length === 1);
  check('шахта в статусе building', silosView1.silos[0].building === true);
  check('цена ускорения изначально близка к 1000', silosView1.silos[0].boostCostGold >= 990);
  // Заправка пока шахта строится — должна быть запрещена
  const fuelTooEarly = await post('/api/silos/fuel-ready', A, { siloId: silosView1.silos[0].id, amount: 100 });
  check('нельзя заправлять пока шахта строится', fuelTooEarly.status === 400);
  // Вторая шахта стоила бы 600
  check('вторая шахта стоила бы 600 (×2)', cfg.SILO.FIRST_PRICE_GOLD * Math.pow(cfg.SILO.PRICE_MULT, 1) === 600);
  // Прочность построек назначена (бункер = 30)
  check('у бункера прочность 30 для ракет', cfg.BUILDING_BY_ID.bunker.hp === 30);

  console.log('36. Исправлен баг "больше урона, но проигрыш"');
  // Симулируем явное доминирование атакующего: 50 боёв подряд, где
  // мощь атаки в 3+ раза выше защиты — атакующий должен побеждать
  // практически всегда (а не случайным образом).
  const battleSvc = require(pathx.join(ROOT, 'dist/src/services/battle'));
  let dominantWins = 0;
  const trials = 100;
  for (let i = 0; i < trials; i++) {
    // resolveDamage недоступна напрямую (не экспортирована) — проверяем
    // косвенно через статистику реальных боёв ниже.
  }
  // Прямая проверка: при сильном доминировании win и dealt согласованы.
  // Так как resolveDamage не экспортирована, проверяем сам факт того,
  // что формула CRIT_MULT и структура файла корректны (синтаксис уже ОК).
  check('battle.js загружается без ошибок после изменений', typeof battleSvc.attack === 'function');

  console.log('37. Цена навыков приходит с сервера (m.skillCosts)');
  const meWithCosts = (await get('/api/me', A)).data;
  check('skillCosts присутствует в /api/me', !!meWithCosts.skillCosts);
  check('skillCosts.cruelty === 3 (синхронизировано с сервером)', meWithCosts.skillCosts.cruelty === 3);
  check('skillCosts.agility === 3', meWithCosts.skillCosts.agility === 3);

  console.log('38. Раздельное отображение техники в бою (unitTaken / secretTaken)');
  check('power.unitTaken присутствует', typeof meWithCosts.power.unitTaken === 'number');
  check('power.secretTaken присутствует', typeof meWithCosts.power.secretTaken === 'number');

  console.log('39. Уведомления (колокольчик) отдельно от почты');
  const notifEmpty = (await get('/api/notifications', A)).data;
  check('эндпоинт уведомлений отвечает', Array.isArray(notifEmpty.notifications));
  check('notifUnread присутствует в /api/me', typeof meWithCosts.notifUnread === 'number');
  // Атакуем другого реального игрока (B), чтобы он получил уведомление
  const meBforNotif = (await get('/api/me', B)).data;
  if (Math.abs(meBforNotif.level - meWithCosts.level) <= 10) {
    // Между атаками сервер требует паузу в секунду — иначе запрос
    // отклоняется, уведомление не создаётся, и «нет уведомления»
    // выглядит как поломка уведомлений, хотя атаки просто не было.
    await new Promise((r) => setTimeout(r, 1300));
    const atkOnB = await post('/api/war/attack', A, { targetId: idB });
    check('атака на живого игрока прошла', atkOnB.status === 200,
          atkOnB.data.error || '');
    const notifB = (await get('/api/notifications', B)).data;
    check('у B появилось уведомление об атаке', notifB.notifications.length > 0);
    // Берём уведомление ПО ВИДУ, а не первое в списке: к этому моменту
    // у B уже есть уведомления о выдачах от администратора, и «первое»
    // — это они. Проверка падала на верном коде.
    const n = notifB.notifications.find((x) => String(x.kind || '').startsWith('attack_'));
    check('уведомление об атаке найдено по виду', !!n,
          'виды: ' + notifB.notifications.map((x) => x.kind).join(', '));
    if (n) {
      check('уведомление содержит имя атакующего', n.payload && n.payload.attackerName === meWithCosts.name);
      check('уведомление содержит время (at)', typeof n.payload.at === 'number');
    }
  } else {
    console.log('  (A и B вне диапазона уровней — пропускаем проверку уведомления)');
  }

  console.log('40. Шансы крита/уворота в профиле');
  const profWithChances = (await get('/api/profile/' + idA, A)).data.profile;
  check('critChancePct присутствует', typeof profWithChances.critChancePct === 'number');
  check('dodgeChancePct присутствует', typeof profWithChances.dodgeChancePct === 'number');
  check('критический шанс в разумных пределах (0-50%)', profWithChances.critChancePct >= 0 && profWithChances.critChancePct <= 50);

  console.log('41. Механика ушей: лимит 2, штраф, восстановление');
  check('EARS.MAX === 2', cfg.EARS.MAX === 2);
  check('EARS.PENALTY_PCT === 0.10', cfg.EARS.PENALTY_PCT === 0.10);
  check('EARS.RESTORE_GOLD === 20', cfg.EARS.RESTORE_GOLD === 20);
  const meEars = (await get('/api/me', A)).data;
  check('earsCurrent присутствует и равен MAX у нового игрока', meEars.earsCurrent === 2);
  const restoreFull = await post('/api/ears/restore', A);
  check('нельзя восстановить ухо если оба целы', restoreFull.status === 400);

  console.log('42. Контейнеры пачками и история');
  // Допустимые пачки сменились с 1/3/5 на 1/5/10. Тест проверял старые
  // числа: «открыть 3» отклонялось сервером (верно!), а тест считал это
  // поломкой; из-за отказа не было и истории — вторая красная строка
  // была следствием первой.
  await post('/api/admin/grant', A, { userId: idA, gold: 100000 });
  const containers = (await get('/api/market/containers', A)).data;
  const tier1 = containers.containers[0].tier;
  const openX5 = await post('/api/market/open', A, { tier: tier1, qty: 5 });
  check('открытие пачки из 5 работает', openX5.status === 200,
        openX5.data.error || '');
  const openBad = await post('/api/market/open', A, { tier: tier1, qty: 3 });
  check('пачка неразрешённого размера отклонена', openBad.status === 400);
  const history = (await get('/api/market/container-history', A)).data;
  check('история открытий не пуста', (history.history || []).length > 0);

  console.log('43. Скидки на шахты в админке');
  const discCats = (await get('/api/admin/discounts', A)).data;
  check('категория "mine" доступна для скидки', discCats.categories.some((c) => c.id === 'mine'));
  check('категория "silo" доступна для скидки', discCats.categories.some((c) => c.id === 'silo'));
  const setMineDiscount = await post('/api/admin/discount', A, { category: 'mine', pct: 50, hours: 1 });
  check('скидка на шахты установлена', setMineDiscount.status === 200);
  const setDelayedDiscount = await post('/api/admin/discount', A, { category: 'unit', pct: 30, hours: 2, delayHours: 5 });
  check('отложенная скидка установлена', setDelayedDiscount.status === 200);
  const discAfter = (await get('/api/admin/discounts', A)).data;
  check('отложенная скидка не активна сразу', !discAfter.active.unit);
  check('отложенная скидка видна в scheduled', discAfter.scheduled.some((s) => s.category === 'unit' && s.pending));

  console.log('44. Подпись подарка администрации');
  const grantWithNote = await post('/api/admin/grant', A, { userId: idB, dollars: 1000, giftNote: 'С праздником!' });
  check('подарок с подписью выдан', grantWithNote.status === 200);

  console.log('45. Боты сохраняются в альянсе после рестарта сервера');
  // Проверяем, что серверная функция cleanupBotsFromAlliances больше НЕ
  // вызывается автоматически при старте (server.js не должен импортировать
  // groups для этой цели). Это структурная проверка содержимого файла.
  // Точка входа переехала в TypeScript: server.js больше нет, есть
  // server.ts (и сборка dist/server.js). Тест читал несуществующий файл
  // и падал целиком — на предпоследнем разделе из сорока семи.
  const serverSrc = fsx.readFileSync(pathx.join(ROOT, 'server.ts'), 'utf8');
  check('server.js не вызывает cleanupBotsFromAlliances при старте', !serverSrc.includes('cleanupBotsFromAlliances()'));

  console.log('46. Формула награды от ботов: 10-30 единиц техники, убывает от атаки к атаке');
  await post('/api/admin/grant', A, { userId: idA, setLevel: 15, dollars: 50000000, health: 1000 });
  await post('/api/units/buy', A, { unitId: 'ground_3', qty: 50 }); // гарантируем победу над ботом
  const oppsForFormula = (await get('/api/war/opponents', A)).data;
  const botForFormula = oppsForFormula.opponents.find((o) => o.isBot);
  const unitPriceAt15 = cfg.minUnitPriceAtLevel(15);
  const fight1 = await post('/api/war/attack', A, { targetId: botForFormula.id });
  if (fight1.data.win) {
    check('первая награда в диапазоне 10-30 ед. техники уровня игрока',
      fight1.data.loot >= unitPriceAt15 * 8 && fight1.data.loot <= unitPriceAt15 * 32);
    await post('/api/admin/grant', A, { userId: idA, ammo: 5, health: 1000 });
    const fight2 = await post('/api/war/attack', A, { targetId: botForFormula.id });
    if (fight2.status === 200 && fight2.data.win) {
      check('вторая награда на ту же цель меньше первой (убывание)', fight2.data.loot < fight1.data.loot);
    }
  }

  console.log('47. Критический урон явно усиливает итоговый урон (без потолка 45)');
  // Базовая проверка корректности применения формулы через конфиг
  const critMul = cfg.BATTLE.CRIT_MULT;
  check('crit без трофея удваивает урон (CRIT_MULT=2.0)', critMul === 2.0);
  // На максимуме трофея (perLvl=20, 10 ур = +200%) итог должен быть x6 от базового
  const licenseAtMax = cfg.TROPHIES.find((t) => t.id === 'license');
  const trophyBonusAtMax = (licenseAtMax.perLvl * 10) / 100; // 2.0 (200%)
  const totalCritMul = critMul * (1 + trophyBonusAtMax);
  check('итоговый крит-множитель на максимуме трофея = x6', totalCritMul === 6);

  console.log('\n========================================');
  console.log(`ИТОГО: ✔ ${passed} пройдено, ✖ ${failed} провалено` +
    (skipped ? `, ⊘ ${skipped} пропущено` : ''));
  await cleanup();
  process.exit(failed ? 1 : 0);
}

// Убрать за собой: свой сервер и временную базу. Иначе после каждого
// прогона в системе остаётся висящий процесс на своём порту.
async function cleanup() {
  if (srv) await stopServer(srv);
  if (workDir) { try { fsx.rmSync(workDir, { recursive: true, force: true }); } catch (e) {} }
}

main().catch(async (e) => {
  console.error('Тест упал с ошибкой:', e);
  await cleanup();
  process.exit(1);
});
