import { expect, it, vi } from 'vitest'
import { captureTitleActionReturn } from './titleActionReturn.ts'

function setup() {
  const fallback = {} as HTMLElement
  const screen = {
    isConnected: true,
    getClientRects: () => [{}],
    querySelectorAll: () => [fallback],
  }
  const section = { isConnected: true, getAttribute: () => 'home-continue' }
  const opener = {
    isConnected: true,
    closest: (selector: string) => (selector === 'main' ? screen : section),
  }
  let current: HTMLElement | undefined
  const focus = {
    current: () => current,
    focusOn: vi.fn((el: HTMLElement) => {
      if (
        el === fallback
        || (el === (opener as unknown as HTMLElement) && opener.isConnected)
      ) {
        current = el
        return true
      }
      return false
    }),
    activate: vi.fn(() => false),
  }
  const restore = captureTitleActionReturn(
    focus,
    opener as unknown as HTMLElement,
  )
  return {
    fallback,
    opener,
    section,
    screen,
    focus,
    restore,
    setCurrent: (value: HTMLElement) => {
      current = value
    },
  }
}

it('returns to a surviving opener through the existing focus service', () => {
  const state = setup()
  expect(state.restore()).toBe(true)
  expect(state.focus.focusOn).toHaveBeenCalledExactlyOnceWith(state.opener)
})

it('returns to the surviving row after the opener was removed while the menu was open', () => {
  const state = setup()
  state.opener.isConnected = false
  state.focus.activate.mockReturnValueOnce(true)
  expect(state.restore()).toBe(true)
  expect(state.focus.activate).toHaveBeenCalledExactlyOnceWith('home-continue')
  expect(state.focus.focusOn).not.toHaveBeenCalled()
})

it('finds a registered target inside the current screen when the whole opener row disappeared', () => {
  const state = setup()
  state.opener.isConnected = false
  state.section.isConnected = false
  expect(state.restore()).toBe(true)
  expect(state.focus.focusOn).toHaveBeenCalledExactlyOnceWith(state.fallback)
  expect(state.focus.current()).toBe(state.fallback)
})

it('does not return to a hidden KeepAlive page or replace another live panel focus', () => {
  const hidden = setup()
  hidden.screen.isConnected = false
  expect(hidden.restore()).toBe(false)
  expect(hidden.focus.focusOn).not.toHaveBeenCalled()
  expect(hidden.focus.activate).not.toHaveBeenCalled()

  const panel = setup()
  panel.setCurrent({ isConnected: true } as HTMLElement)
  expect(panel.restore()).toBe(false)
  expect(panel.focus.focusOn).not.toHaveBeenCalled()
  expect(panel.focus.activate).not.toHaveBeenCalled()
})
