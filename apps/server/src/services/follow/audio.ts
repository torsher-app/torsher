import type { Follow, FollowAudio } from '../../db/schema.ts'
import type { ServerAudio } from './settings.ts'
import { and, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followAudios, followEpisodes, follows } from '../../db/schema.ts'
import {
  legacyAudioLanguages,
  saveSourceProfile,
  sourceProfile,
} from '../sources/profile.ts'
import { saveServerAudio } from './settings.ts'

// Без настройки предпочитаем оригинальную дорожку
const FALLBACK_AUDIO: FollowAudio = 'original'

function isFollowAudio(value: string): value is FollowAudio {
  return (followAudios as readonly string[]).includes(value)
}

/** Язык озвучки сервера: заданный или подобранный, иначе `original` */
export function serverAudio(): FollowAudio {
  return sourceProfile().audioLanguages[0] ?? FALLBACK_AUDIO
}

/** Действующий язык слежения: своё правило, иначе язык сервера на сейчас */
export function followSourceProfile(
  follow: Pick<Follow, 'audio' | 'requireRussian'>,
) {
  const profile = sourceProfile()
  const audioLanguages = follow.audio
    ? follow.audio === 'original' || follow.audio === 'ru'
      ? [follow.audio]
      : [follow.audio, 'original' as const]
    : [...profile.audioLanguages]
  // Explicit legacy rule permits original fallback when Russian is not required.
  if (
    follow.audio === 'ru'
    && !follow.requireRussian
    && !audioLanguages.includes('original')
  ) {
    audioLanguages.push('original')
  }
  return { ...profile, audioLanguages }
}

export function followAudio(follow: Pick<Follow, 'audio'>): FollowAudio {
  return follow.audio ?? serverAudio()
}

/**
 * Озвучка по первому языку `Accept-Language` или `navigator.language`:
 * язык, который распознаёт парсер названий, — он, остальные — оригинал.
 * Английский тоже даёт оригинал: англоязычные раздачи тег ENG обычно не
 * пишут, и аниме или дорамы ждали бы окно ради него. `en` — только ручной
 * выбор.
 */
export function audioFromLanguage(header: string | undefined): FollowAudio {
  const first = header
    ?.split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params
        .map(param => param.trim())
        .find(param => param.startsWith('q='))

      return { tag, q: q ? Number(q.slice(2)) : 1, index }
    })
    .filter(item => item.tag && item.tag !== '*' && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)[0]
  const language = first?.tag.split('-')[0]!.toLowerCase()

  return language
    && language !== 'original'
    && language !== 'en'
    && isFollowAudio(language)
    ? language
    : 'original'
}

/**
 * Действующий язык слежений сменился: отложенные кандидаты выбраны по
 * прежнему и снимаются, иначе по концу окна их захватили бы без нового
 * решения. Первое появление серии остаётся — окно не начинается сначала;
 * планировщик смотрит слежения заново.
 */
export function forgetAudioPending(followIds: string[]) {
  if (!followIds.length)
    return

  const db = getDb()

  db.update(followEpisodes)
    .set({ pending: null, waitUntil: null, stateNote: null })
    .where(
      and(
        inArray(followEpisodes.followId, followIds),
        isNotNull(followEpisodes.pending),
        isNull(followEpisodes.torrentId),
        isNull(followEpisodes.picked),
      ),
    )
    .run()
  db.update(follows)
    .set({ lastSearchAt: null, nextSearchAt: null })
    .where(inArray(follows.id, followIds))
    .run()
}

/** Язык сервера; слежения без своего правила, чей язык сменился, решают заново */
export function setServerAudio(audio: ServerAudio) {
  saveSourceProfile({ audioLanguages: legacyAudioLanguages(audio.value) })
  saveServerAudio(audio)
}
