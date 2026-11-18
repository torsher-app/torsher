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

    const requested = version()
    running = true
    const finish = () => {
      running = false
      // Не повторяем тот же отказ по кругу: следующий вход/событие попробует снова.
      if (version() !== requested)
        sync()
    }
    void refresh().then((success) => {
      if (success !== false)
        seen = requested
      finish()
    }, finish)
    return true
  }

  watch([version, ready, active, blocked], sync)
  onScopeDispose(() => {
    disposed = true
  })
  return sync
}
