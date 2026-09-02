#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# ВЫВОЗ КОПИЙ БАЗЫ ЗА ПРЕДЕЛЫ СЕРВЕРА
#
# Копии, лежащие на том же диске, что и база, — это не защита от потери
# данных: умрёт диск VDS — умрёт и база, и все копии рядом с ней.
# Этот скрипт делает целостную копию и отправляет её на ДРУГОЙ хост.
#
# ТРИ ВЕЩИ, КОТОРЫХ ЗДЕСЬ НЕ БЫЛО И ИЗ-ЗА КОТОРЫХ ВЫВОЗ БЕСПОЛЕЗЕН:
#   1. Проверка, что копия ДОЕХАЛА. Раньше успех scp считался успехом
#      вывоза. scp может завершиться с нулём, дописав обрезанный файл
#      (сеть отвалилась на середине, кончилось место на приёмнике).
#      Теперь сверяем sha256 на приёмнике с локальной суммой.
#   2. Проверка, что копия ОТКРЫВАЕТСЯ и в ней есть игроки — уже была,
#      оставлена и делается ДО отправки. Добавлена проверка, что данные
#      игроков читаются: битый JSON в колонке data — тоже потеря.
#   3. Отчёт, который ВИДНО. Раньше вывод уходил в лог, который никто
#      не читает: вывоз мог сломаться в марте, а узнали бы об этом при
#      первой аварии. Теперь скрипт пишет data/backups/offsite-status.json,
#      игра читает его и показывает в панели во вкладке «Техника».
#      Молчание больше не выглядит как успех.
#
# НАСТРОЙКА (один раз):
#   ssh-keygen -t ed25519 -f ~/.ssh/backup_key -N ''
#   ssh-copy-id -i ~/.ssh/backup_key.pub USER@BACKUP_HOST
#   ssh -i ~/.ssh/backup_key USER@BACKUP_HOST 'mkdir -p /backups/generals'
#
# ЗАПУСК ПО РАСПИСАНИЮ (каждый день в 4:30 по времени сервера):
#   crontab -e
#   30 4 * * * REMOTE=user@backup-host:/backups/generals /home/USER/Aliance-Generals/tools/backup-offsite.sh >> /var/log/generals-backup.log 2>&1
#
# КУДА ВЫВОЗИТЬ, если второго сервера нет:
#   REMOTE="local:/mnt/backup/generals" — примонтированный диск или
#   сетевая папка. Сверка суммы работает и в этом режиме. Это лучше,
#   чем ничего, но хуже отдельного хоста: сгоревший сервер уносит с
#   собой и примонтированное к нему хранилище.
#
# ПРОВЕРИТЬ, ЧТО ВСЁ РАБОТАЕТ, НИЧЕГО НЕ ОТПРАВЛЯЯ НАРУЖУ:
#   REMOTE="local:/tmp/backup-test" tools/backup-offsite.sh
#
# ШИФРОВАНИЕ (настоятельно рекомендуется):
#   В копии лежат почты и хеши паролей ВСЕХ игроков. На чужом хосте она
#   доступна тому, кто этим хостом владеет. Поэтому шифруем ДО отправки.
#
#   Один раз создать ключ и убрать его С ИГРОВОГО СЕРВЕРА:
#     openssl rand -base64 48 > ~/generals-backup.key
#     chmod 600 ~/generals-backup.key
#     # скопировать себе на компьютер и в надёжное место, затем
#     # оставить на сервере только для чтения скриптом
#   Запуск:
#     BACKUP_KEY_FILE=~/generals-backup.key REMOTE=... tools/backup-offsite.sh
#
#   ВАЖНО: ключ, лежащий рядом с копией, защищает только от «унесли
#   диск с приёмника». Держите копию ключа ОТДЕЛЬНО — потеряете ключ,
#   потеряете и все вывезенные копии, расшифровать их будет нечем.
#
#   Расшифровать:
#     openssl enc -d -aes-256-cbc -pbkdf2 -in ФАЙЛ.db.gz.enc \
#       -pass file:generals-backup.key | gunzip > restore.db
#
# КОДЫ ВЫХОДА: 0 — вывезено и сверено, 1 — копию сделать не удалось,
# 2 — копия сделана, но НЕ доехала (лежит только локально).
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

GAME_DIR="${GAME_DIR:-$HOME/Aliance-Generals}"
DB_FILE="${DB_FILE:-$GAME_DIR/data/generals.db}"
REMOTE="${REMOTE:-user@backup-host:/backups/generals}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/backup_key}"
KEEP_LOCAL="${KEEP_LOCAL:-7}"
KEEP_REMOTE="${KEEP_REMOTE:-30}"
# Ключ шифрования. Путь к файлу с парольной фразой; если не задан —
# копия уезжает открытой (скрипт об этом громко предупреждает).
BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-}"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
OUT_DIR="$GAME_DIR/data/backups"
STATUS="$OUT_DIR/offsite-status.json"
OUT="$OUT_DIR/offsite-$STAMP.db"

