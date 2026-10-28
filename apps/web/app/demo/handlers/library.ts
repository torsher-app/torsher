import type {
  AddLibraryFolderInput,
  AttentionItem,
  Collection,
  CollectionErrorResponse,
  CollectionList,
  CollectionTitles,
  CreateCollectionInput,
  CreateLibraryInput,
  GroupPreview,
  Library,
  LibraryFileList,
  LibraryFolder,
  LibraryList,
  MessageResponse,
  SetGroupTitleInput,
  UnmatchedGroupList,
  UpdateCollectionInput,
  UpdateLibraryFileInput,
  UpdateLibraryInput,
} from '@torsher/api-client'
import {
  folderOf,
  groupFiles,
  initialCollections,
  initialHomeFiles,
  initialLibraries,
  initialUnmatched,
  libraryOf,
} from '../fixtures/library'
import { DATA_PATH, FOLDER_CONTENT, FOLDER_TREE } from '../fixtures/storage'
import { cardOf, findTitle } from '../fixtures/titles'
import { ago, elapsedSeconds, nextId } from '../state'
import { del, DemoError, get, NO_CONTENT, patch, post, put } from '../router'

const libraries = initialLibraries()
let unmatched = initialUnmatched()
const homeFiles = initialHomeFiles()
const originalCapture = new Map(
  homeFiles.map(file => [
    file.id,
    {
      capturedAt: file.capturedAt,
      capturedAtSource: file.capturedAtSource,
    },
  ]),
)
const collections = initialCollections()

// Скан идёт несколько секунд: опрос панели видит «Сканируется», потом итог
const SCAN_SECONDS = 3
const scans = new Map<string, number>()

function allFolders() {
  return libraries.flatMap(library => library.folders)
}

/** Завершает сканы, время которых вышло: число файлов — что нашлось в папке */
function settleScans() {
  const now = elapsedSeconds()

  for (const folder of allFolders()) {
    const until = scans.get(folder.id)

    if (until === undefined || now < until)
      continue

    scans.delete(folder.id)

    // Папку с файлами скан уже знает; новая берёт содержимое из фикстуры
    if (!folder.scannedAt) {
      const found = FOLDER_CONTENT[folder.path]
      folder.files = found?.files ?? 0
      folder.size = found?.size ?? 0
    }

    folder.status = folder.files > 0 ? 'ok' : 'empty'
    folder.scannedAt = ago(0)
  }
}

function libraryView(library: Library): Library {
  return {
    ...library,
    exclude: [...library.exclude],
    hiddenProfiles: [...library.hiddenProfiles],
    folders: library.folders.map(folder => ({
      ...folder,
      status: scans.has(folder.id) ? 'scanning' : folder.status,
    })),
  }
}

function libraryById(id: string) {
  const found = libraries.find(library => library.id === id)

  if (!found)
    throw new DemoError(404, { message: 'Library not found' })

  return found
}

function folderById(id: string) {
  for (const library of libraries) {
    const folder = library.folders.find(item => item.id === id)

    if (folder)
      return { library, folder }
  }

  throw new DemoError(404, { message: 'Folder not found' })
}

function overlaps(a: string, b: string) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/** Те же причины отказа, что у сервера, по выдуманному дереву каталогов */
function checkFolderPath(path: string) {
  const fail = (kind: string, message: string) => {
    throw new DemoError(422, { kind, message })
  }
  const normalized = path.replace(/\/+$/, '') || '/'

  if (!normalized.startsWith('/'))
    fail('not_absolute', 'Path must be absolute')

  if (!(normalized in FOLDER_TREE))
    fail('missing', 'Folder does not exist')

  if (overlaps(normalized, DATA_PATH))
    fail('inside_data', 'Folder is inside the data directory')

  if (allFolders().some(folder => overlaps(folder.path, normalized)))
    fail('duplicate', 'Folder is already connected')

  return normalized
}

function newFolder(path: string, hint: LibraryFolder['hint'] = 'auto') {
  const folder = folderOf(nextId('folder'), path, {
    hint,
    scannedAt: null,
  })

  scans.set(folder.id, elapsedSeconds() + SCAN_SECONDS)

  return folder
}

function dropGroupsOf(folderIds: string[]) {
  unmatched = unmatched.filter(group => !folderIds.includes(group.folderId))
}

/** Файлы своей раскладки: место библиотеки в «Хранилище» */
export function managedLibraryUsage() {
  const folders = libraries
    .filter(library => library.managed)
    .flatMap(library => library.folders)

  return {
    files: folders.reduce((sum, folder) => sum + folder.files, 0),
    size: folders.reduce((sum, folder) => sum + folder.size, 0),
  }
}

