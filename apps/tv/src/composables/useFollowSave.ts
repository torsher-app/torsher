import type { FollowTitleInput } from '@torsher/api-client'
import type { Ref } from 'vue'
import { onBeforeUnmount, ref, watch } from 'vue'

/** A pending save belongs to the panel context which started it. */
export function useFollowSave(
  context: Ref<string>,
  editable: Ref<boolean>,
  save: (body: FollowTitleInput) => Promise<boolean>,
) {
  const saving = ref(false)
  const error = ref(false)
  let request = 0
  function invalidate() {
    request++
    saving.value = false
    error.value = false
  }
  watch(context, invalidate, { flush: 'sync' })
  onBeforeUnmount(invalidate)
  async function persist(body: FollowTitleInput): Promise<boolean> {
    if (!editable.value || saving.value)
      return false
    const token = ++request
    saving.value = true
    error.value = false
    try {
      const ok = await save(body)
      if (token !== request)
        return false
      error.value = !ok
      return ok
    }
    catch {
      if (token === request)
        error.value = true
      return false
    }
    finally {
      if (token === request)
        saving.value = false
    }
  }
  return { saving, error, persist }
}
