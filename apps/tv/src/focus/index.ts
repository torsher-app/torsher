import type { App, Directive, InjectionKey } from 'vue'
import type { FocusEngine } from './engine.ts'
import { inject } from 'vue'
import { createFocusEngine } from './engine.ts'
import { createWheelStepper } from './inputMode.ts'
import { readKey } from './keys.ts'

export type {
  FocusListener,
  SectionEdges,
  SectionOptions,
  WheelHandler,
} from './engine.ts'
export type { Direction } from './geometry.ts'
export type { FocusVia, InputMode } from './inputMode.ts'

declare module 'vue' {
  interface GlobalDirectives {
    vFocusable: Directive<HTMLElement>
  }
}

const focusKey: InjectionKey<FocusEngine> = Symbol('focus')

const SECTION_ATTRIBUTE = 'data-focus-section'
// Режим ввода на <html>: CSS показывает стрелки листания рядов только под указкой
const INPUT_ATTRIBUTE = 'data-input'

export interface FocusOptions {
  onBack: () => void
}

function sectionOf(el: HTMLElement) {
  const name = el
    .closest<HTMLElement>(`[${SECTION_ATTRIBUTE}]`)
    ?.getAttribute(SECTION_ATTRIBUTE)

  if (!name)
    throw new Error('v-focusable должен стоять внутри FocusSection')

  return name
}

function createDirective(engine: FocusEngine): Directive<HTMLElement> {
  return {
    mounted(el) {
      el.setAttribute('data-focusable', '')

      if (!el.hasAttribute('tabindex'))
        el.tabIndex = -1

      engine.register(sectionOf(el), el)
    },
    beforeUnmount(el) {
      engine.unregister(sectionOf(el), el)
    },
  }
}

export function createFocus(options: FocusOptions) {
  const root = document.documentElement
  const engine = createFocusEngine({
    onModeChange: mode => root.setAttribute(INPUT_ATTRIBUTE, mode),
  })
  const wheelStep = createWheelStepper()

  root.setAttribute(INPUT_ATTRIBUTE, engine.mode)

  function onKeydown(event: KeyboardEvent) {
    const action = readKey(event)

    if (!action)
      return

    event.preventDefault()

    if (action.type === 'move')
      engine.key(action.direction)
    else if (action.type === 'enter')
      engine.current()?.click()
    else options.onBack()
  }

  function onMousemove(event: MouseEvent) {
    engine.pointerMove(event.screenX, event.screenY, event.target)
  }

  // Клик мимо элементов не должен уводить DOM-фокус с текущего элемента
  function onMousedown(event: MouseEvent) {
    const target = event.target

    if (!(target instanceof Element) || !target.closest('[data-focusable]'))
      event.preventDefault()
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault()

    const direction = wheelStep(event.deltaY, Date.now())

    if (direction)
      engine.wheel(direction)
  }

  return {
    install(app: App) {
      app.provide(focusKey, engine)
      app.directive('focusable', createDirective(engine))
      window.addEventListener('keydown', onKeydown)
      window.addEventListener('mousemove', onMousemove)
      window.addEventListener('mousedown', onMousedown)
      window.addEventListener('wheel', onWheel, { passive: false })
    },
  }
}

export function useFocus() {
  const engine = inject(focusKey)

  if (!engine)
    throw new Error('Плагин фокуса не установлен')

  return engine
}

export { SECTION_ATTRIBUTE }
