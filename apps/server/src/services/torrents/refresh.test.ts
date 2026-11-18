import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  linkCarried,
  metadataPaths,
  removeFiles,
  removeRetiredFiles,
  unlinkCarried,
} from './refresh.ts'

let root = ''
afterEach(async () => {
  if (root)
    await rm(root, { recursive: true, force: true })
})

it('preserves a metadata-owned .part neighbour, including an unselected file', async () => {
  root = await mkdtemp(join(tmpdir(), 'torsher-refresh-parts-'))
  const torrent = {
    name: 'Season',
    files: [
      { path: 'episode.mkv', size: 1, padding: false },
      { path: 'episode.mkv.part', size: 8, padding: false },
    ],
  }
  const paths = metadataPaths(torrent, root)
  // The first file is genuinely absent; the .part path is its own metainfo file.
  await mkdir(join(root, 'Season'))
  await writeFile(paths[1]!, 'own-file')
  const before = await stat(paths[1]!)
  await removeFiles([paths[0]!], root, paths)
  await removeFiles([paths[0]!], root, paths)
  expect(await readFile(paths[1]!, 'utf8')).toBe('own-file')
  expect((await stat(paths[1]!)).ino).toBe(before.ino)
})

it('removes an unowned legacy .part and explicit metadata paths', async () => {
  root = await mkdtemp(join(tmpdir(), 'torsher-refresh-parts-'))
  const path = join(root, 'episode.mkv')
  await writeFile(`${path}.part`, 'legacy')
  await removeFiles([path], root, [path])
  await expect(stat(`${path}.part`)).rejects.toMatchObject({ code: 'ENOENT' })
  await mkdir(root, { recursive: true })
  await writeFile(`${path}.part`, 'own-file')
  await removeFiles([`${path}.part`], root, [`${path}.part`])
  await expect(stat(`${path}.part`)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('protects case-folded metadata .PART collisions even on a case-sensitive filesystem', async () => {
  root = await mkdtemp(join(tmpdir(), 'torsher-refresh-parts-'))
  const source = join(root, 'E.mkv')
  const owned = `${source}.PART`
  const legacy = `${source}.part`
  await writeFile(owned, 'owned-part')
  const separateLegacy = !(await stat(legacy).catch(() => undefined))
  if (separateLegacy)
    await writeFile(legacy, 'legacy-part')
  await removeFiles([source], root, [source, owned])
  expect(await readFile(owned, 'utf8')).toBe('owned-part')
  expect(await readFile(legacy, 'utf8')).toBe(
    separateLegacy ? 'legacy-part' : 'owned-part',
  )
})

it.each([
  ['source.ος.mkv', 'source.οσ.mkv.PART'],
  ['Café.mkv', 'Café.mkv.PART'],
])(
  'checks physical aliases before removing the legacy partial for %s',
  async (base, owned) => {
    root = await mkdtemp(join(tmpdir(), 'torsher-refresh-parts-'))
    const source = join(root, base)
    const partial = `${source}.part`
    const active = join(root, owned)
    await writeFile(active, 'active')
    const sameEntry = !!(await stat(partial).catch(() => undefined))
    if (!sameEntry)
      await writeFile(partial, 'retired partial')
    await writeFile(source, 'retired')

    await removeRetiredFiles([source], root, [active], [])

    expect(await readFile(active, 'utf8')).toBe('active')
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    if (!sameEntry)
      await expect(stat(partial)).rejects.toMatchObject({ code: 'ENOENT' })
  },
)

it('retires an independent hardlink to an active payload', async () => {
  root = await mkdtemp(join(tmpdir(), 'torsher-refresh-parts-'))
  const retired = join(root, 'old.mkv.part')
  const active = join(root, 'new.mkv.PART')
  await writeFile(active, 'active')
  await link(active, retired)

  await removeRetiredFiles([retired], root, [active], [])

  await expect(stat(retired)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(active, 'utf8')).toBe('active')
})

it.each(['season', 'different'])(
  'rolls back only a separate carried directory entry: %s',
  async (name) => {
    root = await mkdtemp(join(tmpdir(), 'torsher-refresh-rollback-'))
    const files = [{ path: 'episode.mkv', size: 8, padding: false }]
    const old = { name: 'Season', files }
    const next = { name, files }
    const source = join(root, old.name, files[0]!.path)
    const target = join(root, name, files[0]!.path)
    await mkdir(join(root, old.name))
    await writeFile(source, 'original')
    const alias = !!(await stat(target).catch(() => undefined))
    const indexes = new Map([[0, 0]])
    await linkCarried(old, next, indexes, root)

    expect((await stat(target)).ino).toBe((await stat(source)).ino)
    await unlinkCarried(old, next, indexes, root)
    expect(await readFile(source, 'utf8')).toBe('original')
    if (!alias)
      await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  },
)

it.each([
  ['source.ος.mkv', 'source.οσ.mkv.PART'],
  ['Café.mkv', 'Café.mkv.PART'],
])(
  'protects the physical partial alias when explicitly deleting %s',
  async (base, owned) => {
    root = await mkdtemp(join(tmpdir(), 'torsher-refresh-unlink-'))
    const source = join(root, base)
    const part = `${source}.part`
    const active = join(root, owned)
    await writeFile(source, 'changed source')
    await writeFile(active, 'distinct payload')
    const alias = !!(await stat(part).catch(() => undefined))
    if (!alias)
      await link(active, part)

    await removeFiles([source], root, [source, active])

    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(active, 'utf8')).toBe('distinct payload')
    if (!alias)
      await expect(stat(part)).rejects.toMatchObject({ code: 'ENOENT' })
  },
)
