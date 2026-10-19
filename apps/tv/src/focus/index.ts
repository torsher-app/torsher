import type { App, Directive, InjectionKey } from 'vue'
import type { FocusEngine } from './engine.ts'
import { inject } from 'vue'
import { createFocusEngine } from './engine.ts'
import { readKey } from './keys.ts'

export type { SectionEdges } from './engine.ts'
export type { Direction } from './geometry.ts'

declare module 'vue' {
  interface GlobalDirectives {
    vFocusable: Directive<HTMLElement>
  }
}

const focusKey: InjectionKey<FocusEngine> = Symbol('focus')

const SECTION_ATTRIBUTE = 'data-focus-section'

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
  const pointers = new WeakMap<HTMLElement, () => void>()

  return {
    mounted(el) {
      const name = sectionOf(el)
      const onPointer = () => engine.point(name, el)

      el.setAttribute('data-focusable', '')

      if (!el.hasAttribute('tabindex'))
        el.tabIndex = -1

      el.addEventListener('mouseenter', onPointer)
      pointers.set(el, onPointer)
      engine.register(name, el)
    },
    beforeUnmount(el) {
      const onPointer = pointers.get(el)

      if (onPointer)
        el.removeEventListener('mouseenter', onPointer)

      engine.unregister(sectionOf(el), el)
    },
  }
}

export function createFocus(options: FocusOptions) {
  const engine = createFocusEngine()

  function onKeydown(event: KeyboardEvent) {
    const action = readKey(event)

    if (!action)
      return

    event.preventDefault()

    if (action.type === 'move')
      engine.move(action.direction)
    else if (action.type === 'enter')
      engine.current()?.click()
    else options.onBack()
  }

  return {
    install(app: App) {
      app.provide(focusKey, engine)
      app.directive('focusable', createDirective(engine))
      window.addEventListener('keydown', onKeydown)
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
