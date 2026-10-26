import type {
  Follow,
  FollowEpisode,
  FollowPendingCandidate,
  Torrent,
} from '../../db/schema.ts'
import type { FoundRelease, RankedRelease } from '../sources/rank.ts'
import type { TopicKey } from './topics.ts'
import type { EpisodeRef } from './wanted.ts'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { and, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes } from '../../db/schema.ts'
import { syncLibrary } from '../library/linker.ts'
import { logFor } from '../logs/index.ts'
import { backoffUntil, recordBackgroundOutcome } from '../indexers/backoff.ts'
import { decryptSecret, encryptSecret, SecretError } from '../secrets/index.ts'
import { startDownload } from '../sources/download.ts'
import { getPinnedVoice, pinVoice } from '../sources/voices.ts'
import {
  acquire,
  isSkippable,
  pickFile,
  seasonOfFile,
} from '../sources/watch.ts'
import { InsufficientStorageError } from '../storage/index.ts'
import { getTorrent, linkTitle } from '../torrents/index.ts'
import { SourceError } from '../torznab/index.ts'
import {
  blockedPart,
  blockedReleases,
  blockRelease,
  listingsOf,
  rememberListing,
} from './blocklist.ts'
import { recordHistory } from './history.ts'
import { followById } from './index.ts'
import { announceOtherVoice } from './notify.ts'
import {
  refreshTargets,
  startRefresh,
  trackTopic,
  updatedTopicFor,
} from './topics.ts'
import {
  beginUpgrade,
  markReplacements,
  restoreUpgrades,
  upgradeKeys,
  upgradingRows,
} from './upgrade.ts'
import { episodeKey } from './wanted.ts'
import { seasonVoice } from './voice.ts'

// Ссылка индексатора не ответила: следующая попытка того же кандидата — не
// на каждом тике, скачивание `.torrent` у Prowlarr считается в его лимит.
// Так же ждёт кандидат, которому не хватило места
const ACQUIRE_RETRY_MS = 15 * 60 * 1000

const retryAt = new Map<string, number>()

export type GrabResult
  = 'started' | 'resolving' | 'no_space' | 'blocked' | 'no_files' | 'later'

/**
 * Ссылка индексатора не ответила: кандидат остаётся отложенным с кончившимся
 * окном, и захват повторится сам — не раньше чем через 15 минут.
 */
export function retryLater(
  follow: Follow,
  candidate: FollowPendingCandidate,
  episodes: EpisodeRef[],
  now: Date,
  until = new Date(now.getTime() + ACQUIRE_RETRY_MS),
): GrabResult {
  retryAt.set(candidate.id, until.getTime())

  // Серия в библиотеке кандидата не ждёт: апгрейд повторит следующий поиск
  const upgrades = upgradeKeys(follow, episodes)

  updateEpisodes(
    follow,
    episodes.filter(item => !upgrades.has(episodeKey(item))),
    { pending: candidate, waitUntil: now },
  )
  return 'later'
}

/**
 * Кандидат для `pending`: ссылка на `.torrent` и magnet (в `tr=` бывает
 * passkey) уходят в базу шифртекстом. Индексатор и адрес страницы —
 * отслеживаемой темы, если раздача из неё, иначе того индексатора, чья ссылка.
 */
export function pendingOf(
  release: FoundRelease & Partial<Pick<RankedRelease, 'resolution' | 'voice'>>,
  topic?: TopicKey,
): FollowPendingCandidate {
  const indexer
    = (topic
      && release.indexers.find(
        item =>
          item.id === topic.indexerId && item.detailsUrl === topic.detailsUrl,
      ))
      || (release.link
        ? release.indexers.find(item => item.id === release.link!.indexerId)
        : release.indexers[0])

  return {
    id: release.id,
    title: release.title,
    infoHash: release.infoHash,
    magnetSecret: release.magnet && encryptSecret(release.magnet),
    link: release.link && {
      secret: encryptSecret(release.link.url),
      indexerId: release.link.indexerId,
      indexerOrigin: release.link.indexerOrigin,
    },
    indexerId: indexer?.id,
    detailsUrl: indexer?.detailsUrl,
    size: release.size,
    seeders: release.seeders,
    quality: release.resolution?.value,
    studio: release.voice?.studio,
    voiceType: release.voice?.type,
  }
}

