#!/bin/sh
# Команды сервера внутри контейнера: docker exec -it torsher torsher reset-password
#
# docker exec запускает их от root, а база принадлежит PUID:PGID. Команда
# работает от того же пользователя, что и сервер: иначе SQLite мог бы создать
# рядом с базой файлы root, в которые сервер потом не запишет.
set -eu

cli=/app/server/src/cli.ts

if [ "$(id -u)" = 0 ]; then
  setpriv --reuid="$PUID" --regid="$PGID" --clear-groups node "$cli" "$@"
else
  node "$cli" "$@"
fi

# Журнал контейнера — вывод процесса 1, а docker exec туда не пишет. Факт
# сброса (без пароля) попадает в журнал сервера отсюда, пока есть права root
if [ "${1:-}" = reset-password ] && [ -w /proc/1/fd/1 ]; then
  printf '{"level":30,"time":%s,"msg":"Owner password was reset from the command line"}\n' \
    "$(date +%s%3N)" > /proc/1/fd/1 || true
fi
