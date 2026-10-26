import type {
  Follow,
  FollowMode,
  FollowPendingCandidate,
  Torrent,
} from '../../db/schema.ts'
import type { EpisodeRef } from './wanted.ts'
import { parseRelease } from '@torsher/release-parser'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, follows, torrents } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { acquire, isSkippable, pickFile } from '../sources/watch.ts'
import { linkTitle } from '../torrents/index.ts'
import {
  blockTorrent,
  candidateRelease,
  filesFor,
  linkOf,
  pendingMagnet,
  pinFirstVoice,
  resetEpisodes,
  updateEpisodes,
  withoutBlocked,
} from './grab.ts'
import { blockedPart, blockedReleases } from './blocklist.ts'
import { stateInputs } from './episodes.ts'
import { recordHistory } from './history.ts'
import { followById, followOf } from './index.ts'
import { announceOtherVoice, announceUpgraded } from './notify.ts'
import { releaseFacts } from './upgrade.ts'
import { episodeKey } from './wanted.ts'

function rowsOf(follow: Pick<Follow, 'id'>) {
  return getDb()
    .select()
    .from(followEpisodes)
    .where(eq(followEpisodes.followId, follow.id))
    .all()
}

/**
 * Режим `notify`: кандидат запоминается за сериями вместо захвата — серии
 * «готовы», их стримит «Смотреть». `.torrent` не скачивается, места и движка
 * выбор не касается. Серия с прежним выбором получает новый: это апгрейд,
 * срок которого по-прежнему от первого выбора.
 */
export async function pickCandidate(
  follow: Follow,
  candidate: FollowPendingCandidate,
  episodes: EpisodeRef[],
  options: { ownStudio?: string, now?: Date } = {},
) {
  const now = options.now ?? new Date()

  // Проход начался раньше: слежение могли остановить или удалить
  if (followById(follow.id)?.state !== 'active')
    return 'later'

  // Режим сменили посреди прохода: серии, которые уже скачаны или качаются,
  // выбирать незачем
  const { library, downloading } = stateInputs(follow, follow.kind)

  episodes = episodes.filter(
    item =>
      !library.has(episodeKey(item)) && !downloading.has(episodeKey(item)),
  )

  const chosen = new Set(
    rowsOf(follow)
      .filter(row => row.picked)
      .map(episodeKey),
  )
  const blocked = blockedPart(
    candidateRelease(candidate),
    blockedReleases(follow.titleId, now),
  )

  // Запрещённый кандидат-апгрейд прежний выбор серии не снимает
  if (blocked !== undefined) {
    const free = episodes.filter(
      item => blocked && !blocked.has(episodeKey(item)),
    )

    withoutBlocked(
      follow,
      episodes.filter(
        item => !free.includes(item) && !chosen.has(episodeKey(item)),
      ),
      null,
    )
    episodes = free
  }

  if (!episodes.length)
    return 'blocked'

  const keys = new Set(episodes.map(episodeKey))
  const rows = rowsOf(follow).filter(row => keys.has(episodeKey(row)))
  const replaced = rows.filter(
    row => row.picked && row.picked.id !== candidate.id,
  )
  const replacedKeys = new Set(replaced.map(episodeKey))
  const fresh = episodes.filter(item => !replacedKeys.has(episodeKey(item)))

  updateEpisodes(follow, fresh, {
    picked: candidate,
    pickedAt: now,
    pending: null,
    waitUntil: null,
    stateNote: null,
  })

  for (const row of replaced) {
    updateEpisodes(follow, [row], {
      picked: candidate,
      pending: null,
      waitUntil: null,
      stateNote: null,
    })
  }

  for (const season of new Set(episodes.map(item => item.season))) {
    pinFirstVoice(follow, season, candidate, options.ownStudio)

    const inSeason = fresh.filter(item => item.season === season)

    if (inSeason.length) {
      recordHistory(
        {
          followId: follow.id,
          titleId: follow.titleId,
          kind: 'picked',
          season,
          episodes: inSeason.map(item => item.episode),
          releaseTitle: candidate.title,
          indexerId: candidate.indexerId,
          params: {
            ...(candidate.studio && { studio: candidate.studio }),
            ...(candidate.voiceType && { voiceType: candidate.voiceType }),
            ...(candidate.quality && { quality: candidate.quality }),
          },
        },
        now,
      )
    }

    for (const row of replaced.filter(item => item.season === season)) {
      recordHistory(
        {
          followId: follow.id,
          titleId: follow.titleId,
          kind: 'upgraded',
          season,
          episodes: [row.episode],
          releaseTitle: candidate.title,
          params: {
            pick: true,
            from: releaseFacts(row.picked!.title),
            to: releaseFacts(candidate.title),
          },
        },
        now,
      )
    }
  }

  await announceOtherVoice(follow, candidate, fresh, options.ownStudio)
  await announceUpgraded(
    follow,
    replaced.map(row => ({
      episode: { season: row.season, episode: row.episode },
      title: candidate.title,
    })),
  )

  return 'picked'
}

