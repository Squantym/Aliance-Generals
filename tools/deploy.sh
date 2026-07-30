#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# ДЕПЛОЙ НА СЕРВЕРЕ — одна команда вместо шести
#
# Забирает свежий код с GitHub, пересобирает и перезапускает игру.
# Сервер считается ТОЧНОЙ КОПИЕЙ репозитория: любые локальные правки в
# рабочем дереве сбрасываются. Именно из-за них `git pull` отказывался
# обновляться и на сервере месяцами жил старый код.
#
# База данных и настройки НЕ ТРОГАЮТСЯ: data/ и .env перечислены в
# .gitignore, а git не касается игнорируемых файлов.
#
# Запуск:  bash tools/deploy.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

GAME_DIR="${GAME_DIR:-$HOME/Aliance-Generals}"
PM2_NAME="${PM2_NAME:-generals-game}"

cd "$GAME_DIR"

echo "[1/6] Проверяю, что настройки и база на месте"
[ -f .env ] && echo "      .env найден" || echo "      ⚠ .env НЕ найден — сервер не запустится без него"
[ -d data ] && echo "      data/ найдена ($(du -sh data | cut -f1))" || echo "      data/ пока нет (нормально до первого запуска)"

echo "[2/6] Страховочная копия базы, если она своя (SQLite)"
if [ -f data/generals.db ] && command -v sqlite3 >/dev/null 2>&1; then
  mkdir -p data/backups
  BK="data/backups/pre-deploy-$(date +%Y-%m-%d_%H-%M-%S).db"
  sqlite3 data/generals.db ".backup '$BK'" && echo "      копия: $BK"
else
  echo "      пропускаю (базы SQLite нет или не установлен sqlite3)"
fi

echo "[3/6] Забираю код с GitHub"
BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
git fetch origin
git reset --hard "origin/$BRANCH"
git clean -fd
echo "      ветка $BRANCH, коммит: $(git log --oneline -1)"

echo "[4/6] Зависимости"
rm -rf node_modules dist
npm install

echo "[5/6] Сборка"
npm run build
[ -f dist/server.js ] || { echo "      ⛔ dist/server.js не собрался — прерываю, игра не перезапущена"; exit 1; }
echo "      dist/server.js готов"

echo "[6/6] Перезапуск"
pm2 restart "$PM2_NAME" --update-env
pm2 list

# Подключение к облачной базе занимает до 20 секунд (а при проблемах с
# сертификатом делается вторая попытка), поэтому ждём с повторами, а не
# один раз — иначе скрипт объявляет провал на живом сервере.
echo "      жду ответа сервера (до 60 секунд)…"
CODE=000
for i in $(seq 1 30); do
  sleep 2
  CODE="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ || true)"
  [ "$CODE" = "200" ] && break
done

if [ "$CODE" = "200" ]; then
  echo "✅ Готово: сервер отвечает 200"
else
  echo "⚠ Сервер не ответил за 60 секунд (последний код '$CODE')."
  echo "  Логи: pm2 logs $PM2_NAME --lines 40 --nostream"
  exit 1
fi
