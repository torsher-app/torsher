import type {
  AudioTrack,
  ParsedRelease,
  VideoResolution,
} from '@torsher/release-parser'
import type {
  Follow,
  FollowEpisode,
  FollowUpgradeFrom,
  MediaFile,
  Torrent,
} from '../../db/schema.ts'
import type { RankContext } from '../sources/rank.ts'
import type { EpisodeRef, EpisodeWithState } from './wanted.ts'
import { parseRelease, videoResolution } from '@torsher/release-parser'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, mediaFiles, titleProgress } from '../../db/schema.ts'
import { managedFolders, setReplacement } from '../library/files.ts'
import { russianVoices, voiceOf } from '../sources/rank.ts'
import { torrentResolution } from '../sources/resolution.ts'
import { getTorrent } from '../torrents/index.ts'
import { recordHistory } from './history.ts'
import { episodeKey } from './wanted.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// Сколько после закачки серию ещё можно заменить: дольше — перекачка того, что
// давно лежит; у фильма дубляж выходит позже первых релизов
export const UPGRADE_WINDOW_MS: Record<'movie' | 'series', number> = {
  series: 7 * DAY_MS,
  movie: 60 * DAY_MS,
}
// Позиция дальше этой доли длительности — серию уже смотрели
const STARTED_SHARE = 0.05

/** Версия серии: по чему её сравнивают с кандидатом */
export interface ReleaseVersion {
  /** Все дорожки по названию: язык озвучки и оригинал */
  parsed: Pick<ParsedRelease, 'audio'>
  voice?: AudioTrack
  voices: AudioTrack[]
  resolution?: VideoResolution
}

/** Где версия относительно cutoff сезона: озвучка и ступень лестницы */
export interface VersionPosition {
  voiceAtCutoff: boolean
  step: number
}

/**
 * Кандидат лучше скачанного на целый шаг цепочки: озвучка в cutoff вместо
 * чужой (озвучка важнее качества, как в порядке кандидатов) или та же
 * озвучка и ступень выше.
 */
export function isUpgrade(
  candidate: VersionPosition,
  current: VersionPosition,
) {
  if (candidate.voiceAtCutoff !== current.voiceAtCutoff)
    return candidate.voiceAtCutoff

  return candidate.step < current.step
}

/** Почему серию в библиотеке не заменяем */
export type UpgradeBlock = 'watched' | 'manual'

/** Серия в библиотеке, которую рассматривает апгрейд */
export interface UpgradeTarget {
  /**
   * Раздача текущего файла из захвата автоматики и её название; у выбора
   * режима `notify` раздачи в базе нет — только название
   */
  current?: { torrent?: Torrent, title: string }
  blocked?: UpgradeBlock
}

/** Что решатель знает о заменяемой серии */
export interface UpgradeCheck {
  current?: ReleaseVersion
  blocked?: UpgradeBlock
}

/** Позиция без длительности (кроме нуля) и «просмотрено» — тоже начатая */
export function isStarted(position: number, duration: number | null) {
  return duration ? position / duration > STARTED_SHARE : position > 0
}

/** Серии тайтла, которые начал смотреть хоть один профиль */
function startedEpisodes(titleId: string) {
  const rows = getDb()
    .select()
    .from(titleProgress)
    .where(eq(titleProgress.titleId, titleId))
    .all()

  return new Set(
    rows
      .filter(row => isStarted(row.position, row.duration))
      .map(row => episodeKey(row)),
  )
}

/** Апгрейд серии начат или идёт захват: второй не начинаем */
function isGrabbing(row: FollowEpisode) {
  return !!row.upgradeFrom || (!!row.torrentId && !row.downloadedAt)
}

function coveringFiles(files: MediaFile[], episode: EpisodeRef) {
  return files.filter(
    file =>
      file.season === episode.season
      && file.episode !== null
      && file.episode <= episode.episode
      && episode.episode <= (file.episodeTo ?? file.episode),
  )
}

/**
 * Готовые серии режима `notify`, выбор которых апгрейд рассматривает: с
 * первого выбора прошло меньше 7 дней (у фильма — 60). Серию начали смотреть —
 * не заменяем: зритель уже выбрал, что смотрит.
 */
function pickTargets(
  follow: Pick<Follow, 'id' | 'titleId' | 'kind'>,
  states: EpisodeWithState[],
  now: Date,
) {
  const targets = new Map<string, UpgradeTarget>()
  const ready = new Set(
    states.filter(item => item.state === 'ready').map(episodeKey),
  )

  if (!ready.size)
    return targets

  const started = startedEpisodes(follow.titleId)
  const rows = getDb()
    .select()
    .from(followEpisodes)
    .where(eq(followEpisodes.followId, follow.id))
    .all()

  for (const row of rows) {
    const key = episodeKey(row)

    if (!ready.has(key) || !row.picked || !row.pickedAt)
      continue

    if (
      now.getTime() - row.pickedAt.getTime()
      >= UPGRADE_WINDOW_MS[follow.kind]
    ) {
      continue
    }

    targets.set(
      key,
      started.has(key)
        ? { blocked: 'watched' }
        : { current: { title: row.picked.title } },
    )
  }

  return targets
}