export function linkOf(candidate: FollowPendingCandidate) {
  if (!candidate.link)
    return undefined

  try {
    return {
      url: decryptSecret(candidate.link.secret),
      indexerId: candidate.link.indexerId,
      indexerOrigin: candidate.link.indexerOrigin,
    }
  }
  catch (err) {
    // Сменился ключ сервера: остаётся magnet или infohash
    if (err instanceof SecretError)
      return undefined

    throw err
  }
}

/** Записи прежних версий хранят magnet открытым текстом */
export function pendingMagnet(candidate: FollowPendingCandidate) {
  if (!candidate.magnetSecret)
    return candidate.magnet

  try {
    return decryptSecret(candidate.magnetSecret)
  }
  catch (err) {
    // Сменился ключ сервера: остаётся ссылка или infohash
    if (err instanceof SecretError)
      return undefined

    throw err
  }
}

function episodesWhere(follow: Follow, episodes: EpisodeRef[]) {
  const seasons = [...new Set(episodes.map(item => item.season))]

  return seasons.map(season =>
    and(
      eq(followEpisodes.followId, follow.id),
      eq(followEpisodes.season, season),
      inArray(
        followEpisodes.episode,
        episodes
          .filter(item => item.season === season)
          .map(item => item.episode),
      ),
    ),
  )
}

/** Меняет строки серий; строки создаёт решатель при первом появлении */
export function updateEpisodes(
  follow: Follow,
  episodes: EpisodeRef[],
  values: Partial<typeof followEpisodes.$inferInsert>,
) {
  const db = getDb()

  for (const where of episodesWhere(follow, episodes))
    db.update(followEpisodes).set(values).where(where).run()
}

/**
 * Серия снова нужна: захват или выбор сняты, кандидат забыт, первое
 * появление остаётся. Не удался апгрейд — серия возвращается к прежней
 * закачке; серию, которая уже лежит в библиотеке от автоматики, не трогаем.
 */
export function resetEpisodes(follow: Follow, episodes: EpisodeRef[]) {
  restoreUpgrades(follow, upgradingRows(follow, episodes))

  const db = getDb()

  for (const where of episodesWhere(follow, episodes)) {
    db.update(followEpisodes)
      .set({
        torrentId: null,
        fileIndex: null,
        grabbedAt: null,
        pending: null,
        waitUntil: null,
        stateNote: null,
        picked: null,
        pickedAt: null,
      })
      .where(
        and(
          where,
          isNull(followEpisodes.downloadedAt),
          isNull(followEpisodes.upgradeFrom),
        ),
      )
      .run()
  }
}

/** Показ кандидата у его индексатора */
export function candidateRelease(candidate: FollowPendingCandidate) {
  return {
    infoHash: candidate.infoHash,
    title: candidate.title,
    size: candidate.size,
    indexers: [{ id: candidate.indexerId, detailsUrl: candidate.detailsUrl }],
  }
}

/**
 * Раздача в чёрный список; `only` — только эти серии: остальные серии
 * раздачи в её файлах есть. Кандидат без infohash запоминается, как его
 * показал индексатор: так его узнают до скачивания `.torrent`.
 */
export function blockTorrent(
  follow: Follow,
  torrent: Pick<Torrent, 'infoHash' | 'name'>,
  reason: 'stalled' | 'failed_check',
  episodes: EpisodeRef[],
  detailsUrl?: string,
  options: { only?: boolean, candidate?: FollowPendingCandidate } = {},
) {
  const { candidate } = options

  blockRelease({
    titleId: follow.titleId,
    infoHash: torrent.infoHash,
    releaseTitle: torrent.name,
    reason,
    detailsUrl,
    ...(options.only && { episodes: episodes.map(episodeKey) }),
    ...(candidate
      && !candidate.infoHash && {
      listings: listingsOf(candidateRelease(candidate)),
    }),
  })

  for (const season of new Set(episodes.map(item => item.season))) {
    recordHistory({
      followId: follow.id,
      titleId: follow.titleId,
      kind: 'blocklisted',
      season,
      episodes: episodes
        .filter(item => item.season === season)
        .map(item => item.episode),
      releaseTitle: torrent.name,
      params: { reason },
    })
  }
}

