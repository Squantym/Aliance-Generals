// ═══════════════════════════════════════════════════════════════════
// test/worldreset.test.js — обнуление мира
//
// Самая опасная кнопка в проекте: отменить её нельзя, а ошибка в ней
// стоит всей базы игроков. Поэтому проверяется на ЖИВОМ сервере и
// настоящим HTTP — и не только «сработало ли», но и «не сработало ли
// там, где не должно».
//
// Что стережётся и почему именно это:
//
//  1. НЕ ВЛАДЕЛЕЦ НЕ МОЖЕТ. Обычный игрок и даже администратор без
//     прав владельца не должны иметь возможности стереть проект.
//
//  2. БЕЗ ТОЧНОЙ ФРАЗЫ НИЧЕГО НЕ ПРОИСХОДИТ. Ни пустая, ни похожая, ни
//     фраза с чужим номером мира. Диалог «вы уверены?» люди
//     подтверждают не думая — набранная руками фраза требует прочитать.
//
//  3. ЖУРНАЛ ПЕРЕЖИВАЕТ ОБНУЛЕНИЕ. Кнопка, стирающая журнал, — это
//     кнопка «замести следы»: ею удалялись бы и разбор жалобы, и запись
//     о выдаче ресурсов себе. Само обнуление тоже обязано быть в нём.
//
//  4. ВЛАДЕЛЕЦ ОСТАЁТСЯ И МОЖЕТ ВОЙТИ. Иначе после обнуления в игру
//     некому зайти: регистрация заводит обычного игрока, а прав ему
//     выдать неоткуда — панель закрыта.
//
//  5. ОСТАЛЬНЫЕ УДАЛЕНЫ НАСОВСЕМ, В ТОМ ЧИСЛЕ ПОСЛЕ ПЕРЕЗАПУСКА. Мало
//     стереть из памяти: строка в таблице пережила бы рестарт, и игроки
//     «воскресли» бы — эта ошибка в проекте уже была.
//
//  6. ИТОГИ ПРОШЛОГО МИРА СОХРАНЕНЫ. Обнуление не должно стирать саму
//     память о том, что было.
//
//  7. ИГРА ЗАКРЫВАЕТСЯ САМА и не открывается сама. После стирания
//     смотреть на результат должен человек.
//
// Запуск: node test/worldreset.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Режим базы. Боевой сервер работает на SQLite, и именно там живёт
// разница между «удалить из памяти» и «удалить из таблицы»: в файловом
// режиме файл переписывается целиком, и забытый dropUser не заметен. А
// на своей базе строка пережила бы перезапуск, и удалённые игроки
// «воскресли» бы — эта ошибка в проекте уже была. Поэтому тот же тест
// прогоняется в обоих режимах.
const SQLITE = process.argv.includes('--sqlite');
const PORT = (SQLITE ? 4930 : 4975) + Math.floor(Math.random() * 20);
const BASE = 'http://127.0.0.1:' + PORT;
let srv = null, workDir = '';
const letters = [];

function fakeMail() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        letters.push({ html: new URLSearchParams(b).get('html') || '' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
    });
    s.listen(0, '127.0.0.1', () => r({ s, url: 'http://127.0.0.1:' + s.address().port + '/send' }));
  });
}

