import type { Language } from '@torsher/i18n'
import type { Follow, FollowPendingCandidate } from '../../db/schema.ts'
import type {
  NotificationKind,
  NotificationParams,
} from '../../dto/notifications.ts'
import type { EpisodeRef } from './wanted.ts'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { summaryOf } from '../mine/cards.ts'
import { notify } from '../notifications/index.ts'
import { getTitleIdentity } from '../tmdb/index.ts'
import { releaseFacts } from './upgrade.ts'
import { compareEpisodes } from './wanted.ts'

// Серии одной раздачи сообщаются вместе, пока докачиваются соседние, но
// не дольше часа от первой готовой: пак сезона — одно сообщение, а не восемь
export const LIBRARY_HOLD_MS = 60 * 60 * 1000

// Название в сообщении — на языке канала или панели
const TITLE_LANGUAGES: Record<Language, string> = {
  ru_RU: 'ru-RU',
  en_US: 'en-US',
}

type Facts = Pick<NotificationParams, 'studio' | 'voiceType' | 'quality'>

/** «S1E10, S2E1–E2»: подряд идущие серии — диапазоном; фильм (0/0) — пусто */
export function episodesText(refs: EpisodeRef[]) {
  const bySeason = new Map<number, number[]>()

  for (const ref of [...refs].sort(compareEpisodes)) {
    if (!ref.season)
      continue

    const list = bySeason.get(ref.season) ?? []

    if (!list.includes(ref.episode))
      list.push(ref.episode)

    bySeason.set(ref.season, list)
  }

  return [...bySeason]
    .map(([season, episodes]) => {
      const parts: string[] = []
      let start = episodes[0]!

      for (let index = 1; index <= episodes.length; index++) {
        if (episodes[index] === episodes[index - 1]! + 1)
          continue

        const end = episodes[index - 1]!

        parts.push(start === end ? `E${start}` : `E${start}–E${end}`)
        start = episodes[index]!
      }

      return `S${season}${parts.join(', ')}`
    })
    .join(', ')
}

async function titleNames(titleId: string) {
  const names: NotificationParams['names'] = {}

  for (const [language, tmdb] of Object.entries(TITLE_LANGUAGES)) {
    const title = (await summaryOf(titleId, tmdb))?.details.title

    if (title)
      names[language as Language] = title
  }

  return names
}

/** Студия, тип озвучки и качество, которые совпадают у всех версий */
function commonFacts(list: Facts[]): Facts {
  const common: Facts = {}

  for (const key of ['studio', 'voiceType', 'quality'] as const) {
    const values = new Set(list.map(item => item[key]))
    const [value] = values

    if (values.size === 1 && value)
      common[key] = value
  }

  return common
}

function candidateFacts(
  candidate: Pick<FollowPendingCandidate, 'studio' | 'voiceType' | 'quality'>,
): Facts {
  return {
    ...(candidate.studio && { studio: candidate.studio }),
    ...(candidate.voiceType && { voiceType: candidate.voiceType }),
    ...(candidate.quality && { quality: candidate.quality }),
  }
}

/**
 * Событие «Следить» в центр и в каналы группы `follow`. Сбой (TMDB, база)
 * автоматику не останавливает: событие — не её часть.
 */
async function announce(
  kind: NotificationKind,
  follow: Pick<Follow, 'titleId'>,
  episodes: EpisodeRef[],
  params: NotificationParams,
  severity: 'info' | 'warning' = 'info',
) {
  try {
    notify({
      kind,
      severity,
      section: 'follow',
      params: {
        titleId: follow.titleId,
        names: await titleNames(follow.titleId),
        ...(episodes.length && {
          episodes: episodesText(episodes),
          count: episodes.length,
        }),
        ...params,
      },
    })
  }
  catch (err) {
    logFor('notifications').error(
      { err, kind, titleId: follow.titleId },
      'Follow notification failed',
    )
  }
}

/**
 * «В библиотеке»: одно сообщение на тайтл со всеми сериями, о которых ещё не
 * сообщали. Пока у тех же раздач слежения докачиваются другие серии, оно
 * ждёт их, но не дольше `LIBRARY_HOLD_MS`.
 */
export async function announceLibrary(
  follow: Pick<Follow, 'id' | 'titleId'>,
  now = new Date(),
) {
  const db = getDb()
  const ready = db
    .select()
    .from(followEpisodes)
    .where(
      and(
        eq(followEpisodes.followId, follow.id),
        isNotNull(followEpisodes.downloadedAt),
        isNull(followEpisodes.notifiedAt),
        isNull(followEpisodes.upgradeFrom),
      ),
    )
    .all()

  if (!ready.length)
    return

  const torrents = [
    ...new Set(ready.flatMap(row => (row.torrentId ? [row.torrentId] : []))),
  ]
  const siblings = torrents.length
    ? db
        .select({ season: followEpisodes.season })
        .from(followEpisodes)
        .where(
          and(
            eq(followEpisodes.followId, follow.id),
            inArray(followEpisodes.torrentId, torrents),
            isNull(followEpisodes.downloadedAt),
            isNull(followEpisodes.upgradeFrom),
          ),
        )
        .all()
    : []
  const first = Math.min(...ready.map(row => row.downloadedAt!.getTime()))

  if (siblings.length && now.getTime() - first < LIBRARY_HOLD_MS)
    return

  for (const row of ready) {
    db.update(followEpisodes)
      .set({ notifiedAt: now })
      .where(
        and(
          eq(followEpisodes.followId, follow.id),
          eq(followEpisodes.season, row.season),
          eq(followEpisodes.episode, row.episode),
        ),
      )
      .run()
  }

  await announce(
    'follow_downloaded',
    follow,
    ready,
    commonFacts(
      ready.map(row =>
        row.grabbedTitle ? releaseFacts(row.grabbedTitle) : {},
      ),
    ),
  )
}

