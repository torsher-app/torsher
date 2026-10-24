import type { InjectionKey, Ref } from 'vue'
import { onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { collapsedAt, fitLevel, lastStep, TEXT_STEPS } from '../lib/rowFit.ts'

/** Ступень сжатия ряда для кнопок внутри: подпись фокуса пересчитывается на смене */
export const ROW_FIT: InjectionKey<Ref<number>> = Symbol('rowFit')

// Правый край последней кнопки внутри поля окна. offset*, а не прямоугольники:
// масштаб кнопки в фокусе (`transform`) на раскладку не влияет
function blockFits(block: HTMLElement) {
  const last = block.lastElementChild as HTMLElement | null

  if (!last)
    return true

  const padding = Number.parseFloat(getComputedStyle(block).paddingRight) || 0

  return (
    last.offsetLeft + last.offsetWidth <= block.clientWidth - padding + 0.5
  )
}

/**
 * Ступень сжатия ряда кнопок (`src/lib/rowFit.ts`). Ступени примеряются
 * атрибутами `data-fit` и `data-collapsed` прямо в DOM и замеряются в одной
 * задаче, до кадра: промежуточные не отрисовываются. Пересчёт — на смене кнопок
 * и подписей (MutationObserver), размера окна ряда (ResizeObserver: и показ
 * экрана из KeepAlive) и после загрузки шрифтов, но не на движение фокуса —
 * ряд не прыгает
 */
export function useRowFit(block: Ref<HTMLElement | undefined>) {
  const level = ref(0)

  provide(ROW_FIT, level)

  // Вторичные кнопки со значком справа налево: так они сворачиваются
  function collapsible(el: HTMLElement) {
    return Array.from(
      el.querySelectorAll<HTMLElement>(
        ':scope > .action-button--iconed:not(.action-button--primary)',
      ),
    ).reverse()
  }

  function apply(el: HTMLElement, buttons: HTMLElement[], step: number) {
    const collapsed = collapsedAt(step, buttons.length)

    el.dataset.fit = String(
      step === lastStep(buttons.length)
        ? TEXT_STEPS + 1
        : Math.min(step, TEXT_STEPS),
    )
    buttons.forEach((button, index) => {
      if (index < collapsed)
        button.dataset.collapsed = ''
      else delete button.dataset.collapsed
    })
  }

  function fit() {
    const el = block.value

    // Скрытый ряд не замерить: пересчёт придёт с ResizeObserver при показе
    if (!el || el.clientWidth === 0)
      return

    const buttons = collapsible(el)
    const next = fitLevel((step) => {
      apply(el, buttons, step)

      return blockFits(el)
    }, lastStep(buttons.length))

    apply(el, buttons, next)
    level.value = next
  }

  const mutations = new MutationObserver(fit)
  const resizes = new ResizeObserver(fit)
  const fonts = document.fonts as FontFaceSet | undefined

  onMounted(() => {
    const el = block.value!

    el.dataset.fit = '0'
    fit()
    // Атрибуты не слушаем: свои `data-fit`, `data-collapsed` и классы фокуса
    // пересчёт не зовут
    mutations.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    resizes.observe(el)
    fonts?.addEventListener('loadingdone', fit)
  })

  onBeforeUnmount(() => {
    mutations.disconnect()
    resizes.disconnect()
    fonts?.removeEventListener('loadingdone', fit)
  })

  return level
}
