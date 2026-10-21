/** Хост адреса для списка: путь и схема только мешают сканировать */
export function hostOf(url: string) {
  try {
    return new URL(url).host
  }
  catch {
    return url
  }
}

/** Локаль i18n (`ru_RU`) в тег BCP 47 (`ru-RU`): `Intl` не принимает подчёркивание */
export function formatDateTime(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale.replace('_', '-'), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}
