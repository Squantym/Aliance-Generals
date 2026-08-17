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

  // ---- Владелец проекта из настроек ----
  // OWNER_NAME в .env назначает владельцем указанный позывной при каждом
  // старте. Нужен потому, что скрипт на сервере правит ФАЙЛ базы, а
  // работающий сервер держит игроков в памяти и при остановке
  // перезаписывает базу своей копией — правка молча пропадала.
  // Здесь роль выставляется в памяти сервера, поэтому она сохраняется.
  try {
    const ownerName = String(process.env.OWNER_NAME || '').trim();
    if (ownerName) {
      const players = db.load<Record<string, any>>('users', {});
      const low = ownerName.toLowerCase();
      const target = Object.values(players).find((p: any) => String(p.name || '').toLowerCase() === low);
      if (!target) {
        console.warn(`⚠️  OWNER_NAME=«${ownerName}»: игрок с таким позывным не найден`);
      } else if ((target as any).role !== 'owner') {
        (target as any).role = 'owner';
        (target as any).isAdmin = true;
        db.markUser((target as any).id);
        db.save('users');
        console.log(`👑 Игрок «${(target as any).name}» назначен владельцем проекта (OWNER_NAME).`);
      }
    }
  } catch (e: any) {
    console.error('Ошибка назначения владельца:', e && e.message);
  }

  // ---- Разовая миграция: обнуление рейтинга под новую систему ----
  // Рейтинг стал накопительным (победа +1 / поражение −1 / ухо или жетон +3 /
  // тебе отрезали ухо −3 / подрыв на мине −3). Старые значения считались по
  // формуле от уровня и не сопоставимы — обнуляем всем ОДИН раз.
  try {
    const meta = db.load<Record<string, any>>('meta', {});
    if (!meta.ratingResetV2) {
      const players = db.load<Record<string, any>>('users', {});
      let n = 0;
      for (const id of Object.keys(players)) {
        if (players[id].rating !== 0) { players[id].rating = 0; n++; }
      }
      meta.ratingResetV2 = Date.now();
      db.save('meta');
      db.save('users'); // полное сохранение (миграция затрагивает всех)
      console.log(`🔄 Миграция рейтинга: обнулено у ${n} игроков.`);
    }
  } catch (e) {
    console.error('Ошибка миграции рейтинга:', e);
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
      require('./src/services/tournaments').tick(); // авто-старт матчей и продвижение сетки
      require('./src/services/silos').resolveInFlight(); // долёт летящих ракет
      require('./src/services/seasons').rolloverIfNeeded(); // смена недели: наградить топ-3 ДО любых сбросов
      require('./src/services/mines').tickAll(); // шахты: уведомления о нападении вовремя + финализация спусков
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
    console.log(`  База данных:  ${db.mode === 'sqlite' ? 'своя (SQLite)' : db.mode === 'mongo' ? 'MongoDB' : 'локальные JSON-файлы'}`);
    console.log(`  Владелец:     ${process.env.OWNER_NAME ? 'задан в OWNER_NAME (' + process.env.OWNER_NAME + ')' : 'назначается командой tools/grant-admin.js или из панели'}`);
    console.log('=========================================');
  });

  // Корректное завершение: дожидаемся записи всех данных, затем выходим.
  // SIGTERM — так останавливают контейнеры на хостингах (Render и т.п.),
  // SIGINT — это Ctrl+C в терминале.
  async function shutdown(signal: string) {
    console.log(`\nПолучен сигнал ${signal}, сохраняю данные перед выходом...`);
    server.close();
    const failed = await db.flushAllNow();
    // Своя база: сводим журнал WAL в основной файл и закрываем соединение.
    // Без этого рядом с базой остаётся -wal, и хотя SQLite подхватит его
    // при следующем старте, копировать базу «на горячую» в таком виде
    // нельзя — копия окажется без последних транзакций.
    if (typeof (db as any).closeDb === 'function') (db as any).closeDb();
    // Пишем правду: раньше здесь всегда было «Данные сохранены», даже когда
    // часть коллекций не записалась
    if (failed && failed.length) {
      console.error(`⚠️  ВЫХОД С ПОТЕРЕЙ: не сохранены коллекции: ${failed.join(', ')}`);
      process.exit(1);
    }
    console.log('Данные сохранены, выхожу.');
    process.exit(0);
  }
  // ── Аварийные ситуации ────────────────────────────────────────────
  // Без этих обработчиков любая необработанная ошибка (в таймере, в
  // промисе, в фоновом тике) убивает процесс МГНОВЕННО — всё, что не
  // успело записаться на диск, теряется. Теперь: логируем причину,
  // сохраняем данные и выходим с ненулевым кодом, чтобы pm2 поднял
  // сервер заново уже с целыми данными.
  let crashing = false;
  const crash = async (kind: string, err: any) => {
    if (crashing) return;             // второй раз не входим
    crashing = true;
    console.error(`\n💥 ${kind}:`, err && err.stack ? err.stack : err);
    console.error('Пытаюсь сохранить данные перед аварийным выходом…');
    try {
      const failed = await db.flushAllNow();
      if (failed && failed.length) console.error('⚠️  Не сохранены:', failed.join(', '));
      else console.error('Данные сохранены.');
      if (typeof (db as any).closeDb === 'function') (db as any).closeDb();
    } catch (e: any) {
      console.error('Сохранить не удалось:', e && e.message);
    }
    process.exit(1);                  // pm2 перезапустит
  };
  process.on('uncaughtException', (err) => { void crash('Необработанная ошибка', err); });
  process.on('unhandledRejection', (reason) => { void crash('Необработанный отказ промиса', reason); });

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('Не удалось запустить сервер:', e);
  process.exit(1);
});