/**
 * Серии в библиотеке, которые апгрейд рассматривает: автоматика их видела, с
 * закачки прошло меньше 7 дней (у фильма — 60), у серии один файл на одну
 * серию. Файл не из захвата автоматики — выбран вручную; серию начали
 * смотреть — тоже не заменяем. В режиме `notify` закачек нет — заменяется
 * выбор готовых серий.
 */
export function upgradeTargets(
  follow: Pick<Follow, 'id' | 'titleId' | 'kind' | 'mode'>,
  states: EpisodeWithState[],
  now = new Date(),
) {
  if (follow.mode === 'notify')
    return pickTargets(follow, states, now)

  const targets = new Map<string, UpgradeTarget>()
  const inLibrary = states.filter(item => item.state === 'in_library')

  if (!inLibrary.length)
    return targets

  const db = getDb()
  const rows = new Map(
    db
      .select()
      .from(followEpisodes)
      .where(eq(followEpisodes.followId, follow.id))
      .all()
      .map(row => [episodeKey(row), row]),
  )
  const files = db
    .select()
    .from(mediaFiles)
    .where(
      and(
        eq(mediaFiles.titleId, follow.titleId),
        eq(mediaFiles.state, 'present'),
      ),
    )
    .all()
  const managed = new Set(managedFolders().map(folder => folder.id))
  const started = startedEpisodes(follow.titleId)

  for (const item of inLibrary) {
    const key = episodeKey(item)
    const row = rows.get(key)
    const covering = coveringFiles(files, item)
    const file = covering[0]

    if (
      !row
      || isGrabbing(row)
      || covering.length !== 1
      || (file!.episodeTo !== null && file!.episodeTo !== file!.episode)
    ) {
      continue
    }

    const since = row.downloadedAt ?? file!.addedAt

    if (now.getTime() - since.getTime() >= UPGRADE_WINDOW_MS[follow.kind])
      continue

    const own
      = !!row.downloadedAt
        && !!row.torrentId
        && file!.torrentId === row.torrentId
        && managed.has(file!.folderId)

    if (!own) {
      targets.set(key, { blocked: 'manual' })
      continue
    }

    if (started.has(key)) {
      targets.set(key, { blocked: 'watched' })
      continue
    }

    const torrent = getTorrent(row.torrentId!)

    if (torrent) {
      targets.set(key, {
        current: { torrent, title: row.grabbedTitle ?? torrent.name },
      })
    }
  }

  return targets
}

/**
 * Версия текущего файла — по названию захваченной раздачи, тем же разбором,
 * что у кандидатов; разрешение — точное, если раздачу уже пробовали
 */
export function versionOf(
  current: { torrent?: Torrent, title: string },
  ctx: RankContext,
): ReleaseVersion {
  const parsed = parseRelease(current.title)
  const voices = russianVoices(parsed, ctx)

  return {
    parsed,
    voice: voiceOf(voices, ctx),
    voices,
    resolution:
      (current.torrent && torrentResolution(current.torrent))
      ?? videoResolution(parsed),
  }
}

/** Студия и качество раздачи для истории замены и уведомлений */
export function releaseFacts(title: string) {
  const parsed = parseRelease(title)
  const studio = parsed.audio.find(track => track.studio)?.studio
  const quality = videoResolution(parsed)?.value

  return { ...(studio && { studio }), ...(quality && { quality }) }
}

function episodeRows(followId: string, episodes: EpisodeRef[]) {
  if (!episodes.length)
    return []

  const keys = new Set(episodes.map(episodeKey))

  return getDb()
    .select()
    .from(followEpisodes)
    .where(
      and(
        eq(followEpisodes.followId, followId),
        inArray(followEpisodes.season, [
          ...new Set(episodes.map(item => item.season)),
        ]),
      ),
    )
    .all()
    .filter(row => keys.has(episodeKey(row)))
}

function updateRow(row: FollowEpisode, values: Partial<FollowEpisode>) {
  getDb()
    .update(followEpisodes)
    .set(values)
    .where(
      and(
        eq(followEpisodes.followId, row.followId),
        eq(followEpisodes.season, row.season),
        eq(followEpisodes.episode, row.episode),
      ),
    )
    .run()
}

/** Серии, у которых в библиотеке файл автоматики или уже идёт апгрейд */
export function upgradeKeys(
  follow: Pick<Follow, 'id'>,
  episodes: EpisodeRef[],
) {
  return new Set(
    episodeRows(follow.id, episodes)
      .filter(row => !!row.upgradeFrom || !!row.downloadedAt)
      .map(episodeKey),
  )
}

/**
 * Раздача апгрейда добавлена: серия запоминает прежнюю закачку, к которой
 * вернётся при сбое, и дальше качается как обычный захват.
 */
