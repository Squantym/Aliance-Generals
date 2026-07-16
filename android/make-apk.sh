#!/usr/bin/env bash
# ===================================================================
# make-apk.sh — сборка установщика игры (.apk) для прямой раздачи
#
# Собирает APK-обёртку (TWA) вокруг сайта игры. Google Play не нужен —
# готовый файл раздаёшь сам (сайт, Telegram и т.п.).
#
# ЗАПУСК:   ./make-apk.sh generals.example.ru
#           (домен — тот же, что в APP_URL, обязательно с HTTPS)
#
# ЧТО НУЖНО НА МАШИНЕ: Node.js 18+ и интернет (скачает JDK и Android SDK
# сам, ~1.5 ГБ в первый раз). Java ставить вручную не обязательно.
# ===================================================================
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "❌ Укажи домен: ./make-apk.sh generals.example.ru"
  exit 1
fi
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"

cd "$(dirname "$0")"
echo "🌐 Домен: $DOMAIN"

# ── 1. Проверки ────────────────────────────────────────────────────
command -v node >/dev/null || { echo "❌ Нужен Node.js 18+"; exit 1; }

echo "🔎 Проверяю, что манифест доступен по HTTPS…"
if ! curl -sSf "https://$DOMAIN/manifest.json" -o /dev/null; then
  echo "❌ https://$DOMAIN/manifest.json недоступен."
  echo "   Сначала задеплой игру и убедись, что на домене работает HTTPS."
  exit 1
fi

# ── 2. Конфиг из шаблона (подставляем домен) ───────────────────────
if [ ! -f twa-manifest.json ]; then
  echo "📝 Готовлю twa-manifest.json из шаблона…"
  sed "s/ЗАМЕНИ_НА_ДОМЕН/$DOMAIN/g" twa-manifest.template.json > twa-manifest.json
else
  echo "📝 twa-manifest.json уже есть — использую его (правь версию там)."
fi

BW="npx --yes @bubblewrap/cli"

# ── 3. Первичная инициализация проекта ─────────────────────────────
# Bubblewrap спросит пароль для нового keystore — ЗАПОМНИ ЕГО.
# Тем же ключом придётся подписывать все будущие обновления, иначе
# игроки не смогут поставить новую версию поверх старой.
if [ ! -f gradlew ]; then
  echo "🚀 Первый запуск: разворачиваю Android-проект (скачает JDK+SDK, это долго)…"
  $BW init --manifest="https://$DOMAIN/manifest.json" --directory=.
fi

# ── 4. Сборка ──────────────────────────────────────────────────────
echo "🔨 Собираю APK…"
$BW build --skipPwaValidation

# ── 5. assetlinks.json — иначе в приложении будет видна адресная строка
echo "🔗 Генерирую assetlinks.json (привязка APK к домену)…"
mkdir -p ../public/.well-known
$BW fingerprint generateAssetLinks --output=../public/.well-known/assetlinks.json || {
  echo "⚠️  Не удалось сгенерировать автоматически. Возьми отпечаток командой:"
  echo "    keytool -list -v -keystore android.keystore -alias generals"
  echo "    и впиши SHA-256 в public/.well-known/assetlinks.json"
}

APK=$(ls -1 app-release-signed.apk 2>/dev/null || ls -1 ./*.apk 2>/dev/null | head -1 || true)
echo ""
echo "═══════════════════════════════════════════════"
echo "✅ Готово. Установщик: android/${APK:-app-release-signed.apk}"
echo ""
echo "ДАЛЬШЕ (обязательно, по порядку):"
echo " 1. Задеплой сайт — assetlinks.json должен открываться:"
echo "    https://$DOMAIN/.well-known/assetlinks.json"
echo " 2. Только ПОСЛЕ этого раздавай .apk игрокам."
echo "    Если пропустить шаг 1 — в приложении сверху будет адресная строка."
echo " 3. Игроки: Настройки → разрешить установку из этого источника."
echo ""
echo "⚠️  СОХРАНИ android.keystore и пароль от него в надёжном месте!"
echo "    Потеряешь — не сможешь выпускать обновления: игрокам придётся"
echo "    удалять игру и ставить заново."
echo "═══════════════════════════════════════════════"
