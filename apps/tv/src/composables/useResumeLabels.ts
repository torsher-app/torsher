import type { ResumeLike } from '../lib/continue.ts'
import { useI18n } from 'vue-i18n'
import {
  episodeCode,
  hoursMinutes,
  remainingSeconds,
} from '../lib/continue.ts'

/**
 * Подписи «Продолжить»: «S2E5 · ещё 18 мин», «S2E6 · следующая серия»,
 * «S2E7 · новая серия» — у новой серии «Следить»
 */
export function useResumeLabels() {
  const { t } = useI18n()

  function durationText(seconds: number) {
    const { hours, minutes } = hoursMinutes(seconds)

    return hours > 0
      ? t('title.runtime', { hours, minutes })
      : t('title.runtimeMinutes', { minutes })
  }

  function remainingText(item: ResumeLike) {
    // Начатая новая серия показывает, сколько осталось, как любая другая
    if (item.followNewEpisode && (item.next || !item.position))
      return t('follow.newEpisode')

    if (item.next)
      return t('continue.next')

    const left = remainingSeconds(item)

    return left === null
      ? ''
      : t('continue.remaining', { time: durationText(left) })
  }

  function resumeLine(item: ResumeLike) {
    return [episodeCode(item.season, item.episode), remainingText(item)]
      .filter(Boolean)
      .join(' · ')
  }

  return { durationText, resumeLine }
}
