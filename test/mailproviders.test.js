// ═══════════════════════════════════════════════════════════════════
// test/mailproviders.test.js — отправка и лимиты тарифа
//
// Две вещи, каждая из которых по отдельности тихо ломает регистрацию:
//
//  1. ОТКАЗ СЕРВИСА. Сервис отправки сейчас один — он же единственная
//     точка отказа. Значит обязаны выполняться два условия: отказ
//     НИКОГДА не выдаётся за успех (иначе письмо теряется молча, а
//     игрок ждёт код, которого не будет), и причина доходит до панели
//     дословно. Отдельная тонкость — «200 OK» с отказом внутри тела.
//
//  2. ЛИМИТ ТАРИФА — жёсткий потолок. Упереться в него молча значит
//     сломать не рассылку, а подтверждение почты: новичок не получит
//     код и не поймёт, почему. Поэтому считаем письма сами, держим
//     неприкосновенный запас на служебные и останавливаем рассылку
//     ЗАРАНЕЕ, с объяснением.
//
// Сервис подменяем своим: настоящий в тестах дёргать нельзя.
//
// Запуск: node test/mailproviders.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

// Двойник почтового сервиса. Режим переключается на ходу — так
// проверяется именно отказ посреди работы, а не «сломан с самого начала».
// Отказ отдаётся в формате SMTP.BZ (success:false): двойник обязан
// повторять настоящий формат, иначе проверка «отказ не считается
// успехом» пройдёт мимо живого разбора ответа.
function fakeService(label) {
  const seen = [];
  let mode = 'ok';
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        seen.push({ url: req.url, body: b, auth: req.headers.authorization || req.headers['x-api-key'] || '' });
        res.setHeader('Content-Type', 'application/json');
        if (mode === 'fail') {
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, message: label + ' лежит' }));
          return;
        }
        if (mode === 'quiet-fail') {   // 200, но внутри отказ — так тоже бывает
          res.writeHead(200);
          res.end(JSON.stringify({ success: false, message: label + ' не принял письмо' }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, id: label + '-' + seen.length, status: 'success' }));
      });
    });
    s.listen(0, '127.0.0.1', () => r({
      s, seen,
      url: 'http://127.0.0.1:' + s.address().port + '/send',
      set: (m) => { mode = m; },
      count: () => seen.length,
    }));
  });
}

// Модуль читает окружение при загрузке — для каждого случая берём заново
function freshEmail(env) {
  for (const k of Object.keys(require.cache)) {
    if (/dist[\\/]src[\\/]services[\\/](email|mailQuota)\.js$/.test(k)) delete require.cache[k];
  }
  for (const k of Object.keys(process.env)) {
    if (/^(SMTPBZ|MAIL_LIMIT|MAIL_RESERVE)/.test(k)) delete process.env[k];
  }
  Object.assign(process.env, env);
  return require(path.join(ROOT, 'dist/src/services/email.js'));
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'providers-'));
fs.mkdirSync(path.join(work, 'data'), { recursive: true });
process.chdir(work);

