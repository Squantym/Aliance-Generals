#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# tools/check-proxy.sh — почему сервер видит у всех игроков 127.0.0.1
#
# Игра стоит за nginx. Настоящий адрес игрока знает только nginx, и он
# обязан передать его дальше заголовком. Если этого нет, сервер видит
# адрес самого себя — у ВСЕХ. Тогда:
#   • в журнале входов у всех один адрес;
#   • проверка на мультоводов слепа (панель об этом прямо говорит);
#   • блокировка по адресу бессмысленна.
#
# Скрипт НИЧЕГО не меняет. Он находит боевой конфиг, показывает, в каких
# блоках заголовков не хватает, и печатает готовые строки для вставки.
#
# Запуск на сервере:  bash tools/check-proxy.sh
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

PORT="${GAME_PORT:-3000}"
# Папку конфигов можно подменить — это нужно тесту, который прогоняет
# скрипт на заведомо кривом и заведомо верном конфиге. Без такой
# возможности скрипт-диагност сам остался бы непроверенным.
NGDIR="${NGINX_DIR:-/etc/nginx}"
NEED_REAL='proxy_set_header X-Real-IP $remote_addr;'
NEED_FWD='proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;'
NEED_HOST='proxy_set_header Host $host;'

say()  { printf '%s\n' "$*"; }
head2() { printf '\n\033[1m%s\033[0m\n' "$*"; }

head2 "1. Есть ли nginx"
if ! command -v nginx >/dev/null 2>&1; then
  say "  nginx не найден в PATH."
  say "  Если игра открыта наружу напрямую (без прокси) — адреса должны"
  say "  приходить настоящими, и проблема в другом месте: покажите вывод"
  say "  «Проверка сети» из панели."
  exit 2
fi
say "  $(nginx -v 2>&1)"

head2 "2. Какие файлы конфигурации подключены"
CONF_MAIN="$(nginx -t 2>&1 | sed -n 's/.*configuration file \(.*\) test.*/\1/p' | head -1)"
[ -z "$CONF_MAIN" ] && CONF_MAIN=/etc/nginx/nginx.conf
say "  Главный: $CONF_MAIN"

# Собираем все файлы, где упоминается проксирование на порт игры.
FILES="$(grep -RIl --include='*.conf' --include='*' -e "proxy_pass.*:${PORT}" \
          "$NGDIR" 2>/dev/null | sort -u)"

if [ -z "$FILES" ]; then
  say "  ⚠ Ни в одном файле $NGDIR нет proxy_pass на порт ${PORT}."
  say "    Значит игру проксирует что-то другое (другой порт, Apache,"
  say "    балансировщик хостинга или Cloudflare Tunnel). Найдите, кто"
  say "    именно, и настройте передачу заголовка там же."
  exit 2
fi
say "  Проксируют игру:"
for f in $FILES; do say "    · $f"; done

head2 "3. Передаётся ли адрес игрока"
BAD=0
for f in $FILES; do
  has_real=$(grep -c 'proxy_set_header[[:space:]]\+X-Real-IP' "$f" 2>/dev/null || true)
  has_fwd=$(grep -c 'proxy_set_header[[:space:]]\+X-Forwarded-For' "$f" 2>/dev/null || true)
  n_pass=$(grep -c "proxy_pass.*:${PORT}" "$f" 2>/dev/null || true)
  say "  $f"
  say "    блоков proxy_pass: ${n_pass} · X-Real-IP: ${has_real} · X-Forwarded-For: ${has_fwd}"
  if [ "$has_real" -lt "$n_pass" ] || [ "$has_fwd" -lt "$n_pass" ]; then
    say "    ⛔ заголовков не хватает — адрес игрока сюда не доходит"
    BAD=1
  else
    say "    ✅ заголовки на месте"
  fi
done

head2 "4. Не мешает ли Cloudflare"
if grep -RIq 'cf-connecting-ip\|CF-Connecting-IP' "$NGDIR" 2>/dev/null; then
  say "  Упоминается CF-Connecting-IP — похоже, сайт за Cloudflare."
  say "  Игра этот заголовок понимает, отдельной настройки не нужно."
else
  say "  Следов Cloudflare нет — обычная схема с nginx."
fi

if [ "$BAD" -eq 0 ]; then
  head2 "Итог"
  say "  Конфигурация выглядит правильной."
  say "  Если панель всё равно показывает 127.0.0.1 — перечитайте конфиг:"
  say "      sudo nginx -t && sudo nginx -s reload"
  say "  и зайдите в игру заново: адрес записывается при входе."
  exit 0
fi

head2 "Что вставить"
say "  В КАЖДЫЙ блок location, где есть proxy_pass на порт ${PORT},"
say "  добавьте три строки:"
say ""
say "      ${NEED_HOST}"
say "      ${NEED_REAL}"
say "      ${NEED_FWD}"
say ""
say "  Затем проверить и перечитать:"
say "      sudo nginx -t && sudo nginx -s reload"
say ""
say "  Готовый пример целиком — nginx.example.conf в папке проекта."
say ""
say "  ВАЖНО: адреса начнут записываться с этого момента. У тех, кто"
say "  заходил раньше, останется старая запись, пока они не зайдут снова."
exit 1
