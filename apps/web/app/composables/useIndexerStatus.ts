import type { Indexer } from '@torsher/api-client'
import type { IndexerStatusView } from '~/lib/indexerStatus'
import { useI18n } from 'vue-i18n'
import { indexerStatusView } from '~/lib/indexerStatus'

/** Тексты статуса индексатора: бейдж, причина в строке и объяснение в карточке */
export function useIndexerStatus() {
  const { t } = useI18n()
  const { isChecking } = useSources()

  function viewOf(indexer: Indexer) {
    return indexerStatusView(indexer, isChecking(indexer.id))
  }

  function managerName(indexer: Indexer) {
    return indexer.managerKind ? t(`panel.kinds.${indexer.managerKind}`) : ''
  }

  function label(indexer: Indexer, view: IndexerStatusView) {
    return t(`panel.sources.status.${view.state}`, {
      manager: managerName(indexer),
    })
  }

  /** Причина вместо категорий: короткая, со следующим шагом */
  function reason(indexer: Indexer, view: IndexerStatusView) {
    if (!view.needsAttention && view.state !== 'checking')
      return ''

    const managed = view.state === 'auth' && indexer.managerKind

    return t(`panel.sources.reasons.${managed ? 'authManaged' : view.state}`, {
      manager: managerName(indexer),
    })
  }

  /** Объяснение в карточке: что случилось и что сделать */
  function problem(indexer: Indexer, view: IndexerStatusView) {
    if (!view.needsAttention)
      return ''

    const manager = managerName(indexer)

    if (view.state === 'auth') {
      return manager
        ? t('panel.sources.problems.authManaged', { manager })
        : t('panel.sources.problems.auth')
    }

    if (view.state === 'missing' || view.state === 'timeout')
      return t(`panel.sources.problems.${view.state}`, { manager })

    return t(`panel.sources.errors.${view.state}`)
  }

  // Подкатегории Torznab часто повторяют имя родителя: показываем имя один раз
  function categories(indexer: Indexer) {
    return [
      ...new Set(indexer.categories.map(category => category.name)),
    ].join(', ')
  }

  return { viewOf, managerName, label, reason, problem, categories }
}
