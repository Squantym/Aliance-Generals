// ═══════════════════════════════════════════════════════════════════
// test/unisender.test.js — проверка tools/unisender-probe.js
//
// Скрипт-определитель площадки ценен ровно настолько, насколько верно он
// читает ответ сервиса. Поэтому поднимаем НАСТОЯЩИЙ HTTP-сервер, который
// отвечает так же, как Unisender, и смотрим, что скрипт скажет.
//
// Три случая, ради которых он и написан:
//   1. ключ живёт на второй площадке — надо посоветовать UNISENDER_URL;
//   2. ключ живёт на первой — менять ничего не надо;
//   3. ключа нет нигде — дело не в адресе, а в ключе.
//
// Запуск: node test/unisender.test.js
// ═══════════════════════════════════════════════════════════════════
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Сервер-двойник Unisender. Режим задаётся при создании: отвечает он
// либо списком доменов, либо той самой ошибкой «User with id ... not found».
function fakeUnisender(mode) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (mode === 'ok') {
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'success', domains: [{ domain: 'aliance-general.ru', domain_verified: true }] }));
        } else if (mode === 'nomethod') {
          // Первый метод отсутствует, второй отвечает: скрипт обязан дойти
          // до второго, а не объявить площадку чужой по первому отказу
          if (/domain\/list/.test(req.url)) {
            res.writeHead(404);
            res.end(JSON.stringify({ status: 'error', message: 'Method not found' }));
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'success', templates: [] }));
          }
        } else {
          // Ровно то, что видел владелец в панели
          res.writeHead(400);
          res.end(JSON.stringify({ status: 'error', message: "User with id '8316838' not found" }));
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port }));
  });
}

// Запускаем скрипт отдельным процессом и НЕ блокируем свой event loop:
// сервер-двойник живёт в этом же процессе, и синхронный запуск (execFileSync)
// намертво заклинил бы обоих — скрипт ждал бы ответа, а ответить некому.
function runProbe(hosts, key) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'tools/unisender-probe.js')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        UNISENDER_API_KEY: key || 'testkey123abc',
        UNISENDER_PROBE_HOSTS: hosts.join(','),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (b) => { out += String(b); });
    p.stderr.on('data', (b) => { out += String(b); });
    p.on('close', (code) => resolve({ out, code }));
  });
}

(async () => {
  const a = await fakeUnisender('notfound');   // первая площадка — чужая
  const b = await fakeUnisender('ok');         // вторая — наша

  console.log('\n── 1. Ключ живёт на второй площадке ──');
  let r = await runProbe([a.url, b.url]);
  ok('скрипт нашёл рабочий адрес', /КЛЮЧ РАБОТАЕТ/.test(r.out));
  ok('чужая площадка помечена как чужая', /ключ не принадлежит/.test(r.out));
  ok('назван правильный адрес', r.out.includes('Рабочий адрес: ' + b.url));
  ok('подсказана строка UNISENDER_URL', r.out.includes(`UNISENDER_URL=${b.url}/ru/transactional/api/v1/email/send.json`));
  ok('показан домен из ответа', /aliance-general\.ru — подтверждён/.test(r.out));
  ok('успешный выход', r.code === 0);

  console.log('\n── 2. Ключ живёт на первой (адрес по умолчанию) ──');
  r = await runProbe([b.url, a.url]);
  ok('менять адрес не советует', /менять в \.env ничего не нужно/.test(r.out));
  ok('и не подсовывает UNISENDER_URL', !/UNISENDER_URL=/.test(r.out));
  ok('успешный выход', r.code === 0);

  console.log('\n── 3. Ключа нет нигде ──');
  const c = await fakeUnisender('notfound');
  r = await runProbe([a.url, c.url]);
  ok('честно говорит, что дело не в адресе', /не опознан НИ НА ОДНОМ/.test(r.out));
  ok('советует пересоздать ключ', /новый ключ/.test(r.out));
  ok('код возврата — ошибка', r.code === 1);

  console.log('\n── 4. Мусор в ключе виден до всякой сети ──');
  r = await runProbe([a.url], 'ключ с пробелом');
  ok('предупреждение о посторонних символах', /посторонние символы/.test(r.out));

  // Если один справочный метод у сервиса переименуют, скрипт не должен
  // объявить рабочую площадку чужой — иначе он отправит владельца чинить
  // то, что не сломано.
  console.log('\n── 5. Первый справочный метод отсутствует ──');
  const d = await fakeUnisender('nomethod');
  r = await runProbe([d.url]);
  ok('скрипт дошёл до второго метода и опознал адрес', /КЛЮЧ РАБОТАЕТ/.test(r.out));
  ok('и не назвал её чужой', !/ключ не принадлежит/.test(r.out));

  a.srv.close(); b.srv.close(); c.srv.close(); d.srv.close();
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + e.message); process.exit(1); });
