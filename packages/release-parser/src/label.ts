import type { AudioTrack } from './types.ts'
import { ParseContext } from './context.ts'
import { parseAudio } from './rules/audio.ts'
import { tokenize } from './tokenize.ts'

/**
 * Озвучка из названия дорожки внутри файла («MVO LostFilm», «Дубляж»,
 * «Многоголосый закадровый | NewStudio»): то же правило, что у хвоста
 * названия раздачи, но вся строка — хвост, названия тайтла в ней нет.
 */
export function parseAudioLabel(label: string): AudioTrack | undefined {
  const { audio } = parseAudio(new ParseContext(tokenize(label)), 0)
  // У одной дорожки одна озвучка: «Dub, Невафильм» — тип и студия одного голоса
  const withStudio = audio.find(track => track.studio)

  if (!withStudio)
    return audio[0]

  return { ...withStudio, type: withStudio.type ?? audio[0]?.type }
}
