import type { MediaLinkMode } from '../../db/schema.ts'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  link,
  mkdir,
  readdir,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { config } from '../../config.ts'
import { logFor } from '../logs/index.ts'

// Хардлинк не проходит между томами (`EXDEV`), на ФС без ссылок и в части
// сетевых папок; это не ошибка, а повод перейти к копии
const NO_LINK_CODES = new Set([
  'EXDEV',
  'EPERM',
  'EMLINK',
  'ENOTSUP',
  'EOPNOTSUPP',
  'ENOSYS',
  'EACCES',
])

/** Подмена в тестах: `EXDEV` и отказ reflink на любой ФС */
export const linkDeps = { link, copyFile }

function codeOf(err: unknown) {
  return (err as NodeJS.ErrnoException).code ?? ''
}

async function copyTo(source: string, target: string) {
  try {
    // `FICLONE_FORCE` падает, если reflink не вышел, — так режим известен точно
    await linkDeps.copyFile(source, target, constants.COPYFILE_FICLONE_FORCE)
    return 'reflink' as const
  }
  catch {
    await linkDeps.copyFile(source, target)
    return 'copy' as const
  }
}

/**
 * Кладёт файл в библиотеку по лестнице: хардлинк (место не удваивается) →
 * reflink на btrfs, XFS и ZFS → обычная копия. Копия пишется во временный
 * файл рядом и появляется под своим именем только целиком и того же размера:
 * сторонний медиасервер не увидит половину файла. Занятое имя — `EEXIST`.
 */
export async function placeFile(
  source: string,
  target: string,
): Promise<MediaLinkMode> {
  await mkdir(dirname(target), { recursive: true })

  try {
    await linkDeps.link(source, target)
    return 'hardlink'
  }
  catch (err) {
    if (!NO_LINK_CODES.has(codeOf(err)))
      throw err
  }

  const temp = join(
    dirname(target),
    `.${basename(target)}.${randomBytes(4).toString('hex')}.torsher-tmp`,
  )

  try {
    const mode = await copyTo(source, temp)
    const [from, to] = await Promise.all([stat(source), stat(temp)])

    if (from.size !== to.size)
      throw new Error('Copy size mismatch')

    // `link` вместо `rename`: занятое за время копии имя не перезаписывается
    await link(temp, target)
    return mode
  }
  finally {
    await unlink(temp).catch(() => {})
  }
}

/** Сам каталог или ближайший существующий родитель, где его создадут */
async function nearestDir(path: string) {
  let current = path

  for (;;) {
    const found = await stat(current).catch(() => undefined)

    if (found?.isDirectory())
      return current

    const parent = dirname(current)

    if (found || parent === current)
      return undefined

    current = parent
  }
}

/**
 * Как файлы из загрузок попадут в библиотеку: пробует хардлинк и reflink на
 * месте, пробным файлом. По типу ФС это не узнать: две точки монтирования
 * одной ФС хардлинк не пропускают. Каталога ещё нет — проба идёт в ближайшем
 * родителе. `null` — каталоги недоступны для записи.
 */
export async function probeLinkMode(
  downloadsDir: string,
  libraryDir: string,
): Promise<MediaLinkMode | null> {
  const [from, to] = await Promise.all([
    nearestDir(downloadsDir),
    nearestDir(libraryDir),
  ])

  if (!from || !to)
    return null

  const name = `.torsher-link-${randomBytes(6).toString('hex')}`
  const source = join(from, name)
  // Оба каталога ещё не созданы в одном родителе: имя цели должно отличаться
  const target = join(to, `${name}-link`)

  try {
    await writeFile(source, 'torsher')
  }
  catch {
    return null
  }

  try {
    try {
      await linkDeps.link(source, target)
      return 'hardlink'
    }
    catch {}

    try {
      await linkDeps.copyFile(source, target, constants.COPYFILE_FICLONE_FORCE)
      return 'reflink'
    }
    catch {}

    return 'copy'
  }
  finally {
    await Promise.all([
      unlink(source).catch(() => {}),
      unlink(target).catch(() => {}),
    ])
  }
}

let linkMode: MediaLinkMode | null | undefined
let sameDevice = true

/**
 * Как файлы загрузок попадают в библиотеку на этом сервере. Проверяется при
 * старте пробным файлом и запоминается; `null` — каталоги недоступны.
 */
export async function checkLinkMode(
  downloadsDir = config.downloadsPath,
  libraryDir = config.libraryPath,
) {
  linkMode = await probeLinkMode(downloadsDir, libraryDir)

  const dirs = await Promise.all([
    nearestDir(downloadsDir),
    nearestDir(libraryDir),
  ])
  const [downloads, library] = await Promise.all(
    dirs.map(dir => (dir ? stat(dir).catch(() => undefined) : undefined)),
  )

  sameDevice = !downloads || !library || downloads.dev === library.dev

  if (linkMode === 'copy') {
    logFor('storage').warn(
      'Downloads and library are on different volumes: kept files will be copied',
    )
  }

  return linkMode
}

/** Последний результат проверки; до неё — `undefined` */
export function currentLinkMode() {
  return linkMode
}

/** Библиотека на том же томе, что загрузки: её файлы занимают их место */
export function librarySharesVolume() {
  return sameDevice
}

/**
 * Удаляет файл и файлы рядом с тем же базовым именем (`prefix` — путь до
 * `….`: субтитры и дорожки), затем поднимается вверх и убирает опустевшие
 * каталоги, но не выше корня. Каталог с чужими файлами остаётся.
 */
export async function removeFile(path: string, root: string, prefix?: string) {
  const ignoreMissing = (err: unknown) => {
    if (codeOf(err) !== 'ENOENT')
      throw err
  }

  await unlink(path).catch(ignoreMissing)

  if (prefix) {
    const names = await readdir(dirname(prefix)).catch(() => [] as string[])
    const start = basename(prefix)

    for (const name of names) {
      if (name.startsWith(start))
        await unlink(join(dirname(prefix), name)).catch(ignoreMissing)
    }
  }

  let dir = dirname(path)

  while (dir !== root && dir.startsWith(`${root}${sep}`)) {
    try {
      await rmdir(dir)
    }
    catch {
      break
    }

    dir = dirname(dir)
  }
}
