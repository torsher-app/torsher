import type { Direction } from './geometry.ts'
import type { FocusVia, InputMode } from './inputMode.ts'
import { findInColumn, findNext } from './geometry.ts'
import { createInputModeTracker } from './inputMode.ts'

export type SectionEdges = Partial<Record<Direction, string>>

export interface SectionOptions {
  edges?: SectionEdges
  /**
   * Секция сама подстраивает экран под фокус (ряд на `transform`):
   * движок не вызывает `scrollIntoView`, иначе он сдвинет `overflow: hidden`-контейнер.
   */
  manualScroll?: boolean
  // Колесо здесь не шагает, а уводит фокус в эту секцию (рейл → контент экрана)
  wheelTarget?: string
}

export type FocusListener = (el: HTMLElement, via: FocusVia) => void

/** Экран сам решает, что делает колесо; `true` — обработано, шаг фокуса не нужен. */
export type WheelHandler = (direction: Direction) => boolean

interface Section {
  name: string
  elements: Set<HTMLElement>
  last?: HTMLElement
  edges: SectionEdges
  manualScroll: boolean
  wheelTarget?: string
}

export interface FocusEngineOptions {
  onModeChange?: (mode: InputMode) => void
}

// Не offsetParent: у position: fixed он всегда null. Пусто и у display: none,
// и у DOM экрана, который KeepAlive убрал из документа
function isVisible(el: HTMLElement) {
  return el.getClientRects().length > 0
}

// Элемент целиком в окне по горизонтали: не полоска предыдущей карточки у края ряда
function isInViewport(el: HTMLElement) {
  const rect = el.getBoundingClientRect()

  return rect.left >= 0 && rect.right <= window.innerWidth
}

function byDocumentOrder(a: HTMLElement, b: HTMLElement) {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1
}

function bump(el: HTMLElement, direction: Direction) {
  const name = `focus-bump-${direction}`

  el.classList.remove(name)
  // Чтение размера перезапускает анимацию, если класс уже стоял
  void el.offsetWidth
  el.classList.add(name)
  el.addEventListener('animationend', () => el.classList.remove(name), {
    once: true,
  })
}

/**
 * Фокус живёт в секциях: стрелки двигают его внутри
 * активной секции, а на краю секция сама решает, куда передать фокус (`edges`).
 * Каждая секция помнит последний элемент — возврат в ряд попадает туда же.
 * Источник истины — DOM-фокус, стили висят на `:focus`.
 *
 * Подписчики (`onFocus`) узнают о каждой смене фокуса и о её источнике:
 * под указкой экран стоит на месте, под пультом подстраивается под элемент,
 * колесо переключает ряды, но не листает их.
 */