/**
 * «Готова к просмотру» (режим `notify`): одно сообщение на тайтл со всеми
 * сериями, выбранными с прошлого тика. Выбор пака делается целиком за один
 * проход, ждать соседей, как «в библиотеке», не нужно. Апгрейд выбора
 * отметку не сбрасывает — второго «готова» нет.
 */
export async function announceReady(
  follow: Pick<Follow, 'id' | 'titleId'>,
  now = new Date(),
) {
  const db = getDb()
  const ready = db
    .select()
    .from(followEpisodes)
    .where(
      and(
        eq(followEpisodes.followId, follow.id),
        isNotNull(followEpisodes.picked),
        isNull(followEpisodes.notifiedAt),
      ),
    )
    .all()

  if (!ready.length)
    return

  for (const row of ready) {
    db.update(followEpisodes)
      .set({ notifiedAt: now })
      .where(
        and(
          eq(followEpisodes.followId, follow.id),
          eq(followEpisodes.season, row.season),
          eq(followEpisodes.episode, row.episode),
        ),
      )
      .run()
  }

  await announce(
    'follow_ready',
    follow,
    ready,
    commonFacts(ready.map(row => candidateFacts(row.picked!))),
  )
}

export interface NewPending {
  episodes: EpisodeRef[]
  candidate: FollowPendingCandidate
  until: Date
  /** Параметры отказа `wait`: студия или тип озвучки и качество */
  wait: Record<string, unknown>
}

/**
 * «Ждём вашу озвучку»: новые отложенные серии прогона одним сообщением на
 * тайтл. Только центр — это объяснение, а не просьба что-то сделать.
 */
export async function announceWaiting(
  follow: Pick<Follow, 'titleId'>,
  pending: NewPending[],
) {
  if (!pending.length)
    return

  const soonest = pending.reduce((best, item) =>
    item.until < best.until ? item : best,
  )
  const pick = (key: string) =>
    typeof soonest.wait[key] === 'string'
      ? (soonest.wait[key] as string)
      : undefined

  await announce(
    'follow_waiting',
    follow,
    pending.flatMap(item => item.episodes),
    {
      ...candidateFacts(soonest.candidate),
      wait: {
        ...(pick('studio') && { studio: pick('studio') }),
        ...(pick('voiceType') && { voiceType: pick('voiceType') }),
        ...(pick('quality') && { quality: pick('quality') }),
      },
      until: soonest.until.toISOString(),
    },
  )
}

/**
 * «Взяли другую озвучку»: у сезона есть своя студия, а взята другая — после
 * окна или без него. Её заменит своя, если выйдет, пока серию не смотрели.
 * У тайтла с русским оригиналом озвучка не выбирается — события нет.
 */
export async function announceOtherVoice(
  follow: Pick<Follow, 'titleId'>,
  candidate: FollowPendingCandidate,
  episodes: EpisodeRef[],
  ownStudio: string | undefined,
) {
  if (
    !episodes.length
    || !ownStudio
    || candidate.studio?.toLowerCase() === ownStudio.toLowerCase()
  ) {
    return
  }

  try {
    if ((await getTitleIdentity(follow.titleId))?.originalLanguage === 'ru')
      return
  }
  catch {
    // Без деталей тайтла событие всё равно полезно
  }

  await announce('follow_other_voice', follow, episodes, {
    ...candidateFacts(candidate),
    own: ownStudio,
  })
}

/** Апгрейд закончился: серии заменены версией лучше; только центр */
export async function announceUpgraded(
  follow: Pick<Follow, 'titleId'>,
  upgraded: { episode: EpisodeRef, title: string }[],
) {
  if (!upgraded.length)
    return

  await announce(
    'follow_upgraded',
    follow,
    upgraded.map(item => item.episode),
    commonFacts(upgraded.map(item => releaseFacts(item.title))),
  )
}

/** Тема обновилась: подмена раздачи прошла; только центр */
export async function announceTopicUpdated(
  follow: Pick<Follow, 'titleId'>,
  update: { season?: number, episodesTo?: number, episodesTotal?: number },
) {
  await announce('follow_topic_updated', follow, [], {
    ...(update.season !== undefined && { season: update.season }),
    ...(update.episodesTo !== undefined && { episodesTo: update.episodesTo }),
    ...(update.episodesTotal !== undefined && {
      episodesTotal: update.episodesTotal,
    }),
  })
}

/**
 * Серии впервые стали «не нашли»: одно сообщение на тайтл. У одной серии с
 * датой — сколько дней назад она вышла.
 */
export async function announceMissing(
  follow: Pick<Follow, 'titleId'>,
  missing: (EpisodeRef & { airDate?: string })[],
  now = new Date(),
) {
  if (!missing.length)
    return

  const [only] = missing
  const aired
    = missing.length === 1 && only?.airDate
      ? new Date(`${only.airDate}T00:00:00`)
      : undefined
  const days = aired
    ? Math.floor((now.getTime() - aired.getTime()) / (24 * 60 * 60 * 1000))
    : undefined

  await announce(
    'follow_missing',
    follow,
    missing,
    days !== undefined && days > 0 ? { days } : {},
    'warning',
  )
}
