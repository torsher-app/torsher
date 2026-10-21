import type { Torrent } from '@torsher/api-client'
import type { Component } from 'vue'
import type { BadgeVariants } from '@/components/ui/badge'
import type { StatusTone } from '~/lib/indexerStatus'
import {
  ArrowDownToLineIcon,
  ArrowUpIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePauseIcon,
  CircleXIcon,
  ClockIcon,
  HardDriveIcon,
  Loader2Icon,
  PlayIcon,
} from '@lucide/vue'

export type DownloadStatus
  = | 'resolving'
    | 'failed'
    | 'watching'
    | 'downloading'
    | 'stalled'
    | 'paused'
    | 'pausedStorage'
    | 'seeding'
    | 'complete'
    | 'partial'
    | 'idle'

export type DownloadGroup
  = 'attention' | 'active' | 'paused' | 'seeding' | 'complete' | 'idle'

export interface DownloadView {
  status: DownloadStatus
  tone: StatusTone
  icon: Component
  badge: NonNullable<BadgeVariants['variant']>
  group: DownloadGroup
  /** Не качается по причине, которую владелец должен увидеть */
  attention: boolean
  /** Прогресс показываем янтарём, у скачанного — цветом успеха */
  progressTone: 'brand' | 'success' | 'muted'
}

type ViewTorrent = Pick<
  Torrent,
  'status' | 'state' | 'streaming' | 'pauseReason'
>

/**
 * Одно место, где состояние раздачи превращается в статус строки, иконку,
 * бейдж и группу. Метаданные важнее движка: без списка файлов раздача
 * ничего не качает. Пауза из-за места — проблема, пауза владельца — нет.
 */
export function downloadViewOf(torrent: ViewTorrent): DownloadView {
  if (torrent.status === 'resolving')
    return view('resolving', 'info', Loader2Icon, 'info', 'active')

  if (torrent.status === 'failed') {
    return view(
      'failed',
      'destructive',
      CircleXIcon,
      'destructive',
      'attention',
      true,
    )
  }

  if (torrent.state === 'paused') {
    return torrent.pauseReason === 'storage'
      ? view(
          'pausedStorage',
          'warning',
          HardDriveIcon,
          'warning',
          'attention',
          true,
        )
      : view(
          'paused',
          'muted',
          CirclePauseIcon,
          'outline',
          'paused',
          false,
          'muted',
        )
  }

  if (
    torrent.streaming
    && ['downloading', 'stalled', 'partial'].includes(torrent.state)
  ) {
    return view('watching', 'info', PlayIcon, 'info', 'active')
  }

  switch (torrent.state) {
    case 'downloading':
      return view('downloading', 'info', ArrowDownToLineIcon, 'info', 'active')
    case 'stalled':
      return view('stalled', 'warning', ClockIcon, 'warning', 'active')
    case 'seeding':
      return view(
        'seeding',
        'success',
        ArrowUpIcon,
        'success',
        'seeding',
        false,
        'success',
      )
    case 'complete':
      return view(
        'complete',
        'success',
        CircleCheckIcon,
        'success',
        'complete',
        false,
        'success',
      )
    case 'partial':
      return view(
        'partial',
        'muted',
        CircleDashedIcon,
        'outline',
        'idle',
        false,
        'muted',
      )
    default:
      return view(
        'idle',
        'muted',
        CircleDashedIcon,
        'outline',
        'idle',
        false,
        'muted',
      )
  }
}

function view(
  status: DownloadStatus,
  tone: StatusTone,
  icon: Component,
  badge: DownloadView['badge'],
  group: DownloadGroup,
  attention = false,
  progressTone: DownloadView['progressTone'] = 'brand',
): DownloadView {
  return { status, tone, icon, badge, group, attention, progressTone }
}

/** Доля скачанного из выбранного; без выбора — по всему размеру */
export function progressOf(
  torrent: Pick<Torrent, 'progress' | 'sizeOnDisk' | 'totalSize'>,
) {
  const { downloaded, wanted } = torrent.progress

  if (wanted > 0)
    return Math.min(1, downloaded / wanted)

  return torrent.totalSize > 0
    ? Math.min(1, torrent.sizeOnDisk / torrent.totalSize)
    : 0
}

/** Секунд до конца при текущей скорости; не качается — `null` */
export function etaSeconds(
  torrent: Pick<Torrent, 'progress' | 'downloadSpeed'>,
) {
  const left = torrent.progress.wanted - torrent.progress.downloaded

  if (left <= 0 || torrent.downloadSpeed <= 0)
    return null

  return Math.round(left / torrent.downloadSpeed)
}
