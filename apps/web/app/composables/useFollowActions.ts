import type { FollowSummary } from '@torsher/api-client'
import { getErrorMessage } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { isNotActive } from './useFollows'

/** Действия строки и карточки слежения с итоговыми тостами */
export function useFollowActions() {
  const { t } = useI18n()
  const store = useFollows()

  const nameOf = (follow: FollowSummary) => follow.title ?? follow.titleId

  async function fail(title: string, err: unknown) {
    toast.error(title, { description: await getErrorMessage(err) })
  }

  async function searchNow(follow: FollowSummary) {
    try {
      await store.searchNow(follow.id)
      toast.success(t('panel.follow.toasts.searchRequested'), {
        description: t('panel.follow.toasts.searchRequestedText'),
      })
    }
    catch (err) {
      if (isNotActive(err))
        toast.error(t('panel.follow.toasts.notActive'))
      else await fail(t('panel.follow.toasts.searchFailed'), err)
    }
  }

  async function togglePause(follow: FollowSummary) {
    const paused = follow.state !== 'paused'

    try {
      await store.update(follow.id, { state: paused ? 'paused' : 'active' })
      toast.success(
        t(
          paused ? 'panel.follow.toasts.paused' : 'panel.follow.toasts.resumed',
        ),
        { description: nameOf(follow) },
      )
    }
    catch (err) {
      await fail(t('panel.follow.toasts.saveFailed'), err)
    }
  }

  return { searchNow, togglePause, isBusy: store.isBusy }
}
