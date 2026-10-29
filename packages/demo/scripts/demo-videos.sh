#!/bin/sh
# Собирает ролики плеера демо витрины: media/<фильм>-demo.mp4.
#
# Длина ролика — как у фильма, но кадры идут только кусок с позиции 5:12, с
# которой демо запускает плеер. До и после куска — чёрный экран без звука с
# надписью, что это урезанный ролик демо и где кусок начинается и кончается:
# иначе тишину легко принять за поломку. Чёрные части идут с частотой 1 кадр/с
# и почти ничего не весят: ролик — 3–4 МБ, а шкала плеера настоящая.
#
# Фильмы — открытые фильмы Blender Foundation под CC BY 3.0:
#   Sintel          https://durian.blender.org/sharing/
#   Big Buck Bunny  https://peach.blender.org/about/
#   Tears of Steel  https://mango.blender.org/sharing/
# Sintel и Tears of Steel ffmpeg читает с download.blender.org кусками.
# Big Buck Bunny там лежит только в zip, поэтому архив (около 420 МБ)
# качается целиком во временный каталог и удаляется после сборки. Сервер
# отвечает 429 на частые запросы, поэтому фильмы качаются по очереди.
#
#   sh scripts/demo-videos.sh [sintel|bbb|tos ...]
set -e

DIR=$(cd "$(dirname "$0")/.." && pwd)
RESUME=312
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

clock() {
  printf '%d:%02d' $(($1 / 60)) $(($1 % 60))
}

# Две строки по центру чёрного кадра. Текст — из файлов: так двоеточия в
# «5:12» не надо экранировать в графе фильтров
caption() {
  printf '%s' "$2" >"$TMP/$1-title.txt"
  printf '%s' "$3" >"$TMP/$1-note.txt"
  echo "drawtext=textfile=$TMP/$1-title.txt:fontcolor=white:fontsize=44:x=(w-text_w)/2:y=h/2-56,drawtext=textfile=$TMP/$1-note.txt:fontcolor=0x9aa0aa:fontsize=26:x=(w-text_w)/2:y=h/2+12"
}

# build <имя> <название> <источник> <начало куска, с> <длина куска, с> <длина фильма, с>
build() {
  name=$1 title=$2 source=$3 from=$4 len=$5 total=$6
  end=$((RESUME + len))
  tail=$((total - end))
  span="$(clock $RESUME)–$(clock $end)"
  before=$(caption before "Demo clip of $title" "The film plays from $(clock $RESUME) to $(clock $end). The rest of the timeline is blank.")
  after=$(caption after "End of the demo clip" "Only $len seconds of $title ($span) are included in the demo.")

  ffmpeg -loglevel error -y \
    -f lavfi -i "color=black:size=1280x720:rate=1:duration=$RESUME" \
    -f lavfi -i "anullsrc=r=48000:cl=stereo:d=$RESUME" \
    -ss "$from" -t "$len" -i "$source" \
    -f lavfi -i "color=black:size=1280x720:rate=1:duration=$tail" \
    -f lavfi -i "anullsrc=r=48000:cl=stereo:d=$tail" \
    -filter_complex "[0:v]$before,settb=1/24[v0];[2:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1,settb=1/24[v2];[3:v]$after,settb=1/24[v3];[2:a]aresample=48000,aformat=channel_layouts=stereo[a2];[v0][1:a][v2][a2][v3][4:a]concat=n=3:v=1:a=1[v][a]" \
    -map "[v]" -map "[a]" -map_metadata -1 -map_chapters -1 -fps_mode passthrough \
    -c:v libx264 -preset slow -tune film -crf 24 -maxrate 1000k -bufsize 2000k \
    -pix_fmt yuv420p -profile:v high -level 4.0 -g 240 -keyint_min 24 \
    -c:a aac -b:a 64k -movflags +faststart "$DIR/media/$name-demo.mp4"
}

for film in ${@:-sintel bbb tos}; do
  case $film in
    sintel) build sintel Sintel https://download.blender.org/durian/movies/Sintel.2010.1080p.mkv 280 26 888 ;;
    bbb)
      curl -sS -o "$TMP/bbb.zip" https://download.blender.org/peach/bigbuckbunny_movies/big_buck_bunny_720p_h264.mov.zip
      unzip -q -o "$TMP/bbb.zip" -d "$TMP"
      build bbb 'Big Buck Bunny' "$TMP/big_buck_bunny_720p_h264.mov" 392 26 596
      ;;
    tos) build tos 'Tears of Steel' https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov 283 24 734 ;;
    *) echo "Unknown film: $film" >&2; exit 1 ;;
  esac
done
