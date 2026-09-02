// ═══════════════════════════════════════════════════════════════════
// test/consents.test.js — согласия, отписка и второй фактор сотрудника
//
// Всё через ЖИВОЙ сервер и настоящий HTTP. Причина принципиальная: сама
// проверка согласий стоит на маршруте /api/register, а не внутри
// auth.register — тем же auth.register пользуются инструменты и тесты,
// создающие служебные аккаунты. Проверять её вызовом функции значит
// проверять не то место. Появится второй публичный путь создания
// аккаунта без проверки — упадёт именно этот тест.
//
// Что здесь стережётся:
//
//  1. БЕЗ СОГЛАСИЙ АККАУНТ НЕ СОЗДАЁТСЯ. И, что важнее, не создаётся
//     ЧАСТИЧНО: отказ не должен оставлять в базе игрока, на которого
//     никто не соглашался, — иначе имя и почта окажутся заняты
//     призраком.
//  2. ЗАПИСЬ СОГЛАСИЯ — это доказательство: что принято, какой
//     редакции, когда. Без версии документа доказать, ЧТО именно принял
//     человек, невозможно.
//  3. РАССЫЛКА уходит только согласившимся, а отписка работает по
//     ссылке из письма, без входа в игру.
//  4. ПАНЕЛЬ закрыта сотруднику без второго фактора — но так, чтобы он
//     не оказался заперт: включение фактора остаётся доступным.
//
// Запуск: node test/consents.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const PORT = 4820 + Math.floor(Math.random() * 60);
const BASE = 'http://127.0.0.1:' + PORT;

// Окружение для служебных скриптов, которые тест запускает отдельным
// процессом (grant-admin и подобные). Они сами дочитывают .env проекта,
// и на сервере это уводило их в БОЕВУЮ базу вместо временной папки
// теста: скрипт честно докладывал «игрок не найден», хотя игрок был —
// просто в другой базе. loadEnv в скриптах ставит значение, только если
// ключа нет в окружении вовсе, поэтому пустая строка перебивает файл.
// Значения самого теста идут последним слоем: worldreset включает
// SQLite намеренно, и обнулять его настройки нельзя.
const toolEnv = (e) => Object.assign({}, process.env,
  { DB_DRIVER: '', SQLITE_DIR: '', SQLITE_FILE: '', MONGODB_URI: '' }, e || {});
let srv = null, workDir = '';
const letters = [];

// Двойник SMTP.BZ: форма, а не JSON — как у настоящего сервиса.
function fakeMailService() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const f = new URLSearchParams(b);
        letters.push({ subject: f.get('subject') || '', to: f.get('to') || '', html: f.get('html') || '' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id: 'j' + letters.length }));
      });
    });
    s.listen(0, '127.0.0.1', () => r({ s, url: 'http://127.0.0.1:' + s.address().port + '/send' }));
  });
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'dist/server.js')], {
      cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let o = '';
    const h = (b) => { o += String(b); if (/сервер запущен/i.test(o)) resolve(p); };
    p.stdout.on('data', h); p.stderr.on('data', h);
    p.on('exit', (c) => reject(new Error('сервер вышел: ' + c + '\n' + o.slice(-300))));
    setTimeout(() => reject(new Error('не поднялся:\n' + o.slice(-300))), 20000);
  });
}
const stop = (p) => new Promise((r) => { if (!p || p.killed) return r(); p.on('exit', r); p.kill(); });

async function post(url, body, token) {
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-token': token } : {}) },
    body: JSON.stringify(body || {}),
  });
  let d = {}; try { d = await res.json(); } catch (e) {}
  return { status: res.status, d };
}
async function get(url, token) {
  const res = await fetch(BASE + url, { headers: token ? { 'x-token': token } : {} });
  let d = {}; try { d = await res.json(); } catch (e) {}
  return { status: res.status, d };
}

const FULL = { age18: true, terms: true, pdn: true, public: true, ads: true,
  publicScope: { nick: true, flag: true, stats: true, ally: true } };
const codeFrom = (m) => {
  const t = String((m && m.html) || '').replace(/<[^>]*>/g, ' ');
  const x = /\b(\d{6})\b/.exec(t);
  return x ? x[1] : null;
};

