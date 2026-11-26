import { onDeactivated, onScopeDispose, ref, watch } from 'vue'
import { selectAddonSource } from '../lib/addonPlayback.ts'
import { createLatest } from '../lib/latest.ts'
import {
  captureTitleViewer,
  isTitleViewer,
  titleActions,
} from '../titleActions.ts'

export function useAddonSelection() {
  const latest = createLatest()
  const opening = ref<string>()
  const failed = ref(false)

  function cancel() {
    latest.cancel()
    opening.value = undefined
    failed.value = false
  }

  async function open(titleId: string, candidateId: string) {
    cancel()
    const viewer = captureTitleViewer()
    opening.value = candidateId
    const outcome = await latest.run(signal =>
      selectAddonSource(titleId, candidateId, signal),
    )
    if (outcome.status === 'cancelled')
      return undefined
    opening.value = undefined
    if (!isTitleViewer(viewer))
      return undefined

    if (outcome.status === 'failed') {
      failed.value = true
      return undefined
    }
    return outcome.value
  }

  watch(() => titleActions.viewer, cancel, { flush: 'sync' })
  onDeactivated(cancel)
  onScopeDispose(cancel)
  return { opening, failed, open, cancel }
}