/**
 * Смена режима. `notify` → `download`: выбор готовых серий становится
 * отложенным кандидатом с кончившимся окном, и тик захватит его без нового
 * поиска; «в библиотеке» придёт отдельно от «готова». `download` → `notify`:
 * скачанное и начатые закачки остаются, отложенные станут выбором на тике.
 */
export function applyModeChange(follow: Pick<Follow, 'id'>, mode: FollowMode) {
  if (mode !== 'download')
    return

  const now = new Date()

  for (const row of rowsOf(follow)) {
    if (!row.picked)
      continue

    getDb()
      .update(followEpisodes)
      .set({
        pending: row.picked,
        waitUntil: now,
        picked: null,
        pickedAt: null,
        notifiedAt: null,
      })
      .where(
        and(
          eq(followEpisodes.followId, row.followId),
          eq(followEpisodes.season, row.season),
          eq(followEpisodes.episode, row.episode),
        ),
      )
      .run()
  }
}

export class PickError extends Error {
  readonly kind: 'no_pick' | 'not_playable'

  constructor(kind: 'no_pick' | 'not_playable') {
    super(kind === 'no_pick' ? 'No picked release' : 'Release is not playable')
    this.name = 'PickError'
    this.kind = kind
  }
}

/** Выбор слежения для серии тайтла, если он есть */
export function pickOf(titleId: string, episode: EpisodeRef) {
  const follow = followOf(titleId)

  if (!follow)
    return undefined

  const row = getDb()
    .select()
    .from(followEpisodes)
    .where(
      and(
        eq(followEpisodes.followId, follow.id),
        eq(followEpisodes.season, episode.season),
        eq(followEpisodes.episode, episode.episode),
        isNotNull(followEpisodes.picked),
      ),
    )
    .get()

  return row?.picked ? { follow, candidate: row.picked } : undefined
}

/**
 * Раздачу выбора не вернуть: она в чёрный список, серии снова нужны, поиск —
 * сразу. Без метаданных (`stalled`) раздача не годится ни для одной серии,
 * и выбор снимается у всех; без файла серии (`failed_check`) — только у
 * неё. Снимается только этот выбор: пока шёл просмотр, тик мог его заменить.
 * Фильм, завершённый по выбору, снова ищется.
 */
