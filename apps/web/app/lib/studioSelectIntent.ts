/** Reka's automatic highlight and synthetic click are not proof of user intent. */
export function createStudioSelectIntent() {
  let composing = false
  let navigated = false
  let pointer: string | undefined
  function reset() {
    navigated = false
    pointer = undefined
  }
  return {
    reset,
    composition(active: boolean) {
      composing = active
      reset()
    },
    navigate() {
      if (!composing)
        navigated = true
      pointer = undefined
    },
    pointer(name: string) {
      if (!composing)
        pointer = name
    },
    /** Capture handles Enter synchronously, before Reka's synthetic click. */
    enter(
      highlighted: string | undefined,
      isComposing: boolean,
    ): string | undefined {
      const selected
        = !composing && !isComposing && navigated ? highlighted : undefined
      reset()
      return selected
    },
    select(name: string) {
      const allowed = !composing && pointer === name
      reset()
      return allowed
    },
  }
}
