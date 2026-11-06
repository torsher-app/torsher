import { expect, it } from 'vitest'
import { survivingFocus } from './listFocus.ts'

it('retains an item across reordering and mass removal before it', () => {
  expect(survivingFocus(['a', 'b', 'c', 'd'], ['d', 'c'], 'c')).toBe('c')
})
it('chooses a surviving neighbour instead of the obsolete numeric position', () => {
  const before = Array.from({ length: 120 }, (_, i) => String(i))
  expect(survivingFocus(before, before.slice(64), '63')).toBe('64')
  expect(survivingFocus(['a', 'b', 'c'], ['a'], 'c')).toBe('a')
})
it('handles a replaced or empty list', () => {
  expect(survivingFocus(['a', 'b'], ['c', 'd'], 'b')).toBe('d')
  expect(survivingFocus(['a'], [], 'a')).toBeUndefined()
})
