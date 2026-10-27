#!/bin/sh
# Баннер лаунчера Android TV (320×180, xhdpi) и иконки приложения из мастера
# @torsher/tokens/assets/app-icon.svg. Нужны rsvg-convert и magick (ImageMagick 7).
set -eu

cd "$(dirname "$0")/.."
icon="../../packages/tokens/assets/app-icon.svg"
res="app/src/main/res"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$res/mipmap-xhdpi" "$res/mipmap-xxhdpi" "$res/drawable-xhdpi"
rsvg-convert -w 96 -h 96 "$icon" -o "$res/mipmap-xhdpi/ic_launcher.png"
rsvg-convert -w 144 -h 144 "$icon" -o "$res/mipmap-xxhdpi/ic_launcher.png"

# Баннер: горящий знак и название на фоне витрины; текст — внутри картинки,
# лаунчер подписи к баннеру не добавляет
rsvg-convert -w 112 -h 112 "$icon" -o "$tmp/icon.png"
magick -size 320x180 xc:'#0b0d12' \
  "$tmp/icon.png" -geometry +24+34 -composite \
  -font "$res/font/onest.ttf" -pointsize 46 -fill '#e8b84a' \
  -gravity West -annotate +142+0 'Torsher' \
  -strip "$res/drawable-xhdpi/banner.png"
