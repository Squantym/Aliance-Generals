#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# ДЕПЛОЙ НА СЕРВЕРЕ — одна команда вместо шести
#
# Забирает код с GitHub, пересобирает и перезапускает игру. Сервер
# считается ТОЧНОЙ КОПИЕЙ репозитория: любые локальные правки в рабочем
# дереве сбрасываются. Именно из-за них `git pull` отказывался
# обновляться и на сервере месяцами жил старый код.
#
# База данных и настройки НЕ ТРОГАЮТСЯ: data/ и .env перечислены в
# .gitignore, а git не касается игнорируемых файлов.
#
# Запуск:
#   bash tools/deploy.sh                 — последнее из текущей ветки
#   bash tools/deploy.sh origin/main     — то же явно
#   bash tools/deploy.sh 9f3c1a2         — КОНКРЕТНАЯ версия
#
# Третья форма — та, ради которой скрипт умеет принимать аргумент:
# выкатывается ровно то, что проверено в тестовом мире, а не «последнее,
# что успело прилететь в ветку». Ею же делается откат: номер прежней
# версии печатается в конце каждого выката.
#
# Скрипт запускается и кнопкой из панели (src/services/release.ts).
# Оттуда приходит ТОЛЬКО номер версии, и он проверен по образцу дважды —
# в панели и здесь. Никакие строки из панели в оболочку как команды не
# попадают.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

GAME_DIR="${GAME_DIR:-$HOME/Aliance-Generals}"
PM2_NAME="${PM2_NAME:-generals-game}"
WANT="${1:-}"
STATUS="${DEPLOY_STATUS_FILE:-}"

cd "$GAME_DIR"

# ── Состояние для панели ────────────────────────────────────────────
# Пишем через временный файл и переименование: панель может читать в тот
# же момент, а разобрать оборванный JSON она не сможет.
set_state() {
  [ -n "$STATUS" ] || return 0
  python3 - "$STATUS" "$1" "${2:-}" <<'PY' 2>/dev/null || true
import json, sys, time, os
path, state, err = sys.argv[1:4]
try: d = json.load(open(path, encoding='utf-8'))
except Exception: d = {}
d['state'] = state
d['error'] = err
if state != 'идёт': d['finishedAt'] = int(time.time() * 1000)
tmp = path + '.tmp'
json.dump(d, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
os.replace(tmp, path)
PY
}

# Любой обрыв — это отказ. Без ловушки панель показывала бы «идёт»
# вечно, а владелец гадал бы, закончилось или зависло.
FAILED_AT='подготовка'
on_exit() {
  local code=$?
  if [ $code -ne 0 ]; then
    echo ""
    echo "⛔ ОШИБКА на шаге: $FAILED_AT (код $code)"
    echo "   Игра работает на прежней версии — она не перезапускалась."
    echo "   Снимите режим обслуживания в панели, когда убедитесь, что всё в порядке."
    set_state 'ошибка' "$FAILED_AT"
  fi
}
trap on_exit EXIT

# ── Проверка версии ─────────────────────────────────────────────────
if [ -n "$WANT" ] && ! [[ "$WANT" =~ ^([0-9a-f]{7,40}|origin/[A-Za-z0-9._/-]{1,60})$ ]]; then
  echo "⛔ Версия «$WANT» не похожа на номер коммита или origin/ветку"
  exit 2
fi

echo "[1/7] Проверяю, что настройки и база на месте"
FAILED_AT='проверка окружения'
[ -f .env ] && echo "      .env найден" || echo "      ⚠ .env НЕ найден — сервер не запустится без него"
[ -d data ] && echo "      data/ найдена ($(du -sh data | cut -f1))" || echo "      data/ пока нет (нормально до первого запуска)"

FROM="$(git rev-parse HEAD 2>/dev/null || echo '')"
[ -n "$FROM" ] || { echo "      ⛔ это не git-репозиторий"; exit 1; }
echo "      сейчас работает: ${FROM:0:8}"

echo "[2/7] Страховочная копия базы, если она своя (SQLite)"
FAILED_AT='копия базы'
if [ -f data/generals.db ] && command -v sqlite3 >/dev/null 2>&1; then
  mkdir -p data/backups
  BK="data/backups/pre-deploy-$(date +%Y-%m-%d_%H-%M-%S).db"
  sqlite3 data/generals.db ".backup '$BK'" && echo "      копия: $BK"
elif [ -f data/generals.db ]; then
  echo "      ⚠ база есть, но не установлен sqlite3 — страховочная копия НЕ создана"
  echo "        поставьте: apt install -y sqlite3"
else
  echo "      пропускаю (своей базы SQLite ещё нет)"
fi

echo "[3/7] Забираю код с GitHub"
FAILED_AT='получение кода'
git fetch origin --prune
if [ -z "$WANT" ]; then
  # Ветку определяем ДО переключения: после выката на конкретный коммит
  # HEAD откреплён, и symbolic-ref уже ничего не скажет.
  BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
  WANT="origin/$BRANCH"
  echo "      версия не указана — беру последнее из $WANT"
fi
TARGET="$(git rev-parse --verify "${WANT}^{commit}" 2>/dev/null || echo '')"
[ -n "$TARGET" ] || { echo "      ⛔ версия «$WANT» не найдена в репозитории"; exit 1; }

git reset --hard "$TARGET"
git clean -fd
echo "      выкатываю: $(git log --oneline -1)"

echo "[4/7] Зависимости"
FAILED_AT='установка зависимостей'
rm -rf node_modules dist
npm install

echo "[5/7] Сборка"
FAILED_AT='сборка'
# Сборка ДО перезапуска — принципиально. Упадёт здесь: игра продолжает
# работать на старой версии, потому что процесс ещё не трогали.
# Обратный порядок оставил бы игру без dist/, то есть лежачей.
npm run build
[ -f dist/server.js ] || { echo "      ⛔ dist/server.js не собрался — прерываю, игра не перезапущена"; exit 1; }
echo "      dist/server.js готов"

echo "[6/7] Перезапуск"
FAILED_AT='перезапуск'
set_state 'перезапуск'
# Процесса может не быть в списке pm2 — например, после перезагрузки
# сервера, если не выполнялся pm2 save. Тогда просто запускаем заново,
# а не падаем с «Process or Namespace not found».
if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  echo "      процесса «$PM2_NAME» нет в pm2 — запускаю заново"
  pm2 start dist/server.js --name "$PM2_NAME" --update-env
fi
pm2 save > /dev/null 2>&1 || true
pm2 list

echo "[7/7] Жду ответа сервера (до 60 секунд)"
FAILED_AT='проверка после перезапуска'
PORT="${PORT:-3000}"
CODE=000
for i in $(seq 1 30); do
  sleep 2
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/" || true)"
  [ "$CODE" = "200" ] && break
done

if [ "$CODE" != "200" ]; then
  echo "⚠ Сервер не ответил за 60 секунд (последний код '$CODE')."
  echo "  Логи: pm2 logs $PM2_NAME --lines 40 --nostream"
  echo "  Откат: bash tools/deploy.sh ${FROM:0:12}"
  exit 1
fi

echo ""
echo "✅ Готово: версия ${TARGET:0:8}, сервер отвечает 200"
echo ""
echo "   Откат при необходимости:  bash tools/deploy.sh ${FROM:0:12}"
echo ""
echo "   ⚠ Игра ЗАКРЫТА на обслуживание, если режим включался."
echo "     Проверьте её и откройте кнопкой в панели — сам скрипт двери"
echo "     не открывает: после обновления игра может не подняться, и"
echo "     тогда о поломке сообщили бы игроки."
set_state 'готово'
