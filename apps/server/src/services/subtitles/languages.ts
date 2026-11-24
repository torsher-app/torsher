import { trackLanguage } from '../media/trackPreferences.ts'

export const subtitleLanguages = [
  'ar',
  'bg',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fa',
  'fi',
  'fr',
  'he',
  'hi',
  'hr',
  'hu',
  'id',
  'is',
  'it',
  'ja',
  'ko',
  'lt',
  'lv',
  'ms',
  'nl',
  'no',
  'pl',
  'pt-br',
  'pt-pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sr',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh-cn',
  'zh-tw',
] as const
export type SubtitleLanguage = (typeof subtitleLanguages)[number]

const aliases: Record<string, SubtitleLanguage> = {
  por: 'pt-pt',
  pt: 'pt-pt',
  pob: 'pt-br',
  pb: 'pt-br',
  br: 'pt-br',
  zho: 'zh-cn',
  zh: 'zh-cn',
  chi: 'zh-cn',
  cht: 'zh-tw',
  zht: 'zh-tw',
  chs: 'zh-cn',
}

const mediaCodes: Record<SubtitleLanguage, string> = {
  'ar': 'ara',
  'bg': 'bul',
  'ca': 'cat',
  'cs': 'ces',
  'da': 'dan',
  'de': 'deu',
  'el': 'ell',
  'en': 'eng',
  'es': 'spa',
  'et': 'est',
  'fa': 'fas',
  'fi': 'fin',
  'fr': 'fra',
  'he': 'heb',
  'hi': 'hin',
  'hr': 'hrv',
  'hu': 'hun',
  'id': 'ind',
  'is': 'isl',
  'it': 'ita',
  'ja': 'jpn',
  'ko': 'kor',
  'lt': 'lit',
  'lv': 'lav',
  'ms': 'msa',
  'nl': 'nld',
  'no': 'nor',
  'pl': 'pol',
  'pt-br': 'pt-br',
  'pt-pt': 'pt-pt',
  'ro': 'ron',
  'ru': 'rus',
  'sk': 'slk',
  'sl': 'slv',
  'sr': 'srp',
  'sv': 'swe',
  'th': 'tha',
  'tr': 'tur',
  'uk': 'ukr',
  'vi': 'vie',
  'zh-cn': 'zh-cn',
  'zh-tw': 'zh-tw',
}

export function subtitleLanguage(
  value: string | null | undefined,
): SubtitleLanguage | undefined {
  const code = value?.trim().toLowerCase().replace('_', '-')
  if (!code)
    return undefined
  return (
    aliases[code]
    ?? subtitleLanguages.find(
      language =>
        language === code || mediaCodes[language] === trackLanguage(code),
    )
  )
}