# Отчёт пишем ВСЕГДА, в том числе при аварийном выходе: панель должна
# показать «вывоз сломался», а не «данных нет».
write_status() {
  local ok="$1" file="$2" bytes="$3" players="$4" err="$5"
  mkdir -p "$OUT_DIR"
  cat > "$STATUS" <<JSON
{
  "at": $(date +%s)000,
  "ok": $ok,
  "file": "$file",
  "bytes": $bytes,
  "players": $players,
  "remote": "$(printf '%s' "$REMOTE" | sed 's/"/\\"/g')",
  "encrypted": ${ENCRYPTED:-false},
  "error": "$(printf '%s' "$err" | tr -d '\n' | sed 's/"/\\"/g')"
}
JSON
}
die() {
  echo "ОШИБКА: $1" >&2
  write_status false "" 0 0 "$1"
  exit 1
}

# Перечислить копии в каталоге, НЕ падая, если какой-то маски нет.
# Тонкость: включён pipefail, и `ls` с несовпавшей маской возвращает
# ошибку — она роняла весь скрипт на ротации, УЖЕ ПОСЛЕ успешной
# отправки. Наружу это выглядело как «вывоз не удался», отчёт не
# писался, и код выхода врал. Поэтому список берём мягко.
list_copies() {
  local dir="$1"
  { ls -1t "$dir"/offsite-*.db.gz "$dir"/offsite-*.db.gz.enc 2>/dev/null || true; }
}

echo "[$(date '+%F %T')] Начинаю вывоз копии базы"

command -v sqlite3 >/dev/null 2>&1 || die "не установлен sqlite3 (apt install sqlite3)"
[ -f "$DB_FILE" ] || die "базы нет по пути $DB_FILE"

mkdir -p "$OUT_DIR"

# Целостная копия НА ХОДУ — игру останавливать не нужно.
# .backup корректно работает с WAL, в отличие от простого cp: cp «на
# горячую» даёт файл без последних транзакций.
sqlite3 "$DB_FILE" ".backup '$OUT'" || die "sqlite3 .backup не смог создать копию"

# ── Проверка ПЕРЕД отправкой: копия, которая не открывается, — не копия
CHECK="$(sqlite3 "$OUT" 'PRAGMA integrity_check;' 2>&1 || echo 'не открылась')"
if [ "$CHECK" != "ok" ]; then
  rm -f "$OUT"
  die "копия повреждена ($CHECK), не отправляю"
fi
PLAYERS="$(sqlite3 "$OUT" 'SELECT COUNT(*) FROM players;' 2>/dev/null || echo 0)"
if [ "$PLAYERS" -lt 1 ]; then
  rm -f "$OUT"
  die "в копии нет игроков — вывозить нечего"
fi
# Пустая база формально целостна. Проверяем, что данные игроков читаются,
# а не только считаются: битый JSON в колонке data — это тоже потеря.
# Через игру такое не запишется (на players висят индексы по
# json_extract, и SQLite отвергает неразбираемый JSON на записи), но
# повреждение файла — диск, обрезанная запись — обойдёт эту защиту.
# Проверка стоит одну секунду и ловит именно такой случай.
BROKEN="$(sqlite3 "$OUT" 'SELECT COUNT(*) FROM players WHERE json_valid(data) = 0;' 2>/dev/null || echo 0)"
if [ "$BROKEN" != "0" ]; then
  rm -f "$OUT"
  die "у $BROKEN игроков испорчены данные — такую копию не отправляю"
fi
echo "  копия проверена: игроков $PLAYERS, целостность ok, битых записей нет"

gzip -f "$OUT"
OUT="$OUT.gz"

