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
# сброса (без пароля), подготовленного восстановления и импорта данных
# попадает в журнал сервера отсюда, пока есть права root
log_to_container() {
  if [ -w /proc/1/fd/1 ]; then
    printf '{"level":30,"time":%s,"msg":"%s"}\n' \
      "$(date +%s%3N)" "$1" > /proc/1/fd/1 || true
  fi
}

case "${1:-}" in
  reset-password) log_to_container 'Owner password was reset from the command line' ;;
  restore) log_to_container 'Restore from a backup was requested from the command line; it applies on the next start' ;;
  import)
    case " $* " in
      *" --dry-run "*) ;;
      *) log_to_container 'Data was imported from the command line' ;;
    esac
    ;;
esac
