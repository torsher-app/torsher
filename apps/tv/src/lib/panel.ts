/**
 * Адрес в панели того же сервера: она лежит в `panel/` рядом с витриной.
 * Считается от базы витрины, а не от пути страницы: так он верен за обратным
 * прокси с подпутём и не уходит вглубь, если витрину открыли на чужом пути.
 * `base` сборки — `./` (каталог страницы), на dev-сервере Vite — `/`.
 */
export function panelUrl(
  path: string,
  href: string,
  base = import.meta.env.BASE_URL,
) {
  return new URL(`panel/${path}`, new URL(base, href))
}
