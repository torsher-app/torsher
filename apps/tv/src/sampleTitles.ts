// Заглушка каталога: экраны витрины собираются раньше, чем сервер научится ходить в TMDB
export interface SampleTitle {
  id: string
  title: string
  originalTitle: string
  year: number
  kind: 'movie' | 'series'
  overview: string
  color: string
}

export const sampleTitles: SampleTitle[] = [
  {
    id: 'dune-2',
    title: 'Дюна: Часть вторая',
    originalTitle: 'Dune: Part Two',
    year: 2024,
    kind: 'movie',
    overview:
      'Пол Атрейдес объединяется с фрименами и идёт войной на тех, кто уничтожил его семью.',
    color: '#8a5a2b',
  },
  {
    id: 'severance',
    title: 'Разделение',
    originalTitle: 'Severance',
    year: 2022,
    kind: 'series',
    overview:
      'Сотрудники корпорации проходят процедуру, разделяющую воспоминания о работе и личной жизни.',
    color: '#2b5a8a',
  },
  {
    id: 'shogun',
    title: 'Сёгун',
    originalTitle: 'Shōgun',
    year: 2024,
    kind: 'series',
    overview:
      'Английский моряк оказывается в Японии в разгар борьбы за власть между даймё.',
    color: '#7a2b2b',
  },
  {
    id: 'the-bear',
    title: 'Медведь',
    originalTitle: 'The Bear',
    year: 2022,
    kind: 'series',
    overview:
      'Молодой шеф возвращается в Чикаго, чтобы спасти семейную закусочную.',
    color: '#2b7a4f',
  },
  {
    id: 'oppenheimer',
    title: 'Оппенгеймер',
    originalTitle: 'Oppenheimer',
    year: 2023,
    kind: 'movie',
    overview: 'История физика, руководившего созданием атомной бомбы.',
    color: '#5a4a2b',
  },
  {
    id: 'arcane',
    title: 'Аркейн',
    originalTitle: 'Arcane',
    year: 2021,
    kind: 'series',
    overview:
      'Две сестры оказываются по разные стороны конфликта между Пилтовером и Зауном.',
    color: '#5a2b7a',
  },
]
