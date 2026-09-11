// ═══════════════════════════════════════════════════════════════════
// test/dotenv.test.js — чтение .env при запуске
//
// Повод первый — сутки поисков на боевом сервере. Ключ почты лежал в .env,
// `grep` его находил, а игра считала почту ненастроенной: ПУСТАЯ
// переменная окружения, которую держал pm2, выигрывала у файла.
//
// Повод второй (11.09.2026) — то же, но с НЕПУСТЫМИ значениями. pm2 держал
// ключи тестового магазина ЮKassa и адрес тестового мира. В .env стояли
// боевые, сервер честно предупреждал «строки не применились», а покупки
// отклонялись; `pm2 restart --update-env` старые значения не убирал.
//
// Отсюда правила, которые здесь и стерегутся:
//
//  1. .env ГЛАВНЕЕ окружения — и пустого, и непустого. Файл владелец
//     видит и правит, память pm2 — нет.
//  2. Перебить файл при запуске можно только ЯВНО: ENV_OVERRIDE=ИМЯ,ИМЯ.
//  3. О любом расхождении говорят вслух и без значений: заменённые
//     переменные, оставленные по ENV_OVERRIDE, повторы строк в файле.
//
// Проверяется на живом сервере: загрузчик — самая первая строка
// server.ts, и проверять его в отрыве от запуска бессмысленно. Что взято
// на самом деле, видно снаружи по названию тестового мира в /api/world.
//
// Запуск: node test/dotenv.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const PORT = 4870 + Math.floor(Math.random() * 20);
const BASE = 'http://127.0.0.1:' + PORT;

// Поднимаем сервер с заданным .env и заданным окружением, ждём запуска и
// возвращаем весь его вывод плюс ответ /api/world.
function run(envFile, envVars) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenv-'));
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.env'), envFile);
    const env = Object.assign({}, process.env, {
      PORT: String(PORT), DISABLE_RATE_LIMIT: '1', MONGODB_URI: '', DB_DRIVER: '',
      NODE_ENV: '', TEST_WORLD: '', ALLOW_UNVERIFIED_EMAIL: '',
      SMTPBZ_API_KEY: undefined, EMAIL_FROM: undefined, APP_URL: undefined,
      TEST_WORLD_NAME: undefined, ENV_OVERRIDE: undefined, name: undefined,
    }, envVars || {});
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];

    const p = spawn(process.execPath, [path.join(ROOT, 'dist/server.js')],
      { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const done = async () => {
      let world = {};
      try { world = await fetch(BASE + '/api/world').then((x) => x.json()); } catch (e) {}
      p.kill();
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
      resolve({ out, world });
    };
    const h = (b) => { out += String(b); if (/сервер запущен/i.test(out)) setTimeout(done, 250); };
    p.stdout.on('data', h); p.stderr.on('data', h);
    setTimeout(() => { p.kill(); reject(new Error('не поднялся:\n' + out.slice(-400))); }, 20000);
  });
}

const KEY = 'SMTPBZ_API_KEY=ключ-из-кабинета';
const BASE_ENV = `${KEY}\nEMAIL_FROM=Generals <noreply@aliance-general.ru>\nAPP_URL=https://aliance-general.ru\n`;
const WORLD_ENV = BASE_ENV + 'TEST_WORLD=1\nTEST_WORLD_NAME=Мир из файла\n';
const mailOn = (r) => !!(r.world && r.world.test && r.world.test.mailConfigured);
const worldName = (r) => (r.world && r.world.test && r.world.test.name) || '';
const REPLACED = /ДРУГИЕ значения/;

