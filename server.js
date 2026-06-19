// ===================================================================
// server.js — точка входа в игру «ГЕНЕРАЛЫ»
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

const http = require('./src/core/http');
const db = require('./src/core/db');
const staticCache = require('./src/core/staticCache');
const registerRoutes = require('./src/routes');
const market = require('./src/services/market');
const legion = require('./src/services/legion');
const groups = require('./src/services/groups');

const PORT = process.env.PORT || 3000;

// Округление байтов для красивого лога
function kb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

async function main() {
  // Сначала подключаемся к базе данных (или к локальным файлам) —
  // и только потом начинаем принимать запросы.
  await db.init();

  // Предзагружаем всю статику /public в память: считаем хеши, сжимаем
  // gzip+brotli, переписываем ссылки на CSS/JS в HTML на «фингерпринт»-
  // версии с Cache-Control: immutable. Делается один раз при старте.
  const stat = staticCache.init();
  if (stat && stat.files) {
    const ratio = stat.brBytes > 0
      ? `, brotli: ${kb(stat.brBytes)} (-${Math.round(100 - stat.brBytes / stat.rawBytes * 100)}%)`
      : '';
    console.log(`📦 Статика: ${stat.files} файлов (${stat.hashed} с хешем в URL), ${kb(stat.rawBytes)}${ratio}`);
  }

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
      db.saveAll();
    } catch (e) {
      console.error('Ошибка фонового тика:', e);
    }
  }, 30 * 1000);

  // При первом старте сразу создаём аукционные лоты
  market.tick();

  // Миграция: удаляем фейковых ботов из всех альянсов (старые данные)
  groups.cleanupBotsFromAlliances();

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
  async function shutdown(signal) {
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
