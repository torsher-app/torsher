import type { LibraryFolder } from '../../db/schema.ts'
import { describe, expect, it } from 'vitest'
import { isInside, libraryPath } from './linker.ts'

const root = '/media/library'

describe('isInside', () => {
  it('accepts names that only start with two dots', () => {
    expect(isInside(root, `${root}/..foo`)).toBe(true)
    expect(isInside(root, `${root}/movies/a.mkv`)).toBe(true)
  })

  it('rejects the folder itself, its parent and paths outside', () => {
    expect(isInside(root, root)).toBe(false)
    expect(isInside(root, `${root}/..`)).toBe(false)
    expect(isInside(root, `${root}/../x`)).toBe(false)
    expect(isInside(root, '/etc')).toBe(false)
  })
})

describe('libraryPath', () => {
  const folder = { path: root } as LibraryFolder

  it('builds a path inside the folder', () => {
    expect(libraryPath(folder, 'other/Release/a.mkv')).toBe(
      `${root}/other/Release/a.mkv`,
    )
  })

  it('refuses a relative path that climbs out of the folder', () => {
    expect(() => libraryPath(folder, 'other/../../x.mkv')).toThrow(/outside/)
    expect(() => libraryPath(folder, '../library-other/x.mkv')).toThrow(
      /outside/,
    )
  })
})
