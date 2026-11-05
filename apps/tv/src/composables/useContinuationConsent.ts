import { shallowRef } from 'vue'
import type { lowerContinuationQuality } from '../lib/continuationQuality.ts'

/** A prepared session waits here; consent belongs only to this launch token. */
export function useContinuationConsent(isCurrent: (run: number) => boolean) {
  const pending = shallowRef<{
    quality: NonNullable<ReturnType<typeof lowerContinuationQuality>>
    run: number
  } | null>(null)
  let settle: ((accepted: boolean) => void) | undefined

  function finish(accepted: boolean) {
    const current = pending.value
    const resolve = settle
    pending.value = null
    settle = undefined
    resolve?.(accepted && !!current && isCurrent(current.run))
  }

  function confirm(
    quality: ReturnType<typeof lowerContinuationQuality>,
    run: number,
  ): Promise<boolean> {
    finish(false)
    if (!isCurrent(run))
      return Promise.resolve(false)
    if (!quality)
      return Promise.resolve(true)
    pending.value = { quality, run }
    return new Promise((resolve) => {
      settle = resolve
    })
  }

  return {
    pending,
    confirm,
    accept: () => finish(true),
    cancel: () => finish(false),
  }
}
