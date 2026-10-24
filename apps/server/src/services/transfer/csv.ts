const DELIMITERS = [',', ';', '\t'] as const

/** Разделитель — тот, которого больше всего в строке заголовка вне кавычек */
function detectDelimiter(text: string) {
  const counts = new Map<string, number>(DELIMITERS.map(item => [item, 0]))
  let quoted = false

  for (const char of text) {
    if (char === '"')
      quoted = !quoted
    else if (!quoted && (char === '\n' || char === '\r'))
      break
    else if (!quoted && counts.has(char))
      counts.set(char, counts.get(char)! + 1)
  }

  return [...counts].sort((a, b) => b[1] - a[1])[0]![0]
}

/**
 * CSV по RFC 4180: поля в кавычках с переводами строк и `""` внутри, CRLF,
 * BOM в начале. Пустые строки пропускаются.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  function endRow() {
    row.push(field)
    field = ''

    if (row.length > 1 || row[0] !== '')
      rows.push(row)

    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!

    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      }
      else if (char === '"') {
        quoted = false
      }
      else {
        field += char
      }
    }
    else if (char === '"' && field === '') {
      quoted = true
    }
    else if (char === delimiter) {
      row.push(field)
      field = ''
    }
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n')
        i++

      endRow()
    }
    else {
      field += char
    }
  }

  if (field !== '' || row.length > 0)
    endRow()

  return rows
}

/** Строки как объекты по заголовку; имена столбцов — без крайних пробелов */
export function csvRecords(input: string) {
  const [header, ...rows] = parseCsv(input)

  if (!header)
    return { columns: [] as string[], records: [] as Record<string, string>[] }

  const columns = header.map(name => name.trim())
  const records = rows.map(row =>
    Object.fromEntries(
      columns.map((name, index) => [name, (row[index] ?? '').trim()]),
    ),
  )

  return { columns, records }
}
