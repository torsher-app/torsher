import { XMLParser } from 'fast-xml-parser'

// Элементы, которые бывают одиночными или повторяются: всегда массив,
// чтобы разбор не зависел от того, сколько их пришло
const ALWAYS_ARRAY = new Set([
  'category',
  'subcat',
  'indexer',
  'item',
  'torznab:attr',
])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: name => ALWAYS_ARRAY.has(name),
})

export type XmlNode = Record<string, unknown>

/** Бросает исключение, если тело не XML */
export function parseXml(body: string): XmlNode {
  if (!body.trimStart().startsWith('<'))
    throw new Error('Response is not XML')

  // Torznab не объявляет DTD, а свои сущности парсер раскрывает: ответ
  // раздувается в памяти во много раз. DTD парсер принимает на любой глубине,
  // а вырезание CDATA и комментариев обходится через атрибуты и PI, поэтому
  // проверяется весь текст, даже ценой отказа на `<!DOCTYPE` в описании
  if (/<!DOCTYPE/i.test(body))
    throw new Error('Response declares a DOCTYPE')

  return parser.parse(body, true) as XmlNode
}

export function child(node: unknown, name: string): XmlNode | undefined {
  if (typeof node !== 'object' || node === null)
    return undefined

  const value = (node as XmlNode)[name]

  return typeof value === 'object' && value !== null
    ? (value as XmlNode)
    : undefined
}

export function children(node: unknown, name: string): XmlNode[] {
  if (typeof node !== 'object' || node === null)
    return []

  const value = (node as XmlNode)[name]

  return Array.isArray(value)
    ? value.filter(
        (item): item is XmlNode => typeof item === 'object' && item !== null,
      )
    : []
}

/** Атрибут или текст дочернего элемента как строка */
export function text(node: unknown, name: string): string | undefined {
  if (typeof node !== 'object' || node === null)
    return undefined

  const value = (node as XmlNode)[name]

  if (typeof value === 'string')
    return value

  // Элемент с атрибутами: текст лежит в `#text`
  const inner = child(node, name)?.['#text']

  return typeof inner === 'string' ? inner : undefined
}
