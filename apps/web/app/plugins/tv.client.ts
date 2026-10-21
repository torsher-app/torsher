/**
 * Витрина на ТВ открывает вход в панель с `?platform=tv`. На экране
 * телевизора светлая тема слепит, а мелкие поля не попасть указкой:
 * тёмная тема (запоминается только в хранилище этого ТВ) и всё крупнее.
 */
export default defineNuxtPlugin(() => {
  if (new URLSearchParams(window.location.search).get('platform') !== 'tv')
    return

  useColorMode().preference = 'dark'
  document.documentElement.classList.add('tv')
})