/** Подключённые папки: «Хранилище» не даёт выбрать их под загрузки */
export function connectedFolderPaths() {
  return libraries
    .filter(library => !library.managed)
    .flatMap(library => library.folders.map(folder => folder.path))
}

/** Папка библиотеки сменилась в «Хранилище»: раскладка идёт за ней */
export function setManagedLibraryPath(path: string) {
  const folder = libraries.find(library => library.managed)?.folders[0]

  if (folder)
    folder.path = path
}

function counted(names: string[]): AttentionItem['params'] {
  return names.length === 1
    ? { count: 1, name: names[0] }
    : { count: names.length }
}

/** Причины «Требует внимания» раздела, как их собирает сервер */
export function libraryAttention(): AttentionItem[] {
  settleScans()

  const items: AttentionItem[] = []
  const folders = libraries
    .filter(library => !library.managed)
    .flatMap(library => library.folders)
  const offline = folders.filter(
    folder => folder.status === 'offline' || folder.status === 'denied',
  )

  if (offline.length) {
    items.push({
      kind: 'library_offline',
      severity: 'error',
      section: 'library',
      params: counted(offline.map(folder => folder.path)),
    })
  }

  if (unmatched.length) {
    items.push({
      kind: 'library_unmatched',
      severity: 'warning',
      section: 'library',
      params: counted(unmatched.map(group => group.name)),
    })
  }

  const watchers = folders.filter(folder => folder.watcher === 'failed')

  if (watchers.length) {
    items.push({
      kind: 'library_watcher',
      severity: 'warning',
      section: 'library',
      params: counted(watchers.map(folder => folder.path)),
    })
  }

  return items
}

get<LibraryList>('/api/libraries', () => {
  settleScans()

  return { items: libraries.map(libraryView) }
})

// Точные пути — раньше шаблонных `/api/libraries/:id`
get<UnmatchedGroupList>('/api/libraries/unmatched', () => ({
  items: unmatched.map(group => ({ ...group })),
}))

put<void, SetGroupTitleInput>('/api/libraries/groups/title', ({ body }) => {
  const found = unmatched.find(
    group => group.folderId === body.folderId && group.group === body.group,
  )

  if (!found)
    throw new DemoError(404, { message: 'Release not found' })

  unmatched = unmatched.filter(group => group !== found)

  const { folder } = folderById(found.folderId)

  if (found.status === 'unsure')
    folder.unsure = Math.max(0, folder.unsure - found.files)
  else folder.unmatched = Math.max(0, folder.unmatched - found.files)

  return NO_CONTENT
})

get<GroupPreview>('/api/libraries/groups/preview', ({ query }) => {
  const group = query.get('group') ?? ''
  const titleId = query.get('titleId') ?? ''
  const found = unmatched.find(
    item => item.folderId === query.get('folderId') && item.group === group,
  )

  if (!found)
    throw new DemoError(404, { message: 'Release not found' })

  const asSeries = findTitle(titleId)?.kind === 'series'

  return {
    items: groupFiles(group).map((file, index) => ({
      id: `${found.folderId}-preview-${index}`,
      relPath: file.relPath,
      video: true,
      season: asSeries ? (file.season ?? 1) : null,
      episode: asSeries ? (file.episode ?? index + 1) : null,
      episodeTo: null,
    })),
  }
})

patch<void, UpdateLibraryFileInput>(
  '/api/libraries/files/:fileId',
  ({ params, body }) => {
    const file = homeFiles.find(item => item.id === params.fileId)

    if (!file)
      throw new DemoError(404, { message: 'File not found' })

    // Сброс возвращает дату, которую сервер взял из файла
    const original = originalCapture.get(file.id)!

    file.capturedAt = body.capturedAt ?? original.capturedAt
    file.capturedAtSource = body.capturedAt
      ? 'user'
      : original.capturedAtSource === 'user'
        ? 'file'
        : original.capturedAtSource

    return NO_CONTENT
  },
)

del<void>('/api/libraries/folders/:folderId', ({ params }) => {
  const { library, folder } = folderById(params.folderId!)

  if (library.managed)
    throw new DemoError(404, { message: 'Folder not found' })

  library.folders = library.folders.filter(item => item !== folder)
  scans.delete(folder.id)
  dropGroupsOf([folder.id])

  return NO_CONTENT
})

post<void>('/api/libraries/folders/:folderId/scan', ({ params }) => {
  const { library, folder } = folderById(params.folderId!)

  if (library.managed)
    throw new DemoError(404, { message: 'Folder not found' })

  scans.set(folder.id, elapsedSeconds() + SCAN_SECONDS)

  return NO_CONTENT
})

