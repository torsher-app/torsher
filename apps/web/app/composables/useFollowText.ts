import type {
  FollowActivityItem,
  FollowCandidate,
  FollowQueueItem,
  FollowSummary,
} from '@torsher/api-client'
import type { FollowStatusView, WaitTarget } from '~/lib/follow'
import { useI18n } from 'vue-i18n'
import {
  episodesLabel,
  followStatusKey,
  formatAirDate,
  formatUntil,
  waitTargetOf,
} from '~/lib/follow'
import { formatBytes } from '~/lib/format'

type Rejection = FollowCandidate['rejections'][number]

// Коды, тексты для которых есть в `panel.follow.rejections`; новый код решателя
// без строки показывается общим текстом, а не ключом
const REJECTIONS = new Set([
  'title_unsure',
  'screen_copy',
  'no_russian',
  'quality',
  'size',
  'blocklisted',
  'voice_strict',
  'no_wanted',
  'already_downloading',
  'no_seeders',
  'wait',
  'outranked',
  'not_available',
  'not_better',
  'watched',
  'manual',
])

const EVENTS = new Set([
  'found',
  'pending',
  'grabbed',
  'picked',
  'downloaded',
  'upgraded',
  'failed',
  'blocklisted',
  'missing',
  'search',
  'gap',
  'unsure',
])

const BLOCK_REASONS = new Set(['stalled', 'user', 'failed_check'])

