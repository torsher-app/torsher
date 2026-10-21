/**
 * Последнее непустое значение: диалог и лист закрываются с анимацией, и
 * пока они уезжают, в них остаётся прежний элемент, а не пустота.
 */
export function useLastValue<T>(source: () => T | null | undefined) {
  const last = shallowRef<T | null>(source() ?? null)

  watch(source, (value) => {
    if (value)
      last.value = value
  })

  return last
}
