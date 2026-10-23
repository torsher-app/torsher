import type { Torrent } from '@torsher/api-client'
import type { DownloadView } from '~/lib/downloadStatus'
import { useI18n } from 'vue-i18n'
import {
  downloadViewOf,
  etaSeconds,
  progressOf,
  selectionOf,
} from '~/lib/downloadStatus'
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

  /**
   * Что качается целиком: «2 серии · 8,3 ГБ». Серии — если все выбранные
   * файлы разобрались как серии, иначе файлы. Ничего не выбрано — пусто.
   */
  function selected(torrent: Torrent) {
    const { files, size } = selectionOf(torrent)

    if (files.length === 0)
      return null

    const { fileEpisodes } = releaseMetaOf(torrent)
    const episodes = files.every(file => fileEpisodes.has(file.index))

    return {
      count: t(
        episodes
          ? 'panel.torrents.selectedEpisodes'
          : 'panel.torrents.selectedFiles',
        files.length,
      ),
      size,
    }
  }

  /**
   * Мета под названием. Есть выбор — сколько качается целиком из размера
   * раздачи: «2 серии · 8,3 ГБ из 226,8 ГБ · Кэш»; нет — серии, качество,
   * размер раздачи и зона хранения.
   */
  function meta(torrent: Torrent) {
    if (torrent.status === 'resolving')
      return t('panel.torrents.status.resolving')

    const retention = t(`panel.torrents.zones.${torrent.retention}`)
    const matchNote = torrent.titleId
      ? undefined
      : torrent.matchStatus === 'unmatched'
        ? t('panel.torrents.match.short')
        : torrent.matchStatus === 'unsure'
          ? t('panel.torrents.match.shortUnsure')
          : undefined
    const zone = torrent.inLibrary
      ? t('panel.torrents.inLibrary')
      : matchNote
        ? `${retention} · ${matchNote}`
        : retention
    const selection = selected(torrent)

    if (selection) {
      return [
        selection.count,
        t('panel.torrents.progressOf', {
          done: bytes(selection.size),
          total: bytes(torrent.totalSize),
        }),
        zone,
      ].join(' · ')
    }

    const release = releaseMetaOf(torrent)

    return [release.episodes, release.quality, bytes(torrent.totalSize), zone]
      .filter(Boolean)
      .join(' · ')
  }

  /**
   * «62 % · 8,4 МБ/с · 23 пира · ≈ 2 мин». Без выбора процент от всей
   * раздачи ничего не говорит — вместо него сколько на диске.
   */
  function numbers(torrent: Torrent, view: DownloadView) {
    const percent
      = torrent.progress.wanted > 0
        ? t('panel.torrents.percent', {
            value: Math.floor(progressOf(torrent) * 100),
          })
        : t('panel.torrents.onDisk', { size: bytes(torrent.sizeOnDisk) })

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
    selected,
    label,
    reason,
    problem,
    meta,
    numbers,
    bytes,
    speed,
  }
}
