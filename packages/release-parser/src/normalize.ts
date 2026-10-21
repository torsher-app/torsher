const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

// Раздачи пишут транслит как придётся: `Odnazhdy`, `Odnajdi`, `Odnazhdi`.
// Ключ сводит такие варианты к одному написанию; порядок замен важен
const KEY_VARIANTS: [RegExp, string][] = [
  [/shch|sch/g, 'sh'],
  [/kh/g, 'h'],
  [/zh/g, 'j'],
  [/tz|ts/g, 'c'],
  [/x/g, 'ks'],
  [/w/g, 'v'],
  [/[jy](?=[aeiou])/g, ''],
  [/[iyj]+/g, 'i'],
  [/ck/g, 'k'],
  [/(.)\1+/g, '$1'],
]

/** Транслитерация кириллицы в латиницу по одной схеме; остальное без изменений. */
export function transliterate(text: string) {
  return [...text.toLowerCase()].map(char => TRANSLIT[char] ?? char).join('')
}

/**
 * Название для сравнения: нижний регистр, `ё` → `е`, без диакритики
 * и пунктуации, слова через один пробел.
 */
export function normalizeTitle(text: string) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Ключ названия независимо от письменности: «Однажды в России»
 * и «Odnazhdy v Rossii» дают один ключ. Только для сравнения, не для показа.
 */
export function titleKey(text: string) {
  let key = transliterate(normalizeTitle(text)).replace(/[^a-z0-9]/g, '')

  for (const [pattern, replacement] of KEY_VARIANTS)
    key = key.replace(pattern, replacement)

  return key
}
