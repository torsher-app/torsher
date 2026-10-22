#!/bin/sh
# Фавиконы из мастера assets/app-icon.svg в каталог $1 (public приложения).
# Нужны rsvg-convert (librsvg) и magick (ImageMagick 7): SVG рисует librsvg,
# свой SVG-рендер ImageMagick теряет скругления и толщину линий.
set -eu

out="$1"
src="$(dirname "$0")/../assets/app-icon.svg"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cp "$src" "$out/favicon.svg"
rsvg-convert -w 180 -h 180 "$src" -o "$out/apple-touch-icon.png"

for size in 16 32 48; do
  rsvg-convert -w "$size" -h "$size" "$src" -o "$tmp/$size.png"
done

magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" "$out/favicon.ico"
