import type { Follow, FollowAudio } from '../../db/schema.ts'
import { followAudios } from '../../db/schema.ts'
import { followSettings, saveFollowSettings } from './settings.ts'

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
 * язык, который распознаёт парсер названий, — он, остальные — оригинал
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

  return language && language !== 'original' && isFollowAudio(language)
    ? language
    : 'original'
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

    saveFollowSettings({
      audio: { value: audioFromLanguage(acceptLanguage), source: 'auto' },
    })
  }

  serverAudioKnown = true
}

/** Для тестов: следующий запрос снова проверит настройку */
export function resetServerAudioGuess() {
  serverAudioKnown = false
}
