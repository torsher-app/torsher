import type { MineUndoInput } from './mineUndo.ts'
import { beforeEach, expect, it, vi } from 'vitest'
import { setTitleViewer } from '../titleActions.ts'
import { mineViewer } from './minePersonal.ts'
import { applyMineUndo, mineUndo, showMineUndo } from './mineUndo.ts'

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  cycle: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
    mine: {
      deleteMineDiaryEntry: mocks.remove,
      getMineTitlePersonal: mocks.get,
      patchMineTitlePersonal: mocks.patch,
      patchMineCycle: mocks.cycle,
    },
  },
}))

beforeEach(() => {
  vi.resetAllMocks()
  setTitleViewer(undefined)
  setTitleViewer('A')
  mineUndo.value = undefined
})

function operation(
  change: Pick<MineUndoInput, 'kind'> & Record<string, unknown>,
) {
  showMineUndo({
    titleId: 'film',
    title: 'Fictional film',
    language: 'en-US',
    context: mineViewer()!,
    ...change,
  } as MineUndoInput)
  return mineUndo.value!
}

it('undoes only the created diary event, never its independent seen mark', async () => {
  const undo = operation({
    kind: 'logged',
    entryId: 'entry-1',
    day: '2026-11-19',
  })
  await applyMineUndo(undo)
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(
    'entry-1',
    { expectedProfileId: 'A' },
    { signal: undefined },
  )
  expect(mocks.patch).not.toHaveBeenCalled()
  expect(mineUndo.value).toBeUndefined()
})

it('restores only the prior continuation value and preserves unrelated notes', async () => {
  mocks.get.mockResolvedValue({ continuation: 'hidden', note: 'New note' })
  const undo = operation({ kind: 'hidden', before: 'normal', after: 'hidden' })
  await applyMineUndo(undo)
  expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(
    'film',
    {
      expectedProfileId: 'A',
      language: 'en-US',
      continuation: 'normal',
    },
    { signal: undefined },
  )
})

it('does not replace a later continuation or a different cycle', async () => {
  mocks.get.mockResolvedValueOnce({ continuation: 'paused' })
  await applyMineUndo(
    operation({ kind: 'hidden', before: 'normal', after: 'hidden' }),
  )
  expect(mocks.patch).not.toHaveBeenCalled()
  mocks.get.mockResolvedValueOnce({
    cycle: { id: 'other', state: 'paused', updatedAt: '2026-11-19T10:00:00Z' },
  })
  await applyMineUndo(
    operation({
      kind: 'cyclePaused',
      cycleId: 'cycle',
      updatedAt: '2026-11-19T10:00:00Z',
    }),
  )
  expect(mocks.cycle).not.toHaveBeenCalled()
})

it('rejects an A to B to A response between the read and the undo write', async () => {
  let finish!: (value: unknown) => void
  mocks.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = applyMineUndo(
    operation({ kind: 'paused', before: 'normal', after: 'paused' }),
  )
  setTitleViewer('B')
  setTitleViewer('A')
  finish({ continuation: 'paused' })
  await pending
  expect(mocks.patch).not.toHaveBeenCalled()
  expect(mineUndo.value).toBeUndefined()
})

it('does not let an earlier offer act after a new local operation replaced it', async () => {
  const first = operation({ kind: 'logged', entryId: 'old', day: null })
  const second = operation({ kind: 'logged', entryId: 'new', day: null })
  await applyMineUndo(first)
  expect(mocks.remove).not.toHaveBeenCalled()
  expect(mineUndo.value).toBe(second)
})
