/**
 * Копирует текст. `navigator.clipboard` есть только на HTTPS и localhost, а
 * сервер в домашней сети открывают по `http://` — там копирует выделенное
 * поле через `execCommand`. `false` — браузер не дал скопировать.
 */
export async function copyText(text: string) {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)

      return true
    }
    catch {
      // Ниже — запасной путь
    }
  }

  // Выделение уводит DOM-фокус в поле: после копирования он возвращается
  const active = document.activeElement as HTMLElement | null
  const field = document.createElement('textarea')

  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()

  try {
    return document.execCommand('copy')
  }
  catch {
    return false
  }
  finally {
    document.body.removeChild(field)
    active?.focus()
  }
}
