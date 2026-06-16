// ===================================================================
// server.js — точка входа в игру «ГЕНЕРАЛЫ»
// Запуск: node server.js  (порт можно поменять переменной PORT)
// Внешних зависимостей нет — только встроенные модули Node.js.
// ===================================================================

const http = require('./src/core/http');
const db = require('./src/core/db');
const registerRoutes = require('./src/routes');
const market = require('./src/services/market');
const legion = require('./src/services/legion');

const PORT = process.env.PORT || 3000;

// Создаём приложение (мини-аналог Express, написанный руками)
const app = http.createApp();

// Подключаем все API-маршруты игры
registerRoutes(app);

// Фоновый «тик» мира: раз в 30 секунд разрешаем истёкшие аукционы
// и следим, чтобы на чёрном рынке всегда были активные лоты.
setInterval(() => {
  try {
    market.tick();
    legion.resolveWars();  // авторазрешение кланвойн после таймера
    db.saveAll();
  } catch (e) {
    console.error('Ошибка фонового тика:', e);
  }
}, 30 * 1000);

// При первом старте сразу создаём аукционные лоты
market.tick();

// Стартуем HTTP-сервер
app.listen(PORT, () => {
  console.log('=========================================');
  console.log('  ⭐ ГЕНЕРАЛЫ — сервер запущен');
  console.log(`  Игра:        http://localhost:${PORT}/`);
  console.log(`  Админ-панель: http://localhost:${PORT}/admin`);
  console.log('  Первый зарегистрированный игрок получает права администратора.');
  console.log('=========================================');
});

// При остановке процесса (Ctrl+C) принудительно сохраняем все данные на диск
process.on('SIGINT', () => {
  console.log('\nСохраняю данные перед выходом...');
  db.saveAllSync();
  process.exit(0);
});
