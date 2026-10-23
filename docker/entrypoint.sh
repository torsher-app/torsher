#!/bin/sh
# Готовит /data и запускает сервер от PUID:PGID. Контейнер стартует от root
# только для того, чтобы отдать каталог базы этому пользователю: на NAS
# владелец томов — пользователь хоста, а не uid из образа.
set -eu

data_dir=/data
db_dir=$(dirname "$DATABASE_PATH")
downloads_dir=${DOWNLOADS_PATH:-$data_dir/torrents}
library_dir=${LIBRARY_PATH:-$data_dir/library}

fail() {
  echo "torsher: $*" >&2
  exit 1
}

case "$PUID$PGID" in
  *[!0-9]*) fail "PUID and PGID must be numeric (got PUID=$PUID PGID=$PGID)" ;;
esac

mkdir -p "$db_dir" "$downloads_dir" "$library_dir" 2>/dev/null || true

if [ "$(id -u)" = 0 ]; then
  # Рекурсивно — только каталог базы: в /data лежат загрузки и библиотека,
  # обходить их при каждом старте долго. На сетевых томах root может не иметь
  # права на chown — тогда решает проверка записи ниже
  chown "$PUID:$PGID" "$data_dir" "$downloads_dir" "$library_dir" 2>/dev/null || true
  chown -R "$PUID:$PGID" "$db_dir" 2>/dev/null || true
  run_as="setpriv --reuid=$PUID --regid=$PGID --clear-groups"
  user="$PUID:$PGID"
else
  run_as=""
  user="$(id -u):$(id -g)"
fi

for dir in "$db_dir" "$downloads_dir" "$library_dir"; do
  if ! $run_as test -w "$dir"; then
    fail "$dir is not writable by $user; check the owner of the /data volume or set PUID and PGID"
  fi
done

# После сброса привилегий HOME остался бы /root, куда пользователю не
# записать: всё, что пишет в ~/.cache, падало бы. Каталог базы переживает
# перезапуск контейнера
export HOME="$db_dir"

# Ключ подписи сессий: без явного SECRET_KEY создаётся один раз и живёт
# рядом с базой, иначе после перезапуска все входы бы сбрасывались
if [ -z "${SECRET_KEY:-}" ]; then
  key_file="$db_dir/session.key"

  if [ ! -s "$key_file" ]; then
    $run_as sh -c "umask 077 && node -e \"process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))\" > '$key_file'"
  fi

  SECRET_KEY=$(cat "$key_file")
  export SECRET_KEY
fi

exec $run_as "$@"