/** Файл каждой серии в раздаче; у фильма — крупнейшее видео */
export function filesFor(
  torrent: Torrent,
  title: string,
  kind: 'movie' | 'series',
  episodes: EpisodeRef[],
) {
  const parsed = parseRelease(title)

  if (kind === 'movie') {
    const index = pickFile(torrent, parsed, { kind })

    return new Map(
      index === undefined ? [] : [[episodeKey(episodes[0]!), index]],
    )
  }

  const entries = (torrent.files ?? [])
    .map((file, index) => ({ ...file, index }))
    .filter(file => !file.padding)
  const matches = matchFiles(
    entries.map(({ path, size }) => ({ path, size })),
    parsed,
  )
  const files = new Map<string, number>()

  for (const episode of episodes) {
    const found = matches.findIndex(
      match =>
        match.kind === 'video'
        && match.episode !== undefined
        && (seasonOfFile(match.season, parsed) ?? episode.season)
        === episode.season
        && episode.episode >= match.episode
        && episode.episode <= (match.episodeTo ?? match.episode),
    )
    const index
      = found === -1
        ? pickFile(torrent, parsed, { kind, ...episode })
        : entries[found]!.index

    if (index !== undefined)
      files.set(episodeKey(episode), index)
  }

  return files
}

/**
 * Первая закачка автоматики закрепляет студию за сезоном без закрепления —
 * если она не спорит со студией сезона из правил или прошлого сезона.
 */
export function pinFirstVoice(
  follow: Follow,
  season: number,
  candidate: FollowPendingCandidate,
  ownStudio: string | undefined,
) {
  if (!candidate.studio || getPinnedVoice(follow.titleId, season))
    return

  if (ownStudio && ownStudio.toLowerCase() !== candidate.studio.toLowerCase())
    return

  pinVoice(follow.titleId, season, { studio: candidate.studio })
}

/**
 * Выбор файлов нужных серий в раздаче с метаданными и закачка тем же путём,
 * что «Скачать». Серий из названия нет в файлах — раздача в чёрный список
 * навсегда, по этим сериям или целиком: её список файлов не изменится.
 */
export async function startGrab(
  follow: Follow,
  torrent: Torrent,
  candidate: FollowPendingCandidate,
  episodes: EpisodeRef[],
  options: { ownStudio?: string, now?: Date } = {},
): Promise<GrabResult> {
  const now = options.now ?? new Date()
  const files = filesFor(torrent, candidate.title, follow.kind, episodes)
  const present = episodes.filter(item => files.has(episodeKey(item)))
  const absent = episodes.filter(item => !files.has(episodeKey(item)))

  if (absent.length) {
    blockTorrent(
      follow,
      torrent,
      'failed_check',
      absent,
      candidate.detailsUrl,
      {
        only: present.length > 0,
        candidate,
      },
    )
    resetEpisodes(follow, absent)
  }

  if (!present.length)
    return 'no_files'

  const upgrades = upgradingRows(follow, present)
  const upgrading = new Set(upgrades.map(episodeKey))

  try {
    await startDownload(torrent, [...new Set(files.values())])
  }
  catch (err) {
    // Апгрейд подождёт следующего поиска, серия остаётся в библиотеке
    restoreUpgrades(follow, upgrades)

    if (!(err instanceof InsufficientStorageError))
      throw err

    const waitUntil = new Date(now.getTime() + ACQUIRE_RETRY_MS)

    // Кандидат остаётся: захват повторится, когда место освободится, — не на
    // каждом тике, а с паузой
    updateEpisodes(
      follow,
      present.filter(item => !upgrading.has(episodeKey(item))),
      {
        torrentId: null,
        fileIndex: null,
        grabbedAt: null,
        pending: candidate,
        waitUntil,
        stateNote: 'no_space',
      },
    )
    // Та же пауза у апгрейда; серия остаётся в библиотеке с прежним файлом
    updateEpisodes(
      follow,
      present.filter(item => upgrading.has(episodeKey(item))),
      { waitUntil, stateNote: 'no_space' },
    )

    return 'no_space'
  }

  for (const episode of present) {
    updateEpisodes(follow, [episode], {
      torrentId: torrent.id,
      fileIndex: files.get(episodeKey(episode))!,
      grabbedAt: now,
      grabbedTitle: candidate.title,
      pending: null,
      waitUntil: null,
      stateNote: null,
    })
  }

  markReplacements(
    follow,
    torrent.id,
    new Map([...files].filter(([key]) => upgrading.has(key))),
  )

  for (const season of new Set(present.map(item => item.season))) {
    pinFirstVoice(follow, season, candidate, options.ownStudio)
    trackTopic(follow, torrent, candidate, season, now)

    for (const upgrade of [false, true]) {
      const episodes = present.filter(
        item =>
          item.season === season && upgrading.has(episodeKey(item)) === upgrade,
      )

      if (!episodes.length)
        continue

      recordHistory(
        {
          followId: follow.id,
          titleId: follow.titleId,
          kind: 'grabbed',
          season,
          episodes: episodes.map(item => item.episode),
          releaseTitle: candidate.title,
          indexerId: candidate.indexerId,
          torrentId: torrent.id,
          params: {
            ...(candidate.studio && { studio: candidate.studio }),
            ...(candidate.voiceType && { voiceType: candidate.voiceType }),
            ...(candidate.quality && { quality: candidate.quality }),
            ...(upgrade && { upgrade: true }),
          },
        },
        now,
      )
    }
  }

  await announceOtherVoice(
    follow,
    candidate,
    present.filter(item => !upgrading.has(episodeKey(item))),
    options.ownStudio,
  )

  // Уже скачанные целиком файлы ложатся в библиотеку сразу
  void syncLibrary()

  return 'started'
}