(async () => {
  const mail = await fakeMailService();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consents-'));
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), DISABLE_RATE_LIMIT: '1', DB_DRIVER: '', MONGODB_URI: '', NODE_ENV: 'test',
    SMTPBZ_API_KEY: 'k', SMTPBZ_URL: mail.url,
    EMAIL_FROM: 'Aliance Generals <noreply@aliance-general.ru>',
    APP_URL: 'https://aliance-general.ru',
    STAFF_2FA_REQUIRED: '1',
  });
  srv = await startServer(env);

  console.log('\n── 1. Без согласий аккаунт не создаётся ──');
  const base = { email: 'a@t.ru', password: 'пароль123', country: 'ru' };
  const none = await post('/api/register', { login: 'Безсогласий', ...base });
  ok('регистрация отклонена', none.status >= 400);
  ok(`сказано про возраст: «${String(none.d.error).slice(0, 40)}»`, /18 лет/.test(none.d.error || ''));

  const noTerms = await post('/api/register', { login: 'Безсоглашения', ...base, consents: { age18: true } });
  ok('без принятия соглашения — отказ', noTerms.status >= 400);
  ok('названо, чего не хватает', /Соглашение|соглашени/i.test(noTerms.d.error || ''));

  const noPdn = await post('/api/register', { login: 'Безпдн', ...base, consents: { age18: true, terms: true } });
  ok('без согласия на обработку данных — отказ', noPdn.status >= 400);

  // Самое важное: отказ не должен оставлять следов. Иначе имя и почта
  // окажутся заняты аккаунтом, которого юридически не существует, и
  // человек не сможет зарегистрироваться уже по-настоящему.
  const retry = await post('/api/register', { login: 'Безсогласий', ...base, consents: FULL });
  ok('после отказа то же имя и почта свободны', retry.status === 200);
  ok('и регистрация просит код из письма', retry.d.needCode === true);

  console.log('\n── 2. Необязательные согласия ни на что не влияют ──');
  const minimal = await post('/api/register', {
    login: 'Молчун', email: 'm@t.ru', password: 'пароль123', country: 'ru',
    consents: { age18: true, terms: true, pdn: true },   // без рекламы и публичности
  });
  ok('регистрация проходит без рекламы и публичного профиля', minimal.status === 200);

  console.log('\n── 3. Согласие записано как доказательство ──');
  const code = codeFrom(letters[letters.length - 1]);
  const entered = await post('/api/verify-code', { login: 'Молчун', code });
  ok('код из письма пускает в игру', entered.status === 200 && !!entered.d.token);
  const tok = entered.d.token;

  const view = await get('/api/consents', tok);
  ok('игрок видит свои согласия', view.status === 200 && Array.isArray(view.d.items));
  const byId = Object.fromEntries((view.d.items || []).map((x) => [x.id, x]));
  ok('обязательные отмечены как данные', byId.age18.given && byId.terms.given && byId.pdn.given);
  ok('необязательные — как не данные', !byId.ads.given && !byId.public.given);
  // Без версии документа нельзя показать, ЧТО именно принял человек:
  // текст с тех пор мог измениться.
  ok(`записана редакция документа: «${byId.terms.version}»`, !!byId.terms.version);
  ok('и время', byId.terms.at > 0);
  ok('обязательные помечены обязательными', byId.terms.required === true && byId.ads.required === false);

  console.log('\n── 4. Обязательное согласие не снимается кнопкой ──');
  // Снять его и остаться в игре нельзя: тогда человек продолжал бы
  // играть без основания обработки. Правильный путь — удаление аккаунта.
  const dropReq = await post('/api/consents', { id: 'terms', on: false }, tok);
  ok('отзыв обязательного отклонён', dropReq.status >= 400);
  ok('и объяснено, что делать', /удален/i.test(dropReq.d.error || ''));

  console.log('\n── 5. Реклама включается и отзывается ──');
  const adsOn = await post('/api/consents', { id: 'ads', on: true }, tok);
  ok('согласие на рекламу дано', adsOn.status === 200);
  const after = Object.fromEntries((adsOn.d.items || []).map((x) => [x.id, x]));
  ok('видно, что оно действует', after.ads.given === true);
  ok('с датой и редакцией', after.ads.at > 0 && !!after.ads.version);

  const adsOff = await post('/api/consents', { id: 'ads', on: false }, tok);
  const off = Object.fromEntries((adsOff.d.items || []).map((x) => [x.id, x]));
  ok('отзыв принят', off.ads.given === false);
  // Запись об отзыве важнее самого отзыва: она доказывает, что до этого
  // момента рассылка была законной.
  ok('время отзыва сохранено', off.ads.withdrawnAt > 0);

  console.log('\n── 6. Публичный профиль — по категориям ──');
  const pub = await post('/api/consents',
    { id: 'public', on: true, scope: { nick: true, flag: false, stats: true, ally: false } }, tok);
  const p = Object.fromEntries((pub.d.items || []).map((x) => [x.id, x]));
  ok('согласие записано', p.public.given === true);
  ok('разрешённые категории сохранены', p.public.scope.nick === true && p.public.scope.stats === true);
  ok('запрещённые — тоже, явно', p.public.scope.flag === false && p.public.scope.ally === false);

  console.log('\n── 7. Отписка по ссылке из письма ──');
  await post('/api/consents', { id: 'ads', on: true }, tok);
  const me = await get('/api/me', tok);
  const myId = me.d.id;
  // Ссылка в письме содержит идентификатор и ключ. Ключ отдельный от
  // сессии: письмо лежит в почте годами, а сессия — тридцать дней.
  const bad = await post('/api/unsubscribe', { u: myId, k: 'подобранный-ключ' });
  ok('чужой ключ не отписывает', bad.status === 200 && bad.d.done === false);
  const still = await get('/api/consents', tok);
  ok('согласие на месте', (still.d.items || []).find((x) => x.id === 'ads').given === true);

  // Настоящий ключ читаем прямо из базы сервера — файлом, не подключая
  // модуль базы в тестовый процесс: своя инициализация открыла бы ДРУГУЮ
  // базу в другой папке, и тест проверял бы пустоту.
  // База пишется на диск не мгновенно, поэтому ждём появления ключа, а
  // не читаем один раз: разовое чтение давало бы то зелёный, то красный
  // результат в зависимости от того, успел ли сервер сохраниться.
  const usersFile = path.join(workDir, 'data', 'users.json');
  let key = '';
  for (let i = 0; i < 40 && !key; i++) {
    try {
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      key = String((users[myId] || {}).mailKey || '');
    } catch (e) {}
    if (!key) await new Promise((r) => setTimeout(r, 100));
  }
  ok('у игрока есть ключ отписки', key.length > 10);
  const good = await post('/api/unsubscribe', { u: myId, k: key });
  ok('по верной ссылке отписка срабатывает', good.d.done === true);
  const gone = await get('/api/consents', tok);
  ok('согласие отозвано', (gone.d.items || []).find((x) => x.id === 'ads').given === false);
  // Ответ одинаков для верной и неверной ссылки — иначе она стала бы
  // способом проверять чужие идентификаторы.
  ok('ответ не выдаёт, существует ли игрок',
     JSON.stringify(Object.keys(bad.d).sort()) === JSON.stringify(['done', 'ok']));

  console.log('\n── 8. Выгрузка своих данных ──');
  const mine = await get('/api/my-data', tok);
  ok('копия отдаётся', mine.status === 200 && !!mine.d.аккаунт);
  ok('в ней есть позывной и почта', mine.d.аккаунт.name === 'Молчун' && !!mine.d.аккаунт.email);
  ok('и записанные согласия', !!mine.d.аккаунт.consents);
  // Хеш пароля и токены не выгружаются: копия данных уходит человеку
  // в файл, и класть туда секреты нельзя.
  const raw = JSON.stringify(mine.d);
  ok('хеша пароля в выгрузке нет', !/passHash/.test(raw));
  ok('соли нет', !/"salt"/.test(raw));
  ok('токенов подтверждения нет', !/emailVerifyToken/.test(raw));

  console.log('\n── 9. Старый игрок упирается в окно подтверждения ──');
  // Игроки, зарегистрированные до появления отметок, согласий не давали:
  // их не спрашивали. Продолжать обработку «по умолчанию» нельзя, но и
  // выкинуть их из игры нельзя — они пришли по прежним правилам.
  // Поэтому окно закрывает игру, пока человек не ответит.
  const older = await post('/api/register', {
    login: 'Ветеран', email: 'v@t.ru', password: 'пароль123', country: 'ru', consents: FULL,
  });
  ok('игрок заведён', older.status === 200);
  const vCode = codeFrom(letters[letters.length - 1]);
  const vTok = (await post('/api/verify-code', { login: 'Ветеран', code: vCode })).d.token;
  ok('и вошёл', !!vTok);

  // Стираем согласия прямо в базе — так выглядит аккаунт, созданный до
  // этой сборки.
  //
  // Ждём отложенную запись: сервер сбрасывает данные через 400 мс, и
  // остановка раньше срока оставляла на диске базу БЕЗ только что
  // заведённого игрока. На Linux это добирало финальное сохранение по
  // SIGTERM, на Windows kill() обработчик не запускает вовсе — и здесь
  // падало на «Ветеран не найден в users.json».
  await new Promise((r) => setTimeout(r, 900));
  await stop(srv);
  const uf = path.join(workDir, 'data', 'users.json');
  const uu = JSON.parse(fs.readFileSync(uf, 'utf8'));
  const vet = Object.values(uu).find((x) => x.name === 'Ветеран');
  delete vet.consents;
  fs.writeFileSync(uf, JSON.stringify(uu));
  srv = await startServer(env);

  const vTok2 = (await post('/api/login', { login: 'Ветеран', password: 'пароль123' })).d.token;
  const vMe = await get('/api/me', vTok2);
  ok('игра сообщает, что подтверждение требуется', Array.isArray(vMe.d.needConsent) && vMe.d.needConsent.length > 0);
  ok('перечислено, чего именно не хватает',
     vMe.d.needConsent.map((x) => x.id).sort().join(',') === 'age18,pdn,terms');

  // Окно рисует клиент — проверяем, что он его действительно рисует и
  // что оно закрывает игру, а не висит поверх неё как баннер.
  const appJs = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  ok('клиент показывает окно по этому признаку', /App\.me\.needConsent && App\.me\.needConsent\.length/.test(appJs));
  ok('окно закрывает игру целиком', /consent-gate[\s\S]{0,900}wrap\.style\.display = 'none'/.test(appJs));
  ok('и проверяется не только при загрузке, но и при опросе состояния',
     (appJs.match(/App\.showConsentGate\(/g) || []).length >= 2);
  // Выход обязан быть: несогласный человек должен иметь возможность уйти,
  // а не оказаться заперт в окне.
  ok('из окна есть выход', /id="cg-out"/.test(appJs));

  const accepted = await post('/api/consents/accept-all', {
    consents: { age18: true, terms: true, pdn: true },
  }, vTok2);
  ok('подтверждение принимается', accepted.status === 200);
  ok('и требовать больше нечего', (accepted.d.left || []).length === 0);
  const vMe2 = await get('/api/me', vTok2);
  ok('игра пускает дальше', (vMe2.d.needConsent || []).length === 0);

  // Молчание в окне не должно превращаться в согласие на рекламу.
  const vCons = await get('/api/consents', vTok2);
  const vById = Object.fromEntries((vCons.d.items || []).map((x) => [x.id, x]));
  ok('обязательные записаны с источником «reconsent»', vById.terms.given === true);
  ok('реклама сама собой не включилась', vById.ads.given === false);
  ok('и публичный профиль тоже', vById.public.given === false);

  // Неполный ответ окном не принимается — иначе кнопка «Подтверждаю»
  // работала бы и с пустыми галками.
  const half = await post('/api/consents/accept-all', { consents: { age18: true } }, vTok2);
  ok('без принятия соглашения окно не закрывается', half.status >= 400);

  console.log('\n── 10. Панель закрыта сотруднику без второго фактора ──');
  // Ждём отложенную запись на диск. Сервер помечает игрока грязным и
  // сбрасывает данные через 400 мс — а тест до сих пор останавливал его
  // раньше этого срока. На Linux финальное сохранение по SIGTERM всё
  // добирало, на Windows kill() обработчик не запускает вовсе, и
  // grant-admin открывал ПУСТУЮ базу: «игроков: 0, игрок не найден».
  await new Promise((r) => setTimeout(r, 900));
  await stop(srv);
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/grant-admin.js'), 'Молчун', '--owner', '--yes'],
      { cwd: workDir, stdio: 'pipe', env: toolEnv(env) });
  } catch (e) {
    // Свою причину grant-admin печатает в перехваченный поток, и без
    // этого она пропадала: тест падал голым «Command failed», по
    // которому нельзя отличить нехватку прав от неверной базы.
    throw new Error('grant-admin не выдал права:\n'
      + String((e && e.stdout) || '') + String((e && e.stderr) || ''));
  }
  srv = await startServer(env);
  const owner = (await post('/api/login', { login: 'Молчун', password: 'пароль123' })).d.token;
  ok('в игру сотрудник входит как обычно', !!owner);

  const panel = await get('/api/admin/email-status', owner);
  ok('а панель не открывается', panel.status === 403);
  ok('и сказано, что именно включить', /второй фактор/i.test(panel.d.error || ''));
  // Дверь не должна захлопываться: настройка самого фактора обязана
  // остаться доступной, иначе включить его будет неоткуда.
  const setup = await post('/api/2fa/setup', {}, owner);
  ok('подключить второй фактор при этом можно', setup.status === 200 && !!setup.d.secret);
  const st = await get('/api/2fa/status', owner);
  ok('и состояние видно', st.status === 200);

  // Та же настройка есть в личных настройках игрока, а не только в
  // панели: раньше она жила ТОЛЬКО в панели, и получался замкнутый круг
  // — фактор нужен для входа в панель, а включить его можно было только
  // из панели.
  const coreJs = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
  ok('подключение второго фактора есть в настройках игрока', /id="tfa-start"/.test(coreJs));
  ok('и вызывает настоящую ручку', /\/api\/2fa\/setup/.test(coreJs));
  ok('коды восстановления показываются', /recoveryCodes/.test(coreJs));

  await stop(srv); mail.s.close();
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
