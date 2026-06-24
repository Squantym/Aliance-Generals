#!/bin/bash
# ===================================================================
# optimize-images.sh — оптимизация изображений для минимума трафика
#
# Конвертирует PNG/JPG в WebP с оптимальным сжатием. WebP весит на
# 25-35% меньше JPEG и на 50-80% меньше PNG при том же качестве.
#
# Использование:
#   ./optimize-images.sh public/img/secret      # оптимизировать папку
#   ./optimize-images.sh public/img/new_photo.png  # один файл
#
# Требует: cwebp (пакет webp). Установка:
#   Ubuntu/Debian: sudo apt install webp
#   macOS:         brew install webp
# ===================================================================

QUALITY=82          # качество WebP (80-85 — оптимум: глаз не видит разницы)
MAX_WIDTH=1024      # максимальная ширина (картинки техники не нужны больше)

if ! command -v cwebp &> /dev/null; then
    echo "❌ cwebp не установлен. Установите: sudo apt install webp"
    exit 1
fi

optimize_file() {
    local src="$1"
    local ext="${src##*.}"
    local base="${src%.*}"
    local out="${base}.webp"

    # Уже webp и оптимального размера — пропускаем
    if [ "$ext" = "webp" ]; then
        echo "⏭  $src уже WebP"
        return
    fi

    cwebp -q $QUALITY -resize $MAX_WIDTH 0 "$src" -o "$out" 2>/dev/null
    if [ $? -eq 0 ]; then
        local old_size=$(du -h "$src" | cut -f1)
        local new_size=$(du -h "$out" | cut -f1)
        echo "✅ $src ($old_size) → $out ($new_size)"
    else
        echo "❌ Ошибка: $src"
    fi
}

TARGET="$1"
if [ -z "$TARGET" ]; then
    echo "Использование: $0 <папка_или_файл>"
    exit 1
fi

if [ -d "$TARGET" ]; then
    find "$TARGET" -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" \) | while read f; do
        optimize_file "$f"
    done
else
    optimize_file "$TARGET"
fi

echo ""
echo "✅ Готово! WebP-файлы созданы. Удалите оригиналы PNG/JPG если они больше не нужны."
