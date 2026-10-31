import { join } from 'node:path'
import { unroutedMethods, usedApiMethods } from '@torsher/demo/coverage'
import type { NotificationList } from '@torsher/api-client'
import { handle } from '@torsher/demo/router'
import { describe, expect, it } from 'vitest'
import './handlers'

describe('panel demo', () => {
  it('answers every request the panel makes', async () => {
    const used = usedApiMethods(join(import.meta.dirname, '..'))

    expect(await unroutedMethods(used)).toEqual([])
  })
})

async function notifications(query = ''): Promise<NotificationList> {
  const response = await handle(
    new URL(`http://demo/api/notifications${query}`),
    { method: 'GET' },
    'Unavailable',
  )

  return response.json()
}

describe('notification history demo', () => {
  it('filters before pagination and keeps the unread count global', async () => {
    const all = await notifications('?limit=100')
    const first = await notifications('?group=downloads&limit=1')
    const second = await notifications(
      `?group=downloads&limit=1&before=${first.nextCursor}`,
    )

    expect(first.items).toHaveLength(1)
    expect(second.items).toHaveLength(1)
    expect(first.items[0]!.id).not.toBe(second.items[0]!.id)
    expect(
      [...first.items, ...second.items].every(
        item => item.kind === 'download_completed',
      ),
    ).toBe(true)
    expect(first.unread).toBe(all.unread)

    const unread = await notifications('?group=downloads&unread=1')

    expect(unread.items).toHaveLength(1)
    expect(unread.items[0]!.readAt).toBeUndefined()
    expect(unread.nextCursor).toBeUndefined()
  })

  it('places missing releases in Problems, separately from Following', async () => {
    const problems = await notifications('?group=problems')
    const follow = await notifications('?group=follow')

    expect(problems.items.some(item => item.kind === 'follow_missing')).toBe(
      true,
    )
    expect(
      follow.items.every(
        item =>
          item.kind.startsWith('follow_') && item.kind !== 'follow_missing',
      ),
    ).toBe(true)
  })
})
