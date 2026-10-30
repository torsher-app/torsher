import type { Follow, FollowAudio } from '../../db/schema.ts'
import type { ServerAudio } from './settings.ts'
import { and, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followAudios, followEpisodes, follows } from '../../db/schema.ts'
import { followSettings, saveServerAudio } from './settings.ts'

// Пока сервер не знает языка зрителей, действует прежняя русская модель
const FALLBACK_AUDIO: FollowAudio = 'ru'

// Значение сервера уже есть: подстановке на запросах в базу ходить незачем
let serverAudioKnown = false

function isFollowAudio(value: string): value is FollowAudio {
  return (followAudios as readonly string[]).includes(value)
}

/** Язык озвучки сервера: заданный или подобранный, иначе `ru` */
export function serverAudio(): FollowAudio {
  return followSettings().audio?.value ?? FALLBACK_AUDIO
}

/** Действующий язык слежения: своё правило, иначе язык сервера на сейчас */
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
      ),
    )
    .run()
  db.update(follows)
    .set({ nextSearchAt: null })
    .where(inArray(follows.id, followIds))
    .run()
}

/** Язык сервера; слежения без своего правила, чей язык сменился, решают заново */
export function setServerAudio(audio: ServerAudio) {
  const before = serverAudio()

  saveServerAudio(audio)

  if (audio.value === before)
    return

  forgetAudioPending(
    getDb()
      .select({ id: follows.id })
      .from(follows)
      .where(isNull(follows.audio))
      .all()
      .map(row => row.id),
  )
}

/**
 * Первый авторизованный запрос подбирает язык озвучки сервера по языку
 * браузера или устройства. Только если значения ещё нет: выбор владельца и
 * прежняя догадка не перезаписываются.
 */
export function guessServerAudio(acceptLanguage: string | undefined) {
  if (serverAudioKnown)
    return

  if (!followSettings().audio) {
    if (!acceptLanguage)
      return

    setServerAudio({
      value: audioFromLanguage(acceptLanguage),
      source: 'auto',
    })
  }

  serverAudioKnown = true
}

/** Для тестов: следующий запрос снова проверит настройку */
export function resetServerAudioGuess() {
  serverAudioKnown = false
}
