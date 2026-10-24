import { ref } from 'vue'

/**
 * Журнал ввода поверх экрана. В браузере — `?debug=keys` в адресе, на ТВ
 * адрес не поменять: там его включает тайное сочетание на «О программе».
 */
export const inputDebug = ref(
  new URLSearchParams(window.location.search).get('debug') === 'keys',
)

export function toggleInputDebug() {
  inputDebug.value = !inputDebug.value
}
