import type {
  AddLibraryFolderInput,
  CreateLibraryInput,
  Library,
  SetGroupTitleInput,
  UnmatchedGroup,
  UpdateLibraryInput,
} from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

// Пока идёт скан, статус папки и число файлов обновляются сами
const SCAN_POLL_MS = 2000

const libraries = shallowRef<Library[]>([])
const unmatched = shallowRef<UnmatchedGroup[]>([])
const state = ref<LoadState>('idle')
let timer: ReturnType<typeof setTimeout> | undefined

// Скан или сопоставление ещё идут: статус, числа и «Нераспознанное» меняются
function isBusy(items: Library[]) {
  return items.some(item =>
    item.folders.some(
      folder => folder.status === 'scanning' || folder.pending > 0,
    ),
  )
}

async function fetchAll() {
  const [list, groups] = await Promise.all([
    withErrorMode('silent', () => api.libraries.getLibraries()),
    withErrorMode('silent', () => api.libraries.getLibraryUnmatched()),
  ])

  libraries.value = list.items
  unmatched.value = groups.items
}

function schedule() {
  clearTimeout(timer)

  if (isBusy(libraries.value))
    timer = setTimeout(() => void refresh(), SCAN_POLL_MS)
}

async function load() {
  state.value = 'loading'

  try {
    await fetchAll()
    state.value = 'ready'
    schedule()
  }
  catch {
    state.value = 'error'
  }
}

/** Тихое перечитывание: после действий и пока идёт скан */
async function refresh() {
  try {
    await fetchAll()
    state.value = 'ready'
  }
  catch {
    // Прежний список остаётся; следующий опрос попробует снова
  }

  schedule()
}

function replace(updated: Library) {
  libraries.value = libraries.value.some(item => item.id === updated.id)
    ? libraries.value.map(item => (item.id === updated.id ? updated : item))
    : [...libraries.value, updated]
  schedule()
}

export type FolderPathError
  = | 'not_absolute'
    | 'missing'
    | 'not_directory'
    | 'denied'
    | 'inside_data'
    | 'duplicate'
    | 'unknown'

/** Почему папку не подключили: вид из ответа 422, иначе — общая ошибка */
export async function folderPathError(err: unknown): Promise<FolderPathError> {
  if (getErrorStatus(err) !== 422)
    return 'unknown'

  const body = await getErrorBody<{ kind?: FolderPathError }>(err)

  return body?.kind ?? 'unknown'
}

/** Библиотеки и подключённые папки; «Нераспознанное» — релизы без тайтла */
export function useLibraries() {
  async function create(body: CreateLibraryInput) {
    const created = await withErrorMode('silent', () =>
      api.libraries.postLibrary(body))

    replace(created)

    return created
  }

  async function update(id: string, body: UpdateLibraryInput) {
    replace(await api.libraries.patchLibrary(id, body))
  }

  async function remove(id: string) {
    await api.libraries.deleteLibrary(id)
    libraries.value = libraries.value.filter(item => item.id !== id)
    await refresh()
  }

  async function addFolder(id: string, body: AddLibraryFolderInput) {
    replace(
      await withErrorMode('silent', () =>
        api.libraries.postLibraryFolder(id, body)),
    )
  }

  async function removeFolder(folderId: string) {
    await api.libraries.deleteLibraryFolder(folderId)
    await refresh()
  }

  async function scan(folderId: string) {
    await api.libraries.postLibraryFolderScan(folderId)
    // Скан идёт в фоне: статус «Сканируется» приходит с первым опросом
    setTimeout(() => void refresh(), 300)
  }

  async function setGroupTitle(
    group: UnmatchedGroup,
    titleId: string | null,
    episodes?: SetGroupTitleInput['episodes'],
  ) {
    await api.libraries.putLibraryGroupTitle({
      folderId: group.folderId,
      group: group.group,
      titleId,
      episodes,
    })
    await refresh()
  }

  return {
    libraries: computed(() => libraries.value),
    unmatched: computed(() => unmatched.value),
    state: readonly(state),
    load,
    refresh,
    stopPolling: () => clearTimeout(timer),
    create,
    update,
    remove,
    addFolder,
    removeFolder,
    scan,
    setGroupTitle,
  }
}
