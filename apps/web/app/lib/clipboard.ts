/**
 * Clipboard API есть только в защищённом контексте, а панель в LAN часто
 * открыта по `http://192.168.x.x`: там копируем через выделение текста.
 */
export async function copyText(text: string) {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text)
    return
  }

  const field = document.createElement('textarea')

  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()

  try {
    if (!document.execCommand('copy'))
      throw new Error('Copy command was rejected')
  }
  finally {
    field.remove()
  }
}
