/**
 * Путь, куда вернуться после входа: `?next=` — путь витрины (витрина на ТВ
 * отправляет сюда войти и ждёт обратно), `?redirect=` — страница панели,
 * с которой увёл `required-auth`. Только путь от корня:
 * `//host` и `/\host` браузер понял бы как другой сайт, а табы и переводы
 * строк он из URL выбрасывает, и `/<tab>/host` превратился бы в `//host`.
 */
export function returnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/'))
    return null

  // eslint-disable-next-line no-control-regex
  return /^\/[/\\]|[\x00-\x1F]/.test(value) ? null : value
}
