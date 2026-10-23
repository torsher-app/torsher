import type {
  DownloadTitleInput,
  InsufficientStorageResponse,
  TitleDownload,
  TitleDownloadStart,
} from '@torsher/api-client'
import type { Ref } from 'vue'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { computed, onScopeDispose } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.ts'
import { FILES_POLL_INTERVAL_MS, FILES_POLL_LIMIT_MS } from '../lib/files.ts'
import type { ActiveDownload } from '../lib/downloadSlot.ts'
import { downloadPercent } from '../lib/download.ts'
import { coverageLabel } from '../lib/sources.ts'
import { formatGigabytes, formatSpeed } from '../lib/player.ts'
import { useResource } from './useResource.ts'
import { useSourceLabels } from './useSourceLabels.ts'

// Пока качается, процент в карточке обновляется сам
const STATE_POLL_MS = 5000

/** Пиры так и не прислали список файлов раздачи */
class ResolveTimeoutError extends Error {
  constructor() {
    super('Release metadata did not arrive')
    this.name = 'ResolveTimeoutError'
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Ждёт список файлов раздачи от пиров, как экран «Файлы» */
async function waitFiles(
  titleId: string,
  torrentId: string,
  cancelled: () => boolean,
) {
  const until = Date.now() + FILES_POLL_LIMIT_MS

  for (;;) {
    if (cancelled())
      return false

    const files = await api.titles.getTitleFiles(titleId, torrentId)

    if (files.status === 'ready')
      return true

    if (Date.now() >= until)
      throw new ResolveTimeoutError()

    await sleep(FILES_POLL_INTERVAL_MS)
  }
}

/** Где сейчас «Скачать»: подключаем раздачу или ждём от пиров список файлов */
export type DownloadStep = 'connecting' | 'waiting'

/**
 * «Скачать»: magnet раздачи может ждать метаданные — тогда ждём их и
 * повторяем с той же раздачей. `undefined` — экран ушёл, пока ждали.
 */
export async function startDownload(
  titleId: string,
  body: DownloadTitleInput,
  cancelled: () => boolean,
  onStep?: (step: DownloadStep) => void,
): Promise<TitleDownloadStart | undefined> {
  let request = body

  for (;;) {
    onStep?.('connecting')

    const result = await api.titles.postTitleDownload(titleId, request)

    if (result.status === 'started')
      return result

    onStep?.('waiting')

    if (!(await waitFiles(titleId, result.torrentId, cancelled)))
      return undefined

    request = { ...body, candidateId: result.candidateId }
  }
}

/** Тексты загрузки: успех и ошибки по статусу и виду, как у плеера */
export function useDownloadTexts() {
  const { t, locale } = useI18n()
  const gigabytes = (bytes = 0) => formatGigabytes(bytes, locale.value)
  const { sizeLabel, voiceLabel } = useSourceLabels()

  /** «Скачивается 45 %» или «Ждём пиров · 45 %», «Скачано», «В библиотеке» */
  function stateOf(download: TitleDownload) {
    if (download.state === 'downloading') {
      return t(
        download.stalled
          ? 'download.state.stalled'
          : 'download.state.downloading',
        { n: downloadPercent(download.progress) },
      )
    }

    return download.state ? t(`download.state.${download.state}`) : ''
  }

  /** Какую раздачу качаем: «1080p · LostFilm» */
  function releaseOf(download: Pick<TitleDownload, 'release'> | undefined) {
    const release = download?.release

    if (!release)
      return ''

    return [release.quality, release.voice && voiceLabel(release.voice)]
      .filter(Boolean)
      .join(' · ')
  }

  /** Пиры и скорость, пока качается: «12 пиров · 2,1 МБ/с» или «пиров пока нет» */
  function activityOf(download: TitleDownload | undefined) {
    if (download?.state !== 'downloading')
      return ''

    return peersOf(download)
  }

  function peersOf(download: Pick<TitleDownload, 'peers' | 'speed'>) {
    const { connected, found } = download.peers

    if (connected > 0) {
      return [
        t('player.peers', connected),
        t('player.speed', { value: formatSpeed(download.speed, locale.value) }),
      ].join(' · ')
    }

    return found > 0 ? t('player.found', found) : t('download.noPeers')
  }

  /** Заголовок слота загрузки: «Скачивается 45 %», «Ждём пиров · 45 %», «Файлы не разобраны» */
  function activeLabel(item: ActiveDownload) {
    if (item.phase === 'unmatched')
      return t('download.unmatched')

    return t(
      item.stalled ? 'download.state.stalled' : 'download.state.downloading',
      { n: downloadPercent(item.phase === 'placing' ? 1 : item.progress) },
    )
  }

  /**
   * Вторая строка слота: сезоны пака, раздача и пиры; докачанная —
   * «Раскладываем файлы…», не разложится — куда смотреть
   */
  function activeHint(item: ActiveDownload) {
    if (item.phase === 'placing')
      return t('download.placing')

    if (item.phase === 'unmatched')
      return t('download.unmatchedHint')

    return [
      item.seasons.length > 1
        ? coverageLabel({ seasons: item.seasons, episodes: null })
        : '',
      releaseOf(item),
      peersOf(item),
    ]
      .filter(Boolean)
      .join(' · ')
  }

  function started(result: TitleDownloadStart) {
    return result.bytes > 0
      ? t('download.started', {
          files: t('download.files', result.files),
          size: sizeLabel(result.bytes),
        })
      : t('download.startedDone')
  }

  /** `conflict` — текст 409: оставлять нечего или отменять нечего */
  async function errorOf(
    err: unknown,
    conflict: 'nothingToKeep' | 'nothingToCancel' = 'nothingToKeep',
  ) {
    if (err instanceof ResolveTimeoutError)
      return t('download.errors.timeout')

    switch (getErrorStatus(err)) {
      case 422: {
        const body = await getErrorBody<{ kind?: string }>(err)

        return t(
          body?.kind === 'no_sources'
            ? 'download.errors.noSources'
            : body?.kind === 'candidate_gone'
              ? 'download.errors.gone'
              : 'download.errors.notPlayable',
        )
      }
      case 507: {
        const body
          = await getErrorBody<Partial<InsufficientStorageResponse>>(err)

        return t(`download.errors.storage.${body?.kind ?? 'no_space'}`, {
          needed: gigabytes(body?.needed),
          available: gigabytes(body?.available),
          free: gigabytes(body?.free),
          reserve: gigabytes(body?.minFree),
          limit: gigabytes(body?.cacheLimit),
        })
      }
      case 409:
        return t(`download.errors.${conflict}`)
      case 503:
        return t('download.errors.engine')
      case 401:
        return t('download.errors.unauthorized')
      default:
        return t('download.errors.unknown')
    }
  }

  return {
    started,
    errorOf,
    stateOf,
    releaseOf,
    activityOf,
    activeLabel,
    activeHint,
  }
}

/**
 * Состояние загрузки тайтла для карточки: живые данные движка. Пока качается
 * или ждёт библиотеки и экран на виду (`isActive`), перечитывается раз в 5 с
 * без лоадера.
 */
export function useTitleDownload(id: Ref<string>, isActive: () => boolean) {
  const { data, refresh } = useResource<TitleDownload>(
    computed(() => id.value),
    (key, signal) => api.titles.getTitleDownload(key, { signal }),
  )

  // Пока есть закачки (качается или раскладывается), состояние живое
  const timer = setInterval(() => {
    const value = data.value

    if (
      (value?.state === 'downloading' || !!value?.downloads.length)
      && isActive()
    ) {
      void refresh()
    }
  }, STATE_POLL_MS)

  onScopeDispose(() => clearInterval(timer))

  return { download: data, refreshDownload: refresh }
}