/** Тексты «Слежу» и «Активности» по коду и параметрам сервера */
export function useFollowText() {
  const { t, te, locale } = useI18n()

  const until = (iso: string) => formatUntil(iso, locale.value)
  const bytes = (value: number) => formatBytes(value, locale.value)

  function episodes(season: number | null, list: number[]) {
    return episodesLabel(season, list) || t('panel.follow.movieLabel')
  }

  /** «Студия и 1080p»: что ждём, в порядке решателя */
  function target(wait: WaitTarget) {
    const parts = [
      wait.studio,
      wait.voiceType
      && (te(`sources.voiceTypes.${wait.voiceType}`)
        ? t(`sources.voiceTypes.${wait.voiceType}`)
        : wait.voiceType),
      wait.quality,
    ].filter(Boolean)

    return parts.join(t('panel.follow.and'))
  }

  function policy(follow: FollowSummary) {
    const parts: string[] = []

    parts.push(
      t(`panel.follow.policy.${follow.mode}`),
      follow.voiceStudio
        ? follow.voiceStrict
          ? t('panel.follow.policy.strict', { studio: follow.voiceStudio })
          : follow.voiceStudio
        : t('panel.follow.policy.anyVoice'),
      t(`panel.follow.presets.${follow.qualityPreset}.short`),
      follow.waitHours
        ? t(
            'panel.follow.policy.wait',
            { n: follow.waitHours },
            follow.waitHours,
          )
        : t('panel.follow.policy.noWait'),
    )

    return parts.join(' · ')
  }

  function status(follow: FollowSummary, view: FollowStatusView) {
    const scope = follow.kind === 'movie' ? 'movie' : 'series'

    if (view.status === 'waiting' && follow.waitUntil) {
      return t(`panel.follow.status.${scope}.waiting`, {
        until: until(follow.waitUntil),
      })
    }

    if (view.status === 'next' && follow.next) {
      return t('panel.follow.status.series.next', {
        episode: episodesLabel(follow.next.season, [follow.next.episode]),
        date: follow.next.airDate
          ? formatAirDate(follow.next.airDate, locale.value)
          : t('panel.follow.noDate'),
      })
    }

    if (view.status === 'next') {
      return t(
        follow.kind === 'movie'
          ? 'panel.follow.status.movie.next'
          : 'panel.follow.status.series.nextUnknown',
      )
    }

    const code = view.first
      ? episodesLabel(view.first.season, [view.first.episode])
      : undefined

    return t(
      followStatusKey(follow, view),
      { n: view.count, code },
      view.count,
    )
  }

  function rejection(item: Rejection) {
    if (!REJECTIONS.has(item.code))
      return t('panel.follow.rejections.unknown')

    const params = item.params ?? {}

    if (item.code === 'wait') {
      const wait = target(waitTargetOf(params))
      const at = typeof params.until === 'string' ? until(params.until) : ''

      return wait
        ? t('panel.follow.rejections.wait', { target: wait, until: at })
        : t('panel.follow.rejections.waitPlain', { until: at })
    }

    if (item.code === 'size' && typeof params.size === 'number')
      return t('panel.follow.rejections.size', { size: bytes(params.size) })

    if (item.code === 'quality' && !params.quality)
      return t('panel.follow.rejections.qualityUnknown')

    if (item.code === 'not_available' && typeof params.date === 'string') {
      return t('panel.follow.rejections.notAvailableDate', {
        date: new Intl.DateTimeFormat(locale.value.replace('_', '-'), {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }).format(new Date(params.date)),
      })
    }

    return t(`panel.follow.rejections.${item.code}`, params)
  }

  function blockReason(reason: unknown) {
    return typeof reason === 'string' && BLOCK_REASONS.has(reason)
      ? t(`panel.follow.blockReasons.${reason}`)
      : t('panel.follow.blockReasons.unknown')
  }

  /** Событие истории одной строкой: что произошло с какими сериями */
  function event(item: FollowActivityItem) {
    const label = episodes(item.season, item.episodes)
    const params = item.params

    if (!EVENTS.has(item.kind))
      return t('panel.follow.events.unknown', { kind: item.kind })

    switch (item.kind) {
      case 'pending': {
        const wait = target(waitTargetOf(params))
        const at = typeof params.until === 'string' ? until(params.until) : ''

        return wait
          ? t('panel.follow.events.pending', {
              episodes: label,
              target: wait,
              until: at,
            })
          : t('panel.follow.events.pendingPlain', {
              episodes: label,
              until: at,
            })
      }
      case 'grabbed': {
        const meta = target(waitTargetOf(params))
        const key = params.upgrade ? 'grabbedUpgrade' : 'grabbed'

        return meta
          ? t(`panel.follow.events.${key}Meta`, { episodes: label, meta })
          : t(`panel.follow.events.${key}`, { episodes: label })
      }
      case 'picked': {
        const meta = target(waitTargetOf(params))

        return meta
          ? t('panel.follow.events.pickedMeta', { episodes: label, meta })
          : t('panel.follow.events.picked', { episodes: label })
      }
      case 'upgraded': {
        const version = (value: unknown) =>
          target(waitTargetOf(value as Record<string, unknown> | undefined))
        const from = version(params.from)
        const to = version(params.to)

        // Режим «Только уведомлять»: заменили выбранную раздачу, не файл
        const key = params.pick ? 'upgradedPick' : 'upgraded'

        return from && to
          ? t(`panel.follow.events.${key}Meta`, { episodes: label, from, to })
          : t(`panel.follow.events.${key}`, { episodes: label })
      }
      case 'blocklisted':
        return t('panel.follow.events.blocklisted', {
          episodes: label,
          reason: blockReason(params.reason),
        })
      case 'search': {
        const found = Number(params.found ?? 0)
        const failed = Number(params.failed ?? 0)
        const text = t(
          params.request === 'manual'
            ? 'panel.follow.events.searchManual'
            : 'panel.follow.events.search',
          { n: found },
          found,
        )

        return failed
          ? `${text} · ${t('panel.follow.events.searchFailed', { n: failed }, failed)}`
          : text
      }
      case 'gap': {
        const at = (value: unknown) =>
          typeof value === 'string' ? until(value) : ''

        return params.from && params.to
          ? t('panel.follow.events.gap', {
              indexer: item.indexer ?? t('panel.follow.events.gapIndexer'),
              from: at(params.from),
              to: at(params.to),
            })
          : t('panel.follow.events.gapPlain', {
              indexer: item.indexer ?? t('panel.follow.events.gapIndexer'),
            })
      }
      case 'unsure':
        return params.confirmedAt
          ? t('panel.follow.events.unsureConfirmed')
          : params.dismissedAt
            ? t('panel.follow.events.unsureDismissed')
            : t('panel.follow.events.unsure')
      default:
        return t(`panel.follow.events.${item.kind}`, { episodes: label })
    }
  }

  function queue(item: FollowQueueItem) {
    switch (item.kind) {
      case 'pending': {
        const wait = item.waitFor ? target(item.waitFor) : ''
        const at = item.until ? until(item.until) : ''

        return wait
          ? t('panel.follow.queue.pending', { target: wait, until: at })
          : t('panel.follow.queue.pendingPlain', { until: at })
      }
      case 'no_space':
        return item.size
          ? t('panel.follow.queue.noSpace', { size: bytes(item.size) })
          : t('panel.follow.queue.noSpacePlain')
      default:
        if (item.resolving)
          return t('panel.follow.queue.resolving')

        return typeof item.progress === 'number'
          ? t('panel.follow.queue.downloading', {
              percent: Math.floor(item.progress * 100),
            })
          : t('panel.follow.queue.downloadingPlain')
    }
  }

  return {
    episodes,
    target,
    policy,
    status,
    rejection,
    blockReason,
    event,
    queue,
    until,
    bytes,
  }
}
