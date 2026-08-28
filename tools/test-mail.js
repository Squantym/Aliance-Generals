// ═══════════════════════════════════════════════════════════════════
// tools/test-mail.js — проверка отправки письма в обход админ-панели
//
// Делает ровно то же самое, что кнопка «Отправить образец себе» в
// панели — использует тот же код игры и тот же ключ из .env, но
// напрямую из консоли: без длинных curl-команд с кавычками и
// переносами строк, которые ломаются при вставке в некоторые SSH-
// консоли. Тут только один аргумент — адрес почты.
//
// Запуск (после npm run build):
//   node tools/test-mail.js вашапочта@пример.ru
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

// Тот же загрузчик .env, что и в server.ts — при прямом запуске файла
// (не через pm2/server.ts) process.env иначе не увидит ни
// SMTPBZ_API_KEY, ни EMAIL_FROM.
(function loadDotEnv() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const raw of lines) {
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
  } catch (e) { /* нет .env — не страшно, будет режим разработки */ }
})();

const to = process.argv[2];
if (!to) {
  console.error('Укажите почту: node tools/test-mail.js вашапочта@пример.ru');
  process.exit(2);
}

let email;
try {
  email = require(path.join(process.cwd(), 'dist/src/services/email.js'));
} catch (e) {
  console.error('Не найден dist/src/services/email.js — сначала соберите проект: npm run build');
  process.exit(2);
}

console.log(`\nОтправитель: ${email.EMAIL_FROM}`);
console.log(`Сервис: ${email.PROVIDER_NAMES[email.provider] || email.provider}`);
console.log(`Отправляю проверочное письмо на ${to} ...\n`);

email.sendTest(to).then((r) => {
  if (r.sent) {
    console.log('✅ Письмо принято сервисом отправки.');
    if (r.status) console.log('   HTTP статус:', r.status);
  } else {
    console.log('⛔ Письмо не ушло.');
    console.log('   Причина:', r.error);
  }
  process.exit(r.sent ? 0 : 1);
}).catch((e) => {
  console.error('Ошибка при отправке:', e.message);
  process.exit(2);
});
