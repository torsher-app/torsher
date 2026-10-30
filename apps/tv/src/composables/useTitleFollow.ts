import type {
  FollowTitleInput,
  FollowWait,
  ScheduleItem,
  TitleFollow,
  TitleFollowResponse,
} from '@torsher/api-client'
import type { Ref } from 'vue'
import type { EpisodesKind } from '../lib/follow.ts'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.ts'
import {
  episodesStatusKey,
  followNote,
  followStatus,
  qualityName,
  untilDay,
  waitingStatusKey,
} from '../lib/follow.ts'
import { formatClock } from '../lib/player.ts'
import { formatAirDate } from '../lib/titleInfo.ts'
import { noteTitleFollow } from '../titleActions.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'
import { useResource } from './useResource.ts'

/**
 * «Следить» тайтла: правила, подписка профиля и статус. Язык — тот же, что у
 * деталей карточки: по ним сервер считает сезоны и курсор. Правки меняют
 * состояние ответом сервера; отказ возвращает `false`, прежнее остаётся.
 */
export function useTitleFollow(id: Ref<string>) {
  const language = useCatalogLanguage()
  const { data, status, refresh } = useResource<TitleFollowResponse>(
    computed(() => `${id.value}|${language.value}`),
    (_, signal) =>
      api.titles.getTitleFollow(
        id.value,
        { language: language.value },
        { signal },
      ),
  )

  function apply(titleId: string, fresh: TitleFollowResponse) {
    if (titleId !== id.value)
      return

    data.value = fresh
    noteTitleFollow(
      titleId,
      !!fresh.follow?.subscribed && fresh.follow.state !== 'stopped',
    )
  }

  async function save(body: FollowTitleInput) {
    const titleId = id.value

    try {
      apply(
        titleId,
        await api.titles.followTitle(titleId, body, {
          language: language.value,
        }),
      )

      return true
    }
    catch {
      return false
    }
  }

  async function stop() {
    const titleId = id.value

    try {
      apply(
        titleId,
        await api.titles.unfollowTitle(titleId, { language: language.value }),
      )

      return true
    }
    catch {
      return false
    }
  }

  return {
    followView: data,
    followStatus: status,
    refreshFollow: refresh,
    save,
    stop,
  }
}

/** Подписи «Следить»: политика на кнопке, статус-строка, состояния серий */
export function useFollowTexts() {
  const { t } = useI18n()
  const language = useCatalogLanguage()

  function voiceTypeName(type: string) {
    return t(`sources.voiceTypes.${type}`)
  }

  /** Чего ждём: «LostFilm», «1080p», «LostFilm в 1080p»; ничего — пусто */
  function waitTarget(
    wait: Pick<FollowWait, 'studio' | 'voiceType' | 'quality'>,
  ) {
    const voice
      = wait.studio ?? (wait.voiceType ? voiceTypeName(wait.voiceType) : '')
    const quality = wait.quality ? qualityName(wait.quality) : ''

    if (voice && quality)
      return t('follow.voiceQuality', { voice, quality })

    return voice || quality
  }

  function untilText(iso: string) {
    const time = formatClock(new Date(iso), language.value)
    const day = untilDay(iso)

    return day === 'today' || day === 'tomorrow'
      ? t(`follow.until.${day}`, { time })
      : t('follow.until.date', {
          date: formatAirDate(day, language.value),
          time,
        })
  }

  function voicePart(follow: TitleFollow) {
    const studio = follow.voice?.studio

    if (studio)
      return follow.voiceStrict ? t('follow.policy.only', { studio }) : studio

    return follow.voice?.type
      ? voiceTypeName(follow.voice.type)
      : t('follow.policy.anyVoice')
  }

  /**
   * Вторая строка кнопки: «Скачаем · LostFilm · 1080p», в режиме
   * «Только уведомлять» — «Уведомим · LostFilm · 1080p»
   */
  function policyLine(view: TitleFollowResponse) {
    const follow = view.follow
    const notify = follow?.mode === 'notify'

    if (!follow)
      return ''

    if (follow.kind === 'movie')
      return t(notify ? 'follow.movieLineNotify' : 'follow.movieLine')

    return [
      t(notify ? 'follow.policy.notify' : 'follow.policy.download'),
      voicePart(follow),
      qualityName(follow.quality.value),
    ].join(' · ')
  }

  function episodesStatus(
    kind: EpisodesKind,
    status: { count: number, code: string },
    movie: boolean,
  ) {
    return t(
      `follow.status.${episodesStatusKey(kind, status.count, movie)}`,
      { n: status.count, code: status.code },
      status.count,
    )
  }

  function mainStatus(follow: TitleFollow) {
    const status = followStatus(follow)
    const movie = follow.kind === 'movie'

    switch (status?.kind) {
      case 'paused':
        return t('follow.status.paused')
      case 'noSpace':
      case 'downloading':
      case 'missing':
      case 'searching':
        return episodesStatus(status.kind, status, movie)
      case 'ready':
        return movie
          ? t('follow.status.movieReady')
          : t('follow.status.ready', { code: status.code })
      case 'waiting': {
        const target = waitTarget(status.waiting)

        return t(`follow.status.${waitingStatusKey(!!target, movie)}`, {
          code: status.code,
          target,
          until: untilText(status.waiting.until),
        })
      }
      case 'next':
        return t(
          follow.mode === 'notify'
            ? 'follow.status.nextNotify'
            : 'follow.status.next',
          {
            code: status.code,
            date: formatAirDate(status.airDate, language.value),
          },
        )
      default:
        return ''
    }
  }

  /** Статус-строка карточки: главное и заметка о сезоне через « · » */
  function statusLine(follow: TitleFollow) {
    const note = followNote(follow)
    const noteText
      = note?.kind === 'bestQuality'
        ? t('follow.status.bestQuality', { quality: qualityName(note.quality) })
        : note?.kind === 'pinned'
          ? t('follow.status.pinned', { studio: note.studio })
          : ''

    return [mainStatus(follow), noteText].filter(Boolean).join(' · ')
  }

  /** Состояние серии на карточке и в «Расписании»; у невышедшей — пусто */
  function episodeState(
    state: ScheduleItem['state'] | undefined,
    wait?: FollowWait,
  ) {
    if (!state || state === 'upcoming')
      return ''

    if (state === 'waiting') {
      const target = wait ? waitTarget(wait) : ''

      return target
        ? t('follow.episode.waiting', { target })
        : t('follow.episode.waitingBetter')
    }

    return t(`follow.episode.${state}`)
  }

  /** Пункт «Ждать лучшее»: «Не ждать», «12 ч», «Сутки», «3 дня» */
  function waitLabel(hours: number) {
    if (hours === 0)
      return t('follow.panel.waitNone')

    if (hours === 24)
      return t('follow.panel.waitDay')

    return hours % 24 === 0
      ? t('follow.panel.waitDays', hours / 24)
      : t('follow.panel.waitHours', { n: hours })
  }

  return {
    policyLine,
    statusLine,
    episodeState,
    waitLabel,
  }
}