(async () => {
  const db = require(path.join(ROOT, 'dist/src/core/db.js'));
  await db.init();

  const bz = await fakeService('SMTP.BZ');
  const base = {
    SMTPBZ_API_KEY: 'bzkey', SMTPBZ_URL: bz.url,
    EMAIL_FROM: 'Aliance Generals <noreply@aliance-general.ru>',
    MAIL_LIMIT_MONTH: '1000', MAIL_LIMIT_DAY: '100', MAIL_RESERVE: '10',
  };

  console.log('\n── 1. В проекте остался один сервис ──');
  // Владелец потребовал стереть Unisender полностью. Забытая строка в
  // .env или в подсказке панели — это не косметика: она обещает
  // запасной путь, которого нет, и в день отказа сервиса владелец будет
  // искать поломку не там.
  const emailSrc = fs.readFileSync(path.join(ROOT, 'src/services/email.ts'), 'utf8');
  ok('в коде отправки нет Resend', !/resend/i.test(emailSrc));
  ok('и нет Unisender', !/unisender/i.test(emailSrc));
  ok('в примере настроек тоже пусто',
     !/RESEND|UNISENDER/i.test(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')));
  ok('и в подсказках панели', !/unisender/i.test(fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8')));
  // Цепочка остаётся списком, а не развилкой: понадобится запасной —
  // добавится строкой, без переделки вызовов отправки.
  ok('отправка всё ещё устроена списком, а не if/else', /const CHAIN: ProviderId\[\]/.test(emailSrc));
  ok('и таблицей отправителей', /const SENDERS: Record<ProviderId, SendFn>/.test(emailSrc));

  console.log('\n── 2. Обычная отправка ──');
  let email = freshEmail(base);
  ok('сервис — SMTP.BZ', email.provider === 'smtpbz');
  ok('в цепочке он один', email.CHAIN.length === 1);
  ok('панель знает, что запасного нет', email.status().hasBackup === false);
  ok('и честно об этом говорит', /сервис отправки один|Сервис отправки один/i.test(email.status().hint));
  let r = await email.sendTest('igrok@example.com');
  ok('письмо ушло', r.sent === true);
  ok('ровно одно', bz.count() === 1);
  ok('ключ ушёл заголовком', bz.seen[0].auth === 'bzkey');
  ok('получатель в теле запроса', /igrok%40example\.com|igrok@example\.com/.test(bz.seen[0].body));
  ok('видно, кто отправил', r.via === 'smtpbz');

  console.log('\n── 3. Отказ сервиса не выдаётся за успех ──');
  bz.set('fail');
  r = await email.sendTest('igrok@example.com');
  ok('письмо НЕ считается отправленным', r.sent === false);
  ok(`причина названа сервисом: «${String(r.error).slice(0, 40)}…»`, /лежит/.test(r.error));
  ok('и сказано, чей это отказ', /SMTP\.BZ/.test(r.error));

  console.log('\n── 4. «200 OK» с отказом внутри не считается успехом ──');
  // Самая коварная разновидность: сервис отвечает 200, а в теле
  // {"success":false}. Принять это за успех — потерять письмо молча.
  bz.set('quiet-fail');
  r = await email.sendTest('igrok@example.com');
  ok('письмо НЕ считается отправленным', r.sent === false);
  ok('причина от сервиса дошла', /не принял письмо/.test(r.error));

  console.log('\n── 5. Счётчик считает только УШЕДШИЕ письма ──');
  bz.set('ok');
  email = freshEmail(base);
  const q0 = email.quota.view().used.month;
  await email.sendTest('a@example.com');
  await email.sendTest('b@example.com');
  bz.set('fail');
  await email.sendTest('c@example.com');       // не уйдёт
  bz.set('ok');
  const q1 = email.quota.view().used.month;
  ok(`засчитано ровно два письма (было ${q0}, стало ${q1})`, q1 - q0 === 2);

  console.log('\n── 6. Суточный лимит останавливает отправку ──');
  email = freshEmail(Object.assign({}, base, { MAIL_LIMIT_DAY: '3', MAIL_LIMIT_MONTH: '1000', MAIL_RESERVE: '0' }));
  // Счётчик уже не пустой от прошлых случаев — досылаем до потолка
  let stoppedAt = -1;
  for (let i = 0; i < 10; i++) {
    const res = await email.sendTest(`x${i}@example.com`);
    if (!res.sent) { stoppedAt = i; break; }
  }
  ok('отправка остановилась сама', stoppedAt >= 0);
  const lastErr = (await email.sendTest('y@example.com')).error;
  ok(`причина названа игроку понятно: «${String(lastErr).slice(0, 60)}…»`,
     /лимит/i.test(lastErr) && /завтра|исчерпан/i.test(lastErr));

  console.log('\n── 7. Запас на служебные письма рассылке недоступен ──');
  // Ради этого запас и придуман: рассылка не имеет права съесть остаток,
  // нужный подтверждениям почты, — иначе новичок завтра не войдёт.
  email = freshEmail(Object.assign({}, base, { MAIL_LIMIT_DAY: '1000', MAIL_LIMIT_MONTH: '20', MAIL_RESERVE: '15' }));
  const q = email.quota;
  const used0 = q.view().used.month;
  // Доводим расход до границы запаса
  while (q.view().used.month < 20 - 15) await email.sendTest('fill@example.com');
  ok('служебное письмо всё ещё можно отправить', q.check('verify').ok === true);
  ok('а рассылку — уже нет', q.check('news').ok === false);
  ok('и объяснено почему', /запас|подтвержд/i.test(q.check('news').reason));
  ok('в панели видно, сколько доступно рассылке', q.view().left.broadcast === 0);
  ok('и сколько осталось всего', q.view().left.month === 15);

  console.log('\n── 8. Служебные письма доходят до последнего ──');
  // Даже когда запас на исходе, подтверждение почты уходит: без него
  // игрок просто не попадёт в игру.
  let sentAnyway = 0;
  for (let i = 0; i < 20; i++) {
    const res = await email.sendMail(`z${i}@example.com`, 'Код', '<p>123456</p>', 'verify');
    if (res.sent) sentAnyway++;
  }
  ok(`служебные ушли и после исчерпания запаса (${sentAnyway} шт.)`, sentAnyway === 15);
  ok('но и они остановились на потолке тарифа', q.check('verify').ok === false);

  console.log('\n── 9. Смена суток обнуляет дневной счётчик ──');
  email = freshEmail(Object.assign({}, base, { MAIL_LIMIT_DAY: '2', MAIL_RESERVE: '0' }));
  const st = db.load('mailQuota', {});
  st.day = '2000-01-01'; st.dayCount = 999;      // как будто вчера всё выжгли
  db.save('mailQuota');
  ok('сегодня отправка снова разрешена', email.quota.check('verify').ok === true);
  ok('и счётчик суток обнулился', email.quota.view().used.day === 0);

  bz.s.close();
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
