import { onScopeDispose, watch } from 'vue'

/** Dirty-версия ждёт активного экрана, закрытого меню и окончания загрузки. */
export function useTitleChanges(
  version: () => number | string,
  ready: () => boolean,
  refresh: () => Promise<unknown>,
  active: () => boolean,
  blocked: () => boolean,
) {
  let seen = version()
  let running = false
  let disposed = false

  function sync() {
    if (running)
      return true
    if (disposed || !active() || blocked() || !ready() || seen === version())
      return false

    seen = version()
    running = true
    void refresh()
      .catch(() => {})
      .finally(() => {
        running = false
        sync()
      })
    return true
  }

  watch([version, ready, active, blocked], sync)
  onScopeDispose(() => {
    disposed = true
  })
  return sync
}
