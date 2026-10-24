import { computed, onActivated, ref } from 'vue'
import { revealOffset } from '../lib/rowTrack.ts'
import { platform } from '../platform/index.ts'

// Расстояние между чипами в макете 1920: запас у края окна под масштаб фокуса
const CHIP_GAP = 24

/**
 * Лента чипов, которая держит фокусный чип в окне. На ТВ лента едет
 * `transform`, в вебе окно прокручивается нативно, как ряды: тачпад вбок,
 * Shift + колесо. Поля окна (padding) — место кольцу фокуса и safe area,
 * лента видна между ними.
 */
export function useChipRibbon() {
  const view = ref<HTMLElement>()
  const offset = ref(0)
  const native = platform === 'web'

  const trackStyle = computed(() =>
    native ? undefined : { transform: `translateX(${-offset.value}px)` },
  )

  function reveal(chip: HTMLElement) {
    const el = view.value
    const track = chip.parentElement

    if (!el || !track)
      return

    const style = getComputedStyle(el)
    const viewWidth
      = el.clientWidth
        - Number.parseFloat(style.paddingLeft)
        - Number.parseFloat(style.paddingRight)
    const next = revealOffset(
      offset.value,
      { left: chip.offsetLeft, width: chip.offsetWidth },
      viewWidth,
      track.scrollWidth,
      (window.innerWidth / 1920) * CHIP_GAP,
    )

    if (!native)
      offset.value = next
    else if (next !== offset.value)
      el.scrollTo({ left: next, behavior: 'smooth' })
  }

  function onScroll() {
    if (native && view.value)
      offset.value = view.value.scrollLeft
  }

  // Вернувшийся из KeepAlive экран: нативная прокрутка окна сбросилась
  onActivated(() => {
    if (native && view.value)
      view.value.scrollLeft = offset.value
  })

  return { view, native, trackStyle, reveal, onScroll }
}