function dropPick(
  follow: Follow,
  torrent: Pick<Torrent, 'infoHash' | 'name'>,
  reason: 'stalled' | 'failed_check',
  candidate: FollowPendingCandidate,
  episodes: EpisodeRef[],
) {
  const keys = new Set(episodes.map(episodeKey))
  const dropped = rowsOf(follow)
    .filter(
      row =>
        row.picked?.id === candidate.id
        && (reason === 'stalled' || keys.has(episodeKey(row))),
    )
    .map(row => ({ season: row.season, episode: row.episode }))

  if (!dropped.length)
    return

  blockTorrent(follow, torrent, reason, dropped, candidate.detailsUrl, {
    only: reason === 'failed_check',
    candidate,
  })
  resetEpisodes(follow, dropped)
  // `null` у действующего слежения — посмотреть на ближайшем тике
  getDb()
    .update(follows)
    .set({
      nextSearchAt: null,
      ...(followById(follow.id)?.state === 'done' && {
        state: 'active' as const,
      }),
    })
    .where(eq(follows.id, follow.id))
    .run()
}

/**
 * Исход стрима выбора, о котором сервер узнаёт позже «Смотреть»: magnet так
 * и не получил метаданные или в раздаче нет выбранных серий. Тик снимает
 * такой выбор, иначе каждое «Смотреть» ждало бы его заново.
 */
export function settlePicks(follow: Follow) {
  const groups = new Map<
    string,
    { candidate: FollowPendingCandidate, episodes: EpisodeRef[] }
  >()

  for (const row of rowsOf(follow)) {
    if (!row.picked?.infoHash)
      continue

    const group = groups.get(row.picked.id) ?? {
      candidate: row.picked,
      episodes: [],
    }

    group.episodes.push({ season: row.season, episode: row.episode })
    groups.set(row.picked.id, group)
  }

  for (const { candidate, episodes } of groups.values()) {
    const torrent = getDb()
      .select()
      .from(torrents)
      .where(eq(torrents.infoHash, candidate.infoHash!.toLowerCase()))
      .get()

    if (torrent?.status === 'failed') {
      dropPick(follow, torrent, 'stalled', candidate, episodes)
      continue
    }

    if (torrent?.status !== 'ready')
      continue

    const files = filesFor(torrent, candidate.title, follow.kind, episodes)
    const absent = episodes.filter(item => !files.has(episodeKey(item)))

    if (absent.length)
      dropPick(follow, torrent, 'failed_check', candidate, absent)
  }
}

/**
 * «Смотреть» на готовой серии: раздача выбора добавляется обычным стримом.
 * Ссылка индексатора не ответила — выбор остаётся, зритель смотрит обычным
 * автовыбором; раздача без метаданных или без этой серии — в чёрный список,
 * и серию ищут заново.
 */
export async function openPick(
  titleId: string,
  episode: EpisodeRef,
): Promise<{ status: 'ready' | 'resolving', torrentId: string }> {
  const found = pickOf(titleId, episode)

  if (!found)
    throw new PickError('no_pick')

  const { follow, candidate } = found
  let torrent: Torrent | undefined

  try {
    torrent = await acquire(
      {
        title: candidate.title,
        link: linkOf(candidate),
        magnet: pendingMagnet(candidate),
        infoHash: candidate.infoHash,
      },
      () => true,
    )
  }
  catch (err) {
    if (!isSkippable(err))
      throw err

    logFor('catalog').warn({ err, titleId }, 'Follow pick could not be added')
    throw new PickError('not_playable')
  }

  if (!torrent)
    throw new PickError('not_playable')

  if (torrent.status === 'failed') {
    dropPick(follow, torrent, 'stalled', candidate, [episode])
    throw new PickError('not_playable')
  }

  const linked = linkTitle(torrent, titleId)

  if (linked.status === 'resolving')
    return { status: 'resolving', torrentId: linked.id }

  const file
    = follow.kind === 'movie'
      ? pickFile(linked, parseRelease(candidate.title), { kind: 'movie' })
      : filesFor(linked, candidate.title, 'series', [episode]).get(
          episodeKey(episode),
        )

  if (file === undefined) {
    dropPick(follow, linked, 'failed_check', candidate, [episode])
    throw new PickError('not_playable')
  }

  return { status: 'ready', torrentId: linked.id }
}
