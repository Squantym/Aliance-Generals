// ===================================================================
// server.ts — точка входа в игру «ГЕНЕРАЛЫ»
// Запуск: node server.js
//
// Переменные окружения (все необязательны для локальной разработки):
//   PORT          — порт сервера (по умолчанию 3000)
//   MONGODB_URI    — строка подключения к MongoDB. Если не задана —
//                    данные хранятся в локальных JSON-файлах в /data.
//   MONGODB_DB     — имя базы данных в MongoDB (по умолчанию "generals")
//   RESEND_API_KEY — ключ API resend.com для отправки писем подтверждения.
//                    Если не задан — почта считается подтверждённой
//                    автоматически (режим разработки), а ссылка для
//                    подтверждения выводится в консоль.
//   EMAIL_FROM     — адрес отправителя писем
//   APP_URL        — публичный адрес игры (для ссылок в письмах)
// ===================================================================

// Лёгкий загрузчик .env без сторонних библиотек. Читает файл .env из
// корня проекта (если он есть) и переносит переменные в process.env.
// Уже заданные в окружении переменные имеют приоритет и не затираются.
// Это нужно, чтобы строка подключения MONGODB_URI и прочие настройки
// подхватывались автоматически при любом способе запуска (pm2, node).
(function loadDotEnv() {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;       // пропускаем пустые и комментарии
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      // Снимаем обрамляющие кавычки, если есть
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e: any) {
    console.warn('Не удалось прочитать .env:', e.message);
  }
})();

import http = require('./src/core/http');
import db = require('./src/core/db');
import registerRoutes = require('./src/routes');
import market = require('./src/services/market');
import legion = require('./src/services/legion');
import fame = require('./src/services/fame');

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  // Сначала подключаемся к базе данных (или к локальным файлам) —
  // и только потом начинаем принимать запросы.
  await db.init();

  // Создаём приложение (мини-аналог Express, написанный руками)
  const app = http.createApp();

  // Подключаем все API-маршруты игры
  registerRoutes(app);

  // Фоновый «тик» мира: раз в 30 секунд разрешаем истёкшие аукционы,
  // следим за чёрным рынком и кланвойнами, сохраняем изменения.
  setInterval(() => {
    try {
      market.tick();
      legion.resolveWars();
      require('./src/services/silos').resolveInFlight(); // долёт летящих ракет
      fame.resetDailyIfNeeded();
      db.saveAll();
    } catch (e) {
      console.error('Ошибка фонового тика:', e);
    }
  }, 30 * 1000);

  // При первом старте сразу создаём аукционные лоты
  market.tick();

  // Стартуем HTTP-сервер
  const server = app.listen(PORT, () => {
    console.log('=========================================');
    console.log('  ⭐ ГЕНЕРАЛЫ — сервер запущен');
    console.log(`  Игра:        http://localhost:${PORT}/`);
    console.log(`  Админ-панель: http://localhost:${PORT}/admin`);
    console.log(`  База данных:  ${db.mode === 'mongo' ? 'MongoDB' : 'локальные JSON-файлы'}`);
    console.log('  Первый зарегистрированный игрок получает права администратора.');
    console.log('=========================================');
  });

  // Корректное завершение: дожидаемся записи всех данных, затем выходим.
  // SIGTERM — так останавливают контейнеры на хостингах (Render и т.п.),
  // SIGINT — это Ctrl+C в терминале.
  async function shutdown(signal: string) {
    console.log(`\nПолучен сигнал ${signal}, сохраняю данные перед выходом...`);
    server.close();
    await db.flushAllNow();
    console.log('Данные сохранены, выхожу.');
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('Не удалось запустить сервер:', e);
  process.exit(1);
});
