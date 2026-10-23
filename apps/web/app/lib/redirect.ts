/**
 * Путь витрины, куда вернуться после входа (`?next=`):
 * витрина на ТВ отправляет сюда войти и ждёт обратно. Только путь от корня:
 * `//host` и `/\host` браузер понял бы как другой сайт.
 */
export function returnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/'))
    return null

  return /^\/[/\\]/.test(value) ? null : value
}