/**
 * Захват кандидата для серий: `.torrent` по ссылке индексатора или magnet,
 * тайтл, выбор файлов, место. Magnet без метаданных — серии «качаются», файлы
 * выберутся на тике, когда раздача будет готова (`continueGrabs`).
 */
export async function grabCandidate(
  follow: Follow,
  candidate: FollowPendingCandidate,
  episodes: EpisodeRef[],
  options: { ownStudio?: string, now?: Date } = {},
): Promise<GrabResult> {
  const now = options.now ?? new Date()

  // Проход начался раньше: слежение могли остановить или удалить
  if (followById(follow.id)?.state !== 'active')
    return 'later'

  const blocks = blockedReleases(follow.titleId, now)

  episodes = withoutBlocked(
    follow,
    episodes,
    blockedPart(candidateRelease(candidate), blocks),
  )

  if (!episodes.length)
    return 'blocked'

  // Места не хватило недавно: до конца паузы `.torrent` снова не качаем,
  // откуда бы ни пришёл кандидат
  const spaceWait = noSpaceWait(follow, episodes, now)

  episodes = episodes.filter(item => !spaceWait.has(episodeKey(item)))

  if (!episodes.length)
    return 'later'

  if ((retryAt.get(candidate.id) ?? 0) > now.getTime())
    return 'later'

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
      'follow',
    )
  }
  catch (err) {
    if (!isSkippable(err))
      throw err

    logFor('catalog').warn(
      { err, titleId: follow.titleId },
      'Follow could not add a release',
    )
    return retryLater(
      follow,
      candidate,
      episodes,
      now,
      backOffIndexer(candidate, err, now),
    )
  }

  if (!torrent)
    return retryLater(follow, candidate, episodes, now)

  retryAt.delete(candidate.id)

  const blocked = blockedPart(
    { infoHash: torrent.infoHash, title: candidate.title, indexers: [] },
    blocks,
  )

  // Раздачу без infohash узнали только сейчас: по показу её узнают до
  // скачивания, и `.torrent` не качается на каждом проходе
  if (blocked !== undefined && !candidate.infoHash) {
    for (const listing of listingsOf(candidateRelease(candidate)))
      rememberListing(torrent.infoHash, listing, now)
  }

  episodes = withoutBlocked(follow, episodes, blocked)

  if (!episodes.length)
    return 'blocked'

  torrent = linkTitle(torrent, follow.titleId)

  if (torrent.status === 'failed') {
    blockTorrent(follow, torrent, 'stalled', episodes, candidate.detailsUrl, {
      candidate,
    })
    resetEpisodes(follow, episodes)
    return 'blocked'
  }

  const topic = updatedTopicFor(follow, candidate, torrent.infoHash)

  // Новая версия отслеживаемой темы: не рядом со старой, а вместо неё. Серии,
  // которые уже лежат в библиотеке, подмена не заменяет
  if (topic) {
    const upgrades = upgradeKeys(follow, episodes)
    const fresh = episodes.filter(item => !upgrades.has(episodeKey(item)))

    return fresh.length
      ? startRefresh(follow, topic, torrent, candidate, fresh, now)
      : 'no_files'
  }

  beginUpgrade(follow, episodes, torrent.id)

  try {
    if (torrent.status === 'resolving') {
      updateEpisodes(follow, episodes, {
        torrentId: torrent.id,
        fileIndex: null,
        grabbedAt: now,
        pending: candidate,
        waitUntil: null,
        stateNote: null,
      })

      return 'resolving'
    }

    return await startGrab(follow, torrent, candidate, episodes, {
      ...options,
      now,
    })
  }
  catch (err) {
    // Иначе серия осталась бы с прежним файлом и пометкой апгрейда, и итог
    // апгрейда записал бы замену, которой не было
    restoreUpgrades(follow, upgradingRows(follow, episodes))
    throw err
  }
}

