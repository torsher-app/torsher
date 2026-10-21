import type { Torrent } from '@torsher/api-client'
import type { DownloadView } from '~/lib/downloadStatus'
import { useI18n } from 'vue-i18n'
import { downloadViewOf, etaSeconds, progressOf } from '~/lib/downloadStatus'
import { formatBytes, formatDuration } from '~/lib/format'
import { releaseMetaOf } from '~/lib/releaseMeta'

/** Тексты статуса загрузки: подпись, причина в строке, объяснение в карточке, цифры */
export function useDownloadStatus() {
  const { t, locale } = useI18n()

  const bytes = (value: number) => formatBytes(value, locale.value)
  const speed = (value: number) =>
    t('panel.torrents.filters.speed', { value: bytes(value) })

  function label(view: DownloadView) {
    return t(`panel.torrents.states.${view.status}`)
  }

  /** Причина в строке вместо цифр — только у проблем */
  function reason(torrent: Torrent, view: DownloadView) {
    if (view.status === 'failed')
      return t(`panel.torrents.status.${torrent.error ?? 'failed'}`)

    if (view.status === 'pausedStorage')
      return t('panel.torrents.reasons.pausedStorage')

    return ''
  }

  function problem(view: DownloadView) {
    if (
      view.status === 'failed'
      || view.status === 'pausedStorage'
      || view.status === 'stalled'
    ) {
      return t(`panel.torrents.problems.${view.status}`)
    }

    return ''
  }

  /** Мета под названием: серии, качество, размер и зона хранения */
  function meta(torrent: Torrent) {
    if (torrent.status === 'resolving')
      return t('panel.torrents.status.resolving')

    const release = releaseMetaOf(torrent)

    return [
      release.episodes,
      release.quality,
      bytes(torrent.totalSize),
      t(`panel.torrents.zones.${torrent.retention}`),
    ]
      .filter(Boolean)
      .join(' · ')
  }

  /** «62 % · 8,4 МБ/с · 23 пира · ≈ 2 мин» */
  function numbers(torrent: Torrent, view: DownloadView) {
    const percent = t('panel.torrents.percent', {
      value: Math.floor(progressOf(torrent) * 100),
    })

    if (view.status === 'seeding')
      return [percent, `↑ ${speed(torrent.uploadSpeed)}`].join(' · ')

    if (view.group !== 'active')
      return percent

    const eta = etaSeconds(torrent)

    return [
      percent,
      speed(torrent.downloadSpeed),
      t('panel.torrents.peers', torrent.peers.connected),
      eta === null
        ? ''
        : t('panel.torrents.eta', { time: formatDuration(eta, locale.value) }),
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return {
    viewOf: downloadViewOf,
    label,
    reason,
    problem,
    meta,
    numbers,
    bytes,
    speed,
  }
}
