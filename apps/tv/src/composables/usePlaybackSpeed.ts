import { ref } from 'vue'

// Скорость не хранится в профиле: живёт, пока открыта витрина, и переходит на
// следующую серию вместе с плеером
const speed = ref(1)

export function usePlaybackSpeed() {
  return speed
}
