import type { Direction } from './geometry.ts'
import { findNext } from './geometry.ts'

export type SectionEdges = Partial<Record<Direction, string>>

interface Section {
  elements: Set<HTMLElement>
  last?: HTMLElement
  edges: SectionEdges
}

function isVisible(el: HTMLElement) {
  return el.offsetParent !== null
}

function byDocumentOrder(a: HTMLElement, b: HTMLElement) {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1
}

/**
 * Фокус живёт в секциях: стрелки двигают его внутри
 * активной секции, а на краю секция сама решает, куда передать фокус (`edges`).
 * Каждая секция помнит последний элемент — возврат в ряд попадает туда же.
 * Источник истины — DOM-фокус, стили висят на `:focus`.
 */
export function createFocusEngine() {
  const sections = new Map<string, Section>()
  let active: Section | undefined

  function section(name: string) {
    let found = sections.get(name)

    if (!found) {
      found = { elements: new Set(), edges: {} }
      sections.set(name, found)
    }

    return found
  }

  function focusElement(target: Section, el: HTMLElement) {
    active = target
    target.last = el
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function register(name: string, el: HTMLElement) {
    section(name).elements.add(el)
  }

  function unregister(name: string, el: HTMLElement) {
    const found = sections.get(name)

    if (!found)
      return

    found.elements.delete(el)

    if (found.last === el)
      found.last = undefined
  }

  function setEdges(name: string, edges: SectionEdges) {
    section(name).edges = edges
  }

  function activate(name: string) {
    const found = sections.get(name)
    const visible = found ? [...found.elements].filter(isVisible) : []

    if (!found || visible.length === 0)
      return false

    const target
      = found.last && visible.includes(found.last)
        ? found.last
        : visible.sort(byDocumentOrder)[0]!

    focusElement(found, target)

    return true
  }

  function move(direction: Direction) {
    const current = active?.last

    if (!active || !current)
      return

    const candidates = [...active.elements]
      .filter(el => el !== current && isVisible(el))
      .map(el => ({ item: el, rect: el.getBoundingClientRect() }))

    const next = findNext(
      current.getBoundingClientRect(),
      candidates,
      direction,
    )

    if (next) {
      focusElement(active, next)

      return
    }

    const edge = active.edges[direction]

    if (edge)
      activate(edge)
  }

  /** Курсор Magic Remote или мышь навели на элемент — фокус переезжает к нему. */
  function point(name: string, el: HTMLElement) {
    focusElement(section(name), el)
  }

  function current() {
    return active?.last
  }

  return { register, unregister, setEdges, activate, move, point, current }
}

export type FocusEngine = ReturnType<typeof createFocusEngine>