export function createFocusEngine(options: FocusEngineOptions = {}) {
  const sections = new Map<string, Section>()
  const owners = new WeakMap<HTMLElement, string>()
  const listeners = new Set<FocusListener>()
  const wheelHandlers = new Set<WheelHandler>()
  const input = createInputModeTracker(options.onModeChange)
  let active: Section | undefined

  function section(name: string) {
    let found = sections.get(name)

    if (!found) {
      found = { name, elements: new Set(), edges: {}, manualScroll: false }
      sections.set(name, found)
    }

    return found
  }

  function notify(el: HTMLElement, via: FocusVia) {
    for (const listener of listeners) listener(el, via)
  }

  function focusElement(target: Section, el: HTMLElement, via: FocusVia) {
    active = target
    target.last = el
    el.focus({ preventScroll: true })

    if (via !== 'pointer' && !target.manualScroll)
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })

    notify(el, via)
  }

  function register(name: string, el: HTMLElement) {
    section(name).elements.add(el)
    owners.set(el, name)
  }

  function unregister(name: string, el: HTMLElement) {
    const found = sections.get(name)

    owners.delete(el)

    if (!found)
      return

    found.elements.delete(el)

    if (found.last === el)
      found.last = undefined
  }

  function configure(name: string, value: SectionOptions) {
    const found = section(name)

    found.edges = value.edges ?? {}
    found.manualScroll = value.manualScroll ?? false
    found.wheelTarget = value.wheelTarget
  }

  /**
   * Фокус в секцию. С `from` — элемент в той же колонке среди целиком видимых
   * (шаг в соседний ряд вверх или вниз, колесо). Без него — запомненный элемент;
   * колесо берёт его, только если он целиком в окне.
   */
  function activate(name: string, via: FocusVia = 'nav', from?: HTMLElement) {
    const found = sections.get(name)
    const visible = found
      ? [...found.elements].filter(isVisible).sort(byDocumentOrder)
      : []

    if (!found || visible.length === 0)
      return false

    const inView = visible.filter(isInViewport)
    const inColumn = from
      ? findInColumn(
          from.getBoundingClientRect(),
          inView.map(el => ({ item: el, rect: el.getBoundingClientRect() })),
        )
      : undefined
    const last
      = found.last
        && visible.includes(found.last)
        && (via !== 'wheel' || isInViewport(found.last))
        ? found.last
        : undefined
    const target = inColumn ?? last ?? inView[0] ?? visible[0]!

    focusElement(found, target, via)

    return true
  }

  /** Фокус на конкретный элемент: экран сам знает, какой из элементов секции нужен. */
  function focusOn(el: HTMLElement, via: FocusVia = 'nav') {
    const name = owners.get(el)

    if (!name || !isVisible(el))
      return false

    focusElement(section(name), el, via)

    return true
  }

  /** Шаг фокуса без оглядки на режим ввода: стрелки пульта (`nav`) и колесо (`wheel`). */
  function move(direction: Direction, via: FocusVia = 'nav') {
    const current = active?.last

    if (!active)
      return

    if (!current) {
      activate(active.name, via)

      return
    }

    const candidates = [...active.elements]
      .filter(el => el !== current && isVisible(el))
      .map(el => ({ item: el, rect: el.getBoundingClientRect() }))

    const next = findNext(
      current.getBoundingClientRect(),
      candidates,
      direction,
    )

    if (next) {
      focusElement(active, next, via)

      return
    }

    const edge = active.edges[direction]
    // Вверх и вниз — в ту же колонку соседней секции, влево и вправо — к запомненному
    const vertical = direction === 'up' || direction === 'down'

    if (!edge || !activate(edge, via, vertical ? current : undefined))
      bump(current, direction)
  }

  /**
   * Стрелка с пульта или клавиатуры. Под указкой она выключает режим указки
   * и сразу шагает от подсвеченного элемента.
   */
  function key(direction: Direction) {
    input.arrow()
    move(direction)
  }

  /**
   * Курсор сдвинулся над `target`. Фокус ставим из mousemove, а не из mouseover:
   * mouseover приходит и тогда, когда элемент сам въехал под неподвижный курсор.
   */
  function pointerMove(x: number, y: number, target: EventTarget | null) {
    if (!input.pointerMove(x, y) || !(target instanceof Element))
      return

    const el = target.closest<HTMLElement>('[data-focusable]')
    const name = el && owners.get(el)

    if (!el || !name || el === active?.last)
      return

    focusElement(section(name), el, 'pointer')
  }

  /** Колесо: сначала экран (последний подписавшийся), иначе — шаг фокуса. */
  function wheel(direction: Direction) {
    for (const handler of [...wheelHandlers].reverse()) {
      if (handler(direction))
        return
    }

    if (active?.wheelTarget)
      activate(active.wheelTarget, 'wheel')
    else move(direction, 'wheel')
  }

  function onWheel(handler: WheelHandler) {
    wheelHandlers.add(handler)

    return () => {
      wheelHandlers.delete(handler)
    }
  }

  function current() {
    return active?.last
  }

  function onFocus(listener: FocusListener) {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  }

  return {
    register,
    unregister,
    configure,
    activate,
    focusOn,
    move,
    key,
    pointerMove,
    wheel,
    current,
    onFocus,
    onWheel,
    get mode() {
      return input.mode
    },
  }
}

export type FocusEngine = ReturnType<typeof createFocusEngine>
