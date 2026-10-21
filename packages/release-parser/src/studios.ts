import type { VoiceType } from './types.ts'

export interface Studio {
  /** Каноническое имя: оно попадает в `AudioTrack.studio`. */
  name: string
  /** Другие написания. Само имя и его вариант без пробелов добавлять не нужно. */
  aliases?: string[]
  /** Тип перевода, если студия делает только его; иначе тип берётся из названия раздачи. */
  type?: VoiceType
}

/**
 * Словарь студий озвучки и авторов перевода. Это данные: новую студию или
 * написание добавляют сюда, правила трогать не нужно.
 */
export const studios: Studio[] = [
  // Закадровый многоголосый
  { name: 'LostFilm', aliases: ['Lost Film', 'LostFilm.TV'], type: 'MVO' },
  { name: 'NewStudio', aliases: ['New Studio'], type: 'MVO' },
  { name: 'TVShows', aliases: ['TV Shows'], type: 'MVO' },
  {
    name: 'HDRezka Studio',
    aliases: ['HDRezka', 'Rezka', 'HDrezka Studio'],
    type: 'MVO',
  },
  {
    name: 'Кубик в Кубе',
    aliases: ['Kubik v Kube', 'Кубик в кубе', 'KvK'],
    type: 'MVO',
  },
  { name: 'AlexFilm', aliases: ['Alex Film'], type: 'MVO' },
  { name: 'Jaskier', aliases: ['Яскьер'], type: 'MVO' },
  { name: 'BaibaKo', aliases: ['Baibako'], type: 'MVO' },
  {
    name: 'Кураж-Бамбей',
    aliases: ['Kurazh-Bambey', 'Кураж Бамбей', 'Kurazh Bambey'],
    type: 'MVO',
  },
  { name: 'Amedia', aliases: ['Амедиа'], type: 'MVO' },
  { name: 'NovaFilm', aliases: ['Nova Film'], type: 'MVO' },
  { name: 'ColdFilm', aliases: ['Cold Film'], type: 'MVO' },
  { name: 'IdeaFilm', aliases: ['Idea Film'], type: 'MVO' },
  { name: 'GoodPeople', aliases: ['Good People'], type: 'MVO' },
  { name: 'Gears Media', type: 'MVO' },
  { name: 'SomeWax', type: 'MVO' },
  { name: 'Ultradox', type: 'MVO' },
  { name: 'Novamedia', aliases: ['Нова Медиа'], type: 'MVO' },
  { name: 'Paramount Comedy', type: 'MVO' },
  { name: 'Sony Sci-Fi', type: 'MVO' },
  { name: 'Первый канал', type: 'MVO' },
  { name: 'СТС', type: 'MVO' },
  { name: 'ТНТ', type: 'MVO' },
  { name: 'НТВ', type: 'MVO' },

  // Дубляж
  { name: 'Невафильм', aliases: ['Nevafilm'], type: 'D' },
  {
    name: 'Мосфильм-Мастер',
    aliases: ['Мосфильм Мастер', 'Mosfilm-Master'],
    type: 'D',
  },
  { name: 'SDI Media', aliases: ['SDI'], type: 'D' },
  { name: 'Iyuno-SDI', aliases: ['Iyuno', 'Iyuno SDI Group'], type: 'D' },
  { name: 'Cinelab SoundMix', aliases: ['Cinelab'], type: 'D' },
  { name: 'Кипарис', type: 'D' },

  // Делают и дубляж, и закадр: тип берётся из названия раздачи
  { name: 'Red Head Sound', aliases: ['RedHeadSound'] },
  { name: 'Пифагор', aliases: ['Pifagor'] },
  { name: 'Videofilm', aliases: ['Видеофильм'] },
  { name: 'Tak Treba', aliases: ['Tak Treba Production'] },

  // Авторский перевод
  {
    name: 'Гаврилов',
    aliases: ['Gavrilov', 'А. Гаврилов', 'Андрей Гаврилов'],
    type: 'AVO',
  },
  {
    name: 'Володарский',
    aliases: ['Volodarsky', 'Леонид Володарский', 'Л. Володарский'],
    type: 'AVO',
  },
  {
    name: 'Сербин',
    aliases: ['Serbin', 'Юрий Сербин', 'Ю. Сербин'],
    type: 'AVO',
  },
  { name: 'Живов', aliases: ['Zhivov', 'Юрий Живов', 'Ю. Живов'], type: 'AVO' },
  {
    name: 'Михалёв',
    aliases: ['Михалев', 'Mikhalev', 'Алексей Михалёв', 'Алексей Михалев'],
    type: 'AVO',
  },
  { name: 'Карцев', aliases: ['Kartsev'], type: 'AVO' },
  { name: 'Горчаков', aliases: ['Gorchakov'], type: 'AVO' },
  { name: 'Яроцкий', aliases: ['Yarotsky'], type: 'AVO' },
  { name: 'Визгунов', aliases: ['Vizgunov'], type: 'AVO' },
  { name: 'Дохалов', aliases: ['Dokhalov'], type: 'AVO' },
  { name: 'Гоблин', aliases: ['Goblin', 'Пучков', 'Д. Пучков'], type: 'AVO' },

  // Любительские, в основном аниме
  { name: 'AniLibria', aliases: ['AniLibria.TV', 'Анилибрия'], type: 'L' },
  { name: 'AniDub', type: 'L' },
  { name: 'AniMedia', type: 'L' },
  { name: 'SHIZA Project', aliases: ['SHIZA', 'Shiza Project'], type: 'L' },
  { name: 'AniStar', type: 'L' },
  { name: 'Dream Cast', aliases: ['DreamCast'], type: 'L' },
  { name: 'StudioBand', aliases: ['Studio Band'], type: 'L' },
  { name: 'Kansai Studio', aliases: ['Kansai'], type: 'L' },
  { name: 'ViruseProject', aliases: ['Viruse Project'], type: 'L' },
]

/** Ключ сравнения: регистр, `ё`, пробелы, точки и дефисы не важны. */
export function studioKey(value: string) {
  return value
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[\s.\-_]+/g, '')
}

const index = new Map<string, Studio>()
for (const studio of studios) {
  for (const alias of [studio.name, ...(studio.aliases ?? [])])
    index.set(studioKey(alias), studio)
}

export function findStudio(value: string): Studio | undefined {
  return index.get(studioKey(value))
}

/** Самое длинное число слов в одном написании: столько токенов смотрит поиск. */
export const studioMaxWords = Math.max(
  ...studios.flatMap(studio =>
    [studio.name, ...(studio.aliases ?? [])].map(
      alias => alias.split(/[\s.\-_]+/).length,
    ),
  ),
)
