#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# ВЫВОЗ БЭКАПОВ С СЕРВЕРА
#
# Бэкапы, лежащие на том же диске, что и база, — это не защита от
# потери данных: умрёт диск VDS, умрёт и база, и все копии рядом с ней.
# Этот скрипт делает свежую копию и отправляет её на ДРУГОЙ хост.
#
# Настройка (один раз):
#   ssh-keygen -t ed25519 -f ~/.ssh/backup_key -N ''
#   ssh-copy-id -i ~/.ssh/backup_key.pub USER@BACKUP_HOST
#
# Запуск по расписанию (каждый день в 4:30):
#   crontab -e
#   30 4 * * * /home/USER/Aliance-Generals/tools/backup-offsite.sh >> /var/log/generals-backup.log 2>&1
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

GAME_DIR="${GAME_DIR:-$HOME/Aliance-Generals}"
DB_FILE="${DB_FILE:-$GAME_DIR/data/generals.db}"
REMOTE="${REMOTE:-user@backup-host:/backups/generals}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/backup_key}"
KEEP_LOCAL="${KEEP_LOCAL:-7}"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
OUT_DIR="$GAME_DIR/data/backups"
OUT="$OUT_DIR/offsite-$STAMP.db"

echo "[$(date '+%F %T')] Начинаю вывоз бэкапа"

if [ ! -f "$DB_FILE" ]; then
  echo "ОШИБКА: базы нет по пути $DB_FILE"; exit 1
fi

mkdir -p "$OUT_DIR"

# Целостная копия НА ХОДУ (игру останавливать не нужно).
# .backup корректно работает с WAL, в отличие от простого cp.
sqlite3 "$DB_FILE" ".backup '$OUT'"

# Проверяем копию ПЕРЕД отправкой: бэкап, который не открывается, — не бэкап
CHECK="$(sqlite3 "$OUT" 'PRAGMA integrity_check;')"
if [ "$CHECK" != "ok" ]; then
  echo "ОШИБКА: копия повреждена ($CHECK), не отправляю"; rm -f "$OUT"; exit 1
fi
PLAYERS="$(sqlite3 "$OUT" 'SELECT COUNT(*) FROM players;')"
if [ "$PLAYERS" -lt 1 ]; then
  echo "ОШИБКА: в копии нет игроков, не отправляю"; rm -f "$OUT"; exit 1
fi
echo "  копия проверена: игроков $PLAYERS, целостность ok"

gzip -f "$OUT"
OUT="$OUT.gz"

# Отправка на другой хост
if scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$OUT" "$REMOTE/" 2>/dev/null; then
  echo "  отправлено: $REMOTE/$(basename "$OUT")"
else
  echo "  ⚠ ОТПРАВКА НЕ УДАЛАСЬ — копия осталась только локально: $OUT"
fi

# Ротация локальных вывезенных копий
ls -1t "$OUT_DIR"/offsite-*.db.gz 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)) | xargs -r rm -f

echo "[$(date '+%F %T')] Готово. Размер: $(du -h "$OUT" | cut -f1)"