export function beginUpgrade(
  follow: Pick<Follow, 'id'>,
  episodes: EpisodeRef[],
  torrentId: string,
) {
  for (const row of episodeRows(follow.id, episodes)) {
    if (
      row.upgradeFrom
      || !row.downloadedAt
      || !row.torrentId
      || row.fileIndex === null
      || row.torrentId === torrentId
    ) {
      continue
    }

    const from: FollowUpgradeFrom = {
      torrentId: row.torrentId,
      fileIndex: row.fileIndex,
      downloadedAt: row.downloadedAt.getTime(),
      title: row.grabbedTitle ?? getTorrent(row.torrentId)?.name ?? '',
    }

    updateRow(row, { upgradeFrom: from, downloadedAt: null })
  }
}

/** Серии с идущим апгрейдом среди этих */
export function upgradingRows(
  follow: Pick<Follow, 'id'>,
  episodes: EpisodeRef[],
) {
  return episodeRows(follow.id, episodes).filter(row => !!row.upgradeFrom)
}

/** Файл библиотеки, который заменяет апгрейд серии */
function upgradedFile(follow: Pick<Follow, 'titleId'>, row: FollowEpisode) {
  const from = row.upgradeFrom!

  return getDb()
    .select()
    .from(mediaFiles)
    .where(
      and(
        eq(mediaFiles.titleId, follow.titleId),
        eq(mediaFiles.torrentId, from.torrentId),
        eq(mediaFiles.fileIndex, from.fileIndex),
      ),
    )
    .get()
}

/** Файлы новой раздачи выбраны: файлы библиотеки ждут их вместо прежних */
export function markReplacements(
  follow: Pick<Follow, 'id' | 'titleId'>,
  torrentId: string,
  files: Map<string, number>,
) {
  for (const row of episodeRows(follow.id, [...files.keys()].map(parseKey))) {
    const fileIndex = files.get(episodeKey(row))
    const file = row.upgradeFrom && upgradedFile(follow, row)

    if (file && fileIndex !== undefined)
      setReplacement(file.id, { torrentId, fileIndex })
  }
}

function parseKey(key: string): EpisodeRef {
  const [season, episode] = key.split(':').map(Number) as [number, number]

  return { season, episode }
}

/**
 * Апгрейд не удался: серия возвращается к прежней закачке, файл библиотеки
 * остаётся прежним.
 */
export function restoreUpgrades(
  follow: Pick<Follow, 'id' | 'titleId'>,
  rows: FollowEpisode[],
) {
  for (const row of rows) {
    const from = row.upgradeFrom

    if (!from)
      continue

    const file = upgradedFile(follow, row)

    if (file?.replacementTorrentId)
      setReplacement(file.id, null)

    const kept = !!getTorrent(from.torrentId)

    updateRow(row, {
      torrentId: kept ? from.torrentId : null,
      fileIndex: kept ? from.fileIndex : null,
      grabbedTitle: from.title || null,
      downloadedAt: new Date(from.downloadedAt),
      upgradeFrom: null,
      pending: null,
      waitUntil: null,
      stateNote: null,
    })
  }
}

/**
 * Итог апгрейдов слежения: файл заменён новой версией — событие `upgraded`,
 * срок апгрейда по-прежнему от первой закачки; раздачу апгрейда удалили —
 * серия возвращается к прежней закачке. Возвращает заменённые серии.
 */
export function settleUpgrades(
  follow: Pick<Follow, 'id' | 'titleId'>,
  now = new Date(),
) {
  const upgraded: { episode: EpisodeRef, title: string }[] = []
  const rows = getDb()
    .select()
    .from(followEpisodes)
    .where(
      and(
        eq(followEpisodes.followId, follow.id),
        isNotNull(followEpisodes.upgradeFrom),
      ),
    )
    .all()

  for (const row of rows) {
    if (!row.torrentId) {
      restoreUpgrades(follow, [row])
      continue
    }

    if (row.fileIndex === null)
      continue

    const replaced = getDb()
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.titleId, follow.titleId),
          eq(mediaFiles.torrentId, row.torrentId),
          eq(mediaFiles.fileIndex, row.fileIndex),
          eq(mediaFiles.season, row.season),
        ),
      )
      .get()

    if (!replaced)
      continue

    const from = row.upgradeFrom!
    const title = row.grabbedTitle ?? getTorrent(row.torrentId)?.name ?? ''

    updateRow(row, {
      downloadedAt: new Date(from.downloadedAt),
      upgradeFrom: null,
    })
    recordHistory(
      {
        followId: follow.id,
        titleId: follow.titleId,
        kind: 'upgraded',
        season: row.season,
        episodes: [row.episode],
        releaseTitle: title,
        torrentId: row.torrentId,
        params: { from: releaseFacts(from.title), to: releaseFacts(title) },
      },
      now,
    )
    upgraded.push({
      episode: { season: row.season, episode: row.episode },
      title,
    })
  }

  return upgraded
}
