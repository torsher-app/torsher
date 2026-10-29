import { ref } from 'vue'

const NOTICE_MS = 3000

/** Сообщение полосы демо: «недоступно в демо» после действия без мока */
export const notice = ref<string | null>(null)

let timer: ReturnType<typeof setTimeout> | undefined

export function showNotice(text: string) {
  notice.value = text
  clearTimeout(timer)
  timer = setTimeout(() => {
    notice.value = null
  }, NOTICE_MS)
}
