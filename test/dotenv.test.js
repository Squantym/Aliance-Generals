// ═══════════════════════════════════════════════════════════════════
// test/dotenv.test.js — чтение .env при запуске
//
// Повод — сутки поисков на боевом сервере. Ключ почты лежал в .env,
// `grep` его находил, а игра считала почту ненастроенной и держала
// регистрацию закрытой. Причина оказалась в одной строке загрузчика:
//
//     if (key && process.env[key] === undefined) process.env[key] = val;
//
// ПУСТАЯ переменная окружения выигрывала у файла. А pm2 запоминает
// окружение с первого запуска и при `pm2 restart` его не обновляет — он
// сам про это пишет «Use --update-env». Получается: вписал ключ в .env,
// перезапустил, ничего не изменилось, и ни одного сообщения о том, что
// правка не доехала.
//
// Отсюда три правила, которые здесь и стерегутся:
//
//  1. ПУСТАЯ переменная окружения НЕ перебивает .env. Пустое значение не
//     несёт сведений, считать его заданным незачем.
//  2. НЕПУСТАЯ — перебивает. Так и задумано: этим переопределяют
//     настройки при запуске, не трогая файл.
//  3. НО ОБ ЭТОМ ГОВОРЯТ ВСЛУХ. Расхождение файла с работающим
//     процессом — поломка без признаков, и единственная защита от неё —
//     сказать о ней в первых строках вывода.
//
// Проверяется на живом сервере: загрузчик — самая первая строка
// server.ts, и проверять его в отрыве от запуска бессмысленно.
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
const mailOn = (r) => !!(r.world && r.world.test && r.world.test.mailConfigured);

(async () => {
  console.log('\n── 1. Ключ в .env, в окружении его нет ──');
  const a = await run(BASE_ENV, {});
  ok('ключ применился', mailOn(a));
  ok('о почте не ругается', !/РЕГИСТРАЦИЯ ЗАКРЫТА/.test(a.out));
  ok('и про расхождения молчит', !/НЕ применились/.test(a.out));

  console.log('\n── 2. Пустая переменная окружения НЕ перебивает .env ──');
  // Вот ровно тот случай, что стоил суток. pm2 держит окружение с
  // первого запуска; пустая строка в нём не должна значить ничего.
  const b = await run(BASE_ENV, { SMTPBZ_API_KEY: '' });
  ok('ключ всё равно взят из файла', mailOn(b));
  ok('регистрация не закрыта', !/РЕГИСТРАЦИЯ ЗАКРЫТА/.test(b.out));

  console.log('\n── 3. Непустая переменная окружения перебивает — но вслух ──');
  // Переопределять настройки при запуске, не трогая файл, — законно.
  // Молча расходиться с файлом — нет.
  const c = await run(BASE_ENV, { SMTPBZ_API_KEY: 'другой-ключ' });
  ok('окружение выиграло', mailOn(c));
  ok('но сказано, что строка из .env не применилась', /НЕ применились/.test(c.out));
  ok('и названа именно она', /SMTPBZ_API_KEY/.test(c.out));
  ok('и подсказан pm2 --update-env', /--update-env/.test(c.out));
  ok('но значение ключа в вывод не попало', !/другой-ключ|ключ-из-кабинета/.test(c.out));

  console.log('\n── 4. Совпадающее значение — не расхождение ──');
  const d = await run(BASE_ENV, { SMTPBZ_API_KEY: 'ключ-из-кабинета' });
  ok('про расхождение не ругается', !/НЕ применились/.test(d.out));

  console.log('\n── 5. Строка без значения ──');
  // `SMTPBZ_API_KEY=` grep находит, а толку ноль. Раньше это выглядело
  // как «настройка задана» и молчало.
  const e = await run('SMTPBZ_API_KEY=\nAPP_URL=https://aliance-general.ru\n', {});
  ok('пустая строка не считается настройкой', !mailOn(e));
  ok('и о ней сказано отдельно', /строки без значения/.test(e.out));
  ok('с именем строки', /SMTPBZ_API_KEY/.test(e.out));
  ok('и регистрация честно закрыта', /РЕГИСТРАЦИЯ ЗАКРЫТА/.test(e.out));

  console.log('\n── 6. Кавычки и пробелы вокруг знака равенства ──');
  const f = await run('SMTPBZ_API_KEY = "ключ в кавычках"\n', {});
  ok('пробелы и кавычки сняты', mailOn(f));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
