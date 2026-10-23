import type { ReleaseCard } from '@torsher/api-client'
import type { ReleaseOutcome } from '../releaseMatch.ts'
import { useI18n } from 'vue-i18n'
import { releaseFacts, suggestionName } from '../lib/release.ts'
import { useSourceLabels } from './useSourceLabels.ts'

/** Тексты нераспознанной раздачи: карточка, панель и тост итога */
export function useReleaseTexts() {
  const { t } = useI18n()
  const labels = useSourceLabels()

  /** «S3 · 1 серия · 1,8 ГБ» */
  function factsOf(release: ReleaseCard) {
    const facts = releaseFacts(release)

    return [
      facts.coverage,
      t(facts.countKey, facts.count),
      labels.sizeLabel(facts.size),
    ]
      .filter(Boolean)
      .join(' · ')
  }

  function statusOf(release: ReleaseCard) {
    return release.suggestion
      ? t('release.unsure', { title: suggestionName(release.suggestion) })
      : t('release.unmatched')
  }

  function outcomeOf(outcome: ReleaseOutcome) {
    return t(`release.${outcome}`)
  }

  return { factsOf, statusOf, outcomeOf }
}