/** Серии, у которых идёт пауза после нехватки места */
function noSpaceWait(follow: Follow, episodes: EpisodeRef[], now: Date) {
  const keys = new Set<string>()

  for (const where of episodesWhere(follow, episodes)) {
    const rows = getDb()
      .select()
      .from(followEpisodes)
      .where(
        and(
          where,
          eq(followEpisodes.stateNote, 'no_space'),
          gt(followEpisodes.waitUntil, now),
        ),
      )
      .all()

    for (const row of rows) keys.add(episodeKey(row))
  }

  return keys
}

/**
 * Серии кандидата без тех, что в чёрном списке у его раздачи; заблокированные
 * снова нужны
 */
export function withoutBlocked(
  follow: Follow,
  episodes: EpisodeRef[],
  blocked: Set<string> | null | undefined,
) {
  if (blocked === undefined)
    return episodes

  const free = blocked
    ? episodes.filter(item => !blocked.has(episodeKey(item)))
    : []

  resetEpisodes(
    follow,
    episodes.filter(item => !free.includes(item)),
  )
  return free
}

/**
 * Индексатор просит подождать (`Retry-After` у 429 или 503): срок уходит в
 * его бэкофф — его не спросят ни лента, ни поиск, — и кандидат ждёт столько же.
 */
function backOffIndexer(
  candidate: FollowPendingCandidate,
  err: unknown,
  now: Date,
) {
  const retry = new Date(now.getTime() + ACQUIRE_RETRY_MS)

  if (!(err instanceof SourceError) || !err.retryAt || !candidate.link)
    return retry

  const { indexerId } = candidate.link

  recordBackgroundOutcome(
    [{ id: indexerId }],
    [{ id: indexerId, kind: err.kind, retryAt: err.retryAt }],
    now,
  )

  return new Date(
    Math.max(retry.getTime(), backoffUntil(1, now, err.retryAt).getTime()),
  )
}

/** Серии, захват которых ждёт метаданные magnet, по раздачам */
export function awaitingMetadata(): Map<string, FollowEpisode[]> {
  const rows = getDb()
    .select()
    .from(followEpisodes)
    .where(
      and(
        isNotNull(followEpisodes.torrentId),
        isNull(followEpisodes.fileIndex),
        isNull(followEpisodes.downloadedAt),
      ),
    )
    .all()
  const byTorrent = new Map<string, FollowEpisode[]>()

  for (const row of rows) {
    const list = byTorrent.get(row.torrentId!) ?? []

    list.push(row)
    byTorrent.set(row.torrentId!, list)
  }

  return byTorrent
}

/** Magnet дождался метаданных — выбираем файлы; не дождался — чёрный список */
export async function continueGrabs(
  followOf: (id: string) => Follow | undefined,
  now = new Date(),
) {
  const refreshing = refreshTargets()

  for (const [torrentId, rows] of awaitingMetadata()) {
    // Подмену темы ведёт `continueRefreshes`
    if (refreshing.has(torrentId))
      continue

    const torrent = getTorrent(torrentId)
    const follow = followOf(rows[0]!.followId)

    if (!torrent || !follow || torrent.status === 'resolving')
      continue

    const episodes = rows.map(row => ({
      season: row.season,
      episode: row.episode,
    }))
    const candidate = rows[0]!.pending

    if (torrent.status === 'failed' || !candidate) {
      blockTorrent(
        follow,
        torrent,
        'stalled',
        episodes,
        candidate?.detailsUrl,
        {
          candidate: candidate ?? undefined,
        },
      )
      resetEpisodes(follow, episodes)
      continue
    }

    await startGrab(follow, torrent, candidate, episodes, {
      ownStudio: seasonVoice(follow, episodes[0]!.season)?.studio,
      now,
    })
  }
}

export function resetGrabRetries() {
  retryAt.clear()
}