let env = null;
function startServer() {
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

const CONS = { age18: true, terms: true, pdn: true };
const codeFrom = (m) => {
  const x = /\b(\d{6})\b/.exec(String((m && m.html) || '').replace(/<[^>]*>/g, ' '));
  return x ? x[1] : null;
};
async function makePlayer(login, mail) {
  await post('/api/register', { login, email: mail, password: 'пароль123', country: 'ru', consents: CONS });
  const code = codeFrom(letters[letters.length - 1]);
  return (await post('/api/verify-code', { login, code })).d.token;
}
// Сколько игроков в базе. В файловом режиме читаем файл, в своей базе —
// саму базу: спрашивать сервер нельзя, нам нужно то, что ПЕРЕЖИВЁТ его
// перезапуск, а не то, что он держит в памяти.
function usersFile() {
  if (!SQLITE) {
    try { return JSON.parse(fs.readFileSync(path.join(workDir, 'data', 'users.json'), 'utf8')); }
    catch (e) { return {}; }
  }
  try {
    const Database = require('better-sqlite3');
    const d = new Database(path.join(workDir, 'data', 'generals.db'), { readonly: true });
    const out = {};
    for (const r of d.prepare('SELECT id, data FROM players').all()) {
      try { out[r.id] = { ...JSON.parse(r.data), id: r.id }; } catch (e) {}
    }
    d.close();
    return out;
  } catch (e) { return {}; }
}

(async () => {
  const mail = await fakeMail();
  console.log(SQLITE ? '\n### Режим: своя база (SQLite) — как на боевом'
    : '\n### Режим: файловая база (JSON) — как при разработке');
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wipe-'));
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });
  env = Object.assign({}, process.env, {
    PORT: String(PORT), DISABLE_RATE_LIMIT: '1', MONGODB_URI: '', NODE_ENV: 'test',
    DB_DRIVER: SQLITE ? 'sqlite' : '', SQLITE_DIR: './data', SQLITE_FILE: 'generals.db',
    SMTPBZ_API_KEY: 'k', SMTPBZ_URL: mail.url,
    EMAIL_FROM: 'Aliance Generals <noreply@aliance-general.ru>',
    APP_URL: 'https://aliance-general.ru',
    STAFF_2FA_REQUIRED: '0', TEST_WORLD: '',
  });
  srv = await startServer();

  console.log('\n── 1. Населяем мир ──');
  await makePlayer('Хозяин', 'v@t.ru');
  await makePlayer('Боец', 'b@t.ru');
  await makePlayer('Второй', 'b2@t.ru');
  // Запись в базу отложенная — ждём, иначе читаем файл на полпути.
  await new Promise((r) => setTimeout(r, 900));
  ok('три игрока заведены', Object.keys(usersFile()).length === 3);

  await stop(srv);
  execFileSync(process.execPath, [path.join(ROOT, 'tools/grant-admin.js'), 'Хозяин', '--owner', '--yes'],
    { cwd: workDir, stdio: 'pipe' });
  srv = await startServer();
  let owner = (await post('/api/login', { login: 'Хозяин', password: 'пароль123' })).d.token;
  const player = (await post('/api/login', { login: 'Боец', password: 'пароль123' })).d.token;

  // Даём владельцу нажитое, чтобы потом было видно, сбросилось ли оно.
  await post('/api/admin/give', { name: 'Хозяин', dollars: 999999 }, owner).catch(() => {});

  console.log('\n── 2. Что будет стёрто — показываем ДО ──');
  const pv = await get('/api/admin/world-reset', owner);
  ok('раздел открывается владельцу', pv.status === 200);
  ok('это первый мир', pv.d.world === 1);
  ok('названо число игроков', pv.d.players === 3);
  ok('фраза подтверждения с номером мира', /обнулить мир 1/i.test(pv.d.phrase || ''));
  // Список остающегося короткий и весь — осознанный. Журнала в нём
  // больше НЕТ: он целиком уходит в замороженный мир, а в живой базе
  // персональным данным удалённых игроков не место.
  ok('журнал НЕ в списке остающегося', !(pv.d.keep || []).includes('actionLogs'));
  ok('счётчик тарифа почты остаётся', (pv.d.keep || []).includes('mailQuota'));
  ok('указатель на замороженные миры остаётся', (pv.d.keep || []).includes('worldArchive'));
  ok('режим обслуживания остаётся', (pv.d.keep || []).includes('maintenance'));
  ok('игроки в списке остающегося не значатся', !(pv.d.keep || []).includes('users'));
  ok('список остающегося короткий', (pv.d.keep || []).length <= 6);

  console.log('\n── 3. Кому нельзя ──');
  ok('обычному игроку раздел закрыт', (await get('/api/admin/world-reset', player)).status >= 400);
  ok('и стереть он не может',
     (await post('/api/admin/world-reset', { confirm: pv.d.phrase }, player)).status >= 400);
  ok('игроки на месте', Object.keys(usersFile()).length === 3);

  console.log('\n── 4. Без точной фразы ничего не происходит ──');
  for (const bad of ['', 'обнулить', 'обнулить мир', 'обнулить мир 2', 'ОБНУЛИТЬ ВСЁ', 'да']) {
    const r = await post('/api/admin/world-reset', { confirm: bad }, owner);
    ok(`отклонено: «${bad || '(пусто)'}»`, r.status >= 400);
  }
  ok('после всех попыток игроки на месте', Object.keys(usersFile()).length === 3);
  if (SQLITE) {
    console.log('\n── 3б. Наполняем служебные таблицы ──');
    // player_history, log_packs и snapshots заполняются редко: срезами
    // перед админскими действиями, упаковкой недельного журнала,
    // страховкой перед сбросом сезона. В коротком тесте они остались бы
    // пустыми — и три проверки «стёрто» прошли бы, ничего не проверив.
    // Проверено намеренной поломкой: без этого блока отключение любого
    // из трёх DELETE не давало ни одного красного.
    const Database = require('better-sqlite3');
    const d = new Database(path.join(workDir, 'data', 'generals.db'));
    const ids = Object.keys(usersFile());
    d.prepare('INSERT INTO player_history (id, at, label, actor, hash, data) VALUES (?,?,?,?,?,?)')
      .run(ids[1] || 'x1', Date.now(), 'до выдачи', 'Хозяин', 'h1', Buffer.from('старое состояние'));
    // Дата — десять дней назад: старше «горячих» суток, но внутри
    // трёхмесячного срока хранения. Поставишь январь — пачку удалит
    // обычная чистка по сроку, и проверка «стёрто» пройдёт, ничего не
    // проверив. На этом тест уже один раз и обманулся.
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    d.prepare('INSERT INTO log_packs (day, user_id, n, raw, data) VALUES (?,?,?,?,?)')
      .run(tenDaysAgo, ids[1] || 'x1', 10, 100, Buffer.from('упакованный журнал'));
    d.prepare('INSERT INTO snapshots (at, label, collection, data) VALUES (?,?,?,?)')
      .run(Date.now(), 'перед сезоном', 'season', '{"old":true}');
    const cnt = (t) => d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    ok('история состояний наполнена', cnt('player_history') > 0);
    ok('упакованный журнал наполнен', cnt('log_packs') > 0);
    ok('снимки коллекций наполнены', cnt('snapshots') > 0);
    d.close();
  }

  console.log('\n── 4б. Без слепка мира не стираем ──');
  // Слепок — единственный путь назад. На своей базе он снимается всегда
  // и обойти его нельзя. В файловой базе снимать его нечем, поэтому
  // стирание требует отдельного согласия: молча уничтожать данные,
  // потому что «тут всё равно разработка», — привычка, которая однажды
  // сработает на боевом сервере.
  if (!SQLITE) {
    const noFreeze = await post('/api/admin/world-reset',
      { confirm: 'обнулить мир 1' }, owner);
    ok('отказ: заморозить мир нечем', noFreeze.status >= 400);
    ok('и объяснено, что делать', /вручную|скопируйте/i.test(noFreeze.d.error || ''));
    ok('игроки на месте', Object.keys(usersFile()).length === 3);
  }

  // Регистр и лишние пробелы прощаем: это защита от бездумного клика, а
  // не проверка на аккуратность набора.
  const loose = await post('/api/admin/world-reset',
    { confirm: '  ОБНУЛИТЬ   Мир 1 ', reason: 'конец первого сезона',
      allowNoFreeze: !SQLITE }, owner);
  ok('но регистр и лишние пробелы прощаются', loose.status === 200);

  console.log('\n── 5. Что осталось ──');
  // Запись в базу отложенная (400 мс) — ждём её честно.
  await new Promise((r) => setTimeout(r, 900));
  ok('удалено двое', loose.d.removed === 2);
  ok('оставлен один', loose.d.kept === 1);
  const after = usersFile();
  ok('в базе ровно один игрок', Object.keys(after).length === 1);
  ok('и это владелец', Object.values(after)[0].name === 'Хозяин');
  // Роль — самое важное поле: без неё владелец после обнуления
  // превращается в обычного игрока, а вернуть права неоткуда (выдаются
  // они из панели, а панель без роли не открывается). Проект заперся бы
  // снаружи насовсем.
  ok('роль владельца сохранена', Object.values(after)[0].role === 'owner');
  ok('прогресс владельца сброшен', (Object.values(after)[0].level || 1) === 1);
  ok('и деньги тоже', Number(Object.values(after)[0].dollars) < 999999);

  console.log('\n── 6. Игра закрыта и сама не откроется ──');
  // После стирания смотреть на результат должен человек: мир может не
  // подняться, и открытые двери означали бы, что об этом сообщат игроки.
  const w = await get('/api/world');
  ok('игра закрыта на обслуживание', w.d.maintenance.on === true);
  ok('и сказано, что мир перезапускается', /с нуля|новый мир/i.test(w.d.maintenance.reason || ''));

  console.log('\n── 7. Удалённые не воскресают после перезапуска ──');
  // Мало стереть из памяти: строка в таблице пережила бы рестарт. Эта
  // ошибка в проекте уже была — отсюда «воскресшие» аккаунты.
  await stop(srv);
  srv = await startServer();
  ok('игроков по-прежнему один', Object.keys(usersFile()).length === 1);
  const dead = await post('/api/login', { login: 'Боец', password: 'пароль123' });
  ok('удалённый войти не может', dead.status >= 400);
  owner = (await post('/api/login', { login: 'Хозяин', password: 'пароль123' })).d.token;
  ok('владелец входит своим прежним паролем', !!owner);
  ok('и панель ему открыта', (await get('/api/admin/world-reset', owner)).status === 200);

  console.log('\n── 8. Итоги прошлого мира сохранены ──');
  const pv2 = await get('/api/admin/world-reset', owner);
  ok('теперь идёт мир №2', pv2.d.world === 2);
  ok('и фраза сменилась', /обнулить мир 2/i.test(pv2.d.phrase || ''));
  ok('в архиве одна запись', (pv2.d.archive || []).length === 1);
  ok('в ней число игроков прошлого мира', pv2.d.archive[0].players === 3);
  if (SQLITE) {
    // Замороженный мир — отдельный файл в data/worlds/, которого не
    // касается ротация копий. Это единственный путь назад.
    ok('мир заморожен в файл', /^mir-01-/.test(pv2.d.archive[0].file || ''));
    ok('и файл не пустой', Number(pv2.d.archive[0].bytes) > 4096);
    ok('он виден в списке замороженных', (pv2.d.frozen || []).length === 1);
    const wf = path.join(workDir, 'data', 'worlds', (pv2.d.frozen[0] || {}).file || 'нет');
    ok('и лежит на диске', fs.existsSync(wf));
    // Главное: в замороженном мире игроки ЕСТЬ, хотя в живой базе их нет.
    const Database = require('better-sqlite3');
    const fz = new Database(wf, { readonly: true });
    const inFrozen = fz.prepare('SELECT COUNT(*) AS n FROM players').get().n;
    const logsFrozen = fz.prepare('SELECT COUNT(*) AS n FROM action_logs').get().n;
    fz.close();
    ok('в замороженном мире все три игрока', inFrozen === 3);
    ok('и журнал прошлого мира тоже там', logsFrozen > 0);
  }
  ok('кто обнулил', pv2.d.archive[0].by === 'Хозяин');
  ok('и зачем', /первого сезона/i.test(pv2.d.archive[0].reason || ''));

  console.log('\n── 9. Журнал начат заново ──');
  // Старый журнал ушёл вместе со всем остальным — он целиком лежит в
  // замороженном мире. Оставлять в живой базе действия игроков, которых
  // больше нет, значит хранить их персональные данные без основания.
  const logs = await get('/api/admin/logs?limit=200', owner);
  const txt = JSON.stringify(logs.d || {});
  ok('журнал доступен', logs.status === 200);
  ok('действий удалённого игрока в нём нет', !/Боец/.test(txt));
  ok('но само обнуление записано — журнал не начинается с пустоты',
     /ОБНУЛИЛ МИР|world-reset/i.test(txt));

  if (SQLITE) {
    console.log('\n── 9б. В живой базе не осталось ничего от прошлого мира ──');
    // Проверяем саму базу, а не ответы сервера: нас интересует то, что
    // лежит на диске. Персональные данные игроков, которых больше нет,
    // не должны оставаться в работающей игре — они целиком в
    // замороженном мире.
    const Database = require('better-sqlite3');
    const live = new Database(path.join(workDir, 'data', 'generals.db'), { readonly: true });
    const one = (q) => live.prepare(q).get().n;
    ok('игрок в таблице один', one('SELECT COUNT(*) AS n FROM players') === 1);
    // История стирается вся, но сразу после обнуления сервер сохраняет
    // пересобранный аккаунт владельца — и на него появляется новый срез.
    // Поэтому проверяем не «ноль строк», а «нет истории удалённых».
    const ownerId = Object.keys(usersFile())[0];
    const histIds = live.prepare('SELECT DISTINCT id FROM player_history').all().map((r) => String(r.id));
    ok('истории удалённых игроков не осталось',
       histIds.every((id) => id === ownerId));
    ok('упакованный журнал стёрт', one('SELECT COUNT(*) AS n FROM log_packs') === 0);
    ok('снимки коллекций стёрты', one('SELECT COUNT(*) AS n FROM snapshots') === 0);
    // Журнал не пуст — но только своей единственной записью про само
    // обнуление. Записей прошлого мира в нём быть не должно.
    const logRows = live.prepare('SELECT data FROM action_logs').all()
      .map((r) => String(r.data)).join(' ');
    ok('в журнале нет действий удалённых игроков', !/Боец|Второй/.test(logRows));
    ok('но само обнуление в нём есть', /world-reset/.test(logRows));
    live.close();
  }

  console.log('\n── 9в. Пустой слепок — не повод стирать ──');
  // VACUUM INTO может оставить пустой файл при нехватке места на диске.
  // «Копия есть» превратилось бы в ложь ровно в тот момент, когда на неё
  // рассчитывают, поэтому размер проверяется, а не подразумевается.
  //
  // Проверяем в отдельном процессе со своей папкой данных: подмена
  // заморозки в этом процессе писала бы в базу самого проекта.
  {
    const probe = `
      const path = require('path');
      const wr = require(${JSON.stringify(path.join(ROOT, 'dist/src/services/worldReset.js'))});
      const dbm = require(${JSON.stringify(path.join(ROOT, 'dist/src/core/db.js'))});
      Object.defineProperty(dbm, 'mode', { get: () => 'sqlite', configurable: true });
      dbm.load('users', {}).x = { id: 'x', name: 'Хозяин' };
      const out = [];
      for (const fake of [() => ({ file: '/tmp/x.db', bytes: 0 }), () => null]) {
        dbm.freezeWorld = fake;
        try { wr.run({ id: 'x', name: 'Хозяин' }, { confirm: wr.phrase(), keepIds: ['x'] }); out.push('НЕ ОТКАЗАЛ'); }
        catch (e) { out.push(String(e && e.message || e)); }
      }
      console.log(JSON.stringify(out));
    `;
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-probe-'));
    fs.mkdirSync(path.join(probeDir, 'data'), { recursive: true });
    const r = require('child_process').spawnSync(process.execPath, ['-e', probe],
      { cwd: probeDir, encoding: 'utf8' });
    let said = [];
    try { said = JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch (e) {}
    ok('пустой слепок останавливает обнуление', /заморозить мир/i.test(said[0] || ''));
    ok('и подсказывает про место на диске', /место на диске/i.test(said[0] || ''));
    ok('неудавшийся слепок — тоже отказ', /заморозить мир/i.test(said[1] || ''));
    try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n── 10. Новый мир принимает игроков ──');
  await post('/api/admin/maintenance', { on: false }, owner);
  const born = await post('/api/register',
    { login: 'Новичок', email: 'n@t.ru', password: 'пароль123', country: 'ru', consents: CONS });
  ok('регистрация в новом мире работает', born.status === 200);
  // Имя освободилось: удалённый игрок его больше не занимает.
  const reuse = await post('/api/register',
    { login: 'Боец', email: 'b3@t.ru', password: 'пароль123', country: 'ru', consents: CONS });
  ok('имя удалённого игрока свободно', reuse.status === 200);

  await stop(srv); mail.s.close();
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог (${SQLITE ? 'своя база SQLite' : 'файловая база'}): `
    + `${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  await stop(srv);
  console.error('⛔ ' + (e && e.stack || e));
  process.exit(1);
});
