import { expect, it, vi } from 'vitest'
import { createMaintenanceStartup } from './startup.ts'

it('old-backup review resumes producers only after recovery, without a second engine restart', async () => {
  const events: string[] = []
  let held = true
  const startup = createMaintenanceStartup({
    ready: () => true,
    held: () => held,
    recover: async () => {
      events.push('recovery')
    },
    resume: async () => {
      events.push('reconcile', 'library', 'resolving', 'selection', 'storage')
    },
  })
  await startup.engineReady()
  expect(events).toEqual(['recovery'])
  held = false
  await Promise.all([startup.reviewed(), startup.reviewed()])
  expect(events).toEqual([
    'recovery',
    'reconcile',
    'library',
    'resolving',
    'selection',
    'storage',
  ])
  await startup.engineReady()
  expect(events.filter(event => event === 'recovery')).toHaveLength(2)
  expect(events.filter(event => event === 'resolving')).toHaveLength(2)
})
it('owner review keeps producers paused after failed recovery', async () => {
  const resume = vi.fn(async () => {})
  const startup = createMaintenanceStartup({
    ready: () => true,
    held: () => false,
    recover: async () => {
      throw new Error('engine_offline')
    },
    resume,
  })
  await expect(startup.engineReady()).rejects.toThrow('engine_offline')
  await startup.reviewed()
  expect(resume).not.toHaveBeenCalled()
})

it('starts independent library without Go when the local journal is known and execution is off', async () => {
  const library = vi.fn(async () => {})
  const resume = vi.fn(async () => {})
  let held = false
  const startup = createMaintenanceStartup({
    ready: () => false,
    held: () => held,
    recover: async () => {},
    resume,
    library,
    safeWithoutEngine: async () => true,
  })
  await startup.initialize()
  expect(library).toHaveBeenCalledTimes(1)
  expect(resume).not.toHaveBeenCalled()
  held = true
  await startup.initialize()
  expect(library).toHaveBeenCalledTimes(1)
})
it('holds independent library startup for an unknown engine journal', async () => {
  const library = vi.fn(async () => {})
  const startup = createMaintenanceStartup({
    ready: () => false,
    held: () => false,
    recover: async () => {},
    resume: async () => {},
    library,
    safeWithoutEngine: async () => false,
  })
  await startup.initialize()
  expect(library).not.toHaveBeenCalled()
})
