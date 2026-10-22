/** Первая буква имени для аватара; эмодзи и составные символы не режутся */
export function initialOf(name: string) {
  const [first] = Array.from(name.trim())

  return first ? first.toLocaleUpperCase() : '?'
}
