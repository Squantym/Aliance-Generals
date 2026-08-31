// ═══════════════════════════════════════════════════════════════════
// test/mailrequired.test.js — почта не настроена: что делает игра
//
// Повод — настоящая поломка на боевом сервере. В .env не было
// SMTPBZ_API_KEY, игра сочла, что почты нет, и включила режим
// разработки: подтверждала адрес САМА. Регистрация молча превратилась в
// «вход без подтверждения почты». Владелец увидел это, только когда его
// самого пустило в игру без письма.
//
// Чем это плохо на самом деле — не тем, что неаккуратно:
//
//   • аккаунт заводится на ЧУЖОЙ адрес, владелец которого об этом не
//     знает и согласия не давал;
//   • восстановление пароля потом уходит настоящему владельцу адреса —
//     то есть постороннему;
//   • заметить нечем: игра работает, ошибок нет, в панели подсказка
//     мелким шрифтом.
//
// Отсюда правило, которое здесь и стережётся:
//
//   САМОПОДТВЕРЖДЕНИЕ ТРЕБУЕТ ЯВНОГО РАЗРЕШЕНИЯ. Нет письма и нет
//   разрешения — регистрация ЗАКРЫВАЕТСЯ. Закрытая регистрация видна
//   сразу и чинится за минуту; тихо неподтверждённые аккаунты не видны
//   никогда и не чинятся вовсе.
//
// Проверяется на живом сервере настоящим HTTP: правило стоит на
// маршруте регистрации, и проверять его чтением исходника значит не
// проверять вовсе.
//
// Запуск: node test/mailrequired.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const PORT = 4950 + Math.floor(Math.random() * 25);
const BASE = 'http://127.0.0.1:' + PORT;
let srv = null;
let workDir = '';
let bootLog = '';

function startServer(extra) {
  bootLog = '';
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, {
      PORT: String(PORT), DISABLE_RATE_LIMIT: '1', DB_DRIVER: '', MONGODB_URI: '',
      APP_URL: 'https://aliance-general.ru',
      EMAIL_FROM: 'Aliance Generals <noreply@aliance-general.ru>',
      // Пусто, а не «не задано»: наследованное окружение не должно
      // случайно разрешить то, что тест как раз и запрещает.
      SMTPBZ_API_KEY: '', ALLOW_UNVERIFIED_EMAIL: '', TEST_WORLD: '', NODE_ENV: '',
      STAFF_2FA_REQUIRED: '0',
    }, extra || {});
    const p = spawn(process.execPath, [path.join(ROOT, 'dist/server.js')], {
      cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const h = (b) => { bootLog += String(b); if (/сервер запущен/i.test(bootLog)) resolve(p); };
    p.stdout.on('data', h); p.stderr.on('data', h);
    p.on('exit', (c) => reject(new Error('сервер вышел: ' + c + '\n' + bootLog.slice(-400))));
    setTimeout(() => reject(new Error('не поднялся:\n' + bootLog.slice(-400))), 20000);
  });
}
const stop = (p) => new Promise((r) => { if (!p || p.killed) return r(); p.on('exit', r); p.kill(); });

async function world() {
  const res = await fetch(BASE + '/api/world');
  try { return await res.json(); } catch (e) { return {}; }
}

async function reg(login, mail) {
  const res = await fetch(BASE + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login, email: mail, password: 'пароль123', country: 'ru',
      consents: { age18: true, terms: true, pdn: true },
    }),
  });
  let d = {}; try { d = await res.json(); } catch (e) {}
  return { status: res.status, d };
}