(async () => {
  console.log('\n── 1. Ключ в .env, в окружении его нет ──');
  const a = await run(BASE_ENV, {});
  ok('ключ применился', mailOn(a));
  ok('о почте не ругается', !/РЕГИСТРАЦИЯ ЗАКРЫТА/.test(a.out));
  ok('и про расхождения молчит', !REPLACED.test(a.out));

  console.log('\n── 2. Пустая переменная окружения НЕ перебивает .env ──');
  // Вот ровно тот случай, что стоил суток
  const b = await run(BASE_ENV, { SMTPBZ_API_KEY: '' });
  ok('ключ всё равно взят из файла', mailOn(b));
  ok('регистрация не закрыта', !/РЕГИСТРАЦИЯ ЗАКРЫТА/.test(b.out));
  ok('и пустое значение не считается расхождением', !REPLACED.test(b.out));

  console.log('\n── 3. Непустая переменная окружения тоже НЕ перебивает .env ──');
  // Случай 11.09.2026: в памяти pm2 — значения тестового мира
  const c = await run(WORLD_ENV, { TEST_WORLD_NAME: 'Мир из памяти pm2', SMTPBZ_API_KEY: 'другой-ключ' });
  ok(`файл выиграл: «${worldName(c)}»`, worldName(c) === 'Мир из файла');
  ok('сказано, что значения из окружения заменены', REPLACED.test(c.out));
  ok('и названы именно они', /TEST_WORLD_NAME/.test(c.out) && /SMTPBZ_API_KEY/.test(c.out));
  ok('и подсказано, как вычистить память pm2', /pm2 delete generals-game && pm2 start dist\/server\.js --name generals-game && pm2 save/.test(c.out));
  ok('но значения в вывод не попали', !/другой-ключ|ключ-из-кабинета|Мир из памяти/.test(c.out));
  const c2 = await run(WORLD_ENV, { TEST_WORLD_NAME: 'Мир из памяти pm2', name: 'generals-test' });
  ok('подсказка — с именем своего процесса pm2', /pm2 delete generals-test && pm2 start dist\/server\.js --name generals-test/.test(c2.out));

  console.log('\n── 4. Совпадающее значение — не расхождение ──');
  const d = await run(BASE_ENV, { SMTPBZ_API_KEY: 'ключ-из-кабинета' });
  ok('про расхождение не ругается', !REPLACED.test(d.out));

  console.log('\n── 5. Перебить файл при запуске — только явно ──');
  const o = await run(WORLD_ENV, { ENV_OVERRIDE: 'TEST_WORLD_NAME', TEST_WORLD_NAME: 'Мир из запуска' });
  ok(`по ENV_OVERRIDE окружение выиграло: «${worldName(o)}»`, worldName(o) === 'Мир из запуска');
  ok('об этом сказано с именем', /По ENV_OVERRIDE взято из окружения[^\n]*TEST_WORLD_NAME/.test(o.out));
  ok('а «заменены» не пишется', !REPLACED.test(o.out));

  console.log('\n── 6. Строка повторяется в файле ──');
  // Недоудалённая старая строка: так в .env оказывается и тестовый ключ, и боевой
  const dup = await run(BASE_ENV + 'TEST_WORLD=1\nTEST_WORLD_NAME=Старый мир\nTEST_WORLD_NAME=Новый мир\n', {});
  ok(`взята последняя строка: «${worldName(dup)}»`, worldName(dup) === 'Новый мир');
  ok('о повторе сказано с именем', /повторяются[^\n]*TEST_WORLD_NAME/.test(dup.out));
  const same = await run(BASE_ENV + 'APP_URL=https://aliance-general.ru\n', {});
  ok('одинаковый повтор не шумит', !/повторяются/.test(same.out));

  console.log('\n── 7. Строка без значения ──');
  // `SMTPBZ_API_KEY=` grep находит, а толку ноль
  const e = await run('SMTPBZ_API_KEY=\nAPP_URL=https://aliance-general.ru\n', {});
  ok('пустая строка не считается настройкой', !mailOn(e));
  ok('и о ней сказано отдельно', /строки без значения/.test(e.out));
  ok('с именем строки', /SMTPBZ_API_KEY/.test(e.out));
  ok('и регистрация честно закрыта', /РЕГИСТРАЦИЯ ЗАКРЫТА/.test(e.out));

  console.log('\n── 8. Кавычки и пробелы вокруг знака равенства ──');
  const f = await run('SMTPBZ_API_KEY = "ключ в кавычках"\n', {});
  ok('пробелы и кавычки сняты', mailOn(f));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
