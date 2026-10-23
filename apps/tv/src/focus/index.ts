import type { App, Directive, InjectionKey } from 'vue'
import type { FocusEngine } from './engine.ts'
import { inject } from 'vue'
import { createFocusEngine } from './engine.ts'
import { createWheelStepper } from './inputMode.ts'
import { readKey } from './keys.ts'

export type {
  FocusListener,
  KeyHandler,
  SectionEdges,
  SectionOptions,
  WheelHandler,
} from './engine.ts'
export type { Direction } from './geometry.ts'
export type { FocusVia, InputMode } from './inputMode.ts'
export type { KeyAction, MediaKey } from './keys.ts'

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
  /**
   * Колесо прокручивает нативно, как в браузере, и фокус не шагает (веб-режим);
   * без него — пошагово, как на ТВ.
   */
  nativeWheel?: boolean
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

/** Колесо над элементом с этим атрибутом прокручивает его нативно, фокус не шагает */
export const NATIVE_WHEEL_ATTRIBUTE = 'data-native-wheel'

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

    if (engine.intercept(action, event))
      return

    if (action.type === 'move')
      engine.key(action.direction)
    else if (action.type === 'enter')
      engine.enter()
    else if (action.type === 'back')
      options.onBack()
  }

  // Где курсор в окне: после нативной прокрутки под ним оказывается другой элемент
  let pointer: { x: number, y: number } | undefined
  let overFrame: number | undefined
  // Прокрутку колесом и тачпадом отличаем от программной (экран ставит фокус
  // через scrollIntoView): только после неё подсветка следует за курсором.
  // Инерция тачпада продолжает слать wheel, окна в секунду хватает
  let wheelAt = 0
  const WHEEL_SCROLL_MS = 1000

  function onMousemove(event: MouseEvent) {
    pointer = { x: event.clientX, y: event.clientY }
    engine.pointerMove(event.screenX, event.screenY, event.target)
  }

  // Chrome шлёт после прокрутки mousemove с прежними координатами, и движок его
  // не считает движением: подсветку под курсором ставим сами, раз за кадр
  function onScroll() {
    if (
      !pointer
      || overFrame !== undefined
      || Date.now() - wheelAt > WHEEL_SCROLL_MS
    ) {
      return
    }

    overFrame = requestAnimationFrame(() => {
      overFrame = undefined

      if (pointer)
        engine.pointerOver(document.elementFromPoint(pointer.x, pointer.y))
    })
  }

  // webOS сообщает, что курсор Magic Remote показался или спрятался
  function onCursorStateChange(event: Event) {
    const detail = (event as CustomEvent<{ visibility?: boolean } | null>)
      .detail

    if (detail?.visibility === false)
      engine.pointerHidden()
  }

  // Клик мимо элементов не должен уводить DOM-фокус с текущего элемента
  function onMousedown(event: MouseEvent) {
    const target = event.target

    if (!(target instanceof Element) || !target.closest('[data-focusable]'))
      event.preventDefault()
  }

  function onWheel(event: WheelEvent) {
    wheelAt = Date.now()

    // В вебе и над списком с `data-native-wheel` колесо листает как в браузере
    if (
      options.nativeWheel
      || (event.target instanceof Element
        && event.target.closest(`[${NATIVE_WHEEL_ATTRIBUTE}]`))
    ) {
      return
    }

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
      document.addEventListener('cursorStateChange', onCursorStateChange)
      window.addEventListener('mousedown', onMousedown)
      window.addEventListener('wheel', onWheel, { passive: false })
      // scroll не всплывает: ловим прокрутку любого контейнера на захвате
      document.addEventListener('scroll', onScroll, true)
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
