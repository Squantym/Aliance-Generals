// ===================================================================
// server.ts — точка входа в игру «АЛЬЯНС ГЕНЕРАЛОВ»
// Запуск: node server.js
//
// Переменные окружения (все необязательны для локальной разработки):
//   PORT          — порт сервера (по умолчанию 3000)
//   DB_DRIVER      — 'sqlite' для своей базы (боевой режим). Если не
//                    задана, но рядом лежит data/generals.db — база
//                    открывается всё равно, чтобы сервер никогда не
//                    поднялся на пустой JSON-базе поверх живых данных.
//   SQLITE_DIR     — папка базы (по умолчанию ./data)
//   SQLITE_FILE    — имя файла базы (по умолчанию generals.db)
//   SMTPBZ_API_KEY — ключ почтового сервиса (smtp.bz). Не задан — почта
//                    считается подтверждённой автоматически (режим
//                    разработки), а код и ссылка выводятся в консоль.
//   EMAIL_FROM     — адрес отправителя писем
//   APP_URL        — публичный адрес игры (для ссылок в письмах)
// ===================================================================

// Лёгкий загрузчик .env без сторонних библиотек. Читает файл .env из
// корня проекта (если он есть) и переносит переменные в process.env.
//
// .env ГЛАВНЕЕ окружения процесса. Раньше было наоборот, и это дважды
// ломало боевой мир без единого признака в файле: сначала пустой ключ
// почты, потом (11.09.2026) pm2 держал ключи ТЕСТОВОГО магазина ЮKassa и
// адрес тестового мира — покупки отклонялись, а `--update-env` старые
// значения не убирал. Файл владелец видит и правит; память pm2 — нет.
//
// Перебить файл при запуске можно только явно, перечислив имена:
//   ENV_OVERRIDE=PORT,DB_DRIVER node dist/server.js
const envOverride = String(process.env.ENV_OVERRIDE || '').split(',').map((s) => s.trim()).filter(Boolean);
// Что в окружении было другим и заменено строкой из файла — говорим при
// запуске поимённо, без значений: в них ключи и пароли
const envReplaced: string[] = [];
const envKeptByOverride: string[] = [];
// Строка повторяется в файле с другим значением — берётся последняя
const envDuplicate: string[] = [];
const envEmptyInFile: string[] = [];

(function loadDotEnv() {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    const fromFile = new Map<string, string>();
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
      if (!key) continue;

      // Строка в файле есть, а значения нет — это почти всегда забытая
      // правка, а не осознанный выбор. Молча принять её за «настройка
      // задана» значит потом искать, почему настройка не работает.
      if (!val) { envEmptyInFile.push(key); continue; }

      const cur = process.env[key];

      // Та же строка выше в файле уже задала значение: повтор с другим
      // значением — почти всегда недоудалённая старая строка. Берём
      // последнюю (её дописали позже) и говорим об этом.
      const prev = fromFile.get(key);
      if (prev !== undefined) {
        if (prev !== val && !envDuplicate.includes(key)) envDuplicate.push(key);
        if (!envOverride.includes(key)) process.env[key] = val;
        continue;
      }
      fromFile.set(key, val);

      if (cur === undefined || cur === '' || cur === val) { process.env[key] = val; continue; }

      // В окружении другое значение. Явно разрешённое при запуске —
      // оставляем; всё прочее — память pm2 с прошлых запусков, и файл
      // её заменяет.
      if (envOverride.includes(key)) { envKeptByOverride.push(key); continue; }
      process.env[key] = val;
      envReplaced.push(key);
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
import worldTick = require('./src/services/worldTick');

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  // Сначала подключаемся к базе данных (или к локальным файлам) —
  // и только потом начинаем принимать запросы.
  await db.init();

  // Устаревшие шаблоны писем: говорим сразу, а не когда игрок пожалуется
  try { require('./src/services/mailer').warnStaleTemplates(); } catch (e) {}

  // ---- Расхождения между .env и окружением ----
  // Поимённо и без значений: в них ключи и пароли. Игру расхождение уже
  // не ломает — файл главнее, — но память pm2 лучше вычистить, чтобы не
  // путаться при разборе.
  if (envReplaced.length) {
    const app = process.env.name || 'generals-game';   // pm2 кладёт имя процесса в name
    console.log('=========================================');
    console.log('  ⚠ В окружении процесса лежали ДРУГИЕ значения — взяты строки из .env:');
    for (const k of envReplaced) console.log(`      ${k}`);
    console.log('    Старые значения держит pm2 с прошлых запусков. На игру они больше');
    console.log('    не влияют. Убрать их из pm2 насовсем:');
    console.log(`    pm2 delete ${app} && pm2 start dist/server.js --name ${app} && pm2 save`);
    console.log('=========================================');
  }
  if (envKeptByOverride.length) {
    console.log(`ℹ По ENV_OVERRIDE взято из окружения, а не из .env: ${envKeptByOverride.join(', ')}`);
  }
  if (envDuplicate.length) {
    console.log(`⚠ В .env строки повторяются с разными значениями — взята последняя: ${envDuplicate.join(', ')}. Удалите лишние.`);
  }
  if (envEmptyInFile.length) {
    console.log(`⚠ В .env есть строки без значения: ${envEmptyInFile.join(', ')} — они пропущены.`);
  }

  // ---- Состояние почты: громко и при каждом запуске ----
  // Забытый SMTPBZ_API_KEY когда-то тихо превращал регистрацию в «вход
  // без подтверждения почты», и узнать об этом можно было, только зайдя
  // в панель и прочитав подсказку мелким шрифтом. Теперь это видно в
  // первых строках вывода pm2 — там, куда смотрят сразу после выката.
  try {
    const w = require('./src/services/email').bootWarning();
    if (w) {
      console.log('=========================================');
      console.log('  ' + w);
      console.log('=========================================');
    }
  } catch (e: any) {
    // Молча глотать ошибку здесь нельзя. Если почтовый модуль не
    // загрузился, то и предупреждения не будет, и регистрация встанет —
    // а причина не появится нигде. Пустой catch превращает поломку в
    // загадку, и разбираться с ней будут по чужим жалобам.
    console.error('⛔ Почтовый модуль не загрузился:', e && e.message);
    console.error('   Регистрация и письма работать не будут.');
  }

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
  // стартуем назначенные бои, доводим ракеты, сохраняем изменения.
  //
  // Тело тика вынесено в src/services/worldTick.ts. Там же и решение
  // «двигать мир или нет»: на время обновления игровая половина тика
  // замирает, чтобы бой легиона не прошёл в закрытой игре без своих
  // участников. Вынесено ради проверяемости — решение, до которого тест
  // может добраться только подождав тридцать секунд живого сервера, на
  // практике не проверяется никогда.
  setInterval(() => { worldTick.tick(); }, 30 * 1000);

  // При первом старте сразу создаём аукционные лоты
  market.tick();

  // Стартуем HTTP-сервер
  const server = app.listen(PORT, () => {
    console.log('=========================================');
    console.log('  ⭐ АЛЬЯНС ГЕНЕРАЛОВ — сервер запущен');
    console.log(`  Игра:        http://localhost:${PORT}/`);
    console.log(`  Админ-панель: http://localhost:${PORT}/admin`);
    console.log(`  База данных:  ${db.mode === 'sqlite' ? 'своя (SQLite)' : 'локальные JSON-файлы'}`);
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
