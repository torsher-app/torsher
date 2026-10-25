import { constants } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  linkDeps,
  placeFile,
  probeLinkMode,
  removeFile,
  replaceFile,
} from './link.ts'

let root = ''

function errno(code: string) {
  return Object.assign(new Error(code), { code })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'torsher-link-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

async function source() {
  const path = join(root, 'torrents', 'Release', 'file.mkv')

  await mkdir(join(root, 'torrents', 'Release'), { recursive: true })
  await writeFile(path, 'video data')
  return path
}

describe('лестница связывания', () => {
  it('хардлинк: вторая ссылка на тот же файл, каталоги создаются', async () => {
    const from = await source()
    const to = join(root, 'library', 'movies', 'Film', 'Film.mkv')

    expect(await placeFile(from, to)).toBe('hardlink')
    expect((await stat(to)).nlink).toBe(2)
    expect((await stat(to)).ino).toBe((await stat(from)).ino)
  })

  it('другой том: reflink, если ФС умеет', async () => {
    const from = await source()
    const to = join(root, 'library', 'Film.mkv')

    vi.spyOn(linkDeps, 'link').mockRejectedValue(errno('EXDEV'))
    // Настоящий reflink есть не на любой ФС: имитируем удачный клон копией
    vi.spyOn(linkDeps, 'copyFile').mockImplementation(async (a, b) => {
      const { copyFile } = await import('node:fs/promises')
      await copyFile(a, b)
    })

    expect(await placeFile(from, to)).toBe('reflink')
    expect(await readFile(to, 'utf8')).toBe('video data')
    expect((await stat(to)).nlink).toBe(1)
  })

  it('другой том без reflink: обычная копия без временных файлов', async () => {
    const from = await source()
    const dir = join(root, 'library')
    const to = join(dir, 'Film.mkv')
    const { copyFile } = await import('node:fs/promises')

    vi.spyOn(linkDeps, 'link').mockRejectedValue(errno('EXDEV'))
    vi.spyOn(linkDeps, 'copyFile').mockImplementation(async (a, b, mode) => {
      if (mode === constants.COPYFILE_FICLONE_FORCE)
        throw errno('ENOTSUP')
      await copyFile(a, b)
    })

    expect(await placeFile(from, to)).toBe('copy')
    expect(await readFile(to, 'utf8')).toBe('video data')
    expect(await readdir(dir)).toEqual(['Film.mkv'])
  })

  it('занятое имя не перезаписывается', async () => {
    const from = await source()
    const to = join(root, 'library', 'Film.mkv')

    await mkdir(join(root, 'library'))
    await writeFile(to, 'other')

    await expect(placeFile(from, to)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(to, 'utf8')).toBe('other')
  })

  it('прочая ошибка не превращается в копию', async () => {
    const from = await source()

    vi.spyOn(linkDeps, 'link').mockRejectedValue(errno('EIO'))

    await expect(
      placeFile(from, join(root, 'library', 'Film.mkv')),
    ).rejects.toMatchObject({ code: 'EIO' })
  })
})

describe('замена файла библиотеки', () => {
  it('новая версия встаёт под то же имя, временных файлов не остаётся', async () => {
    const from = await source()
    const to = join(root, 'library', 'Film.mkv')

    await mkdir(join(root, 'library'), { recursive: true })
    await writeFile(to, 'old video')

    expect(await replaceFile(from, to)).toBe('hardlink')
    expect(await readFile(to, 'utf8')).toBe('video data')
    expect((await stat(to)).ino).toBe((await stat(from)).ino)
    expect(await readdir(join(root, 'library'))).toEqual(['Film.mkv'])
  })
})

describe('проверка хардлинков', () => {
  it('на одном томе — хардлинк, пробные файлы убраны, каталоги не созданы', async () => {
    const downloads = join(root, 'torrents')
    const library = join(root, 'library')

    expect(await probeLinkMode(downloads, library)).toBe('hardlink')
    expect(await readdir(root)).toEqual([])
  })

  it('без хардлинка и reflink — копия', async () => {
    vi.spyOn(linkDeps, 'link').mockRejectedValue(errno('EXDEV'))
    vi.spyOn(linkDeps, 'copyFile').mockRejectedValue(errno('ENOTSUP'))

    expect(await probeLinkMode(root, root)).toBe('copy')
    expect(await readdir(root)).toEqual([])
  })
})

describe('удаление из библиотеки', () => {
  it('убирает файл, файлы с тем же именем и пустые каталоги до корня', async () => {
    const library = join(root, 'library')
    const season = join(library, 'shows', 'Show', 'Season 01')

    await mkdir(season, { recursive: true })
    await writeFile(join(season, 'Show S01E01.mkv'), '')
    await writeFile(join(season, 'Show S01E01.rus.srt'), '')
    await writeFile(join(season, 'Show S01E01 - 2160p.mkv'), '')

    await removeFile(
      join(season, 'Show S01E01.mkv'),
      library,
      join(season, 'Show S01E01.'),
    )
    expect(await readdir(season)).toEqual(['Show S01E01 - 2160p.mkv'])

    await removeFile(join(season, 'Show S01E01 - 2160p.mkv'), library)
    expect(await readdir(library)).toEqual([])
  })
})
