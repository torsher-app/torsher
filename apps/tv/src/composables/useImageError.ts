import { onActivated, ref, watch } from 'vue'

// Компонент заменяет битый <img> заглушкой. Сброс ошибки при возврате
// из KeepAlive создаёт новый <img> и повторяет загрузку того же URL.
export function useImageError(src: () => string | null | undefined) {
  const broken = ref(false)

  function reset() {
    broken.value = false
  }

  watch(src, reset)
  onActivated(reset)

  return broken
}
