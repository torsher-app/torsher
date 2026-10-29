import { join } from 'node:path'
import { unroutedMethods, usedApiMethods } from '@torsher/demo/coverage'
import { describe, expect, it } from 'vitest'
import './handlers'

describe('panel demo', () => {
  it('answers every request the panel makes', async () => {
    const used = usedApiMethods(join(import.meta.dirname, '..'))

    expect(await unroutedMethods(used)).toEqual([])
  })
})