post<Library, CreateLibraryInput>('/api/libraries', ({ body }) => {
  const path = checkFolderPath(body.path)
  const library = libraryOf(
    nextId('library'),
    body.name.trim(),
    [newFolder(path, body.kind === 'home' ? 'auto' : body.hint)],
    { kind: body.kind },
  )

  libraries.push(library)

  return libraryView(library)
})

patch<Library, UpdateLibraryInput>('/api/libraries/:id', ({ params, body }) => {
  const library = libraryById(params.id!)

  if (body.name !== undefined)
    library.name = body.name.trim()
  if (body.exclude)
    library.exclude = [...body.exclude]
  if (body.hiddenProfiles)
    library.hiddenProfiles = [...body.hiddenProfiles]
  if (body.watch !== undefined) {
    library.watch = body.watch
    library.folders.forEach((folder) => {
      folder.watcher = body.watch ? 'on' : 'off'
    })
  }

  return libraryView(library)
})

del<void>('/api/libraries/:id', ({ params }) => {
  const library = libraryById(params.id!)

  if (library.managed)
    throw new DemoError(404, { message: 'Library not found' })

  libraries.splice(libraries.indexOf(library), 1)
  dropGroupsOf(library.folders.map(folder => folder.id))

  return NO_CONTENT
})

post<Library, AddLibraryFolderInput>(
  '/api/libraries/:id/folders',
  ({ params, body }) => {
    const library = libraryById(params.id!)

    if (library.managed)
      throw new DemoError(404, { message: 'Library not found' })

    library.folders.push(newFolder(checkFolderPath(body.path), body.hint))

    return libraryView(library)
  },
)

get<LibraryFileList>('/api/libraries/:id/files', ({ params, query }) => {
  const library = libraryById(params.id!)
  const folderIds = new Set(library.folders.map(folder => folder.id))
  const files = homeFiles.filter(file => folderIds.has(file.folderId))
  const offset = Number(query.get('offset') ?? 0)
  const limit = Number(query.get('limit') ?? 50)

  return {
    items: files.slice(offset, offset + limit).map(file => ({ ...file })),
    total: files.length,
  }
})

// Подборки

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

function collectionView({
  titles,
  ...collection
}: (typeof collections)[number]): Collection {
  return {
    ...collection,
    hiddenFrom: [...collection.hiddenFrom],
    count: titles.length,
  }
}

function collectionById(id: string) {
  const found = collections.find(item => item.id === id)

  if (!found)
    throw new DemoError(404, { message: 'Collection not found' })

  return found
}

function ensureUniqueName(name: string, exceptId?: string) {
  const taken = collections.some(
    item => item.id !== exceptId && collator.compare(item.name, name) === 0,
  )

  if (taken) {
    const duplicate: CollectionErrorResponse = {
      message: 'Collection with this name already exists',
      kind: 'duplicate',
    }

    throw new DemoError(409, { ...duplicate })
  }
}

get<CollectionList>('/api/collections', () => ({
  items: [...collections]
    .sort((a, b) => collator.compare(a.name, b.name))
    .map(collectionView),
}))

post<Collection, CreateCollectionInput>('/api/collections', ({ body }) => {
  const name = body.name.trim()

  ensureUniqueName(name)

  const created = {
    id: nextId('collection'),
    name,
    count: 0,
    showOnHome: body.showOnHome ?? true,
    hiddenFrom: [...(body.hiddenFrom ?? [])],
    titles: [],
  }

  collections.push(created)

  return collectionView(created)
})

patch<Collection, UpdateCollectionInput>(
  '/api/collections/:id',
  ({ params, body }) => {
    const collection = collectionById(params.id!)

    if (body.name !== undefined) {
      ensureUniqueName(body.name.trim(), collection.id)
      collection.name = body.name.trim()
    }
    if (body.showOnHome !== undefined)
      collection.showOnHome = body.showOnHome
    if (body.hiddenFrom)
      collection.hiddenFrom = [...body.hiddenFrom]

    return collectionView(collection)
  },
)

del<MessageResponse>('/api/collections/:id', ({ params }) => {
  const collection = collectionById(params.id!)

  collections.splice(collections.indexOf(collection), 1)

  return { message: 'Collection deleted' }
})

get<CollectionTitles>('/api/collections/:id/titles', ({ params }) => ({
  items: collectionById(params.id!).titles.flatMap((id) => {
    const title = findTitle(id)
    return title ? [cardOf(title)] : []
  }),
}))

del<MessageResponse>('/api/collections/:id/titles/:titleId', ({ params }) => {
  const collection = collectionById(params.id!)

  collection.titles = collection.titles.filter(id => id !== params.titleId)

  return { message: 'Title removed from collection' }
})
