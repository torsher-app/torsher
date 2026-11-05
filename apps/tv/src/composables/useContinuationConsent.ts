import type { DiagnosticContext } from '../diagnostics/index.ts'
import { diagnostic } from '../diagnostics/index.ts'
import { shallowRef } from 'vue'
import type { lowerContinuationQuality } from '../lib/continuationQuality.ts'

/** A prepared session waits here; consent belongs only to this launch token. */
export function useContinuationConsent(
  isCurrent: (run: number) => boolean,
  context?: DiagnosticContext,
) {
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
    const valid = accepted && !!current && isCurrent(current.run)
    if (current) {
      diagnostic(
        {
          event: 'continuation.consent',
          generation: current.run,
          outcome: valid
            ? 'accepted'
            : !isCurrent(current.run)
                ? 'stale'
                : 'cancelled',
        },
        context,
        true,
      )
    }
    resolve?.(valid)
  }

  function confirm(
    quality: ReturnType<typeof lowerContinuationQuality>,
    run: number,
  ): Promise<boolean> {
    finish(false)
    if (!isCurrent(run)) {
      diagnostic(
        { event: 'continuation.consent', outcome: 'stale', generation: run },
        context,
      )
      return Promise.resolve(false)
    }
    if (!quality)
      return Promise.resolve(true)
    diagnostic(
      { event: 'continuation.consent', outcome: 'detected', generation: run },
      context,
    )
    pending.value = { quality, run }
    diagnostic(
      { event: 'continuation.consent', outcome: 'opened', generation: run },
      context,
    )
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
