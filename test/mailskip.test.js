// ═══════════════════════════════════════════════════════════════════
// test/mailskip.test.js — письмо не должно пропадать из-за одного флага
//
// Unisender умеет слать «служебное письмо без ссылки отписки»
// (skip_unsubscribe), но право на это выдаётся аккаунту отдельно. Если
// права нет, сервис отклоняет письмо ЦЕЛИКОМ:
//
//   Error in 'skip_unsubscribe' field.
//   The user must have the 'allow_skip_unsubscribe' flag set.
//
// Снаружи это просто «письмо не ушло»: игрок не получает подтверждение
// и не может войти, а владелец идёт чинить домен и ключ, хотя дело в
// одном необязательном поле. Правильное поведение — повторить письмо
// без флага: обычное письмо со ссылкой отписки лучше, чем никакого.
//
// Проверяем настоящим сервером-двойником, который ведёт себя как
// Unisender на бесплатном тарифе.
//
// Запуск: node test/mailskip.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const http = require('http');
const pathx = require('path');
const ROOT = pathx.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Двойник Unisender. Запоминает КАЖДЫЙ запрос — по ним и видно, что
// именно игра отправила и повторила ли она попытку.
function fakeUnisender(opts) {
  const seen = [];
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let j = {};
        try { j = JSON.parse(body); } catch (e) {}
        const msg = (j && j.message) || {};
        seen.push(msg);
        res.setHeader('Content-Type', 'application/json');

        // Нет права на письма без отписки — отклоняем целиком,
        // ровно так, как это делает настоящий сервис
        if (msg.skip_unsubscribe && !opts.allowSkip) {
          res.writeHead(400);
          res.end(JSON.stringify({
            status: 'error',
            message: "Error in 'skip_unsubscribe' field. The user must have the 'allow_skip_unsubscribe' flag set.",
          }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'success', job_id: 'job-' + seen.length }));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({
      srv, seen,
      url: 'http://127.0.0.1:' + srv.address().port + '/ru/transactional/api/v1/email/send.json',
    }));
  });
}

// Модуль почты читает переменные окружения при загрузке, поэтому для
// каждого случая берём его заново, из чистого кэша.
function freshEmail(env) {
  for (const k of Object.keys(require.cache)) {
    if (/dist[\\/]src[\\/]services[\\/]email\.js$/.test(k)) delete require.cache[k];
  }
  Object.assign(process.env, env);
  return require(pathx.join(ROOT, 'dist/src/services/email.js'));
}

(async () => {
  console.log('\n── 1. Тариф без права на «без отписки» ──');
  const free = await fakeUnisender({ allowSkip: false });
  let email = freshEmail({
    UNISENDER_API_KEY: 'k1', UNISENDER_URL: free.url,
    UNISENDER_SKIP_UNSUBSCRIBE: '1',
    EMAIL_FROM: 'Generals <noreply@aliance-general.ru>',
  });
  let r = await email.sendTest('igrok@example.com');
  ok('письмо всё равно ушло', r.sent === true);
  ok('попыток было две', free.seen.length === 2);
  ok('первая — со служебным флагом', free.seen[0].skip_unsubscribe === 1);
  ok('вторая — без него', free.seen[1].skip_unsubscribe === undefined);
  ok('текст письма при повторе не потерялся', !!free.seen[1].body && !!free.seen[1].body.html);
  ok('адрес получателя тот же', free.seen[1].recipients[0].email === 'igrok@example.com');
  ok('отправитель разобран верно',
     free.seen[1].from_email === 'noreply@aliance-general.ru' && free.seen[1].from_name === 'Generals');

  console.log('\n── 2. Второе письмо идёт сразу правильно ──');
  // Иначе каждое письмо стоило бы лишнего запроса, а при рассылке на
  // 69 адресов это 69 напрасных обращений к сервису.
  const before = free.seen.length;
  r = await email.sendTest('drugoy@example.com');
  ok('и оно ушло', r.sent === true);
  ok('хватило одной попытки', free.seen.length - before === 1);
  ok('флага в ней нет', free.seen[before].skip_unsubscribe === undefined);

  console.log('\n── 3. Где право есть — флаг остаётся ──');
  const paid = await fakeUnisender({ allowSkip: true });
  email = freshEmail({
    UNISENDER_API_KEY: 'k2', UNISENDER_URL: paid.url,
    UNISENDER_SKIP_UNSUBSCRIBE: '1',
    EMAIL_FROM: 'Generals <noreply@aliance-general.ru>',
  });
  r = await email.sendTest('vip@example.com');
  ok('письмо ушло', r.sent === true);
  ok('без лишнего повтора', paid.seen.length === 1);
  ok('служебный флаг сохранён', paid.seen[0].skip_unsubscribe === 1);

  console.log('\n── 4. Отказ по ДРУГОЙ причине не прячем ──');
  // Повтор оправдан только для этого флага. Если сервис отказал по
  // иной причине, владелец обязан увидеть настоящий текст ошибки.
  const broken = await new Promise((resolve) => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        seen.push(1);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Domain not verified' }));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({
      srv, seen, url: 'http://127.0.0.1:' + srv.address().port + '/send.json',
    }));
  });
  email = freshEmail({ UNISENDER_API_KEY: 'k3', UNISENDER_URL: broken.url, UNISENDER_SKIP_UNSUBSCRIBE: '1' });
  r = await email.sendTest('kto@example.com');
  ok('письмо не ушло', r.sent === false);
  ok('причина показана как есть', /Domain not verified/.test(r.error || ''));
  ok('повторять не стали', broken.seen.length === 1);

  console.log('\n── 5. Флаг можно выключить заранее ──');
  const off = await fakeUnisender({ allowSkip: false });
  email = freshEmail({ UNISENDER_API_KEY: 'k4', UNISENDER_URL: off.url, UNISENDER_SKIP_UNSUBSCRIBE: '0' });
  r = await email.sendTest('tihiy@example.com');
  ok('письмо ушло с первого раза', r.sent === true && off.seen.length === 1);
  ok('флага не было вовсе', off.seen[0].skip_unsubscribe === undefined);

  free.srv.close(); paid.srv.close(); broken.srv.close(); off.srv.close();
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + e.message); process.exit(1); });