# ── ШИФРОВАНИЕ ПЕРЕД ОТПРАВКОЙ ───────────────────────────────────
# В копии лежат почты и хеши паролей всех игроков. Уезжает она на чужой
# хост, где хозяин — не мы. Поэтому шифруем здесь, а не «доверяем каналу»:
# scp защищает передачу, но не хранение.
if [ -n "$BACKUP_KEY_FILE" ]; then
  [ -f "$BACKUP_KEY_FILE" ] || die "файл ключа не найден: $BACKUP_KEY_FILE"
  [ -s "$BACKUP_KEY_FILE" ] || die "файл ключа пуст: $BACKUP_KEY_FILE"
  command -v openssl >/dev/null 2>&1 || die "не установлен openssl — шифровать нечем"

  ENC="$OUT.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "$OUT" -out "$ENC" -pass "file:$BACKUP_KEY_FILE" \
    || die "шифрование не удалось"

  # ПРОВЕРКА РАСШИФРОВКИ — обязательна. Зашифрованная копия, которая не
  # открывается обратно, хуже отсутствия копии: место занимает, а в
  # аварии бесполезна, и выясняется это в худший момент. Сверяем, что
  # расшифрованное побайтово совпадает с исходным.
  PLAIN_SUM="$(sha256sum "$OUT" | cut -d' ' -f1)"
  BACK_SUM="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$ENC" -pass "file:$BACKUP_KEY_FILE" 2>/dev/null | sha256sum | cut -d' ' -f1)"
  if [ "$PLAIN_SUM" != "$BACK_SUM" ]; then
    rm -f "$ENC"
    die "зашифрованная копия не расшифровывается обратно — не отправляю"
  fi

  rm -f "$OUT"          # открытую версию рядом не держим
  OUT="$ENC"
  ENCRYPTED=true
  echo "  зашифровано (AES-256), расшифровка проверена"
else
  echo "  ⚠ БЕЗ ШИФРОВАНИЯ: в копии почты и хеши паролей всех игроков." >&2
  echo "    Задайте BACKUP_KEY_FILE — см. шапку скрипта." >&2
fi

BASE="$(basename "$OUT")"
BYTES="$(stat -c %s "$OUT" 2>/dev/null || stat -f %z "$OUT")"
SUM="$(sha256sum "$OUT" | cut -d' ' -f1)"
echo "  готово к отправке: $BYTES байт, sha256 ${SUM:0:16}…"

# ── Отправка + СВЕРКА СУММЫ НА ПРИЁМНИКЕ ─────────────────────────
# Именно сверка отличает «вывоз» от «надежды на вывоз».
SENT=false
REMOTE_SUM=""

if [[ "$REMOTE" == local:* ]]; then
  # Примонтированный диск или сетевая папка
  DEST="${REMOTE#local:}"
  if mkdir -p "$DEST" 2>/dev/null && cp "$OUT" "$DEST/$BASE" 2>/dev/null; then
    sync 2>/dev/null || true
    REMOTE_SUM="$(sha256sum "$DEST/$BASE" | cut -d' ' -f1)"
    [ "$REMOTE_SUM" = "$SUM" ] && SENT=true
    list_copies "$DEST" | tail -n +$((KEEP_REMOTE + 1)) | xargs -r rm -f
  fi
else
  # Отдельный хост по ssh
  HOST="${REMOTE%%:*}"
  RDIR="${REMOTE#*:}"
  if scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
        "$OUT" "$REMOTE/" >/dev/null 2>&1; then
    REMOTE_SUM="$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
      "$HOST" "sha256sum '$RDIR/$BASE' 2>/dev/null | cut -d' ' -f1" 2>/dev/null || echo '')"
    [ "$REMOTE_SUM" = "$SUM" ] && SENT=true
    if [ "$SENT" = true ]; then
      ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$HOST" \
        "{ ls -1t '$RDIR'/offsite-*.db.gz '$RDIR'/offsite-*.db.gz.enc 2>/dev/null || true; } | tail -n +$((KEEP_REMOTE + 1)) | xargs -r rm -f" \
        >/dev/null 2>&1 || true
    fi
  fi
fi

# Локальная ротация — в любом случае, чтобы диск не заполнился копиями
list_copies "$OUT_DIR" | tail -n +$((KEEP_LOCAL + 1)) | xargs -r rm -f

if [ "$SENT" = true ]; then
  write_status true "$BASE" "$BYTES" "$PLAYERS" ""
  echo "[$(date '+%F %T')] Готово: $BASE доехал и сверен по sha256 ($REMOTE)"
  exit 0
fi

# Отправка не удалась. Копия осталась локально — это лучше, чем ничего,
# но защиты от смерти диска НЕТ, и отчёт говорит об этом прямо.
if [ -n "$REMOTE_SUM" ] && [ "$REMOTE_SUM" != "$SUM" ]; then
  MSG="файл доехал ИСПОРЧЕННЫМ: суммы не совпали (возможно, кончилось место на приёмнике)"
else
  MSG="не удалось отправить на $REMOTE — проверьте ключ, адрес и доступность хоста"
fi
write_status false "$BASE" "$BYTES" "$PLAYERS" "$MSG"
echo "[$(date '+%F %T')] ⚠ $MSG. Копия лежит локально: $OUT" >&2
exit 2
