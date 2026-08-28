// ═══════════════════════════════════════════════════════════════════
// tools/test-account.js — завести аккаунт в тестовом мире из консоли
//
// Нужен ровно в одном случае: тестовый мир только что развёрнут, база
// пуста, прав нет ни у кого, а публичная регистрация в тестовом мире
// закрыта. Получается замкнутый круг — чтобы нажать кнопку в панели,
// надо войти в панель, а войти некому.
//
// Этот скрипт его разрывает: создаёт аккаунт напрямую в базе, минуя
// HTTP. Дальше права выдаются обычным tools/grant-admin.js, и все
// последующие аккаунты заводятся уже кнопкой в панели.
//
// РАБОТАЕТ ТОЛЬКО ПРИ TEST_WORLD=1. На боевом сервере это была бы
// регистрация без подтверждения почты, то есть дыра — поэтому скрипт
// проверяет признак сам и отказывается работать без него.
//
// Запуск (в папке тестовой установки, сервер можно не останавливать):
//     node tools/test-account.js Позывной пароль123
//     node tools/test-account.js Позывной пароль123 --owner
// ═══════════════════════════════════════════════════════════════════
const path = require('path');
const fs = require('fs');

// Тот же загрузчик .env, что и в server.ts: при прямом запуске файла
// process.env иначе не увидит ни TEST_WORLD, ни настроек базы.
(function loadDotEnv() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) {}
})();

const login = process.argv[2];
const password = process.argv[3];
const asOwner = process.argv.includes('--owner');

if (!login || !password) {
  console.error('Использование: node tools/test-account.js Позывной пароль123 [--owner]');
  process.exit(2);
}

if (String(process.env.TEST_WORLD || '') !== '1') {
  console.error('⛔ Это не тестовый мир (TEST_WORLD не равен 1).');
  console.error('   На боевом сервере аккаунты заводятся только обычной регистрацией');
  console.error('   с подтверждением почты. Иначе это дыра размером с регистрацию.');
  process.exit(1);
}

if (String(password).length < 8) {
  console.error('⛔ Пароль: минимум 8 символов');
  process.exit(2);
}

(async () => {
  let db, auth, consent, player;
  try {
    db = require(path.join(process.cwd(), 'dist/src/core/db.js'));
    auth = require(path.join(process.cwd(), 'dist/src/services/auth.js'));
    consent = require(path.join(process.cwd(), 'dist/src/services/consent.js'));
    player = require(path.join(process.cwd(), 'dist/src/services/player.js'));
  } catch (e) {
    console.error('⛔ Сначала соберите проект: npm run build');
    process.exit(2);
  }

  await db.init();

  // Адрес заведомо недоставляемый: .invalid — зарезервированная зона,
  // письма туда не уходят никогда. Так случайная рассылка не попадёт на
  // чужой настоящий ящик.
  const mail = `${String(login).toLowerCase().replace(/[^a-z0-9]/g, '') || 'test'}@test.invalid`;

  try {
    await auth.register(login, password, mail, 'ru', '127.0.0.1', 'консоль', {}, '',
      { age18: true, terms: true, pdn: true });
  } catch (e) {
    console.error('⛔ ' + (e && e.message));
    process.exit(1);
  }

  const users = player.users();
  const made = Object.values(users).find((p) => p.name === login);
  if (!made) { console.error('⛔ Аккаунт не создался'); process.exit(1); }

  // Подтверждаем почту сразу: ждать письмо, которое некуда слать, — то
  // самое, ради чего этот скрипт и написан.
  made.emailVerified = true;
  made.emailVerifyToken = null;
  made.emailVerifyCode = null;
  made.isTestAccount = true;
  db.markUser(made.id);
  db.save('users');

  console.log(`✅ Аккаунт «${login}» создан в тестовом мире. Почта подтверждена.`);
  console.log(`   Вход: логин «${login}», пароль тот, что вы указали.`);
  if (asOwner) {
    console.log('');
    console.log('   Права владельца выдайте отдельной командой:');
    console.log(`     node tools/grant-admin.js "${login}" --owner --yes`);
    console.log('   (отдельно намеренно: выдача прав — это действие, которое должно');
    console.log('    быть видно в журнале само по себе, а не прицепом к созданию)');
  }
  process.exit(0);
})().catch((e) => { console.error('💥', e && e.message); process.exit(1); });
