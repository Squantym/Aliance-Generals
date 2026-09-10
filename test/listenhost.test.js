// ═══════════════════════════════════════════════════════════════════
// test/listenhost.test.js — игра не открыта в интернет в обход HTTPS
//
// Сервер слушал 0.0.0.0, и порты 3000/3001 отвечали снаружи напрямую,
// без шифрования — проверено с внешней машины 10.09.2026, оба мира
// отдавали 200. Пароль, введённый по адресу «IP:3000», в том числе от
// админ-панели, уходил бы открытым текстом.
//
// Межсетевой экран на сервере это закрыл, но он — настройка сервера и
// выключается одной командой. Здесь стережётся вторая линия: сам процесс
// игры принимает подключения ТОЛЬКО на 127.0.0.1, откуда к нему ходит nginx.
//
// Проверка настоящая, через сеть: сервер поднимается, и к нему стучатся
// сначала изнутри (должно работать), потом по внешнему адресу этой
// машины (должно быть отказано).
//
// Запуск: node test/listenhost.test.js   (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-listenhost';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';
process.env.PORT = '3493';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DIR = TEST_CWD + '/data';
delete process.env.LISTEN_HOST;          // проверяем именно поведение по умолчанию

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Ответил ли сервер по адресу. Отказ в соединении — это ожидаемый ответ
// «порт закрыт», а не ошибка теста.
async function reachable(host) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await fetch(`http://${host}:3493/api/online`, { signal: ctl.signal });
    return r.status > 0;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  require(ROOT + '/dist/server.js');
  await new Promise((r) => setTimeout(r, 1800));

  console.log('\n── 1. Изнутри сервера игра доступна ──');
  ok(await reachable('127.0.0.1'), 'по 127.0.0.1 отвечает — nginx до игры достучится');

  console.log('\n── 2. По внешнему адресу — нет ──');
  const outer = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) outer.push(i.address);
    }
  }
  if (!outer.length) {
    console.log('  ⚠ у машины нет внешнего IPv4 — сетевую часть проверить не на чем');
  } else {
    for (const ip of outer) {
      ok(!(await reachable(ip)), `по внешнему адресу ${ip} подключение отклонено`);
    }
  }

  console.log('\n── 3. Настройка и скрипты ──');
  const http = fs.readFileSync(path.join(ROOT, 'src/core/http.ts'), 'utf8');
  ok(!/server\.listen\(port, '0\.0\.0\.0'/.test(http), 'жёсткого 0.0.0.0 в коде больше нет');
  ok(/process\.env\.LISTEN_HOST/.test(http), 'открыть наружу можно только осознанно, через LISTEN_HOST');
  ok(/LISTEN_HOST/.test(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')),
     'настройка описана в .env.example');
  // localhost может сначала пойти по IPv6 (::1), а игра слушает IPv4:
  // проверка после выката сочла бы живой сервер упавшим
  for (const f of ['tools/deploy.sh', 'tools/setup-test-world.sh']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    ok(/curl[^\n]*http:\/\/127\.0\.0\.1:/.test(src) && !/curl[^\n]*http:\/\/localhost:/.test(src),
       `${f}: проверка после запуска идёт на 127.0.0.1`);
  }

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