(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailreq-'));
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });

  console.log('\n── 1. Ключа нет, разрешения нет — регистрация закрыта ──');
  // Ровно случай боевого сервера: забыли строку в .env.
  srv = await startServer({});
  const r1 = await reg('Чужой', 'chuzhoy@example.com');
  ok('регистрация отклонена', r1.status >= 400);
  ok('и сказано, что дело в почте', /почт|письм/i.test(r1.d.error || ''));
  ok('игрок НЕ получил токен', !r1.d.token);
  ok('и не оказался подтверждённым', r1.d.emailVerified !== true);

  // Аккаунт не должен был появиться даже неподтверждённым: отказ стоит
  // ДО создания записи.
  let users = {};
  try { users = JSON.parse(fs.readFileSync(path.join(workDir, 'data', 'users.json'), 'utf8')); } catch (e) {}
  ok('аккаунт в базе не завёлся', Object.keys(users).length === 0);

  console.log('\n── 1б. И это видно снаружи, без попытки регистрации ──');
  // Появилось после суток поисков: регистрация была закрыта, но узнать
  // об этом можно было, только попытавшись зарегистрироваться либо зайдя
  // в панель. Со стороны это выглядело как «игра сломалась», и причину
  // искали не там. Теперь состояние видно одним запросом и без входа.
  const w1 = await world();
  ok('/api/world говорит про регистрацию', !!w1.registration);
  ok('и что она закрыта', w1.registration.open === false);
  ok('и называет причину', /почт|письм/i.test(w1.registration.why || ''));
  ok('причина та же, что и в отказе', w1.registration.why === r1.d.error);

  console.log('\n── 2. И об этом сказано в консоли при запуске ──');
  // Владелец смотрит вывод pm2 сразу после выката. Если поломка видна
  // только в панели мелким шрифтом — её не увидит никто.
  ok('предупреждение напечатано', /РЕГИСТРАЦИЯ ЗАКРЫТА/i.test(bootLog));
  ok('и названа переменная, которой не хватает', /SMTPBZ_API_KEY/.test(bootLog));
  ok('и подсказан выход для разработки', /ALLOW_UNVERIFIED_EMAIL/.test(bootLog));

  console.log('\n── 3. Явное разрешение возвращает режим разработки ──');
  // Локальную разработку ломать нельзя: почтовый ящик нужен раньше
  // первого экрана. Но теперь это ОСОЗНАННЫЙ выбор, а не умолчание.
  await stop(srv);
  srv = await startServer({ ALLOW_UNVERIFIED_EMAIL: '1' });
  const r2 = await reg('Местный', 'local@example.com');
  const w2 = await world();
  ok('снаружи видно, что регистрация открыта', w2.registration.open === true);
  ok('и причины нет', !w2.registration.why);
  ok('регистрация проходит', r2.status === 200);
  ok('и сразу пускает в игру', !!r2.d.token && r2.d.emailVerified === true);
  ok('в консоли всё равно предупреждение', /самоподтверждение РАЗРЕШЕНО/i.test(bootLog));
  ok('и сказано, что на боевом так быть не должно', /боевом/i.test(bootLog));

  console.log('\n── 4. Тестовый мир — тоже разрешение ──');
  // В тестовом мире почты нет намеренно, аккаунты выдаёт владелец.
  // Требовать там письмо значило бы сделать тестовый мир непригодным.
  await stop(srv);
  srv = await startServer({ TEST_WORLD: '1', TEST_WORLD_NAME: 'Полигон' });
  const r3 = await reg('Тестер', 'tester@example.com');
  ok('публичная регистрация закрыта своим правилом', r3.status >= 400);
  ok('и причина именно в тестовом мире, а не в почте',
     /тестов/i.test(r3.d.error || ''));
  const w3 = await world();
  ok('снаружи причина тоже про тестовый мир',
     w3.registration.open === false && /тестов/i.test(w3.registration.why || ''));

  console.log('\n── 5. Ключ есть — всё как обычно ──');
  // Письмо не уйдёт (адрес сервиса выдуман), но игра ОБЯЗАНА требовать
  // подтверждение, а не пускать в обход.
  await stop(srv);
  srv = await startServer({
    SMTPBZ_API_KEY: 'k', SMTPBZ_URL: 'http://127.0.0.1:1/send',
  });
  const r4 = await reg('Обычный', 'normal@example.com');
  ok('регистрация принята', r4.status === 200);
  ok('но в игру не пускает — ждёт код', !r4.d.token && r4.d.needCode === true);
  ok('и честно говорит, что письмо не ушло', r4.d.emailSent === false);
  ok('при запуске лишних предупреждений нет', !/РЕГИСТРАЦИЯ ЗАКРЫТА/i.test(bootLog));
  const w4 = await world();
  ok('и снаружи регистрация открыта', w4.registration.open === true);

  console.log('\n── 6. Закрытая на обслуживание игра — тоже причина ──');
  // Три разные причины закрытой регистрации, и снаружи должно быть
  // видно, какая именно: иначе владелец чинит почту, когда на самом
  // деле забыл открыть игру после обновления.
  await stop(srv);
  fs.writeFileSync(path.join(workDir, 'data', 'maintenance.json'), JSON.stringify({
    on: true, startAt: 0, until: 0, auto: false, reason: 'Ставим новые пушки.',
    by: 'Хозяин', at: Date.now(), offAt: 0, frozenFrom: Date.now(),
  }));
  srv = await startServer({ SMTPBZ_API_KEY: 'k', SMTPBZ_URL: 'http://127.0.0.1:1/send' });
  const w5 = await world();
  ok('регистрация закрыта', w5.registration.open === false);
  ok('и причина — обновление, а не почта', /пушки/i.test(w5.registration.why || ''));

  await stop(srv);
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  await stop(srv);
  console.error('⛔ ' + (e && e.stack || e));
  process.exit(1);
});
