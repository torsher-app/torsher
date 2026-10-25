import type { Indexer } from '@torsher/api-client'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { copyText } from '~/lib/clipboard'

/** Действия строки и карточки индексатора с итогом тостом: меню и карточка делят их */
export function useIndexerActions() {
  const { t } = useI18n()
  const { testIndexer, setEnabled, updateIndexer } = useSources()

  async function test(indexer: Indexer) {
    try {
      const checked = await testIndexer(indexer.id)
      const name = checked.name

      if (checked.checkStatus === 'ok') {
        toast.success(t('panel.sources.indexers.testPassed', { name }))
      }
      else {
        toast.error(
          t('panel.sources.indexers.testFailed', {
            name,
            status: t(
              `panel.sources.status.${checked.checkStatus ?? 'pending'}`,
            ),
          }),
        )
      }
    }
    catch {
      toast.error(t('panel.sources.errors.unknown'))
    }
  }

  async function toggle(indexer: Indexer, enabled = !indexer.enabled) {
    await setEnabled(indexer, enabled)
    toast.success(
      t(
        enabled
          ? 'panel.sources.indexers.enabledToast'
          : 'panel.sources.indexers.disabledToast',
        { name: indexer.name },
      ),
    )
  }

  /** Лента новых раздач для «Следить»; у индексаторов Prowlarr её задаёт Prowlarr */
  async function setFeed(indexer: Indexer, feed: boolean) {
    await updateIndexer(indexer.id, { feed })
    toast.success(
      t(
        feed
          ? 'panel.sources.feed.enabledToast'
          : 'panel.sources.feed.disabledToast',
        { name: indexer.name },
      ),
    )
  }

  async function copyUrl(indexer: Indexer) {
    try {
      await copyText(indexer.url)
      toast.success(t('panel.sources.indexers.copied'))
    }
    catch {
      toast.error(t('panel.sources.indexers.copyFailed'))
    }
  }

  return { test, toggle, setFeed, copyUrl }
}
